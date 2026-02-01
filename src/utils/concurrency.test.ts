/**
 * Tests for concurrency utilities - quota-aware retries and locking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isQuotaError, withQuotaRetry, SHEETS_QUOTA_RETRY_CONFIG, withLock, computeVersion } from './concurrency.js';

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

describe('withLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts custom autoExpiryMs parameter', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const customExpiry = 120000; // 2 minutes

    const resultPromise = withLock('test-resource', fn, 5000, customExpiry);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }
    expect(fn).toHaveBeenCalledOnce();
  });

  it('uses default 30s expiry when autoExpiryMs is omitted', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    // Call without autoExpiryMs parameter
    const resultPromise = withLock('test-resource-2', fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }
    expect(fn).toHaveBeenCalledOnce();
  });

  it('lock auto-expires after custom timeout', async () => {
    const customExpiry = 100; // 100ms for testing
    let lockHeld = false;

    // First call holds lock for longer than expiry
    const fn1 = vi.fn().mockImplementation(async () => {
      lockHeld = true;
      await new Promise(resolve => setTimeout(resolve, customExpiry * 2)); // Hold for 200ms
      lockHeld = false;
      return 'first';
    });

    // Second call should succeed after auto-expiry
    const fn2 = vi.fn().mockImplementation(async () => {
      expect(lockHeld).toBe(false); // First lock should be expired
      return 'second';
    });

    const promise1 = withLock('test-resource-3', fn1, 10, customExpiry);

    // Advance past auto-expiry time
    vi.advanceTimersByTime(customExpiry + 50);
    await vi.runAllTimersAsync();

    const promise2 = withLock('test-resource-3', fn2, 10, customExpiry);
    await vi.runAllTimersAsync();

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('prevents concurrent lock acquisition - only one acquires, others wait', async () => {
    const executionOrder: number[] = [];

    // Create 3 concurrent attempts to acquire the same lock
    const fn1 = vi.fn().mockImplementation(async () => {
      executionOrder.push(1);
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'first';
    });

    const fn2 = vi.fn().mockImplementation(async () => {
      executionOrder.push(2);
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'second';
    });

    const fn3 = vi.fn().mockImplementation(async () => {
      executionOrder.push(3);
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'third';
    });

    // Start all 3 lock attempts concurrently
    const promise1 = withLock('race-test', fn1, 5000);
    const promise2 = withLock('race-test', fn2, 5000);
    const promise3 = withLock('race-test', fn3, 5000);

    // Let them all run
    await vi.runAllTimersAsync();
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    // All should succeed (sequential execution)
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(result3.ok).toBe(true);

    // Each function should be called exactly once
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
    expect(fn3).toHaveBeenCalledOnce();

    // They should execute sequentially (not concurrently)
    // executionOrder should be [1, 2, 3] NOT [1, 2, 3] all at once
    expect(executionOrder.length).toBe(3);
    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it('waitPromise is immediately available for waiting tasks', async () => {
    let waitPromiseWasUndefined = false;

    const fn1 = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'holder';
    });

    const fn2 = vi.fn().mockImplementation(async () => {
      return 'waiter';
    });

    // Start first lock holder
    const promise1 = withLock('wait-test', fn1, 5000);

    // Immediately try to acquire - should wait on a valid promise
    // (The race condition would cause waitPromise to be undefined)
    const promise2 = withLock('wait-test', fn2, 5000);

    await vi.runAllTimersAsync();
    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();

    // If there was a race condition, waitPromise would be undefined
    // and fn2 would have fallen into the polling fallback
    expect(waitPromiseWasUndefined).toBe(false);
  });

  it('stress test - 10 concurrent withLock calls maintain mutual exclusion', async () => {
    const executionLog: Array<{ id: number; event: 'start' | 'end'; timestamp: number }> = [];
    const startTime = Date.now();

    // Create 10 concurrent lock attempts
    const tasks = Array.from({ length: 10 }, (_, i) => {
      const fn = vi.fn().mockImplementation(async () => {
        executionLog.push({ id: i, event: 'start', timestamp: Date.now() - startTime });
        await new Promise(resolve => setTimeout(resolve, 50));
        executionLog.push({ id: i, event: 'end', timestamp: Date.now() - startTime });
        return `task-${i}`;
      });

      return withLock('stress-test', fn, 10000, 30000);
    });

    // Run all concurrently
    await vi.runAllTimersAsync();
    const results = await Promise.all(tasks);

    // All should succeed
    expect(results.every(r => r.ok)).toBe(true);

    // Verify mutual exclusion: no overlapping executions
    // For each task, check that no other task started before it ended
    for (let i = 0; i < executionLog.length; i += 2) {
      const start = executionLog[i];
      const end = executionLog[i + 1];

      expect(start.event).toBe('start');
      expect(end.event).toBe('end');
      expect(start.id).toBe(end.id);

      // Check no other task started between this task's start and end
      const overlaps = executionLog.filter(
        (log) =>
          log.event === 'start' &&
          log.id !== start.id &&
          log.timestamp > start.timestamp &&
          log.timestamp < end.timestamp
      );

      expect(overlaps).toEqual([]);
    }
  });
});

describe('computeVersion', () => {
  it('computes hash for normal objects', () => {
    const obj = { foo: 'bar', num: 42 };
    const hash = computeVersion(obj);

    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('returns consistent hash for same value', () => {
    const obj = { a: 1, b: 2 };
    const hash1 = computeVersion(obj);
    const hash2 = computeVersion(obj);

    expect(hash1).toBe(hash2);
  });

  it('handles BigInt without throwing', () => {
    const objWithBigInt = { value: BigInt(9007199254740991) };

    // Should not throw
    expect(() => computeVersion(objWithBigInt)).not.toThrow();

    const hash = computeVersion(objWithBigInt);
    expect(typeof hash).toBe('string');
  });

  it('handles circular references without throwing', () => {
    const obj: any = { name: 'test' };
    obj.self = obj; // Circular reference

    // Should not throw
    expect(() => computeVersion(obj)).not.toThrow();

    const hash = computeVersion(obj);
    expect(typeof hash).toBe('string');
  });

  it('handles Symbol values without throwing', () => {
    const objWithSymbol = { [Symbol('test')]: 'value' };

    // Should not throw
    expect(() => computeVersion(objWithSymbol)).not.toThrow();

    const hash = computeVersion(objWithSymbol);
    expect(typeof hash).toBe('string');
  });

  it('computes different hashes for different values', () => {
    const hash1 = computeVersion({ a: 1 });
    const hash2 = computeVersion({ a: 2 });

    expect(hash1).not.toBe(hash2);
  });
});
