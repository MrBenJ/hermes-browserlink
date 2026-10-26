import { describe, expect, it } from 'vitest';
import {
  SHARE_TIMEOUT_MS,
  computeShareExpiresAt,
  formatShareCountdown,
  getShareRemainingMs,
  getShareTimeoutDecision,
  getShareExpiryEnforcementDecision,
  appendShareExpiryStatus
} from '../lib/share-timeout-utils.js';

describe('share timeout helpers', () => {
  it('computes a 15-minute expiry deadline from a supplied start time', () => {
    const startedAt = Date.UTC(2026, 3, 29, 12, 0, 0);

    expect(SHARE_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(computeShareExpiresAt(startedAt)).toBe(startedAt + SHARE_TIMEOUT_MS);
  });

  it('clamps remaining time at zero after the expiry deadline', () => {
    const expiresAt = 1_000;

    expect(getShareRemainingMs(expiresAt, 999)).toBe(1);
    expect(getShareRemainingMs(expiresAt, 1_000)).toBe(0);
    expect(getShareRemainingMs(expiresAt, 1_001)).toBe(0);
  });

  it('returns null for missing or invalid expiry deadlines', () => {
    expect(getShareRemainingMs(undefined, 0)).toBeNull();
    expect(getShareRemainingMs(null, 0)).toBeNull();
    expect(getShareRemainingMs('', 0)).toBeNull();
    expect(getShareRemainingMs('not-a-deadline', 0)).toBeNull();
    expect(getShareRemainingMs(Number.NaN, 0)).toBeNull();
    expect(getShareRemainingMs(Number.POSITIVE_INFINITY, 0)).toBeNull();
  });

  it('formats remaining time as stable mm:ss countdown copy', () => {
    expect(formatShareCountdown(14 * 60 * 1000 + 32 * 1000)).toBe('14:32');
    expect(formatShareCountdown(60 * 1000)).toBe('1:00');
    expect(formatShareCountdown(0)).toBe('0:00');
    expect(formatShareCountdown(-1)).toBe('0:00');
  });

  it('appends hosted expiry countdown copy from remaining milliseconds', () => {
    expect(appendShareExpiryStatus('Hosting', { shareRemainingMs: 14 * 60 * 1000 + 32 * 1000 })).toBe(
      'Hosting — expires in 14:32'
    );
    expect(appendShareExpiryStatus('Viewer connected', { shareRemainingMs: 5_000 })).toBe(
      'Viewer connected — expires in 0:05'
    );
  });

  it('computes hosted expiry countdown copy from the expiry timestamp when needed', () => {
    expect(appendShareExpiryStatus('Hosting', { shareRemainingMs: null, shareExpiresAt: 10_000 }, 1_000)).toBe(
      'Hosting — expires in 0:09'
    );
  });

  it('falls back to base status copy when timing is missing or invalid', () => {
    expect(appendShareExpiryStatus('Hosting', { shareRemainingMs: null, shareExpiresAt: null }, 1_000)).toBe('Hosting');
    expect(appendShareExpiryStatus('Hosting', { shareRemainingMs: 'not-time' }, 1_000)).toBe('Hosting');
    expect(appendShareExpiryStatus('Hosting', {}, 1_000)).toBe('Hosting');
  });
});


describe('share timeout lifecycle decisions', () => {
  it('schedules a future hosted expiry with the remaining delay', () => {
    expect(getShareTimeoutDecision({ hosting: true, shareExpiresAt: 1_500 }, 1_000)).toEqual({
      action: 'schedule',
      delayMs: 500
    });
  });

  it('expires hosted state when the persisted deadline has passed', () => {
    expect(getShareTimeoutDecision({ hosting: true, shareExpiresAt: 1_000 }, 1_000)).toEqual({
      action: 'expire'
    });
    expect(getShareTimeoutDecision({ hosting: true, shareExpiresAt: 999 }, 1_000)).toEqual({
      action: 'expire'
    });
  });

  it('does nothing when not hosting, even if expiry is present or invalid', () => {
    expect(getShareTimeoutDecision({ hosting: false, shareExpiresAt: 1_000 }, 2_000)).toEqual({ action: 'none' });
    expect(getShareTimeoutDecision({ hosting: false, shareExpiresAt: null }, 2_000)).toEqual({ action: 'none' });
  });

  it('fails closed when hosted state is missing a valid expiry deadline', () => {
    expect(getShareTimeoutDecision({ hosting: true, shareExpiresAt: null }, 2_000)).toEqual({ action: 'expire' });
    expect(getShareTimeoutDecision({ hosting: true, shareExpiresAt: 'not-a-deadline' }, 2_000)).toEqual({ action: 'expire' });
    expect(getShareTimeoutDecision({ hosting: true, shareExpiresAt: Number.NaN }, 2_000)).toEqual({ action: 'expire' });
  });

  it('revalidates stale timeout callbacks against the current hosted deadline', () => {
    expect(getShareExpiryEnforcementDecision({ hosting: true, shareExpiresAt: 5_000 }, 1_000)).toEqual({
      action: 'schedule',
      delayMs: 4_000
    });
    expect(getShareExpiryEnforcementDecision({ hosting: true, shareExpiresAt: 1_000 }, 1_000)).toEqual({
      action: 'expire'
    });
  });
});
