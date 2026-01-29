/**
 * Unit tests for exchange rate utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getExchangeRate,
  getExchangeRateSync,
  clearExchangeRateCache,
  setExchangeRateCache,
  amountsMatchCrossCurrency,
  prefetchExchangeRates,
  type ExchangeRate
} from '../../../src/utils/exchange-rate.js';

describe('exchange-rate', () => {
  beforeEach(() => {
    clearExchangeRateCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('clearExchangeRateCache', () => {
    it('clears the cache', () => {
      const testRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };
      setExchangeRateCache('2024-01-15', testRate);

      clearExchangeRateCache();

      const result = getExchangeRateSync('2024-01-15');
      expect(result.ok).toBe(false);
    });
  });

  describe('setExchangeRateCache', () => {
    it('sets a value in the cache', () => {
      const testRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      setExchangeRateCache('2024-01-15', testRate);

      const result = getExchangeRateSync('2024-01-15');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(testRate);
      }
    });

    it('accepts ISO date format', () => {
      const testRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      setExchangeRateCache('2024-01-15', testRate);

      const result = getExchangeRateSync('2024-01-15');
      expect(result.ok).toBe(true);
    });
  });

  describe('getExchangeRate', () => {
    it('fetches exchange rate from API for valid date', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.compra).toBe(800);
        expect(result.value.venta).toBe(850);
      }
    });

    it('returns error for invalid date format', async () => {
      const result = await getExchangeRate('invalid-date');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid date format');
      }
    });

    it('handles Argentine date format (DD/MM/YYYY)', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      const result = await getExchangeRate('15/01/2024');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.compra).toBe(800);
      }
    });

    it('returns cached value on second call', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      // First call
      await getExchangeRate('2024-01-15');

      // Second call
      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Only called once
    });

    it('returns error on API failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to fetch');
        expect(result.error.message).toContain('404');
      }
    });

    it('returns error on invalid API response structure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ invalid: 'response' })
      });

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid API response');
      }
    });

    it('returns error on missing compra field', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ venta: 850 })
      });

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('missing compra or venta');
      }
    });

    it('returns error on missing venta field', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ compra: 800 })
      });

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('missing compra or venta');
      }
    });

    it('handles network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Network error');
      }
    });

    it('handles non-Error exceptions', async () => {
      global.fetch = vi.fn().mockRejectedValue('String error');

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
      }
    });

    it('uses fecha from API response if provided', async () => {
      const mockRate = {
        fecha: '2024-01-16',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.fecha).toBe('2024-01-16');
      }
    });

    it('uses normalized date if API response has no fecha', async () => {
      const mockRate = {
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      const result = await getExchangeRate('2024-01-15');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.fecha).toBe('2024-01-15');
      }
    });

    it('calls correct API endpoint', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await getExchangeRate('2024-01-15');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial/2024/01/15'
      );
    });
  });

  describe('getExchangeRateSync', () => {
    it('returns cached value', () => {
      const testRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      setExchangeRateCache('2024-01-15', testRate);

      const result = getExchangeRateSync('2024-01-15');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(testRate);
      }
    });

    it('returns error if not cached', () => {
      const result = getExchangeRateSync('2024-01-15');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not cached');
      }
    });

    it('returns error for invalid date format', () => {
      const result = getExchangeRateSync('invalid-date');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid date format');
      }
    });

    it('handles Argentine date format', () => {
      const testRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      setExchangeRateCache('2024-01-15', testRate);

      const result = getExchangeRateSync('15/01/2024');

      expect(result.ok).toBe(true);
    });
  });

  describe('prefetchExchangeRates', () => {
    it('fetches rates for multiple dates', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2024-01-15', '2024-01-16']);

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('deduplicates dates', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2024-01-15', '2024-01-15', '2024-01-15']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('skips already cached dates', async () => {
      const testRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      setExchangeRateCache('2024-01-15', testRate);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => testRate
      });

      await prefetchExchangeRates(['2024-01-15', '2024-01-16']);

      expect(global.fetch).toHaveBeenCalledTimes(1); // Only for 2024-01-16
    });

    it('handles empty array', async () => {
      global.fetch = vi.fn();

      await prefetchExchangeRates([]);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('filters out invalid dates', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2024-01-15', 'invalid-date']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('handles mixed date formats', async () => {
      const mockRate: ExchangeRate = {
        fecha: '2024-01-15',
        compra: 800,
        venta: 850
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRate
      });

      await prefetchExchangeRates(['2024-01-15', '16/01/2024']);

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

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
    describe('ARS invoices', () => {
      it('matches with exact amounts', () => {
        const result = amountsMatchCrossCurrency(
          1000,
          'ARS',
          '2024-01-15',
          1000,
          5
        );

        expect(result.matches).toBe(true);
        expect(result.isCrossCurrency).toBe(false);
        expect(result.rate).toBeUndefined();
        expect(result.expectedArs).toBeUndefined();
      });

      it('matches within tolerance (±1 peso)', () => {
        const result = amountsMatchCrossCurrency(
          1000,
          'ARS',
          '2024-01-15',
          1000.5,
          5
        );

        expect(result.matches).toBe(true);
        expect(result.isCrossCurrency).toBe(false);
      });

      it('does not match outside tolerance', () => {
        const result = amountsMatchCrossCurrency(
          1000,
          'ARS',
          '2024-01-15',
          1002,
          5
        );

        expect(result.matches).toBe(false);
        expect(result.isCrossCurrency).toBe(false);
      });
    });

    describe('USD invoices', () => {
      beforeEach(() => {
        const testRate: ExchangeRate = {
          fecha: '2024-01-15',
          compra: 800,
          venta: 850
        };
        setExchangeRateCache('2024-01-15', testRate);
      });

      it('matches with exact conversion', () => {
        // 100 USD * 850 = 85000 ARS
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          85000,
          5
        );

        expect(result.matches).toBe(true);
        expect(result.isCrossCurrency).toBe(true);
        expect(result.rate).toBe(850);
        expect(result.expectedArs).toBe(85000);
      });

      it('matches within tolerance', () => {
        // 100 USD * 850 = 85000 ARS
        // 5% tolerance = ±4250
        // Range: 80750 - 89250
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          88000,
          5
        );

        expect(result.matches).toBe(true);
        expect(result.isCrossCurrency).toBe(true);
        expect(result.rate).toBe(850);
      });

      it('does not match outside tolerance', () => {
        // 100 USD * 850 = 85000 ARS
        // 5% tolerance = ±4250
        // Range: 80750 - 89250
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          90000,
          5
        );

        expect(result.matches).toBe(false);
        expect(result.isCrossCurrency).toBe(true);
      });

      it('uses venta rate for conversion', () => {
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          85000,
          5
        );

        expect(result.rate).toBe(850); // venta, not compra (800)
      });

      it('returns false match when rate not cached', () => {
        clearExchangeRateCache();

        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-20',
          85000,
          5
        );

        expect(result.matches).toBe(false);
        expect(result.isCrossCurrency).toBe(true);
        expect(result.rate).toBeUndefined();
        expect(result.expectedArs).toBeUndefined();
      });

      it('handles different tolerance percentages', () => {
        // 100 USD * 850 = 85000 ARS
        // 10% tolerance = ±8500
        // Range: 76500 - 93500
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          93000,
          10
        );

        expect(result.matches).toBe(true);
      });

      it('handles small USD amounts', () => {
        // 1 USD * 850 = 850 ARS
        // 5% tolerance = ±42.5
        // Range: 807.5 - 892.5
        const result = amountsMatchCrossCurrency(
          1,
          'USD',
          '2024-01-15',
          850,
          5
        );

        expect(result.matches).toBe(true);
      });

      it('handles large USD amounts', () => {
        // 10000 USD * 850 = 8500000 ARS
        const result = amountsMatchCrossCurrency(
          10000,
          'USD',
          '2024-01-15',
          8500000,
          5
        );

        expect(result.matches).toBe(true);
        expect(result.expectedArs).toBe(8500000);
      });

      it('handles decimal USD amounts', () => {
        // 100.50 USD * 850 = 85425 ARS
        const result = amountsMatchCrossCurrency(
          100.50,
          'USD',
          '2024-01-15',
          85425,
          5
        );

        expect(result.matches).toBe(true);
      });

      it('handles lower bound of tolerance', () => {
        // 100 USD * 850 = 85000 ARS
        // 5% tolerance = ±4250
        // Lower bound: 80750
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          80750,
          5
        );

        expect(result.matches).toBe(true);
      });

      it('handles upper bound of tolerance', () => {
        // 100 USD * 850 = 85000 ARS
        // 5% tolerance = ±4250
        // Upper bound: 89250
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          89250,
          5
        );

        expect(result.matches).toBe(true);
      });

      it('does not match just below lower bound', () => {
        // 100 USD * 850 = 85000 ARS
        // 5% tolerance = ±4250
        // Lower bound: 80750
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          80749,
          5
        );

        expect(result.matches).toBe(false);
      });

      it('does not match just above upper bound', () => {
        // 100 USD * 850 = 85000 ARS
        // 5% tolerance = ±4250
        // Upper bound: 89250
        const result = amountsMatchCrossCurrency(
          100,
          'USD',
          '2024-01-15',
          89251,
          5
        );

        expect(result.matches).toBe(false);
      });
    });
  });
});
