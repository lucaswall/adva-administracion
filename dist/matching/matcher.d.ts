/**
 * Factura-Pago and Recibo-Pago matching logic
 * Matches payments to invoices and salary slips based on amount, date, and optional CUIT/CUIL
 */
import type { Factura, Pago, Recibo, MatchCandidate, ReciboMatchCandidate, MatchConfidence } from '../types/index.js';
/**
 * Match quality for comparison
 */
export interface MatchQuality {
    confidence: MatchConfidence;
    hasCuitMatch: boolean;
    dateProximityDays: number;
}
/**
 * Compares two match qualities using the three-tier system:
 * 1. Confidence level (HIGH > MEDIUM > LOW)
 * 2. CUIT match (has > doesn't have)
 * 3. Date proximity (closer is better)
 *
 * @returns Positive if a > b, negative if a < b, 0 if equal
 */
export declare function compareMatchQuality(a: MatchQuality, b: MatchQuality): number;
/**
 * Matches pagos to facturas with fuzzy date matching
 */
export declare class FacturaPagoMatcher {
    private readonly dateRanges;
    private readonly crossCurrencyTolerancePercent;
    /**
     * Creates a new matcher
     *
     * @param dateRangeBefore - Days before invoice date for LOW tier (default: 10)
     * @param dateRangeAfter - Days after invoice date for LOW tier (default: 60)
     * @param crossCurrencyTolerancePercent - Tolerance for USD→ARS matching (default: 5%)
     */
    constructor(dateRangeBefore?: number, dateRangeAfter?: number, crossCurrencyTolerancePercent?: number);
    /**
     * Finds all matching facturas for a pago
     *
     * @param pago - Payment to match
     * @param facturas - Available invoices (can include already matched ones)
     * @returns Array of match candidates sorted by match quality
     */
    findMatches(pago: Pago, facturas: Array<Factura & {
        row: number;
    }>): MatchCandidate[];
    /**
     * Calculates match confidence level based on date tier and CUIT/name matching
     *
     * Date ranges determine the base confidence tier:
     * - HIGH range [0, 15]: Can achieve HIGH (with CUIT/name) or MEDIUM (without)
     * - MEDIUM range (-3, 30): Can achieve HIGH (with CUIT/name) or MEDIUM (without)
     * - LOW range (-10, 60): Always LOW regardless of CUIT/name
     *
     * Cross-currency matching has reduced confidence:
     * - With CUIT match: capped at MEDIUM
     * - Without CUIT match: LOW
     *
     * @param isWithinMediumRange - Whether date is within medium confidence range (-3, 30)
     * @param cuitMatch - Whether CUITs match
     * @param nameMatch - Whether names match
     * @param isCrossCurrency - Whether this is a cross-currency match (USD→ARS)
     * @returns Confidence level
     */
    private calculateConfidence;
}
/**
 * Matches pagos to recibos with fuzzy date matching
 * Used for matching salary payments (Recibos) to bank payments (Pagos)
 */
export declare class ReciboPagoMatcher {
    private readonly dateRanges;
    /**
     * Creates a new matcher
     *
     * @param dateRangeBefore - Days before recibo date for LOW tier (default: 10)
     * @param dateRangeAfter - Days after recibo date for LOW tier (default: 60)
     */
    constructor(dateRangeBefore?: number, dateRangeAfter?: number);
    /**
     * Finds all matching recibos for a pago
     *
     * @param pago - Payment to match
     * @param recibos - Available salary slips (can include already matched ones)
     * @returns Array of match candidates sorted by match quality
     */
    findMatches(pago: Pago, recibos: Array<Recibo & {
        row: number;
    }>): ReciboMatchCandidate[];
    /**
     * Calculates match confidence level based on date tier and CUIL/name matching
     *
     * Same logic as FacturaPagoMatcher:
     * - HIGH range [0, 15]: Can achieve HIGH (with CUIL/name) or MEDIUM (without)
     * - MEDIUM range (-3, 30): Can achieve HIGH (with CUIL/name) or MEDIUM (without)
     * - LOW range (-10, 60): Always LOW regardless of CUIL/name
     *
     * @param isWithinMediumRange - Whether date is within medium confidence range (-3, 30)
     * @param cuilMatch - Whether CUILs match
     * @param nameMatch - Whether names match
     * @returns Confidence level
     */
    private calculateConfidence;
}
