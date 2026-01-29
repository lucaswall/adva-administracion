/**
 * Unit tests for exchange rate utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getExchangeRateSync,
  clearExchangeRateCache,
  prefetchExchangeRates,
  type ExchangeRate
} from './exchange-rate.js';

describe('exchange-rate', () => {
  beforeEach(() => {
    clearExchangeRateCache();
    vi.clearAllMocks();
  });

  describe('prefetchExchangeRates', () => {
    it('continues when one date fetch fails', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-16',
        compra: 800,
        venta: 850
      };

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          return Promise.resolve({ ok: false, status: 404 });
        }
        // Second call succeeds
        return Promise.resolve({
          ok: true,
          json: async () => mockRate
        });
      });

      // Should not throw even though first fetch fails
      await prefetchExchangeRates(['2024-01-15', '2024-01-16']);

      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Second date should be cached despite first failure
      const result = getExchangeRateSync('2024-01-16');
      expect(result.ok).toBe(true);
    });

    it('caches successful fetches despite partial failures', async () => {
      const mockRate1: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };
      const mockRate3: ExchangeRate = {
        fecha: '2024-01-17',
        compra: 810,
        venta: 860
      };

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: true, json: async () => mockRate1 });
        } else if (callCount === 2) {
          return Promise.resolve({ ok: false, status: 500 });
        } else {
          return Promise.resolve({ ok: true, json: async () => mockRate3 });
        }
      });

      await prefetchExchangeRates(['2024-01-15', '2024-01-16', '2024-01-17']);

      expect(global.fetch).toHaveBeenCalledTimes(3);

      // First and third should be cached
      const result1 = getExchangeRateSync('2024-01-15');
      expect(result1.ok).toBe(true);

      const result2 = getExchangeRateSync('2024-01-16');
      expect(result2.ok).toBe(false); // Failed to fetch

      const result3 = getExchangeRateSync('2024-01-17');
      expect(result3.ok).toBe(true);
    });

    it('does not throw when all fetches fail', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      });

      // Should not throw
      await expect(prefetchExchangeRates(['2024-01-15', '2024-01-16'])).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('handles network errors gracefully', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            fecha: '2024-01-16',
            compra: 800,
            venta: 850
          })
        });
      });

      // Should not throw
      await prefetchExchangeRates(['2024-01-15', '2024-01-16']);

      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Second should still be cached
      const result = getExchangeRateSync('2024-01-16');
      expect(result.ok).toBe(true);
    });
  });
});
