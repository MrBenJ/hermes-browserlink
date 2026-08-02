import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Control events arrive over the WebRTC data channel, which anyone holding the
// Viewer URL can write to directly. These tests treat that channel as hostile
// input rather than as "whatever the viewer UI happens to send".
function loadBackground({ tabsByIdiUrl = {} } = {}) {
  const removed = [];
  const windowUpdates = [];
  const debuggerCommands = [];
  const updates = [];
  const sentToViewer = [];
  const listeners = () => ({ addListener() {}, removeListener() {} });

  const chrome = {
    storage: {
      local: { get(_d, cb) { cb({ browserlinkDebugLoggingEnabled: false }); } },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: listeners()
    },
    runtime: {
      getContexts: async () => [],
      sendMessage: async (message) => {
        if (message && message.action === 'offscreen:sendToViewer') {
          sentToViewer.push(message.message);
        }
        return {};
      },
      onMessage: listeners()
    },
    offscreen: { createDocument: async () => {}, closeDocument: async () => {} },
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
      detach: async () => {}
    },
    scripting: { executeScript: async () => [{ result: true }] },
    tabs: {
      get: async (tabId) => {
        const url = tabsByIdiUrl[tabId];
        if (!url) throw new Error(`No tab with id ${tabId}`);
        return { id: tabId, windowId: 7, width: 1024, height: 768, url, title: 'Tab' };
      },
      remove: async (tabId) => { removed.push(tabId); },
      update: async (tabId, info) => { updates.push({ tabId, info }); },
      query: async () => [],
      getZoom: async () => 1,
      setZoom: async () => {},
      sendMessage: async () => {},
      onActivated: listeners(),
      onUpdated: listeners(),
      onRemoved: listeners(),
      onCreated: listeners()
    },
    windows: {
      get: async () => ({ id: 7, width: 1200, height: 900, state: 'normal' }),
      update: async (windowId, info) => { windowUpdates.push({ windowId, info }); }
    }
  };

  const fetchCalls = [];
  const context = {
    chrome, console, setTimeout, clearTimeout,
    URL,
    fetch: async (...args) => { fetchCalls.push(args); return {}; },
    self: null,
    __BROWSERLINK_ENABLE_TEST_HOOKS__: true
  };
  context.self = context;
  vm.createContext(context);
  context.importScripts = (...paths) => {
    for (const p of paths) {
      vm.runInContext(readFileSync(join(repoRoot, p), 'utf8'), context, { filename: p });
    }
  };
  vm.runInContext(readFileSync(join(repoRoot, 'background.js'), 'utf8'), context, {
    filename: 'background.js'
  });
  context.__handleControlEvent = context.__browserlinkBackgroundTestHooks.handleControlEventForTest;

  return { context, removed, windowUpdates, debuggerCommands, fetchCalls, updates, sentToViewer };
}

const NORMAL = 11;
const EXTENSION_TAB = 12;
const CHROME_TAB = 13;

const TAB_URLS = {
  [NORMAL]: 'https://example.com/',
  [EXTENSION_TAB]: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/bridge.html',
  [CHROME_TAB]: 'chrome://settings'
};

describe('closeTab authorization', () => {
  it('closes a normal tab', async () => {
    const { context, removed } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    await hooks.closeTabForTest(NORMAL);

    expect(removed).toEqual([NORMAL]);
  });

  it('refuses to close an extension tab such as the BrowserLink bridge', async () => {
    const { context, removed } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    await hooks.closeTabForTest(EXTENSION_TAB);

    expect(removed).toEqual([]);
  });

  it('refuses to close a chrome:// tab', async () => {
    const { context, removed } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    await hooks.closeTabForTest(CHROME_TAB);

    expect(removed).toEqual([]);
  });

  it('ignores an unknown tab id instead of throwing', async () => {
    const { context, removed } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    await expect(hooks.closeTabForTest(999)).resolves.toBeUndefined();
    expect(removed).toEqual([]);
  });
});

