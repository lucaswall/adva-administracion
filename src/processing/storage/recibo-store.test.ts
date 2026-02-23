/**
 * Tests for recibo storage operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeRecibo } from './recibo-store.js';
import type { Recibo } from '../../types/index.js';

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

const createTestRecibo = (overrides: Partial<Recibo> = {}): Recibo => ({
  fileId: 'test-file-id',
  fileName: 'test-recibo.pdf',
  tipoRecibo: 'sueldo',
  nombreEmpleado: 'Juan Perez',
  cuilEmpleado: '20123456789',
  legajo: '001',
  tareaDesempenada: 'Desarrollador',
  cuitEmpleador: '30709076783',
  periodoAbonado: '2025-01',
  subtotalRemuneraciones: 500000,
  subtotalDescuentos: 100000,
  totalNeto: 400000,
  fechaPago: '2025-01-31',
  processedAt: '2025-01-31T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

describe('storeRecibo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('monetary fields use CellNumber in appendRowsWithLinks path', () => {
    it('stores subtotalRemuneraciones, subtotalDescuentos, totalNeto as CellNumber', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({
        subtotalRemuneraciones: 500000,
        subtotalDescuentos: 100000,
        totalNeto: 400000,
      });
      await storeRecibo(recibo, 'spreadsheet-id');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      // K=10, L=11, M=12
      expect(row[10]).toEqual({ type: 'number', value: 500000 });
      expect(row[11]).toEqual({ type: 'number', value: 100000 });
      expect(row[12]).toEqual({ type: 'number', value: 400000 });
    });
  });

  describe('duplicate detection', () => {
    it('returns { stored: true } when recibo is new', async () => {
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({ ok: true, value: [['Header']] });
      // isDuplicateRecibo → A:R: no match
      vi.mocked(getValues).mockResolvedValueOnce({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo();
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.existingFileId).toBeUndefined();
      }
    });

    it('returns { stored: false, existingFileId } when duplicate is detected by exact key', async () => {
      const existingFileId = 'existing-file-id';
      // findRowByFileId → B:B: no match (different fileId)
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], [existingFileId]],
      });
      // isDuplicateRecibo → A:R: match on business key
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto'],
          ['2025-01-31', existingFileId, 'old.pdf', 'Mensual', 'Juan Perez', '20123456789', '001', 'Desarrollador', '30709076783', '2025-01', '500,000.00', '100,000.00', '400,000.00'],
        ],
      });

      const recibo = createTestRecibo(); // Same cuilEmpleado, periodoAbonado, totalNeto
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
    });

    it('allows same employee, different period', async () => {
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['existing-file-id']],
      });
      // isDuplicateRecibo → A:R: no match (different period)
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto'],
          ['2025-01-31', 'existing-file-id', 'old.pdf', 'Mensual', 'Juan Perez', '20123456789', '001', 'Desarrollador', '30709076783', '2025-01', '500,000.00', '100,000.00', '400,000.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({ periodoAbonado: '2025-02' }); // Different period
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });

    it('allows same employee, same period, different amount', async () => {
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['existing-file-id']],
      });
      // isDuplicateRecibo → A:R: no match (different totalNeto)
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto'],
          ['2025-01-31', 'existing-file-id', 'old.pdf', 'Mensual', 'Juan Perez', '20123456789', '001', 'Desarrollador', '30709076783', '2025-01', '500,000.00', '100,000.00', '400,000.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({ totalNeto: 450000 }); // Different amount
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });

    it('allows different employee, same period', async () => {
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['existing-file-id']],
      });
      // isDuplicateRecibo → A:R: no match (different cuilEmpleado)
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto'],
          ['2025-01-31', 'existing-file-id', 'old.pdf', 'Mensual', 'Juan Perez', '20123456789', '001', 'Desarrollador', '30709076783', '2025-01', '500,000.00', '100,000.00', '400,000.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({ cuilEmpleado: '20987654321', nombreEmpleado: 'Maria Gomez' }); // Different employee
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
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
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 18 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo();
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBe(true);
      }
      expect(batchUpdate).toHaveBeenCalledWith(
        'spreadsheet-id',
        expect.arrayContaining([
          expect.objectContaining({ range: expect.stringContaining('Recibos!A2') }),
        ])
      );
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('uses raw numbers for monetary fields in reprocessing row', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 18 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({ subtotalRemuneraciones: 500000, subtotalDescuentos: 100000, totalNeto: 400000 });
      await storeRecibo(recibo, 'spreadsheet-id');

      const batchArgs = vi.mocked(batchUpdate).mock.calls[0];
      const row = batchArgs[1][0].values[0];
      // K=10, L=11, M=12 — should be raw numbers
      expect(row[10]).toBe(500000);
      expect(row[11]).toBe(100000);
      expect(row[12]).toBe(400000);
    });

    it('uses HYPERLINK formula for fileName in reprocessing row', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 18 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo();
      await storeRecibo(recibo, 'spreadsheet-id');

      const batchArgs = vi.mocked(batchUpdate).mock.calls[0];
      const row = batchArgs[1][0].values[0];
      // C=2 — should be HYPERLINK formula
      expect(row[2]).toContain('=HYPERLINK(');
      expect(row[2]).toContain('test-file-id');
    });

    it('uses timezone-formatted processedAt in reprocessing row', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 18 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({ processedAt: '2025-01-31T15:00:00Z' });
      await storeRecibo(recibo, 'spreadsheet-id');

      const batchArgs = vi.mocked(batchUpdate).mock.calls[0];
      const row = batchArgs[1][0].values[0];
      // N=13 — should be formatted, not raw ISO
      expect(row[13]).not.toContain('T');
      expect(row[13]).not.toContain('Z');
      expect(row[13]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('does normal insert when fileId is NOT in sheet', async () => {
      // findRowByFileId: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['other-file-id']],
      });
      // isDuplicateRecibo: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['Header']],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo();
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBeUndefined();
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
      expect(batchUpdate).not.toHaveBeenCalled();
    });
  });
});
