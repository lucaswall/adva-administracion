/**
 * Tests for spreadsheet headers constants and buildHeaderIndex helper (ADV-332)
 */

import { describe, it, expect } from 'vitest';
import {
  buildHeaderIndex,
  STATUS_HEADERS,
  STATUS_SHEET,
  DASHBOARD_OPERATIVO_SHEETS,
  ARCHIVOS_PROCESADOS_SHEET,
  ARCHIVOS_PROCESADOS_HEADERS,
  CONTROL_RESUMENES_BANCARIO_SHEET,
  CONTROL_RESUMENES_TARJETA_SHEET,
  CONTROL_RESUMENES_BROKER_SHEET,
  MOVIMIENTOS_BANCARIO_SHEET,
  FACTURA_EMITIDA_HEADERS,
  FACTURA_RECIBIDA_HEADERS,
  PAGO_ENVIADO_HEADERS,
  PAGO_RECIBIDO_HEADERS,
  RECIBO_HEADERS,
  RETENCIONES_RECIBIDAS_HEADERS,
} from './spreadsheet-headers.js';

describe('buildHeaderIndex (ADV-332)', () => {
  it('returns correct index for known header in FACTURA_RECIBIDA_HEADERS', () => {
    const col = buildHeaderIndex(FACTURA_RECIBIDA_HEADERS);
    expect(col('fechaEmision')).toBe(0);
    expect(col('fileId')).toBe(1);
    expect(col('importeTotal')).toBe(9);
    expect(col('matchConfidence')).toBe(16);
    expect(col('pagada')).toBe(18);
  });

  it('returns correct indices for FACTURA_EMITIDA_HEADERS (condicionIVAReceptor at 7)', () => {
    const col = buildHeaderIndex(FACTURA_EMITIDA_HEADERS);
    expect(col('condicionIVAReceptor')).toBe(7);
    expect(col('importeNeto')).toBe(8);
    expect(col('importeIva')).toBe(9);
    expect(col('importeTotal')).toBe(10);
    expect(col('matchConfidence')).toBe(17);
    expect(col('pagada')).toBe(19);
    expect(col('tipoDeCambio')).toBe(20);
  });

  it('throws for unknown header name (drift guard)', () => {
    const col = buildHeaderIndex(FACTURA_RECIBIDA_HEADERS);
    expect(() => col('nonExistentColumn')).toThrow('nonExistentColumn');
  });

  it('throws descriptive error including the unknown header name', () => {
    const col = buildHeaderIndex(RECIBO_HEADERS);
    expect(() => col('cuitReceptor')).toThrow(/cuitReceptor/);
  });

  it('inserting extra column mid-array adjusts subsequent indices (proves hardcoded indices break)', () => {
    // Simulate schema drift: synthetic column inserted at position 7
    const base = [...FACTURA_RECIBIDA_HEADERS];
    const modified = [...base.slice(0, 7), 'syntheticExtra', ...base.slice(7)];
    const col = buildHeaderIndex(modified);

    // importeNeto was at index 7 in base → now at 8 in modified
    expect(col('importeNeto')).toBe(8);
    // importeTotal was at index 9 in base → now at 10 in modified
    expect(col('importeTotal')).toBe(10);

    // Proof that hardcoded 9 points to WRONG field after drift:
    expect(modified[9]).toBe('importeIva');   // NOT importeTotal
    // The derived index correctly gives 10:
    expect(modified[col('importeTotal')]).toBe('importeTotal');
  });

  it('returns correct indices for PAGO_ENVIADO_HEADERS', () => {
    const col = buildHeaderIndex(PAGO_ENVIADO_HEADERS);
    expect(col('fechaPago')).toBe(0);
    expect(col('importePagado')).toBe(4);
    expect(col('moneda')).toBe(5);
    expect(col('cuitBeneficiario')).toBe(7);
    expect(col('matchedFacturaFileId')).toBe(13);
    expect(col('matchConfidence')).toBe(14);
  });

  it('returns correct indices for PAGO_RECIBIDO_HEADERS', () => {
    const col = buildHeaderIndex(PAGO_RECIBIDO_HEADERS);
    expect(col('cuitPagador')).toBe(7);
    expect(col('nombrePagador')).toBe(8);
    expect(col('matchConfidence')).toBe(14);
  });

  it('returns correct indices for RECIBO_HEADERS', () => {
    const col = buildHeaderIndex(RECIBO_HEADERS);
    expect(col('fechaPago')).toBe(0);
    expect(col('cuilEmpleado')).toBe(5);
    expect(col('matchedPagoFileId')).toBe(16);
    expect(col('matchConfidence')).toBe(17);
    expect(col('hasCuitMatch')).toBe(18);
  });

  it('returns correct indices for RETENCIONES_RECIBIDAS_HEADERS', () => {
    const col = buildHeaderIndex(RETENCIONES_RECIBIDAS_HEADERS);
    expect(col('fechaEmision')).toBe(0);
    expect(col('cuitAgenteRetencion')).toBe(4);
    expect(col('montoComprobante')).toBe(8);
    expect(col('matchedFacturaFileId')).toBe(13);
    expect(col('matchConfidence')).toBe(14);
  });

  it('returns correct indices for MOVIMIENTOS_BANCARIO_SHEET headers', () => {
    const col = buildHeaderIndex(MOVIMIENTOS_BANCARIO_SHEET.headers);
    expect(col('fecha')).toBe(0);
    expect(col('concepto')).toBe(1);
    expect(col('debito')).toBe(2);
    expect(col('credito')).toBe(3);
    expect(col('matchedFileId')).toBe(6);
    expect(col('matchedType')).toBe(7);
    expect(col('detalle')).toBe(8);
  });

  it('built index function is reusable across multiple calls', () => {
    const col = buildHeaderIndex(FACTURA_EMITIDA_HEADERS);
    expect(col('importeTotal')).toBe(10);
    expect(col('importeTotal')).toBe(10); // second call returns same result
  });
});

