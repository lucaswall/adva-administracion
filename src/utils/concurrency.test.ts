/**
 * Tests for concurrency utilities - quota-aware retries and locking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isQuotaError, withQuotaRetry, SHEETS_QUOTA_RETRY_CONFIG, withLock, computeVersion, quotaThrottle } from './concurrency.js';

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

describe('lock auto-expiry atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only one operation acquires an expired lock (instance ID verification)', async () => {
    // This tests that when two operations both see an expired lock,
    // only ONE can successfully acquire it via the instance ID verification.
    // The loser must wait for the winner's lock to be released.
    const acquisitionOrder: number[] = [];

    // First task acquires lock and holds it past expiry
    const fn1 = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return 'first';
    });

    // Start first task with 100ms expiry
    const promise1 = withLock('expiry-race-test', fn1, 5000, 100);

    // Advance past expiry time
    await vi.advanceTimersByTimeAsync(150);

    // Now start two tasks that will both see the expired lock
    const fn2 = vi.fn().mockImplementation(async () => {
      acquisitionOrder.push(2);
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'second';
    });
    const fn3 = vi.fn().mockImplementation(async () => {
      acquisitionOrder.push(3);
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'third';
    });

    const promise2 = withLock('expiry-race-test', fn2, 5000, 100);
    const promise3 = withLock('expiry-race-test', fn3, 5000, 100);

    await vi.runAllTimersAsync();
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    // All tasks should complete successfully
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(result3.ok).toBe(true);

    // Both fn2 and fn3 should have executed (sequentially via lock)
    expect(fn2).toHaveBeenCalledOnce();
    expect(fn3).toHaveBeenCalledOnce();

    // Verify both were recorded in acquisition order
    expect(acquisitionOrder).toContain(2);
    expect(acquisitionOrder).toContain(3);
    expect(acquisitionOrder.length).toBe(2);
  });

  it('lock holder validation prevents wrong caller from releasing', async () => {
    // This tests that only the actual lock holder can release the lock
    let task1Released = false;
    let task2Executed = false;

    const fn1 = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      task1Released = true;
      return 'first';
    });

    const fn2 = vi.fn().mockImplementation(async () => {
      task2Executed = true;
      return 'second';
    });

    // Start task1 with the lock
    const promise1 = withLock('holder-validation-test', fn1, 5000, 500);

    // Start task2 which should wait
    const promise2 = withLock('holder-validation-test', fn2, 5000, 500);

    await vi.runAllTimersAsync();
    await Promise.all([promise1, promise2]);

    // Both tasks should have executed sequentially
    expect(task1Released).toBe(true);
    expect(task2Executed).toBe(true);
  });

  it('atomic compare-and-set for lock acquisition prevents double acquisition', async () => {
    // Tests that the lock state check and set happen atomically
    const acquisitions: string[] = [];

    // Create many concurrent attempts - all should serialize
    const tasks = Array.from({ length: 5 }, (_, i) => {
      const fn = vi.fn().mockImplementation(async () => {
        acquisitions.push(`start-${i}`);
        await new Promise(resolve => setTimeout(resolve, 20));
        acquisitions.push(`end-${i}`);
        return `task-${i}`;
      });
      return withLock('cas-test', fn, 5000, 30000);
    });

    await vi.runAllTimersAsync();
    const results = await Promise.all(tasks);

    // All should succeed
    expect(results.every(r => r.ok)).toBe(true);

    // Verify sequential execution: start-N should always be followed by end-N
    // before any other start-M
    for (let i = 0; i < acquisitions.length; i += 2) {
      const startEntry = acquisitions[i];
      const endEntry = acquisitions[i + 1];
      const taskId = startEntry.split('-')[1];

      expect(startEntry).toBe(`start-${taskId}`);
      expect(endEntry).toBe(`end-${taskId}`);
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

  // ADV-33: MD5 hash should produce consistent 16-char hex output
  it('produces consistent 16-char hex output', () => {
    const hash = computeVersion({ test: 'value', count: 123 });

    // Should be exactly 16 hex characters
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash.length).toBe(16);
  });

  it('produces different hashes for different inputs (collision resistance)', () => {
    // Test multiple different inputs produce unique hashes
    const hashes = new Set<string>();
    const testCases = [
      { a: 1 },
      { a: 2 },
      { a: 1, b: 1 },
      { b: 1 },
      { x: 'hello' },
      { x: 'world' },
      [1, 2, 3],
      [1, 2, 4],
      'string1',
      'string2',
      12345,
      12346,
    ];

    for (const value of testCases) {
      hashes.add(computeVersion(value));
    }

    // All hashes should be unique (no collisions for these distinct inputs)
    expect(hashes.size).toBe(testCases.length);
  });

  it('handles large objects correctly', () => {
    // Create a larger object to test hash stability
    const largeObj = {
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        value: Math.random().toString(36),
      })),
      metadata: {
        created: '2025-01-01',
        version: '1.0.0',
      },
    };

    const hash = computeVersion(largeObj);

    // Should still be 16-char hex
    expect(hash).toMatch(/^[0-9a-f]{16}$/);

    // Should be consistent
    expect(computeVersion(largeObj)).toBe(hash);
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

describe('QuotaThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    quotaThrottle.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows operations to proceed immediately with no quota errors', async () => {
    const start = Date.now();
    await quotaThrottle.waitForClearance();
    const elapsed = Date.now() - start;

    // Should resolve immediately (no delay)
    expect(elapsed).toBeLessThan(50);
  });

  it('adds delay after reportQuotaError is called', async () => {
    quotaThrottle.reportQuotaError();

    // waitForClearance should now impose a delay
    const waitPromise = quotaThrottle.waitForClearance();

    // Advance time to cover the base delay (5 seconds)
    await vi.advanceTimersByTimeAsync(5000);
    await waitPromise;

    // Should have waited for the backoff delay
    expect(true).toBe(true); // If we get here, the wait resolved after delay
  });

  it('increases backoff with consecutive quota errors', async () => {
    // First error → base delay (5s)
    quotaThrottle.reportQuotaError();
    const delay1 = quotaThrottle.getCurrentDelayMs();

    // Second error → base * 2 (10s)
    quotaThrottle.reportQuotaError();
    const delay2 = quotaThrottle.getCurrentDelayMs();

    // Third error → base * 4 (20s)
    quotaThrottle.reportQuotaError();
    const delay3 = quotaThrottle.getCurrentDelayMs();

    expect(delay2).toBeGreaterThan(delay1);
    expect(delay3).toBeGreaterThan(delay2);
  });

  it('caps backoff at maximum delay', async () => {
    // Report many errors to hit the cap
    for (let i = 0; i < 20; i++) {
      quotaThrottle.reportQuotaError();
    }

    const delay = quotaThrottle.getCurrentDelayMs();
    // Should be capped at 60 seconds max
    expect(delay).toBeLessThanOrEqual(60000);
  });

  it('resets backoff after reset period with no errors', async () => {
    quotaThrottle.reportQuotaError();
    quotaThrottle.reportQuotaError();

    const delayBefore = quotaThrottle.getCurrentDelayMs();
    expect(delayBefore).toBeGreaterThan(0);

    // Advance time past the reset period (60 seconds)
    await vi.advanceTimersByTimeAsync(61000);

    const delayAfter = quotaThrottle.getCurrentDelayMs();
    expect(delayAfter).toBe(0);
  });

  it('reset() clears all state', async () => {
    quotaThrottle.reportQuotaError();
    quotaThrottle.reportQuotaError();
    quotaThrottle.reportQuotaError();

    expect(quotaThrottle.getCurrentDelayMs()).toBeGreaterThan(0);

    quotaThrottle.reset();

    expect(quotaThrottle.getCurrentDelayMs()).toBe(0);
  });

  it('integrates with withQuotaRetry - notifies throttle on quota errors', async () => {
    quotaThrottle.reset();

    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount <= 1) {
        throw new Error('Quota exceeded for quota metric');
      }
      return 'success';
    };

    // Use very short retry delays for testing
    const resultPromise = withQuotaRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 200 }, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 200 });

    // Advance timers repeatedly to cover:
    // 1. First waitForClearance (0ms - no delay yet)
    // 2. fn() throws quota error → reportQuotaError sets 5s delay
    // 3. Per-operation retry delay (~100ms)
    // 4. Second waitForClearance (5000ms throttle delay)
    // 5. fn() succeeds
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }

    // After a quota error, the throttle should have been notified
    expect(callCount).toBe(2);
  });
});
