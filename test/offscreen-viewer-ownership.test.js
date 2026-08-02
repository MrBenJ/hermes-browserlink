import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// A stand-in for a PeerJS DataConnection. Records the handlers offscreen.js
// installs so the test can fire them, and records close()/send() so the test
// can assert on connection ownership.
function makeConn(label) {
  const handlers = {};
  return {
    label,
    peer: `peer-${label}`,
    open: true,
    sent: [],
    closed: false,
    on(eventName, listener) {
      handlers[eventName] = listener;
    },
    close() {
      this.closed = true;
      this.open = false;
    },
    send(payload) {
      this.sent.push(payload);
    },
    fire(eventName, arg) {
      return handlers[eventName]?.(arg);
    }
  };
}

// A stand-in for a PeerJS MediaConnection.
function makeCall(peerId) {
  const handlers = {};
  return {
    peer: peerId,
    answered: false,
    closed: false,
    peerConnection: { getSenders: () => [] },
    answer() {
      this.answered = true;
    },
    close() {
      this.closed = true;
    },
    on(eventName, listener) {
      handlers[eventName] = listener;
    },
    fire(eventName, arg) {
      return handlers[eventName]?.(arg);
    }
  };
}

function loadOffscreen() {
  const messages = [];
  const peerHandlers = {};
  const ticker = { starts: 0, stops: 0 };
  let runtimeListener = null;

  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => {
      ticker.starts += 1;
      return 1;
    },
    clearInterval: () => {
      ticker.stops += 1;
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListener = listener;
          }
        },
        sendMessage: (message) => {
          messages.push(message);
          return Promise.resolve();
        }
      }
    },
    document: {
      createElement() {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ fillStyle: null, fillRect: () => {}, drawImage: () => {} }),
          captureStream: () => ({
            getVideoTracks: () => [{ kind: 'video' }],
            getTracks: () => [{ stop: () => {} }]
          })
        };
      }
    },
    Peer: class {
      on(eventName, listener) {
        peerHandlers[eventName] = listener;
      }
      destroy() {}
    },
    Image: class {
      set src(_value) {
        queueMicrotask(() => this.onload?.());
      }
    }
  };
  context.self = context;
  vm.createContext(context);

  vm.runInContext(readFileSync(join(repoRoot, 'offscreen.js'), 'utf8'), context, {
    filename: 'offscreen.js'
  });

  // setupPeer() only runs once hosting starts, so the peer handlers do not
  // exist until a startHostScreencast message is delivered.
  expect(runtimeListener).toBeTypeOf('function');
  let response;
  runtimeListener(
    { action: 'offscreen:startHostScreencast', width: 800, height: 600 },
    {},
    (value) => { response = value; }
  );
  expect(response).toEqual({ ok: true });

  expect(peerHandlers.connection).toBeTypeOf('function');
  expect(peerHandlers.call).toBeTypeOf('function');
  messages.length = 0;
  return { peerHandlers, messages, runtimeListener, ticker };
}

const INPUT_EVENT = { type: 'mouse', action: 'down', x: 10, y: 20 };
const CONTROL_EVENT = { type: 'navigate', url: 'https://example.com' };

