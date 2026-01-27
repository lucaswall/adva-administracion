/**
 * Tests for spreadsheet utilities
 */

import { describe, it, expect } from 'vitest';
import { sanitizeForSpreadsheet } from './spreadsheet.js';

describe('sanitizeForSpreadsheet', () => {
  it('sanitizes strings starting with = (formulas)', () => {
    expect(sanitizeForSpreadsheet('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(sanitizeForSpreadsheet('=1+1')).toBe("'=1+1");
  });

  it('sanitizes strings starting with + (formulas)', () => {
    expect(sanitizeForSpreadsheet('+1234567890')).toBe("'+1234567890");
    expect(sanitizeForSpreadsheet('+A1')).toBe("'+A1");
  });

  it('sanitizes strings starting with - (formulas)', () => {
    expect(sanitizeForSpreadsheet('-123')).toBe("'-123");
    expect(sanitizeForSpreadsheet('-A1+B1')).toBe("'-A1+B1");
  });

  it('sanitizes strings starting with @ (formulas)', () => {
    expect(sanitizeForSpreadsheet('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeForSpreadsheet('@username')).toBe("'@username");
  });

  it('sanitizes strings with leading tab followed by formula chars', () => {
    expect(sanitizeForSpreadsheet('\t=1+1')).toBe("'\t=1+1");
    expect(sanitizeForSpreadsheet('\t+123')).toBe("'\t+123");
    expect(sanitizeForSpreadsheet('\t-456')).toBe("'\t-456");
    expect(sanitizeForSpreadsheet('\t@SUM')).toBe("'\t@SUM");
  });

  it('sanitizes strings with leading newline followed by formula chars', () => {
    expect(sanitizeForSpreadsheet('\n=1+1')).toBe("'\n=1+1");
    expect(sanitizeForSpreadsheet('\r+123')).toBe("'\r+123");
    expect(sanitizeForSpreadsheet('\r\n-456')).toBe("'\r\n-456");
  });

  it('sanitizes strings with leading whitespace followed by formula chars', () => {
    expect(sanitizeForSpreadsheet(' =1+1')).toBe("' =1+1");
    expect(sanitizeForSpreadsheet('  +123')).toBe("'  +123");
    expect(sanitizeForSpreadsheet('   -456')).toBe("'   -456");
  });

  it('preserves normal strings', () => {
    expect(sanitizeForSpreadsheet('Normal text')).toBe('Normal text');
    expect(sanitizeForSpreadsheet('EMPRESA SA')).toBe('EMPRESA SA');
    expect(sanitizeForSpreadsheet('30709076783')).toBe('30709076783');
    expect(sanitizeForSpreadsheet('Invoice #123')).toBe('Invoice #123');
  });

  it('preserves strings with formula chars not at start', () => {
    expect(sanitizeForSpreadsheet('A = B')).toBe('A = B');
    expect(sanitizeForSpreadsheet('Phone: +54 11 1234-5678')).toBe('Phone: +54 11 1234-5678');
    expect(sanitizeForSpreadsheet('Balance: -$500')).toBe('Balance: -$500');
    expect(sanitizeForSpreadsheet('Email user@domain.com')).toBe('Email user@domain.com');
  });

  it('handles empty strings', () => {
    expect(sanitizeForSpreadsheet('')).toBe('');
  });

  it('handles strings that are only formula chars', () => {
    expect(sanitizeForSpreadsheet('=')).toBe("'=");
    expect(sanitizeForSpreadsheet('+')).toBe("'+");
    expect(sanitizeForSpreadsheet('-')).toBe("'-");
    expect(sanitizeForSpreadsheet('@')).toBe("'@");
  });

  it('handles multiple leading whitespace with formula chars', () => {
    expect(sanitizeForSpreadsheet('   \t\n=DANGEROUS')).toBe("'   \t\n=DANGEROUS");
  });
});
