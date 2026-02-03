/**
 * Unit tests for bank movement matcher
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BankMovementMatcher, calculateKeywordMatchScore, stripBankOriginPrefix, isBankFee, isCreditCardPayment, extractKeywordTokens } from './matcher.js';
import type { BankMovement, Factura, Pago, Retencion } from '../types/index.js';
import { setExchangeRateCache, type ExchangeRate } from '../utils/exchange-rate.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { warn } from '../utils/logger.js';

describe('BankMovementMatcher - Cross-Currency Confidence', () => {
  let matcher: BankMovementMatcher;

  beforeEach(() => {
    matcher = new BankMovementMatcher(5); // 5% tolerance

    // Set up exchange rate for testing
    const testRate: ExchangeRate = {
      fecha: '2024-01-15',
      compra: 800,
      venta: 850
    };
    setExchangeRateCache('2024-01-15', testRate);
  });

  describe('Cross-currency matches (USD facturas)', () => {
    it('caps confidence to MEDIUM for USD factura with CUIT match', () => {
      // USD factura: 100 USD = 85000 ARS at venta rate 850
      const usdFactura: Factura & { row: number } = {
        fileId: 'file1',
        fileName: 'factura-usd.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cuitReceptor: '30709076783', // ADVA
        razonSocialReceptor: 'ADVA',
        importeNeto: 90.91,
        importeIva: 9.09,
        importeTotal: 100,
        moneda: 'USD', // Cross-currency
        processedAt: '2024-01-15T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'PAGO FACTURA TEST SA 20-12345678-6',
        codigo: '001',
        oficina: '001',
        areaAdva: 'General',
        debito: 85000, // Payment in ARS
        credito: null,
        detalle: ''
      };

      const result = matcher.matchMovement(movement, [usdFactura], [], []);

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('MEDIUM'); // Capped to MEDIUM despite CUIT match
      expect(result.reasons).toContain('Cross-currency match (USD→ARS)');
    });

    it('caps confidence to LOW for USD factura without CUIT match', () => {
      // USD factura without CUIT in concepto
      const usdFactura: Factura & { row: number } = {
        fileId: 'file1',
        fileName: 'factura-usd.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cuitReceptor: '30709076783',
        razonSocialReceptor: 'ADVA',
        importeNeto: 90.91,
        importeIva: 9.09,
        importeTotal: 100,
        moneda: 'USD',
        processedAt: '2024-01-15T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'DEBITO AUTOMATICO TEST SA', // Keyword match, no CUIT
        codigo: '001',
        oficina: '001',
        areaAdva: 'General',
        debito: 85000,
        credito: null,
        detalle: ''
      };

      const result = matcher.matchMovement(movement, [usdFactura], [], []);

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('LOW'); // Capped to LOW (keyword + cross-currency)
      expect(result.reasons).toContain('Cross-currency match (USD→ARS)');
    });

    it('keeps HIGH confidence for ARS factura with CUIT match', () => {
      // ARS factura (not cross-currency)
      const arsFactura: Factura & { row: number } = {
        fileId: 'file1',
        fileName: 'factura-ars.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cuitReceptor: '30709076783',
        razonSocialReceptor: 'ADVA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS', // Same currency
        processedAt: '2024-01-15T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'PAGO FACTURA TEST SA 20-12345678-6',
        codigo: '001',
        oficina: '001',
        areaAdva: 'General',
        debito: 100000,
        credito: null,
        detalle: ''
      };

      const result = matcher.matchMovement(movement, [arsFactura], [], []);

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('HIGH'); // Not capped - same currency
    });
  });
});

describe('BankMovementMatcher - Credit Movement Matching', () => {
  let matcher: BankMovementMatcher;

  beforeEach(() => {
    matcher = new BankMovementMatcher(5); // 5% tolerance

    // Set up exchange rates for USD testing (multiple dates for different tests)
    const testRate1: ExchangeRate = {
      fecha: '2024-01-01',
      compra: 800,
      venta: 850
    };
    const testRate2: ExchangeRate = {
      fecha: '2024-01-10',
      compra: 800,
      venta: 850
    };
    const testRate3: ExchangeRate = {
      fecha: '2024-01-15',
      compra: 800,
      venta: 850
    };
    setExchangeRateCache('2024-01-01', testRate1);
    setExchangeRateCache('2024-01-10', testRate2);
    setExchangeRateCache('2024-01-15', testRate3);
  });

  describe('matchCreditMovement', () => {
    it('matches Pago Recibido with linked Factura Emitida', () => {
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-10',
        cuitEmisor: '30709076783', // ADVA
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786', // Client
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS',
        processedAt: '2024-01-10T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const pagoRecibido: Pago & { row: number } = {
        fileId: 'pago1',
        fileName: 'pago-001.pdf',
        banco: 'BBVA',
        fechaPago: '2024-01-15',
        importePagado: 100000,
        moneda: 'ARS',
        cuitPagador: '20123456786', // Client
        nombrePagador: 'TEST SA',
        cuitBeneficiario: '30709076783', // ADVA
        nombreBeneficiario: 'ADVA',
        matchedFacturaFileId: 'factura1', // Linked to factura
        matchConfidence: 'HIGH',
        processedAt: '2024-01-15T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA 20-12345678-6',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 100000,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [facturaEmitida], [pagoRecibido], []);

      expect(result.matchType).toBe('pago_factura');
      expect(result.confidence).toBe('HIGH');
      expect(result.description).toContain('Cobro Factura de TEST SA');
      expect(result.matchedFileId).toBe('pago1');
    });

    it('matches direct Factura Emitida with exact amount', () => {
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-10',
        cuitEmisor: '30709076783',
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS',
        processedAt: '2024-01-10T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA 20-12345678-6',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 100000,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [facturaEmitida], [], []);

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('HIGH');
      expect(result.description).toContain('Cobro Factura de TEST SA');
      expect(result.matchedFileId).toBe('factura1');
    });

    it('matches Factura Emitida with single retencion tolerance', () => {
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-10',
        cuitEmisor: '30709076783',
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS',
        processedAt: '2024-01-10T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const retencion: Retencion & { row: number } = {
        fileId: 'ret1',
        fileName: 'retencion-001.pdf',
        fechaEmision: '2024-01-15',
        nroCertificado: '001',
        cuitAgenteRetencion: '20123456786', // Same as factura client
        razonSocialAgenteRetencion: 'TEST SA',
        cuitSujetoRetenido: '30709076783', // ADVA
        impuesto: 'Ganancias',
        regimen: '830',
        montoComprobante: 100000,
        montoRetencion: 5000,
        processedAt: '2024-01-15T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 95000, // 100000 - 5000
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [facturaEmitida], [], [retencion]);

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('HIGH');
      expect(result.description).toContain('Cobro Factura de TEST SA');
      expect(result.description).toContain('retencion');
      expect(result.matchedFileId).toBe('factura1');
    });

    it('matches Factura Emitida with multiple retenciones', () => {
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-10',
        cuitEmisor: '30709076783',
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS',
        processedAt: '2024-01-10T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const retencionGanancias: Retencion & { row: number } = {
        fileId: 'ret1',
        fileName: 'retencion-ganancias.pdf',
        fechaEmision: '2024-01-15',
        nroCertificado: '001',
        cuitAgenteRetencion: '20123456786',
        razonSocialAgenteRetencion: 'TEST SA',
        cuitSujetoRetenido: '30709076783',
        impuesto: 'Ganancias',
        regimen: '830',
        montoComprobante: 100000,
        montoRetencion: 7000,
        processedAt: '2024-01-15T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
        row: 2
      };

      const retencionIVA: Retencion & { row: number } = {
        fileId: 'ret2',
        fileName: 'retencion-iva.pdf',
        fechaEmision: '2024-01-15',
        nroCertificado: '002',
        cuitAgenteRetencion: '20123456786',
        razonSocialAgenteRetencion: 'TEST SA',
        cuitSujetoRetenido: '30709076783',
        impuesto: 'IVA',
        regimen: '767',
        montoComprobante: 100000,
        montoRetencion: 3000,
        processedAt: '2024-01-15T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 90000, // 100000 - 7000 - 3000
        detalle: ''
      };

      const result = matcher.matchCreditMovement(
        movement,
        [facturaEmitida],
        [],
        [retencionGanancias, retencionIVA]
      );

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('HIGH');
      expect(result.description).toContain('Cobro Factura de TEST SA');
      expect(result.matchedFileId).toBe('factura1');
    });

    it('matches cross-currency USD Factura with ARS retenciones', () => {
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-10',
        cuitEmisor: '30709076783',
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90.91,
        importeIva: 9.09,
        importeTotal: 100, // USD
        moneda: 'USD',
        processedAt: '2024-01-10T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const retencion: Retencion & { row: number } = {
        fileId: 'ret1',
        fileName: 'retencion-001.pdf',
        fechaEmision: '2024-01-15',
        nroCertificado: '001',
        cuitAgenteRetencion: '20123456786',
        razonSocialAgenteRetencion: 'TEST SA',
        cuitSujetoRetenido: '30709076783',
        impuesto: 'Ganancias',
        regimen: '830',
        montoComprobante: 85000, // ARS
        montoRetencion: 6000, // ARS (larger to ensure no match without it)
        processedAt: '2024-01-15T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 79000, // 85000 - 6000 (should NOT match without retencion: 7.1% diff)
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [facturaEmitida], [], [retencion]);

      expect(result.matchType).toBe('direct_factura');
      expect(result.description).toContain('Cobro Factura de TEST SA');
      expect(result.description).toContain('retencion'); // Should use retencion
      expect(result.matchedFileId).toBe('factura1');
      expect(result.confidence).toBe('MEDIUM'); // Cross-currency with implicit CUIT match from retenciones
    });

    it('matches Factura with retencion (simple case)', () => {
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-10',
        cuitEmisor: '30709076783',
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS',
        processedAt: '2024-01-10T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const retencion: Retencion & { row: number } = {
        fileId: 'ret1',
        fileName: 'retencion-001.pdf',
        fechaEmision: '2024-01-12', // 2 days after factura
        nroCertificado: '001',
        cuitAgenteRetencion: '20123456786',
        razonSocialAgenteRetencion: 'TEST SA',
        cuitSujetoRetenido: '30709076783',
        impuesto: 'Ganancias',
        regimen: '830',
        montoComprobante: 100000,
        montoRetencion: 5000,
        processedAt: '2024-01-12T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 95000, // 100000 - 5000
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [facturaEmitida], [], [retencion]);

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('HIGH');
      expect(result.description).toContain('retencion');
    });

    it('filters retenciones by date range (90 days)', () => {
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-01',
        cuitEmisor: '30709076783',
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS',
        processedAt: '2024-01-01T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const retencionValid: Retencion & { row: number } = {
        fileId: 'ret1',
        fileName: 'retencion-valid.pdf',
        fechaEmision: '2024-03-30', // 89 days after factura (within 90-day window)
        nroCertificado: '001',
        cuitAgenteRetencion: '20123456786',
        razonSocialAgenteRetencion: 'TEST SA',
        cuitSujetoRetenido: '30709076783',
        impuesto: 'Ganancias',
        regimen: '830',
        montoComprobante: 100000,
        montoRetencion: 5000,
        processedAt: '2024-03-31T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
        row: 2
      };

      const retencionTooLate: Retencion & { row: number } = {
        fileId: 'ret2',
        fileName: 'retencion-toolate.pdf',
        fechaEmision: '2024-04-02', // 91+ days after factura
        nroCertificado: '002',
        cuitAgenteRetencion: '20123456786',
        razonSocialAgenteRetencion: 'TEST SA',
        cuitSujetoRetenido: '30709076783',
        impuesto: 'IVA',
        regimen: '767',
        montoComprobante: 100000,
        montoRetencion: 3000,
        processedAt: '2024-04-02T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15', // Within factura date range (-5/+30 days)
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 95000, // 100000 - 5000 (only valid retencion counted)
        detalle: ''
      };

      const result = matcher.matchCreditMovement(
        movement,
        [facturaEmitida],
        [],
        [retencionValid, retencionTooLate]
      );

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('HIGH');
      expect(result.description).toContain('retencion'); // Should mention retencion was used
    });

    it('matches Pago Recibido without linked Factura', () => {
      const pagoRecibido: Pago & { row: number } = {
        fileId: 'pago1',
        fileName: 'pago-001.pdf',
        banco: 'BBVA',
        fechaPago: '2024-01-15',
        importePagado: 100000,
        moneda: 'ARS',
        cuitPagador: '20123456786',
        nombrePagador: 'TEST SA',
        cuitBeneficiario: '30709076783',
        nombreBeneficiario: 'ADVA',
        processedAt: '2024-01-15T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 100000,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [], [pagoRecibido], []);

      expect(result.matchType).toBe('pago_only');
      expect(result.confidence).toBe('MEDIUM');
      expect(result.description).toContain('REVISAR! Cobro de TEST SA');
      expect(result.matchedFileId).toBe('pago1');
    });

    it('returns bank_fee match for credit movement with bank fee concepto', () => {
      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'COMISION MAN CUENTA',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 500,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [], [], []);

      expect(result.matchType).toBe('bank_fee');
      expect(result.confidence).toBe('HIGH');
      expect(result.matchedFileId).toBe('');
      expect(result.description).toBe('Gastos bancarios');
    });

    it('returns credit_card_payment match for credit movement with credit card payment concepto', () => {
      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'PAGO TARJETA 4563',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 15000,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [], [], []);

      expect(result.matchType).toBe('credit_card_payment');
      expect(result.confidence).toBe('HIGH');
      expect(result.matchedFileId).toBe('');
      expect(result.description).toBe('Pago de tarjeta de credito');
    });

    it('returns bank_fee for credit movement even with zero credit amount', () => {
      // Bank fee check should run BEFORE amount validation
      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'IMPUESTO LEY 25413',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 0,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [], [], []);

      expect(result.matchType).toBe('bank_fee');
      expect(result.confidence).toBe('HIGH');
    });

    it('non-fee credit movements still go through normal matching', () => {
      // Normal credit movement that is NOT a bank fee should proceed to normal matching
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-10',
        cuitEmisor: '30709076783',
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS',
        processedAt: '2024-01-10T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA DESDE TEST SA 20-12345678-6',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 100000,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [facturaEmitida], [], []);

      // Should match the factura, not be treated as a bank fee
      expect(result.matchType).toBe('direct_factura');
      expect(result.matchedFileId).toBe('factura1');
    });

    it('returns no match for credit movement with no matches', () => {
      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'DEPOSITO DESCONOCIDO',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 50000,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [], [], []);

      expect(result.matchType).toBe('no_match');
      expect(result.description).toBe('');
      expect(result.matchedFileId).toBe('');
    });

    it('extracts CUIT from concepto for credit movements', () => {
      const facturaEmitida: Factura & { row: number } = {
        fileId: 'factura1',
        fileName: 'factura-001.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00000123',
        fechaEmision: '2024-01-10',
        cuitEmisor: '30709076783',
        razonSocialEmisor: 'ADVA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'TEST SA',
        importeNeto: 90000,
        importeIva: 10000,
        importeTotal: 100000,
        moneda: 'ARS',
        processedAt: '2024-01-10T10:00:00Z',
        needsReview: false,
        confidence: 0.95,
        row: 2
      };

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'TRANSFERENCIA 20-12345678-6',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: null,
        credito: 100000,
        detalle: ''
      };

      const result = matcher.matchCreditMovement(movement, [facturaEmitida], [], []);

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('HIGH');
    });
  });

  describe('compareMatches', () => {
    it('prefers CUIT match over no CUIT match', () => {
      const withoutCuit = {
        fileId: 'doc1',
        confidence: 'HIGH' as const,
        hasCuitMatch: false,
        dateDistance: 2,
        isExactAmount: true,
        hasLinkedPago: false
      };

      const withCuit = {
        fileId: 'doc2',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 10,
        isExactAmount: false,
        hasLinkedPago: false
      };

      const result = matcher.compareMatches(withoutCuit, withCuit);

      expect(result).toBe('candidate'); // withCuit wins
    });

    it('prefers closer date when CUIT match is equal', () => {
      const further = {
        fileId: 'doc1',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 10,
        isExactAmount: true,
        hasLinkedPago: false
      };

      const closer = {
        fileId: 'doc2',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 2,
        isExactAmount: true,
        hasLinkedPago: false
      };

      const result = matcher.compareMatches(further, closer);

      expect(result).toBe('candidate'); // closer wins
    });

    it('prefers exact amount over tolerance match', () => {
      const withTolerance = {
        fileId: 'doc1',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 2,
        isExactAmount: false,
        hasLinkedPago: false
      };

      const exact = {
        fileId: 'doc2',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 2,
        isExactAmount: true,
        hasLinkedPago: false
      };

      const result = matcher.compareMatches(withTolerance, exact);

      expect(result).toBe('candidate'); // exact wins
    });

    it('prefers Factura with linked Pago over Factura alone', () => {
      const withoutPago = {
        fileId: 'doc1',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 2,
        isExactAmount: true,
        hasLinkedPago: false
      };

      const withPago = {
        fileId: 'doc2',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 2,
        isExactAmount: true,
        hasLinkedPago: true
      };

      const result = matcher.compareMatches(withoutPago, withPago);

      expect(result).toBe('candidate'); // withPago wins
    });

    it('keeps existing when quality is equal', () => {
      const existing = {
        fileId: 'doc1',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 2,
        isExactAmount: true,
        hasLinkedPago: false
      };

      const candidate = {
        fileId: 'doc2',
        confidence: 'HIGH' as const,
        hasCuitMatch: true,
        dateDistance: 2,
        isExactAmount: true,
        hasLinkedPago: false
      };

      const result = matcher.compareMatches(existing, candidate);

      expect(result).toBe('existing'); // No churn
    });
  });

  describe('matchedFacturaFileId null check (bug #44)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('logs warning and continues when matchedFacturaFileId exists but factura not in array', () => {
      // Bug: Code doesn't log warning when linked factura doesn't exist
      // This can happen if:
      // - The linked factura was deleted
      // - The linked factura is in a different spreadsheet
      // - Data inconsistency

      const facturas: Array<Factura & { row: number }> = [
        {
          fileId: 'factura-1',
          fileName: 'factura-1.pdf',
          tipoComprobante: 'A',
          nroFactura: '00001-00000001',
          fechaEmision: '2024-01-15',
          cuitEmisor: '20123456786',
          razonSocialEmisor: 'TEST SA',
          cuitReceptor: '30709076783',
          razonSocialReceptor: 'ADVA',
          importeNeto: 1000,
          importeIva: 210,
          importeTotal: 1210,
          moneda: 'ARS',
          processedAt: '2024-01-15T10:00:00Z',
          needsReview: false,
          confidence: 0.95,
          row: 2
        }
      ];

      const pagos: Array<Pago & { row: number }> = [
        {
          fileId: 'pago-1',
          fileName: 'pago-1.pdf',
          banco: 'BBVA',
          fechaPago: '2024-01-15',
          importePagado: 1210,
          moneda: 'ARS',
          matchedFacturaFileId: 'factura-missing', // Links to factura not in array
          processedAt: '2024-01-15T10:00:00Z',
          needsReview: false,
          confidence: 0.95,
          row: 3
        }
      ];

      const movement: BankMovement = {
        row: 1,
        fecha: '2024-01-15',
        fechaValor: '2024-01-15',
        concepto: 'PAGO 20123456786',
        codigo: '',
        oficina: '',
        areaAdva: '',
        debito: 1210,
        credito: null,
        detalle: ''
      };

      // Should not crash, should log warning and continue
      const result = matcher.matchMovement(movement, facturas, [], pagos);

      // Should log warning about missing linked factura
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
        expect.objectContaining({
          pagoFileId: 'pago-1',
          matchedFacturaFileId: 'factura-missing'
        })
      );

      // Should still match factura-1 directly if it matches
      expect(result.matchType).not.toBe('no_match');
    });
  });

  describe('calculateKeywordMatchScore - word boundary matching', () => {
    it('should not match "SA" as substring in "COMISIONES SA"', () => {
      const score = calculateKeywordMatchScore(
        'PAGO SA',  // Bank concepto with "SA" as token
        'COMISIONES SA',  // Emisor name with "SA" as suffix
        ''
      );

      // "SA" is a common suffix and should not match as a meaningful keyword
      expect(score).toBe(0);
    });

    it('should match "IBM" in "IBM ARGENTINA" with word boundaries', () => {
      const score = calculateKeywordMatchScore(
        'PAGO IBM SERVICIOS',
        'IBM ARGENTINA SA',
        ''
      );

      // "IBM" is a distinct word and should match
      expect(score).toBeGreaterThan(0);
    });

    it('should not match partial words', () => {
      const score = calculateKeywordMatchScore(
        'PAGO TEST',  // "TEST" as token
        'TESTIMONIO SA',  // "TEST" as prefix in different word
        ''
      );

      expect(score).toBe(0);
    });

    it('should match complete word tokens only', () => {
      const score = calculateKeywordMatchScore(
        'PAGO ACME',
        'ACME CORPORATION',
        ''
      );

      expect(score).toBeGreaterThan(0);
    });
  });
});

describe('stripBankOriginPrefix', () => {
  it('should strip "D NNN " prefix (origin code with 3-digit channel)', () => {
    expect(stripBankOriginPrefix('D 500 TRANSFERENCIA RECIBIDA')).toBe('TRANSFERENCIA RECIBIDA');
  });

  it('should not strip "D " prefix without channel number (avoids false positives)', () => {
    expect(stripBankOriginPrefix('D COMISION MANTENIMIENTO')).toBe('D COMISION MANTENIMIENTO');
  });

  it('should strip prefix with varying whitespace', () => {
    expect(stripBankOriginPrefix('D  500  IMPUESTO LEY')).toBe('IMPUESTO LEY');
  });

  it('should not strip if no D prefix', () => {
    expect(stripBankOriginPrefix('TRANSFERENCIA RECIBIDA')).toBe('TRANSFERENCIA RECIBIDA');
  });

  it('should not strip if D is part of a word', () => {
    expect(stripBankOriginPrefix('DEBITO DIRECTO')).toBe('DEBITO DIRECTO');
  });

  it('should handle empty string', () => {
    expect(stripBankOriginPrefix('')).toBe('');
  });

  it('should not strip single-digit channel code (too short)', () => {
    expect(stripBankOriginPrefix('D 5 TRANSFERENCIA')).toBe('D 5 TRANSFERENCIA');
  });

  it('should strip prefix with 2-digit channel number', () => {
    expect(stripBankOriginPrefix('D 50 PAGO TARJETA 1234')).toBe('PAGO TARJETA 1234');
  });
});

describe('isBankFee with origin prefix', () => {
  it('should match bank fee with D prefix', () => {
    expect(isBankFee('D 500 IMPUESTO LEY 25413')).toBe(true);
  });

  it('should match bank fee with D NNN prefix', () => {
    expect(isBankFee('D 500 COMISION MANTENIMIENTO')).toBe(true);
  });

  it('should still match bank fee without prefix', () => {
    expect(isBankFee('IMPUESTO LEY 25413')).toBe(true);
  });
});

describe('isCreditCardPayment with origin prefix', () => {
  it('should match credit card payment with D prefix', () => {
    expect(isCreditCardPayment('D 500 PAGO TARJETA 1234')).toBe(true);
  });

  it('should still match credit card payment without prefix', () => {
    expect(isCreditCardPayment('PAGO TARJETA 1234')).toBe(true);
  });
});

describe('extractKeywordTokens with origin prefix', () => {
  it('should not include origin prefix tokens (D, channel number)', () => {
    const tokens = extractKeywordTokens('D 500 TRANSFERENCIA RECIBIDA');
    expect(tokens).not.toContain('D');
    expect(tokens).not.toContain('500');
    // Should still have meaningful tokens
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('should extract same tokens with and without prefix', () => {
    const withPrefix = extractKeywordTokens('D 500 ACME CORPORATION');
    const withoutPrefix = extractKeywordTokens('ACME CORPORATION');
    expect(withPrefix).toEqual(withoutPrefix);
  });
});
