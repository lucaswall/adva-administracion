/**
 * Tests for concurrency utilities - quota-aware retries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isQuotaError, withQuotaRetry, SHEETS_QUOTA_RETRY_CONFIG } from './concurrency.js';

describe('isQuotaError', () => {
  it('detects "quota exceeded" message', () => {
    const error = new Error('Quota exceeded for quota metric');
    expect(isQuotaError(error)).toBe(true);
  });

  it('detects "Quota Exceeded" with capital letters', () => {
    const error = new Error('Quota Exceeded');
    expect(isQuotaError(error)).toBe(true);
  });

  it('detects "rate limit" message', () => {
    const error = new Error('Rate limit exceeded');
    expect(isQuotaError(error)).toBe(true);
  });

  it('detects "too many requests" message', () => {
    const error = new Error('Too many requests, please try again later');
    expect(isQuotaError(error)).toBe(true);
  });

  it('detects HTTP 429 status code in message', () => {
    const error = new Error('HTTP 429: Too Many Requests');
    expect(isQuotaError(error)).toBe(true);
  });

  it('returns false for non-quota errors', () => {
    const error = new Error('Network connection failed');
    expect(isQuotaError(error)).toBe(false);
  });

  it('returns false for non-Error objects', () => {
    expect(isQuotaError('string error')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError(42)).toBe(false);
  });
});

describe('SHEETS_QUOTA_RETRY_CONFIG', () => {
  it('has longer delays than default config', () => {
    expect(SHEETS_QUOTA_RETRY_CONFIG.baseDelayMs).toBeGreaterThanOrEqual(15000);
    expect(SHEETS_QUOTA_RETRY_CONFIG.maxDelayMs).toBeGreaterThanOrEqual(60000);
  });

  it('has at least 5 retries', () => {
    expect(SHEETS_QUOTA_RETRY_CONFIG.maxRetries).toBeGreaterThanOrEqual(5);
  });
});

describe('withQuotaRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns success on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const resultPromise = withQuotaRetry(fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on quota error with longer delays', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Quota exceeded'))
      .mockResolvedValueOnce('success');

    const resultPromise = withQuotaRetry(fn, {}, { maxRetries: 2, baseDelayMs: 15000, maxDelayMs: 65000 });

    // Fast-forward through delays
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses standard delays for non-quota errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce('success');

    const resultPromise = withQuotaRetry(fn, { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 2000 });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns error after max retries exceeded', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Quota exceeded'));

    // Use Math.max of standard (3 default) and quota (2 custom) = 3 max retries
    const resultPromise = withQuotaRetry(fn, { maxRetries: 3 }, { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000 });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Quota exceeded');
    }
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries (max of standard and quota)
  });

  it('handles mixed error types with appropriate delays', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Network error')) // standard delay
      .mockRejectedValueOnce(new Error('Quota exceeded')) // quota delay
      .mockResolvedValueOnce('success');

    const resultPromise = withQuotaRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 }, { maxRetries: 3, baseDelayMs: 15000, maxDelayMs: 65000 });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
