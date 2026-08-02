'use strict';

// BrowserLink background (service worker) pure helpers.
// Loaded via importScripts() in background.js, and via CommonJS in Vitest.

const SCREENCAST_MAX_WIDTH = 3840;
const SCREENCAST_MAX_HEIGHT = 2160;
const OPENER_AUTO_FOLLOW_MAX_ATTEMPTS = 8;
const OPENER_AUTO_FOLLOW_MAX_PENDING_AGE_MS = 30 * 1000;

function getCaptureSize(width, height, devicePixelRatio = 1) {
  if (!width || !height) {
    return {
      width: SCREENCAST_MAX_WIDTH,
      height: SCREENCAST_MAX_HEIGHT
    };
  }

  const scaleFactor = Math.max(1, Number(devicePixelRatio) || 1);
  const targetWidth = Math.max(1, Math.round(width * scaleFactor));
  const targetHeight = Math.max(1, Math.round(height * scaleFactor));

  const scale = Math.min(
    1,
    SCREENCAST_MAX_WIDTH / targetWidth,
    SCREENCAST_MAX_HEIGHT / targetHeight
  );

  return {
    width: Math.max(1, Math.round(targetWidth * scale)),
    height: Math.max(1, Math.round(targetHeight * scale))
  };
}


// Allowlist, not denylist. A denylist of chrome://, chrome-extension://,
// edge:// and about: silently admitted every other non-web scheme —
// file://, devtools://, chrome-untrusted://, view-source:, chrome-search://,
// data:, blob: — all of which would then be listable, switchable and
// closeable by anyone holding a Viewer URL. Only ordinary web pages are
// capturable.
var CAPTURABLE_PROTOCOLS = ['http:', 'https:'];

// Private, loopback and link-local destinations are refused too. The Viewer
// URL is a bearer capability that can drive navigate/newTab/switchTab, so
// without this a link holder could use the agent's browser as an interactive
// client for http://127.0.0.1:*, router admin panels, RFC1918 LAN services or
// cloud metadata endpoints reachable from the host machine. Fail closed.
function isPrivateHostname(hostname) {
  if (!hostname) return true;
  var host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host === '0.0.0.0') return true;
  // IPv6 loopback and unspecified, plus unique-local (fc00::/7) and
  // link-local (fe80::/10).
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // Internal-ish names: bare hostnames with no dot, mDNS, and common
  // internal suffixes.
  if (host.indexOf('.') === -1) return true;
  if (/\.(local|internal|localdomain|home|lan)$/.test(host)) return true;

  var v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    var a = Number(v4[1]);
    var b = Number(v4[2]);
    if (a === 127 || a === 0 || a === 10) return true;             // loopback, this-network, RFC1918
    if (a === 192 && b === 168) return true;                        // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true;               // RFC1918
    if (a === 169 && b === 254) return true;                        // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;              // CGNAT
  }
  return false;
}

function isForbiddenTab(tab) {
  if (!tab || !tab.url) return true;
  var parsed;
  try {
    parsed = new URL(tab.url);
  } catch (e) {
    // Unparseable URL — treat as forbidden rather than guessing.
    return true;
  }
  if (CAPTURABLE_PROTOCOLS.indexOf(parsed.protocol.toLowerCase()) === -1) return true;
  return isPrivateHostname(parsed.hostname);
}


function createSwitchSerializer() {
  let tail = Promise.resolve();

  return function runSerializedSwitch({ beforeSwitch, switchFn, onCancelled } = {}) {
    if (typeof switchFn !== 'function') {
      return Promise.reject(new TypeError('switchFn is required'));
    }

    const run = tail.catch(() => {}).then(async () => {
      if (typeof beforeSwitch === 'function') {
        const allowed = await beforeSwitch();
        if (!allowed) {
          if (typeof onCancelled === 'function') await onCancelled();
          return false;
        }
      }

      const result = await switchFn();
      return result !== false;
    });

    tail = run.catch(() => {});
    return run;
  };
}

