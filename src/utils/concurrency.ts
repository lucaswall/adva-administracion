/**
 * Concurrency control utilities for preventing race conditions in matching
 * Implements optimistic locking using version checks
 */

import { createHash } from 'crypto';
import type { Result } from '../types/index.js';
import { warn, debug } from './logger.js';
import { getCorrelationId } from './correlation.js';
import {
  QUOTA_THROTTLE_BASE_DELAY_MS,
  QUOTA_THROTTLE_MAX_DELAY_MS,
  QUOTA_THROTTLE_RESET_MS,
} from '../config.js';

/**
 * Represents a versioned value for optimistic locking
 */
export interface VersionedValue<T> {
  /** The actual value */
  value: T;
  /** Version identifier (e.g., hash or timestamp) */
  version: string;
}

/**
 * Lock state for a resource
 */
interface LockState {
  /** Whether the lock is held */
  locked: boolean;
  /** When the lock was acquired */
  acquiredAt: number;
  /** Auto-expiry timeout for this lock */
  autoExpiryMs: number;
  /** Correlation ID of the holder */
  holderCorrelationId?: string;
  /** Promise that resolves when lock is released */
  waitPromise?: Promise<void>;
  /** Resolve function to release waiters */
  /** Unique instance ID for this lock (for atomic compare-and-swap on expiry) */
  lockInstanceId?: string;
  waitResolve?: () => void;
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay between retries in ms */
  baseDelayMs: number;
  /** Maximum delay between retries in ms */
  maxDelayMs: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
};

/**
 * Lock timeout in milliseconds - locks auto-release after this time
 */
const LOCK_TIMEOUT_MS = 30000; // 30 seconds

let lockInstanceIdCounter = 0;

/**
 * In-memory lock manager for resources
 */
class LockManager {
  private locks = new Map<string, LockState>();

