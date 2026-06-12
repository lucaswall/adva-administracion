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
import { FACTURA_EMITIDA_HEADERS, FACTURA_RECIBIDA_HEADERS } from '../../constants/spreadsheet-headers.js';

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
      // factura_emitida: 11 cols (A:K), importeTotal at index 10 (ADV-245)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['Header', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', existingFileId, 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', 'etc', '1,210.00'],
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
      // factura_emitida: 11 cols (A:K), importeTotal at index 10 (ADV-245)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', 'etc', '1,210.00'],
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
      // factura_emitida: 11 cols (A:K), importeTotal at index 10 (ADV-245)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', 'etc', '1,210.00'],
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
    it('USD factura_emitida with tipoDeCambio stores CellNumber at index 20 (ADV-245: was 19, shifted by condicionIVAReceptor)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'USD', tipoDeCambio: 1429.5 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0]; // first row
      expect(row[20]).toEqual({ type: 'number', value: 1429.5 }); // U (20) — shifted from T (19)
    });

    it('ARS factura_emitida without tipoDeCambio stores empty string at index 20 (ADV-245)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'ARS' });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[20]).toBe(''); // U (20) — shifted from T (19)
    });

    it('factura_emitida produces 21 columns with condicionIVAReceptor at H(7), pagada at T(19), tipoDeCambio at U(20) (ADV-245)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'USD', tipoDeCambio: 1429.5 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row).toHaveLength(21);
      expect(row[7]).toBe('');  // H - condicionIVAReceptor: empty when not set
      expect(row[19]).toBe(''); // T - pagada: empty initially
      expect(row[20]).toEqual({ type: 'number', value: 1429.5 }); // U - tipoDeCambio
    });

    it('storeFactura uses A:U range for factura_emitida (ADV-245: was A:T, shifted by condicionIVAReceptor)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      expect(callArgs[1]).toBe('Facturas Emitidas!A:U');
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
      // First getValues call (findRowByFileId → A:U): fileId found at row 2 (col B = index 1)
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'condicionIVAReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch', 'pagada', 'tipoDeCambio'],
          ['2025-01-15', 'test-file-id', 'file.pdf', 'Factura B', '0001-00001234', '30709076783', 'ADVA', 'IVA Responsable', '1000', '210', '1210', 'ARS', '', '2025-01-15T10:00:00Z', '0.95', 'NO', '', '', 'NO', '', ''],
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
      // factura_emitida: 11 cols (A:K), importeTotal at index 10 (ADV-245)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'etc', 'etc', 'nroFactura', 'cuit', 'etc', 'etc', 'etc', 'etc', 'importeTotal'],
          ['2025-01-15', existingFileId, 'etc', 'etc', '0001-00001234', '30709076783', 'etc', 'etc', 'etc', 'etc', '1,210.00'],
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
    it('factura_emitida stores importeNeto, importeIva, importeTotal as CellNumber (ADV-245: shifted by condicionIVAReceptor at H)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ importeNeto: 1000, importeIva: 210, importeTotal: 1210 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      // I=8, J=9, K=10 (H=7 is now condicionIVAReceptor per ADV-245)
      expect(row[8]).toEqual({ type: 'number', value: 1000 });
      expect(row[9]).toEqual({ type: 'number', value: 210 });
      expect(row[10]).toEqual({ type: 'number', value: 1210 });
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
    it('uses CellNumber for monetary fields in reprocessing path (factura_emitida, ADV-245: shifted)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [FACTURA_EMITIDA_HEADERS, ['', 'test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ importeNeto: 1000, importeIva: 210, importeTotal: 1210 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // I=8, J=9, K=10 (H=7 is condicionIVAReceptor per ADV-245)
      expect(row[8]).toEqual({ type: 'number', value: 1000 });
      expect(row[9]).toEqual({ type: 'number', value: 210 });
      expect(row[10]).toEqual({ type: 'number', value: 1210 });
    });

    it('uses CellNumber for monetary fields in reprocessing path (factura_recibida)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [FACTURA_RECIBIDA_HEADERS, ['', 'test-file-id']],
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
        value: [FACTURA_EMITIDA_HEADERS, ['', 'test-file-id']],
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
        value: [FACTURA_EMITIDA_HEADERS, ['', 'test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ processedAt: '2025-01-15T10:00:00Z' });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // N=13 — shifted by condicionIVAReceptor at H (ADV-245); was M=12
      expect(row[13]).toBe('2025-01-15T10:00:00Z');
    });

    it('uses CellDate for fechaEmision in reprocessing path', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [FACTURA_EMITIDA_HEADERS, ['', 'test-file-id']],
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

      // Verify withLock was called with appropriate lock key and expiry (ADV-344)
      expect(vi.mocked(withLock)).toHaveBeenCalledWith(
        expect.stringContaining('store:factura:0001-00001234:2025-01-15:1210:30709076783'),
        expect.any(Function),
        10000,   // wait timeout
        900000   // STORE_LOCK_AUTO_EXPIRY_MS — crash-recovery expiry (ADV-344)
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

  describe('condicionIVAReceptor column (ADV-245)', () => {
    it('factura_emitida with condicionIVAReceptor stores value at index 7 (column H)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ condicionIVAReceptor: 'Consumidor Final' });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[7]).toBe('Consumidor Final');
    });

    it('factura_emitida without condicionIVAReceptor stores empty string at index 7', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura(); // no condicionIVAReceptor
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[7]).toBe('');
    });

    it('factura_emitida row has 21 columns with condicionIVAReceptor at H, pagada at T, tipoDeCambio at U (ADV-245)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'USD', tipoDeCambio: 1500.0, condicionIVAReceptor: 'IVA Responsable Inscripto' });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row).toHaveLength(21);
      expect(row[7]).toBe('IVA Responsable Inscripto');       // H - condicionIVAReceptor (new)
      expect(row[8]).toEqual({ type: 'number', value: 1000 }); // I - importeNeto (shifted)
      expect(row[19]).toBe('');                                // T - pagada (shifted)
      expect(row[20]).toEqual({ type: 'number', value: 1500.0 }); // U - tipoDeCambio (shifted)
    });

    it('factura_recibida row is unaffected by condicionIVAReceptor change — still 20 columns', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura({ moneda: 'USD', tipoDeCambio: 1500.0 });
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Recibidas', 'factura_recibida');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row).toHaveLength(20); // factura_recibida unchanged
      expect(row[7]).toEqual({ type: 'number', value: 1000 }); // H - importeNeto (unchanged)
      expect(row[19]).toEqual({ type: 'number', value: 1500.0 }); // T - tipoDeCambio (unchanged)
    });
  });

  describe('reprocessing preserves match columns (ADV-307)', () => {
    it('preserves MANUAL matchConfidence lock and pagada=SI on reprocess (factura_emitida)', async () => {
      // Existing row in spreadsheet with MANUAL lock and pagada=SI (21 cols A:U)
      // B=col1=fileId, Q=col16=matchedPagoFileId, R=col17=matchConfidence, S=col18=hasCuitMatch, T=col19=pagada
      const existingRow = Array(21).fill('') as string[];
      existingRow[1] = 'test-file-id';   // B: fileId
      existingRow[16] = 'pago-123';      // Q: matchedPagoFileId
      existingRow[17] = 'MANUAL';        // R: matchConfidence (MANUAL lock)
      existingRow[18] = 'YES';           // S: hasCuitMatch
      existingRow[19] = 'SI';            // T: pagada

      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [FACTURA_EMITIDA_HEADERS, existingRow],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();  // factura has no match data
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const updateCall = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const updateRow = updateCall[1][0].values as unknown[];

      // MANUAL lock must be preserved
      expect(updateRow[17]).toBe('MANUAL');       // R: matchConfidence
      expect(updateRow[16]).toBe('pago-123');     // Q: matchedPagoFileId
      expect(updateRow[18]).toBe('YES');          // S: hasCuitMatch
      // pagada=SI must be preserved
      expect(updateRow[19]).toBe('SI');           // T: pagada
    });

    it('preserves pagada=SI even when matchConfidence is not MANUAL (factura_emitida)', async () => {
      const existingRow = Array(21).fill('') as string[];
      existingRow[1] = 'test-file-id';
      existingRow[16] = 'pago-456';
      existingRow[17] = 'HIGH';          // Not MANUAL
      existingRow[19] = 'SI';            // pagada=SI should be preserved regardless

      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [FACTURA_EMITIDA_HEADERS, existingRow],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      const updateCall = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const updateRow = updateCall[1][0].values as unknown[];

      // pagada=SI preserved even when matchConfidence is not MANUAL
      expect(updateRow[19]).toBe('SI');
    });

    it('preserves MANUAL matchConfidence lock on reprocess (factura_recibida)', async () => {
      // factura_recibida: P=col15=matchedPagoFileId, Q=col16=matchConfidence, R=col17=hasCuitMatch, S=col18=pagada
      const existingRow = Array(20).fill('') as string[];
      existingRow[1] = 'test-file-id';
      existingRow[15] = 'pago-789';     // P: matchedPagoFileId
      existingRow[16] = 'MANUAL';       // Q: matchConfidence
      existingRow[17] = 'NO';           // R: hasCuitMatch
      existingRow[18] = 'SI';           // S: pagada

      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [FACTURA_RECIBIDA_HEADERS, existingRow],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Recibidas', 'factura_recibida');

      const updateCall = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const updateRow = updateCall[1][0].values as unknown[];

      expect(updateRow[16]).toBe('MANUAL');    // Q: matchConfidence preserved
      expect(updateRow[15]).toBe('pago-789'); // P: matchedPagoFileId preserved
      expect(updateRow[18]).toBe('SI');        // S: pagada preserved
    });
  });

  describe('header-derived carry-forward indices (ADV-362)', () => {
    it('returns ok:false when reprocessed sheet header is missing expected match column (factura_emitida)', async () => {
      // Header row truncated — missing 'matchedPagoFileId', 'matchConfidence', etc.
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante'],
          ['2025-01-15', 'test-file-id', 'file.pdf', 'A'],
        ],
      });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(false);
      expect(updateRowsWithFormatting).not.toHaveBeenCalled();
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('returns ok:false when reprocessed sheet header is missing expected match column (factura_recibida)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName'],
          ['2025-01-15', 'test-file-id', 'file.pdf'],
        ],
      });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Recibidas', 'factura_recibida');

      expect(result.ok).toBe(false);
      expect(updateRowsWithFormatting).not.toHaveBeenCalled();
    });

    it('preserves MANUAL lock + pagada using header-derived indices (current schema, factura_emitida)', async () => {
      // Same as existing ADV-307 test but now verifies header-based lookup works correctly
      const existingRow = Array(21).fill('') as string[];
      existingRow[1] = 'test-file-id';
      existingRow[16] = 'pago-derived';
      existingRow[17] = 'MANUAL';
      existingRow[18] = 'YES';
      existingRow[19] = 'SI';

      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [FACTURA_EMITIDA_HEADERS, existingRow],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      const updateCall = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const updateRow = updateCall[1][0].values as unknown[];
      expect(updateRow[17]).toBe('MANUAL');
      expect(updateRow[16]).toBe('pago-derived');
      expect(updateRow[19]).toBe('SI');
    });
  });

  describe('findRowByFileId error propagation (ADV-358)', () => {
    it('returns ok:false with the Sheets error when getValues fails during fileId lookup', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: false,
        error: new Error('Sheets API read error'),
      });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Sheets API read error');
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
      expect(updateRowsWithFormatting).not.toHaveBeenCalled();
    });

    it('treats header-only sheet as not-found (does not error)', async () => {
      // Length <= 1 → not-found, NOT an error — distinct from read failure
      vi.mocked(getValues).mockResolvedValueOnce({ ok: true, value: [['Header']] }); // findRowByFileId
      vi.mocked(getValues).mockResolvedValueOnce({ ok: true, value: [['Header']] }); // isDuplicateFactura
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const factura = createTestFactura();
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });
  });

  describe('cache preload failure falls back to API (ADV-297)', () => {
    it('uses API duplicate check when cache.isLoaded() returns false', async () => {
      // Cache whose preload failed — isLoaded() returns false
      const mockCache = {
        isLoaded: vi.fn(() => false),
        isDuplicateFactura: vi.fn(() => ({ isDuplicate: false })),
        addEntry: vi.fn(),
      };

      const mockContext = {
        duplicateCache: mockCache,
        sortBatch: { addPendingSort: vi.fn() },
        metadataCache: undefined,
        tokenBatch: undefined,
        sheetOrderBatch: undefined,
      };

      // First getValues: reprocess check (no existing row for this fileId)
      // Second getValues: API duplicate check — reports a duplicate
      vi.mocked(getValues)
        .mockResolvedValueOnce({ ok: true, value: [['fileId']] }) // reprocess B:B — no match
        .mockResolvedValueOnce({
          ok: true,
          value: [
            ['Fecha', 'fileId', 'C', 'D', 'nroFactura', 'cuit', 'G', 'H', 'I', 'J', 'importeTotal'],
            ['2025-01-15', 'existing-file-id', '', '', '0001-00001234', '30709076783', '', '', '', '', '1,210.00'],
          ],
        }); // business-key duplicate check — duplicate found

      const factura = createTestFactura();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida', mockContext as any);

      // Must NOT use the (unloaded) cache for duplicate check
      expect(mockCache.isDuplicateFactura).not.toHaveBeenCalled();
      // Must use API and detect the duplicate
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe('existing-file-id');
      }
    });

    it('uses cache when cache.isLoaded() returns true', async () => {
      // Cache that is loaded and reports no duplicate
      const mockCache = {
        isLoaded: vi.fn(() => true),
        isDuplicateFactura: vi.fn(() => ({ isDuplicate: false })),
        addEntry: vi.fn(),
      };

      const mockContext = {
        duplicateCache: mockCache,
        sortBatch: { addPendingSort: vi.fn() },
        metadataCache: undefined,
        tokenBatch: undefined,
        sheetOrderBatch: undefined,
      };

      // Reprocess check: no existing row
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['fileId']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });

      const factura = createTestFactura();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await storeFactura(factura, 'spreadsheet-id', 'Facturas Emitidas', 'factura_emitida', mockContext as any);

      // Cache is loaded — use it (fast path, avoids extra API call)
      expect(mockCache.isDuplicateFactura).toHaveBeenCalled();
    });
  });
});
