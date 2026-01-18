/**
 * Unit tests for currency utilities
 */

import { describe, it, expect } from 'vitest';
import {
  AMOUNT_TOLERANCE,
  amountsMatch,
  formatArgentineNumber
} from '../../../src/utils/currency.js';

describe('currency', () => {
  describe('AMOUNT_TOLERANCE', () => {
    it('is defined as 1 peso', () => {
      expect(AMOUNT_TOLERANCE).toBe(1);
    });
  });

  describe('amountsMatch', () => {
    it('returns true for exact match', () => {
      expect(amountsMatch(100, 100)).toBe(true);
    });

    it('returns true for amounts within tolerance', () => {
      expect(amountsMatch(100, 100.5)).toBe(true);
      expect(amountsMatch(100, 99.5)).toBe(true);
    });

    it('returns false for amounts outside tolerance', () => {
      expect(amountsMatch(100, 101.1)).toBe(false);
      expect(amountsMatch(100, 98.9)).toBe(false);
    });

    it('handles negative amounts', () => {
      expect(amountsMatch(-100, -100)).toBe(true);
      expect(amountsMatch(-100, -99.5)).toBe(true);
      expect(amountsMatch(-100, -101.5)).toBe(false);
    });

    it('handles zero amounts', () => {
      expect(amountsMatch(0, 0)).toBe(true);
      expect(amountsMatch(0, 0.5)).toBe(true);
      expect(amountsMatch(0, -0.5)).toBe(true);
    });

    it('handles large amounts', () => {
      expect(amountsMatch(1000000, 1000000)).toBe(true);
      expect(amountsMatch(1000000, 1000000.9)).toBe(true);
      expect(amountsMatch(1000000, 1000001.1)).toBe(false);
    });

    it('handles decimal amounts', () => {
      expect(amountsMatch(100.50, 100.50)).toBe(true);
      expect(amountsMatch(100.50, 101.00)).toBe(true);
      expect(amountsMatch(100.50, 101.51)).toBe(false);
    });
  });

  describe('formatArgentineNumber', () => {
    it('formats integer numbers with thousands separator', () => {
      expect(formatArgentineNumber(1000)).toBe('1.000,00');
      expect(formatArgentineNumber(1000000)).toBe('1.000.000,00');
    });

    it('formats decimal numbers', () => {
      expect(formatArgentineNumber(1234.56)).toBe('1.234,56');
      expect(formatArgentineNumber(100.5)).toBe('100,50');
    });

    it('formats string numbers', () => {
      expect(formatArgentineNumber('1234')).toBe('1.234,00');
      expect(formatArgentineNumber('1234.56')).toBe('1.234,56');
    });

    it('returns empty string for invalid input', () => {
      expect(formatArgentineNumber('')).toBe('');
      expect(formatArgentineNumber('invalid')).toBe('');
      expect(formatArgentineNumber(null)).toBe('');
      expect(formatArgentineNumber(undefined)).toBe('');
    });

    it('formats zero', () => {
      expect(formatArgentineNumber(0)).toBe('0,00');
    });

    it('formats negative numbers', () => {
      expect(formatArgentineNumber(-1234.56)).toBe('-1.234,56');
    });

    it('always shows 2 decimal places', () => {
      expect(formatArgentineNumber(100)).toBe('100,00');
      expect(formatArgentineNumber(100.1)).toBe('100,10');
      expect(formatArgentineNumber(100.12)).toBe('100,12');
    });

    it('handles very large numbers', () => {
      expect(formatArgentineNumber(1234567890)).toBe('1.234.567.890,00');
    });

    it('handles very small decimal numbers', () => {
      expect(formatArgentineNumber(0.01)).toBe('0,01');
      expect(formatArgentineNumber(0.99)).toBe('0,99');
    });
  });
});
