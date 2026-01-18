/**
 * Date parsing and comparison utilities
 * Handles Argentine date formats (DD/MM/YYYY) and ISO (YYYY-MM-DD)
 */

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
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) return date;
  }

  // Try ISO format with flexible month/day (1 or 2 digits)
  const isoFlexMatch = dateInput.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoFlexMatch) {
    const [, year, month, day] = isoFlexMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) return date;
  }

  // Try DD/MM/YYYY or DD-MM-YYYY format
  const argMatch = dateInput.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (argMatch) {
    const [, day, month, year] = argMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

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
