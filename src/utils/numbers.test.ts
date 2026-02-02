/**
 * Tests for centralized number parsing utilities
 */

import { describe, it, expect } from 'vitest';
import {
  detectNumberFormat,
  parseNumber,
  parseAmount,
  formatArgentineNumber,
  formatUSCurrency,
  normalizeAmount,
  amountsMatch
} from './numbers.js';

describe('detectNumberFormat', () => {
  it('detects Argentine format (comma last)', () => {
    expect(detectNumberFormat('1.234,56')).toBe('argentine');
    expect(detectNumberFormat('847.000,00')).toBe('argentine');
  });

  it('detects US format (dot last)', () => {
    expect(detectNumberFormat('1,234.56')).toBe('us');
    expect(detectNumberFormat('847,000.00')).toBe('us');
  });

  it('detects plain format (only comma)', () => {
    expect(detectNumberFormat('1234,56')).toBe('argentine');
  });

  it('detects plain format (only dot or nothing)', () => {
    expect(detectNumberFormat('1234.56')).toBe('plain');
    expect(detectNumberFormat('1234')).toBe('plain');
  });
});

describe('parseNumber', () => {
  describe('Argentine format', () => {
    it('parses with thousands and decimal', () => {
      expect(parseNumber('1.234,56')).toBe(1234.56);
      expect(parseNumber('847.000,00')).toBe(847000);
      expect(parseNumber('10.000,50')).toBe(10000.5);
    });

    it('parses without thousands', () => {
      expect(parseNumber('123,45')).toBe(123.45);
      expect(parseNumber('1,50')).toBe(1.5);
    });

    it('parses negative numbers', () => {
      expect(parseNumber('-1.234,56')).toBe(-1234.56);
      expect(parseNumber('(1.234,56)')).toBe(-1234.56);
    });
  });

  describe('US format', () => {
    it('parses with thousands and decimal', () => {
      expect(parseNumber('1,234.56')).toBe(1234.56);
      expect(parseNumber('847,000.00')).toBe(847000);
      expect(parseNumber('10,000.50')).toBe(10000.5);
    });

    it('parses without thousands', () => {
      expect(parseNumber('123.45')).toBe(123.45);
      expect(parseNumber('1.50')).toBe(1.5);
    });

    it('parses negative numbers', () => {
      expect(parseNumber('-1,234.56')).toBe(-1234.56);
      expect(parseNumber('(1,234.56)')).toBe(-1234.56);
    });

    it('parses accounting notation with currency symbol inside parentheses', () => {
      expect(parseNumber('($1,234.56)')).toBe(-1234.56);
      expect(parseNumber('($100.00)')).toBe(-100);
      expect(parseNumber('(-$1,234.56)')).toBe(-1234.56);
    });
  });

  describe('Plain format', () => {
    it('parses integers', () => {
      expect(parseNumber('1234')).toBe(1234);
      expect(parseNumber('847000')).toBe(847000);
    });

    it('parses decimals without thousands', () => {
      expect(parseNumber('1234.56')).toBe(1234.56);
      expect(parseNumber('847000.00')).toBe(847000);
    });
  });

  describe('Currency symbols', () => {
    it('removes dollar signs', () => {
      expect(parseNumber('$1,234.56')).toBe(1234.56);
      expect(parseNumber('$ 1.234,56')).toBe(1234.56);
    });

    it('removes spaces', () => {
      expect(parseNumber('1 234,56')).toBe(1234.56);
      expect(parseNumber('1 234.56')).toBe(1234.56);
    });
  });

  describe('Already numbers', () => {
    it('returns numbers as-is', () => {
      expect(parseNumber(1234.56)).toBe(1234.56);
      expect(parseNumber(847000)).toBe(847000);
      expect(parseNumber(-100)).toBe(-100);
    });

    it('returns null for NaN', () => {
      expect(parseNumber(NaN)).toBe(null);
    });
  });

  describe('Null/undefined/empty', () => {
    it('returns null for empty values', () => {
      expect(parseNumber(null)).toBe(null);
      expect(parseNumber(undefined)).toBe(null);
      expect(parseNumber('')).toBe(null);
      expect(parseNumber('   ')).toBe(null);
    });
  });

  describe('Invalid values', () => {
    it('returns null for invalid strings', () => {
      expect(parseNumber('abc')).toBe(null);
      expect(parseNumber('not a number')).toBe(null);
      expect(parseNumber('$')).toBe(null);
    });
  });

  describe('Edge cases - Scubalight bug', () => {
    it('correctly parses US format that was previously broken', () => {
      expect(parseNumber('847,000.00')).toBe(847000);
      expect(parseNumber('847.000,00')).toBe(847000);
    });
  });
});

describe('parseAmount', () => {
  it('returns absolute value', () => {
    expect(parseAmount('-1,234.56')).toBe(1234.56);
    expect(parseAmount('(100.00)')).toBe(100);
    expect(parseAmount(-500)).toBe(500);
  });

  it('parses positive numbers normally', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('847,000.00')).toBe(847000);
  });

  it('returns null for invalid values', () => {
    expect(parseAmount(null)).toBe(null);
    expect(parseAmount('invalid')).toBe(null);
  });
});

