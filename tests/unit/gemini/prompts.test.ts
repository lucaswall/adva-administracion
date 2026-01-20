/**
 * Unit tests for Gemini prompts module
 * Tests validate prompt constants and helper functions
 */

import { describe, it, expect } from 'vitest';
import {
  CLASSIFICATION_PROMPT,
  FACTURA_PROMPT,
  PAGO_BBVA_PROMPT,
  RESUMEN_BANCARIO_PROMPT,
  RECIBO_PROMPT
} from '../../../src/gemini/prompts';

describe('CLASSIFICATION_PROMPT', () => {
  it('exists and is a non-empty string', () => {
    expect(CLASSIFICATION_PROMPT).toBeDefined();
    expect(typeof CLASSIFICATION_PROMPT).toBe('string');
    expect(CLASSIFICATION_PROMPT.length).toBeGreaterThan(0);
  });

  it('mentions all three document types', () => {
    expect(CLASSIFICATION_PROMPT).toContain('factura');
    expect(CLASSIFICATION_PROMPT).toContain('pago');
    expect(CLASSIFICATION_PROMPT).toContain('unrecognized');
  });

  it('mentions ARCA as factura indicator', () => {
    expect(CLASSIFICATION_PROMPT).toContain('ARCA');
  });

  it('mentions CAE as factura indicator', () => {
    expect(CLASSIFICATION_PROMPT).toContain('CAE');
  });

  it('mentions CUIT as factura indicator', () => {
    expect(CLASSIFICATION_PROMPT).toContain('CUIT');
  });

  it('mentions bank names as pago indicators', () => {
    expect(CLASSIFICATION_PROMPT).toContain('BBVA');
    expect(CLASSIFICATION_PROMPT).toContain('Santander');
    expect(CLASSIFICATION_PROMPT).toContain('Galicia');
  });

  it('mentions transferencia as pago indicator', () => {
    expect(CLASSIFICATION_PROMPT).toContain('Transferencia');
  });

  it('requests JSON format output', () => {
    expect(CLASSIFICATION_PROMPT).toContain('JSON');
  });

  it('specifies documentType field', () => {
    expect(CLASSIFICATION_PROMPT).toContain('documentType');
  });

  it('specifies confidence field', () => {
    expect(CLASSIFICATION_PROMPT).toContain('confidence');
  });

  it('specifies reason field', () => {
    expect(CLASSIFICATION_PROMPT).toContain('reason');
  });

  it('specifies indicators field', () => {
    expect(CLASSIFICATION_PROMPT).toContain('indicators');
  });

  it('instructs to return ONLY JSON', () => {
    expect(CLASSIFICATION_PROMPT.toLowerCase()).toContain('only');
    expect(CLASSIFICATION_PROMPT).toContain('no additional text');
  });
});

