import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
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
} from '../lib/viewer-utils.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const evt = typeof event === 'string' ? { type: event } : event;
    evt.target ||= this;
    for (const listener of this.listeners.get(evt.type) || []) {
      listener(evt);
    }
  }
}

class FakeElement extends FakeTarget {
  constructor(id = '') {
    super();
    this.id = id;
    this.style = {};
    this.classList = new FakeClassList();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.title = '';
    this.children = [];
    this.attributes = new Map();
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.srcObject = null;
  }

  appendChild(child) {
    this.children.push(child);
  }

  remove() {}
  focus() {}
  select() {}

  play() {
    return Promise.resolve();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getBoundingClientRect() {
    const width = Number.parseFloat(this.style.width) || this.clientWidth || 0;
    const height = Number.parseFloat(this.style.height) || this.clientHeight || 0;
    const left = Number.parseFloat(this.style.left) || 0;
    const top = Number.parseFloat(this.style.top) || 0;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
}

class FakeConnection extends FakeTarget {
  constructor() {
    super();
    this.open = true;
    this.sent = [];
  }

  on(type, listener) {
    this.addEventListener(type, listener);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.open = false;
  }

  emit(type, data) {
    this.dispatchEvent({ type, ...(data === undefined ? {} : { data }) });
  }
}

class FakePeer extends FakeTarget {
  static instances = [];

  constructor() {
    super();
    this.destroyed = false;
    this.dataConn = null;
    this.mediaCall = null;
    FakePeer.instances.push(this);
  }

  on(type, listener) {
    this.addEventListener(type, listener);
  }

  connect() {
    this.dataConn = new FakeConnection();
    return this.dataConn;
  }

  call() {
    this.mediaCall = new FakeConnection();
    return this.mediaCall;
  }

  reconnect() {}

  destroy() {
    this.destroyed = true;
  }

  emit(type, data) {
    this.dispatchEvent({ type, ...(data === undefined ? {} : { data }) });
  }
}

function createViewerHarness({ hash = '#debug=true' } = {}) {
  FakePeer.instances = [];
  const ids = [
    'remote-video',
    'video-container',
    'connect-overlay',
    'overlay-peer-input',
    'overlay-connect',
    'overlay-error',
    'overlay-msg',
    'connection-status',
    'url-bar',
    'tab-select',
    'debug-panel',
    'btn-mobile-keyboard',
    'mobile-keyboard-input',
    'btn-mobile-paste',
    'mobile-paste-sheet',
    'mobile-paste-input',
    'mobile-paste-cancel',
    'btn-back',
    'btn-forward',
    'btn-reload',
    'btn-new-tab',
    'btn-close-tab',
    'viewport-select'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  elements['video-container'].clientWidth = 800;
  elements['video-container'].clientHeight = 600;

  const document = new FakeTarget();
  document.getElementById = (id) => elements[id] || null;
  document.createElement = (tagName) => {
    const element = new FakeElement(tagName);
    if (tagName === 'canvas') {
      element.captureStream = () => ({ getTracks: () => [] });
    }
    return element;
  };
  document.body = new FakeElement('body');
  document.execCommand = () => true;
  document.activeElement = null;
  document.title = '';

  const window = new FakeTarget();
  window.innerWidth = 1024;
  window.innerHeight = 768;
  window.addEventListener = window.addEventListener.bind(window);

  const timers = [];
  const context = {
    document,
    window,
    location: { search: '', hash },
    navigator: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    Peer: FakePeer,
    URLSearchParams,
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
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
  context.globalThis = context;
  context.window.window = window;
  context.window.document = document;

  vm.runInNewContext(readFileSync('client/viewer.js', 'utf8'), context, { filename: 'client/viewer.js' });

  return { context, elements, timers, peers: FakePeer.instances };
}

describe('viewer runtime layout handling', () => {
  it('relayouts and refreshes debug state when a same-stream video resize changes intrinsic dimensions', () => {
    const { elements } = createViewerHarness();
    const video = elements['remote-video'];

    video.videoWidth = 800;
    video.videoHeight = 600;
    video.dispatchEvent('loadedmetadata');
    expect(video.style.width).toBe('800px');
    expect(video.style.height).toBe('600px');

    video.videoWidth = 1200;
    video.videoHeight = 600;
    video.dispatchEvent('resize');

    expect(video.style.width).toBe('800px');
    expect(video.style.height).toBe('400px');
    expect(video.style.top).toBe('100px');
    expect(elements['debug-panel'].textContent).toContain('video intrinsic: 1200x600');
  });

  it('requests one auto viewport follow-up when screencast host metrics differ from the viewer container', () => {
    const { context, elements, peers } = createViewerHarness({ hash: '#host=host-peer&debug=true' });
    const peer = peers[0];
    peer.emit('open');
    peer.dataConn.emit('open');

    context.handleHostMessage({
      type: 'hostMetrics',
      captureMode: 'screencast',
      viewportWidth: 1024,
      viewportHeight: 768,
      windowWidth: 1200,
      windowHeight: 900,
      tabWidth: 1024,
      tabHeight: 768,
      devicePixelRatio: 1
    });

    expect(peer.dataConn.sent.filter((msg) => msg.type === 'setViewport')).toEqual([
      { type: 'setViewport', width: 800, height: 600 }
    ]);

    context.handleHostMessage({
      type: 'hostMetrics',
      captureMode: 'screencast',
      viewportWidth: 1024,
      viewportHeight: 768,
      windowWidth: 1200,
      windowHeight: 900,
      tabWidth: 1024,
      tabHeight: 768,
      devicePixelRatio: 1
    });

    expect(peer.dataConn.sent.filter((msg) => msg.type === 'setViewport')).toHaveLength(1);

    context.handleHostMessage({
      type: 'hostMetrics',
      captureMode: 'screencast',
      viewportWidth: elements['video-container'].clientWidth,
      viewportHeight: elements['video-container'].clientHeight,
      windowWidth: 1200,
      windowHeight: 900,
      tabWidth: 800,
      tabHeight: 600,
      devicePixelRatio: 1
    });

    expect(peer.dataConn.sent.filter((msg) => msg.type === 'setViewport')).toHaveLength(1);
  });

  it('requests an auto viewport follow-up when a screencast viewport message differs from the viewer container', () => {
    const { context, peers } = createViewerHarness({ hash: '#host=host-peer&debug=true' });
    const peer = peers[0];
    peer.emit('open');
    peer.dataConn.emit('open');

    context.handleHostMessage({
      type: 'hostMetrics',
      captureMode: 'screencast',
      viewportWidth: 800,
      viewportHeight: 600,
      windowWidth: 1200,
      windowHeight: 900,
      tabWidth: 800,
      tabHeight: 600,
      devicePixelRatio: 1
    });

    expect(peer.dataConn.sent.filter((msg) => msg.type === 'setViewport')).toHaveLength(0);

    context.handleHostMessage({
      type: 'viewport',
      width: 1024,
      height: 768
    });

    expect(peer.dataConn.sent.filter((msg) => msg.type === 'setViewport')).toEqual([
      { type: 'setViewport', width: 800, height: 600 }
    ]);

    context.handleHostMessage({
      type: 'viewport',
      width: 1024,
      height: 768
    });

    expect(peer.dataConn.sent.filter((msg) => msg.type === 'setViewport')).toHaveLength(1);
  });
});
