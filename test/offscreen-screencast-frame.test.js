import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function loadOffscreen({ imageWidth, imageHeight, imageDimensions } = {}) {
  let runtimeListener = null;
  let imageIndex = 0;
  const drawCalls = [];
  const peerHandlers = {};

  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListener = listener;
          }
        },
        sendMessage: () => Promise.resolve()
      }
    },
    document: {
      createElement(tagName) {
        expect(tagName).toBe('canvas');
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              fillStyle: null,
              fillRect: (...args) => drawCalls.push({ method: 'fillRect', args }),
              drawImage: (...args) => drawCalls.push({ method: 'drawImage', args })
            };
          },
          captureStream() {
            return {
              getVideoTracks: () => [{ kind: 'video' }],
              getTracks: () => [{ stop: () => {} }]
            };
          }
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
      constructor() {
        const dimensions = imageDimensions?.[imageIndex++] || { width: imageWidth, height: imageHeight };
        this.width = dimensions.width;
        this.height = dimensions.height;
        this.onload = null;
        this.onerror = null;
      }

      set src(_value) {
        queueMicrotask(() => this.onload?.());
      }
    }
  };
  context.self = context;
  vm.createContext(context);

  const source = readFileSync(join(repoRoot, 'offscreen.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'offscreen.js' });

  expect(runtimeListener).toBeTypeOf('function');
  return { runtimeListener, drawCalls, peerHandlers };
}

function send(runtimeListener, message) {
  let response;
  runtimeListener(message, {}, (value) => {
    response = value;
  });
  expect(response).toEqual({ ok: true });
}

describe('offscreen screencast frame drawing', () => {
  it('drops significantly mismatched aspect frames instead of drawing internal letterbox', async () => {
    const { runtimeListener, drawCalls } = loadOffscreen({
      imageWidth: 1280,
      imageHeight: 720
    });

    send(runtimeListener, {
      action: 'offscreen:startHostScreencast',
      width: 800,
      height: 600
    });
    drawCalls.length = 0;

    send(runtimeListener, {
      action: 'offscreen:screencastFrame',
      data: 'fake-jpeg-data'
    });
    await Promise.resolve();

    expect(drawCalls).toEqual([]);
  });

  it('still scales effectively same-aspect decoded frames across the full canvas', async () => {
    const { runtimeListener, drawCalls } = loadOffscreen({
      imageWidth: 1600,
      imageHeight: 1200
    });

    send(runtimeListener, {
      action: 'offscreen:startHostScreencast',
      width: 800,
      height: 600
    });
    drawCalls.length = 0;

    send(runtimeListener, {
      action: 'offscreen:screencastFrame',
      data: 'fake-jpeg-data'
    });
    await Promise.resolve();

    const frameDraws = drawCalls.filter((call) => call.method === 'drawImage');
    expect(frameDraws).toHaveLength(1);
    expect(frameDraws[0].args.slice(1)).toEqual([0, 0, 800, 600]);
  });

  it('does not redraw a dropped mismatched frame when a viewer connects later', async () => {
    const { runtimeListener, drawCalls, peerHandlers } = loadOffscreen({
      imageDimensions: [
        { width: 1280, height: 720 },
        { width: 1280, height: 720 }
      ]
    });

    send(runtimeListener, {
      action: 'offscreen:startHostScreencast',
      width: 800,
      height: 600
    });
    drawCalls.length = 0;

    send(runtimeListener, {
      action: 'offscreen:screencastFrame',
      data: 'fake-jpeg-data'
    });
    await Promise.resolve();
    drawCalls.length = 0;

    peerHandlers.call({
      peerConnection: { getSenders: () => [] },
      answer: () => {},
      on: () => {}
    });
    await Promise.resolve();

    expect(drawCalls).toEqual([]);
  });
});
