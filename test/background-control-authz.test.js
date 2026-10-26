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
// Public answers for the names the tests navigate to. Anything else is
// NXDOMAIN unless a test supplies its own answers.
const DEFAULT_DNS = {
  'example.com': ['93.184.215.14'],
  'example.org': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'example.net': ['93.184.215.14'],
  '127.0.0.1.nip.io': ['127.0.0.1'],
  'mixed.example': ['93.184.215.14', '10.0.0.7']
};

function dnsJsonResponse(addresses) {
  if (!addresses) return { Status: 3 };
  return {
    Status: 0,
    Answer: addresses.map((data) => ({ type: data.includes(':') ? 28 : 1, data }))
  };
}

function loadBackground({ tabsByIdiUrl = {}, queryTabs = [], dns = DEFAULT_DNS, fetchImpl = null } = {}) {
  const removed = [];
  const windowUpdates = [];
  const debuggerCommands = [];
  const updates = [];
  const sentToViewer = [];
  const created = [];
  const listeners = () => ({ addListener() {}, removeListener() {} });
  const runtimeListeners = new Set();
  const debuggerEventListeners = [];
  const emitDebuggerEvent = (source, method, params) => {
    for (const listener of debuggerEventListeners) listener(source, method, params);
  };

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
        // Stand in for the offscreen document: once hosting starts it reports
        // a fresh peer id, which is what lets a share start complete.
        if (message && message.action === 'offscreen:startHostScreencast') {
          setTimeout(() => {
            for (const listener of [...runtimeListeners]) listener({ action: 'peerReady', peerId: 'peer-new' });
          }, 0);
        }
        return {};
      },
      onMessage: {
        addListener(listener) { runtimeListeners.add(listener); },
        removeListener(listener) { runtimeListeners.delete(listener); }
      }
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
      onEvent: {
        addListener(listener) { debuggerEventListeners.push(listener); },
        removeListener() {}
      },
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
      create: async (props) => { created.push(props); return { id: 500, ...props }; },
      update: async (tabId, info) => { updates.push({ tabId, info }); },
      query: async () => queryTabs,
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
  const defaultFetch = async (url) => {
    const parsed = new URL(url);
    const name = parsed.searchParams.get('name');
    const type = parsed.searchParams.get('type');
    const all = Object.prototype.hasOwnProperty.call(dns, name) ? dns[name] : null;
    const addresses = all && all.filter((ip) => (type === 'AAAA') === ip.includes(':'));
    return { ok: true, json: async () => dnsJsonResponse(addresses) };
  };
  const context = {
    chrome, console, setTimeout, clearTimeout,
    URL, AbortController,
    fetch: async (...args) => { fetchCalls.push(args); return (fetchImpl || defaultFetch)(...args); },
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

  return { context, removed, windowUpdates, debuggerCommands, fetchCalls, updates, sentToViewer, created, emitDebuggerEvent };
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

describe('newTab scheme and network policy', () => {
  async function withHost() {
    const loaded = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = loaded.context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    return { ...loaded, hooks };
  }

  it('opens an ordinary public url', async () => {
    const { hooks, created } = await withHost();
    await hooks.createNewTabForTest('https://example.org/x');
    expect(created).toContainEqual({ url: 'https://example.org/x' });
  });

  it('treats bare input as a hostname', async () => {
    const { hooks, created } = await withHost();
    await hooks.createNewTabForTest('example.org');
    expect(created).toContainEqual({ url: 'https://example.org' });
  });

  it('refuses loopback, private and link-local targets', async () => {
    const { hooks, created } = await withHost();
    for (const url of [
      'http://127.0.0.1:8787/log',
      'http://localhost:3000',
      'http://192.168.1.1/admin',
      'http://10.0.0.5',
      'http://169.254.169.254/latest/meta-data'
    ]) {
      await hooks.createNewTabForTest(url);
    }
    expect(created).toEqual([]);
  });

  it('refuses non-web schemes', async () => {
    const { hooks, created } = await withHost();
    await hooks.createNewTabForTest('file:///etc/passwd');
    await hooks.createNewTabForTest('chrome://settings');
    expect(created).toEqual([]);
  });
});

describe('captured tab navigating to a forbidden URL', () => {
  it('stops hosting when the captured tab lands on a private address', async () => {
    const { context } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({
      hosting: true, viewerConnected: true, capturedTabId: NORMAL,
      debuggerAttached: true, debuggerAttachedTabId: NORMAL
    });

    // A public URL the viewer requested has redirected to loopback.
    await hooks.onTabUpdatedForTest(
      NORMAL,
      { status: 'complete', url: 'http://127.0.0.1:8787/admin' },
      { id: NORMAL, url: 'http://127.0.0.1:8787/admin', title: 'local' }
    );

    expect(hooks.getHostStateForTest().hosting).toBe(false);
  });

  it('keeps hosting when the captured tab lands on an allowed URL', async () => {
    const { context } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({
      hosting: true, viewerConnected: true, capturedTabId: NORMAL,
      debuggerAttached: true, debuggerAttachedTabId: NORMAL
    });

    await hooks.onTabUpdatedForTest(
      NORMAL,
      { status: 'complete', url: 'https://example.com/next' },
      { id: NORMAL, url: 'https://example.com/next', title: 'ok' }
    );

    expect(hooks.getHostStateForTest().hosting).toBe(true);
  });
});

describe('focusTab authorization', () => {
  async function withHost() {
    const loaded = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = loaded.context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({ hosting: true, capturedTabId: NORMAL, debuggerAttached: true });
    return { ...loaded, hooks };
  }

  it('refuses to focus an extension or chrome tab', async () => {
    const { hooks, windowUpdates } = await withHost();
    await hooks.handleControlEventForTest({ type: 'focusTab', tabId: EXTENSION_TAB });
    await hooks.handleControlEventForTest({ type: 'focusTab', tabId: CHROME_TAB });
    expect(windowUpdates).toEqual([]);
  });

  it('still focuses the captured tab', async () => {
    const { hooks } = await withHost();
    await expect(
      hooks.handleControlEventForTest({ type: 'focusTab', tabId: NORMAL })
    ).resolves.toBeUndefined();
  });
});

describe('Last Error across shares', () => {
  it('clears the previous share\'s error when a new share starts', async () => {
    const { context } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    // An earlier share left an error behind (a blocked close logs one).
    await hooks.closeTabForTest(EXTENSION_TAB);
    expect(hooks.getDiagnosticsForTest().lastError).not.toBeNull();

    const result = await context.handleStartHostingCDP(NORMAL);

    expect(result.peerId).toBe('peer-new');
    expect(hooks.getDiagnosticsForTest().lastError).toBeNull();
  });
});

describe('captured tab closed', () => {
  async function hostingWith(queryTabs) {
    const loaded = loadBackground({ tabsByIdiUrl: TAB_URLS, queryTabs });
    const hooks = loaded.context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({
      hosting: true, peerId: 'peer-live', viewerConnected: true,
      capturedTabId: 21, debuggerAttached: true, debuggerAttachedTabId: 21
    });
    return { ...loaded, hooks };
  }

  it('enters a clean no-tab state when nothing capturable remains', async () => {
    const { hooks, sentToViewer } = await hostingWith([
      { id: 22, windowId: 7, active: true, url: 'http://127.0.0.1:8787/' }
    ]);

    await hooks.onTabRemovedForTest(21, { windowId: 7 });

    const state = hooks.getHostStateForTest();
    expect(state.hosting).toBe(true);
    expect(state.capturedTabId).toBeNull();
    expect(state.debuggerAttached).toBe(false);
    const statuses = sentToViewer.filter((m) => m.type === 'status');
    expect(statuses.at(-1)).toEqual({ type: 'status', capturing: false, tabId: null, reason: 'no_capturable_tab' });
  });

  it('moves the share to another capturable tab when one exists', async () => {
    const { hooks, sentToViewer } = await hostingWith([
      { id: NORMAL, windowId: 7, active: true, url: TAB_URLS[NORMAL] }
    ]);

    await hooks.onTabRemovedForTest(21, { windowId: 7 });

    expect(hooks.getHostStateForTest().capturedTabId).toBe(NORMAL);
    expect(sentToViewer.filter((m) => m.type === 'status').at(-1))
      .toEqual({ type: 'status', capturing: true, tabId: NORMAL });
  });

  it('cleans up even when no viewer is connected', async () => {
    const { hooks } = await hostingWith([]);
    hooks.setHostStateForTest({ viewerConnected: false });

    await hooks.onTabRemovedForTest(21, { windowId: 7 });

    expect(hooks.getHostStateForTest().capturedTabId).toBeNull();
  });
});

describe('resolved-address check before navigate and newTab', () => {
  async function withHost(options = {}) {
    const loaded = loadBackground({ tabsByIdiUrl: TAB_URLS, ...options });
    const hooks = loaded.context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({ hosting: true, capturedTabId: NORMAL, debuggerAttached: true });
    return { ...loaded, hooks };
  }

  it('refuses a public name that resolves to loopback', async () => {
    const { hooks, updates, created } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'http://127.0.0.1.nip.io:8787/x' });
    await hooks.createNewTabForTest('http://127.0.0.1.nip.io:8787/x');
    expect(updates).toEqual([]);
    expect(created).toEqual([]);
    expect(hooks.getDiagnosticsForTest().lastError.event).toBe('new_tab_blocked');
    expect(hooks.getDiagnosticsForTest().lastError.details.reason).toBe('private_address');
  });

  it('refuses a name with any private address among its answers', async () => {
    const { hooks, updates } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'https://mixed.example/' });
    expect(updates).toEqual([]);
  });

  it('fails closed when the name does not resolve', async () => {
    const { hooks, updates } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'https://nxdomain.example/' });
    expect(updates).toEqual([]);
  });

  it('fails closed when the resolver is unreachable', async () => {
    const { hooks, updates, created } = await withHost({
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); }
    });
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'https://example.org/' });
    await hooks.createNewTabForTest('https://example.org/');
    expect(updates).toEqual([]);
    expect(created).toEqual([]);
  });

  it('fails closed when the resolver answers with an HTTP error', async () => {
    const { hooks, updates } = await withHost({
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) })
    });
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'https://example.org/' });
    expect(updates).toEqual([]);
  });

  it('still allows public names, checking both A and AAAA', async () => {
    const { hooks, updates, fetchCalls } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'https://example.org/x' });
    expect(updates).toContainEqual({ tabId: NORMAL, info: { url: 'https://example.org/x' } });
    const types = fetchCalls.map(([url]) => new URL(url).searchParams.get('type')).sort();
    expect(types).toEqual(['A', 'AAAA']);
  });

  it('sends only the hostname to the resolver, without credentials', async () => {
    const { hooks, fetchCalls } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'https://example.org/private/path?q=secret' });
    for (const [url, init] of fetchCalls) {
      expect(url).not.toContain('secret');
      expect(url).not.toContain('private');
      expect(init.credentials).toBe('omit');
    }
  });

  it('does not resolve IP literals, which the hostname policy already classifies', async () => {
    const { hooks, updates, fetchCalls } = await withHost();
    await hooks.handleControlEventForTest({ type: 'navigate', url: 'http://[::ffff:127.0.0.1]/' });
    expect(updates).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  it('refuses to switch to a tab whose host resolves privately', async () => {
    const REBOUND = 31;
    const { hooks } = await withHost({
      tabsByIdiUrl: { ...TAB_URLS, [REBOUND]: 'http://127.0.0.1.nip.io:8787/' }
    });
    await hooks.handleControlEventForTest({ type: 'switchTab', tabId: REBOUND });
    expect(hooks.getHostStateForTest().capturedTabId).toBe(NORMAL);
  });
});

