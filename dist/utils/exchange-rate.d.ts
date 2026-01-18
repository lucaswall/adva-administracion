/**
 * Exchange rate utilities for cross-currency matching
 * Uses ArgentinaDatos API to fetch historical Dolar Oficial rates
 */
import type { Result, Moneda } from '../types/index.js';
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
}
/**
 * Clears the exchange rate cache (for testing)
 */
export declare function clearExchangeRateCache(): void;
/**
 * Sets an exchange rate in the cache (for testing)
 * Allows tests to pre-populate cache without making API calls
 *
 * @param date - Date string (ISO YYYY-MM-DD format)
 * @param rate - Exchange rate to cache
 */
export declare function setExchangeRateCache(date: string, rate: ExchangeRate): void;
/**
 * Fetches Dolar Oficial rate for a specific date from ArgentinaDatos API
 * Uses caching to avoid repeated API calls
 *
 * @param date - Date string (ISO YYYY-MM-DD or Argentine DD/MM/YYYY format)
 * @returns Result with exchange rate or error
 */
export declare function getExchangeRate(date: string): Promise<Result<ExchangeRate, Error>>;
/**
 * Synchronous version that returns cached value or indicates cache miss
 * For use in synchronous matching code - should pre-fetch rates before matching
 */
export declare function getExchangeRateSync(date: string): Result<ExchangeRate, Error>;
/**
 * Pre-fetches exchange rates for a list of dates
 * Call this before running matching to ensure rates are cached
 *
 * @param dates - Array of date strings
 */
export declare function prefetchExchangeRates(dates: string[]): Promise<void>;
/**
 * Compares factura amount with pago amount, handling cross-currency matching
 *
 * For ARS facturas: Uses match with ±1 peso tolerance (amountsMatch)
 * For USD facturas: Converts using historical exchange rate and applies tolerance
 *
 * Note: This function uses cached exchange rates. For USD facturas,
 * ensure rates are pre-fetched using prefetchExchangeRates() before calling.
 *
 * @param facturaAmount - Invoice total amount (in its original currency)
 * @param facturaMoneda - Invoice currency (ARS or USD)
 * @param facturaFecha - Invoice date (for exchange rate lookup)
 * @param pagoAmount - Payment amount (always in ARS)
 * @param tolerancePercent - Tolerance percentage for cross-currency match (e.g., 5 for 5%)
 * @returns Match result with details
 */
export declare function amountsMatchCrossCurrency(facturaAmount: number, facturaMoneda: Moneda, facturaFecha: string, pagoAmount: number, tolerancePercent: number): CrossCurrencyMatchResult;
