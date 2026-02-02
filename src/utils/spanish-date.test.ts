/**
 * Unit tests for Spanish date utilities
 * TDD: Write tests first, then implement functions
 */

import { describe, it, expect } from 'vitest';
import {
  SPANISH_MONTHS,
  formatMonthFolder,
} from './spanish-date.js';

describe('SPANISH_MONTHS', () => {
  it('has 12 months', () => {
    expect(SPANISH_MONTHS).toHaveLength(12);
  });

  it('starts with Enero (January)', () => {
    expect(SPANISH_MONTHS[0]).toBe('Enero');
  });

  it('ends with Diciembre (December)', () => {
    expect(SPANISH_MONTHS[11]).toBe('Diciembre');
  });

  it('has all months in correct order', () => {
    expect(SPANISH_MONTHS).toEqual([
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
    ]);
  });
});

describe('formatMonthFolder', () => {
  it('formats January as "01 - Enero"', () => {
    const date = new Date(2024, 0, 15); // January 15, 2024
    expect(formatMonthFolder(date)).toBe('01 - Enero');
  });

  it('formats December as "12 - Diciembre"', () => {
    const date = new Date(2024, 11, 25); // December 25, 2024
    expect(formatMonthFolder(date)).toBe('12 - Diciembre');
  });

  it('formats June as "06 - Junio"', () => {
    const date = new Date(2024, 5, 1); // June 1, 2024
    expect(formatMonthFolder(date)).toBe('06 - Junio');
  });

  it('formats October as "10 - Octubre"', () => {
    const date = new Date(2024, 9, 31); // October 31, 2024
    expect(formatMonthFolder(date)).toBe('10 - Octubre');
  });

  it('handles different years', () => {
    const date2023 = new Date(2023, 2, 15); // March 2023
    const date2025 = new Date(2025, 2, 15); // March 2025
    expect(formatMonthFolder(date2023)).toBe('03 - Marzo');
    expect(formatMonthFolder(date2025)).toBe('03 - Marzo');
  });

  it('formats all 12 months correctly', () => {
    const expectedResults = [
      '01 - Enero',
      '02 - Febrero',
      '03 - Marzo',
      '04 - Abril',
      '05 - Mayo',
      '06 - Junio',
      '07 - Julio',
      '08 - Agosto',
      '09 - Septiembre',
      '10 - Octubre',
      '11 - Noviembre',
      '12 - Diciembre',
    ];

    for (let month = 0; month < 12; month++) {
      const date = new Date(2024, month, 15);
      expect(formatMonthFolder(date)).toBe(expectedResults[month]);
    }
  });

  // Bug #23: Handle invalid dates gracefully
  it('returns undefined for invalid date string', () => {
    const invalidDate = new Date('invalid');
    expect(formatMonthFolder(invalidDate)).toBeUndefined();
  });

  it('returns undefined for NaN date', () => {
    const nanDate = new Date(NaN);
    expect(formatMonthFolder(nanDate)).toBeUndefined();
  });

  it('returns valid format for valid date', () => {
    const validDate = new Date('2025-03-15');
    expect(formatMonthFolder(validDate)).toBe('03 - Marzo');
  });

  // ADV-14: UTC consistency tests
  describe('UTC consistency', () => {
    it('handles UTC date at midnight correctly (edge case for timezone boundary)', () => {
      // UTC midnight on Jan 1 - in Argentina (UTC-3) this would be Dec 31 at 21:00
      // The function should use UTC month, not local month
      const utcMidnight = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
      expect(formatMonthFolder(utcMidnight)).toBe('01 - Enero');
    });

    it('handles date created from parseArgDate (UTC noon) correctly', () => {
      // parseArgDate creates dates at UTC noon to avoid DST issues
      // UTC noon on Jan 1 = Argentina 9:00 AM on Jan 1 (still Jan 1)
      // But UTC midnight on Jan 1 = Argentina Dec 31 at 21:00
      const utcNoon = new Date(Date.UTC(2025, 0, 1, 12, 0, 0));
      expect(formatMonthFolder(utcNoon)).toBe('01 - Enero');
    });

    it('produces consistent results regardless of local timezone simulation', () => {
      // Create a UTC date that represents Dec 31 23:00 UTC
      // In UTC-3 (Argentina), this is Jan 1 02:00
      // Using UTC methods should give December, not January
      const utcLateDecember = new Date(Date.UTC(2025, 11, 31, 23, 0, 0));
      expect(formatMonthFolder(utcLateDecember)).toBe('12 - Diciembre');
    });

    it('handles early January dates without shifting to December', () => {
      // UTC January 1st at various times should all return January
      const jan1Early = new Date(Date.UTC(2025, 0, 1, 3, 0, 0));
      const jan1Mid = new Date(Date.UTC(2025, 0, 1, 12, 0, 0));
      const jan1Late = new Date(Date.UTC(2025, 0, 1, 23, 59, 59));

      expect(formatMonthFolder(jan1Early)).toBe('01 - Enero');
      expect(formatMonthFolder(jan1Mid)).toBe('01 - Enero');
      expect(formatMonthFolder(jan1Late)).toBe('01 - Enero');
    });
  });
});
