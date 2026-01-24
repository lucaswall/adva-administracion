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
  PAGOS_PENDIENTES_HEADERS,
  CONTROL_INGRESOS_SHEETS,
  CONTROL_EGRESOS_SHEETS,
  DASHBOARD_OPERATIVO_SHEETS,
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
    it('has 19 headers (columns A:S)', () => {
      expect(FACTURA_RECIBIDA_HEADERS).toHaveLength(19);
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

    it('ends with pagada', () => {
      expect(FACTURA_RECIBIDA_HEADERS[FACTURA_RECIBIDA_HEADERS.length - 1]).toBe('pagada');
    });

    it('contains matching fields', () => {
      expect(FACTURA_RECIBIDA_HEADERS).toContain('matchedPagoFileId');
      expect(FACTURA_RECIBIDA_HEADERS).toContain('matchConfidence');
      expect(FACTURA_RECIBIDA_HEADERS).toContain('hasCuitMatch');
      expect(FACTURA_RECIBIDA_HEADERS).toContain('pagada');
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

  describe('CONTROL_INGRESOS_SHEETS', () => {
    it('has 3 sheet configurations', () => {
      expect(CONTROL_INGRESOS_SHEETS).toHaveLength(3);
    });

    it('contains Facturas Emitidas sheet with correct headers', () => {
      const sheet = CONTROL_INGRESOS_SHEETS.find(s => s.title === 'Facturas Emitidas');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(FACTURA_EMITIDA_HEADERS);
    });

    it('contains Pagos Recibidos sheet with correct headers', () => {
      const sheet = CONTROL_INGRESOS_SHEETS.find(s => s.title === 'Pagos Recibidos');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(PAGO_RECIBIDO_HEADERS);
    });

    it('all sheet configs have title and headers', () => {
      CONTROL_INGRESOS_SHEETS.forEach(sheet => {
        expect(sheet.title).toBeTruthy();
        expect(Array.isArray(sheet.headers)).toBe(true);
        expect(sheet.headers.length).toBeGreaterThan(0);
      });
    });
  });

  describe('CONTROL_EGRESOS_SHEETS', () => {
    it('has 3 sheet configurations', () => {
      expect(CONTROL_EGRESOS_SHEETS).toHaveLength(3);
    });

    it('contains Facturas Recibidas sheet with correct headers', () => {
      const sheet = CONTROL_EGRESOS_SHEETS.find(s => s.title === 'Facturas Recibidas');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(FACTURA_RECIBIDA_HEADERS);
    });

    it('contains Pagos Enviados sheet with correct headers', () => {
      const sheet = CONTROL_EGRESOS_SHEETS.find(s => s.title === 'Pagos Enviados');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(PAGO_ENVIADO_HEADERS);
    });

    it('contains Recibos sheet', () => {
      const sheet = CONTROL_EGRESOS_SHEETS.find(s => s.title === 'Recibos');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toBe(RECIBO_HEADERS);
    });

    it('all sheet configs have title and headers', () => {
      CONTROL_EGRESOS_SHEETS.forEach(sheet => {
        expect(sheet.title).toBeTruthy();
        expect(Array.isArray(sheet.headers)).toBe(true);
        expect(sheet.headers.length).toBeGreaterThan(0);
      });
    });
  });

  describe('PAGOS_PENDIENTES_HEADERS', () => {
    it('has 10 headers', () => {
      expect(PAGOS_PENDIENTES_HEADERS).toHaveLength(10);
    });

    it('starts with fechaEmision', () => {
      expect(PAGOS_PENDIENTES_HEADERS[0]).toBe('fechaEmision');
    });

    it('contains required fields for tracking unpaid invoices', () => {
      expect(PAGOS_PENDIENTES_HEADERS).toContain('fileId');
      expect(PAGOS_PENDIENTES_HEADERS).toContain('fileName');
      expect(PAGOS_PENDIENTES_HEADERS).toContain('tipoComprobante');
      expect(PAGOS_PENDIENTES_HEADERS).toContain('nroFactura');
      expect(PAGOS_PENDIENTES_HEADERS).toContain('cuitEmisor');
      expect(PAGOS_PENDIENTES_HEADERS).toContain('razonSocialEmisor');
      expect(PAGOS_PENDIENTES_HEADERS).toContain('importeTotal');
      expect(PAGOS_PENDIENTES_HEADERS).toContain('moneda');
      expect(PAGOS_PENDIENTES_HEADERS).toContain('concepto');
    });

    it('ends with concepto', () => {
      expect(PAGOS_PENDIENTES_HEADERS[PAGOS_PENDIENTES_HEADERS.length - 1]).toBe('concepto');
    });

    it('does not contain internal tracking fields', () => {
      expect(PAGOS_PENDIENTES_HEADERS).not.toContain('processedAt');
      expect(PAGOS_PENDIENTES_HEADERS).not.toContain('confidence');
      expect(PAGOS_PENDIENTES_HEADERS).not.toContain('needsReview');
      expect(PAGOS_PENDIENTES_HEADERS).not.toContain('matchedPagoFileId');
      expect(PAGOS_PENDIENTES_HEADERS).not.toContain('pagada');
    });
  });

  describe('DASHBOARD_OPERATIVO_SHEETS', () => {
    it('has 4 sheet configurations', () => {
      expect(DASHBOARD_OPERATIVO_SHEETS).toHaveLength(4);
    });

    it('contains Status sheet', () => {
      const sheet = DASHBOARD_OPERATIVO_SHEETS.find(s => s.title === 'Status');
      expect(sheet).toBeDefined();
      expect(sheet?.headers).toEqual(['Metrica', 'Valor']);
    });

    it('has Pagos Pendientes as the first sheet', () => {
      expect(DASHBOARD_OPERATIVO_SHEETS[0].title).toBe('Pagos Pendientes');
      expect(DASHBOARD_OPERATIVO_SHEETS[0].headers).toBe(PAGOS_PENDIENTES_HEADERS);
    });

    it('contains Resumen Mensual sheet', () => {
      const sheet = DASHBOARD_OPERATIVO_SHEETS.find(s => s.title === 'Resumen Mensual');
      expect(sheet).toBeDefined();
    });

    it('contains Uso de API sheet', () => {
      const sheet = DASHBOARD_OPERATIVO_SHEETS.find(s => s.title === 'Uso de API');
      expect(sheet).toBeDefined();
    });

    it('Pagos Pendientes has correct monetary columns', () => {
      const sheet = DASHBOARD_OPERATIVO_SHEETS[0];
      expect(sheet.monetaryColumns).toEqual([7]); // importeTotal
    });

    it('Resumen Mensual has correct number formats', () => {
      const sheet = DASHBOARD_OPERATIVO_SHEETS.find(s => s.title === 'Resumen Mensual');
      expect(sheet).toBeDefined();
      expect(sheet?.numberFormats).toBeDefined();

      // Check thousand separator formats (no decimals)
      expect(sheet?.numberFormats?.get(1)).toEqual({ type: 'number', decimals: 0 }); // totalLlamadas
      expect(sheet?.numberFormats?.get(2)).toEqual({ type: 'number', decimals: 0 }); // tokensEntrada
      expect(sheet?.numberFormats?.get(3)).toEqual({ type: 'number', decimals: 0 }); // tokensCache
      expect(sheet?.numberFormats?.get(4)).toEqual({ type: 'number', decimals: 0 }); // tokensSalida

      // Check 2 decimal formats
      expect(sheet?.numberFormats?.get(5)).toEqual({ type: 'currency', decimals: 2 }); // costoTotalUSD
      expect(sheet?.numberFormats?.get(6)).toEqual({ type: 'number', decimals: 2 }); // tasaExito
      expect(sheet?.numberFormats?.get(7)).toEqual({ type: 'number', decimals: 2 }); // duracionPromedio
    });

    it('Uso de API has correct number formats for cost columns', () => {
      const sheet = DASHBOARD_OPERATIVO_SHEETS.find(s => s.title === 'Uso de API');
      expect(sheet).toBeDefined();
      expect(sheet?.numberFormats).toBeDefined();

      // Check 8 decimal formats for all cost columns
      expect(sheet?.numberFormats?.get(8)).toEqual({ type: 'currency', decimals: 8 }); // promptCostPerToken
      expect(sheet?.numberFormats?.get(9)).toEqual({ type: 'currency', decimals: 8 }); // cachedCostPerToken
      expect(sheet?.numberFormats?.get(10)).toEqual({ type: 'currency', decimals: 8 }); // outputCostPerToken
      expect(sheet?.numberFormats?.get(11)).toEqual({ type: 'currency', decimals: 8 }); // estimatedCostUSD
    });

    it('all sheet configs have title and headers', () => {
      DASHBOARD_OPERATIVO_SHEETS.forEach(sheet => {
        expect(sheet.title).toBeTruthy();
        expect(Array.isArray(sheet.headers)).toBe(true);
        expect(sheet.headers.length).toBeGreaterThan(0);
      });
    });
  });
});
