import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// waitForPeerId() arms a 15s rejection timer. Rather than wait it out, run any
// timer scheduled at exactly that delay on the next microtask, so the peer
// handshake "times out" immediately and we exercise the failure path.
const PEER_TIMEOUT_MS = 15000;

function loadBackground({ peerReady = false, hangHandshake = false } = {}) {
  // When hangHandshake is set the 15s rejection timer is captured instead of
  // fired, so a start can be parked mid-flight (debugger attached, screencast
  // running, peer not yet ready) while the test issues a second start.
  let peerTimeoutFn = null;
  let armedResolve;
  const handshakeArmed = new Promise((resolve) => { armedResolve = resolve; });
  const debuggerCommands = [];
  const sentRuntimeMessages = [];
  const detaches = [];
  const sessionSets = [];
  let offscreenClosed = 0;
  let offscreenCreated = 0;
  let hostingStarted = false;
  const runtimeListeners = [];

  const listeners = () => ({ addListener() {}, removeListener() {} });

  const chrome = {
    storage: {
      local: {
        get(_defaults, callback) {
          callback({ browserlinkDebugLoggingEnabled: false });
        }
      },
      session: {
        get: async () => ({}),
        set: async (value) => { sessionSets.push(value); }
      },
      onChanged: listeners()
    },
    runtime: {
      getContexts: async () => [],
      sendMessage: async (message) => {
        sentRuntimeMessages.push(message);
        if (message.action === 'offscreen:startHostScreencast') hostingStarted = true;
        return {};
      },
      onMessage: {
        // waitForPeerId() registers its listener only after the screencast has
        // started, so that registration is the cue to simulate the offscreen
        // document reporting its peer id.
        addListener(listener) {
          runtimeListeners.push(listener);
          if (peerReady && hostingStarted) {
            queueMicrotask(() => listener({ action: 'peerReady', peerId: 'peer-abc' }));
          }
        },
        removeListener(listener) {
          const i = runtimeListeners.indexOf(listener);
          if (i >= 0) runtimeListeners.splice(i, 1);
        }
      }
    },
    offscreen: {
      createDocument: async () => { offscreenCreated += 1; },
      closeDocument: async () => { offscreenClosed += 1; }
    },
    debugger: {
      sendCommand: async (target, method, params) => {
        debuggerCommands.push({ target, method, params });
        if (method === 'Page.getLayoutMetrics') {
          return { cssLayoutViewport: { clientWidth: 1024, clientHeight: 768 } };
        }
        return {};
      },
      onEvent: listeners(),
      onDetach: listeners(),
      attach: async () => {},
      detach: async (target) => { detaches.push(target); }
    },
    scripting: {
      executeScript: async ({ func }) => (typeof func === 'function' ? [{ result: 2 }] : [{ result: true }])
    },
    tabs: {
      get: async (tabId) => ({
        id: tabId, windowId: 7, width: 1024, height: 768,
        url: 'https://example.com/', title: 'Example'
      }),
      getZoom: async () => 1,
      setZoom: async () => {},
      update: async () => {},
      sendMessage: async () => {},
      query: async () => [],
      onActivated: listeners(),
      onUpdated: listeners(),
      onRemoved: listeners(),
      onCreated: listeners()
    },
    windows: {
      get: async () => ({ id: 7, width: 1400, height: 1000, state: 'normal' }),
      update: async () => {}
    }
  };

  const context = {
    chrome,
    console,
    clearTimeout,
    URL,
    fetch: async () => ({}),
    self: null,
    __BROWSERLINK_ENABLE_TEST_HOOKS__: true,
    setTimeout: (fn, delay, ...args) => {
      if (delay === PEER_TIMEOUT_MS) {
        if (hangHandshake) {
          peerTimeoutFn = () => fn(...args);
          armedResolve();
          return 0;
        }
        // Only fast-forward the handshake timer in the failure scenario.
        // waitForPeerId() arms this timer before registering its listener, so
        // firing it eagerly would beat the simulated peerReady in the happy path.
        if (!peerReady) {
          queueMicrotask(() => fn(...args));
          return 0;
        }
      }
      return setTimeout(fn, delay, ...args);
    }
  };
  context.self = context;
  vm.createContext(context);
  context.importScripts = (...paths) => {
    for (const scriptPath of paths) {
      vm.runInContext(readFileSync(join(repoRoot, scriptPath), 'utf8'), context, { filename: scriptPath });
    }
  };

  vm.runInContext(readFileSync(join(repoRoot, 'background.js'), 'utf8'), context, {
    filename: 'background.js'
  });

  return {
    context,
    debuggerCommands,
    sentRuntimeMessages,
    detaches,
    sessionSets,
    handshakeArmed,
    firePeerTimeout: () => peerTimeoutFn?.(),
    offscreen: {
      get closed() { return offscreenClosed; },
      get created() { return offscreenCreated; }
    }
  };
}

