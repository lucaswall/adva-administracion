/**
 * Tests for factura storage operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeFactura } from './factura-store.js';
import type { Factura } from '../../types/index.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  appendRowsWithLinks: vi.fn(),
  sortSheet: vi.fn(),
  getValues: vi.fn(),
  getSpreadsheetTimezone: vi.fn(() => Promise.resolve({ ok: true, value: 'America/Argentina/Buenos_Aires' })),
}));

vi.mock('../../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../utils/correlation.js', () => ({
  getCorrelationId: () => 'test-correlation-id',
}));

import { appendRowsWithLinks, sortSheet, getValues } from '../../services/sheets.js';

const createTestFactura = (overrides: Partial<Factura> = {}): Factura => ({
  fileId: 'test-file-id',
  fileName: 'test-factura.pdf',
  tipoComprobante: 'A',
  nroFactura: '0001-00001234',
  fechaEmision: '2025-01-15',
  cuitEmisor: '20123456786',
  razonSocialEmisor: 'TEST SA',
  cuitReceptor: '30709076783',
  razonSocialReceptor: 'ADVA SRL',
  importeNeto: 1000,
  importeIva: 210,
  importeTotal: 1210,
  moneda: 'ARS',
  concepto: 'Test services',
  processedAt: '2025-01-15T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

// Mock concurrency module
vi.mock('../../utils/concurrency.js', async (importOriginal) => {
  const actual = await importOriginal() as object;
  return {
    ...actual,
    withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => {
      try {
        const result = await fn();
        return { ok: true, value: result };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
      }
    }),
  };
});

import { withLock } from '../../utils/concurrency.js';

describe('storeFactura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('StoreResult return type', () => {
    it('returns { stored: true } when factura is successfully stored', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.existingFileId).toBeUndefined();
      }
    });

    it('returns { stored: false, existingFileId } when duplicate is detected', async () => {
      const existingFileId = 'existing-file-id';
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['Header', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', existingFileId, 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', '1,210.00'],
        ],
      });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
    });

    it('returns error when appendRowsWithLinks fails', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({
        ok: false,
        error: new Error('API error'),
      });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('API error');
      }
    });
  });

  describe('duplicate detection', () => {
    it('detects duplicate when all criteria match', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', '1,210.00'],
        ],
      });

      const factura = createTestFactura({
        nroFactura: '0001-00001234',
        fechaEmision: '2025-01-15',
        importeTotal: 1210,
        cuitReceptor: '30709076783',
      });

      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('does not detect duplicate when nroFactura differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '0001-00009999', '30709076783', 'etc', 'etc', 'etc', '1,210.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({
        nroFactura: '0001-00001234',
        fechaEmision: '2025-01-15',
        importeTotal: 1210,
        cuitReceptor: '30709076783',
      });

      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when date differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-10', 'existing-id', 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', '1,210.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({
        nroFactura: '0001-00001234',
        fechaEmision: '2025-01-15',
        importeTotal: 1210,
        cuitReceptor: '30709076783',
      });

      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when amount differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', '2,000.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({
        nroFactura: '0001-00001234',
        fechaEmision: '2025-01-15',
        importeTotal: 1210,
        cuitReceptor: '30709076783',
      });

      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when CUIT differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '0001-00001234', '27234567891', 'etc', 'etc', 'etc', '1,210.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({
        nroFactura: '0001-00001234',
        fechaEmision: '2025-01-15',
        importeTotal: 1210,
        cuitReceptor: '30709076783',
      });

      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });
  });

  describe('factura recibida vs emitida', () => {
    it('uses cuitReceptor for factura_emitida duplicate check', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', '1,210.00'],
        ],
      });

      const factura = createTestFactura({
        nroFactura: '0001-00001234',
        fechaEmision: '2025-01-15',
        importeTotal: 1210,
        cuitReceptor: '30709076783', // This should be checked for factura_emitida
        cuitEmisor: '20123456786',
      });

      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false); // Should detect duplicate
      }
    });

    it('uses cuitEmisor for factura_recibida duplicate check', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '0001-00001234', '20123456786', 'etc', 'etc', 'etc', '1,210.00'],
        ],
      });

      const factura = createTestFactura({
        nroFactura: '0001-00001234',
        fechaEmision: '2025-01-15',
        importeTotal: 1210,
        cuitReceptor: '30709076783',
        cuitEmisor: '20123456786', // This should be checked for factura_recibida
      });

      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Recibidas', 'factura_recibida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false); // Should detect duplicate
      }
    });
  });

  describe('TOCTOU race condition protection', () => {
    it('uses locking to prevent concurrent stores of identical factura', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 18 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      // Verify withLock was called with appropriate lock key
      expect(vi.mocked(withLock)).toHaveBeenCalledWith(
        expect.stringContaining('store:factura:0001-00001234:2025-01-15:1210:30709076783'),
        expect.any(Function),
        10000
      );
    });

    it('returns error on lock timeout', async () => {
      // Mock withLock to return timeout error
      vi.mocked(withLock).mockResolvedValueOnce({
        ok: false,
        error: new Error('Failed to acquire lock within 10000ms'),
      });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to acquire lock');
      }
    });
  });
});