  /**
   * Attempts to atomically acquire a lock, handling expiry in the same operation.
   *
   * ATOMICITY: This uses a compare-and-swap pattern where:
   * 1. We read current state
   * 2. Determine if we can acquire (no lock OR expired lock)
   * 3. Create new state with unique instance ID
   * 4. Set the new state
   * 5. Verify our instance ID is in the map (we won the race)
   *
   * If two operations both see an expired lock, they will both set their state,
   * but only one will have their lockInstanceId in the map after - the second
   * one to call Map.set() wins. The loser will fail the verification and retry.
   *
   * @param resourceId - Unique identifier for the resource
   * @param timeoutMs - Maximum time to wait for the lock
   * @param autoExpiryMs - Lock auto-expiry timeout (defaults to LOCK_TIMEOUT_MS = 30s)
   * @returns The lockInstanceId string if acquired, false if timeout
   */
  async acquire(resourceId: string, timeoutMs: number = 5000, autoExpiryMs: number = LOCK_TIMEOUT_MS): Promise<string | false> {
    const startTime = Date.now();
    const correlationId = getCorrelationId();
    const myLockInstanceId = String(++lockInstanceIdCounter) + '-' + Math.random().toString(36).slice(2);

    while (Date.now() - startTime < timeoutMs) {
      // === ATOMIC BLOCK START ===
      // All operations below until "ATOMIC BLOCK END" are synchronous
      // JavaScript single-threading guarantees no interleaving here

      const state = this.locks.get(resourceId);
      const now = Date.now();

      // Determine if we can acquire: no lock OR lock is expired
      let canAcquire = false;
      let isExpiredLock = false;
      let lockAge = 0;
      let oldWaitResolve: (() => void) | undefined;

      if (!state?.locked) {
        // No lock held - can acquire
        canAcquire = true;
      } else if (state.acquiredAt) {
        // Lock exists - check if expired using THE LOCK'S OWN expiry timeout
        lockAge = now - state.acquiredAt;
        if (lockAge > state.autoExpiryMs) {
          // Lock is expired - can acquire by overwriting
          canAcquire = true;
          isExpiredLock = true;
          oldWaitResolve = state.waitResolve;
        }
      }

      if (canAcquire) {
        // Create wait promise synchronously (executor runs immediately)
        let resolver: () => void = () => {};
        const waitPromise = new Promise<void>((resolve) => {
          resolver = resolve;
        });

        // Set our lock state - this overwrites any existing state atomically
        this.locks.set(resourceId, {
          locked: true,
          acquiredAt: now,
          autoExpiryMs,
          holderCorrelationId: correlationId,
          lockInstanceId: myLockInstanceId,
          waitPromise,
          waitResolve: resolver,
        });

        // CRITICAL: Verify we won the race
        // If another operation set their state after us, their ID will be here
        const verifyState = this.locks.get(resourceId);
        if (verifyState?.lockInstanceId === myLockInstanceId) {
          // === ATOMIC BLOCK END - WE WON ===

          // Notify old waiters (safe to do after we have the lock)
          if (isExpiredLock && oldWaitResolve) {
            oldWaitResolve();
            warn('Lock expired, force acquired by new holder', {
              module: 'concurrency',
              resourceId,
              lockAge,
              autoExpiryMs: state?.autoExpiryMs,
              oldHolder: state?.holderCorrelationId,
              newHolder: correlationId,
            });
          }

          debug('Lock acquired', {
            module: 'concurrency',
            resourceId,
            correlationId,
          });

          return myLockInstanceId;
        }
        // === ATOMIC BLOCK END - WE LOST ===
        // Another operation set their lock after us - continue to wait for it
      }

      // Lock is held (and not expired) OR we lost the race - wait for release
      const currentState = this.locks.get(resourceId);
      if (currentState?.waitPromise) {
        const remainingTime = timeoutMs - (Date.now() - startTime);
        if (remainingTime <= 0) break;

        await Promise.race([
          currentState.waitPromise,
          new Promise((resolve) => setTimeout(resolve, Math.min(remainingTime, 100))),
        ]);
      } else {
        // No wait promise, just poll
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    warn('Failed to acquire lock - timeout', {
      module: 'concurrency',
      resourceId,
      timeoutMs,
      correlationId,
    });

    return false;
  }

  /**
   * Releases a lock for a resource.
   *
   * Uses compare-and-swap: if `lockInstanceId` is provided, the entry is only
   * deleted when it matches the current holder's ID. This prevents a stale
   * release from an expired lock holder from evicting a newer lock holder.
   *
   * @param resourceId - Unique identifier for the resource
   * @param lockInstanceId - Instance ID from acquire(); if provided, CAS-checked
   */
  release(resourceId: string, lockInstanceId?: string): void {
    const state = this.locks.get(resourceId);

    if (lockInstanceId !== undefined && state?.lockInstanceId !== lockInstanceId) {
      // CAS mismatch: this caller's lock was superseded by a newer holder.
      // Silently no-op — the new holder's release will clean up.
      debug('Stale release ignored: lock acquired by new holder', {
        module: 'concurrency',
        resourceId,
        callerInstanceId: lockInstanceId,
        currentInstanceId: state?.lockInstanceId,
        correlationId: getCorrelationId(),
      });
      return;
    }

    if (state?.waitResolve) {
      state.waitResolve();
    }

    this.locks.delete(resourceId);

    debug('Lock released', {
      module: 'concurrency',
      resourceId,
      correlationId: getCorrelationId(),
    });
  }

  /**
   * Checks if a resource is currently locked
   */
  isLocked(resourceId: string): boolean {
    const state = this.locks.get(resourceId);
    if (!state?.locked) return false;

    // Check for expired lock using the lock's specific auto-expiry timeout
    if (state.acquiredAt && Date.now() - state.acquiredAt > state.autoExpiryMs) {
      // Pass the current holder's instanceId so the CAS check in release() confirms
      // we are evicting the correct (expired) entry rather than a newly acquired one.
      this.release(resourceId, state.lockInstanceId);
      return false;
    }

    return true;
  }

  /**
   * Clears all locks (for testing)
   */
  clearAll(): void {
    for (const [, state] of this.locks) {
      if (state.waitResolve) {
        state.waitResolve();
      }
    }
    this.locks.clear();
  }
}

/**
 * Global lock manager instance
 */
const lockManager = new LockManager();

/**
 * Executes a function with an exclusive lock on a resource
 *
 * @param resourceId - Unique identifier for the resource to lock
 * @param fn - Function to execute while holding the lock
 * @param timeoutMs - Maximum time to wait for the lock
 * @param autoExpiryMs - Lock auto-expiry timeout (defaults to LOCK_TIMEOUT_MS = 30s)
 * @returns Result with the function return value or error
 */
export async function withLock<T>(
  resourceId: string,
  fn: () => Promise<T>,
  timeoutMs: number = 5000,
  autoExpiryMs: number = LOCK_TIMEOUT_MS
): Promise<Result<T, Error>> {
  const lockInstanceId = await lockManager.acquire(resourceId, timeoutMs, autoExpiryMs);

  if (!lockInstanceId) {
    return {
      ok: false,
      error: new Error(`Failed to acquire lock for ${resourceId} within ${timeoutMs}ms`),
    };
  }

  try {
    const result = await fn();
    return { ok: true, value: result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  } finally {
    // CAS release: only removes our entry; stale releases from expired holders are ignored.
    lockManager.release(resourceId, lockInstanceId);
  }
}

/**
 * Like `withLock`, but flattens a `Result<T, E>`-returning body so the caller
 * does not have to unwrap a nested `Result<Result<T, E>, Error>`.
 *
 * - Lock-acquire timeout → returns the outer ok:false (Error).
 * - Body returns ok:true   → returns the body's Result as-is.
 * - Body returns ok:false  → returns the body's Result as-is.
 * - Body throws            → returns ok:false with the thrown error (matches `withLock`).
 *
 * @param resourceId - Unique identifier for the resource to lock
 * @param fn - Body that itself returns a Result
 * @param timeoutMs - Maximum time to wait for the lock
 * @param autoExpiryMs - Lock auto-expiry timeout (defaults to LOCK_TIMEOUT_MS)
 */
export async function withLockResult<T, E extends Error = Error>(
  resourceId: string,
  fn: () => Promise<Result<T, E>>,
  timeoutMs: number = 5000,
  autoExpiryMs: number = LOCK_TIMEOUT_MS
): Promise<Result<T, E | Error>> {
  const outer = await withLock<Result<T, E>>(resourceId, fn, timeoutMs, autoExpiryMs);
  if (!outer.ok) {
    return { ok: false, error: outer.error };
  }
  return outer.value;
}

/**
 * Executes a function with retry on conflict
 * Uses exponential backoff between retries
 *
 * @param fn - Function to execute (should throw on conflict)
 * @param config - Retry configuration
 * @returns Result with the function return value or error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<Result<T, Error>> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY_CONFIG, ...config };
  const correlationId = getCorrelationId();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { ok: true, value: result };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        // Calculate exponential backoff with jitter
        const delay = Math.min(
          baseDelayMs * Math.pow(2, attempt) + Math.random() * baseDelayMs,
          maxDelayMs
        );

        debug('Retrying after conflict', {
          module: 'concurrency',
          attempt: attempt + 1,
          maxRetries,
          delayMs: Math.round(delay),
          error: lastError.message,
          correlationId,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  warn('All retries exhausted', {
    module: 'concurrency',
    maxRetries,
    error: lastError?.message,
    correlationId,
  });

  return {
    ok: false,
    error: lastError || new Error('Unknown error after retries'),
  };
}

/**
 * Version conflict error for optimistic locking
 */
export class VersionConflictError extends Error {
  constructor(
    public readonly resourceId: string,
    public readonly expectedVersion: string,
    public readonly actualVersion: string
  ) {
    super(`Version conflict for ${resourceId}: expected ${expectedVersion}, got ${actualVersion}`);
    this.name = 'VersionConflictError';
  }
}

/**
 * Computes a hash for a value (for version comparison)
 * Uses MD5 for better collision resistance than DJB2 (ADV-33)
 * Handles BigInt, Symbols, and circular references safely
 */
export function computeVersion(value: unknown): string {
  let str: string;

  try {
    // Replacer function to handle BigInt values
    str = JSON.stringify(value, (_, v) => {
      // Convert BigInt to string
      if (typeof v === 'bigint') {
        return v.toString();
      }
      return v;
    });
  } catch (error) {
    // Handle circular references and other stringify errors
    // Use a simple fallback that includes type information
    // Check for both V8/Node ("circular") and Firefox ("cyclic") messages
    if (error instanceof Error && (error.message.includes('circular') || error.message.includes('cyclic'))) {
      str = '[Circular]';
    } else {
      str = String(value);
    }
  }

  // Use MD5 for better collision resistance (returns 16-char hex)
  return createHash('md5').update(str).digest('hex').slice(0, 16);
}

/**
 * Global quota throttle that reduces throughput when quota errors are detected.
 *
 * When any operation reports a quota error, the throttle imposes a global delay
 * on all subsequent operations. The delay increases with consecutive errors
 * (exponential backoff) and resets after a quiet period with no errors.
 *
 * This is cooperative — operations voluntarily call waitForClearance() before
 * making API calls. It is NOT an enforced central queue.
 */
class QuotaThrottle {
  private consecutiveErrors = 0;
  private lastErrorTime = 0;
  private baseDelayMs: number;
  private maxDelayMs: number;
  private resetMs: number;

  constructor(baseDelayMs: number, maxDelayMs: number, resetMs: number) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.resetMs = resetMs;
  }

  /**
   * Signals that a quota error occurred, increasing global backoff
   */
  reportQuotaError(): void {
    this.consecutiveErrors++;
    this.lastErrorTime = Date.now();
    debug('Quota error reported to global throttle', {
      module: 'concurrency',
      consecutiveErrors: this.consecutiveErrors,
      delayMs: this.getCurrentDelayMs(),
    });
  }

  /**
   * Returns the current delay in milliseconds (0 if no throttling active)
   */
  getCurrentDelayMs(): number {
    if (this.consecutiveErrors === 0) return 0;

    // Auto-reset if enough time has passed since last error
    const timeSinceLastError = Date.now() - this.lastErrorTime;
    if (timeSinceLastError > this.resetMs) {
      this.consecutiveErrors = 0;
      return 0;
    }

    // Exponential backoff: base * 2^(errors-1), capped at max
    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, this.consecutiveErrors - 1),
      this.maxDelayMs,
    );
    return delay;
  }

