/**
 * Tests for resumen storage operations (bank accounts, credit cards, brokers)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeResumenBancario, storeResumenTarjeta, storeResumenBroker } from './resumen-store.js';
import type { ResumenBancario, ResumenTarjeta, ResumenBroker } from '../../types/index.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  appendRowsWithLinks: vi.fn(),
  sortSheet: vi.fn(),
  getValues: vi.fn(),
  getSpreadsheetTimezone: vi.fn(() => Promise.resolve({ ok: true, value: 'America/Argentina/Buenos_Aires' })),
  dateStringToSerial: vi.fn((dateStr: string) => {
    // Mock implementation: simple serial number based on date
    const date = new Date(dateStr + 'T00:00:00Z');
    return Math.floor(date.getTime() / (1000 * 60 * 60 * 24)) + 25569; // Excel epoch offset
  }),
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

vi.mock('../../utils/file-naming.js', () => ({
  generateResumenFileName: vi.fn((resumen: ResumenBancario) =>
    `${resumen.fechaHasta.substring(0, 7)} - Resumen - ${resumen.banco} - ${resumen.numeroCuenta} ${resumen.moneda}.pdf`
  ),
  generateResumenTarjetaFileName: vi.fn((resumen: ResumenTarjeta) =>
    `${resumen.fechaHasta.substring(0, 7)} - Resumen - ${resumen.banco} - ${resumen.tipoTarjeta} ${resumen.numeroCuenta}.pdf`
  ),
  generateResumenBrokerFileName: vi.fn((resumen: ResumenBroker) =>
    `${resumen.fechaHasta.substring(0, 7)} - Resumen - ${resumen.broker} - ${resumen.numeroCuenta}.pdf`
  ),
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

import { appendRowsWithLinks, sortSheet, getValues } from '../../services/sheets.js';
import { withLock } from '../../utils/concurrency.js';
import { info, warn } from '../../utils/logger.js';

const createTestResumen = (overrides: Partial<ResumenBancario> = {}): ResumenBancario => ({
  fileId: 'test-file-id',
  fileName: 'test-resumen.pdf',
  banco: 'Santander',
  numeroCuenta: '1234567890',
  fechaDesde: '2024-01-01',
  fechaHasta: '2024-01-31',
  saldoInicial: 10000,
  saldoFinal: 15000,
  moneda: 'ARS',
  cantidadMovimientos: 25,
  processedAt: '2025-01-15T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  movimientos: [
    { fecha: '2024-01-15', concepto: 'Credit', debito: null, credito: 5000, saldo: 15000 },
  ],
  ...overrides,
});

describe('storeResumenBancario (bank accounts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('StoreResult return type', () => {
    it('returns { stored: true } when resumen is successfully stored', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

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
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', 45292, 45322, existingFileId, 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000], // Serial numbers for 2024-01-01 and 2024-01-31
        ],
      });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('returns error when appendRowsWithLinks fails', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({
        ok: false,
        error: new Error('API error'),
      });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('API error');
      }
    });
  });

  describe('duplicate detection', () => {
    it('detects duplicate when all 5 fields match (skipping periodo column)', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', '2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('does not detect duplicate when banco differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', '2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'BBVA', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when fechaDesde differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', '2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-02-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when fechaHasta differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', '2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-02-29',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when numeroCuenta differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', '2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '9876543210',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when moneda differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', '2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'USD',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('handles serial number dates in existing data', async () => {
      // Existing data has serial numbers instead of date strings
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', 45292, 45322, 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000], // Serial numbers
        ],
      });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false); // Should detect as duplicate
      }
    });
  });

  describe('row formatting', () => {
    it('stores row with periodo as first column (12 columns total with balanceOk and balanceDiff)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 12 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        fileId: 'test-id-123',
        banco: 'Santander',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
        saldoInicial: 10000,
        saldoFinal: 15000,
        movimientos: [
          { fecha: '2024-01-15', concepto: 'Credit', debito: null, credito: 5000, saldo: 15000 },
        ],
      });

      await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(appendRowsWithLinks).toHaveBeenCalledWith(
        'spreadsheet-id',
        'Resumenes!A:L',  // Updated range from A:J to A:L
        expect.arrayContaining([
          expect.arrayContaining([
            '2024-01', // periodo (first column, derived from fechaHasta)
            { type: 'date', value: '2024-01-01' }, // fechaDesde as CellDate
            { type: 'date', value: '2024-01-31' }, // fechaHasta as CellDate
            'test-id-123',
            expect.objectContaining({
              text: expect.stringContaining('2024-01'),
              url: 'https://drive.google.com/file/d/test-id-123/view'
            }),
            'Santander',
            '1234567890',
            'ARS',
            { type: 'number', value: 10000 }, // saldoInicial as CellNumber
            { type: 'number', value: 15000 }, // saldoFinal as CellNumber
            { type: 'formula', value: '=IF(ABS(INDIRECT("L"&ROW()))<0.01,"SI","NO")' }, // balanceOk formula
            { type: 'number', value: 0 }, // balanceDiff (10000 + 5000 - 15000 = 0)
          ])
        ]),
        'America/Argentina/Buenos_Aires', // Timezone parameter
        undefined // metadataCache parameter
      );
    });

    it('derives periodo from fechaHasta in YYYY-MM format', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        fechaDesde: '2024-01-15',
        fechaHasta: '2024-02-14',
      });

      await storeResumenBancario(resumen, 'spreadsheet-id');

      const calls = vi.mocked(appendRowsWithLinks).mock.calls;
      expect(calls.length).toBe(1);
      const row = calls[0][2][0];
      expect(row[0]).toBe('2024-02'); // periodo from fechaHasta
    });

    it('stores row with correct column order using CellDate, CellNumber, and CellFormula types', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 12 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        fileId: 'test-id-123',
        banco: 'Santander',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
        saldoInicial: 10000,
        saldoFinal: 15000,
        movimientos: [
          { fecha: '2024-01-15', concepto: 'Credit', debito: null, credito: 5000, saldo: 15000 },
        ],
      });

      await storeResumenBancario(resumen, 'spreadsheet-id');

      const calls = vi.mocked(appendRowsWithLinks).mock.calls;
      expect(calls.length).toBe(1);
      const row = calls[0][2][0];
      expect(row).toHaveLength(12); // Confirm 12 columns total (added balanceOk and balanceDiff)
    });

    it('calculates balanceDiff correctly with various transaction scenarios', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 12 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      // saldoInicial: 10000, credito: 3000, debito: 2000 = 11000
      // saldoFinal: 10500 => diff = 11000 - 10500 = 500
      const resumen = createTestResumen({
        saldoInicial: 10000,
        saldoFinal: 10500,
        movimientos: [
          { fecha: '2024-01-15', concepto: 'Credit', debito: null, credito: 3000, saldo: 13000 },
          { fecha: '2024-01-20', concepto: 'Debit', debito: 2000, credito: null, saldo: 11000 },
        ],
      });

      await storeResumenBancario(resumen, 'spreadsheet-id');

      const calls = vi.mocked(appendRowsWithLinks).mock.calls;
      const row = calls[0][2][0];
      // balanceDiff should be 500 (computed 11000 - reported 10500)
      expect(row[11]).toEqual({ type: 'number', value: 500 });
    });

    it('handles empty movimientos with zero balanceDiff when saldoFinal equals saldoInicial', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 12 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        saldoInicial: 10000,
        saldoFinal: 10000,
        movimientos: [],  // No transactions
      });

      await storeResumenBancario(resumen, 'spreadsheet-id');

      const calls = vi.mocked(appendRowsWithLinks).mock.calls;
      const row = calls[0][2][0];
      // balanceDiff should be 0
      expect(row[11]).toEqual({ type: 'number', value: 0 });
    });

    it('creates hyperlink with correct format (now at index 4)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        fileId: 'abc123',
      });

      await storeResumenBancario(resumen, 'spreadsheet-id');

      const calls = vi.mocked(appendRowsWithLinks).mock.calls;
      expect(calls.length).toBe(1);
      const row = calls[0][2][0];
      expect(row[4]).toEqual(expect.objectContaining({
        text: expect.any(String),
        url: 'https://drive.google.com/file/d/abc123/view',
      }));
    });
  });

  describe('sorting', () => {
    it('sorts by periodo ascending after storing', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen();
      await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(sortSheet).toHaveBeenCalledWith(
        'spreadsheet-id',
        'Resumenes',
        0, // column index 0 (periodo)
        false // ascending
      );
    });

    it('does not fail when sort fails', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({
        ok: false,
        error: new Error('Sort failed'),
      });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      // Should still succeed even if sort fails
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });
  });

  describe('reprocessing by fileId (ADV-308)', () => {
    it('returns { stored: true, updated: true } when same fileId already in Resumenes sheet', async () => {
      // findResumenRowByFileId reads Resumenes!A:D and finds fileId at row[3]
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId'],
          ['2024-01', '2024-01-01', '2024-01-31', 'test-file-id'],
        ],
      });

      const resumen = createTestResumen(); // fileId: 'test-file-id'
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBe(true);
      }
      // Must NOT append a new row or call isDuplicate
      expect(vi.mocked(appendRowsWithLinks)).not.toHaveBeenCalled();
    });

    it('skips the fileId check when options.skipFileIdCheck is set — same fileId, different period appends (MP synthetic resumenes)', async () => {
      // MP reuses the movimientos spreadsheet id as fileId for EVERY period.
      // A prior period's row must not block the next period's resumen.
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2023-12', 45261, 45291, 'test-file-id', 'prev.pdf', 'Santander', '1234567890', 'ARS', 5000, 10000], // 2023-12 period, SAME fileId
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen(); // 2024-01 period, fileId 'test-file-id'
      const result = await storeResumenBancario(resumen, 'spreadsheet-id', undefined, {
        skipFileIdCheck: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBeUndefined();
      }
      expect(vi.mocked(appendRowsWithLinks)).toHaveBeenCalled();
    });

    it('still dedupes on the business key when skipFileIdCheck is set — same period not duplicated', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01', 45292, 45322, 'test-file-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000], // SAME period + account
        ],
      });

      const resumen = createTestResumen(); // 2024-01 period, same banco/cuenta/moneda
      const result = await storeResumenBancario(resumen, 'spreadsheet-id', undefined, {
        skipFileIdCheck: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe('test-file-id');
      }
      expect(vi.mocked(appendRowsWithLinks)).not.toHaveBeenCalled();
    });

    it('falls through to duplicate check when fileId is NOT found', async () => {
      // findResumenRowByFileId: different fileId at row[3]
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId'],
          ['2024-01', '2024-01-01', '2024-01-31', 'different-file-id'],
        ],
      });
      // isDuplicateResumenBancario: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['Header']],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBeUndefined();
      }
      expect(vi.mocked(appendRowsWithLinks)).toHaveBeenCalled();
    });
  });

  describe('duplicate log level (ADV-182)', () => {
    it('logs at info level (not warn) when duplicate is detected', async () => {
      const existingFileId = 'existing-file-id';
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda'],
          ['2024-01', '2024-01-01', '2024-01-31', existingFileId, 'existing.pdf', 'Santander', '1234567890', 'ARS'],
        ],
      });

      const resumen = createTestResumen({ fileId: 'new-file-id' });
      await storeResumenBancario(resumen, 'spreadsheet-id');

      // Must log at info level (not warn) with both existingFileId and newFileId
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate'),
        expect.objectContaining({
          existingFileId,
          newFileId: 'new-file-id',
        })
      );
      expect(vi.mocked(warn)).not.toHaveBeenCalledWith(
        expect.stringContaining('Duplicate'),
        expect.anything()
      );
    });
  });
});

// ─── storeResumenTarjeta ───────────────────────────────────────────────────────

const createTestResumenTarjeta = (overrides: Partial<ResumenTarjeta> = {}): ResumenTarjeta => ({
  fileId: 'tarjeta-file-id',
  fileName: 'tarjeta-resumen.pdf',
  banco: 'BBVA',
  tipoTarjeta: 'Visa',
  numeroCuenta: '4563',
  fechaDesde: '2024-01-01',
  fechaHasta: '2024-01-31',
  pagoMinimo: 5000,
  saldoActual: 50000,
  cantidadMovimientos: 0,
  processedAt: '2025-01-15T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

describe('storeResumenTarjeta (credit cards)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { stored: true } when resumen tarjeta is successfully stored', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 10 });
    vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

    const result = await storeResumenTarjeta(createTestResumenTarjeta(), 'spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stored).toBe(true);
      expect(result.value.existingFileId).toBeUndefined();
    }
  });

  it('returns { stored: false, existingFileId } when duplicate is detected', async () => {
    const existingFileId = 'existing-tarjeta-id';
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'tipoTarjeta'],
        ['2024-01', '2024-01-01', '2024-01-31', existingFileId, 'old.pdf', 'BBVA', '4563', 'Visa'],
      ],
    });

    const result = await storeResumenTarjeta(createTestResumenTarjeta(), 'spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stored).toBe(false);
      expect(result.value.existingFileId).toBe(existingFileId);
    }
    expect(vi.mocked(appendRowsWithLinks)).not.toHaveBeenCalled();
  });

  it('returns { stored: true, updated: true } when same fileId already in Resumenes sheet (ADV-308)', async () => {
    vi.mocked(getValues).mockResolvedValueOnce({
      ok: true,
      value: [
        ['periodo', 'fechaDesde', 'fechaHasta', 'fileId'],
        ['2024-01', '2024-01-01', '2024-01-31', 'tarjeta-file-id'],
      ],
    });

    const resumen = createTestResumenTarjeta(); // fileId: 'tarjeta-file-id'
    const result = await storeResumenTarjeta(resumen, 'spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stored).toBe(true);
      expect(result.value.updated).toBe(true);
    }
    expect(vi.mocked(appendRowsWithLinks)).not.toHaveBeenCalled();
  });

  it('logs at info level (not warn) when duplicate tarjeta is detected', async () => {
    const existingFileId = 'existing-tarjeta-id';
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'tipoTarjeta'],
        ['2024-01', '2024-01-01', '2024-01-31', existingFileId, 'old.pdf', 'BBVA', '4563', 'Visa'],
      ],
    });

    const resumen = createTestResumenTarjeta({ fileId: 'new-tarjeta-id' });
    await storeResumenTarjeta(resumen, 'spreadsheet-id');

    expect(vi.mocked(info)).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate'),
      expect.objectContaining({
        existingFileId,
        newFileId: 'new-tarjeta-id',
      })
    );
    expect(vi.mocked(warn)).not.toHaveBeenCalledWith(
      expect.stringContaining('Duplicate'),
      expect.anything()
    );
  });
});

// ─── storeResumenBroker ────────────────────────────────────────────────────────

const createTestResumenBroker = (overrides: Partial<ResumenBroker> = {}): ResumenBroker => ({
  fileId: 'broker-file-id',
  fileName: 'broker-resumen.pdf',
  broker: 'BALANZ CAPITAL VALORES SAU',
  numeroCuenta: '123456',
  fechaDesde: '2024-01-01',
  fechaHasta: '2024-01-31',
  saldoARS: 100000,
  saldoUSD: 500,
  cantidadMovimientos: 0,
  processedAt: '2025-01-15T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

describe('storeResumenBroker (brokers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { stored: true } when resumen broker is successfully stored', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
    vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

    const result = await storeResumenBroker(createTestResumenBroker(), 'spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stored).toBe(true);
      expect(result.value.existingFileId).toBeUndefined();
    }
  });

  it('returns { stored: false, existingFileId } when duplicate is detected', async () => {
    const existingFileId = 'existing-broker-id';
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'broker', 'numeroCuenta'],
        ['2024-01', '2024-01-01', '2024-01-31', existingFileId, 'old.pdf', 'BALANZ CAPITAL VALORES SAU', '123456'],
      ],
    });

    const result = await storeResumenBroker(createTestResumenBroker(), 'spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stored).toBe(false);
      expect(result.value.existingFileId).toBe(existingFileId);
    }
    expect(vi.mocked(appendRowsWithLinks)).not.toHaveBeenCalled();
  });

  it('returns { stored: true, updated: true } when same fileId already in Resumenes sheet (ADV-308)', async () => {
    vi.mocked(getValues).mockResolvedValueOnce({
      ok: true,
      value: [
        ['periodo', 'fechaDesde', 'fechaHasta', 'fileId'],
        ['2024-01', '2024-01-01', '2024-01-31', 'broker-file-id'],
      ],
    });

    const resumen = createTestResumenBroker(); // fileId: 'broker-file-id'
    const result = await storeResumenBroker(resumen, 'spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stored).toBe(true);
      expect(result.value.updated).toBe(true);
    }
    expect(vi.mocked(appendRowsWithLinks)).not.toHaveBeenCalled();
  });

  it('logs at info level (not warn) when duplicate broker is detected', async () => {
    const existingFileId = 'existing-broker-id';
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'broker', 'numeroCuenta'],
        ['2024-01', '2024-01-01', '2024-01-31', existingFileId, 'old.pdf', 'BALANZ CAPITAL VALORES SAU', '123456'],
      ],
    });

    const resumen = createTestResumenBroker({ fileId: 'new-broker-id' });
    await storeResumenBroker(resumen, 'spreadsheet-id');

    expect(vi.mocked(info)).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate'),
      expect.objectContaining({
        existingFileId,
        newFileId: 'new-broker-id',
      })
    );
    expect(vi.mocked(warn)).not.toHaveBeenCalledWith(
      expect.stringContaining('Duplicate'),
      expect.anything()
    );
  });
});

describe('store lock auto-expiry (ADV-344)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('storeResumenBancario uses STORE_LOCK_AUTO_EXPIRY_MS (900 000 ms) as 4th withLock argument', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
    vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

    await storeResumenBancario(createTestResumen(), 'spreadsheet-id');

    const calls = vi.mocked(withLock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][3]).toBe(900000); // STORE_LOCK_AUTO_EXPIRY_MS
  });

  it('storeResumenTarjeta uses STORE_LOCK_AUTO_EXPIRY_MS (900 000 ms) as 4th withLock argument', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
    vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

    await storeResumenTarjeta(createTestResumenTarjeta(), 'spreadsheet-id');

    const calls = vi.mocked(withLock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][3]).toBe(900000); // STORE_LOCK_AUTO_EXPIRY_MS
  });

  it('storeResumenBroker uses STORE_LOCK_AUTO_EXPIRY_MS (900 000 ms) as 4th withLock argument', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
    vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

    await storeResumenBroker(createTestResumenBroker(), 'spreadsheet-id');

    const calls = vi.mocked(withLock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][3]).toBe(900000); // STORE_LOCK_AUTO_EXPIRY_MS
  });
});
