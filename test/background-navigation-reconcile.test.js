import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createChromeStub(options = {}) {
  const sentRuntimeMessages = [];
  const debuggerCommands = [];
  const sessionSets = [];

  const listeners = () => ({
    addListener() {},
    removeListener() {}
  });

  const chrome = {
    storage: {
      local: {
        get(_defaults, callback) {
          callback({ lobsterlinkDebugLoggingEnabled: false });
        }
      },
      session: {
        get: async () => ({}),
        set: async (value) => {
          sessionSets.push(value);
          if (options.sessionSetHandler) {
            await options.sessionSetHandler(value);
          }
        }
      },
      onChanged: listeners()
    },
    runtime: {
      getContexts: async () => [],
      sendMessage: async (message) => {
        sentRuntimeMessages.push(message);
        return {};
      },
      onMessage: listeners()
    },
    offscreen: {
      createDocument: async () => {}
    },
    debugger: {
      sendCommand: async (target, method, params) => {
        debuggerCommands.push({ target, method, params });
        if (options.debuggerCommandHandler) {
          const handled = options.debuggerCommandHandler({ target, method, params });
          if (handled !== undefined) return await handled;
        }
        if (method === 'Page.getLayoutMetrics') {
          return {
            cssLayoutViewport: {
              clientWidth: 1024,
              clientHeight: 768
            }
          };
        }
        return {};
      },
      onEvent: listeners(),
      onDetach: listeners(),
      attach: async () => {},
      detach: async () => {}
    },
    scripting: {
      executeScript: async ({ func, target, files }) => {
        if (options.executeScriptHandler) {
          const handled = options.executeScriptHandler({ func, target, files });
          if (handled !== undefined) return await handled;
        }
        if (typeof func === 'function') return [{ result: 2 }];
        return [{ result: true }];
      }
    },
    tabs: {
      get: async (tabId) => ({
        id: tabId,
        windowId: 7,
        width: 1024,
        height: 768,
        url: 'https://example.com/after',
        title: 'After navigation'
      }),
      getZoom: async () => 1,
      sendMessage: async () => {},
      query: async () => [],
      onActivated: listeners(),
      onUpdated: listeners(),
      onRemoved: listeners(),
      onCreated: listeners()
    },
    windows: {
      get: async () => ({ width: 1200, height: 900 }),
      update: async () => {}
    }
  };

  return { chrome, sentRuntimeMessages, debuggerCommands, sessionSets };
}

function loadBackground(options = {}) {
  const { chrome, sentRuntimeMessages, debuggerCommands, sessionSets } = createChromeStub(options);
  const context = {
    chrome,
    console,
    setTimeout,
    clearTimeout,
    fetch: async () => ({}),
    self: null,
    __LOBSTERLINK_ENABLE_TEST_HOOKS__: true
  };
  context.self = context;
  vm.createContext(context);
  context.importScripts = (...paths) => {
    for (const scriptPath of paths) {
      const source = readFileSync(join(repoRoot, scriptPath), 'utf8');
      vm.runInContext(source, context, { filename: scriptPath });
    }
  };

  const backgroundSource = readFileSync(join(repoRoot, 'background.js'), 'utf8');
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });
  return { context, sentRuntimeMessages, debuggerCommands, sessionSets };
}

