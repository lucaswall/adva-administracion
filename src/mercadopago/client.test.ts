/**
 * Unit tests for Mercado Pago API client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as loggerModule from '../utils/logger.js';

// Mock logger — must be hoisted before any imports that use it
vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { searchApprovedPayments } from './client.js';
import {
  MP_API_BASE_URL,
  MP_API_TIMEOUT_MS,
  MP_MAX_RETRIES,
  MP_RETRY_DELAYS_MS,
} from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = 'TEST_SECRET_MP_TOKEN_abc123';

function makeApprovedPayment(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    status: 'approved',
    date_approved: '2026-05-15T13:07:57.000-03:00',
    operation_type: 'regular_payment',
    description: 'Test payment',
    external_reference: '',
    currency_id: 'ARS',
    transaction_amount: 1000,
    amount_refunded: 0,
    transaction_details: { net_received_amount: 950 },
    payer: {
      identification: { type: 'CUIT', number: '20123456786' },
      email: 'test@test.com',
    },
    collector_id: 999,
    charges_details: [],
    ...overrides,
  };
}

function mockPageResponse(
  results: Record<string, unknown>[],
  total: number,
  offset: number,
): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results,
      paging: { total, limit: 50, offset },
    }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchApprovedPayments', () => {
  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = TOKEN;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.MP_ACCESS_TOKEN;
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Missing token
  // -------------------------------------------------------------------------
  describe('when MP_ACCESS_TOKEN is not set', () => {
    it('returns ok:false without making any fetch call', async () => {
      delete process.env.MP_ACCESS_TOKEN;
      global.fetch = vi.fn();

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Query building
  // -------------------------------------------------------------------------
  describe('query building', () => {
    it('sends correct query params for a mid-year period', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse([], 0, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      const [[url, options]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [[string, RequestInit]];
      const urlObj = new URL(url);

      expect(urlObj.origin + urlObj.pathname).toBe(`${MP_API_BASE_URL}/v1/payments/search`);
      expect(urlObj.searchParams.get('range')).toBe('date_approved');
      expect(urlObj.searchParams.get('begin_date')).toBe('2026-05-01T00:00:00.000-03:00');
      expect(urlObj.searchParams.get('end_date')).toBe('2026-06-01T00:00:00.000-03:00');
      expect(urlObj.searchParams.get('sort')).toBe('date_approved');
      expect(urlObj.searchParams.get('criteria')).toBe('asc');
      expect(urlObj.searchParams.get('limit')).toBe('50');
      expect(urlObj.searchParams.get('offset')).toBe('0');

      const headers = options.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    });

    it('handles December → January year boundary for end_date', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse([], 0, 0));

      await searchApprovedPayments('2026-12');

      const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [[string]];
      const urlObj = new URL(url);

      expect(urlObj.searchParams.get('begin_date')).toBe('2026-12-01T00:00:00.000-03:00');
      expect(urlObj.searchParams.get('end_date')).toBe('2027-01-01T00:00:00.000-03:00');
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  describe('pagination', () => {
    it('aggregates two pages when total > limit', async () => {
      const page1 = Array.from({ length: 50 }, (_, i) => makeApprovedPayment(i + 1));
      const page2 = Array.from({ length: 25 }, (_, i) => makeApprovedPayment(i + 51));

      global.fetch = vi.fn()
        .mockResolvedValueOnce(mockPageResponse(page1, 75, 0))
        .mockResolvedValueOnce(mockPageResponse(page2, 75, 50));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(75);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      const [[, ], [url2]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [[string], [string]];
      expect(new URL(url2).searchParams.get('offset')).toBe('50');
    });

    it('stops after a single page when total <= limit', async () => {
      const page = Array.from({ length: 20 }, (_, i) => makeApprovedPayment(i + 1));
      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse(page, 20, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(20);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('stops pagination when offset would reach 10000', async () => {
      // total = 10050, limit = 50 → would need 201 pages without the 10000 cap.
      // With the cap, stop at offset = 10000 (200 pages: offset 0, 50, ..., 9950).
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const offset = parseInt(new URL(url).searchParams.get('offset') ?? '0', 10);
        const results = [makeApprovedPayment(offset + 1)];
        return Promise.resolve(mockPageResponse(results, 10050, offset));
      });

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      // 200 pages: offset 0..9950
      expect(global.fetch).toHaveBeenCalledTimes(200);
    });

    it('stops pagination when results is empty (API returned fewer than expected)', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(mockPageResponse([], 100, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------
  describe('filtering', () => {
    it('only returns payments with status=approved', async () => {
      const payments = [
        makeApprovedPayment(1, { status: 'approved' }),
        makeApprovedPayment(2, { status: 'pending' }),
        makeApprovedPayment(3, { status: 'rejected' }),
        makeApprovedPayment(4, { status: 'cancelled' }),
        makeApprovedPayment(5, { status: 'approved' }),
      ];

      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse(payments, 5, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every(p => p.status === 'approved')).toBe(true);
        expect(result.value.map(p => p.id)).toEqual([1, 5]);
      }
    });

    it('skips payments missing id and logs a warn', async () => {
      const payments = [
        makeApprovedPayment(1),
        { status: 'approved', date_approved: '2026-05-15T10:00:00.000-03:00', transaction_amount: 100 }, // missing id
        makeApprovedPayment(3),
      ];

      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse(payments, 3, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(2);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });

    it('skips payments missing date_approved and logs a warn', async () => {
      const payments = [
        makeApprovedPayment(1),
        { id: 2, status: 'approved', transaction_amount: 100 }, // missing date_approved
      ];

      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse(payments, 2, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(1);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });

    it('skips payments missing transaction_amount and logs a warn', async () => {
      const payments = [
        makeApprovedPayment(1),
        { id: 2, status: 'approved', date_approved: '2026-05-15T10:00:00.000-03:00' }, // missing transaction_amount
      ];

      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse(payments, 2, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(1);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });

    it('skips payments missing transaction_details.net_received_amount and logs a warn', async () => {
      const payments = [
        makeApprovedPayment(1),
        makeApprovedPayment(2, { transaction_details: undefined }),
        makeApprovedPayment(3, { transaction_details: {} }),
      ];

      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse(payments, 3, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.map(p => p.id)).toEqual([1]);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });

    it('skips payments with missing or non-array charges_details and logs a warn', async () => {
      const payments = [
        makeApprovedPayment(1),
        makeApprovedPayment(2, { charges_details: undefined }),
        makeApprovedPayment(3, { charges_details: 'not-an-array' }),
      ];

      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse(payments, 3, 0));

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.map(p => p.id)).toEqual([1]);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------
  describe('timeout', () => {
    it('returns ok:false when fetch never resolves (AbortController timeout)', async () => {
      vi.useFakeTimers();

      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        return new Promise((_, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
          // Never resolves on its own
        });
      });

      const promise = searchApprovedPayments('2026-05');
      await vi.advanceTimersByTimeAsync(MP_API_TIMEOUT_MS + 100);
      const result = await promise;

      expect(result.ok).toBe(false);
    });

    it('aborts when the response body read hangs (json never resolves)', async () => {
      vi.useFakeTimers();

      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_, reject) => {
              options?.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
              // Never resolves on its own — simulates a hung body stream
            }),
        } as unknown as Response);
      });

      const promise = searchApprovedPayments('2026-05');
      await vi.advanceTimersByTimeAsync(MP_API_TIMEOUT_MS + 100);

      // If the timeout timer was cleared before the body read, the promise
      // never settles — the sentinel exposes the hang instead of blocking the suite.
      const result = await Promise.race([
        promise,
        Promise.resolve('STILL_PENDING' as const),
      ]);

      expect(result).not.toBe('STILL_PENDING');
      expect((result as { ok: boolean }).ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 429 / retry backoff
  // -------------------------------------------------------------------------
  describe('429 backoff', () => {
    it('returns ok:false after MP_MAX_RETRIES exhausted on persistent 429', async () => {
      vi.useFakeTimers();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
      });

      const promise = searchApprovedPayments('2026-05');
      // Advance past all retry delays: sum of MP_RETRY_DELAYS_MS
      const totalDelay = MP_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
      await vi.advanceTimersByTimeAsync(totalDelay + 1000);
      const result = await promise;

      expect(result.ok).toBe(false);
      // initial attempt + MP_MAX_RETRIES retries
      expect(global.fetch).toHaveBeenCalledTimes(MP_MAX_RETRIES + 1);
    });

    it('succeeds when a 429 is followed by a 200', async () => {
      vi.useFakeTimers();
      let callCount = 0;

      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 429, json: async () => ({}) });
        }
        return Promise.resolve(mockPageResponse([], 0, 0));
      });

      const promise = searchApprovedPayments('2026-05');
      await vi.advanceTimersByTimeAsync(MP_RETRY_DELAYS_MS[0] + 100);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 5xx errors as well', async () => {
      vi.useFakeTimers();
      let callCount = 0;

      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
        }
        return Promise.resolve(mockPageResponse([], 0, 0));
      });

      const promise = searchApprovedPayments('2026-05');
      await vi.advanceTimersByTimeAsync(MP_RETRY_DELAYS_MS[0] + 100);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // 401 — no retry
  // -------------------------------------------------------------------------
  describe('401 unauthorized', () => {
    it('returns ok:false immediately without retry', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      });

      const result = await searchApprovedPayments('2026-05');

      expect(result.ok).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      if (!result.ok) {
        expect(result.error.message).toMatch(/401/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Malformed JSON
  // -------------------------------------------------------------------------
  describe('malformed JSON body', () => {
    it('returns ok:false without throwing', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      });

      await expect(searchApprovedPayments('2026-05')).resolves.toMatchObject({ ok: false });
    });
  });

  // -------------------------------------------------------------------------
  // Token never logged
  // -------------------------------------------------------------------------
  describe('security: token never appears in logs', () => {
    it('never logs the access token string in any log call', async () => {
      const sensitiveToken = 'SUPER_SECRET_MP_TOKEN_must_not_appear_in_logs_xyz987';
      process.env.MP_ACCESS_TOKEN = sensitiveToken;

      global.fetch = vi.fn().mockResolvedValueOnce(mockPageResponse([], 0, 0));

      await searchApprovedPayments('2026-05');

      const allCalls = [
        ...vi.mocked(loggerModule.debug).mock.calls,
        ...vi.mocked(loggerModule.info).mock.calls,
        ...vi.mocked(loggerModule.warn).mock.calls,
        ...vi.mocked(loggerModule.error).mock.calls,
      ];

      for (const call of allCalls) {
        const callStr = JSON.stringify(call);
        expect(callStr).not.toContain(sensitiveToken);
      }
    });
  });
});
