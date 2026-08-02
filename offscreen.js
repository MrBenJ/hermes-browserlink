// Offscreen document — holds PeerJS peer + MediaStream for host mode.
// MediaStream is sourced from a canvas fed by CDP screencast JPEG frames.

let peer = null;
let mediaStream = null;
let currentCall = null;
let dataConnection = null;
// Peer id of the viewer that currently owns this hosting session. Both the
// data channel and the media call are fenced on it, so a superseded or
// media-only peer can neither drive the tab nor keep watching it.
let activeViewerPeerId = null;

// STUN-only, no TURN. PeerJS' bundled defaultConfig ships two
// PeerJS-operated TURN relays with embedded credentials, so a connection that
// cannot go direct would relay the hosted tab's media through third-party
// infrastructure. The port plan locked STUN-only (decision D4) and the README
// documents signaling-only third-party exposure, so the config is set
// explicitly rather than inherited.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];


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

// Close the active media call without tearing down the session. The close
// handler is fenced on `call === currentCall`, so currentCall is cleared here
// first to keep that handler a no-op for a call we are deliberately dropping.
function closeCurrentCall(reason) {
  if (!currentCall) return;
  const call = currentCall;
  currentCall = null;
  log('[BROWSERLINK:offscreen] Closing media call —', reason);
  try {
    call.close();
  } catch (e) {
    warn('[BROWSERLINK:offscreen] Failed to close media call:', e.message || e);
  }
}

// --- PeerJS setup ---

function setupPeer() {
  peer = new Peer({ config: { iceServers: ICE_SERVERS } });

  peer.on('open', (id) => {
    log('[BROWSERLINK:offscreen] Peer ready, id:', id);
    chrome.runtime.sendMessage({ action: 'peerReady', peerId: id });
  });

  peer.on('call', (call) => {
    log('[BROWSERLINK:offscreen] Incoming media call from viewer');

    // Ownership check. The viewer opens its data channel before placing the
    // media call, so once a session has an owner any call from a different
    // peer is either a superseded viewer or a media-only caller — both would
    // otherwise keep receiving the hosted tab's screencast, which can show
    // login challenges and account pages.
    // No owner yet means no data channel, so this would be a silent
    // video-only session: viewerConnected stays false, the operator sees
    // "no viewer" while the tab is on screen, and nothing the worker relies
    // on to enforce share expiry ever fires. Possession of the peer id is not
    // enough — the viewer must own the data channel first.
    if (!activeViewerPeerId || !call.peer || call.peer !== activeViewerPeerId) {
      warn('[BROWSERLINK:offscreen] Rejecting media call from non-owning peer');
      try {
        call.close();
      } catch (e) {
        warn('[BROWSERLINK:offscreen] Failed to close rejected call:', e.message || e);
      }
      return;
    }

    closeCurrentCall('superseded by a new media call');
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
      if (call !== currentCall) {
        log('[BROWSERLINK:offscreen] Superseded media call closed; active stream unaffected');
        return;
      }
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
    activeViewerPeerId = conn.peer || null;
    if (previous && previous !== conn) {
      log('[BROWSERLINK:offscreen] Superseding previous viewer connection');
      try {
        previous.close();
      } catch (e) {
        warn('[BROWSERLINK:offscreen] Failed to close superseded connection:', e.message || e);
      }
    }

    // Drop any media call that does not belong to the new owner. This sits
    // outside the `previous` check on purpose: a call can predate the first
    // data connection, and scoping the cleanup to the supersede case left
    // that one streaming alongside the legitimate viewer.
    if (currentCall && currentCall.peer !== activeViewerPeerId) {
      closeCurrentCall('it does not belong to the current viewer');
      stopFrameTicker();
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
      // Untrusted: anyone holding the Viewer URL writes to this channel, so
      // malformed JSON, null, or a bare string must not throw out of the
      // PeerJS emitter once per message.
      let evt;
      try {
        evt = typeof data === 'string' ? JSON.parse(data) : data;
      } catch (e) {
        warn('[BROWSERLINK:offscreen] Dropping unparseable message from viewer');
        return;
      }
      if (!evt || typeof evt !== 'object' || typeof evt.type !== 'string') {
        warn('[BROWSERLINK:offscreen] Dropping malformed message from viewer');
        return;
      }

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
      activeViewerPeerId = null;
      // The media call is a separate WebRTC connection, so dropping the data
      // channel does not stop the video. Without this the viewer keeps seeing
      // the hosted tab while the host reports it as disconnected.
      closeCurrentCall('its data connection closed');
      stopFrameTicker();
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
  // Clear ownership with the session. Leaving a stale peer id here carries the
  // previous viewer's identity into the next host session's media fence.
  activeViewerPeerId = null;
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
