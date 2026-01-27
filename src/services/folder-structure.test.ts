/**
 * Tests for folder structure service
 */

import { describe, it, expect } from 'vitest';
import { validateYear } from './folder-structure.js';

describe('validateYear', () => {
  it('returns ok for valid years in range 2000-current+1', () => {
    const currentYear = new Date().getFullYear();

    expect(validateYear('2000')).toEqual({ ok: true, value: 2000 });
    expect(validateYear('2024')).toEqual({ ok: true, value: 2024 });
    expect(validateYear('2025')).toEqual({ ok: true, value: 2025 });
    expect(validateYear(String(currentYear))).toEqual({ ok: true, value: currentYear });
    expect(validateYear(String(currentYear + 1))).toEqual({ ok: true, value: currentYear + 1 });
  });

  it('returns error for years before 2000', () => {
    const result = validateYear('1999');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('1999');
      expect(result.error.message).toContain('outside valid range');
    }
  });

  it('returns error for years more than 1 year in future', () => {
    const currentYear = new Date().getFullYear();
    const farFuture = currentYear + 2;
    const result = validateYear(String(farFuture));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(String(farFuture));
    }
  });

  it('returns error for NaN year', () => {
    const result = validateYear('NaN');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('invalid');
    }
  });

  it('returns error for non-numeric strings', () => {
    expect(validateYear('abc').ok).toBe(false);
    expect(validateYear('20-25').ok).toBe(false);
    expect(validateYear('').ok).toBe(false);
  });

  it('returns error for future years beyond next year (prevents 2029 from bug)', () => {
    // The bug caused dates like "11/13/29" to be parsed as 2029
    // Years more than 1 year in the future should be rejected
    const currentYear = new Date().getFullYear();
    const tooFarFuture = currentYear + 2;

    const result = validateYear(String(tooFarFuture));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('outside valid range');
    }
  });

  it('accepts historical years like 2020 for old documents', () => {
    // Years like 2020 are valid - they could be historical documents
    // The bug was caused by 2-digit year parsing, not by 2020 being invalid
    const result = validateYear('2020');
    expect(result.ok).toBe(true);
  });
});
