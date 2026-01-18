/**
 * Centralized number parsing and formatting utilities
 *
 * Handles both Argentine and US number formats automatically:
 * - Argentine: "1.234,56" (dots for thousands, comma for decimal)
 * - US: "1,234.56" (comma for thousands, dot for decimal)
 * - Mixed: "1234.56" or "1234,56" (no thousands separator)
 *
 * All amounts are normalized internally as JavaScript numbers.
 */
/**
 * Format detection result
 */
export type NumberFormat = 'argentine' | 'us' | 'plain';
/**
 * Detects the number format based on separator positions
 *
 * Logic:
 * - If both comma and dot present: last one is decimal separator
 * - If only comma: Argentine format (decimal separator)
 * - If only dot or no separator: US/plain format
 *
 * @param str - Cleaned number string (no currency symbols)
 * @returns Detected format
 */
export declare function detectNumberFormat(str: string): NumberFormat;
/**
 * Parses a number from various formats to a JavaScript number
 *
 * Handles:
 * - Argentine format: "1.234,56" → 1234.56
 * - US format: "1,234.56" → 1234.56
 * - Plain format: "1234.56" → 1234.56
 * - Negative numbers: "-1.234,56" → -1234.56
 * - Currency symbols: "$1,234.56" → 1234.56
 * - Google Sheets numbers: 1234.56 → 1234.56
 *
 * @param value - Value to parse (string, number, or null/undefined)
 * @returns Parsed number or null if invalid
 */
export declare function parseNumber(value: unknown): number | null;
/**
 * Parses a monetary amount to a positive number
 *
 * Same as parseNumber but always returns absolute value.
 * Useful for amounts where sign is tracked separately (e.g., Debit/Credit columns).
 *
 * @param value - Value to parse
 * @returns Absolute value or null if invalid
 */
export declare function parseAmount(value: unknown): number | null;
/**
 * Formats a number as an Argentine format string
 *
 * Output format: "1.234,56" (dots for thousands, comma for decimal)
 * Always shows 2 decimal places.
 * Preserves sign for negative numbers: "-1.234,56"
 *
 * @param value - Number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string or empty string if invalid
 */
export declare function formatArgentineNumber(value: unknown, decimals?: number): string;
/**
 * Normalizes an amount to a standardized string for comparison/keys
 *
 * Converts to absolute value with 2 decimal places: "1234.56"
 * Useful for generating deduplication keys or comparing amounts.
 *
 * @param value - Amount to normalize
 * @returns Normalized string like "1234.56" or "0" if invalid
 */
export declare function normalizeAmount(value: unknown): string;
/**
 * Checks if two amounts are equal within a tolerance
 *
 * @param amount1 - First amount
 * @param amount2 - Second amount
 * @param tolerance - Maximum difference (default: 1 peso)
 * @returns true if amounts match within tolerance
 */
export declare function amountsMatch(amount1: unknown, amount2: unknown, tolerance?: number): boolean;
