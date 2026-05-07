/**
 * DailyBudget — in-process daily request cap for the Gemini API.
 *
 * Tracks how many Gemini requests have been made in the current UTC calendar
 * day. When the count reaches the configured cap, `consume()` returns an error
 * instead of allowing the call through.
 *
 * Design decisions:
 * - Counter is **in-memory only** — a process restart resets it.
 *   This is an acceptable trade-off: Railway restarts daily anyway, and the
 *   feature is opt-in via the `GEMINI_DAILY_BUDGET` env var.
 * - Clock source is `Date.now()` (injectable for testing via subclass or mock).
 * - cap=0 means **disabled** — all calls pass through unconditionally.
 * - The 80%-threshold warning is emitted at most once per calendar day to avoid
 *   log spam.
 */

import type { Result } from '../types/index.js';
import { warn } from '../utils/logger.js';

/**
 * Status snapshot returned by `getStatus()`.
 */
export interface DailyBudgetStatus {
  /** Current call count for the active UTC calendar day. */
  count: number;
  /** Configured daily cap (0 = disabled). */
  cap: number;
  /** True when cap=0 (budget check is a no-op). */
  disabled: boolean;
}

/**
 * Returns the UTC date string "YYYY-MM-DD" for the given timestamp.
 * Used to detect day rollovers.
 */
function utcDateKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Daily request-count cap for the Gemini API.
 *
 * Wire into `GeminiClient.analyzeDocument` BEFORE `enforceRateLimit`:
 * ```
 * const budgetResult = budget.consume();
 * if (!budgetResult.ok) return { ok: false, error: new GeminiError(budgetResult.error, 429) };
 * ```
 */
export class DailyBudget {
  private readonly cap: number;
  private count: number = 0;
  private currentDayKey: string;
  private warnedThisWindow: boolean = false;

  /**
   * @param cap - Maximum requests per UTC calendar day. 0 = disabled (unlimited).
   */
  constructor(cap: number) {
    this.cap = cap;
    this.currentDayKey = utcDateKey(Date.now());
  }

  /**
   * Attempts to consume one unit from the daily budget.
   *
   * @returns `{ ok: true }` if within budget, `{ ok: false, error }` if exhausted.
   */
  consume(): Result<void, string> {
    this.maybeReset();

    // Disabled mode — always allow
    if (this.cap === 0) {
      return { ok: true, value: undefined };
    }

    // Over cap — reject
    if (this.count >= this.cap) {
      return {
        ok: false,
        error: `Daily Gemini budget exhausted (${this.count}/${this.cap} requests today)`
      };
    }

    // Increment
    this.count++;

    // Check 80% threshold warning (emit at most once per window)
    const threshold = Math.ceil(this.cap * 0.8);
    if (!this.warnedThisWindow && this.count >= threshold) {
      this.warnedThisWindow = true;
      warn('Daily Gemini budget at 80% threshold', {
        module: 'gemini-budget',
        phase: 'threshold-warning',
        count: this.count,
        cap: this.cap,
        percentUsed: Math.round((this.count / this.cap) * 100),
      });
    }

    return { ok: true, value: undefined };
  }

  /**
   * Returns a status snapshot of the current budget state.
   */
  getStatus(): DailyBudgetStatus {
    this.maybeReset();
    return {
      count: this.count,
      cap: this.cap,
      disabled: this.cap === 0,
    };
  }

  /**
   * Resets the counter if we have rolled into a new UTC calendar day.
   */
  private maybeReset(): void {
    const todayKey = utcDateKey(Date.now());
    if (todayKey !== this.currentDayKey) {
      this.count = 0;
      this.currentDayKey = todayKey;
      this.warnedThisWindow = false;
    }
  }
}
