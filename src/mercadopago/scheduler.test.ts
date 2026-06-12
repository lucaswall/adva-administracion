/**
 * Tests for MP scheduler [ADV-371]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Module mocks ---

// Mock MP_ACCESS_TOKEN
let mockMpAccessToken: string | undefined = 'test-mp-token';
vi.mock('../config.js', () => ({
  get MP_ACCESS_TOKEN() { return mockMpAccessToken; },
}));

// Mock node-cron
const mockCronStop = vi.fn();
const mockCronSchedule = vi.fn(() => ({ stop: mockCronStop }));
vi.mock('node-cron', () => ({
  schedule: vi.fn((...args: unknown[]) => mockCronSchedule(...(args as []))),
}));

// Mock syncMercadopago
const mockSyncMercadopago = vi.fn();
vi.mock('./sync.js', () => ({
  syncMercadopago: (...args: unknown[]) => mockSyncMercadopago(...args),
}));

// Mock logger
const mockInfo = vi.fn();
const mockLogError = vi.fn();
vi.mock('../utils/logger.js', () => ({
  info: (...args: unknown[]) => mockInfo(...args),
  warn: vi.fn(),
  error: (...args: unknown[]) => mockLogError(...args),
  debug: vi.fn(),
}));

// --- Import after mocks ---
import { initMpScheduler, stopMpScheduler } from './scheduler.js';

describe('MP Scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMpAccessToken = 'test-mp-token';
    // Default sync is no-op success
    mockSyncMercadopago.mockResolvedValue({
      ok: true,
      value: { periods: [], fetched: 0, appended: 0, skippedExisting: 0, resumenesWritten: 0 },
    });
  });

  afterEach(() => {
    stopMpScheduler();
    vi.clearAllMocks();
  });

  // --- Token unset ---

  describe('when MP_ACCESS_TOKEN is unset', () => {
    beforeEach(() => {
      mockMpAccessToken = undefined;
    });

    it('does not register a cron job', () => {
      initMpScheduler();
      expect(mockCronSchedule).not.toHaveBeenCalled();
    });

    it('logs an info message', () => {
      initMpScheduler();
      expect(mockInfo).toHaveBeenCalled();
    });
  });

  // --- Cron registration ---

  describe('cron registration', () => {
    it('registers cron with expression 0 6 1 * * (06:00 on the 1st)', () => {
      initMpScheduler();
      expect(mockCronSchedule).toHaveBeenCalledWith(
        '0 6 1 * *',
        expect.any(Function)
      );
    });

    it('cron handler calls syncMercadopago with default periods', async () => {
      initMpScheduler();

      // Get the cron handler from the first call
      const firstCall = mockCronSchedule.mock.calls[0] as unknown as [string, () => void] | undefined;
      if (!firstCall) throw new Error('cron.schedule was not called');
      const cronHandler = firstCall[1];
      cronHandler();

      // Allow async work to settle
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockSyncMercadopago).toHaveBeenCalledWith(/* no args = default periods */);
    });
  });

  // --- Boot catch-up ---

  describe('boot catch-up', () => {
    it('immediately fires syncMercadopago on init', async () => {
      initMpScheduler();

      // Allow async to settle
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockSyncMercadopago).toHaveBeenCalled();
    });

    it('boot sync failure is logged and does NOT throw', async () => {
      mockSyncMercadopago.mockRejectedValueOnce(new Error('Boot sync failure'));

      // initMpScheduler must not throw (boot sync error is swallowed)
      let threw = false;
      try {
        initMpScheduler();
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);

      // Allow async chain (.catch handler) to settle
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockLogError).toHaveBeenCalled();
    });

    it('boot sync ok:false is handled gracefully', async () => {
      mockSyncMercadopago.mockResolvedValueOnce({
        ok: false,
        error: new Error('sync error'),
      });

      initMpScheduler();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not crash; error should be logged
      expect(mockLogError).toHaveBeenCalled();
    });
  });

  // --- stopMpScheduler ---

  describe('stopMpScheduler', () => {
    it('destroys the cron task', () => {
      initMpScheduler();
      stopMpScheduler();
      expect(mockCronStop).toHaveBeenCalled();
    });

    it('is safe to call multiple times', () => {
      initMpScheduler();
      stopMpScheduler();
      stopMpScheduler(); // should not throw
    });

    it('is safe to call without init', () => {
      stopMpScheduler(); // should not throw
    });
  });
});
