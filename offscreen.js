// Offscreen document — holds PeerJS peer + MediaStream for host mode.
// MediaStream is sourced from a canvas fed by CDP screencast JPEG frames.

let peer = null;
let mediaStream = null;
let currentCall = null;
let dataConnection = null;

// Debug-gated console helpers — silent unless debugLogging is true.
// chrome.storage is not available in the offscreen document, so this is a
// simple local default; flip to true here when debugging.
const debugLogging = false;
const _log = console.log.bind(console);
const _warn = console.warn.bind(console);
const _error = console.error.bind(console);
function log(...args) { if (debugLogging) _log(...args); }
function warn(...args) { if (debugLogging) _warn(...args); }
function error(...args) { if (debugLogging) _error(...args); }

// Screencast canvas state
let screencastCanvas = null;
let screencastCtx = null;
let lastFrameData = null; // stores last base64 JPEG for redraw on viewer connect
let frameTickerInterval = null;
let frameTickerFlip = false;
let screencastViewport = { width: 1920, height: 1080 };

const FRAME_ASPECT_RATIO_TOLERANCE = 0.01;

const INPUT_TYPES = new Set(['mouse', 'key', 'clipboard']);

function configureOutgoingTrack(track) {
  if (!track) return;
  try {
    track.contentHint = 'detail';
  } catch (e) {}
}

