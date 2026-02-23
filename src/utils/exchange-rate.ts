/**
 * Exchange rate utilities for cross-currency matching
 * Uses ArgentinaDatos API to fetch historical Dolar Oficial rates
 */

import type { Result, Moneda } from '../types/index.js';
import { parseArgDate, formatISODate } from './date.js';
import { amountsMatch } from './numbers.js';
import { debug, warn } from './logger.js';
import { getCorrelationId } from './correlation.js';
import { EXCHANGE_RATE_TIMEOUT_MS } from '../config.js';

/**
 * Exchange rate data from ArgentinaDatos API
 */
export interface ExchangeRate {
  fecha: string;
  compra: number;
  venta: number;
}

/**
 * Result of cross-currency amount comparison
 */
export interface CrossCurrencyMatchResult {
  /** Whether the amounts match (considering tolerance for cross-currency) */
  matches: boolean;
  /** Whether this is a cross-currency comparison (USD→ARS) */
  isCrossCurrency: boolean;
  /** Exchange rate used (venta) - only for cross-currency */
  rate?: number;
  /** Expected ARS amount - only for cross-currency */
  expectedArs?: number;
  /** Whether the match failed due to exchange rate cache miss */
  cacheMiss?: boolean;
}

/**
 * Cache TTL: 24 hours in milliseconds
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory cache for exchange rates
 */
interface CacheEntry {
  rate: ExchangeRate;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry>();

/**
 * Clears the exchange rate cache (for testing)
 */
export function clearExchangeRateCache(): void {
  memoryCache.clear();
}

/**
 * Sets an exchange rate in the cache (for testing)
 * Allows tests to pre-populate cache without making API calls
 *
 * @param date - Date string (ISO YYYY-MM-DD format)
 * @param rate - Exchange rate to cache
 */
export function setExchangeRateCache(date: string, rate: ExchangeRate): void {
  const cacheKey = `exchange_rate_oficial_${date}`;
  memoryCache.set(cacheKey, {
    rate,
    timestamp: Date.now()
  });
}

/**
 * Gets cached value if valid (not expired)
 */
function getCachedValue(key: string): ExchangeRate | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }

  return entry.rate;
}

/**
 * Sets cached value with current timestamp
 */
function setCachedValue(key: string, rate: ExchangeRate): void {
  memoryCache.set(key, {
    rate,
    timestamp: Date.now()
  });
}

/**
 * Parses a date string and returns it in ISO format (YYYY-MM-DD)
 * Handles both ISO and Argentine formats
 * Uses UTC date components for consistency with formatISODate
 */
function normalizeDateToIso(dateStr: string): string | null {
  const parsed = parseArgDate(dateStr);
  if (!parsed) return null;

  // Use formatISODate for consistency (uses UTC methods)
  return formatISODate(parsed);
}

/**
 * Fetches Dolar Oficial rate for a specific date from ArgentinaDatos API
 * Uses caching to avoid repeated API calls
 *
 * @param date - Date string (ISO YYYY-MM-DD or Argentine DD/MM/YYYY format)
 * @returns Result with exchange rate or error
 */
export async function getExchangeRate(date: string): Promise<Result<ExchangeRate, Error>> {
  // Normalize date to ISO format
  const isoDate = normalizeDateToIso(date);
  if (!isoDate) {
    return {
      ok: false,
      error: new Error(`Invalid date format: ${date}`),
    };
  }

  // Check cache first
  const cacheKey = `exchange_rate_oficial_${isoDate}`;
  const cachedValue = getCachedValue(cacheKey);
  if (cachedValue) {
    return { ok: true, value: cachedValue };
  }

  // Parse date for URL - validate we have all components
  const dateParts = isoDate.split('-');
  if (dateParts.length !== 3 || !dateParts[0] || !dateParts[1] || !dateParts[2]) {
    return {
      ok: false,
      error: new Error(`Invalid date format after normalization: ${isoDate}`),
    };
  }
  const [year, month, day] = dateParts;
  const url = `https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial/${year}/${month}/${day}`;

  const startTime = Date.now();

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXCHANGE_RATE_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      debug('Exchange rate API call completed', { module: 'exchange-rate', durationMs, url });
      return {
        ok: false,
        error: new Error(`Failed to fetch exchange rate: HTTP ${response.status}`),
      };
    }

    const rawData: unknown = await response.json();

    // Validate response structure before type assertion
    if (rawData === null || typeof rawData !== 'object' || Array.isArray(rawData)) {
      return {
        ok: false,
        error: new Error('Invalid API response: data is not an object'),
      };
    }

    // Now safe to treat as potential exchange rate object
    const data = rawData as { compra?: number; venta?: number; fecha?: string };

    if (typeof data.compra !== 'number' || typeof data.venta !== 'number') {
      return {
        ok: false,
        error: new Error('Invalid API response: missing compra or venta'),
      };
    }

    if (!Number.isFinite(data.compra) || !Number.isFinite(data.venta)) {
      return {
        ok: false,
        error: new Error('Invalid API response: compra or venta is not a valid number'),
      };
    }

    const exchangeRate: ExchangeRate = {
      fecha: data.fecha || isoDate,
      compra: data.compra,
      venta: data.venta,
    };

    // Cache the result
    setCachedValue(cacheKey, exchangeRate);

    debug('Exchange rate API call completed', { module: 'exchange-rate', durationMs, url });
    return { ok: true, value: exchangeRate };
  } catch (e) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    debug('Exchange rate API call completed', { module: 'exchange-rate', durationMs, url });
    return {
      ok: false,
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
}

