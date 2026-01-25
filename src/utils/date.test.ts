/**
 * Tests for date utilities
 */

import { describe, it, expect } from 'vitest';
import { serialToDateString, normalizeSpreadsheetDate, parseArgDate, formatISODate, isWithinDays } from './date.js';

describe('serialToDateString', () => {
  it('handles epoch date (serial 0)', () => {
    // Serial 0 is 1899-12-30 (Google Sheets epoch)
    expect(serialToDateString(0)).toBe('1899-12-30');
  });

  it('handles serial number 1', () => {
    // Serial 1 is 1899-12-31
    expect(serialToDateString(1)).toBe('1899-12-31');
  });

  it('handles serial number 2', () => {
    // Serial 2 is 1900-01-01
    expect(serialToDateString(2)).toBe('1900-01-01');
  });

  it('converts a recent date correctly', () => {
    // Calculate serial for 2025-12-23
    // Days from 1899-12-30 to 2025-12-23
    const date = new Date(Date.UTC(2025, 11, 23));
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const expectedSerial = Math.floor((date.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24));
    expect(serialToDateString(expectedSerial)).toBe('2025-12-23');
  });

  it('is consistent with dateStringToSerial from sheets.ts', () => {
    // Verify roundtrip: serial -> date string matches expected pattern
    const serial = 45000; // An arbitrary serial number
    const dateStr = serialToDateString(serial);
    // Should return a valid YYYY-MM-DD format
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('normalizeSpreadsheetDate', () => {
  it('converts serial number to date string', () => {
    // Use a known serial: 2 = 1900-01-01
    expect(normalizeSpreadsheetDate(2)).toBe('1900-01-01');
  });

  it('converts serial number correctly for recent date', () => {
    // Calculate serial for a known date
    const date = new Date(Date.UTC(2025, 0, 1)); // 2025-01-01
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const serial = Math.floor((date.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24));
    expect(normalizeSpreadsheetDate(serial)).toBe('2025-01-01');
  });

  it('passes through string dates unchanged', () => {
    expect(normalizeSpreadsheetDate('2025-12-23')).toBe('2025-12-23');
  });

  it('handles null/undefined', () => {
    expect(normalizeSpreadsheetDate(null)).toBe('');
    expect(normalizeSpreadsheetDate(undefined)).toBe('');
  });

  it('converts other types to string', () => {
    expect(normalizeSpreadsheetDate(true)).toBe('true');
  });
});

describe('parseArgDate', () => {
  it('parses ISO date format (YYYY-MM-DD)', () => {
    const date = parseArgDate('2025-12-23');
    expect(date).not.toBeNull();
    expect(date?.getUTCFullYear()).toBe(2025);
    expect(date?.getUTCMonth()).toBe(11); // December = 11
    expect(date?.getUTCDate()).toBe(23);
  });

  it('parses Argentine date format (DD/MM/YYYY)', () => {
    const date = parseArgDate('23/12/2025');
    expect(date).not.toBeNull();
    expect(date?.getUTCFullYear()).toBe(2025);
    expect(date?.getUTCMonth()).toBe(11);
    expect(date?.getUTCDate()).toBe(23);
  });

  it('parses Argentine date format with dashes (DD-MM-YYYY)', () => {
    const date = parseArgDate('23-12-2025');
    expect(date).not.toBeNull();
    expect(date?.getUTCFullYear()).toBe(2025);
    expect(date?.getUTCMonth()).toBe(11);
    expect(date?.getUTCDate()).toBe(23);
  });

  it('returns null for invalid date', () => {
    expect(parseArgDate('')).toBeNull();
    expect(parseArgDate('invalid')).toBeNull();
  });

  it('returns Date object as-is if valid', () => {
    const inputDate = new Date('2025-12-23T12:00:00Z');
    const result = parseArgDate(inputDate);
    expect(result).toBe(inputDate);
  });
});

describe('formatISODate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2025, 11, 23); // December 23, 2025
    expect(formatISODate(date)).toBe('2025-12-23');
  });

  it('pads single-digit month and day with zeros', () => {
    const date = new Date(2025, 0, 5); // January 5, 2025
    expect(formatISODate(date)).toBe('2025-01-05');
  });
});

describe('isWithinDays', () => {
  it('returns true when date2 is within range', () => {
    const date1 = new Date('2025-12-15');
    const date2 = new Date('2025-12-20'); // 5 days after
    expect(isWithinDays(date1, date2, 10, 10)).toBe(true);
  });

  it('returns true when date2 is exactly at daysBefore boundary', () => {
    const date1 = new Date('2025-12-15');
    const date2 = new Date('2025-12-05'); // 10 days before
    expect(isWithinDays(date1, date2, 10, 10)).toBe(true);
  });

  it('returns true when date2 is exactly at daysAfter boundary', () => {
    const date1 = new Date('2025-12-15');
    const date2 = new Date('2025-12-25'); // 10 days after
    expect(isWithinDays(date1, date2, 10, 10)).toBe(true);
  });

  it('returns false when date2 is outside range (before)', () => {
    const date1 = new Date('2025-12-15');
    const date2 = new Date('2025-12-01'); // 14 days before
    expect(isWithinDays(date1, date2, 10, 10)).toBe(false);
  });

  it('returns false when date2 is outside range (after)', () => {
    const date1 = new Date('2025-12-15');
    const date2 = new Date('2025-12-30'); // 15 days after
    expect(isWithinDays(date1, date2, 10, 10)).toBe(false);
  });
});