describe('tipoDeCambio headers', () => {
  it('FACTURA_EMITIDA_HEADERS has 21 elements, condicionIVAReceptor at index 7, pagada at index 19, tipoDeCambio at index 20 (ADV-245)', () => {
    expect(FACTURA_EMITIDA_HEADERS).toHaveLength(21);
    expect(FACTURA_EMITIDA_HEADERS[7]).toBe('condicionIVAReceptor');
    expect(FACTURA_EMITIDA_HEADERS[19]).toBe('pagada');
    expect(FACTURA_EMITIDA_HEADERS[20]).toBe('tipoDeCambio');
  });

  it('FACTURA_RECIBIDA_HEADERS has 20 elements, last is tipoDeCambio', () => {
    expect(FACTURA_RECIBIDA_HEADERS).toHaveLength(20);
    expect(FACTURA_RECIBIDA_HEADERS[19]).toBe('tipoDeCambio');
  });

  it('PAGO_ENVIADO_HEADERS has 17 elements, last two are tipoDeCambio and importeEnPesos', () => {
    expect(PAGO_ENVIADO_HEADERS).toHaveLength(17);
    expect(PAGO_ENVIADO_HEADERS[15]).toBe('tipoDeCambio');
    expect(PAGO_ENVIADO_HEADERS[16]).toBe('importeEnPesos');
  });

  it('PAGO_RECIBIDO_HEADERS has 17 elements, last two are tipoDeCambio and importeEnPesos', () => {
    expect(PAGO_RECIBIDO_HEADERS).toHaveLength(17);
    expect(PAGO_RECIBIDO_HEADERS[15]).toBe('tipoDeCambio');
    expect(PAGO_RECIBIDO_HEADERS[16]).toBe('importeEnPesos');
  });
});

