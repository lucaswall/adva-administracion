/**
 * Subdiario de Ventas matcher
 * Matches bank credit movements against Cobros from Subdiario de Ventas
 */
import type { BankMovement, SubdiarioCobro, SubdiarioMatchResult } from '../types/index.js';
/**
 * Extracts CUIT from bank movement concepto text
 * Uses the same logic as extractCuitFromConcepto in matcher.ts
 *
 * @param concepto - Bank movement concept text
 * @returns Extracted CUIT (11 digits) or undefined
 */
export declare function extractCuitFromMovementConcepto(concepto: string): string | undefined;
/**
 * Matcher for Subdiario de Ventas Cobros
 *
 * Two-pass matching:
 * 1. CUIT match: Extract CUIT from movement concepto, find cobro with same CUIT + matching amount
 * 2. Amount + Date: For remaining, match by amount and date proximity
 */
export declare class SubdiarioMatcher {
    /**
     * Matches a bank credit movement against cobros
     *
     * @param movement - Bank movement (must be a credit)
     * @param cobros - Available cobros to match against
     * @param usedCobros - Set of cobro row numbers already used (to prevent double-matching)
     * @returns Match result with generated Detalle text
     */
    matchMovement(movement: BankMovement, cobros: SubdiarioCobro[], usedCobros: Set<number>): SubdiarioMatchResult;
    /**
     * Finds a cobro with matching CUIT, amount, and date within range
     * Returns the cobro with the closest date if multiple matches exist
     */
    private findCuitMatch;
    /**
     * Finds a cobro with matching amount and date within range
     * Returns the cobro with the closest date
     */
    private findDateMatch;
    /**
     * Creates a no-match result
     */
    private noMatch;
}
