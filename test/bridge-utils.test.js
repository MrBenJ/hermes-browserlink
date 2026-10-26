import { describe, it, expect } from 'vitest';
import { buildViewerUrl, normalizeViewerBaseUrl, pickDefaultSelectedTab, pickViewerUrlPeerId, syncConnectPeerIdInput } from '../lib/bridge-utils.js';

describe('normalizeViewerBaseUrl', () => {
  it('trims whitespace', () => {
    expect(normalizeViewerBaseUrl('  http://x/v.html ')).toBe('http://x/v.html');
  });
  it('strips an existing fragment', () => {
    expect(normalizeViewerBaseUrl('http://x/v.html#host=old')).toBe('http://x/v.html');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeViewerBaseUrl('')).toBe('');
    expect(normalizeViewerBaseUrl(undefined)).toBe('');
    expect(normalizeViewerBaseUrl('   ')).toBe('');
  });
});

describe('buildViewerUrl', () => {
  it('returns empty string without a peer id', () => {
    expect(buildViewerUrl('', 'http://x/v.html')).toBe('');
  });
  it('returns empty string without a base url', () => {
    expect(buildViewerUrl('abc', '')).toBe('');
    expect(buildViewerUrl('abc')).toBe('');
    expect(buildViewerUrl('abc', '   ')).toBe('');
  });
  it('builds the url with a #host fragment', () => {
    expect(buildViewerUrl('abc123', 'http://mac-mini:8787/browserlink-viewer.html'))
      .toBe('http://mac-mini:8787/browserlink-viewer.html#host=abc123');
  });
  it('encodes the peer id', () => {
    expect(buildViewerUrl('a b/c', 'http://x/v.html'))
      .toBe('http://x/v.html#host=a%20b%2Fc');
  });
  it('replaces a stale fragment on the base', () => {
    expect(buildViewerUrl('abc', 'http://x/v.html#host=old'))
      .toBe('http://x/v.html#host=abc');
  });
});

describe('pickDefaultSelectedTab', () => {
  it('returns null when there are no tabs', () => {
    expect(pickDefaultSelectedTab({ tabs: [], status: null })).toBeNull();
    expect(pickDefaultSelectedTab({ tabs: [], status: {} })).toBeNull();
  });

  it('prefers the captured tab when it is present in the tabs list', () => {
    const state = {
      status: { capturedTabId: 42 },
      tabs: [
        { id: 10, active: false },
        { id: 42, active: false },
        { id: 77, active: true }
      ]
    };
    expect(pickDefaultSelectedTab(state)).toBe(42);
  });

  it('falls back to the active tab when the captured tab is not in the list', () => {
    const state = {
      status: { capturedTabId: 999 },
      tabs: [
        { id: 10, active: false },
        { id: 42, active: true },
        { id: 77, active: false }
      ]
    };
    expect(pickDefaultSelectedTab(state)).toBe(42);
  });

  it('falls back to the active tab when there is no captured tab', () => {
    const state = {
      status: {},
      tabs: [
        { id: 10, active: false },
        { id: 42, active: true }
      ]
    };
    expect(pickDefaultSelectedTab(state)).toBe(42);
  });

  it('falls back to the first tab when no tab is active', () => {
    const state = {
      status: {},
      tabs: [
        { id: 10, active: false },
        { id: 42, active: false }
      ]
    };
    expect(pickDefaultSelectedTab(state)).toBe(10);
  });

  it('tolerates a missing status object', () => {
    const state = {
      status: null,
      tabs: [
        { id: 10, active: true },
        { id: 42, active: false }
      ]
    };
    expect(pickDefaultSelectedTab(state)).toBe(10);
  });
});

describe('pickViewerUrlPeerId', () => {
  it('uses the active host peer id', () => {
    expect(pickViewerUrlPeerId('P2', '')).toBe('P2');
  });

  it('ignores a stale id left in the connect field once a new host is up', () => {
    // Stop -> Start mints a new peer id; the Viewer URL must follow it, or
    // the agent hands out a dead link (Phase A B1).
    expect(pickViewerUrlPeerId('P2', 'P1')).toBe('P2');
  });

  it('falls back to the typed id when nothing is hosting', () => {
    expect(pickViewerUrlPeerId(null, 'remote-peer')).toBe('remote-peer');
    expect(pickViewerUrlPeerId('', '  ')).toBe('');
  });
});

describe('syncConnectPeerIdInput', () => {
  it('fills an empty field with the host peer id', () => {
    expect(syncConnectPeerIdInput({ value: '', lastAutoFilled: '', hostPeerId: 'P1' }))
      .toEqual({ value: 'P1', lastAutoFilled: 'P1' });
  });

  it('follows the host across Stop -> Start when the value was auto-filled', () => {
    const afterStop = syncConnectPeerIdInput({ value: 'P1', lastAutoFilled: 'P1', hostPeerId: null });
    expect(afterStop).toEqual({ value: '', lastAutoFilled: '' });
    const afterStart = syncConnectPeerIdInput({ ...afterStop, hostPeerId: 'P2' });
    expect(afterStart).toEqual({ value: 'P2', lastAutoFilled: 'P2' });
  });

  it('replaces an auto-filled id directly when the host restarts between refreshes', () => {
    expect(syncConnectPeerIdInput({ value: 'P1', lastAutoFilled: 'P1', hostPeerId: 'P2' }))
      .toEqual({ value: 'P2', lastAutoFilled: 'P2' });
  });

  it('leaves an id the operator typed alone', () => {
    expect(syncConnectPeerIdInput({ value: 'typed', lastAutoFilled: 'P1', hostPeerId: 'P2' }))
      .toEqual({ value: 'typed', lastAutoFilled: 'P1' });
  });
});
