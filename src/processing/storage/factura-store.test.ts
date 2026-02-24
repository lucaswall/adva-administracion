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
  batchUpdate: vi.fn(),
  updateRowsWithFormatting: vi.fn(),
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

vi.mock('../../utils/spreadsheet.js', () => ({
  createDriveHyperlink: vi.fn((fileId: string, displayText: string) =>
    `=HYPERLINK("https://drive.google.com/file/d/${fileId}/view", "${displayText}")`
  ),
}));

vi.mock('../../services/status-sheet.js', () => ({
  formatTimestampInTimezone: vi.fn((date: Date, _timeZone: string) => {
    // Simulate Argentina timezone (UTC-3) formatting
    const offset = -3 * 60 * 60 * 1000;
    const local = new Date(date.getTime() + offset);
    const y = local.getUTCFullYear();
    const m = String(local.getUTCMonth() + 1).padStart(2, '0');
    const d = String(local.getUTCDate()).padStart(2, '0');
    const h = String(local.getUTCHours()).padStart(2, '0');
    const min = String(local.getUTCMinutes()).padStart(2, '0');
    const s = String(local.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }),
}));

import { appendRowsWithLinks, sortSheet, getValues, batchUpdate, updateRowsWithFormatting } from '../../services/sheets.js';

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

  describe('tipoDeCambio column', () => {
    it('USD factura_emitida with tipoDeCambio stores CellNumber at index 18', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'USD', tipoDeCambio: 1429.5 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0]; // first row
      expect(row[18]).toEqual({ type: 'number', value: 1429.5 });
    });

    it('ARS factura_emitida without tipoDeCambio stores empty string at index 18', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'ARS' });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[18]).toBe('');
    });

    it('USD factura_recibida with tipoDeCambio stores CellNumber at index 19', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'USD', tipoDeCambio: 1429.5 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Recibidas', 'factura_recibida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[19]).toEqual({ type: 'number', value: 1429.5 });
    });

    it('ARS factura_recibida without tipoDeCambio stores empty string at index 19', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'ARS' });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Recibidas', 'factura_recibida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[19]).toBe('');
    });
  });

  describe('reprocessing (same fileId already in sheet)', () => {
    it('updates existing row when fileId already exists in sheet', async () => {
      // First getValues call (findRowByFileId → B:B): fileId found at row 2
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fileId'],
          ['test-file-id'], // matching fileId
        ],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBe(true);
      }
      expect(updateRowsWithFormatting).toHaveBeenCalledWith(
        'spreadsheet-id',
        expect.arrayContaining([
          expect.objectContaining({ range: expect.stringContaining('Facturas Emitidas!A2') }),
        ]),
        expect.anything(),
        undefined
      );
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
      expect(batchUpdate).not.toHaveBeenCalled();
    });

    it('does normal insert when fileId is NOT in sheet and no business key match', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['Header']], // Only header row, no data
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBeUndefined();
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('detects business key duplicate when fileId is NOT in sheet', async () => {
      const existingFileId = 'different-existing-file';
      // Both getValues calls return same data; B:B check sees '2025-01-15' ≠ 'test-file-id'
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', existingFileId, 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', '1,210.00'],
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
        expect(result.value.existingFileId).toBe(existingFileId);
      }
    });
  });

  describe('monetary fields use CellNumber in appendRowsWithLinks path', () => {
    it('factura_emitida stores importeNeto, importeIva, importeTotal as CellNumber', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ importeNeto: 1000, importeIva: 210, importeTotal: 1210 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      // H=7, I=8, J=9
      expect(row[7]).toEqual({ type: 'number', value: 1000 });
      expect(row[8]).toEqual({ type: 'number', value: 210 });
      expect(row[9]).toEqual({ type: 'number', value: 1210 });
    });

    it('factura_recibida stores importeNeto, importeIva, importeTotal as CellNumber', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ importeNeto: 5000, importeIva: 1050, importeTotal: 6050 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Recibidas', 'factura_recibida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      // H=7, I=8, J=9
      expect(row[7]).toEqual({ type: 'number', value: 5000 });
      expect(row[8]).toEqual({ type: 'number', value: 1050 });
      expect(row[9]).toEqual({ type: 'number', value: 6050 });
    });
  });

  describe('updateRowsWithFormatting reprocessing path (ADV-152)', () => {
    it('uses CellNumber for monetary fields in reprocessing path (factura_emitida)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ importeNeto: 1000, importeIva: 210, importeTotal: 1210 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // H=7, I=8, J=9 — should be CellNumber objects
      expect(row[7]).toEqual({ type: 'number', value: 1000 });
      expect(row[8]).toEqual({ type: 'number', value: 210 });
      expect(row[9]).toEqual({ type: 'number', value: 1210 });
    });

    it('uses CellNumber for monetary fields in reprocessing path (factura_recibida)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ importeNeto: 5000, importeIva: 1050, importeTotal: 6050 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Recibidas', 'factura_recibida');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      expect(row[7]).toEqual({ type: 'number', value: 5000 });
      expect(row[8]).toEqual({ type: 'number', value: 1050 });
      expect(row[9]).toEqual({ type: 'number', value: 6050 });
    });

    it('uses CellLink for fileName in reprocessing path', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // C=2 — should be CellLink object with text and url
      expect(row[2]).toMatchObject({ text: expect.any(String), url: expect.stringContaining('test-file-id') });
    });

    it('passes raw ISO processedAt string in reprocessing path (timezone handled by updateRowsWithFormatting)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ processedAt: '2025-01-15T10:00:00Z' });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // M=12 — should be raw ISO string (convertToSheetsCellData handles timezone conversion)
      expect(row[12]).toBe('2025-01-15T10:00:00Z');
    });

    it('uses CellDate for fechaEmision in reprocessing path', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ fechaEmision: '2025-01-15' });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // A=0 — should be CellDate object
      expect(row[0]).toEqual({ type: 'date', value: '2025-01-15' });
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
