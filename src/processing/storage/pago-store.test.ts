/**
 * Tests for pago storage operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storePago } from './pago-store.js';
import type { Pago } from '../../types/index.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  appendRowsWithLinks: vi.fn(),
  sortSheet: vi.fn(),
  getValues: vi.fn(),
  batchUpdate: vi.fn(),
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

// Mock concurrency module — transparent withLock that runs callback directly
vi.mock('../../utils/concurrency.js', () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      return { ok: true, value: result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }),
}));

import { appendRowsWithLinks, sortSheet, getValues, batchUpdate } from '../../services/sheets.js';

const createTestPago = (overrides: Partial<Pago> = {}): Pago => ({
  fileId: 'test-file-id',
  fileName: 'test-pago.pdf',
  banco: 'BBVA',
  fechaPago: '2025-01-15',
  importePagado: 1210,
  moneda: 'ARS',
  referencia: 'REF-001',
  cuitPagador: '27234567891',
  nombrePagador: 'PAGADOR SA',
  cuitBeneficiario: '30709076783',
  nombreBeneficiario: 'ADVA SRL',
  concepto: 'Pago factura',
  processedAt: '2025-01-15T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

describe('storePago', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('StoreResult return type', () => {
    it('returns { stored: true } when pago is successfully stored', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.existingFileId).toBeUndefined();
      }
    });

    it('returns { stored: false, existingFileId } when duplicate is detected', async () => {
      const existingFileId = 'existing-file-id';
      // Full row data (A:O) with same confidence as new pago (0.95) to avoid replacement
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', existingFileId, 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

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

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('API error');
      }
    });
  });

  describe('duplicate detection', () => {
    it('detects duplicate when all criteria match', async () => {
      // Full row data with same confidence (0.95) to ensure quality is equal → existing wins
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', 'existing-id', 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('does not detect duplicate when date differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-10', 'existing-id', 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

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
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', 'existing-id', 'file.pdf', 'BBVA', '2,000.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

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
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', 'existing-id', 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '30709076783', 'ADVA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });
  });

  describe('tipoDeCambio and importeEnPesos columns', () => {
    it('USD pago_enviado with tipoDeCambio and importeEnPesos stores CellNumbers at positions 15-16', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ moneda: 'USD', tipoDeCambio: 1396.25, importeEnPesos: 1675500 });
      await storePago(pago, 'spreadsheet-id', 'Pagos Enviados', 'pago_enviado');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[15]).toEqual({ type: 'number', value: 1396.25 });
      expect(row[16]).toEqual({ type: 'number', value: 1675500 });
    });

    it('ARS pago_enviado without tipoDeCambio stores empty strings at positions 15-16', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ moneda: 'ARS' });
      await storePago(pago, 'spreadsheet-id', 'Pagos Enviados', 'pago_enviado');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[15]).toBe('');
      expect(row[16]).toBe('');
    });

    it('USD pago_recibido with tipoDeCambio and importeEnPesos stores CellNumbers at positions 15-16', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ moneda: 'USD', tipoDeCambio: 1396.25, importeEnPesos: 1675500 });
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[15]).toEqual({ type: 'number', value: 1396.25 });
      expect(row[16]).toEqual({ type: 'number', value: 1675500 });
    });

    it('ARS pago_recibido without tipoDeCambio stores empty strings at positions 15-16', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ moneda: 'ARS' });
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      expect(row[15]).toBe('');
      expect(row[16]).toBe('');
    });
  });

  describe('monetary fields use CellNumber in appendRowsWithLinks path', () => {
    it('pago_enviado stores importePagado as CellNumber', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ importePagado: 5500 });
      await storePago(pago, 'spreadsheet-id', 'Pagos Enviados', 'pago_enviado');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      // E=4
      expect(row[4]).toEqual({ type: 'number', value: 5500 });
    });

    it('pago_recibido stores importePagado as CellNumber', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ importePagado: 3200.50 });
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      // E=4
      expect(row[4]).toEqual({ type: 'number', value: 3200.50 });
    });
  });

  describe('pago recibido vs enviado', () => {
    it('uses cuitPagador for pago_recibido duplicate check', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', 'existing-id', 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891', // This should be checked for pago_recibido
        cuitBeneficiario: '30709076783',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false); // Should detect duplicate
      }
    });

    it('uses cuitBeneficiario for pago_enviado duplicate check', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', 'existing-id', 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '30709076783', 'ADVA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
        cuitBeneficiario: '30709076783', // This should be checked for pago_enviado
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Enviados', 'pago_enviado');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false); // Should detect duplicate
      }
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
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 15 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBe(true);
      }
      expect(batchUpdate).toHaveBeenCalledWith(
        'spreadsheet-id',
        expect.arrayContaining([
          expect.objectContaining({ range: expect.stringContaining('Pagos Recibidos!A2') }),
        ])
      );
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('does normal insert when fileId is NOT in sheet and no business key match', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['Header']],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBeUndefined();
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('detects business key duplicate when fileId is NOT in sheet', async () => {
      const existingFileId = 'different-existing-file';
      // B:B check: row[0]='2025-01-15' ≠ 'test-file-id', proceeds to duplicate check
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', existingFileId, 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
    });
  });

  describe('batchUpdate reprocessing path fixes (ADV-124)', () => {
    it('uses raw numbers for monetary fields in buildPagoRow', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 15 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ importePagado: 5500 });
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const batchArgs = vi.mocked(batchUpdate).mock.calls[0];
      const row = batchArgs[1][0].values[0];
      // E=4 — should be raw number, not formatted string
      expect(row[4]).toBe(5500);
    });

    it('uses HYPERLINK formula for fileName in buildPagoRow', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 15 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const batchArgs = vi.mocked(batchUpdate).mock.calls[0];
      const row = batchArgs[1][0].values[0];
      // C=2 — should be HYPERLINK formula, not plain text
      expect(row[2]).toContain('=HYPERLINK(');
      expect(row[2]).toContain('test-file-id');
    });

    it('formats processedAt as local time string in buildPagoRow', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 15 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ processedAt: '2025-01-15T10:00:00Z' });
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const batchArgs = vi.mocked(batchUpdate).mock.calls[0];
      const row = batchArgs[1][0].values[0];
      // K=10 — should NOT be raw ISO string
      expect(row[10]).not.toContain('T');
      expect(row[10]).not.toContain('Z');
      expect(row[10]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('quality comparison (Task 7: better duplicate replaces existing)', () => {
    it('replaces existing when new pago has higher confidence than existing', async () => {
      const existingFileId = 'old-file-id';
      // First call (findRowByFileId → B:B): new fileId 'test-file-id' NOT found
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fileId'],
          [existingFileId], // different fileId in B:B check
        ],
      });
      // Second call (isDuplicatePago, A:O): business key match, existing has lower confidence
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', existingFileId, 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.70', 'NO', '', ''],
        ],
      });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 15 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891', // same CUIT for duplicate match
        confidence: 0.95, // higher than existing 0.70 → new is better
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.replacedFileId).toBe(existingFileId);
      }
      expect(batchUpdate).toHaveBeenCalled();
    });

    it('keeps existing when existing pago has higher confidence than new', async () => {
      const existingFileId = 'old-file-id';
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fileId'],
          [existingFileId],
        ],
      });
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', existingFileId, 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891', // same CUIT for duplicate match
        confidence: 0.70, // lower than existing 0.95 → existing wins
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
      expect(batchUpdate).not.toHaveBeenCalled();
    });

    it('keeps existing when quality is equal (existing wins on tie)', async () => {
      const existingFileId = 'old-file-id';
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fileId'],
          [existingFileId],
        ],
      });
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2025-01-15', existingFileId, 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'etc', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891', // same CUIT
        confidence: 0.95, // same confidence → equal → existing wins
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
      expect(batchUpdate).not.toHaveBeenCalled();
    });
  });
});