describe('connected-address check after navigation commits', () => {
  async function hosting() {
    const loaded = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = loaded.context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();
    hooks.setHostStateForTest({
      hosting: true, viewerConnected: true, peerId: 'peer-live', capturedTabId: NORMAL,
      debuggerAttached: true, debuggerAttachedTabId: NORMAL
    });
    return { ...loaded, hooks };
  }

  const documentResponse = (remoteIPAddress) => ({
    type: 'Document',
    frameId: 'main',
    response: { url: 'https://rebind.example/', remoteIPAddress }
  });

  it('stops hosting when the document came from a private address (DNS rebinding)', async () => {
    const { hooks, emitDebuggerEvent, debuggerCommands } = await hosting();

    emitDebuggerEvent({ tabId: NORMAL }, 'Network.responseReceived', documentResponse('127.0.0.1'));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(hooks.getHostStateForTest().hosting).toBe(false);
    expect(debuggerCommands.some((c) => c.method === 'Page.stopScreencast')).toBe(true);
    expect(hooks.getDiagnosticsForTest().logs.some((l) => l.event === 'private_address_blocked')).toBe(true);
  });

  it('drops screencast frames from the moment a private address is seen', async () => {
    const { emitDebuggerEvent, debuggerCommands } = await hosting();

    emitDebuggerEvent({ tabId: NORMAL }, 'Network.responseReceived', documentResponse('10.0.0.1'));
    const acksBefore = debuggerCommands.filter((c) => c.method === 'Page.screencastFrameAck').length;
    emitDebuggerEvent({ tabId: NORMAL }, 'Page.screencastFrame', { data: 'AAAA', sessionId: 1, metadata: {} });

    expect(debuggerCommands.filter((c) => c.method === 'Page.screencastFrameAck').length).toBe(acksBefore);
  });

  it('keeps hosting for a document from a public address', async () => {
    const { hooks, emitDebuggerEvent } = await hosting();

    emitDebuggerEvent({ tabId: NORMAL }, 'Network.responseReceived', documentResponse('93.184.215.14'));
    await new Promise((r) => setTimeout(r, 0));

    expect(hooks.getHostStateForTest().hosting).toBe(true);
  });

  it('ignores responses from tabs other than the captured one', async () => {
    const { hooks, emitDebuggerEvent } = await hosting();

    emitDebuggerEvent({ tabId: 99 }, 'Network.responseReceived', documentResponse('127.0.0.1'));
    await new Promise((r) => setTimeout(r, 0));

    expect(hooks.getHostStateForTest().hosting).toBe(true);
  });

  it('enables the Network domain whenever the debugger attaches', async () => {
    const { context, debuggerCommands } = loadBackground({ tabsByIdiUrl: TAB_URLS });
    const hooks = context.__browserlinkBackgroundTestHooks;
    await hooks.ensureHostStateLoadedForTest();

    await context.handleStartHostingCDP(NORMAL);

    expect(debuggerCommands.some((c) => c.method === 'Network.enable' && c.target.tabId === NORMAL)).toBe(true);
  });
});