function isTransientOpenerAutoFollowTab(tab) {
  if (!tab || !tab.url) return true;
  if (tab.url === 'about:blank') return true;
  return false;
}

function getOpenerAutoFollowDecision(tab, pendingEntry, options = {}) {
  if (!pendingEntry) {
    return { action: 'ignore', reason: 'not-pending' };
  }
  if (!tab || tab.id !== pendingEntry.tabId) {
    return { action: 'cancel', reason: 'missing-tab' };
  }

  if (Object.prototype.hasOwnProperty.call(options, 'capturedTabId') &&
      pendingEntry.openerTabId !== options.capturedTabId) {
    return { action: 'cancel', reason: 'opener-no-longer-captured' };
  }

  if (!isForbiddenTab(tab)) {
    return { action: 'switch', reason: 'capturable' };
  }

  if (isTransientOpenerAutoFollowTab(tab)) {
    const maxAttempts = Number.isFinite(options.maxAttempts)
      ? options.maxAttempts
      : OPENER_AUTO_FOLLOW_MAX_ATTEMPTS;
    const maxPendingAgeMs = Number.isFinite(options.maxPendingAgeMs)
      ? options.maxPendingAgeMs
      : OPENER_AUTO_FOLLOW_MAX_PENDING_AGE_MS;
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const createdAt = Number.isFinite(pendingEntry.createdAt)
      ? pendingEntry.createdAt
      : null;

    if (createdAt === null && (pendingEntry.attempts || 0) >= maxAttempts) {
      return { action: 'cancel', reason: 'attempts-exhausted' };
    }
    if (createdAt !== null && now - createdAt > maxPendingAgeMs) {
      return { action: 'cancel', reason: 'max-age-exceeded' };
    }

    return { action: 'wait', reason: 'transient-uncapturable' };
  }

  return { action: 'cancel', reason: 'forbidden' };
}

function getViewerTabListQueryInfo() {
  return {};
}

function buildViewerTabList(tabs, capturedTabId) {
  return (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => !isForbiddenTab(tab))
    .map((tab) => ({
      id: tab.id,
      title: tab.title || '',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      active: tab.id === capturedTabId
    }));
}

// Viewport dimensions arrive over the data channel, which is a bearer-link
// protocol surface — a link holder can send anything, including NaN, zero,
// negatives or absurd sizes, and those flow straight into chrome.windows.update
// and Emulation.setDeviceMetricsOverride. Coerce to a finite integer and clamp
// to a range Chrome can actually honour; return null when there is no sane
// interpretation so the caller can ignore the request.
var VIEWPORT_MIN_DIMENSION = 200;
var VIEWPORT_MAX_DIMENSION = 8192;

function normalizeViewportDimension(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' || typeof value === 'boolean') return null;
  var num = Number(value);
  if (!Number.isFinite(num)) return null;
  var rounded = Math.round(num);
  if (rounded < VIEWPORT_MIN_DIMENSION) return VIEWPORT_MIN_DIMENSION;
  if (rounded > VIEWPORT_MAX_DIMENSION) return VIEWPORT_MAX_DIMENSION;
  return rounded;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildViewerTabList,
    createSwitchSerializer,
    getCaptureSize,
    getOpenerAutoFollowDecision,
    getViewerTabListQueryInfo,
    isForbiddenTab,
    isPrivateHostname,
    CAPTURABLE_PROTOCOLS,
    normalizeViewportDimension,
    VIEWPORT_MIN_DIMENSION,
    VIEWPORT_MAX_DIMENSION,
    OPENER_AUTO_FOLLOW_MAX_ATTEMPTS,
    OPENER_AUTO_FOLLOW_MAX_PENDING_AGE_MS,
    SCREENCAST_MAX_WIDTH,
    SCREENCAST_MAX_HEIGHT
  };
}
