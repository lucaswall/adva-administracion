/**
 * Tests for document extraction and classification
 */

import { describe, it, expect } from 'vitest';
import { hasValidDate } from './extractor.js';

describe('hasValidDate', () => {
  describe('factura types', () => {
    it('returns true for valid YYYY-MM-DD fechaEmision', () => {
      expect(hasValidDate({ fechaEmision: '2025-11-01' }, 'factura_emitida')).toBe(true);
      expect(hasValidDate({ fechaEmision: '2025-11-01' }, 'factura_recibida')).toBe(true);
    });

    it('returns false for DD/MM/YYYY format', () => {
      expect(hasValidDate({ fechaEmision: '01/11/2025' }, 'factura_emitida')).toBe(false);
      expect(hasValidDate({ fechaEmision: '01/11/2025' }, 'factura_recibida')).toBe(false);
    });

    it('returns false for DD-MM-YYYY format', () => {
      expect(hasValidDate({ fechaEmision: '01-11-2025' }, 'factura_emitida')).toBe(false);
    });

    it('returns false for 2-digit year formats', () => {
      expect(hasValidDate({ fechaEmision: '11/13/25' }, 'factura_emitida')).toBe(false);
    });

    it('returns false for empty or missing date', () => {
      expect(hasValidDate({ fechaEmision: '' }, 'factura_emitida')).toBe(false);
      expect(hasValidDate({}, 'factura_emitida')).toBe(false);
    });
  });

  describe('pago types', () => {
    it('returns true for valid YYYY-MM-DD fechaPago', () => {
      expect(hasValidDate({ fechaPago: '2025-12-15' }, 'pago_enviado')).toBe(true);
      expect(hasValidDate({ fechaPago: '2025-12-15' }, 'pago_recibido')).toBe(true);
    });

    it('returns false for DD/MM/YYYY format', () => {
      expect(hasValidDate({ fechaPago: '15/12/2025' }, 'pago_enviado')).toBe(false);
    });

    it('returns false for empty or missing date', () => {
      expect(hasValidDate({ fechaPago: '' }, 'pago_enviado')).toBe(false);
      expect(hasValidDate({}, 'pago_recibido')).toBe(false);
    });
  });

  describe('recibo type', () => {
    it('returns true for valid YYYY-MM-DD fechaPago', () => {
      expect(hasValidDate({ fechaPago: '2025-11-30' }, 'recibo')).toBe(true);
    });

    it('returns false for DD/MM/YYYY format', () => {
      expect(hasValidDate({ fechaPago: '30/11/2025' }, 'recibo')).toBe(false);
    });
  });

  describe('resumen types', () => {
    it('returns true when both fechaDesde and fechaHasta are valid', () => {
      const doc = { fechaDesde: '2025-11-01', fechaHasta: '2025-11-30' };
      expect(hasValidDate(doc, 'resumen_bancario')).toBe(true);
      expect(hasValidDate(doc, 'resumen_tarjeta')).toBe(true);
      expect(hasValidDate(doc, 'resumen_broker')).toBe(true);
    });

    it('returns false when fechaDesde is invalid format', () => {
      const doc = { fechaDesde: '01/11/2025', fechaHasta: '2025-11-30' };
      expect(hasValidDate(doc, 'resumen_bancario')).toBe(false);
    });

    it('returns false when fechaHasta is invalid format', () => {
      const doc = { fechaDesde: '2025-11-01', fechaHasta: '30/11/2025' };
      expect(hasValidDate(doc, 'resumen_bancario')).toBe(false);
    });

    it('returns false when either date is missing', () => {
      expect(hasValidDate({ fechaDesde: '2025-11-01' }, 'resumen_bancario')).toBe(false);
      expect(hasValidDate({ fechaHasta: '2025-11-30' }, 'resumen_bancario')).toBe(false);
    });
  });

  describe('certificado_retencion type', () => {
    it('returns true for valid YYYY-MM-DD fechaEmision', () => {
      expect(hasValidDate({ fechaEmision: '2025-10-15' }, 'certificado_retencion')).toBe(true);
    });

    it('returns false for DD/MM/YYYY format', () => {
      expect(hasValidDate({ fechaEmision: '15/10/2025' }, 'certificado_retencion')).toBe(false);
    });
  });

  describe('unknown types', () => {
    it('returns false for unknown document types', () => {
      expect(hasValidDate({ fechaEmision: '2025-11-01' }, 'unknown' as never)).toBe(false);
      expect(hasValidDate({ fechaEmision: '2025-11-01' }, 'unrecognized' as never)).toBe(false);
    });
  });
});