describe('FACTURA_PROMPT', () => {
  it('exists and is a non-empty string', () => {
    expect(FACTURA_PROMPT).toBeDefined();
    expect(typeof FACTURA_PROMPT).toBe('string');
    expect(FACTURA_PROMPT.length).toBeGreaterThan(0);
  });

  it('mentions it is for ARCA invoices', () => {
    expect(FACTURA_PROMPT).toContain('ARCA');
    expect(FACTURA_PROMPT.toLowerCase()).toContain('invoice');
  });

  it('requests JSON format output', () => {
    expect(FACTURA_PROMPT).toContain('JSON');
  });

  it('mentions required field: tipoComprobante', () => {
    expect(FACTURA_PROMPT).toContain('tipoComprobante');
  });

  it('mentions required field: nroFactura', () => {
    expect(FACTURA_PROMPT).toContain('nroFactura');
  });

  it('mentions required field: fechaEmision', () => {
    expect(FACTURA_PROMPT).toContain('fechaEmision');
  });

  it('mentions required field: cuitEmisor', () => {
    expect(FACTURA_PROMPT).toContain('cuitEmisor');
  });

  it('mentions required field: razonSocialEmisor', () => {
    expect(FACTURA_PROMPT).toContain('razonSocialEmisor');
  });



  it('mentions required field: importeNeto', () => {
    expect(FACTURA_PROMPT).toContain('importeNeto');
  });

  it('mentions required field: importeIva', () => {
    expect(FACTURA_PROMPT).toContain('importeIva');
  });

  it('mentions required field: importeTotal', () => {
    expect(FACTURA_PROMPT).toContain('importeTotal');
  });

  it('mentions required field: moneda', () => {
    expect(FACTURA_PROMPT).toContain('moneda');
  });

  it('mentions optional field: cuitReceptor', () => {
    expect(FACTURA_PROMPT).toContain('cuitReceptor');
  });

  it('mentions optional field: concepto', () => {
    expect(FACTURA_PROMPT).toContain('concepto');
  });

  it('warns against using tax category labels as concepto', () => {
    expect(FACTURA_PROMPT).toContain('EXENTO');
    expect(FACTURA_PROMPT).toContain('GRAVADO');
    expect(FACTURA_PROMPT).toContain('NO GRAVADO');
    expect(FACTURA_PROMPT.toLowerCase()).toContain('tax');
  });

  it('specifies CUIT should be 11 digits without dashes', () => {
    expect(FACTURA_PROMPT).toContain('11 digits');
    expect(FACTURA_PROMPT).toContain('no dashes');
  });


  it('specifies date format as YYYY-MM-DD', () => {
    expect(FACTURA_PROMPT).toContain('YYYY-MM-DD');
  });

  it('mentions currency options ARS and USD', () => {
    expect(FACTURA_PROMPT).toContain('ARS');
    expect(FACTURA_PROMPT).toContain('USD');
  });

  it('instructs to return ONLY JSON', () => {
    expect(FACTURA_PROMPT).toContain('ONLY');
    expect(FACTURA_PROMPT).toContain('no additional text');
  });

  it('instructs to omit missing fields', () => {
    expect(FACTURA_PROMPT).toContain('omit');
  });

  it('mentions invoice type codes', () => {
    expect(FACTURA_PROMPT).toMatch(/\bA\b/);
    expect(FACTURA_PROMPT).toMatch(/\bB\b/);
    expect(FACTURA_PROMPT).toMatch(/\bC\b/);
    expect(FACTURA_PROMPT).toMatch(/\bE\b/);
  });

  it('mentions nota de credito and nota de debito types', () => {
    expect(FACTURA_PROMPT).toContain('NC');
    expect(FACTURA_PROMPT).toContain('ND');
  });
});

describe('PAGO_BBVA_PROMPT', () => {
  it('exists and is a non-empty string', () => {
    expect(PAGO_BBVA_PROMPT).toBeDefined();
    expect(typeof PAGO_BBVA_PROMPT).toBe('string');
    expect(PAGO_BBVA_PROMPT.length).toBeGreaterThan(0);
  });

  it('mentions it is for BBVA bank payment slips', () => {
    expect(PAGO_BBVA_PROMPT).toContain('BBVA');
    expect(PAGO_BBVA_PROMPT.toLowerCase()).toContain('payment');
  });

  it('requests JSON format output', () => {
    expect(PAGO_BBVA_PROMPT).toContain('JSON');
  });

  it('mentions required field: banco', () => {
    expect(PAGO_BBVA_PROMPT).toContain('banco');
  });

  it('mentions required field: fechaPago', () => {
    expect(PAGO_BBVA_PROMPT).toContain('fechaPago');
  });

  it('mentions required field: importePagado', () => {
    expect(PAGO_BBVA_PROMPT).toContain('importePagado');
  });

  it('mentions optional field: referencia', () => {
    expect(PAGO_BBVA_PROMPT).toContain('referencia');
  });

  it('mentions optional field: cuitPagador', () => {
    expect(PAGO_BBVA_PROMPT).toContain('cuitPagador');
  });

  it('mentions optional field: nombrePagador', () => {
    expect(PAGO_BBVA_PROMPT).toContain('nombrePagador');
  });

  it('mentions optional field: concepto', () => {
    expect(PAGO_BBVA_PROMPT).toContain('concepto');
  });

  it('specifies CUIT/DNI format requirements', () => {
    // Prompt now accepts both full CUITs (11 digits) and DNIs (7-8 digits)
    expect(PAGO_BBVA_PROMPT).toContain('11 digits');
    expect(PAGO_BBVA_PROMPT).toContain('7-8 digits');
    expect(PAGO_BBVA_PROMPT).toContain('DNI');
  });

  it('specifies date format as YYYY-MM-DD', () => {
    expect(PAGO_BBVA_PROMPT).toContain('YYYY-MM-DD');
  });

  it('instructs to return ONLY JSON', () => {
    expect(PAGO_BBVA_PROMPT).toContain('ONLY');
    expect(PAGO_BBVA_PROMPT).toContain('no additional text');
  });

  it('instructs to omit missing fields', () => {
    expect(PAGO_BBVA_PROMPT).toContain('omit');
  });

  it('specifies banco should be BBVA', () => {
    expect(PAGO_BBVA_PROMPT).toMatch(/"BBVA"/);
  });

  it('instructs importePagado should be a number', () => {
    expect(PAGO_BBVA_PROMPT).toContain('number');
  });
});

