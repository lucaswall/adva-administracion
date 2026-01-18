/**
 * Bank movement matcher
 * Matches bank movements against Facturas, Recibos, and Pagos
 */
import type { BankMovement, BankMovementMatchResult, Factura, Pago, Recibo } from '../types/index.js';
/**
 * Checks if a bank concept represents a direct debit transaction
 *
 * @param concepto - Bank transaction concept text
 * @returns True if the concept matches a direct debit pattern
 */
export declare function isDirectDebit(concepto: string): boolean;
/**
 * Extracts meaningful tokens from a bank concept for keyword matching
 * Filters out numbers, short words, and bank jargon
 * Splits alphanumeric combinations (e.g., "20751CUOTA" -> ["CUOTA"])
 *
 * @param concepto - Bank transaction concept text
 * @returns Array of meaningful tokens (uppercase, normalized)
 */
export declare function extractKeywordTokens(concepto: string): string[];
/**
 * Calculates a keyword match score between a bank concept and a factura
 * Higher scores indicate better matches
 *
 * @param bankConcepto - Bank transaction concept text
 * @param emisorName - Factura emisor razon social
 * @param facturaConcepto - Factura concepto (optional)
 * @returns Match score (0 = no match, higher = better match)
 */
export declare function calculateKeywordMatchScore(bankConcepto: string, emisorName: string, facturaConcepto?: string): number;
/**
 * Checks if a bank concept represents a credit card payment
 *
 * @param concepto - Bank transaction concept text
 * @returns True if the concept matches a credit card payment pattern
 */
export declare function isCreditCardPayment(concepto: string): boolean;
/**
 * Checks if a bank concept represents a bank fee/charge
 *
 * @param concepto - Bank transaction concept text
 * @returns True if the concept matches a bank fee pattern
 */
export declare function isBankFee(concepto: string): boolean;
/**
 * Extracts CUIT/CUIL from bank concept text using regex patterns
 *
 * Patterns recognized:
 * - "CUIT 30-71234567-8" or "CUIL: 20271190523"
 * - "XX-XXXXXXXX-X" format
 * - Plain 11-digit number with valid checksum
 * - Embedded in text like "TRANSFERENCI 30709076783"
 *
 * @param concepto - Bank transaction concept text
 * @returns Extracted CUIT (11 digits) or undefined
 */
export declare function extractCuitFromConcepto(concepto: string): string | undefined;
/**
 * Matches bank movements against Facturas, Recibos, and Pagos
 */
export declare class BankMovementMatcher {
    private readonly crossCurrencyTolerancePercent;
    /**
     * Creates a new bank movement matcher
     *
     * @param crossCurrencyTolerancePercent - Tolerance for USD→ARS matching (default: 5%)
     */
    constructor(crossCurrencyTolerancePercent?: number);
    /**
     * Matches a bank movement against all available documents
     *
     * Priority:
     * 0. Bank fees (gastos bancarios) - FIRST
     * 1. Pago with linked Factura (BEST)
     * 2. Direct Factura match
     * 3. Recibo match
     * 4. Pago without linked Factura (REVISAR)
     * 5. No match
     *
     * @param movement - Bank movement to match
     * @param facturas - All facturas from sheet
     * @param recibos - All recibos from sheet
     * @param pagos - All pagos from sheet
     * @returns Match result with generated description
     */
    matchMovement(movement: BankMovement, facturas: Array<Factura & {
        row: number;
    }>, recibos: Array<Recibo & {
        row: number;
    }>, pagos: Array<Pago & {
        row: number;
    }>): BankMovementMatchResult;
    /**
     * Finds pagos matching amount and date criteria (tight: ±1 day)
     */
    private findMatchingPagos;
    /**
     * Finds facturas matching amount, date, and CUIT/keyword criteria
     * Supports cross-currency matching for USD facturas
     * For direct debits without CUIT, falls back to keyword matching
     */
    private findMatchingFacturas;
    /**
     * Finds recibos matching amount and date criteria
     */
    private findMatchingRecibos;
    /**
     * Creates a Pago → Factura match result (BEST)
     */
    private createPagoFacturaMatch;
    /**
     * Creates a direct Factura match result
     *
     * @param movement - Bank movement
     * @param factura - Matched factura
     * @param extractedCuit - CUIT extracted from bank concepto (if any)
     * @param reasons - Match reasons
     * @param facturaMatchType - How the factura was matched ('cuit' or 'keyword')
     */
    private createDirectFacturaMatch;
    /**
     * Creates a Recibo match result
     */
    private createReciboMatch;
    /**
     * Creates a Pago-only match result (REVISAR)
     */
    private createPagoOnlyMatch;
    /**
     * Creates a no-match result
     */
    private noMatch;
    /**
     * Creates a bank fee match result
     */
    private createBankFeeMatch;
    /**
     * Creates a credit card payment match result
     */
    private createCreditCardPaymentMatch;
    /**
     * Formats a Factura description
     */
    private formatFacturaDescription;
}
