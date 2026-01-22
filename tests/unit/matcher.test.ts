/**
 * Unit tests for factura-pago matching logic
 * TDD: Write tests first, then implement matcher
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FacturaPagoMatcher, ReciboPagoMatcher } from '../../src/matching/matcher';
import type { Factura, Pago, Recibo } from '../../src/types/index';
import { clearExchangeRateCache, setExchangeRateCache } from '../../src/utils/exchange-rate';

describe('FacturaPagoMatcher.findMatches', () => {
  // Sample facturas for testing
  const facturas: Array<Factura & { row: number }> = [
    {
      row: 2,
      fileId: 'file1',
      fileName: 'factura1.pdf',
      tipoComprobante: 'A',
      nroFactura: '00001-00000001',
      fechaEmision: '2024-01-05',
      cuitEmisor: '20111111119',
      razonSocialEmisor: 'EMPRESA UNO SA',
      importeNeto: 1000,
      importeIva: 210,
      importeTotal: 1210,
      moneda: 'ARS',
      processedAt: '2024-01-05T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    },
    {
      row: 3,
      fileId: 'file2',
      fileName: 'factura2.pdf',
      tipoComprobante: 'B',
      nroFactura: '00002-00000002',
      fechaEmision: '2024-01-10',
      cuitEmisor: '20222222228',
      razonSocialEmisor: 'EMPRESA DOS SRL',
      importeNeto: 2000,
      importeIva: 420,
      importeTotal: 2420,
      moneda: 'ARS',
      processedAt: '2024-01-10T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    }
  ];

  const matcher = new FacturaPagoMatcher(10, 60);

  it('matches by exact amount and date within range', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07', // 2 days after factura1
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].factura.cuitEmisor).toBe('20111111119');
      expect(matches[0].facturaFileId).toBe('file1');
      expect(matches[0].confidence).toBe('MEDIUM');
    }
  });

  it('returns multiple matches if amount matches multiple invoices', () => {
    const duplicateFacturas: Array<Factura & { row: number }> = [
      { ...facturas[0], row: 2, fileId: 'file1' },
      { ...facturas[0], row: 3, fileId: 'file3', fechaEmision: '2024-01-06' }
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, duplicateFacturas);
    expect(matches.length).toBe(2);
  });

  it('boosts confidence to HIGH when CUIT matches', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      cuitPagador: '20111111119', // matches factura1 emisor
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
    }
  });

  it('returns empty array if no amount match', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 9999, // no matching amount
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(0);
  });

  it('excludes matches outside date range', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-05-10', // 125 days after factura1, outside extended +120 range
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2024-05-10T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(0);
  });

  it('includes matches at boundary (exactly 60 days after)', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-03-05', // exactly 60 days after factura1 (Jan 5 + 60 = Mar 5)
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2024-03-05T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
  });

  it('includes matches at boundary (exactly 10 days before)', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2023-12-26', // exactly 10 days before factura1 (Jan 5 - 10 = Dec 26)
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2023-12-26T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
  });

  it('returns empty array for invalid pago date', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: 'invalid-date',
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(0);
  });

  it('includes already matched facturas as upgrade candidates', () => {
    const matchedFacturas: Array<Factura & { row: number }> = [
      { ...facturas[0], matchedPagoFileId: 'pago5', matchConfidence: 'LOW' as const } // already matched with LOW confidence
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, matchedFacturas);
    expect(matches.length).toBe(1);
    expect(matches[0].isUpgrade).toBe(true);
    expect(matches[0].existingMatchConfidence).toBe('LOW');
    expect(matches[0].existingPagoFileId).toBe('pago5');
  });

  it('skips facturas with invalid dates', () => {
    const invalidDateFacturas: Array<Factura & { row: number }> = [
      { ...facturas[0], fechaEmision: 'invalid-date' }
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, invalidDateFacturas);
    expect(matches.length).toBe(0);
  });

  it('returns LOW confidence for dates in LOW range but outside MEDIUM range', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-02-20', // 46 days after factura1 (outside MEDIUM +30, but within LOW +60)
      importePagado: 1210,
      moneda: 'ARS',
      cuitPagador: '20111111119', // CUIT matches but date is outside MEDIUM range
      processedAt: '2024-02-20T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      // Even with CUIT match, stays LOW because date is outside MEDIUM range
      expect(matches[0].confidence).toBe('LOW');
      expect(matches[0].reasons).toContain('Date within low range: 2024-02-20');
    }
  });

  it('returns LOW confidence for dates in LOW range before MEDIUM range', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2023-12-28', // 8 days before factura1 (outside MEDIUM -3, but within LOW -10)
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2023-12-28T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('LOW');
    }
  });

  it('boosts confidence to HIGH with name match (no CUIT)', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      nombrePagador: 'EMPRESA UNO', // partial match with 'EMPRESA UNO SA'
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Payer name match');
    }
  });

  it('boosts confidence to HIGH with both CUIT and name match', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      cuitPagador: '20111111119',
      nombrePagador: 'EMPRESA UNO SA',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Payer CUIT/DNI match');
      expect(matches[0].reasons).toContain('Payer name match');
    }
  });

  it('does not match when names do not overlap', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      nombrePagador: 'COMPLETELY DIFFERENT COMPANY',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('MEDIUM');
      expect(matches[0].reasons).not.toContain('Payer name match');
    }
  });

  it('sorts matches by confidence (HIGH > MEDIUM > LOW)', () => {
    // Pago date: 2024-01-15
    // HIGH range: payment [0, 15] days after invoice
    // MEDIUM range: payment (-3, 30) days relative to invoice
    // LOW range: payment (-10, 60) days relative to invoice
    const multiFacturas: Array<Factura & { row: number }> = [
      { ...facturas[0], row: 2, fechaEmision: '2024-01-10' }, // pago 5 days after factura, within HIGH range but no CUIT → MEDIUM
      { ...facturas[0], row: 3, fechaEmision: '2024-01-12', cuitEmisor: '20333333337' }, // pago 3 days after factura, within HIGH range + CUIT match → HIGH
      { ...facturas[0], row: 4, fechaEmision: '2023-12-10' }  // pago 36 days after factura, outside MEDIUM (30), within LOW (60) → LOW
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-15',
      importePagado: 1210,
      moneda: 'ARS',
      cuitPagador: '20333333337',
      processedAt: '2024-01-15T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, multiFacturas);
    expect(matches.length).toBe(3);
    expect(matches[0].confidence).toBe('HIGH');
    expect(matches[0].facturaRow).toBe(3);
    expect(matches[1].confidence).toBe('MEDIUM');
    expect(matches[1].facturaRow).toBe(2);
    expect(matches[2].confidence).toBe('LOW');
    expect(matches[2].facturaRow).toBe(4);
  });

  it('handles empty facturas array', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, []);
    expect(matches.length).toBe(0);
  });

  it('handles pago with missing optional fields', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      // no cuitPagador, nombrePagador, referencia, concepto
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('MEDIUM');
      expect(matches[0].reasons).not.toContain('Payer CUIT/DNI match');
      expect(matches[0].reasons).not.toContain('Payer name match');
    }
  });

  it('handles case-insensitive name matching', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      nombrePagador: 'empresa uno sa', // lowercase version
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Payer name match');
    }
  });

  it('matches when factura name contains pago name', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      nombrePagador: 'EMPRESA UNO', // factura has 'EMPRESA UNO SA'
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Payer name match');
    }
  });

  it('matches when pago name contains factura name', () => {
    const shortNameFactura: Array<Factura & { row: number }> = [
      { ...facturas[0], razonSocialEmisor: 'ACME' }
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      nombrePagador: 'ACME CORPORATION SA', // pago name contains 'ACME'
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, shortNameFactura);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Payer name match');
    }
  });

  it('prioritizes beneficiary CUIT over payer CUIT for matching', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      cuitPagador: '20999999999', // Different CUIT (wrong)
      cuitBeneficiario: '20111111119', // Matches factura1 emisor (correct)
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Beneficiary CUIT/DNI match');
      expect(matches[0].reasons).not.toContain('Payer CUIT/DNI match');
    }
  });

  it('falls back to payer CUIT when beneficiary CUIT is not available', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      cuitPagador: '20111111119', // Matches factura1 emisor
      // No cuitBeneficiario
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Payer CUIT/DNI match');
    }
  });

  it('prioritizes beneficiary name over payer name for matching', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      nombrePagador: 'WRONG COMPANY', // Does not match
      nombreBeneficiario: 'EMPRESA UNO SA', // Matches factura1 emisor
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Beneficiary name match');
      expect(matches[0].reasons).not.toContain('Payer name match');
    }
  });

  it('falls back to payer name when beneficiary name is not available', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      nombrePagador: 'EMPRESA UNO SA', // Matches factura1 emisor
      // No nombreBeneficiario
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Payer name match');
    }
  });

  it('matches when beneficiary has DNI (8 digits) and factura has full CUIT (11 digits)', () => {
    // Real-world scenario: payment shows only DNI, invoice has full CUIT
    // CUIT: 20-40535475-7 contains DNI: 40535475
    const facturaWithFullCuit: Array<Factura & { row: number }> = [
      {
        ...facturas[0],
        cuitEmisor: '20405354757', // Full 11-digit CUIT
        razonSocialEmisor: 'RABAGO NICOLAS'
      }
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      cuitBeneficiario: '40535475', // 8-digit DNI (not full CUIT)
      nombreBeneficiario: 'RABAGO NICOLAS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturaWithFullCuit);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].hasCuitMatch).toBe(true);
      expect(matches[0].reasons).toContain('Beneficiary CUIT/DNI match');
    }
  });

  it('matches with beneficiary fields and ignores conflicting payer fields', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 1210,
      moneda: 'ARS',
      cuitPagador: '20999999999', // Wrong CUIT
      nombrePagador: 'WRONG COMPANY', // Wrong name
      cuitBeneficiario: '20111111119', // Correct CUIT
      nombreBeneficiario: 'EMPRESA UNO', // Correct name (partial)
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, facturas);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Beneficiary CUIT/DNI match');
      expect(matches[0].reasons).toContain('Beneficiary name match');
      expect(matches[0].reasons).not.toContain('Payer CUIT/DNI match');
      expect(matches[0].reasons).not.toContain('Payer name match');
    }
  });
});

describe('FacturaPagoMatcher cross-currency matching (USD→ARS)', () => {
  const matcher = new FacturaPagoMatcher(10, 60);

  beforeEach(() => {
    clearExchangeRateCache();
  });

  // USD Factura for testing
  const usdFactura: Factura & { row: number } = {
    row: 2,
    fileId: 'usd-file1',
    fileName: 'factura-usd.pdf',
    tipoComprobante: 'A',
    nroFactura: '00001-00000001',
    fechaEmision: '2024-01-15',
    cuitEmisor: '20111111119',
    razonSocialEmisor: 'EMPRESA USD SA',
    importeNeto: 82.64,
    importeIva: 17.36,
    importeTotal: 100, // USD $100
    moneda: 'USD',
    processedAt: '2024-01-15T10:00:00Z',
    confidence: 1.0,
    needsReview: false
  };

  it('matches USD factura with ARS pago using exchange rate', () => {
    setExchangeRateCache('2024-01-15', {
      fecha: '2024-01-15',
      compra: 815.50,
      venta: 855.50,
    });

    // USD $100 → Expected ARS: 85,550
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-17', // 2 days after factura
      importePagado: 85550, // Exact converted amount
      moneda: 'ARS',
      processedAt: '2024-01-17T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, [usdFactura]);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].reasons).toContain('Cross-currency match (USD→ARS)');
      expect(matches[0].reasons.some(r => r.includes('rate: 855.5'))).toBe(true);
    }
  });

  it('matches USD factura within tolerance (5%)', () => {
    setExchangeRateCache('2024-01-15', {
      fecha: '2024-01-15',
      compra: 815.50,
      venta: 855.50,
    });

    // USD $100 → Expected ARS: 85,550
    // With 5% tolerance: 81,272.50 - 89,827.50
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-17',
      importePagado: 82000, // Within lower tolerance
      moneda: 'ARS',
      processedAt: '2024-01-17T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, [usdFactura]);
    expect(matches.length).toBe(1);
  });

  it('does not match USD factura outside tolerance', () => {
    setExchangeRateCache('2024-01-15', {
      fecha: '2024-01-15',
      compra: 815.50,
      venta: 855.50,
    });

    // USD $100 → Expected ARS: 85,550
    // Outside 5% tolerance
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-17',
      importePagado: 70000, // Way below tolerance
      moneda: 'ARS',
      processedAt: '2024-01-17T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, [usdFactura]);
    expect(matches.length).toBe(0);
  });

  it('caps confidence at MEDIUM for cross-currency match with CUIT', () => {
    setExchangeRateCache('2024-01-15', {
      fecha: '2024-01-15',
      compra: 815.50,
      venta: 855.50,
    });

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-17',
      importePagado: 85550,
      moneda: 'ARS',
      cuitBeneficiario: '20111111119', // CUIT matches
      processedAt: '2024-01-17T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, [usdFactura]);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      // Cross-currency caps at MEDIUM even with CUIT match
      expect(matches[0].confidence).toBe('MEDIUM');
      expect(matches[0].hasCuitMatch).toBe(true);
    }
  });

  it('returns LOW confidence for cross-currency match without CUIT', () => {
    setExchangeRateCache('2024-01-15', {
      fecha: '2024-01-15',
      compra: 815.50,
      venta: 855.50,
    });

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-17',
      importePagado: 85550,
      moneda: 'ARS',
      // No CUIT
      processedAt: '2024-01-17T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, [usdFactura]);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      // Cross-currency without CUIT is LOW
      expect(matches[0].confidence).toBe('LOW');
    }
  });

  it('does not match when exchange rate is not in cache', () => {
    // When no exchange rate is cached, cross-currency matching should fail
    // clearExchangeRateCache() is called in beforeEach, so no rate is available

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-17',
      importePagado: 85550,
      moneda: 'ARS',
      processedAt: '2024-01-17T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, [usdFactura]);
    expect(matches.length).toBe(0);
  });

  it('still uses exact match for ARS facturas (no cross-currency)', () => {
    // No HTTP mocks needed for ARS matching
    const arsFactura: Factura & { row: number } = {
      ...usdFactura,
      moneda: 'ARS',
      importeTotal: 85550
    };

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-17',
      importePagado: 85550, // Exact match
      moneda: 'ARS',
      processedAt: '2024-01-17T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, [arsFactura]);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      // No cross-currency reason
      expect(matches[0].reasons.some(r => r.includes('Cross-currency'))).toBe(false);
      // Standard MEDIUM confidence (no CUIT)
      expect(matches[0].confidence).toBe('MEDIUM');
    }
  });
});

describe('ReciboPagoMatcher.findMatches', () => {
  // Sample recibos for testing
  const recibos: Array<Recibo & { row: number }> = [
    {
      row: 2,
      fileId: 'recibo1',
      fileName: 'recibo1.pdf',
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Pérez',
      cuilEmpleado: '20123456789',
      legajo: '001',
      cuitEmpleador: '30709076783',
      periodoAbonado: 'enero/2024',
      fechaPago: '2024-01-05',
      subtotalRemuneraciones: 200000,
      subtotalDescuentos: 50000,
      totalNeto: 150000,
      processedAt: '2024-01-05T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    },
    {
      row: 3,
      fileId: 'recibo2',
      fileName: 'recibo2.pdf',
      tipoRecibo: 'liquidacion_final',
      nombreEmpleado: 'María García',
      cuilEmpleado: '27987654321',
      legajo: '002',
      tareaDesempenada: 'Contador',
      cuitEmpleador: '30709076783',
      periodoAbonado: 'febrero/2024',
      fechaPago: '2024-02-10',
      subtotalRemuneraciones: 300000,
      subtotalDescuentos: 75000,
      totalNeto: 225000,
      processedAt: '2024-02-10T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    }
  ];

  const matcher = new ReciboPagoMatcher(10, 60);

  it('matches by exact amount and date within range', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07', // 2 days after recibo1
      importePagado: 150000,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].recibo.cuilEmpleado).toBe('20123456789');
      expect(matches[0].reciboFileId).toBe('recibo1');
      expect(matches[0].confidence).toBe('MEDIUM');
    }
  });

  it('boosts confidence to HIGH when CUIL matches beneficiary', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      cuitBeneficiario: '20123456789', // matches recibo1 employee CUIL
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Beneficiary CUIL/DNI matches employee');
    }
  });

  it('boosts confidence to HIGH when employee name matches beneficiary name', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      nombreBeneficiario: 'juan perez', // matches recibo1 employee name (case insensitive)
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Beneficiary name matches employee');
    }
  });

  it('returns empty array if no amount match', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 999999, // no matching amount
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(0);
  });

  it('excludes matches outside date range', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-05-10', // 125 days after recibo1, outside +60 range
      importePagado: 150000,
      moneda: 'ARS',
      processedAt: '2024-05-10T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(0);
  });

  it('includes already matched recibos as upgrade candidates', () => {
    const matchedRecibos: Array<Recibo & { row: number }> = [
      { ...recibos[0], matchedPagoFileId: 'pago5', matchConfidence: 'LOW' as const }
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, matchedRecibos);
    expect(matches.length).toBe(1);
    expect(matches[0].isUpgrade).toBe(true);
    expect(matches[0].existingMatchConfidence).toBe('LOW');
    expect(matches[0].existingPagoFileId).toBe('pago5');
  });

  it('returns LOW confidence for dates in LOW range but outside MEDIUM range', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-02-20', // 46 days after recibo1, outside MEDIUM +30, within LOW +60
      importePagado: 150000,
      moneda: 'ARS',
      cuitBeneficiario: '20123456789', // CUIL matches but date is outside MEDIUM range
      processedAt: '2024-02-20T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      // Even with CUIL match, stays LOW because date is outside MEDIUM range
      expect(matches[0].confidence).toBe('LOW');
      expect(matches[0].reasons).toContain('Date within low range: 2024-02-20');
    }
  });

  it('handles case-insensitive name matching with partial match', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      nombreBeneficiario: 'PEREZ', // partial match with 'Juan Pérez'
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Beneficiary name matches employee');
    }
  });

  it('returns multiple matches if amount matches multiple recibos', () => {
    const duplicateRecibos: Array<Recibo & { row: number }> = [
      { ...recibos[0], row: 2, fileId: 'recibo1' },
      { ...recibos[0], row: 3, fileId: 'recibo3', fechaPago: '2024-01-06' }
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, duplicateRecibos);
    expect(matches.length).toBe(2);
  });

  it('sorts matches by confidence (HIGH > MEDIUM > LOW)', () => {
    const multiRecibos: Array<Recibo & { row: number }> = [
      { ...recibos[0], row: 2, fechaPago: '2024-01-10' }, // pago 5 days after, within HIGH range but no CUIL → MEDIUM
      { ...recibos[0], row: 3, fechaPago: '2024-01-12', cuilEmpleado: '20333333337' }, // pago 3 days after + CUIL match → HIGH
      { ...recibos[0], row: 4, fechaPago: '2023-12-10' }  // pago 36 days after, outside MEDIUM, within LOW → LOW
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-15',
      importePagado: 150000,
      moneda: 'ARS',
      cuitBeneficiario: '20333333337',
      processedAt: '2024-01-15T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, multiRecibos);
    expect(matches.length).toBe(3);
    expect(matches[0].confidence).toBe('HIGH');
    expect(matches[0].reciboRow).toBe(3);
    expect(matches[1].confidence).toBe('MEDIUM');
    expect(matches[1].reciboRow).toBe(2);
    expect(matches[2].confidence).toBe('LOW');
    expect(matches[2].reciboRow).toBe(4);
  });

  it('handles empty recibos array', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, []);
    expect(matches.length).toBe(0);
  });

  it('handles pago with missing optional fields', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      // no cuitBeneficiario, nombreBeneficiario
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('MEDIUM');
      expect(matches[0].reasons).not.toContain('Beneficiary CUIL/DNI matches employee');
      expect(matches[0].reasons).not.toContain('Beneficiary name matches employee');
    }
  });

  it('returns empty array for invalid pago date', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: 'invalid-date',
      importePagado: 150000,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(0);
  });

  it('skips recibos with invalid dates', () => {
    const invalidDateRecibos: Array<Recibo & { row: number }> = [
      { ...recibos[0], fechaPago: 'invalid-date' }
    ];

    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, invalidDateRecibos);
    expect(matches.length).toBe(0);
  });

  it('matches with both CUIL and name', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      cuitBeneficiario: '20123456789',
      nombreBeneficiario: 'Juan Pérez',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('HIGH');
      expect(matches[0].reasons).toContain('Beneficiary CUIL/DNI matches employee');
      expect(matches[0].reasons).toContain('Beneficiary name matches employee');
    }
  });

  it('does not match when names do not overlap', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      nombreBeneficiario: 'COMPLETELY DIFFERENT PERSON',
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      expect(matches[0].confidence).toBe('MEDIUM');
      expect(matches[0].reasons).not.toContain('Beneficiary name matches employee');
    }
  });

  it('does not check payer fields for recibo matching (only beneficiary)', () => {
    const pago: Pago = {
      fileId: 'pago1',
      fileName: 'pago1.pdf',
      banco: 'BBVA',
      fechaPago: '2024-01-07',
      importePagado: 150000,
      moneda: 'ARS',
      cuitPagador: '20123456789', // Employee CUIL in payer field (wrong)
      nombrePagador: 'Juan Pérez', // Employee name in payer field (wrong)
      // No beneficiary fields
      processedAt: '2024-01-07T10:00:00Z',
      confidence: 1.0,
      needsReview: false
    };

    const matches = matcher.findMatches(pago, recibos);
    expect(matches.length).toBe(1);
    if (matches.length > 0) {
      // Should be MEDIUM because beneficiary fields are not present
      expect(matches[0].confidence).toBe('MEDIUM');
      expect(matches[0].reasons).not.toContain('Beneficiary CUIL/DNI matches employee');
      expect(matches[0].reasons).not.toContain('Beneficiary name matches employee');
    }
  });
});