describe('RESUMEN_BANCARIO_PROMPT', () => {
  it('exists and is a non-empty string', () => {
    expect(RESUMEN_BANCARIO_PROMPT).toBeDefined();
    expect(typeof RESUMEN_BANCARIO_PROMPT).toBe('string');
    expect(RESUMEN_BANCARIO_PROMPT.length).toBeGreaterThan(0);
  });

  it('mentions bank statement terminology', () => {
    expect(RESUMEN_BANCARIO_PROMPT).toContain('bank statement');
    expect(RESUMEN_BANCARIO_PROMPT).toContain('Resumen');
    expect(RESUMEN_BANCARIO_PROMPT).toContain('Extracto');
  });

  it('requests JSON format output', () => {
    expect(RESUMEN_BANCARIO_PROMPT).toContain('JSON');
  });

  it('specifies date format as YYYY-MM-DD', () => {
    expect(RESUMEN_BANCARIO_PROMPT).toContain('YYYY-MM-DD');
  });

  describe('year inference logic', () => {
    it('instructs to use LAST YEAR when month number is GREATER THAN current month', () => {
      // When processing in January 2026, months like February-December should use 2025
      expect(RESUMEN_BANCARIO_PROMPT).toContain('GREATER THAN the current month number');
      expect(RESUMEN_BANCARIO_PROMPT).toContain('LAST YEAR');
    });

    it('provides correct example for month number > current month (December in January)', () => {
      // December (month 12) > January (month 1) numerically
      // So it should use LAST YEAR to avoid future dates
      expect(RESUMEN_BANCARIO_PROMPT).toContain('30 DE DICIEMBRE');
      expect(RESUMEN_BANCARIO_PROMPT).toContain('2025-12-30');
      // Should show the numerical comparison
      expect(RESUMEN_BANCARIO_PROMPT).toContain('month 12');
      expect(RESUMEN_BANCARIO_PROMPT).toContain('month 1');
    });

    it('provides correct example for month equal to current month (January in January)', () => {
      // January equals current month, should use THIS YEAR
      expect(RESUMEN_BANCARIO_PROMPT).toContain('20 DE ENERO');
      expect(RESUMEN_BANCARIO_PROMPT).toContain('2026-01-20');
    });

    it('does NOT provide contradictory February example', () => {
      // February is AFTER current month (January), so it should use LAST YEAR (2025)
      // If the prompt shows "2026-02-15", that's a contradiction
      const hasFebruaryExample = RESUMEN_BANCARIO_PROMPT.includes('15 DE FEBRERO');

      if (hasFebruaryExample) {
        // If February example exists, it must use 2025, not 2026
        expect(RESUMEN_BANCARIO_PROMPT).not.toContain('2026-02-15');
        expect(RESUMEN_BANCARIO_PROMPT).toContain('2025-02-15');
      }
    });

    it('explains the rule clearly with numerical comparison', () => {
      // The rule should use clear numerical comparison
      expect(RESUMEN_BANCARIO_PROMPT).toContain('current month number');

      // Should not have confusing "BEFORE/AFTER" language for chronological ordering
      const hasConfusingLanguage = RESUMEN_BANCARIO_PROMPT.includes('December is BEFORE current month');
      expect(hasConfusingLanguage).toBe(false);
    });
  });

  it('mentions alternative balance terminology', () => {
    expect(RESUMEN_BANCARIO_PROMPT).toContain('Saldo Inicial');
    expect(RESUMEN_BANCARIO_PROMPT).toContain('Saldo Final');
    expect(RESUMEN_BANCARIO_PROMPT).toContain('Saldo Anterior');
    expect(RESUMEN_BANCARIO_PROMPT).toContain('Saldo al');
  });

  it('handles SIN MOVIMIENTOS case', () => {
    expect(RESUMEN_BANCARIO_PROMPT).toContain('SIN MOVIMIENTOS');
  });

  it('mentions USD currency detection', () => {
    expect(RESUMEN_BANCARIO_PROMPT).toContain('USD');
    expect(RESUMEN_BANCARIO_PROMPT).toContain('u$s');
  });
});
