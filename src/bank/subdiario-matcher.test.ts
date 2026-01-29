/**
 * Unit tests for Subdiario de Ventas matcher
 */

import { describe, it, expect } from 'vitest';
import {
  SubdiarioMatcher,
  extractCuitFromMovementConcepto
} from './subdiario-matcher.js';
import type { BankMovement, SubdiarioCobro } from '../types/index.js';

describe('extractCuitFromMovementConcepto', () => {
  it('extracts CUIT from "TRANSFERENCI 30712345671"', () => {
    expect(extractCuitFromMovementConcepto('TRANSFERENCI 30712345671')).toBe('30712345671');
  });

  it('extracts CUIT with explicit prefix "CUIT 30-71234567-1"', () => {
    expect(extractCuitFromMovementConcepto('CUIT 30-71234567-1')).toBe('30712345671');
  });

  it('extracts CUIT from middle of text', () => {
    expect(extractCuitFromMovementConcepto('PAGO REF 30709076783 CLIENTE')).toBe('30709076783');
  });

  it('returns undefined for text without CUIT', () => {
    expect(extractCuitFromMovementConcepto('PAGO GENERAL')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractCuitFromMovementConcepto('')).toBeUndefined();
  });

  it('returns undefined for invalid 11-digit number (bad checksum)', () => {
    expect(extractCuitFromMovementConcepto('12345678901')).toBeUndefined();
  });
});

