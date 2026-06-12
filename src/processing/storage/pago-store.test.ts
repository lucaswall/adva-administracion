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

import { appendRowsWithLinks, sortSheet, getValues, batchUpdate, updateRowsWithFormatting } from '../../services/sheets.js';
import { withLock } from '../../utils/concurrency.js';
import { PAGO_RECIBIDO_HEADERS, PAGO_ENVIADO_HEADERS } from '../../constants/spreadsheet-headers.js';

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
      // First getValues call (findRowByFileId → A:Q): fileId found at row 2 (col B = index 1)
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuit', 'nombre', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence', 'tipoDeCambio', 'importeEnPesos'],
          ['2025-01-15', 'test-file-id', 'file.pdf', 'BBVA', '1,210.00', 'ARS', 'REF-001', '27234567891', 'PAGADOR SA', 'concepto', '2025-01-15T10:00:00Z', '0.95', 'NO', '', '', '', ''],
        ],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBe(true);
      }
      expect(updateRowsWithFormatting).toHaveBeenCalledWith(
        'spreadsheet-id',
        expect.arrayContaining([
          expect.objectContaining({ range: expect.stringContaining('Pagos Recibidos!A2') }),
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

  describe('updateRowsWithFormatting reprocessing path (ADV-152)', () => {
    it('uses CellNumber for importePagado in reprocessing path', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [PAGO_RECIBIDO_HEADERS, ['', 'test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ importePagado: 5500 });
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // E=4 — should be CellNumber object
      expect(row[4]).toEqual({ type: 'number', value: 5500 });
    });

    it('uses CellLink for fileName in reprocessing path', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [PAGO_RECIBIDO_HEADERS, ['', 'test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // C=2 — should be CellLink object
      expect(row[2]).toMatchObject({ text: expect.any(String), url: expect.stringContaining('test-file-id') });
    });

    it('passes raw ISO processedAt in reprocessing path', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [PAGO_RECIBIDO_HEADERS, ['', 'test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({ processedAt: '2025-01-15T10:00:00Z' });
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // K=10 — should be raw ISO string
      expect(row[10]).toBe('2025-01-15T10:00:00Z');
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
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
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
      expect(updateRowsWithFormatting).toHaveBeenCalled();
      expect(batchUpdate).not.toHaveBeenCalled();
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

  describe('reprocessing preserves match columns (ADV-307)', () => {
    it('preserves MANUAL matchConfidence on reprocess', async () => {
      // Pago row: 17 cols A:Q. N=col13=matchedFacturaFileId, O=col14=matchConfidence
      const existingRow = Array(17).fill('') as string[];
      existingRow[1] = 'test-file-id';    // B: fileId
      existingRow[13] = 'factura-abc';    // N: matchedFacturaFileId
      existingRow[14] = 'MANUAL';         // O: matchConfidence (MANUAL lock)

      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [PAGO_RECIBIDO_HEADERS, existingRow],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();  // no match data
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const updateCall = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const updateRow = updateCall[1][0].values as unknown[];

      // MANUAL lock must be preserved
      expect(updateRow[14]).toBe('MANUAL');       // O: matchConfidence
      expect(updateRow[13]).toBe('factura-abc');  // N: matchedFacturaFileId
    });
  });

  describe('header-derived carry-forward indices (ADV-362)', () => {
    it('returns ok:false when reprocessed sheet header is missing expected match column (pago_recibido)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName'],  // Truncated header — missing matchedFacturaFileId, matchConfidence
          ['2025-01-15', 'test-file-id', 'file.pdf'],
        ],
      });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(false);
      expect(updateRowsWithFormatting).not.toHaveBeenCalled();
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('preserves MANUAL lock using header-derived indices (current schema)', async () => {
      const existingRow = Array(17).fill('') as string[];
      existingRow[1] = 'test-file-id';
      existingRow[13] = 'factura-derived';
      existingRow[14] = 'MANUAL';

      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [PAGO_RECIBIDO_HEADERS, existingRow],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      const updateCall = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const updateRow = updateCall[1][0].values as unknown[];
      expect(updateRow[14]).toBe('MANUAL');
      expect(updateRow[13]).toBe('factura-derived');
    });

    it('returns ok:false when reprocessed sheet header is missing expected match column (pago_enviado)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName'],  // Truncated header — missing matchedFacturaFileId, matchConfidence
          ['2025-01-15', 'test-file-id', 'file.pdf'],
        ],
      });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Enviados', 'pago_enviado');

      expect(result.ok).toBe(false);
      expect(updateRowsWithFormatting).not.toHaveBeenCalled();
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('preserves MANUAL lock using header-derived indices (pago_enviado, current schema)', async () => {
      const existingRow = Array(17).fill('') as string[];
      existingRow[1] = 'test-file-id';
      existingRow[PAGO_ENVIADO_HEADERS.indexOf('matchedFacturaFileId')] = 'factura-derived';
      existingRow[PAGO_ENVIADO_HEADERS.indexOf('matchConfidence')] = 'MANUAL';

      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [PAGO_ENVIADO_HEADERS, existingRow],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Enviados', 'pago_enviado');

      expect(result.ok).toBe(true);
      const updateCall = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const updateRow = updateCall[1][0].values as unknown[];
      expect(updateRow[PAGO_ENVIADO_HEADERS.indexOf('matchConfidence')]).toBe('MANUAL');
      expect(updateRow[PAGO_ENVIADO_HEADERS.indexOf('matchedFacturaFileId')]).toBe('factura-derived');
    });
  });

  describe('findRowByFileId error propagation (ADV-358)', () => {
    it('returns ok:false with the Sheets error when getValues fails during fileId lookup', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: false,
        error: new Error('Sheets API read error'),
      });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Sheets API read error');
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
      expect(updateRowsWithFormatting).not.toHaveBeenCalled();
    });

    it('treats header-only sheet as not-found (does not error)', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({ ok: true, value: [['Header']] }); // findRowByFileId
      vi.mocked(getValues).mockResolvedValueOnce({ ok: true, value: [['Header']] }); // isDuplicatePago
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });
  });

  describe('lock auto-expiry (ADV-344)', () => {
    it('uses STORE_LOCK_AUTO_EXPIRY_MS (900 000 ms) as 4th withLock argument', async () => {
      // The business-key lock expiry must cover worst-case withQuotaRetry chains
      // (~12 min) so the lock is not force-acquired while the sheet write is still in progress.
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });

      const pago = createTestPago();
      await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      const calls = vi.mocked(withLock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall[3]).toBe(900000); // STORE_LOCK_AUTO_EXPIRY_MS
    });
  });
});