describe('formatArgentineNumber', () => {
  it('formats numbers with thousands and 2 decimals', () => {
    expect(formatArgentineNumber(1234.56)).toBe('1.234,56');
    expect(formatArgentineNumber(847000)).toBe('847.000,00');
    expect(formatArgentineNumber(10000.5)).toBe('10.000,50');
  });

  it('formats small numbers', () => {
    expect(formatArgentineNumber(123.45)).toBe('123,45');
    expect(formatArgentineNumber(1.5)).toBe('1,50');
    expect(formatArgentineNumber(0.99)).toBe('0,99');
  });

  it('formats negative numbers with sign preserved', () => {
    expect(formatArgentineNumber(-1234.56)).toBe('-1.234,56');
    expect(formatArgentineNumber(-100)).toBe('-100,00');
    expect(formatArgentineNumber(-10000.50)).toBe('-10.000,50');
  });

  it('formats integers with .00', () => {
    expect(formatArgentineNumber(1000)).toBe('1.000,00');
    expect(formatArgentineNumber(42)).toBe('42,00');
  });

  it('accepts string input', () => {
    expect(formatArgentineNumber('1234.56')).toBe('1.234,56');
    expect(formatArgentineNumber('847,000.00')).toBe('847.000,00');
  });

  it('returns empty string for invalid values', () => {
    expect(formatArgentineNumber(null)).toBe('');
    expect(formatArgentineNumber(undefined)).toBe('');
    expect(formatArgentineNumber('invalid')).toBe('');
  });

  it('supports custom decimal places', () => {
    expect(formatArgentineNumber(1234.56789, 0)).toBe('1.235');
    expect(formatArgentineNumber(1234.56789, 3)).toBe('1.234,568');
    expect(formatArgentineNumber(1234.56789, 4)).toBe('1.234,5679');
  });
});

describe('formatUSCurrency', () => {
  it('formats numbers with thousands separator and 2 decimals', () => {
    expect(formatUSCurrency(1234.56)).toBe('1,234.56');
    expect(formatUSCurrency(847000)).toBe('847,000.00');
    expect(formatUSCurrency(10000.5)).toBe('10,000.50');
  });

  it('formats small numbers', () => {
    expect(formatUSCurrency(123.45)).toBe('123.45');
    expect(formatUSCurrency(1.5)).toBe('1.50');
    expect(formatUSCurrency(0.99)).toBe('0.99');
  });

  it('formats negative numbers with sign preserved', () => {
    expect(formatUSCurrency(-1234.56)).toBe('-1,234.56');
    expect(formatUSCurrency(-100)).toBe('-100.00');
    expect(formatUSCurrency(-10000.50)).toBe('-10,000.50');
  });

  it('formats integers with .00', () => {
    expect(formatUSCurrency(1000)).toBe('1,000.00');
    expect(formatUSCurrency(42)).toBe('42.00');
  });

  it('accepts string input', () => {
    expect(formatUSCurrency('1234.56')).toBe('1,234.56');
    expect(formatUSCurrency('847,000.00')).toBe('847,000.00');
  });

  it('returns empty string for invalid values', () => {
    expect(formatUSCurrency(null)).toBe('');
    expect(formatUSCurrency(undefined)).toBe('');
    expect(formatUSCurrency('invalid')).toBe('');
  });

  it('supports custom decimal places', () => {
    expect(formatUSCurrency(1234.56789, 0)).toBe('1,235');
    expect(formatUSCurrency(1234.56789, 3)).toBe('1,234.568');
    expect(formatUSCurrency(1234.56789, 4)).toBe('1,234.5679');
  });
});

describe('normalizeAmount', () => {
  it('normalizes to standard format with 2 decimals', () => {
    expect(normalizeAmount('1.234,56')).toBe('1234.56');
    expect(normalizeAmount('847,000.00')).toBe('847000.00');
    expect(normalizeAmount(1234.5)).toBe('1234.50');
  });

  it('returns absolute value', () => {
    expect(normalizeAmount('-100.00')).toBe('100.00');
    expect(normalizeAmount('(50,00)')).toBe('50.00');
  });

  it('returns "0" for invalid values', () => {
    expect(normalizeAmount(null)).toBe('0');
    expect(normalizeAmount('invalid')).toBe('0');
  });

  it('returns "0" for zero values', () => {
    expect(normalizeAmount(0)).toBe('0');
    expect(normalizeAmount('0')).toBe('0');
    expect(normalizeAmount('0.00')).toBe('0');
  });

  it('always has 2 decimal places for non-zero values', () => {
    expect(normalizeAmount(100)).toBe('100.00');
    expect(normalizeAmount('1234')).toBe('1234.00');
  });
});

describe('amountsMatch', () => {
  it('matches exact amounts', () => {
    expect(amountsMatch('1.234,56', '1,234.56')).toBe(true);
    expect(amountsMatch(100, '100.00')).toBe(true);
  });

  it('matches within default tolerance (1 peso)', () => {
    expect(amountsMatch(100, 100.5)).toBe(true);
    expect(amountsMatch(100, 100.99)).toBe(true);
    expect(amountsMatch('1.000,00', '1,000.50')).toBe(true);
  });

  it('does not match beyond tolerance', () => {
    expect(amountsMatch(100, 101.5)).toBe(false);
    expect(amountsMatch('1.000,00', '1,002.00')).toBe(false);
  });

  it('supports custom tolerance', () => {
    expect(amountsMatch(100, 105, 5)).toBe(true);
    expect(amountsMatch(100, 106, 5)).toBe(false);
    expect(amountsMatch('1.000,00', '1,010.00', 10)).toBe(true);
  });

  it('matches negative and positive (absolute values)', () => {
    expect(amountsMatch(-100, 100)).toBe(true);
    expect(amountsMatch('(100,00)', '100.00')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(amountsMatch(null, 100)).toBe(false);
    expect(amountsMatch(100, null)).toBe(false);
    expect(amountsMatch('invalid', '100')).toBe(false);
  });
});
