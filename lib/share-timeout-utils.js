'use strict';

// LobsterLink share timeout pure helpers.
// Classic-script-compatible and Chrome-free; exported via CommonJS for Vitest.

const SHARE_TIMEOUT_MINUTES = 15;
const SHARE_TIMEOUT_MS = SHARE_TIMEOUT_MINUTES * 60 * 1000;

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function computeShareExpiresAt(startedAt) {
  const normalizedStartedAt = normalizeTimestamp(startedAt);
  if (normalizedStartedAt === null) {
    return null;
  }

  return normalizedStartedAt + SHARE_TIMEOUT_MS;
}

function getShareRemainingMs(expiresAt, now) {
  const normalizedExpiresAt = normalizeTimestamp(expiresAt);
  const normalizedNow = normalizeTimestamp(now);
  if (normalizedExpiresAt === null || normalizedNow === null) {
    return null;
  }

  return Math.max(0, normalizedExpiresAt - normalizedNow);
}

function formatShareCountdown(remainingMs) {
  const normalizedRemainingMs = normalizeTimestamp(remainingMs);
  const clampedMs = Math.max(0, normalizedRemainingMs || 0);
  const totalSeconds = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getShareCountdownRemainingMs(timing, now = Date.now()) {
  if (!timing || typeof timing !== 'object') {
    return null;
  }

  const normalizedRemainingMs = normalizeTimestamp(timing.shareRemainingMs);
  if (normalizedRemainingMs !== null) {
    return Math.max(0, normalizedRemainingMs);
  }

  return getShareRemainingMs(timing.shareExpiresAt, now);
}

function appendShareExpiryStatus(baseStatus, timing, now = Date.now()) {
  const base = String(baseStatus || '');
  const remainingMs = getShareCountdownRemainingMs(timing, now);
  if (remainingMs === null) {
    return base;
  }

  return `${base} — expires in ${formatShareCountdown(remainingMs)}`;
}

function getShareTimeoutDecision(state, now) {
  if (!state || !state.hosting) {
    return { action: 'none' };
  }

  const remainingMs = getShareRemainingMs(state.shareExpiresAt, now);
  if (remainingMs === null) {
    return { action: 'expire' };
  }

  if (remainingMs <= 0) {
    return { action: 'expire' };
  }

  return {
    action: 'schedule',
    delayMs: remainingMs
  };
}

function getShareExpiryEnforcementDecision(state, now) {
  return getShareTimeoutDecision(state, now);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SHARE_TIMEOUT_MINUTES,
    SHARE_TIMEOUT_MS,
    computeShareExpiresAt,
    formatShareCountdown,
    getShareCountdownRemainingMs,
    appendShareExpiryStatus,
    getShareRemainingMs,
    getShareTimeoutDecision,
    getShareExpiryEnforcementDecision
  };
}
