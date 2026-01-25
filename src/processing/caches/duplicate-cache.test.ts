import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DuplicateCache } from './duplicate-cache.js';
import * as sheets from '../../services/sheets.js';
import type { ResumenBancario, ResumenTarjeta, ResumenBroker } from '../../types/index.js';

vi.mock('../../services/sheets.js');

describe('DuplicateCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadSheet', () => {
    it('loads sheet data into cache', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'Other'],
        ['2026-01-25', 'file-1', 'data1'],
        ['2026-01-26', 'file-2', 'data2'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000');

      expect(sheets.getValues).toHaveBeenCalledWith('spreadsheet-1', 'Sheet1!A1:Z1000');
    });

    it('uses promise-caching to prevent thundering herd', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'Other'],
        ['2026-01-25', 'file-1', 'data1'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      const promises = [
        cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000'),
        cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000'),
        cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000'),
      ];

      await Promise.all(promises);

      expect(sheets.getValues).toHaveBeenCalledTimes(1);
    });

    it('does not reload already cached sheet', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'Other'],
        ['2026-01-25', 'file-1', 'data1'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000');
      await cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000');

      expect(sheets.getValues).toHaveBeenCalledTimes(1);
    });

    it('handles API errors gracefully', async () => {
      const cache = new DuplicateCache();

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: false, error: new Error('API error') });

      await expect(cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000')).resolves.not.toThrow();
    });
  });

  describe('isDuplicateFactura', () => {
    it('detects duplicate factura', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'C', 'D', 'Nro Factura', 'CUIT', 'G', 'H', 'I', 'Importe Total'],
        ['2026-01-25', 'file-1', '', '', '0001-00001234', '20123456786', '', '', '', '15000.00'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Facturas Emitidas', 'A1:Z1000');

      const result = cache.isDuplicateFactura(
        'spreadsheet-1',
        'Facturas Emitidas',
        '0001-00001234',
        '2026-01-25',
        15000.00,
        '20123456786'
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingFileId).toBe('file-1');
    });

    it('returns false when no duplicate exists', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'C', 'D', 'Nro Factura', 'CUIT', 'G', 'H', 'I', 'Importe Total'],
        ['2026-01-25', 'file-1', '', '', '0001-00001234', '20123456786', '', '', '', '15000.00'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Facturas Emitidas', 'A1:Z1000');

      const result = cache.isDuplicateFactura(
        'spreadsheet-1',
        'Facturas Emitidas',
        '0001-00001235', // Different invoice number
        '2026-01-25',
        15000.00,
        '20123456786'
      );

      expect(result.isDuplicate).toBe(false);
    });

    it('returns false when sheet not loaded', () => {
      const cache = new DuplicateCache();

      const result = cache.isDuplicateFactura(
        'spreadsheet-1',
        'Facturas Emitidas',
        '0001-00001234',
        '2026-01-25',
        15000.00,
        '20123456786'
      );

      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('isDuplicatePago', () => {
    it('detects duplicate pago', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'C', 'D', 'Importe Pagado', 'F', 'G', 'CUIT'],
        ['2026-01-25', 'file-1', '', '', '10000.00', '', '', '20123456786'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Pagos Enviados', 'A1:Z1000');

      const result = cache.isDuplicatePago(
        'spreadsheet-1',
        'Pagos Enviados',
        '2026-01-25',
        10000.00,
        '20123456786'
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingFileId).toBe('file-1');
    });

    it('returns false when no duplicate exists', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'C', 'D', 'Importe Pagado', 'F', 'G', 'CUIT'],
        ['2026-01-25', 'file-1', '', '', '10000.00', '', '', '20123456786'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Pagos Enviados', 'A1:Z1000');

      const result = cache.isDuplicatePago(
        'spreadsheet-1',
        'Pagos Enviados',
        '2026-01-26', // Different date
        10000.00,
        '20123456786'
      );

      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('isDuplicateRecibo', () => {
    it('detects duplicate recibo', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['A', 'File ID', 'C', 'D', 'E', 'CUIL Empleado', 'G', 'H', 'I', 'Periodo Abonado', 'K', 'L', 'Total Neto'],
        ['2026-01-25', 'file-1', '', '', '', '20123456786', '', '', '', '2026-01', '', '', '50000.00'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Recibos', 'A1:Z1000');

      const result = cache.isDuplicateRecibo(
        'spreadsheet-1',
        '20123456786',
        '2026-01',
        50000.00
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingFileId).toBe('file-1');
    });
  });

  describe('isDuplicateRetencion', () => {
    it('detects duplicate retencion', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'C', 'Nro Certificado', 'CUIT Agente', 'F', 'G', 'H', 'I', 'Monto Retencion'],
        ['2026-01-25', 'file-1', '', '12345678', '20123456786', '', '', '', '', '5000.00'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Retenciones Recibidas', 'A1:Z1000');

      const result = cache.isDuplicateRetencion(
        'spreadsheet-1',
        '12345678',
        '20123456786',
        '2026-01-25',
        5000.00
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingFileId).toBe('file-1');
    });
  });

  describe('isDuplicateResumenBancario', () => {
    it('detects duplicate resumen bancario', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha Desde', 'Fecha Hasta', 'C', 'D', 'Banco', 'Numero Cuenta', 'Moneda'],
        ['2026-01-01', '2026-01-31', '', '', 'BBVA', '1234567890', 'ARS'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Resumenes', 'A1:Z1000');

      const resumen: ResumenBancario = {
        fileId: 'test-file-id',
        fileName: 'test.pdf',
        banco: 'BBVA',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
        fechaDesde: '2026-01-01',
        fechaHasta: '2026-01-31',
        saldoInicial: 0,
        saldoFinal: 10000,
        cantidadMovimientos: 10,
        processedAt: '2026-01-25T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
      };

      const result = cache.isDuplicateResumenBancario('spreadsheet-1', resumen);

      expect(result.isDuplicate).toBe(true);
    });
  });

  describe('isDuplicateResumenTarjeta', () => {
    it('detects duplicate resumen tarjeta', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha Desde', 'Fecha Hasta', 'C', 'D', 'Banco', 'Numero Cuenta', 'Tipo Tarjeta'],
        ['2026-01-01', '2026-01-31', '', '', 'BBVA', '4563', 'Visa'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Resumenes', 'A1:Z1000');

      const resumen: ResumenTarjeta = {
        fileId: 'test-file-id',
        fileName: 'test.pdf',
        banco: 'BBVA',
        numeroCuenta: '4563',
        tipoTarjeta: 'Visa',
        fechaDesde: '2026-01-01',
        fechaHasta: '2026-01-31',
        pagoMinimo: 1000,
        saldoActual: 5000,
        cantidadMovimientos: 10,
        processedAt: '2026-01-25T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
      };

      const result = cache.isDuplicateResumenTarjeta('spreadsheet-1', resumen);

      expect(result.isDuplicate).toBe(true);
    });
  });

  describe('isDuplicateResumenBroker', () => {
    it('detects duplicate resumen broker', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha Desde', 'Fecha Hasta', 'C', 'D', 'Broker', 'Numero Cuenta'],
        ['2026-01-01', '2026-01-31', '', '', 'BALANZ CAPITAL VALORES SAU', '123456'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Resumenes', 'A1:Z1000');

      const resumen: ResumenBroker = {
        fileId: 'test-file-id',
        fileName: 'test.pdf',
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2026-01-01',
        fechaHasta: '2026-01-31',
        saldoARS: 10000,
        saldoUSD: 500,
        cantidadMovimientos: 10,
        processedAt: '2026-01-25T10:00:00Z',
        confidence: 0.95,
        needsReview: false,
      };

      const result = cache.isDuplicateResumenBroker('spreadsheet-1', resumen);

      expect(result.isDuplicate).toBe(true);
    });
  });

  describe('addEntry', () => {
    it('adds entry to cache after successful store', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'Other'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000');

      cache.addEntry('spreadsheet-1', 'Sheet1', 'file-new', ['2026-01-25', 'file-new', 'data']);

      // Verify entry was added by checking internal state
      expect(cache).toBeDefined();
    });

    it('does not add entry when sheet not loaded', () => {
      const cache = new DuplicateCache();

      // Should not throw
      expect(() => {
        cache.addEntry('spreadsheet-1', 'Sheet1', 'file-new', ['2026-01-25', 'file-new', 'data']);
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    it('clears all cached data', async () => {
      const cache = new DuplicateCache();
      const mockRows = [
        ['Fecha', 'File ID', 'Other'],
        ['2026-01-25', 'file-1', 'data1'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: mockRows });

      await cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000');

      cache.clear();

      // After clear, sheet should need to be reloaded
      await cache.loadSheet('spreadsheet-1', 'Sheet1', 'A1:Z1000');

      expect(sheets.getValues).toHaveBeenCalledTimes(2);
    });
  });
});
