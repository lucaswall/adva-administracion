/**
 * Unit tests for exchange rate utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getExchangeRateSync,
  clearExchangeRateCache,
  prefetchExchangeRates,
  amountsMatchCrossCurrency,
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

  describe('amountsMatchCrossCurrency', () => {
    beforeEach(() => {
      // Clear any previous mocks
      vi.clearAllMocks();
    });

    // Bug #3: Fix floating-point precision errors
    it('matches amounts with proper monetary rounding', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2025-01-15',
        compra: 1240,
        venta: 1250
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2025-01-15']);

      // Test case: 100 USD at rate 1250 = 125000 ARS exactly
      const result = amountsMatchCrossCurrency(
        100.00,
        'USD',
        '2025-01-15',
        125000.00,
        5 // 5% tolerance
      );

      expect(result.matches).toBe(true);
      expect(result.isCrossCurrency).toBe(true);
    });

    it('handles accumulated floating-point precision correctly', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2025-01-16',
        compra: 1240,
        venta: 1250
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2025-01-16']);

      // Edge case: 99.99 USD at rate 1250 should be rounded properly
      // 99.99 * 1250 = 124987.50 (exact)
      // Should match within 5% tolerance
      const result = amountsMatchCrossCurrency(
        99.99,
        'USD',
        '2025-01-16',
        124987.50,
        5
      );

      expect(result.matches).toBe(true);
    });

    it('does not produce false negatives from small precision errors', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2025-01-17',
        compra: 1240,
        venta: 1250
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2025-01-17']);

      // Small amounts where floating-point errors might accumulate
      // 1.23 USD * 1250 = 1537.50
      const result = amountsMatchCrossCurrency(
        1.23,
        'USD',
        '2025-01-17',
        1537.50,
        5
      );

      expect(result.matches).toBe(true);
    });

    it('rounds expectedArs to 2 decimal places for monetary precision', async () => {
      // Mock rate with decimal places that cause floating-point issues
      const mockRate: ExchangeRate = {
        fecha: '2025-01-20',
        compra: 1250.00,
        venta: 1250.37
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2025-01-20']);

      // 10.29 USD * 1250.37 = 12866.307299999999 (floating-point error)
      // Should be rounded to 12866.31
      const result = amountsMatchCrossCurrency(
        10.29,
        'USD',
        '2025-01-20',
        12866.31,
        5
      );

      // expectedArs should be rounded to 2 decimal places (12866.31, not 12866.307299999999)
      expect(result.expectedArs).toBe(12866.31);
      expect(result.matches).toBe(true);
    });

    it('tolerance calculation uses rounded expectedArs value', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2025-01-21',
        compra: 1250.00,
        venta: 1250.33
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2025-01-21']);

      // 7.77 USD * 1250.33 = 9715.0641 (not exactly representable in binary)
      // Should round to 9715.06
      const result = amountsMatchCrossCurrency(
        7.77,
        'USD',
        '2025-01-21',
        9715.06,
        5
      );

      expect(result.expectedArs).toBe(9715.06);
      expect(result.matches).toBe(true);
    });
  });
});
