/**
 * Unit tests for Spanish date utilities
 * TDD: Write tests first, then implement functions
 */

import { describe, it, expect } from 'vitest';
import {
  SPANISH_MONTHS,
  formatMonthFolder,
} from '../../../src/utils/spanish-date.js';

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
});
