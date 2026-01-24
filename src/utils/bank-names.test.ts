/**
 * Tests for bank name normalization
 */

import { describe, it, expect } from 'vitest';
import { normalizeBankName } from './bank-names.js';

describe('normalizeBankName', () => {
  describe('Banco Ciudad variations', () => {
    it('normalizes "BancoCiudad" to "Banco Ciudad"', () => {
      expect(normalizeBankName('BancoCiudad')).toBe('Banco Ciudad');
    });

    it('normalizes "Banco de la Ciudad" to "Banco Ciudad"', () => {
      expect(normalizeBankName('Banco de la Ciudad')).toBe('Banco Ciudad');
    });

    it('normalizes "Ciudad" to "Banco Ciudad"', () => {
      expect(normalizeBankName('Ciudad')).toBe('Banco Ciudad');
    });

    it('preserves "Banco Ciudad" as-is', () => {
      expect(normalizeBankName('Banco Ciudad')).toBe('Banco Ciudad');
    });
  });

  describe('Credicoop variations', () => {
    it('normalizes "Banco Credicoop" to "Credicoop"', () => {
      expect(normalizeBankName('Banco Credicoop')).toBe('Credicoop');
    });

    it('normalizes "Banco Credicoop Cooperativo Limitado" to "Credicoop"', () => {
      expect(normalizeBankName('Banco Credicoop Cooperativo Limitado')).toBe('Credicoop');
    });

    it('normalizes "Credicoop Cooperativo Limitado" to "Credicoop"', () => {
      expect(normalizeBankName('Credicoop Cooperativo Limitado')).toBe('Credicoop');
    });

    it('preserves "Credicoop" as-is', () => {
      expect(normalizeBankName('Credicoop')).toBe('Credicoop');
    });
  });

  describe('BBVA variations', () => {
    it('normalizes "BBVA Frances" to "BBVA"', () => {
      expect(normalizeBankName('BBVA Frances')).toBe('BBVA');
    });

    it('normalizes "BBVA Francés" to "BBVA"', () => {
      expect(normalizeBankName('BBVA Francés')).toBe('BBVA');
    });

    it('normalizes "Banco BBVA" to "BBVA"', () => {
      expect(normalizeBankName('Banco BBVA')).toBe('BBVA');
    });

    it('preserves "BBVA" as-is', () => {
      expect(normalizeBankName('BBVA')).toBe('BBVA');
    });
  });

  describe('Unknown banks', () => {
    it('returns unknown bank name as-is', () => {
      expect(normalizeBankName('Banco Galicia')).toBe('Banco Galicia');
    });

    it('returns another unknown bank name as-is', () => {
      expect(normalizeBankName('Santander Rio')).toBe('Santander Rio');
    });
  });

  describe('Edge cases', () => {
    it('handles empty string', () => {
      expect(normalizeBankName('')).toBe('');
    });

    it('handles whitespace', () => {
      expect(normalizeBankName('  ')).toBe('  ');
    });
  });
});