describe('background navigation screencast reconciliation', () => {
  it('reconciles captured-tab screencast geometry after navigation completes', async () => {
    const { context, sentRuntimeMessages, debuggerCommands } = loadBackground();
    const hooks = context.__lobsterlinkBackgroundTestHooks;

    expect(hooks).toBeTruthy();
    await hooks.ensureHostStateLoadedForTest();

    hooks.setHostStateForTest({
      hosting: true,
      viewerConnected: true,
      debuggerAttached: true,
      captureMode: 'screencast',
      capturedTabId: 42,
      screencastWidth: 800,
      screencastHeight: 600,
      pageDevicePixelRatio: null
    });

    await hooks.onTabUpdatedForTest(42, { status: 'complete' }, {
      id: 42,
      url: 'https://example.com/after',
      title: 'After navigation'
    });

    expect(sentRuntimeMessages).toContainEqual({
      action: 'offscreen:screencastResize',
      width: 2048,
      height: 1536,
      viewportWidth: 1024,
      viewportHeight: 768
    });
    expect(debuggerCommands).toEqual(expect.arrayContaining([
      { target: { tabId: 42 }, method: 'Page.stopScreencast', params: undefined },
      { target: { tabId: 42 }, method: 'Page.enable', params: undefined },
      {
        target: { tabId: 42 },
        method: 'Page.startScreencast',
        params: {
          format: 'jpeg',
          quality: 92,
          maxWidth: 2048,
          maxHeight: 1536
        }
      }
    ]));
    expect(hooks.getHostStateForTest()).toMatchObject({
      screencastWidth: 1024,
      screencastHeight: 768,
      pageDevicePixelRatio: 2
    });
    expect(sentRuntimeMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'offscreen:sendToViewer',
        message: expect.objectContaining({
          type: 'hostMetrics',
          viewportWidth: 1024,
          viewportHeight: 768,
          devicePixelRatio: 2
        })
      })
    ]));
  });

  it('aborts stale reconciliation when captured tab changes before viewport read resolves', async () => {
    const layoutMetrics = createDeferred();
    const { context, sentRuntimeMessages, debuggerCommands, sessionSets } = loadBackground({
      debuggerCommandHandler: ({ method }) => {
        if (method === 'Page.getLayoutMetrics') return layoutMetrics.promise;
        return undefined;
      }
    });
    const hooks = context.__lobsterlinkBackgroundTestHooks;

    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({
      hosting: true,
      viewerConnected: true,
      debuggerAttached: true,
      captureMode: 'screencast',
      capturedTabId: 42,
      screencastWidth: 800,
      screencastHeight: 600,
      pageDevicePixelRatio: 1
    });

    const reconcile = hooks.reconcileCapturedTabScreencastGeometryForTest({ reason: 'stale-test' });
    await Promise.resolve();
    expect(debuggerCommands).toContainEqual({
      target: { tabId: 42 },
      method: 'Page.getLayoutMetrics',
      params: undefined
    });

    hooks.setHostStateForTest({
      capturedTabId: 43,
      screencastWidth: 777,
      screencastHeight: 555
    });
    layoutMetrics.resolve({
      cssLayoutViewport: {
        clientWidth: 1024,
        clientHeight: 768
      }
    });

    await expect(reconcile).resolves.toBe(false);
    expect(sentRuntimeMessages).not.toContainEqual(expect.objectContaining({
      action: 'offscreen:screencastResize'
    }));
    expect(debuggerCommands.filter((command) => [
      'Page.stopScreencast',
      'Page.enable',
      'Page.startScreencast'
    ].includes(command.method))).toEqual([]);
    expect(sessionSets).toEqual([]);
    expect(hooks.getHostStateForTest()).toMatchObject({
      capturedTabId: 43,
      screencastWidth: 777,
      screencastHeight: 555
    });
  });

  it('aborts stale reconciliation when hosting stops before device pixel ratio read resolves', async () => {
    const devicePixelRatio = createDeferred();
    let devicePixelRatioRequests = 0;
    const { context, sentRuntimeMessages, debuggerCommands, sessionSets } = loadBackground({
      executeScriptHandler: ({ func }) => {
        if (typeof func === 'function') {
          devicePixelRatioRequests += 1;
          return devicePixelRatio.promise;
        }
        return undefined;
      }
    });
    const hooks = context.__lobsterlinkBackgroundTestHooks;

    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({
      hosting: true,
      viewerConnected: true,
      debuggerAttached: true,
      captureMode: 'screencast',
      capturedTabId: 42,
      screencastWidth: 800,
      screencastHeight: 600,
      pageDevicePixelRatio: 1
    });

    const reconcile = hooks.reconcileCapturedTabScreencastGeometryForTest({ reason: 'stale-dpr-test' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(devicePixelRatioRequests).toBe(1);

    hooks.setHostStateForTest({ hosting: false });
    devicePixelRatio.resolve([{ result: 2 }]);

    await expect(reconcile).resolves.toBe(false);
    expect(sentRuntimeMessages).not.toContainEqual(expect.objectContaining({
      action: 'offscreen:screencastResize'
    }));
    expect(debuggerCommands.filter((command) => [
      'Page.stopScreencast',
      'Page.enable',
      'Page.startScreencast'
    ].includes(command.method))).toEqual([]);
    expect(sessionSets).toEqual([]);
    expect(hooks.getHostStateForTest()).toMatchObject({
      hosting: false,
      screencastWidth: 800,
      screencastHeight: 600,
      pageDevicePixelRatio: 1
    });
  });

  it('does not restart screencast when capture size is unchanged without force', async () => {
    const { context, sentRuntimeMessages, debuggerCommands } = loadBackground();
    const hooks = context.__lobsterlinkBackgroundTestHooks;

    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({
      hosting: true,
      viewerConnected: true,
      debuggerAttached: true,
      captureMode: 'screencast',
      capturedTabId: 42,
      screencastWidth: 1024,
      screencastHeight: 768,
      pageDevicePixelRatio: 2
    });

    await expect(hooks.reconcileCapturedTabScreencastGeometryForTest({ reason: 'unchanged-test' })).resolves.toBe(true);

    expect(sentRuntimeMessages).toContainEqual({
      action: 'offscreen:screencastResize',
      width: 2048,
      height: 1536,
      viewportWidth: 1024,
      viewportHeight: 768
    });
    expect(debuggerCommands.filter((command) => [
      'Page.stopScreencast',
      'Page.enable',
      'Page.startScreencast'
    ].includes(command.method))).toEqual([]);
  });

});
