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
 * @param date - Date to format
 * @returns Folder name in format "MM - MonthName" (e.g., "01 - Enero")
 */
export function formatMonthFolder(date: Date): string {
  const monthIndex = date.getMonth();
  const monthNumber = String(monthIndex + 1).padStart(2, '0');
  const monthName = SPANISH_MONTHS[monthIndex];
  return `${monthNumber} - ${monthName}`;
}
