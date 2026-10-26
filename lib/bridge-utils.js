'use strict';

// BrowserLink bridge pure helpers.
// Classic-script-compatible: defines functions at script scope so the
// extension (bridge.html -> bridge.js) can pick them up as globals, and
// exports via CommonJS so Vitest can import them in Node.

var VIEWER_BASE_URL_STORAGE_KEY = 'browserlinkViewerBaseUrl';

function normalizeViewerBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  var trimmed = String(baseUrl).trim();
  if (!trimmed) return '';
  return trimmed.replace(/#.*$/, '');
}

function buildViewerUrl(peerId, baseUrl) {
  if (!peerId) return '';
  var base = normalizeViewerBaseUrl(baseUrl);
  if (!base) return '';
  return base + '#host=' + encodeURIComponent(peerId);
}

function pickDefaultSelectedTab(state) {
  var tabs = state && state.tabs;
  if (!tabs || !tabs.length) return null;
  var capturedTabId = state.status && state.status.capturedTabId;
  if (capturedTabId && tabs.some(function (tab) { return tab.id === capturedTabId; })) {
    return capturedTabId;
  }
  var active = tabs.find(function (tab) { return tab.active; });
  return active ? active.id : tabs[0].id;
}

// Peer id the bridge's Viewer URL is built from. The active host's id always
// wins: after Stop -> Start the "Peer ID to Connect" field can still hold the
// previous session's id, and preferring it handed out a dead link.
function pickViewerUrlPeerId(hostPeerId, typedPeerId) {
  if (hostPeerId) return String(hostPeerId);
  return String(typedPeerId || '').trim();
}

// Keep the "Peer ID to Connect" field in step with the host while it still
// holds the value the bridge filled in, so a restarted host does not leave
// the old id behind. Anything the operator typed is left alone.
function syncConnectPeerIdInput(input) {
  var value = String((input && input.value) || '').trim();
  var lastAutoFilled = (input && input.lastAutoFilled) || '';
  var hostPeerId = (input && input.hostPeerId) || '';
  if (value && value !== lastAutoFilled) {
    return { value: value, lastAutoFilled: lastAutoFilled };
  }
  return { value: hostPeerId, lastAutoFilled: hostPeerId };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VIEWER_BASE_URL_STORAGE_KEY: VIEWER_BASE_URL_STORAGE_KEY,
    normalizeViewerBaseUrl: normalizeViewerBaseUrl,
    buildViewerUrl: buildViewerUrl,
    pickDefaultSelectedTab: pickDefaultSelectedTab,
    pickViewerUrlPeerId: pickViewerUrlPeerId,
    syncConnectPeerIdInput: syncConnectPeerIdInput
  };
}
