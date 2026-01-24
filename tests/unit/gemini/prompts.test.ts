/**
 * Unit tests for Gemini prompts module
 * Tests validate prompt constants and helper functions
 */

import { describe, it, expect } from 'vitest';
import {
  CLASSIFICATION_PROMPT,
  FACTURA_PROMPT,
  PAGO_BBVA_PROMPT,
  getResumenBancarioPrompt,
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

  it('mentions required field: issuerName', () => {
    expect(FACTURA_PROMPT).toContain('issuerName');
  });

  it('mentions required field: clientName', () => {
    expect(FACTURA_PROMPT).toContain('clientName');
  });

  it('mentions required field: allCuits', () => {
    expect(FACTURA_PROMPT).toContain('allCuits');
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
    // Check for removal of formatting characters
    expect(FACTURA_PROMPT.toLowerCase()).toContain('no dashes');
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

describe('getResumenBancarioPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toBeDefined();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('mentions bank statement terminology', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('bank account statement');
    expect(prompt).toContain('Resumen');
    expect(prompt).toContain('Extracto');
  });

  it('requests JSON format output', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('JSON');
  });

  it('specifies date format as YYYY-MM-DD', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('YYYY-MM-DD');
  });

  describe('three-tier year extraction approach', () => {
    it('mentions TIER 1 for clear labels', () => {
      const prompt = getResumenBancarioPrompt();
      expect(prompt).toContain('TIER 1');
      expect(prompt).toContain('CLEAR LABELS');
    });

    it('mentions TIER 2 for transaction dates', () => {
      const prompt = getResumenBancarioPrompt();
      expect(prompt).toContain('TIER 2');
      expect(prompt).toContain('TRANSACTION DATES');
    });

    it('mentions TIER 3 for dynamic inference', () => {
      const prompt = getResumenBancarioPrompt();
      expect(prompt).toContain('TIER 3');
      expect(prompt).toContain('DYNAMIC INFERENCE');
    });

    it('explains month comparison rule in TIER 3', () => {
      const prompt = getResumenBancarioPrompt();
      expect(prompt).toContain('document month > current month');
      expect(prompt).toContain('previous year');
      expect(prompt).toContain('current year');
    });

    it('injects dynamic current date', () => {
      const jan2025Prompt = getResumenBancarioPrompt(new Date('2025-01-15'));
      const dec2024Prompt = getResumenBancarioPrompt(new Date('2024-12-20'));

      expect(jan2025Prompt).toMatch(/Current date: January 2025/);
      expect(dec2024Prompt).toMatch(/Current date: December 2024/);
    });
  });

  it('mentions alternative balance terminology', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('Saldo Inicial');
    expect(prompt).toContain('Saldo Final');
    expect(prompt).toContain('Saldo Anterior');
    expect(prompt).toContain('Saldo al');
  });

  it('handles SIN MOVIMIENTOS case', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('SIN MOVIMIENTOS');
  });

  it('mentions USD currency detection', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('USD');
    expect(prompt).toContain('u$s');
  });
});
