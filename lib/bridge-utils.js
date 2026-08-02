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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VIEWER_BASE_URL_STORAGE_KEY: VIEWER_BASE_URL_STORAGE_KEY,
    normalizeViewerBaseUrl: normalizeViewerBaseUrl,
    buildViewerUrl: buildViewerUrl,
    pickDefaultSelectedTab: pickDefaultSelectedTab
  };
}
