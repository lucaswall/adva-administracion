/**
 * Unit tests for spreadsheet header constants
 */

import { describe, it, expect } from 'vitest';
import {
  FACTURA_EMITIDA_HEADERS,
  FACTURA_RECIBIDA_HEADERS,
  PAGO_ENVIADO_HEADERS,
  PAGO_RECIBIDO_HEADERS,
  RECIBO_HEADERS,
  RESUMEN_BANCARIO_HEADERS,
  CONTROL_CREDITOS_SHEETS,
  CONTROL_DEBITOS_SHEETS,
} from '../../../src/constants/spreadsheet-headers.js';

describe('spreadsheet-headers', () => {
  describe('FACTURA_EMITIDA_HEADERS', () => {
    it('has 18 headers (columns A:R)', () => {
      expect(FACTURA_EMITIDA_HEADERS).toHaveLength(18);
    });

    it('starts with fechaEmision', () => {
      expect(FACTURA_EMITIDA_HEADERS[0]).toBe('fechaEmision');
    });

    it('contains required invoice fields', () => {
      expect(FACTURA_EMITIDA_HEADERS).toContain('tipoComprobante');
      expect(FACTURA_EMITIDA_HEADERS).toContain('importeTotal');
      expect(FACTURA_EMITIDA_HEADERS).toContain('fechaEmision');
      expect(FACTURA_EMITIDA_HEADERS).toContain('nroFactura');
    });

    it('contains only receptor info (not emisor)', () => {
      expect(FACTURA_EMITIDA_HEADERS).toContain('cuitReceptor');
      expect(FACTURA_EMITIDA_HEADERS).toContain('razonSocialReceptor');
      expect(FACTURA_EMITIDA_HEADERS).not.toContain('cuitEmisor');
      expect(FACTURA_EMITIDA_HEADERS).not.toContain('razonSocialEmisor');
    });

    it('ends with hasCuitMatch', () => {
      expect(FACTURA_EMITIDA_HEADERS[FACTURA_EMITIDA_HEADERS.length - 1]).toBe('hasCuitMatch');
    });

    it('contains matching fields', () => {
      expect(FACTURA_EMITIDA_HEADERS).toContain('matchedPagoFileId');
      expect(FACTURA_EMITIDA_HEADERS).toContain('matchConfidence');
    });
  });

  describe('FACTURA_RECIBIDA_HEADERS', () => {
    it('has 18 headers (columns A:R)', () => {
      expect(FACTURA_RECIBIDA_HEADERS).toHaveLength(18);
    });

    it('starts with fechaEmision', () => {
      expect(FACTURA_RECIBIDA_HEADERS[0]).toBe('fechaEmision');
    });

    it('contains required invoice fields', () => {
      expect(FACTURA_RECIBIDA_HEADERS).toContain('tipoComprobante');
      expect(FACTURA_RECIBIDA_HEADERS).toContain('importeTotal');
      expect(FACTURA_RECIBIDA_HEADERS).toContain('fechaEmision');
      expect(FACTURA_RECIBIDA_HEADERS).toContain('nroFactura');
    });

    it('contains only emisor info (not receptor)', () => {
      expect(FACTURA_RECIBIDA_HEADERS).toContain('cuitEmisor');
      expect(FACTURA_RECIBIDA_HEADERS).toContain('razonSocialEmisor');
      expect(FACTURA_RECIBIDA_HEADERS).not.toContain('cuitReceptor');
      expect(FACTURA_RECIBIDA_HEADERS).not.toContain('razonSocialReceptor');
    });

    it('ends with hasCuitMatch', () => {
      expect(FACTURA_RECIBIDA_HEADERS[FACTURA_RECIBIDA_HEADERS.length - 1]).toBe('hasCuitMatch');
    });

    it('contains matching fields', () => {
      expect(FACTURA_RECIBIDA_HEADERS).toContain('matchedPagoFileId');
      expect(FACTURA_RECIBIDA_HEADERS).toContain('matchConfidence');
    });
  });

  describe('PAGO_ENVIADO_HEADERS', () => {
    it('has 15 headers (columns A:O)', () => {
      expect(PAGO_ENVIADO_HEADERS).toHaveLength(15);
    });

    it('starts with fechaPago', () => {
      expect(PAGO_ENVIADO_HEADERS[0]).toBe('fechaPago');
    });

    it('contains required payment fields', () => {
      expect(PAGO_ENVIADO_HEADERS).toContain('banco');
      expect(PAGO_ENVIADO_HEADERS).toContain('fechaPago');
      expect(PAGO_ENVIADO_HEADERS).toContain('importePagado');
      expect(PAGO_ENVIADO_HEADERS).toContain('moneda');
    });

    it('contains only beneficiario info (not pagador)', () => {
      expect(PAGO_ENVIADO_HEADERS).toContain('cuitBeneficiario');
      expect(PAGO_ENVIADO_HEADERS).toContain('nombreBeneficiario');
      expect(PAGO_ENVIADO_HEADERS).not.toContain('cuitPagador');
      expect(PAGO_ENVIADO_HEADERS).not.toContain('nombrePagador');
    });

    it('ends with matchConfidence', () => {
      expect(PAGO_ENVIADO_HEADERS[PAGO_ENVIADO_HEADERS.length - 1]).toBe('matchConfidence');
    });

    it('contains matching fields', () => {
      expect(PAGO_ENVIADO_HEADERS).toContain('matchedFacturaFileId');
      expect(PAGO_ENVIADO_HEADERS).toContain('matchConfidence');
    });
  });

  describe('PAGO_RECIBIDO_HEADERS', () => {
    it('has 15 headers (columns A:O)', () => {
      expect(PAGO_RECIBIDO_HEADERS).toHaveLength(15);
    });

    it('starts with fechaPago', () => {
      expect(PAGO_RECIBIDO_HEADERS[0]).toBe('fechaPago');
    });

    it('contains required payment fields', () => {
      expect(PAGO_RECIBIDO_HEADERS).toContain('banco');
      expect(PAGO_RECIBIDO_HEADERS).toContain('fechaPago');
      expect(PAGO_RECIBIDO_HEADERS).toContain('importePagado');
      expect(PAGO_RECIBIDO_HEADERS).toContain('moneda');
    });

    it('contains only pagador info (not beneficiario)', () => {
      expect(PAGO_RECIBIDO_HEADERS).toContain('cuitPagador');
      expect(PAGO_RECIBIDO_HEADERS).toContain('nombrePagador');
      expect(PAGO_RECIBIDO_HEADERS).not.toContain('cuitBeneficiario');
      expect(PAGO_RECIBIDO_HEADERS).not.toContain('nombreBeneficiario');
    });

    it('ends with matchConfidence', () => {
      expect(PAGO_RECIBIDO_HEADERS[PAGO_RECIBIDO_HEADERS.length - 1]).toBe('matchConfidence');
    });

    it('contains matching fields', () => {
      expect(PAGO_RECIBIDO_HEADERS).toContain('matchedFacturaFileId');
      expect(PAGO_RECIBIDO_HEADERS).toContain('matchConfidence');
    });
  });

  describe('RECIBO_HEADERS', () => {
    it('has 18 headers (columns A:R)', () => {
      expect(RECIBO_HEADERS).toHaveLength(18);
    });

    it('starts with fechaPago', () => {
      expect(RECIBO_HEADERS[0]).toBe('fechaPago');
    });

    it('contains required receipt fields', () => {
      expect(RECIBO_HEADERS).toContain('nombreEmpleado');
      expect(RECIBO_HEADERS).toContain('cuilEmpleado');
      expect(RECIBO_HEADERS).toContain('totalNeto');
      expect(RECIBO_HEADERS).toContain('fechaPago');
      expect(RECIBO_HEADERS).toContain('tipoRecibo');
    });

    it('contains salary-specific fields', () => {
      expect(RECIBO_HEADERS).toContain('subtotalRemuneraciones');
      expect(RECIBO_HEADERS).toContain('subtotalDescuentos');
      expect(RECIBO_HEADERS).toContain('legajo');
      expect(RECIBO_HEADERS).toContain('tareaDesempenada');
    });

    it('ends with matchConfidence', () => {
      expect(RECIBO_HEADERS[RECIBO_HEADERS.length - 1]).toBe('matchConfidence');
    });
  });

  describe('RESUMEN_BANCARIO_HEADERS', () => {
    it('has 13 headers', () => {
      expect(RESUMEN_BANCARIO_HEADERS).toHaveLength(13);
    });

    it('starts with fileId', () => {
      expect(RESUMEN_BANCARIO_HEADERS[0]).toBe('fileId');
    });

    it('contains required bank statement fields', () => {
      expect(RESUMEN_BANCARIO_HEADERS).toContain('banco');
      expect(RESUMEN_BANCARIO_HEADERS).toContain('numeroCuenta');
      expect(RESUMEN_BANCARIO_HEADERS).toContain('fechaDesde');
      expect(RESUMEN_BANCARIO_HEADERS).toContain('fechaHasta');
      expect(RESUMEN_BANCARIO_HEADERS).toContain('saldoInicial');
      expect(RESUMEN_BANCARIO_HEADERS).toContain('saldoFinal');
    });

    it('contains movement tracking fields', () => {
      expect(RESUMEN_BANCARIO_HEADERS).toContain('cantidadMovimientos');
      expect(RESUMEN_BANCARIO_HEADERS).toContain('moneda');
    });

    it('ends with needsReview', () => {
      expect(RESUMEN_BANCARIO_HEADERS[RESUMEN_BANCARIO_HEADERS.length - 1]).toBe('needsReview');
    });
  });

  describe('CONTROL_CREDITOS_SHEETS', () => {
    it('has 2 sheet configurations', () => {
      expect(CONTROL_CREDITOS_SHEETS).toHaveLength(2);
    });

    it('contains Facturas Emitidas sheet with correct headers', () => {
      const sheet = CONTROL_CREDITOS_SHEETS.find(s => s.title === 'Facturas Emitidas');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(FACTURA_EMITIDA_HEADERS);
    });

    it('contains Pagos Recibidos sheet with correct headers', () => {
      const sheet = CONTROL_CREDITOS_SHEETS.find(s => s.title === 'Pagos Recibidos');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(PAGO_RECIBIDO_HEADERS);
    });

    it('all sheet configs have title and headers', () => {
      CONTROL_CREDITOS_SHEETS.forEach(sheet => {
        expect(sheet.title).toBeTruthy();
        expect(Array.isArray(sheet.headers)).toBe(true);
        expect(sheet.headers.length).toBeGreaterThan(0);
      });
    });
  });

  describe('CONTROL_DEBITOS_SHEETS', () => {
    it('has 3 sheet configurations', () => {
      expect(CONTROL_DEBITOS_SHEETS).toHaveLength(3);
    });

    it('contains Facturas Recibidas sheet with correct headers', () => {
      const sheet = CONTROL_DEBITOS_SHEETS.find(s => s.title === 'Facturas Recibidas');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(FACTURA_RECIBIDA_HEADERS);
    });

    it('contains Pagos Enviados sheet with correct headers', () => {
      const sheet = CONTROL_DEBITOS_SHEETS.find(s => s.title === 'Pagos Enviados');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(PAGO_ENVIADO_HEADERS);
    });

    it('contains Recibos sheet', () => {
      const sheet = CONTROL_DEBITOS_SHEETS.find(s => s.title === 'Recibos');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(RECIBO_HEADERS);
    });

    it('all sheet configs have title and headers', () => {
      CONTROL_DEBITOS_SHEETS.forEach(sheet => {
        expect(sheet.title).toBeTruthy();
        expect(Array.isArray(sheet.headers)).toBe(true);
        expect(sheet.headers.length).toBeGreaterThan(0);
      });
    });
  });
});
