/**
 * Spanish date formatting utilities
 * Used for creating month folder names in Google Drive
 */

/**
 * Spanish month names (0-indexed)
 */
export const SPANISH_MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

/**
 * Formats a date as a month folder name
 *
 * Uses UTC methods for consistency with date.ts parsing functions.
 * This ensures dates created with Date.UTC() (like those from parseArgDate)
 * are interpreted correctly regardless of local timezone.
 *
 * @param date - Date to format (interpreted as UTC)
 * @returns Folder name in format "MM - MonthName" (e.g., "01 - Enero"), or undefined if date is invalid
 */
export function formatMonthFolder(date: Date): string | undefined {
  // Validate date is valid
  if (isNaN(date.getTime())) {
    return undefined;
  }

  const monthIndex = date.getUTCMonth();
  const monthNumber = String(monthIndex + 1).padStart(2, '0');
  const monthName = SPANISH_MONTHS[monthIndex];
  return `${monthNumber} - ${monthName}`;
}
