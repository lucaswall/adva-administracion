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
export declare function parseArgDate(dateInput: string | Date): Date | null;
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
export declare function isWithinDays(date1: Date, date2: Date, daysBefore: number, daysAfter: number): boolean;
/**
 * Formats a Date object as ISO date string (YYYY-MM-DD)
 *
 * @param date - Date to format
 * @returns ISO date string
 */
export declare function formatISODate(date: Date): string;
/**
 * Converts a cell value to a date string
 *
 * Google Sheets returns Date objects for date-formatted cells.
 * This function normalizes both Date objects and strings to ISO format.
 *
 * @param value - Cell value (Date object or string)
 * @returns ISO date string (YYYY-MM-DD) or empty string if invalid
 */
export declare function toDateString(value: unknown): string;