describe('Status Sheet Headers', () => {
  describe('STATUS_HEADERS', () => {
    it('should have Metrica and Valor columns', () => {
      expect(STATUS_HEADERS).toEqual(['Metrica', 'Valor']);
    });

    it('should have exactly 2 headers', () => {
      expect(STATUS_HEADERS).toHaveLength(2);
    });
  });

  describe('STATUS_SHEET', () => {
    it('should have correct title', () => {
      expect(STATUS_SHEET.title).toBe('Status');
    });

    it('should have STATUS_HEADERS as headers', () => {
      expect(STATUS_SHEET.headers).toEqual(STATUS_HEADERS);
    });
  });

  describe('DASHBOARD_OPERATIVO_SHEETS', () => {
    it('should include Status sheet', () => {
      const statusSheet = DASHBOARD_OPERATIVO_SHEETS.find(
        s => s.title === 'Status'
      );
      expect(statusSheet).toBeDefined();
      expect(statusSheet?.headers).toEqual(['Metrica', 'Valor']);
    });

    it('should include Archivos Procesados sheet', () => {
      const archivosSheet = DASHBOARD_OPERATIVO_SHEETS.find(
        s => s.title === 'Archivos Procesados'
      );
      expect(archivosSheet).toBeDefined();
    });
  });
});

describe('Archivos Procesados Sheet Headers', () => {
  describe('ARCHIVOS_PROCESADOS_HEADERS', () => {
    it('should have fileId, fileName, processedAt, documentType, status, and originalFileId columns', () => {
      expect(ARCHIVOS_PROCESADOS_HEADERS).toEqual([
        'fileId',
        'fileName',
        'processedAt',
        'documentType',
        'status',
        'originalFileId',
      ]);
    });

    it('should have exactly 6 headers', () => {
      expect(ARCHIVOS_PROCESADOS_HEADERS).toHaveLength(6);
    });
  });

  describe('ARCHIVOS_PROCESADOS_SHEET', () => {
    it('should have correct title', () => {
      expect(ARCHIVOS_PROCESADOS_SHEET.title).toBe('Archivos Procesados');
    });

    it('should have ARCHIVOS_PROCESADOS_HEADERS as headers', () => {
      expect(ARCHIVOS_PROCESADOS_SHEET.headers).toEqual(ARCHIVOS_PROCESADOS_HEADERS);
    });

    it('should have processedAt column formatted as date', () => {
      expect(ARCHIVOS_PROCESADOS_SHEET.numberFormats?.get(2)).toEqual({ type: 'date' });
    });
  });
});

describe('Control Resumenes Bancario Sheet', () => {
  describe('CONTROL_RESUMENES_BANCARIO_SHEET', () => {
    it('should have periodo as first header', () => {
      expect(CONTROL_RESUMENES_BANCARIO_SHEET.headers[0]).toBe('periodo');
    });

    it('should have 12 columns total (A:L)', () => {
      expect(CONTROL_RESUMENES_BANCARIO_SHEET.headers).toHaveLength(12);
    });

    it('should have correct header order', () => {
      expect(CONTROL_RESUMENES_BANCARIO_SHEET.headers).toEqual([
        'periodo',
        'fechaDesde',
        'fechaHasta',
        'fileId',
        'fileName',
        'banco',
        'numeroCuenta',
        'moneda',
        'saldoInicial',
        'saldoFinal',
        'balanceOk',
        'balanceDiff',
      ]);
    });

    it('should have balanceOk as column K (index 10)', () => {
      expect(CONTROL_RESUMENES_BANCARIO_SHEET.headers[10]).toBe('balanceOk');
    });

    it('should have balanceDiff as column L (index 11)', () => {
      expect(CONTROL_RESUMENES_BANCARIO_SHEET.headers[11]).toBe('balanceDiff');
    });

    it('should have correctly shifted numberFormats indices', () => {
      const formats = CONTROL_RESUMENES_BANCARIO_SHEET.numberFormats;
      expect(formats).toBeDefined();
      if (formats) {
        // fechaDesde should now be at index 1 (was 0)
        expect(formats.get(1)).toEqual({ type: 'date' });
        // fechaHasta should now be at index 2 (was 1)
        expect(formats.get(2)).toEqual({ type: 'date' });
        // saldoInicial should now be at index 8 (was 7)
        expect(formats.get(8)).toEqual({ type: 'currency', decimals: 2 });
        // saldoFinal should now be at index 9 (was 8)
        expect(formats.get(9)).toEqual({ type: 'currency', decimals: 2 });
        // balanceDiff should be at index 11 with currency format
        expect(formats.get(11)).toEqual({ type: 'currency', decimals: 2 });
      }
    });
  });
});

