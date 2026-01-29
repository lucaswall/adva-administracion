/**
 * Tests for rate limiter utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRateLimiter } from './rate-limiter.js';

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the limit', () => {
    const limiter = createRateLimiter(60000, 10); // 10 requests per minute

    for (let i = 0; i < 10; i++) {
      const result = limiter.check('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10 - i - 1);
    }
  });

  it('blocks requests over the limit', () => {
    const limiter = createRateLimiter(60000, 5); // 5 requests per minute

    // Use up the limit
    for (let i = 0; i < 5; i++) {
      const result = limiter.check('test-key');
      expect(result.allowed).toBe(true);
    }

    // Next request should be blocked
    const result = limiter.check('test-key');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetMs).toBeGreaterThan(0);
  });

  it('resets limit after window expires', () => {
    const limiter = createRateLimiter(60000, 3); // 3 requests per minute

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      const result = limiter.check('test-key');
      expect(result.allowed).toBe(true);
    }

    // Next request should be blocked
    const blockedResult = limiter.check('test-key');
    expect(blockedResult.allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(61000); // 61 seconds

    // Should allow new requests now
    const allowedResult = limiter.check('test-key');
    expect(allowedResult.allowed).toBe(true);
    expect(allowedResult.remaining).toBe(2);
  });

  it('handles multiple keys independently', () => {
    const limiter = createRateLimiter(60000, 3);

    // Use up limit for key1
    for (let i = 0; i < 3; i++) {
      const result = limiter.check('key1');
      expect(result.allowed).toBe(true);
    }

    // key1 should be blocked
    const key1Blocked = limiter.check('key1');
    expect(key1Blocked.allowed).toBe(false);

    // key2 should still be allowed
    const key2Result = limiter.check('key2');
    expect(key2Result.allowed).toBe(true);
    expect(key2Result.remaining).toBe(2);
  });

  it('uses sliding window for rate limiting', () => {
    const limiter = createRateLimiter(60000, 5); // 5 requests per minute

    // Use 3 requests
    for (let i = 0; i < 3; i++) {
      limiter.check('test-key');
    }

    // Advance time by 30 seconds
    vi.advanceTimersByTime(30000);

    // Use 2 more requests (total 5 in first 30s)
    for (let i = 0; i < 2; i++) {
      const result = limiter.check('test-key');
      expect(result.allowed).toBe(true);
    }

    // Should be blocked now (5 requests in last 60s)
    const blockedResult = limiter.check('test-key');
    expect(blockedResult.allowed).toBe(false);

    // Advance time by 31 more seconds (total 61s from start)
    // First 3 requests should be outside the window now
    vi.advanceTimersByTime(31000);

    // Should allow new requests (only 2 requests in last 60s)
    const allowedResult = limiter.check('test-key');
    expect(allowedResult.allowed).toBe(true);
  });

  it('cleans up expired entries', () => {
    const limiter = createRateLimiter(60000, 5);

    // Make requests for multiple keys
    limiter.check('key1');
    limiter.check('key2');
    limiter.check('key3');

    // Advance time past window
    vi.advanceTimersByTime(61000);

    // Make new requests (should trigger cleanup)
    limiter.check('key1');
    limiter.check('key2');

    // All old entries should be cleaned up
    // We can't directly check internal state, but we can verify behavior
    const result1 = limiter.check('key1');
    expect(result1.remaining).toBe(3); // Should have 5 - 2 = 3 remaining

    const result2 = limiter.check('key2');
    expect(result2.remaining).toBe(3);
  });

  it('calculates resetMs correctly', () => {
    const limiter = createRateLimiter(60000, 2);

    const now = Date.now();
    vi.setSystemTime(now);

    // First request
    limiter.check('test-key');

    // Advance 1 second
    vi.advanceTimersByTime(1000);

    // Second request
    limiter.check('test-key');

    // Third request should be blocked
    const result = limiter.check('test-key');
    expect(result.allowed).toBe(false);

    // resetMs should be approximately 59000 (60000 - 1000)
    // The oldest request will expire in ~59s
    expect(result.resetMs).toBeGreaterThan(58000);
    expect(result.resetMs).toBeLessThanOrEqual(60000);
  });

  describe('cleanup', () => {
    it('removes keys with all-expired timestamps', () => {
      const limiter = createRateLimiter(60000, 5);

      // Create entries for multiple keys
      limiter.check('key1');
      limiter.check('key2');
      limiter.check('key3');

      // Advance time past window to make all timestamps expire
      vi.advanceTimersByTime(61000);

      // Call cleanup
      const removedCount = limiter.cleanup();

      // Should have removed all 3 keys with expired timestamps
      expect(removedCount).toBe(3);

      // New requests should start fresh
      const result = limiter.check('key1');
      expect(result.remaining).toBe(4); // 5 - 1 = 4
    });

    it('removes keys with empty arrays', () => {
      const limiter = createRateLimiter(60000, 5);

      // Create entries
      limiter.check('key1');
      limiter.check('key2');

      // Advance time to expire all
      vi.advanceTimersByTime(61000);

      // Call cleanup
      const removedCount = limiter.cleanup();

      // Should remove both keys
      expect(removedCount).toBe(2);
    });

    it('preserves active keys after cleanup', () => {
      const limiter = createRateLimiter(60000, 5);

      // Create old entries
      limiter.check('old-key1');
      limiter.check('old-key2');

      // Advance time to expire old entries
      vi.advanceTimersByTime(61000);

      // Create fresh entries
      limiter.check('active-key1');
      limiter.check('active-key2');
      limiter.check('active-key1'); // Second request

      // Call cleanup
      const removedCount = limiter.cleanup();

      // Should remove only the 2 old keys
      expect(removedCount).toBe(2);

      // Active keys should still have their state
      const result1 = limiter.check('active-key1');
      expect(result1.remaining).toBe(2); // 5 - 3 = 2

      const result2 = limiter.check('active-key2');
      expect(result2.remaining).toBe(3); // 5 - 2 = 3
    });

    it('reduces key count after cleanup', () => {
      const limiter = createRateLimiter(60000, 5);

      // Create many keys (simulating webhook UUIDs)
      for (let i = 0; i < 100; i++) {
        limiter.check(`uuid-${i}`);
      }

      // Advance time to expire all
      vi.advanceTimersByTime(61000);

      // Call cleanup
      const removedCount = limiter.cleanup();

      // Should have removed all 100 keys
      expect(removedCount).toBe(100);
    });
  });
});