describe('offscreen viewer ownership', () => {
  it('closes the previous data connection when a new viewer connects', () => {
    const { peerHandlers } = loadOffscreen();
    const first = makeConn('first');
    const second = makeConn('second');

    peerHandlers.connection(first);
    peerHandlers.connection(second);

    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
  });

  it('ignores input from a superseded connection', () => {
    const { peerHandlers, messages } = loadOffscreen();
    const first = makeConn('first');
    const second = makeConn('second');

    peerHandlers.connection(first);
    peerHandlers.connection(second);
    messages.length = 0;

    first.fire('data', JSON.stringify(INPUT_EVENT));

    expect(messages.filter((m) => m.action === 'inputEvent')).toEqual([]);
  });

  it('ignores control events from a superseded connection', () => {
    const { peerHandlers, messages } = loadOffscreen();
    const first = makeConn('first');
    const second = makeConn('second');

    peerHandlers.connection(first);
    peerHandlers.connection(second);
    messages.length = 0;

    first.fire('data', JSON.stringify(CONTROL_EVENT));

    expect(messages.filter((m) => m.action === 'controlEvent')).toEqual([]);
  });

  it('still forwards input from the active connection', () => {
    const { peerHandlers, messages } = loadOffscreen();
    const first = makeConn('first');
    const second = makeConn('second');

    peerHandlers.connection(first);
    peerHandlers.connection(second);
    messages.length = 0;

    second.fire('data', JSON.stringify(INPUT_EVENT));

    expect(messages.filter((m) => m.action === 'inputEvent')).toHaveLength(1);
  });

  it('does not report viewerDisconnected when a superseded connection closes', () => {
    const { peerHandlers, messages } = loadOffscreen();
    const first = makeConn('first');
    const second = makeConn('second');

    peerHandlers.connection(first);
    peerHandlers.connection(second);
    messages.length = 0;

    first.fire('close');

    expect(messages.filter((m) => m.action === 'viewerDisconnected')).toEqual([]);
  });

  it('keeps the active connection usable after a superseded connection closes', () => {
    const { peerHandlers, messages } = loadOffscreen();
    const first = makeConn('first');
    const second = makeConn('second');

    peerHandlers.connection(first);
    peerHandlers.connection(second);
    first.fire('close');
    second.sent.length = 0;
    messages.length = 0;

    // The active viewer's own open handler must still reach it.
    second.fire('open');

    expect(second.sent.length).toBeGreaterThan(0);
    expect(messages.filter((m) => m.action === 'viewerConnected')).toHaveLength(1);
  });

  it('reports viewerDisconnected when the active connection closes', () => {
    const { peerHandlers, messages } = loadOffscreen();
    const only = makeConn('only');

    peerHandlers.connection(only);
    messages.length = 0;

    only.fire('close');

    expect(messages.filter((m) => m.action === 'viewerDisconnected')).toHaveLength(1);
  });

  it('answers a media call from the peer that owns the data connection', () => {
    const { peerHandlers } = loadOffscreen();
    const conn = makeConn('first');
    peerHandlers.connection(conn);

    const call = makeCall(conn.peer);
    peerHandlers.call(call);

    expect(call.answered).toBe(true);
    expect(call.closed).toBe(false);
  });

  it('rejects a media call from a peer that does not own the data connection', () => {
    const { peerHandlers } = loadOffscreen();
    const conn = makeConn('first');
    peerHandlers.connection(conn);

    const stranger = makeCall('peer-stranger');
    peerHandlers.call(stranger);

    expect(stranger.answered).toBe(false);
    expect(stranger.closed).toBe(true);
  });

  // Deliberate: before any viewer owns the session there is no peer id to
  // check against, and a caller can only reach us by already holding the
  // secret host peer id — the same capability that would let it open a data
  // connection and take ownership outright. Rejecting here would buy no
  // confidentiality and would break the legitimate case where the media call
  // is observed before the data connection.
  it('accepts a media call placed before any viewer owns the session', () => {
    const { peerHandlers } = loadOffscreen();

    const call = makeCall('peer-early');
    peerHandlers.call(call);

    expect(call.answered).toBe(true);
    expect(call.closed).toBe(false);
  });

  it('closes a superseded viewer media call when a new owner calls', () => {
    const { peerHandlers } = loadOffscreen();
    const first = makeConn('first');
    peerHandlers.connection(first);
    const firstCall = makeCall(first.peer);
    peerHandlers.call(firstCall);

    const second = makeConn('second');
    peerHandlers.connection(second);
    const secondCall = makeCall(second.peer);
    peerHandlers.call(secondCall);

    expect(firstCall.closed).toBe(true);
    expect(secondCall.answered).toBe(true);
  });

  it('stops the superseded viewer stream when its data connection is replaced', () => {
    const { peerHandlers } = loadOffscreen();
    const first = makeConn('first');
    peerHandlers.connection(first);
    const firstCall = makeCall(first.peer);
    peerHandlers.call(firstCall);

    // A new viewer takes ownership before ever placing its media call.
    peerHandlers.connection(makeConn('second'));

    expect(firstCall.closed).toBe(true);
  });

  it('does not stop the frame ticker when a superseded media call closes', () => {
    const { peerHandlers, ticker } = loadOffscreen();
    const first = makeConn('first');
    peerHandlers.connection(first);
    const firstCall = makeCall(first.peer);
    peerHandlers.call(firstCall);

    const second = makeConn('second');
    peerHandlers.connection(second);
    const secondCall = makeCall(second.peer);
    peerHandlers.call(secondCall);

    const stopsBefore = ticker.stops;
    firstCall.fire('close');

    expect(ticker.stops).toBe(stopsBefore);
  });

  it('stops the frame ticker when the active media call closes', () => {
    const { peerHandlers, ticker } = loadOffscreen();
    const conn = makeConn('first');
    peerHandlers.connection(conn);
    const call = makeCall(conn.peer);
    peerHandlers.call(call);

    const stopsBefore = ticker.stops;
    call.fire('close');

    expect(ticker.stops).toBeGreaterThan(stopsBefore);
  });

  it('does not announce a superseded connection that opens late', () => {
    const { peerHandlers, messages } = loadOffscreen();
    const first = makeConn('first');
    const second = makeConn('second');

    peerHandlers.connection(first);
    peerHandlers.connection(second);
    messages.length = 0;

    first.fire('open');

    expect(messages.filter((m) => m.action === 'viewerConnected')).toEqual([]);
  });
});