async function tuneCurrentVideoSender() {
  if (!currentCall?.peerConnection) return;
  const senders = currentCall.peerConnection.getSenders();
  const videoSender = senders.find((sender) => sender.track && sender.track.kind === 'video');
  if (!videoSender) return;

  try {
    const params = videoSender.getParameters ? videoSender.getParameters() : {};
    const encodings = (params.encodings && params.encodings.length)
      ? params.encodings
      : [{}];

    for (const encoding of encodings) {
      encoding.maxBitrate = Math.max(encoding.maxBitrate || 0, 12_000_000);
      encoding.maxFramerate = 15;
      encoding.scaleResolutionDownBy = 1;
    }

    params.encodings = encodings;
    params.degradationPreference = 'maintain-resolution';

    await videoSender.setParameters(params);
    log('[BROWSERLINK:offscreen] Tuned outbound video sender for detail/resolution');
  } catch (e) {
    warn('[BROWSERLINK:offscreen] Failed to tune outbound sender:', e.message || e);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'offscreen:startHostScreencast') {
    startHostScreencast(msg.width, msg.height, msg.viewportWidth, msg.viewportHeight);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'offscreen:screencastFrame') {
    drawScreencastFrame(msg.data, msg.metadata);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'offscreen:screencastResize') {
    resizeScreencastCanvas(msg.width, msg.height, msg.viewportWidth, msg.viewportHeight);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'offscreen:stopHost') {
    stopHost(msg.reason);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'offscreen:sendToViewer') {
    sendToViewer(msg.message);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

function normalizeHostStoppedReason(reason) {
  return reason === 'timeout' ? 'timeout' : 'manual';
}

function notifyViewerHostStopped(reason) {
  if (!dataConnection || !dataConnection.open) return;
  try {
    dataConnection.send(JSON.stringify({
      type: 'hostStopped',
      reason: normalizeHostStoppedReason(reason)
    }));
  } catch (e) {
    warn('[BROWSERLINK:offscreen] Failed to notify viewer that host stopped:', e);
  }
}

function sendToViewer(message) {
  if (!dataConnection) {
    warn('[BROWSERLINK:offscreen] sendToViewer: no data connection');
    return;
  }
  try {
    dataConnection.send(JSON.stringify(message));
  } catch (e) {
    error('[BROWSERLINK:offscreen] Failed to send to viewer:', e);
  }
}

// --- PeerJS setup ---

function setupPeer() {
  peer = new Peer();

  peer.on('open', (id) => {
    log('[BROWSERLINK:offscreen] Peer ready, id:', id);
    chrome.runtime.sendMessage({ action: 'peerReady', peerId: id });
  });

  peer.on('call', (call) => {
    log('[BROWSERLINK:offscreen] Incoming media call from viewer');
    currentCall = call;
    const track = mediaStream ? mediaStream.getVideoTracks()[0] : null;
    configureOutgoingTrack(track);
    call.answer(mediaStream);
    setTimeout(() => {
      tuneCurrentVideoSender().catch(() => {});
    }, 0);

    // Redraw the last frame and start a ticker to force continuous canvas
    // invalidation so captureStream(15) emits encoded keyframes even on
    // static pages.
    if (lastFrameData && screencastCtx) {
      log('[BROWSERLINK:offscreen] Redrawing last stored frame for new viewer');
      const img = new Image();
      img.onload = () => {
        drawFramePreservingAspect(img);
      };
      img.src = 'data:image/jpeg;base64,' + lastFrameData;
    }
    startFrameTicker();

    call.on('close', () => {
      log('[BROWSERLINK:offscreen] Media call closed');
      stopFrameTicker();
      currentCall = null;
    });

    call.on('error', (err) => {
      error('[BROWSERLINK:offscreen] Media call error:', err);
    });
  });

  peer.on('connection', (conn) => {
    log('[BROWSERLINK:offscreen] Data connection from viewer (waiting for open)');

    // Single-viewer ownership. Hosting is a one-viewer session, so a new
    // connection supersedes the previous one. Close the old connection and
    // fence every handler on `conn === dataConnection`, otherwise a stale
    // peer-ID holder keeps forwarding input and control events — and this
    // extension drives the hosted tab through chrome.debugger, so that is
    // privileged control, not just a duplicate video feed.
    const previous = dataConnection;
    dataConnection = conn;
    if (previous && previous !== conn) {
      log('[BROWSERLINK:offscreen] Superseding previous viewer connection');
      try {
        previous.close();
      } catch (e) {
        warn('[BROWSERLINK:offscreen] Failed to close superseded connection:', e.message || e);
      }
    }

    conn.on('open', () => {
      if (conn !== dataConnection) {
        log('[BROWSERLINK:offscreen] Ignoring open from superseded connection');
        return;
      }
      log('[BROWSERLINK:offscreen] Data channel open, notifying background');
      sendToViewer({ type: 'hostMode', mode: 'screencast' });
      sendViewportInfo();
      // Notify background AFTER channel is open so sendToViewer works immediately
      chrome.runtime.sendMessage({ action: 'viewerConnected' });
    });

    conn.on('data', (data) => {
      if (conn !== dataConnection) {
        warn('[BROWSERLINK:offscreen] Dropping data from superseded connection');
        return;
      }
      const evt = typeof data === 'string' ? JSON.parse(data) : data;

      if (INPUT_TYPES.has(evt.type)) {
        if (evt.type !== 'mouse' || evt.action !== 'move') {
          log('[BROWSERLINK:offscreen] Forwarding input:', evt.type, evt.action,
            evt.type === 'mouse' ? `(${evt.x},${evt.y})` : evt.key);
        }
        chrome.runtime.sendMessage({ action: 'inputEvent', event: evt });
      } else {
        log('[BROWSERLINK:offscreen] Forwarding control:', evt.type);
        chrome.runtime.sendMessage({ action: 'controlEvent', event: evt });
      }
    });

    conn.on('close', () => {
      if (conn !== dataConnection) {
        log('[BROWSERLINK:offscreen] Superseded connection closed; active viewer unaffected');
        return;
      }
      log('[BROWSERLINK:offscreen] Data connection closed');
      dataConnection = null;
      chrome.runtime.sendMessage({ action: 'viewerDisconnected' });
    });

    conn.on('error', (err) => {
      error('[BROWSERLINK:offscreen] Data connection error:', err);
    });
  });

  peer.on('error', (err) => {
    error('[BROWSERLINK:offscreen] Peer error:', err);
  });

  peer.on('disconnected', () => {
    log('[BROWSERLINK:offscreen] Peer disconnected from signaling, reconnecting...');
    if (peer && !peer.destroyed) {
      peer.reconnect();
    }
  });
}

function sendViewportInfo() {
  if (!screencastCanvas) return;
  log('[BROWSERLINK:offscreen] Sending viewport:',
    screencastViewport.width, 'x', screencastViewport.height,
    '| canvas:', screencastCanvas.width, 'x', screencastCanvas.height);
  sendToViewer({
    type: 'viewport',
    width: screencastViewport.width,
    height: screencastViewport.height
  });
}

function getScreencastFrameDrawRect(frameWidth, frameHeight, canvasWidth, canvasHeight) {
  const fullCanvas = { x: 0, y: 0, width: canvasWidth, height: canvasHeight, letterboxed: false };
  if (!frameWidth || !frameHeight || !canvasWidth || !canvasHeight) return fullCanvas;

  const frameAspect = frameWidth / frameHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  if (Math.abs(frameAspect - canvasAspect) <= FRAME_ASPECT_RATIO_TOLERANCE) return fullCanvas;

  return null;
}

function drawFramePreservingAspect(img) {
  const drawRect = getScreencastFrameDrawRect(
    img.width,
    img.height,
    screencastCanvas.width,
    screencastCanvas.height
  );

  if (!drawRect) {
    warn('[BROWSERLINK:offscreen] Dropping mismatched frame aspect:',
      img.width, 'x', img.height,
      '| canvas:', screencastCanvas.width, 'x', screencastCanvas.height);
    return false;
  }

  screencastCtx.drawImage(img, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
  return true;
}

// --- Screencast canvas mode ---

function startHostScreencast(width, height, viewportWidth = width, viewportHeight = height) {
  screencastViewport.width = viewportWidth || width;
  screencastViewport.height = viewportHeight || height;
  log('[BROWSERLINK:offscreen] Starting host (screencast), canvas:', width, 'x', height,
    '| viewport:', screencastViewport.width, 'x', screencastViewport.height);

  // Create canvas for rendering JPEG frames
  screencastCanvas = document.createElement('canvas');
  screencastCanvas.width = width;
  screencastCanvas.height = height;
  screencastCtx = screencastCanvas.getContext('2d');

  // Fill with black initially
  screencastCtx.fillStyle = '#000';
  screencastCtx.fillRect(0, 0, width, height);

  // Get MediaStream from canvas — 0 means frames are captured on
  // requestAnimationFrame / when the canvas is painted
  mediaStream = screencastCanvas.captureStream(15);
  configureOutgoingTrack(mediaStream.getVideoTracks()[0]);

  log('[BROWSERLINK:offscreen] Canvas MediaStream created, tracks:', mediaStream.getTracks().length);
  setupPeer();
}

let frameDrawCount = 0;

function drawScreencastFrame(base64Data, metadata) {
  if (!screencastCtx || !screencastCanvas) {
    warn('[BROWSERLINK:offscreen] Frame dropped: no canvas/ctx');
    return;
  }
  if (!base64Data) {
    warn('[BROWSERLINK:offscreen] Frame dropped: no data');
    return;
  }

  frameDrawCount++;
  if (frameDrawCount <= 3 || frameDrawCount % 30 === 0) {
    log('[BROWSERLINK:offscreen] drawScreencastFrame #' + frameDrawCount,
      '| data length:', base64Data.length,
      '| canvas:', screencastCanvas.width, 'x', screencastCanvas.height,
      '| stream tracks:', mediaStream ? mediaStream.getVideoTracks().length : 0);
  }

  const img = new Image();
  img.onload = () => {
    // Keep the canvas size stable. If Chrome returns a slightly different
    // JPEG frame size, scale it into the current capture canvas instead of
    // changing the outbound stream dimensions mid-call.
    if (img.width !== screencastCanvas.width || img.height !== screencastCanvas.height) {
      log('[BROWSERLINK:offscreen] Frame size differs from canvas:',
        img.width, 'x', img.height,
        '| canvas:', screencastCanvas.width, 'x', screencastCanvas.height);
    }

    if (drawFramePreservingAspect(img)) {
      // Store only drawable frames for redraw when a viewer connects after
      // frames stop arriving. Dropped mismatched frames must not be replayed
      // later as an internal letterbox that breaks input mapping.
      lastFrameData = base64Data;
    }
  };
  img.onerror = (err) => {
    error('[BROWSERLINK:offscreen] Image decode failed for frame #' + frameDrawCount);
  };
  img.src = 'data:image/jpeg;base64,' + base64Data;
}

function resizeScreencastCanvas(width, height, viewportWidth = width, viewportHeight = height) {
  if (!screencastCanvas) return;
  screencastViewport.width = viewportWidth || width;
  screencastViewport.height = viewportHeight || height;
  log('[BROWSERLINK:offscreen] Resizing screencast canvas to', width, 'x', height,
    '| viewport:', screencastViewport.width, 'x', screencastViewport.height);
  screencastCanvas.width = width;
  screencastCanvas.height = height;
  screencastCtx = screencastCanvas.getContext('2d');
  screencastCtx.fillStyle = '#000';
  screencastCtx.fillRect(0, 0, width, height);
  sendViewportInfo();
}

// --- Frame ticker (forces canvas invalidation for captureStream) ---

function startFrameTicker() {
  if (frameTickerInterval) return;
  frameTickerInterval = setInterval(() => {
    if (!screencastCtx || !screencastCanvas) return;
    // Toggle a 1x1 pixel in the top-left corner between two nearly-invisible colors
    frameTickerFlip = !frameTickerFlip;
    screencastCtx.fillStyle = frameTickerFlip ? 'rgba(0,0,0,0.01)' : 'rgba(0,0,0,0.02)';
    screencastCtx.fillRect(0, 0, 1, 1);
  }, 250);
  log('[BROWSERLINK:offscreen] Frame ticker started');
}

function stopFrameTicker() {
  if (frameTickerInterval) {
    clearInterval(frameTickerInterval);
    frameTickerInterval = null;
    log('[BROWSERLINK:offscreen] Frame ticker stopped');
  }
}

// --- Cleanup ---

function stopHost(reason = 'manual') {
  stopFrameTicker();
  log('[BROWSERLINK:offscreen] Stopping host');
  notifyViewerHostStopped(reason);
  if (dataConnection) {
    dataConnection.close();
    dataConnection = null;
  }
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }
  screencastCanvas = null;
  screencastCtx = null;
  screencastViewport = { width: 1920, height: 1080 };
  lastFrameData = null;
}