const methodsOf = (commands) => commands.map((c) => c.method);

describe('background start-failure cleanup', () => {
  it('reports an error when the peer handshake never completes', async () => {
    const { context } = loadBackground();
    await context.__browserlinkBackgroundTestHooks.ensureHostStateLoadedForTest();

    const result = await context.handleStartHostingCDP(42);

    expect(result.error).toBeTruthy();
    expect(result.peerId).toBeUndefined();
  });

  it('stops the screencast it already started', async () => {
    const { context, debuggerCommands } = loadBackground();
    await context.__browserlinkBackgroundTestHooks.ensureHostStateLoadedForTest();

    await context.handleStartHostingCDP(42);

    // Guard: the failure must happen AFTER startScreencast, or this test is
    // not exercising the leak Aria described.
    expect(methodsOf(debuggerCommands)).toContain('Page.startScreencast');
    expect(methodsOf(debuggerCommands)).toContain('Page.stopScreencast');
  });

  it('detaches the debugger from the captured tab', async () => {
    const { context, detaches } = loadBackground();
    await context.__browserlinkBackgroundTestHooks.ensureHostStateLoadedForTest();

    await context.handleStartHostingCDP(42);

    expect(detaches).toContainEqual({ tabId: 42 });
  });

  it('stops and closes the offscreen document', async () => {
    const { context, sentRuntimeMessages, offscreen } = loadBackground();
    await context.__browserlinkBackgroundTestHooks.ensureHostStateLoadedForTest();

    await context.handleStartHostingCDP(42);

    expect(offscreen.created).toBeGreaterThan(0);
    expect(sentRuntimeMessages.map((m) => m.action)).toContain('offscreen:stopHost');
    expect(offscreen.closed).toBeGreaterThan(0);
  });

  it('resets host state so the session is not left half-started', async () => {
    const { context } = loadBackground();
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    await context.handleStartHostingCDP(42);

    const state = hooks.getHostStateForTest();
    expect(state.hosting).toBe(false);
    expect(state.capturedTabId).toBeNull();
    expect(state.debuggerAttached).toBe(false);
    expect(state.peerId).toBeNull();
    expect(state.captureMode).toBeNull();
  });

  it('rejects a second start while the first is still in flight', async () => {
    const { context, handshakeArmed, firePeerTimeout } = loadBackground({ hangHandshake: true });
    await context.__browserlinkBackgroundTestHooks.ensureHostStateLoadedForTest();

    const first = context.handleStartHostingCDP(42);
    await handshakeArmed;

    const second = await context.handleStartHostingCDP(99);

    expect(second.error).toMatch(/in progress/i);

    // Let the parked first start finish so the test does not leave it pending.
    firePeerTimeout();
    await first.catch(() => {});
  });

  it('detaches the tab it actually attached, not a tab from a later start', async () => {
    const { context, handshakeArmed, firePeerTimeout, detaches } =
      loadBackground({ hangHandshake: true });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    const first = context.handleStartHostingCDP(42);
    await handshakeArmed;
    await context.handleStartHostingCDP(99);

    firePeerTimeout();
    await first.catch(() => {});

    expect(detaches).toContainEqual({ tabId: 42 });
    expect(detaches).not.toContainEqual({ tabId: 99 });
    expect(hooks.getHostStateForTest().capturedTabId).toBeNull();
  });

  it('still starts hosting normally when the peer handshake succeeds', async () => {
    const { context, debuggerCommands } = loadBackground({ peerReady: true });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    const result = await context.handleStartHostingCDP(42);

    expect(result.peerId).toBe('peer-abc');
    expect(result.captureMode).toBe('screencast');
    expect(methodsOf(debuggerCommands)).not.toContain('Page.stopScreencast');
    expect(hooks.getHostStateForTest().hosting).toBe(true);
  });
});
