/**
 * Unit tests for bank movement matcher
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BankMovementMatcher } from './matcher.js';
import type { BankMovement, Factura } from '../types/index.js';
import { setExchangeRateCache, type ExchangeRate } from '../utils/exchange-rate.js';

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