describe('setViewport validation', () => {
  async function withHost() {
    const loaded = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = loaded.context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({ capturedTabId: NORMAL, debuggerAttached: true });
    return { ...loaded, hooks };
  }

  it('applies sane dimensions', async () => {
    const { hooks, debuggerCommands } = await withHost();

    await hooks.setHostViewportForTest(1280, 720);

    const override = debuggerCommands.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(override.params.width).toBe(1280);
    expect(override.params.height).toBe(720);
  });

  it('ignores NaN dimensions entirely', async () => {
    const { hooks, debuggerCommands, windowUpdates } = await withHost();

    await hooks.setHostViewportForTest(Number.NaN, 720);

    expect(debuggerCommands.some((c) => c.method === 'Emulation.setDeviceMetricsOverride')).toBe(false);
    expect(windowUpdates).toEqual([]);
  });

  it('clamps absurd dimensions rather than passing them to Chrome', async () => {
    const { hooks, debuggerCommands } = await withHost();

    await hooks.setHostViewportForTest(10_000_000, -50);

    const override = debuggerCommands.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(override.params.width).toBeLessThanOrEqual(8192);
    expect(override.params.height).toBeGreaterThan(0);
  });
});

describe('diagnostics stay local', () => {
  it('makes no outbound HTTP request when diagnostic events are recorded', async () => {
    const { context, fetchCalls } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    // Any control path that logs a diagnostic will do; a blocked close logs one.
    await hooks.closeTabForTest(EXTENSION_TAB);

    expect(fetchCalls).toEqual([]);
  });
});

describe('navigate scheme policy', () => {
  async function withHost() {
    const loaded = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = loaded.context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({ capturedTabId: NORMAL, debuggerAttached: true });
    return { ...loaded, hooks };
  }

  it('navigates to an ordinary https url', async () => {
    const { hooks, updates } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'https://example.org/x' });
    expect(updates).toContainEqual({ tabId: NORMAL, info: { url: 'https://example.org/x' } });
  });

  it('treats bare input as a hostname', async () => {
    const { hooks, updates } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'example.org' });
    expect(updates).toContainEqual({ tabId: NORMAL, info: { url: 'https://example.org' } });
  });

  it('refuses to navigate the hosted tab to chrome://', async () => {
    const { hooks, updates } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'chrome://settings' });
    expect(updates).toEqual([]);
  });

  it('refuses file:// and javascript: navigation', async () => {
    const { hooks, updates } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'file:///etc/passwd' });
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'javascript:alert(1)' });
    expect(updates).toEqual([]);
  });
});

describe('already-hosting guard', () => {
  it('refuses a duplicate start instead of tearing down the live share', async () => {
    const { context } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({
      hosting: true, peerId: 'peer-live', capturedTabId: NORMAL,
      debuggerAttached: true, debuggerAttachedTabId: NORMAL
    });

    const result = await context.handleStartHostingCDP(NORMAL);

    expect(result.error).toMatch(/already hosting/i);
    // The live session must be untouched.
    const state = hooks.getHostStateForTest();
    expect(state.hosting).toBe(true);
    expect(state.peerId).toBe('peer-live');
    expect(state.debuggerAttached).toBe(true);
  });
});

describe('tabChanged scheme policy', () => {
  // The accepted branch needs its own coverage: a helper that only ever
  // early-returns still passes every forbidden-tab assertion.
  it('sends exactly one tabChanged for an allowed web tab', async () => {
    const { context, sentToViewer } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({ hosting: true, viewerConnected: true, capturedTabId: NORMAL });
    sentToViewer.length = 0;

    hooks.sendTabChangedForTest({ id: NORMAL, url: TAB_URLS[NORMAL], title: 'Example' });

    const changed = sentToViewer.filter((m) => m.type === 'tabChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ tabId: NORMAL, url: TAB_URLS[NORMAL], title: 'Example' });
  });

  it('does not leak non-capturable tab urls to the viewer', async () => {
    const { context } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    expect(hooks.sendTabChangedForTest({ id: EXTENSION_TAB, url: TAB_URLS[EXTENSION_TAB], title: 'bridge' })).toBeUndefined();
    expect(hooks.sendTabChangedForTest({ id: CHROME_TAB, url: TAB_URLS[CHROME_TAB], title: 'settings' })).toBeUndefined();
    expect(hooks.sendTabChangedForTest({ id: 99, url: 'file:///etc/passwd', title: 'passwd' })).toBeUndefined();
  });
});
