/**
 * Unit tests for DailyBudget — in-process daily request cap for the Gemini API.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DailyBudget } from './budget.js';
import * as loggerModule from '../utils/logger.js';

describe('DailyBudget', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('consume — basic accounting', () => {
    it('returns ok:true when under the cap', () => {
      const budget = new DailyBudget(10);
      const result = budget.consume();
      expect(result.ok).toBe(true);
    });

    it('returns ok:false and error message when cap is exceeded', () => {
      const budget = new DailyBudget(2);

      budget.consume(); // 1
      budget.consume(); // 2 — at cap

      // 3rd call exceeds cap
      const result = budget.consume();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/budget|limit|exhausted/i);
      }
    });

    it('allows exactly cap calls, rejects cap+1', () => {
      const cap = 5;
      const budget = new DailyBudget(cap);

      for (let i = 0; i < cap; i++) {
        expect(budget.consume().ok).toBe(true);
      }
      expect(budget.consume().ok).toBe(false);
    });

    it('returns ok:true for every call when cap is 0 (disabled)', () => {
      const budget = new DailyBudget(0); // 0 = disabled

      for (let i = 0; i < 100; i++) {
        expect(budget.consume().ok).toBe(true);
      }
    });
  });

  describe('UTC midnight reset', () => {
    it('resets counter at UTC midnight and allows new calls', () => {
      vi.useFakeTimers();

      // Start at a known UTC time: 2025-01-15 23:59:00 UTC
      const startMs = Date.UTC(2025, 0, 15, 23, 59, 0);
      vi.setSystemTime(startMs);

      const budget = new DailyBudget(2);
      budget.consume(); // 1
      budget.consume(); // 2 — at cap
      expect(budget.consume().ok).toBe(false); // over cap

      // Advance past UTC midnight (2 minutes later = 2025-01-16 00:01:00 UTC)
      vi.advanceTimersByTime(2 * 60 * 1000);

      // Counter should have reset — new day window
      const afterReset = budget.consume();
      expect(afterReset.ok).toBe(true);
    });

    it('does NOT reset before midnight', () => {
      vi.useFakeTimers();

      const startMs = Date.UTC(2025, 0, 15, 12, 0, 0); // noon UTC
      vi.setSystemTime(startMs);

      const budget = new DailyBudget(1);
      budget.consume(); // 1 — at cap

      // Advance 6 hours (still same UTC day)
      vi.advanceTimersByTime(6 * 60 * 60 * 1000);

      expect(budget.consume().ok).toBe(false);
    });
  });

  describe('80% threshold warning', () => {
    it('emits exactly one warn log when consumption reaches 80%', () => {
      const warnSpy = vi.spyOn(loggerModule, 'warn').mockImplementation(() => {});

      const budget = new DailyBudget(10); // cap=10, 80% = 8

      // Consume 7 — no warning yet
      for (let i = 0; i < 7; i++) {
        budget.consume();
      }
      expect(warnSpy).not.toHaveBeenCalled();

      // 8th call crosses 80% threshold
      budget.consume();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/80%|budget|threshold/i);
    });

    it('does NOT re-warn on subsequent calls after threshold is crossed', () => {
      const warnSpy = vi.spyOn(loggerModule, 'warn').mockImplementation(() => {});

      const budget = new DailyBudget(10); // cap=10, 80% = 8

      // Exhaust up to 80% + beyond
      for (let i = 0; i < 10; i++) {
        budget.consume();
      }

      // Should warn exactly once
      const warningCalls = warnSpy.mock.calls.filter(([msg]) =>
        typeof msg === 'string' && /80%|budget|threshold/i.test(msg)
      );
      expect(warningCalls.length).toBe(1);
    });

    it('warns again after midnight reset', () => {
      vi.useFakeTimers();

      const startMs = Date.UTC(2025, 0, 15, 23, 50, 0);
      vi.setSystemTime(startMs);

      const warnSpy = vi.spyOn(loggerModule, 'warn').mockImplementation(() => {});

      const budget = new DailyBudget(10);

      // Reach 80% on day 1
      for (let i = 0; i < 8; i++) {
        budget.consume();
      }
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Advance past midnight
      vi.advanceTimersByTime(15 * 60 * 1000);

      // Reach 80% on day 2 → should warn again
      for (let i = 0; i < 8; i++) {
        budget.consume();
      }
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatus', () => {
    it('reports count and cap correctly', () => {
      const budget = new DailyBudget(20);
      budget.consume();
      budget.consume();
      budget.consume();

      const status = budget.getStatus();
      expect(status.count).toBe(3);
      expect(status.cap).toBe(20);
      expect(status.disabled).toBe(false);
    });

    it('reports disabled=true when cap is 0', () => {
      const budget = new DailyBudget(0);
      const status = budget.getStatus();
      expect(status.disabled).toBe(true);
    });
  });
});
