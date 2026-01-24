/**
 * Unit tests for Gemini parser module
 * Tests CUIT normalization, ADVA name matching, and CUIT assignment
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeCuit,
  isAdvaName,
  assignCuitsAndClassify,
  parseResumenBancarioResponse,
} from '../../../src/gemini/parser.js';

describe('normalizeCuit', () => {
  it('removes dashes from CUIT', () => {
    expect(normalizeCuit('30-70907678-3')).toBe('30709076783');
    expect(normalizeCuit('27-13078025-9')).toBe('27130780259');
  });

  it('removes spaces from CUIT', () => {
    expect(normalizeCuit('30 70907678 3')).toBe('30709076783');
  });

  it('removes slashes from CUIT', () => {
    expect(normalizeCuit('30/70907678/3')).toBe('30709076783');
  });

  it('handles mixed formatting', () => {
    expect(normalizeCuit('30-70907678/3')).toBe('30709076783');
    expect(normalizeCuit('30 70907678-3')).toBe('30709076783');
  });

  it('returns already clean CUITs unchanged', () => {
    expect(normalizeCuit('30709076783')).toBe('30709076783');
    expect(normalizeCuit('27130780259')).toBe('27130780259');
  });
});

describe('isAdvaName', () => {
  it('matches "ADVA" exactly', () => {
    expect(isAdvaName('ADVA')).toBe(true);
  });

  it('matches "ADVA" case insensitive', () => {
    expect(isAdvaName('adva')).toBe(true);
    expect(isAdvaName('Adva')).toBe(true);
  });

  it('matches full organization name', () => {
    expect(isAdvaName('ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS')).toBe(true);
  });

  it('matches abbreviated name with ASOC...DESARROLL pattern', () => {
    expect(isAdvaName('ASOC CIVIL DESARROLLADORES DE VIDEOJUEGOS')).toBe(true);
    expect(isAdvaName('ASOC. CIVIL DESARROLLADORES')).toBe(true);
  });

  it('matches names containing VIDEOJUEGO', () => {
    expect(isAdvaName('DESARROLLADORES DE VIDEOJUEGOS')).toBe(true);
    expect(isAdvaName('Asociacion Videojuegos Argentina')).toBe(true);
  });

  it('matches OCR errors in DESARROLLADORES', () => {
    // OCR might misread some characters
    expect(isAdvaName('ASOC CIVIL DESARROLLARODES')).toBe(true);
  });

  it('matches truncated names', () => {
    expect(isAdvaName('ASOC CIVIL DE DESARROLLADORES DE TUCUMAN')).toBe(true);
  });

  it('does not match unrelated company names', () => {
    expect(isAdvaName('MATARUCCO MARIA ANGELICA')).toBe(false);
    expect(isAdvaName('RABAGO NICOLAS')).toBe(false);
    expect(isAdvaName('ULRICH GONZALO')).toBe(false);
    expect(isAdvaName('EMPRESA SA')).toBe(false);
    expect(isAdvaName('LATITUD TRAVEL S.A.S')).toBe(false);
  });
});

describe('assignCuitsAndClassify', () => {
  const ADVA_CUIT = '30709076783';

  describe('factura_recibida (ADVA is client)', () => {
    it('assigns CUITs correctly when ADVA is client', () => {
      const result = assignCuitsAndClassify(
        'MATARUCCO MARIA ANGELICA',
        'ADVA',
        ['27130780259', ADVA_CUIT]
      );

      expect(result.documentType).toBe('factura_recibida');
      expect(result.cuitEmisor).toBe('27130780259');
      expect(result.razonSocialEmisor).toBe('MATARUCCO MARIA ANGELICA');
      expect(result.cuitReceptor).toBe(ADVA_CUIT);
      expect(result.razonSocialReceptor).toBe('ADVA');
    });

    it('works with full ADVA name as client', () => {
      const result = assignCuitsAndClassify(
        'RABAGO NICOLAS',
        'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS',
        ['20405354757', ADVA_CUIT]
      );

      expect(result.documentType).toBe('factura_recibida');
      expect(result.cuitEmisor).toBe('20405354757');
      expect(result.cuitReceptor).toBe(ADVA_CUIT);
    });
  });

  describe('factura_emitida (ADVA is issuer)', () => {
    it('assigns CUITs correctly when ADVA is issuer', () => {
      const result = assignCuitsAndClassify(
        'ADVA',
        'Diego Lezcano',
        [ADVA_CUIT, '20123456786']
      );

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe(ADVA_CUIT);
      expect(result.razonSocialEmisor).toBe('ADVA');
      expect(result.cuitReceptor).toBe('20123456786');
      expect(result.razonSocialReceptor).toBe('Diego Lezcano');
    });

    it('works with full ADVA name as issuer', () => {
      const result = assignCuitsAndClassify(
        'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS',
        'Whiteboard Games SRL',
        [ADVA_CUIT, '30712345678']
      );

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe(ADVA_CUIT);
      expect(result.cuitReceptor).toBe('30712345678');
    });
  });

  describe('edge cases', () => {
    it('handles Consumidor Final (only ADVA CUIT present)', () => {
      const result = assignCuitsAndClassify(
        'ADVA',
        'Diego Lezcano',
        [ADVA_CUIT] // Only ADVA's CUIT, client has no CUIT
      );

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe(ADVA_CUIT);
      expect(result.cuitReceptor).toBe(''); // Empty for Consumidor Final
    });

    it('handles foreign client IDs', () => {
      const result = assignCuitsAndClassify(
        'ADVA',
        'NGD Studios AB',
        [ADVA_CUIT, '55000004293'] // Swedish company ID
      );

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe(ADVA_CUIT);
      expect(result.cuitReceptor).toBe('55000004293');
    });

    it('defaults to factura_emitida when both match ADVA (internal document)', () => {
      // This is an edge case - both names somehow match ADVA pattern
      const result = assignCuitsAndClassify(
        'ADVA',
        'ASOCIACION VIDEOJUEGOS', // Also matches due to VIDEOJUEGO pattern
        [ADVA_CUIT, '30123456789']
      );

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe(ADVA_CUIT);
    });

    it('throws error when ADVA not found in either name', () => {
      expect(() => {
        assignCuitsAndClassify(
          'EMPRESA UNO SA',
          'EMPRESA DOS SA',
          ['30111111111', '30222222222']
        );
      }).toThrow('ADVA not found in either issuer name "EMPRESA UNO SA" or client name "EMPRESA DOS SA"');
    });
  });

  describe('CUIT order independence', () => {
    it('finds correct CUIT regardless of array order', () => {
      // ADVA's CUIT first
      const result1 = assignCuitsAndClassify(
        'RABAGO NICOLAS',
        'ADVA',
        [ADVA_CUIT, '20405354757']
      );

      // Other CUIT first
      const result2 = assignCuitsAndClassify(
        'RABAGO NICOLAS',
        'ADVA',
        ['20405354757', ADVA_CUIT]
      );

      expect(result1.cuitEmisor).toBe('20405354757');
      expect(result2.cuitEmisor).toBe('20405354757');
    });
  });
});

describe('parseResumenBancarioResponse', () => {
  describe('basic parsing', () => {
    it('parses complete bank account response', () => {
      const response = `\`\`\`json
{
  "banco": "BBVA",
  "numeroCuenta": "1234567890",
  "fechaDesde": "2024-01-01",
  "fechaHasta": "2024-01-31",
  "saldoInicial": 1000,
  "saldoFinal": 2000,
  "moneda": "ARS",
  "cantidadMovimientos": 25
}
\`\`\``;

      const result = parseResumenBancarioResponse(response);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.banco).toBe('BBVA');
        expect(result.value.data.numeroCuenta).toBe('1234567890');
        expect(result.value.data.moneda).toBe('ARS');
        expect(result.value.confidence).toBeGreaterThan(0.9);
      }
    });
  });
});
