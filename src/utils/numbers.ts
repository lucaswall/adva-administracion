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
export function detectNumberFormat(str: string): NumberFormat {
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // Both separators present - last one is decimal
    return lastComma > lastDot ? 'argentine' : 'us';
  } else if (lastComma !== -1) {
    // Only comma - Argentine decimal separator
    return 'argentine';
  }

  // Only dot or no separator - US/plain format
  return 'plain';
}

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
export function parseNumber(value: unknown): number | null {
  // Handle null/undefined/empty
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Already a number - return as-is
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }

  // Convert to string for parsing
  let str = String(value).trim();

  // Empty after trim
  if (str === '') {
    return null;
  }

  // Remove currency symbols and whitespace
  str = str.replace(/[$\s]/g, '');

  // Handle negative numbers
  const isNegative = str.startsWith('-') || str.startsWith('(');
  if (isNegative) {
    str = str.replace(/^[-()]/g, '').replace(/\)$/g, '');
  }

  // Detect format and normalize to standard decimal format
  const format = detectNumberFormat(str);

  switch (format) {
    case 'argentine':
      // Remove dots (thousands), replace comma with dot (decimal)
      str = str.replace(/\./g, '').replace(',', '.');
      break;
    case 'us':
      // Remove commas (thousands), keep dot (decimal)
      str = str.replace(/,/g, '');
      break;
    case 'plain':
      // Already in standard format or needs no conversion
      break;
  }

  // Parse to number
  const parsed = parseFloat(str);

  if (isNaN(parsed)) {
    return null;
  }

  return isNegative ? -parsed : parsed;
}

/**
 * Parses a monetary amount to a positive number
 *
 * Same as parseNumber but always returns absolute value.
 * Useful for amounts where sign is tracked separately (e.g., Debit/Credit columns).
 *
 * @param value - Value to parse
 * @returns Absolute value or null if invalid
 */
export function parseAmount(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.abs(parsed);
}

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
export function formatArgentineNumber(value: unknown, decimals: number = 2): string {
  const num = parseNumber(value);

  if (num === null) {
    return '';
  }

  // Preserve sign
  const isNegative = num < 0;
  const absNum = Math.abs(num);

  // Convert to fixed decimal places
  const fixed = absNum.toFixed(decimals);

  // Split into integer and decimal parts
  const [integerPart, decimalPart] = fixed.split('.');

  // Add thousands separators (dots) to integer part
  const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Combine with comma as decimal separator
  const formatted = decimalPart ? `${withThousands},${decimalPart}` : withThousands;

  // Add negative sign if needed
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Formats a number as a US format string
 *
 * Output format: "1,234.56" (comma for thousands, dot for decimal)
 * Always shows 2 decimal places by default.
 * Preserves sign for negative numbers: "-1,234.56"
 *
 * @param value - Number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string or empty string if invalid
 */
export function formatUSCurrency(value: unknown, decimals: number = 2): string {
  const num = parseNumber(value);

  if (num === null) {
    return '';
  }

  // Preserve sign
  const isNegative = num < 0;
  const absNum = Math.abs(num);

  // Convert to fixed decimal places
  const fixed = absNum.toFixed(decimals);

  // Split into integer and decimal parts
  const [integerPart, decimalPart] = fixed.split('.');

  // Add thousands separators (commas) to integer part
  const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Combine with dot as decimal separator
  const formatted = decimalPart ? `${withThousands}.${decimalPart}` : withThousands;

  // Add negative sign if needed
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Normalizes an amount to a standardized string for comparison/keys
 *
 * Converts to absolute value with 2 decimal places: "1234.56"
 * Useful for generating deduplication keys or comparing amounts.
 *
 * @param value - Amount to normalize
 * @returns Normalized string like "1234.56" or "0" if invalid
 */
export function normalizeAmount(value: unknown): string {
  const num = parseAmount(value);

  if (num === null || num === 0) {
    return '0';
  }

  return num.toFixed(2);
}

/**
 * Checks if two amounts are equal within a tolerance
 *
 * @param amount1 - First amount
 * @param amount2 - Second amount
 * @param tolerance - Maximum difference (default: 1 peso)
 * @returns true if amounts match within tolerance
 */
export function amountsMatch(
  amount1: unknown,
  amount2: unknown,
  tolerance: number = 1
): boolean {
  const num1 = parseAmount(amount1);
  const num2 = parseAmount(amount2);

  if (num1 === null || num2 === null) {
    return false;
  }

  return Math.abs(num1 - num2) <= tolerance;
}