  /**
   * Returns a promise that resolves after the current global backoff delay.
   * If no throttling is active, resolves immediately.
   */
  async waitForClearance(): Promise<void> {
    const delay = this.getCurrentDelayMs();
    if (delay > 0) {
      debug('Waiting for quota clearance', {
        module: 'concurrency',
        delayMs: delay,
        consecutiveErrors: this.consecutiveErrors,
      });
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Resets throttle state (for testing)
   */
  reset(): void {
    this.consecutiveErrors = 0;
    this.lastErrorTime = 0;
  }
}

let _quotaThrottle: QuotaThrottle | null = null;

/**
 * Gets the global QuotaThrottle singleton.
 */
function getQuotaThrottle(): QuotaThrottle {
  if (!_quotaThrottle) {
    _quotaThrottle = new QuotaThrottle(
      QUOTA_THROTTLE_BASE_DELAY_MS,
      QUOTA_THROTTLE_MAX_DELAY_MS,
      QUOTA_THROTTLE_RESET_MS,
    );
  }
  return _quotaThrottle;
}

/**
 * Global quota throttle singleton, exported for direct use and testing
 */
export const quotaThrottle = {
  reportQuotaError: () => getQuotaThrottle().reportQuotaError(),
  waitForClearance: () => getQuotaThrottle().waitForClearance(),
  getCurrentDelayMs: () => getQuotaThrottle().getCurrentDelayMs(),
  reset: () => getQuotaThrottle().reset(),
};

/**
 * Configuration for quota-aware retries (Google Sheets API)
 * Quota resets every 60 seconds
 */
export const SHEETS_QUOTA_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 15000,      // Start at 15 seconds
  maxDelayMs: 65000,       // Max 65 seconds (full quota reset + buffer)
};

/**
 * Checks if an error is a Google API quota error
 *
 * @param error - Error object to check
 * @returns true if the error is quota-related
 */
export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  // Check for quota exceeded messages
  if (message.includes('quota exceeded')) return true;
  if (message.includes('rate limit')) return true;
  if (message.includes('too many requests')) return true;
  // Check for HTTP 429 status
  if (message.includes('429')) return true;
  return false;
}

