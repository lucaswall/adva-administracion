/**
 * Rate limiter utility using sliding window algorithm
 */

/**
 * Rate limiter interface
 */
export interface RateLimiter {
  /**
   * Check if a request is allowed for the given key
   * @param key - Identifier for rate limiting (e.g., channelId, IP address)
   * @returns Result indicating if request is allowed and remaining quota
   */
  check(key: string): RateLimitResult;
}

/**
 * Result of rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests in current window */
  remaining: number;
  /** Milliseconds until the rate limit resets (only relevant when blocked) */
  resetMs: number;
}

/**
 * Creates a rate limiter with sliding window algorithm
 *
 * @param windowMs - Time window in milliseconds
 * @param maxRequests - Maximum number of requests allowed in the window
 * @returns Rate limiter instance
 *
 * @example
 * ```typescript
 * const limiter = createRateLimiter(60000, 60); // 60 requests per minute
 * const result = limiter.check('channel-id-123');
 * if (!result.allowed) {
 *   console.log(`Rate limited. Try again in ${result.resetMs}ms`);
 * }
 * ```
 */
export function createRateLimiter(windowMs: number, maxRequests: number): RateLimiter {
  // Map of key -> array of request timestamps
  const requestLog = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const windowStart = now - windowMs;

      // Get or initialize request log for this key
      let requests = requestLog.get(key);
      if (!requests) {
        requests = [];
        requestLog.set(key, requests);
      }

      // Remove requests outside the current window (cleanup)
      const validRequests = requests.filter(timestamp => timestamp > windowStart);

      // Check if under limit
      if (validRequests.length < maxRequests) {
        // Allow request and record timestamp
        validRequests.push(now);
        requestLog.set(key, validRequests);

        return {
          allowed: true,
          remaining: maxRequests - validRequests.length,
          resetMs: 0,
        };
      }

      // Rate limit exceeded
      // Update the map with cleaned requests (prevents memory leak for abandoned keys)
      requestLog.set(key, validRequests);

      // Calculate when the oldest request will expire
      const oldestRequest = validRequests[0] || now;
      const resetMs = Math.max(0, oldestRequest + windowMs - now);

      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    },
  };
}
