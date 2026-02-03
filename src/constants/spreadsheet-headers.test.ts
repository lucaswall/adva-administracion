/**
 * Tests for spreadsheet headers constants
 */

import { describe, it, expect } from 'vitest';
import {
  STATUS_HEADERS,
  STATUS_SHEET,
  DASHBOARD_OPERATIVO_SHEETS,
  ARCHIVOS_PROCESADOS_SHEET,
  ARCHIVOS_PROCESADOS_HEADERS,
  CONTROL_RESUMENES_BANCARIO_SHEET,
  CONTROL_RESUMENES_TARJETA_SHEET,
  CONTROL_RESUMENES_BROKER_SHEET,
  MOVIMIENTOS_BANCARIO_SHEET,
} from './spreadsheet-headers.js';

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
    it('should have fileId, fileName, processedAt, documentType, and status columns', () => {
      expect(ARCHIVOS_PROCESADOS_HEADERS).toEqual([
        'fileId',
        'fileName',
        'processedAt',
        'documentType',
        'status',
      ]);
    });

    it('should have exactly 5 headers', () => {
      expect(ARCHIVOS_PROCESADOS_HEADERS).toHaveLength(5);
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
    it('should have 8 columns total (A:H)', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers).toHaveLength(8);
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
        'detalle',
      ]);
    });

    it('should have matchedFileId as column G (index 6)', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers[6]).toBe('matchedFileId');
    });

    it('should have detalle as column H (index 7)', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers[7]).toBe('detalle');
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