/**
 * Executes a function with quota-aware retry
 * Uses longer delays for quota errors, standard delays for others
 *
 * If `signal` is provided and aborted, the function exits early WITHOUT
 * mutating the global `quotaThrottle` and clears any pending retry-backoff
 * timer. This is the cancellation path used by `isDescendantOf` (ADV-224)
 * to prevent abandoned coroutines from inflating global Drive backoff or
 * leaking timers after their caller has already returned.
 *
 * @param fn - Function to execute
 * @param standardConfig - Retry config for non-quota errors
 * @param quotaConfig - Retry config for quota errors
 * @param signal - Optional AbortSignal for cooperative cancellation
 * @returns Result with the function return value or error
 */
export async function withQuotaRetry<T>(
  fn: () => Promise<T>,
  standardConfig: Partial<RetryConfig> = {},
  quotaConfig: Partial<RetryConfig> = SHEETS_QUOTA_RETRY_CONFIG,
  signal?: AbortSignal
): Promise<Result<T, Error>> {
  const standard = { ...DEFAULT_RETRY_CONFIG, ...standardConfig };
  const quota = { ...SHEETS_QUOTA_RETRY_CONFIG, ...quotaConfig };
  const correlationId = getCorrelationId();

  let lastError: Error | null = null;
  let attempt = 0;
  const maxAttempts = Math.max(standard.maxRetries, quota.maxRetries);
  const throttle = getQuotaThrottle();

  while (attempt <= maxAttempts) {
    // Cooperative cancellation: exit before each attempt without inflating
    // the global throttle or scheduling further retries (ADV-224).
    if (signal?.aborted) {
      return {
        ok: false,
        error: new Error(`Aborted: ${String(signal.reason ?? 'unknown')}`),
      };
    }

    try {
      // Wait for global quota clearance before each attempt
      await throttle.waitForClearance();
      // Re-check abort after the throttle wait — `waitForClearance` can block
      // for up to QUOTA_THROTTLE_MAX_DELAY_MS, and if abort fires during that
      // window we must NOT proceed to fn() (which would be a real Drive call
      // after the caller's deadline already returned). ADV-224 follow-up.
      if (signal?.aborted) {
        return {
          ok: false,
          error: new Error(`Aborted: ${String(signal.reason ?? 'unknown')}`),
        };
      }
      const result = await fn();
      return { ok: true, value: result };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Skip throttle inflation only when the caller had already aborted before
      // fn() was invoked (pre-aborted signal). If abort fires during fn() or
      // during backoff, reportQuotaError may still have been called for that
      // attempt — this is accepted behaviour for cooperative cancellation:
      // the next loop iteration's signal-check exits before any further
      // throttle inflation. ADV-224.
      if (isQuotaError(lastError) && !signal?.aborted) {
        throttle.reportQuotaError();
      }

      if (attempt < maxAttempts) {
        const config = isQuotaError(lastError) ? quota : standard;
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt) + Math.random() * config.baseDelayMs,
          config.maxDelayMs
        );

        debug('Retrying after error', {
          module: 'concurrency',
          attempt: attempt + 1,
          isQuotaError: isQuotaError(lastError),
          delayMs: Math.round(delay),
          error: lastError.message,
          correlationId,
        });

        // Abortable retry-backoff: signal abort clears the timer so we don't
        // hold the event loop alive past the caller's deadline. The abort
        // listener is removed when the timer fires naturally, preventing
        // accumulation if the signal outlives this call (ADV-224).
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve();
            return;
          }
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, delay);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
      attempt++;
    }
  }

  return {
    ok: false,
    error: lastError || new Error('Unknown error after retries'),
  };
}

/**
 * Clears all locks (for testing)
 */
export function clearAllLocks(): void {
  lockManager.clearAll();
}

