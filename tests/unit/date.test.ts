/**
 * Unit tests for date utilities
 * TDD: Write tests first, then implement functions
 */

import { describe, it, expect } from 'vitest';
import {
  parseArgDate,
  isWithinDays,
  formatISODate,
  toDateString
} from '../../src/utils/date';

describe('parseArgDate', () => {
  it('parses DD/MM/YYYY format', () => {
    const result = parseArgDate('15/03/2024');
    expect(result).toEqual(new Date(2024, 2, 15)); // Month is 0-indexed
  });

  it('parses YYYY-MM-DD format', () => {
    const result = parseArgDate('2024-03-15');
    expect(result).toEqual(new Date(2024, 2, 15));
  });

  it('parses DD-MM-YYYY format', () => {
    const result = parseArgDate('15-03-2024');
    expect(result).toEqual(new Date(2024, 2, 15));
  });

  it('returns null for invalid date', () => {
    const result = parseArgDate('invalid');
    expect(result).toBe(null);
  });

  it('returns null for empty string', () => {
    const result = parseArgDate('');
    expect(result).toBe(null);
  });

  it('handles single digit day and month', () => {
    const result = parseArgDate('5/3/2024');
    expect(result).toEqual(new Date(2024, 2, 5));
  });

  // Date object handling (Google Sheets returns Date objects for date columns)
  it('handles Date object input directly', () => {
    const input = new Date(2024, 2, 15);
    const result = parseArgDate(input);
    expect(result).toEqual(new Date(2024, 2, 15));
  });

  it('returns null for invalid Date object', () => {
    const input = new Date('invalid');
    const result = parseArgDate(input);
    expect(result).toBe(null);
  });

  it('returns null for null input', () => {
    const result = parseArgDate(null as unknown as string);
    expect(result).toBe(null);
  });

  it('returns null for undefined input', () => {
    const result = parseArgDate(undefined as unknown as string);
    expect(result).toBe(null);
  });
});

describe('isWithinDays', () => {
  it('returns true when date2 is 3 days before date1', () => {
    const date1 = new Date(2024, 2, 15); // March 15
    const date2 = new Date(2024, 2, 12); // March 12
    expect(isWithinDays(date1, date2, 3, 7)).toBe(true);
  });

  it('returns true when date2 is 7 days after date1', () => {
    const date1 = new Date(2024, 2, 15); // March 15
    const date2 = new Date(2024, 2, 22); // March 22
    expect(isWithinDays(date1, date2, 3, 7)).toBe(true);
  });

  it('returns false when date2 is 10 days after date1', () => {
    const date1 = new Date(2024, 2, 15); // March 15
    const date2 = new Date(2024, 2, 25); // March 25
    expect(isWithinDays(date1, date2, 3, 7)).toBe(false);
  });

  it('returns false when date2 is 5 days before date1', () => {
    const date1 = new Date(2024, 2, 15); // March 15
    const date2 = new Date(2024, 2, 10); // March 10
    expect(isWithinDays(date1, date2, 3, 7)).toBe(false);
  });

  it('returns true when dates are equal', () => {
    const date1 = new Date(2024, 2, 15);
    const date2 = new Date(2024, 2, 15);
    expect(isWithinDays(date1, date2, 3, 7)).toBe(true);
  });
});

describe('formatISODate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2024, 2, 15); // March 15, 2024
    expect(formatISODate(date)).toBe('2024-03-15');
  });

  it('zero-pads single digit month', () => {
    const date = new Date(2024, 0, 15); // January 15, 2024
    expect(formatISODate(date)).toBe('2024-01-15');
  });

  it('zero-pads single digit day', () => {
    const date = new Date(2024, 2, 5); // March 5, 2024
    expect(formatISODate(date)).toBe('2024-03-05');
  });
});

describe('toDateString', () => {
  it('converts Date object to ISO string', () => {
    const date = new Date(2024, 2, 15); // March 15, 2024
    expect(toDateString(date)).toBe('2024-03-15');
  });

  it('returns string values unchanged', () => {
    expect(toDateString('2024-03-15')).toBe('2024-03-15');
    expect(toDateString('15/03/2024')).toBe('15/03/2024');
  });

  it('returns empty string for null', () => {
    expect(toDateString(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(toDateString(undefined)).toBe('');
  });

  it('returns empty string for invalid Date object', () => {
    expect(toDateString(new Date('invalid'))).toBe('');
  });

  it('handles number fallback', () => {
    expect(toDateString(12345)).toBe('12345');
  });
});