/**
 * Synchronous version that returns cached value or indicates cache miss
 * For use in synchronous matching code - should pre-fetch rates before matching
 */
export function getExchangeRateSync(date: string): Result<ExchangeRate, Error> {
  const isoDate = normalizeDateToIso(date);
  if (!isoDate) {
    return {
      ok: false,
      error: new Error(`Invalid date format: ${date}`),
    };
  }

  const cacheKey = `exchange_rate_oficial_${isoDate}`;
  const cachedValue = getCachedValue(cacheKey);

  if (cachedValue) {
    return { ok: true, value: cachedValue };
  }

  return {
    ok: false,
    error: new Error(`Exchange rate not cached for ${isoDate}. Call prefetchExchangeRates first.`),
  };
}

/**
 * Pre-fetches exchange rates for a list of dates
 * Call this before running matching to ensure rates are cached
 *
 * Uses Promise.allSettled to continue fetching even if some dates fail
 *
 * @param dates - Array of date strings
 */
export async function prefetchExchangeRates(dates: string[]): Promise<void> {
  // Normalize dates and log warnings for invalid ones
  const normalized: string[] = [];
  for (const date of dates) {
    const isoDate = normalizeDateToIso(date);
    if (isoDate) {
      normalized.push(isoDate);
    } else {
      warn('Invalid date format dropped during prefetch', {
        module: 'exchange-rate',
        originalDate: date,
        correlationId: getCorrelationId(),
      });
    }
  }

  const uniqueDates = [...new Set(normalized)];

  const results = await Promise.allSettled(
    uniqueDates.map(async (date) => {
      const cacheKey = `exchange_rate_oficial_${date}`;
      if (!getCachedValue(cacheKey)) {
        const result = await getExchangeRate(date);
        if (!result.ok) {
          warn('Failed to prefetch exchange rate', {
            module: 'exchange-rate',
            date,
            error: result.error.message,
            correlationId: getCorrelationId(),
          });
        }
        return result;
      }
      return undefined; // Already cached
    })
  );

  // Log any rejected promises (shouldn't happen with current implementation)
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      warn('Promise rejected during exchange rate prefetch', {
        module: 'exchange-rate',
        date: uniqueDates[index],
        error: result.reason,
        correlationId: getCorrelationId(),
      });
    }
  });
}

/**
 * Compares factura amount with pago amount, handling cross-currency matching
 *
 * For same-currency (ARS/ARS or USD/USD): Uses exact match with ±1 tolerance (amountsMatch)
 * For cross-currency (USD factura + ARS pago): Converts using historical exchange rate and applies tolerance
 *
 * Note: This function uses cached exchange rates. For cross-currency matching,
 * ensure rates are pre-fetched using prefetchExchangeRates() before calling.
 *
 * @param facturaAmount - Invoice total amount (in its original currency)
 * @param facturaMoneda - Invoice currency (ARS or USD)
 * @param facturaFecha - Invoice date (for exchange rate lookup)
 * @param pagoAmount - Payment amount (in pagoMoneda currency)
 * @param pagoMoneda - Payment currency (ARS or USD)
 * @param tolerancePercent - Tolerance percentage for cross-currency match (e.g., 5 for 5%)
 * @param sameCurrencyUsdTolerance - Absolute tolerance for USD/USD same-currency match (default 1)
 * @returns Match result with details
 */
export function amountsMatchCrossCurrency(
  facturaAmount: number,
  facturaMoneda: Moneda,
  facturaFecha: string,
  pagoAmount: number,
  pagoMoneda: Moneda,
  tolerancePercent: number,
  sameCurrencyUsdTolerance: number = 1
): CrossCurrencyMatchResult {
  // For same-currency matching (ARS/ARS or USD/USD), use exact match regardless of currency
  if (facturaMoneda === pagoMoneda) {
    // USD/USD can use a wider absolute tolerance (e.g. $30 for rounding differences)
    // ARS/ARS stays at default $1 tolerance
    const tolerance = facturaMoneda === 'USD' ? sameCurrencyUsdTolerance : 1;
    return {
      matches: amountsMatch(facturaAmount, pagoAmount, tolerance),
      isCrossCurrency: false,
    };
  }

  // For cross-currency (USD factura + ARS pago), fetch exchange rate from cache and apply tolerance
  const rateResult = getExchangeRateSync(facturaFecha);

  if (!rateResult.ok) {
    // Cache miss - cannot determine match
    // Log warning so this is visible and can be debugged
    warn('Exchange rate cache miss - USD invoice cannot be matched', {
      module: 'exchange-rate',
      phase: 'cross-currency-match',
      facturaFecha,
      facturaAmount,
      pagoAmount,
      error: rateResult.error.message,
      correlationId: getCorrelationId(),
    });

    return {
      matches: false,
      isCrossCurrency: true,
      cacheMiss: true,
    };
  }

  const rate = rateResult.value.venta; // Use venta (sell) rate
  // Round to 2 decimal places for monetary precision (prevents floating-point errors)
  const expectedArs = Math.round(facturaAmount * rate * 100) / 100;

  // Calculate tolerance bounds
  const toleranceFactor = tolerancePercent / 100;
  const lowerBound = expectedArs * (1 - toleranceFactor);
  const upperBound = expectedArs * (1 + toleranceFactor);

  const matches = pagoAmount >= lowerBound && pagoAmount <= upperBound;

  return {
    matches,
    isCrossCurrency: true,
    rate,
    expectedArs,
  };
}
