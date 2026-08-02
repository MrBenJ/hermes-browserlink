'use strict';

// LobsterLink viewer pure helpers.
// Classic-script-compatible: defined at script scope so viewer.html ->
// viewer.js picks them up as globals, and exported via CommonJS for Vitest.

function diffMobileKeyboardText(previousText, nextText) {
  const prevLen = previousText.length;
  const nextLen = nextText.length;
  let prefix = 0;
  const maxPrefix = Math.min(prevLen, nextLen);
  while (prefix < maxPrefix && previousText.charCodeAt(prefix) === nextText.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  const maxSuffix = Math.min(prevLen - prefix, nextLen - prefix);
  while (
    suffix < maxSuffix &&
    previousText.charCodeAt(prevLen - 1 - suffix) === nextText.charCodeAt(nextLen - 1 - suffix)
  ) {
    suffix++;
  }
  const removedText = previousText.slice(prefix, prevLen - suffix);
  const insertedText = nextText.slice(prefix, nextLen - suffix);
  return { removedText, insertedText };
}


function fingerprintMobilePasteText(text) {
  // FNV-1a over UTF-16 code units. The state keeps only this fingerprint so
  // sensitive paste text is not retained after deciding the send action.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return String(text.length) + ':' + (hash >>> 0).toString(16);
}

function createMobilePasteForwardState() {
  return { lastForwardedPasteFingerprint: '' };
}

function resetMobilePasteForwardState() {
  return createMobilePasteForwardState();
}

function getMobilePasteButtonState(isConnected) {
  return isConnected
    ? { disabled: false, title: 'Paste to remote' }
    : { disabled: true, title: 'Connect to a remote browser before pasting' };
}

function evaluateMobilePasteForward(state, nextText) {
  const text = typeof nextText === 'string' ? nextText : '';
  const currentState = state || createMobilePasteForwardState();

  if (text.length === 0) {
    return { state: currentState, sendAction: null };
  }

  const fingerprint = fingerprintMobilePasteText(text);
  if (currentState.lastForwardedPasteFingerprint === fingerprint) {
    return { state: currentState, sendAction: null };
  }

  return {
    state: { lastForwardedPasteFingerprint: fingerprint },
    sendAction: { type: 'clipboard', action: 'pasteText', text }
  };
}

function evaluateMobilePasteTargetInput(state, nextText, canForward) {
  const text = typeof nextText === 'string' ? nextText : '';
  const currentState = state || createMobilePasteForwardState();

  if (text.length === 0) {
    return {
      state: currentState,
      sendAction: null,
      shouldClearLocalText: false,
      shouldCloseSheet: false
    };
  }

  if (!canForward) {
    return {
      state: currentState,
      sendAction: null,
      shouldClearLocalText: true,
      shouldCloseSheet: false
    };
  }

  const forwardResult = evaluateMobilePasteForward(currentState, text);
  return {
    state: forwardResult.state,
    sendAction: forwardResult.sendAction,
    shouldClearLocalText: true,
    shouldCloseSheet: Boolean(forwardResult.sendAction)
  };
}

function evaluateMobilePasteTargetPaste(state, nextText, canForward) {
  const text = typeof nextText === 'string' ? nextText : '';
  const currentState = state || createMobilePasteForwardState();

  if (text.length === 0) {
    return {
      state: currentState,
      sendAction: null,
      shouldPreventDefault: false,
      shouldStopPropagation: false,
      shouldClearLocalText: false,
      shouldCloseSheet: false
    };
  }

  if (!canForward) {
    return {
      state: currentState,
      sendAction: null,
      shouldPreventDefault: true,
      shouldStopPropagation: true,
      shouldClearLocalText: true,
      shouldCloseSheet: false
    };
  }

  const forwardResult = evaluateMobilePasteForward(currentState, text);
  return {
    state: forwardResult.state,
    sendAction: forwardResult.sendAction,
    shouldPreventDefault: true,
    shouldStopPropagation: true,
    shouldClearLocalText: true,
    shouldCloseSheet: Boolean(forwardResult.sendAction)
  };
}

function parseViewerArgs(search, hash) {
  const queryText = String(search || '').replace(/^\?/, '');
  const hashText = String(hash || '').replace(/^#\??/, '');
  const queryParams = new URLSearchParams(queryText);
  const hashParams = new URLSearchParams(hashText);
  const params = new URLSearchParams(queryParams);

  hashParams.forEach((value, key) => {
    params.set(key, value);
  });

  return {
    hostPeerId: params.get('host') || '',
    debugEnabled: params.get('debug') === 'true'
  };
}


function getHostStoppedMessage(reason) {
  return reason === 'timeout'
    ? 'Share timed out. Ask the agent to start a new share.'
    : 'Share ended. Ask the agent to start a new share.';
}

function applyHostStoppedState(state = {}, reason) {
  return {
    ...state,
    connectedPeerId: null,
    reconnectAttempts: 0,
    shouldClearReconnectTimer: true,
    shouldReconnect: false,
    overlayHidden: false,
    overlayMessage: getHostStoppedMessage(reason),
    overlayError: '',
    statusText: reason === 'timeout' ? 'Share timed out' : 'Share ended',
    statusClass: 'error'
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    applyHostStoppedState,
    createMobilePasteForwardState,
    diffMobileKeyboardText,
    evaluateMobilePasteForward,
    evaluateMobilePasteTargetInput,
    evaluateMobilePasteTargetPaste,
    getHostStoppedMessage,
    getMobilePasteButtonState,
    parseViewerArgs,
    resetMobilePasteForwardState
  };
}
