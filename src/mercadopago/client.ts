/**
 * Mercado Pago API client
 * Fetches approved payments for a given period (YYYY-MM) with pagination,
 * per-request timeout, and exponential backoff on 429 / 5xx / network errors.
 *
 * Security: MP_ACCESS_TOKEN is NEVER logged under any circumstances.
 */

import type { Result } from '../types/index.js';
import {
  MP_API_BASE_URL,
  MP_API_TIMEOUT_MS,
  MP_MAX_RETRIES,
  MP_RETRY_DELAYS_MS,
} from '../config.js';
import { debug, warn } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * A single Mercado Pago payment with only the fields consumed by this service.
 */
export interface MpPayment {
  id: number;
  status: string;
  date_approved: string;
  operation_type: string;
  description: string;
  external_reference: string;
  currency_id: string;
  transaction_amount: number;
  transaction_details: {
    net_received_amount: number;
  };
  payer: {
    identification: {
      type: string;
      number: string;
    };
    email: string;
  };
  card?: {
    cardholder?: {
      identification?: {
        type?: string;
        number?: string;
      };
    };
  };
  collector_id: number;
  amount_refunded: number;
  charges_details: Array<{
    name: string;
    type: string;
    amounts: {
      original: number;
      refunded: number;
    };
    accounts: {
      from: string;
      to: string;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface MpSearchResponse {
  results: unknown[];
  paging: {
    total: number;
    limit: number;
    offset: number;
  };
}

type FetchOnceResult =
  | { ok: true; value: MpSearchResponse }
  | {
      ok: false;
      error: Error;
      status?: number;
      /**
       * When true the caller must NOT retry (timeout, malformed JSON, 401).
       * When false/absent the caller may retry (429, 5xx, network error).
       */
      terminal?: boolean;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isMpSearchResponse(data: unknown): data is MpSearchResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.results)) return false;
  if (!d.paging || typeof d.paging !== 'object' || Array.isArray(d.paging)) return false;
  const paging = d.paging as Record<string, unknown>;
  return typeof paging.total === 'number';
}

/**
 * Checks that a raw API result has the minimum required fields
 * to be accepted as an MpPayment.
 */
function isValidMpPayment(item: unknown): item is MpPayment {
  if (!item || typeof item !== 'object') return false;
  const p = item as Record<string, unknown>;
  return (
    p.id !== undefined &&
    p.id !== null &&
    typeof p.date_approved === 'string' &&
    p.date_approved.length > 0 &&
    typeof p.transaction_amount === 'number'
  );
}

/**
 * Performs a single HTTP request to the MP search endpoint.
 * Does NOT retry — callers handle retry logic.
 * Does NOT log the bearer token.
 */
async function fetchOnce(url: string, token: string): Promise<FetchOnceResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MP_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        ok: false,
        error: new Error(`MP API returned HTTP ${response.status}`),
        status: response.status,
      };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      // JSON parse errors are terminal — no retry (task spec)
      return {
        ok: false,
        error: new Error('MP API returned malformed JSON'),
        terminal: true,
      };
    }

    if (!isMpSearchResponse(data)) {
      return {
        ok: false,
        error: new Error('MP API response did not match expected shape'),
      };
    }

    return { ok: true, value: data };
  } catch (e) {
    clearTimeout(timeoutId);
    // AbortError = timeout — terminal, no retry
    if (e instanceof DOMException && e.name === 'AbortError') {
      return {
        ok: false,
        error: new Error(`MP API request timed out after ${MP_API_TIMEOUT_MS}ms`),
        terminal: true,
      };
    }
    return {
      ok: false,
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
}

/**
 * Fetches a single search page with retry on 429 / 5xx / network errors.
 * Returns ok:false immediately on 401 (no retry).
 * Returns ok:false after MP_MAX_RETRIES exhausted.
 */
async function fetchPageWithRetry(
  url: string,
  token: string,
  periodo: string,
  page: number,
): Promise<FetchOnceResult> {
  for (let attempt = 0; attempt <= MP_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayIdx = Math.min(attempt - 1, MP_RETRY_DELAYS_MS.length - 1);
      debug('MP API retry', {
        module: 'mercadopago',
        periodo,
        page,
        attempt,
        delayMs: MP_RETRY_DELAYS_MS[delayIdx],
      });
      await sleepMs(MP_RETRY_DELAYS_MS[delayIdx]);
    }

    const result = await fetchOnce(url, token);

    if (result.ok) return result;

    // Terminal errors: never retry (timeout, malformed JSON, 401)
    if (result.terminal) return result;

    // 401: credentials invalid — do not retry
    if (result.status === 401) {
      return {
        ok: false,
        error: new Error(
          `MP API unauthorized (401): verify MP_ACCESS_TOKEN is valid`,
        ),
        status: 401,
        terminal: true,
      };
    }

    // Last attempt: propagate error
    if (attempt === MP_MAX_RETRIES) return result;

    // Retry on 429, 5xx, or network error (no status)
  }

  // Unreachable but satisfies TypeScript
  return { ok: false, error: new Error('MP API fetch failed after retries') };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Searches for approved payments in the given period from the Mercado Pago API.
 *
 * @param periodo - Month period in YYYY-MM format
 * @returns Result with an array of approved MpPayment objects, or an error
 *
 * @remarks
 * - Requires `MP_ACCESS_TOKEN` env var — returns ok:false if absent
 * - Paginates automatically (limit=50, stops at offset 10 000)
 * - Retries on 429 / 5xx / network errors with exponential backoff
 * - Returns ok:false immediately on 401
 * - Skips per-result rows missing id, date_approved, or transaction_amount
 * - The access token is NEVER included in any log call
 */
export async function searchApprovedPayments(
  periodo: string,
): Promise<Result<MpPayment[], Error>> {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: new Error('MP_ACCESS_TOKEN is not configured — MP sync is disabled'),
    };
  }

  // Build date range in Argentina -03:00 offset (no DST)
  const [yearStr, monthStr] = periodo.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const beginDate = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000-03:00`;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000-03:00`;

  const allPayments: MpPayment[] = [];
  const limit = 50;
  let offset = 0;
  let pageNum = 1;

  while (offset < 10000) {
    const params = new URLSearchParams({
      range: 'date_approved',
      begin_date: beginDate,
      end_date: endDate,
      sort: 'date_approved',
      criteria: 'asc',
      limit: String(limit),
      offset: String(offset),
    });

    const url = `${MP_API_BASE_URL}/v1/payments/search?${params.toString()}`;

    debug('MP API search request', {
      module: 'mercadopago',
      periodo,
      page: pageNum,
      offset,
    });

    const result = await fetchPageWithRetry(url, token, periodo, pageNum);

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const { results, paging } = result.value;

    debug('MP API search response', {
      module: 'mercadopago',
      periodo,
      page: pageNum,
      count: results.length,
      total: paging.total,
    });

    for (const item of results) {
      if (!isValidMpPayment(item)) {
        warn('MP payment missing required fields, skipping', {
          module: 'mercadopago',
          id: (item as Record<string, unknown>)?.id,
        });
        continue;
      }
      if (item.status === 'approved') {
        allPayments.push(item as MpPayment);
      }
    }

    // Advance offset
    offset += limit;
    pageNum++;

    // Stop when we've covered the total or the page was empty
    if (results.length === 0 || offset >= paging.total) {
      break;
    }
  }

  return { ok: true, value: allPayments };
}