describe('SubdiarioMatcher', () => {
  const matcher = new SubdiarioMatcher();

  // Helper to create a test cobro
  const createCobro = (overrides: Partial<SubdiarioCobro> = {}): SubdiarioCobro => ({
    rowNumber: 17,
    fechaCobro: new Date(2025, 0, 10),
    fechaFactura: new Date(2025, 0, 5),
    comprobanteNumero: '00003-00001957',
    cliente: 'ECLIPSE ENTERTAINMENT SRL',
    cuit: '30712345671',
    total: 100000,
    concepto: 'CUOTA 12/24',
    categoria: 'SERVICIOS',
    ...overrides
  });

  // Helper to create a test movement (credit)
  const createCreditMovement = (overrides: Partial<BankMovement> = {}): BankMovement => ({
    row: 13,
    fecha: '2025-01-10',
    fechaValor: '2025-01-10',
    concepto: 'TRANSFERENCI 30712345671',
    codigo: '319',
    oficina: '500',
    areaAdva: '',
    credito: 100000,
    debito: null,
    detalle: '',
    ...overrides
  });

  describe('matchMovement - Pass 1: CUIT match', () => {
    it('matches credit movement by CUIT in concepto', () => {
      const movement = createCreditMovement({
        concepto: 'TRANSFERENCI 30712345671',
        credito: 100000
      });
      const cobro = createCobro({
        cuit: '30712345671',
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('HIGH');
      expect(result.cobro).toBe(cobro);
      expect(result.detalle).toContain('ECLIPSE ENTERTAINMENT SRL');
      expect(result.detalle).toContain('00003-00001957');
      expect(result.detalle).toContain('CUOTA 12/24');
    });

    it('matches even with small amount tolerance', () => {
      const movement = createCreditMovement({
        concepto: 'TRANSFERENCI 30712345671',
        credito: 100000.50 // 0.50 difference
      });
      const cobro = createCobro({
        cuit: '30712345671',
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('HIGH');
    });

    it('does not match if CUIT matches but amount is too different', () => {
      const movement = createCreditMovement({
        concepto: 'TRANSFERENCI 30712345671',
        credito: 50000 // Different amount
      });
      const cobro = createCobro({
        cuit: '30712345671',
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(false);
    });

    it('skips already used cobros', () => {
      const cobro = createCobro({ cuit: '30712345671' });
      const movement = createCreditMovement({ concepto: 'TRANSFERENCI 30712345671' });

      const usedCobros = new Set([17]); // cobro row is 17

      const result = matcher.matchMovement(movement, [cobro], usedCobros);

      expect(result.matched).toBe(false);
      expect(result.reasons).toContain('All cobros already matched');
    });
  });

  describe('matchMovement - Pass 2: Amount + Date match', () => {
    it('matches by amount and close date when no CUIT in concepto', () => {
      const movement = createCreditMovement({
        concepto: 'PAGO GENERAL', // No CUIT
        fecha: '2025-01-10',
        credito: 100000
      });
      const cobro = createCobro({
        fechaCobro: new Date(2025, 0, 8), // 2 days before
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('MEDIUM');
    });

    it('assigns MEDIUM confidence for date within ±15 days', () => {
      const movement = createCreditMovement({
        concepto: 'PAGO',
        fecha: '2025-01-25', // 15 days after cobro
        credito: 100000
      });
      const cobro = createCobro({
        fechaCobro: new Date(2025, 0, 10),
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('MEDIUM');
    });

    it('assigns LOW confidence for date within ±30 days but more than 15', () => {
      const movement = createCreditMovement({
        concepto: 'PAGO',
        fecha: '2025-02-05', // 26 days after cobro
        credito: 100000
      });
      const cobro = createCobro({
        fechaCobro: new Date(2025, 0, 10),
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('LOW');
    });

    it('does not match if date is more than 30 days apart', () => {
      const movement = createCreditMovement({
        concepto: 'PAGO',
        fecha: '2025-02-15', // 36 days after cobro
        credito: 100000
      });
      const cobro = createCobro({
        fechaCobro: new Date(2025, 0, 10),
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(false);
    });

    it('prefers closer date when multiple cobros match by amount', () => {
      const movement = createCreditMovement({
        concepto: 'PAGO',
        fecha: '2025-01-10',
        credito: 100000
      });
      const cobroFar = createCobro({
        rowNumber: 17,
        fechaCobro: new Date(2025, 0, 1), // 9 days before
        cliente: 'FAR CLIENT',
        total: 100000
      });
      const cobroClose = createCobro({
        rowNumber: 18,
        fechaCobro: new Date(2025, 0, 9), // 1 day before
        cliente: 'CLOSE CLIENT',
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobroFar, cobroClose], new Set());

      expect(result.matched).toBe(true);
      expect(result.cobro?.cliente).toBe('CLOSE CLIENT');
    });
  });

  describe('matchMovement - No match cases', () => {
    it('returns no match for debit movements', () => {
      const movement = createCreditMovement({
        credito: null,
        debito: 100000
      });
      const cobro = createCobro({ total: 100000 });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(false);
      expect(result.reasons).toContain('Not a credit movement');
    });

    it('returns no match when no cobros provided', () => {
      const movement = createCreditMovement();

      const result = matcher.matchMovement(movement, [], new Set());

      expect(result.matched).toBe(false);
      expect(result.reasons).toContain('No cobros to match against');
    });

    it('returns no match when amount does not match any cobro', () => {
      const movement = createCreditMovement({ credito: 999999 });
      const cobro = createCobro({ total: 100000 });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.matched).toBe(false);
    });
  });

  describe('Detalle format', () => {
    it('formats detalle as "Cobro [CLIENTE] - Fc [COMPROBANTE N°] - [CONCEPTO]"', () => {
      const movement = createCreditMovement({ concepto: 'TRANSFERENCI 30712345671' });
      const cobro = createCobro({
        cliente: 'ECLIPSE ENTERTAINMENT SRL',
        comprobanteNumero: '00003-00001957',
        concepto: 'CUOTA 12/24'
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.detalle).toBe('Cobro ECLIPSE ENTERTAINMENT SRL - Fc 00003-00001957 - CUOTA 12/24');
    });

    it('handles empty concepto', () => {
      const movement = createCreditMovement({ concepto: 'TRANSFERENCI 30712345671' });
      const cobro = createCobro({
        cliente: 'CLIENT',
        comprobanteNumero: '00001-00000001',
        concepto: ''
      });

      const result = matcher.matchMovement(movement, [cobro], new Set());

      expect(result.detalle).toBe('Cobro CLIENT - Fc 00001-00000001');
    });
  });

  describe('Priority of CUIT match over date match', () => {
    it('prefers CUIT match even if date is farther', () => {
      const movement = createCreditMovement({
        concepto: 'TRANSFERENCI 30712345671',
        fecha: '2025-01-10',
        credito: 100000
      });

      const cobroCuit = createCobro({
        rowNumber: 17,
        cuit: '30712345671',
        fechaCobro: new Date(2025, 0, 1), // 9 days before
        cliente: 'CUIT MATCH',
        total: 100000
      });

      const cobroClose = createCobro({
        rowNumber: 18,
        cuit: '99999999999', // Different CUIT
        fechaCobro: new Date(2025, 0, 10), // Same day
        cliente: 'DATE MATCH',
        total: 100000
      });

      const result = matcher.matchMovement(movement, [cobroClose, cobroCuit], new Set());

      expect(result.matched).toBe(true);
      expect(result.cobro?.cliente).toBe('CUIT MATCH');
      expect(result.confidence).toBe('HIGH');
    });
  });
});
