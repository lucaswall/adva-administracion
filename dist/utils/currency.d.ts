/**
 * Currency and number formatting utilities
 * Re-exports centralized number utilities from utils/numbers
 */
/**
 * Tolerance for amount comparison in pesos (1 peso for invoice matching)
 */
export declare const AMOUNT_TOLERANCE = 1;
/**
 * Compares two monetary amounts with tolerance
 *
 * @deprecated Use amountsMatch from utils/numbers instead
 * @param a - First amount
 * @param b - Second amount
 * @returns true if amounts match within AMOUNT_TOLERANCE
 */
export declare function amountsMatch(a: number, b: number): boolean;
/**
 * Formats a number in Argentine format
 * - Uses dots (.) for thousands separator
 * - Uses comma (,) for decimal separator
 * - Always shows 2 decimal places
 *
 * @deprecated Use formatArgentineNumber from utils/numbers instead
 * @param value - Number or string to format
 * @returns Formatted string (e.g., "1.041.250,00") or empty string if invalid
 *
 * @example
 * formatArgentineNumber(1041250.5) // "1.041.250,50"
 * formatArgentineNumber("1041250") // "1.041.250,00"
 * formatArgentineNumber("") // ""
 */
export declare function formatArgentineNumber(value: unknown): string;