describe('Control Resumenes Tarjeta Sheet', () => {
  describe('CONTROL_RESUMENES_TARJETA_SHEET', () => {
    it('should have periodo as first header', () => {
      expect(CONTROL_RESUMENES_TARJETA_SHEET.headers[0]).toBe('periodo');
    });

    it('should have 10 columns total', () => {
      expect(CONTROL_RESUMENES_TARJETA_SHEET.headers).toHaveLength(10);
    });

    it('should have correct header order', () => {
      expect(CONTROL_RESUMENES_TARJETA_SHEET.headers).toEqual([
        'periodo',
        'fechaDesde',
        'fechaHasta',
        'fileId',
        'fileName',
        'banco',
        'numeroCuenta',
        'tipoTarjeta',
        'pagoMinimo',
        'saldoActual',
      ]);
    });

    it('should have correctly shifted numberFormats indices', () => {
      const formats = CONTROL_RESUMENES_TARJETA_SHEET.numberFormats;
      expect(formats).toBeDefined();
      if (formats) {
        // fechaDesde should now be at index 1 (was 0)
        expect(formats.get(1)).toEqual({ type: 'date' });
        // fechaHasta should now be at index 2 (was 1)
        expect(formats.get(2)).toEqual({ type: 'date' });
        // pagoMinimo should now be at index 8 (was 7)
        expect(formats.get(8)).toEqual({ type: 'currency', decimals: 2 });
        // saldoActual should now be at index 9 (was 8)
        expect(formats.get(9)).toEqual({ type: 'currency', decimals: 2 });
      }
    });
  });
});

describe('Control Resumenes Broker Sheet', () => {
  describe('CONTROL_RESUMENES_BROKER_SHEET', () => {
    it('should have periodo as first header', () => {
      expect(CONTROL_RESUMENES_BROKER_SHEET.headers[0]).toBe('periodo');
    });

    it('should have 9 columns total', () => {
      expect(CONTROL_RESUMENES_BROKER_SHEET.headers).toHaveLength(9);
    });

    it('should have correct header order', () => {
      expect(CONTROL_RESUMENES_BROKER_SHEET.headers).toEqual([
        'periodo',
        'fechaDesde',
        'fechaHasta',
        'fileId',
        'fileName',
        'broker',
        'numeroCuenta',
        'saldoARS',
        'saldoUSD',
      ]);
    });

    it('should have correctly shifted numberFormats indices', () => {
      const formats = CONTROL_RESUMENES_BROKER_SHEET.numberFormats;
      expect(formats).toBeDefined();
      if (formats) {
        // fechaDesde should now be at index 1 (was 0)
        expect(formats.get(1)).toEqual({ type: 'date' });
        // fechaHasta should now be at index 2 (was 1)
        expect(formats.get(2)).toEqual({ type: 'date' });
        // saldoARS should now be at index 7 (was 6)
        expect(formats.get(7)).toEqual({ type: 'currency', decimals: 2 });
        // saldoUSD should now be at index 8 (was 7)
        expect(formats.get(8)).toEqual({ type: 'currency', decimals: 2 });
      }
    });
  });
});

describe('Movimientos Bancario Sheet', () => {
  describe('MOVIMIENTOS_BANCARIO_SHEET', () => {
    it('should have 9 columns total (A:I)', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers).toHaveLength(9);
    });

    it('should have correct header order', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers).toEqual([
        'fecha',
        'concepto',
        'debito',
        'credito',
        'saldo',
        'saldoCalculado',
        'matchedFileId',
        'matchedType',
        'detalle',
      ]);
    });

    it('should have matchedFileId as column G (index 6)', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers[6]).toBe('matchedFileId');
    });

    it('should have matchedType as column H (index 7)', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers[7]).toBe('matchedType');
    });

    it('should have detalle as column I (index 8)', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers[8]).toBe('detalle');
    });

    it('should have saldoCalculado as column F (index 5)', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers[5]).toBe('saldoCalculado');
    });

    it('should have numberFormats for saldoCalculado at index 5', () => {
      const formats = MOVIMIENTOS_BANCARIO_SHEET.numberFormats;
      expect(formats).toBeDefined();
      if (formats) {
        expect(formats.get(5)).toEqual({ type: 'currency', decimals: 2 });
      }
    });
  });
});
