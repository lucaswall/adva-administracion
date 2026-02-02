/**
 * Date parsing and comparison utilities
 * Handles Argentine date formats (DD/MM/YYYY) and ISO (YYYY-MM-DD)
 */

/**
 * Validates that a string is a valid ISO date in YYYY-MM-DD format
 * with a reasonable year (current year - 16 to current year + 1)
 *
 * Extended to 16 years to support historical Argentine invoices.
 *
 * @param dateStr - String to validate
 * @returns true if valid ISO date, false otherwise
 */
export function isValidISODate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;

  // Check format: must be exactly YYYY-MM-DD with 2-digit month/day
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const [, yearStr, monthStr, dayStr] = match;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Validate year is in reasonable range (current year - 16 to current year + 1)
  // Extended to 16 years back to support historical Argentine invoices (ADV-29)
  const currentYear = new Date().getFullYear();
  if (year < currentYear - 16 || year > currentYear + 1) return false;

  // Validate month (1-12)
  if (month < 1 || month > 12) return false;

  // Validate day (1-31 max, but check actual month limits)
  if (day < 1 || day > 31) return false;

  // Create date and verify it parsed correctly (catches Feb 30, etc.)
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  return true;
}

/**
 * Parses an Argentine date string to a Date object
 *
 * Supports formats:
 * - DD/MM/YYYY
 * - DD-MM-YYYY
 * - YYYY-MM-DD (ISO)
 * - Date object (returned as-is if valid)
 *
 * @param dateInput - Date string or Date object
 * @returns Date object or null if invalid
 */
export function parseArgDate(dateInput: string | Date): Date | null {
  if (!dateInput) return null;

  // If already a Date object, return it (if valid)
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput;
  }

  // Try ISO format first (YYYY-MM-DD, strict 2-digit month/day)
  const isoStrictMatch = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoStrictMatch) {
    const [, year, month, day] = isoStrictMatch;
    // Use UTC to avoid timezone issues (noon UTC to avoid DST edge cases)
    const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 12, 0, 0));
    if (!isNaN(date.getTime())) return date;
  }

  // Try ISO format with flexible month/day (1 or 2 digits)
  const isoFlexMatch = dateInput.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoFlexMatch) {
    const [, year, month, day] = isoFlexMatch;
    // Use UTC to avoid timezone issues (noon UTC to avoid DST edge cases)
    const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 12, 0, 0));
    if (!isNaN(date.getTime())) return date;
  }

  // Try DD/MM/YYYY or DD-MM-YYYY format
  const argMatch = dateInput.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (argMatch) {
    const [, day, month, year] = argMatch;
    // Use UTC to avoid timezone issues (noon UTC to avoid DST edge cases)
    const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 12, 0, 0));
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}

/**
 * Checks if date2 is within a range of days before/after date1
 *
 * Used for fuzzy date matching between facturas and pagos
 *
 * @param date1 - Reference date (e.g., invoice date)
 * @param date2 - Date to check (e.g., payment date)
 * @param daysBefore - Maximum days before date1 (inclusive)
 * @param daysAfter - Maximum days after date1 (inclusive)
 * @returns true if date2 is within range
 */
export function isWithinDays(
  date1: Date,
  date2: Date,
  daysBefore: number,
  daysAfter: number
): boolean {
  // Calculate difference in days
  const diffMs = date2.getTime() - date1.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Check if within range
  return diffDays >= -daysBefore && diffDays <= daysAfter;
}

/**
 * Formats a Date object as ISO date string (YYYY-MM-DD)
 *
 * @param date - Date to format
 * @returns ISO date string
 */
export function formatISODate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Converts a cell value to a date string
 *
 * Google Sheets returns Date objects for date-formatted cells.
 * This function normalizes both Date objects and strings to ISO format.
 *
 * @param value - Cell value (Date object or string)
 * @returns ISO date string (YYYY-MM-DD) or empty string if invalid
 */
export function toDateString(value: unknown): string {
  if (!value) return '';

  // If it's a Date object, format it as ISO
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return formatISODate(value);
  }

  // If it's already a string, return it
  if (typeof value === 'string') {
    return value;
  }

  // Fallback to String conversion
  return String(value);
}

/**
 * Converts a Google Sheets serial number to date string (YYYY-MM-DD)
 *
 * Google Sheets uses December 30, 1899 as day 0 (epoch).
 * This is useful when reading dates from spreadsheets with
 * `valueRenderOption: 'UNFORMATTED_VALUE'` and `dateTimeRenderOption: 'SERIAL_NUMBER'`
 *
 * @param serial - Google Sheets serial number
 * @returns ISO date string (YYYY-MM-DD)
 *
 * @example
 * serialToDateString(45993) // Returns '2025-12-23'
 */
export function serialToDateString(serial: number): string {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(epoch.getTime() + serial * 24 * 60 * 60 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalizes a spreadsheet date value to a date string
 *
 * Handles both serial numbers (from UNFORMATTED_VALUE reads) and
 * existing date strings. Use this for duplicate detection when
 * comparing dates read from spreadsheets.
 *
 * @param value - Cell value (serial number or date string)
 * @returns ISO date string (YYYY-MM-DD)
 */
export function normalizeSpreadsheetDate(value: unknown): string {
  if (typeof value === 'number') {
    return serialToDateString(value);
  }
  // Handle CellDate objects { type: 'date', value: string }
  if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
    const cellDate = value as { type: string; value: unknown };
    if (cellDate.type === 'date' && typeof cellDate.value === 'string') {
      return cellDate.value;
    }
  }
  return String(value ?? '');
}
