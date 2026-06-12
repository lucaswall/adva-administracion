/**
 * Tests for MP resumen writer
 * Writes synthetic ResumenBancario rows for closed MP periods
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeMpResumenIfClosed } from './resumen-writer.js';
import type { MovimientoRow } from '../types/index.js';

// Mock dependencies
vi.mock('../services/sheets.js', () => ({
  getValues: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../utils/concurrency.js', () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../services/movimientos-reader.js', () => ({
  readMovimientosForPeriod: vi.fn(),
}));

vi.mock('../processing/storage/resumen-store.js', () => ({
  storeResumenBancario: vi.fn(),
}));

import { getValues } from '../services/sheets.js';
import { readMovimientosForPeriod } from '../services/movimientos-reader.js';
import { storeResumenBancario } from '../processing/storage/resumen-store.js';
import { info, error as logErrorMock, warn as warnMock } from '../utils/logger.js';

// Helper: create a MovimientoRow matching what readMovimientosForPeriod returns
function makeMovimientoRow(
  overrides: Partial<MovimientoRow> = {}
): MovimientoRow {
  return {
    sheetName: '2026-05',
    rowNumber: 2,
    fecha: '2026-05-10',
    concepto: 'MP 111 - CUIT 20123456786 - Unipersonal',
    credito: 1000,
    debito: null,
    saldo: 1000,
    saldoCalculado: 1000,
    matchedFileId: '',
    detalle: '',
    matchedType: '',
    ...overrides,
  };
}

describe('writeMpResumenIfClosed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Closed period writes resumen ──────────────────────────────────────────

  describe('closed period', () => {
    it('writes a ResumenBancario row for a past month via storeResumenBancario', async () => {
      // No previous period resumen found
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal', 'balanceOk', 'balanceDiff']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [
          makeMovimientoRow({ credito: 1000, debito: null }),
          makeMovimientoRow({ credito: null, debito: 30, concepto: 'MP 111 - Comisión Mercado Pago' }),
        ],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      const result = await writeMpResumenIfClosed(
        'control-spreadsheet-id',
        'movimientos-spreadsheet-id',
        '2026-05',
        { collectorId: '123456789' },
        '2026-06-12'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.written).toBe(true);
      }

      expect(storeResumenBancario).toHaveBeenCalledTimes(1);
    });

    it('computes saldoFinal = saldoInicial + Σcredito - Σdebito', async () => {
      // Previous period resumen row with saldoFinal = 5000
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal', 'balanceOk', 'balanceDiff'],
          ['2026-04', '2026-04-01', '2026-04-30', 'old-file-id', 'old.pdf', 'Mercado Pago', '123456789', 'ARS', 3000, 5000, 'SI', 0],
        ],
      });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [
          makeMovimientoRow({ credito: 1000, debito: null }),    // +1000
          makeMovimientoRow({ credito: null, debito: 30 }),       // -30
          makeMovimientoRow({ credito: 2000, debito: null }),    // +2000
        ],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'control-spreadsheet-id',
        'movimientos-spreadsheet-id',
        '2026-05',
        { collectorId: '123456789' },
        '2026-06-12'
      );

      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      // saldoInicial = 5000 (previous period saldoFinal)
      expect(callArg.saldoInicial).toBe(5000);
      // saldoFinal = 5000 + 1000 - 30 + 2000 = 7970
      expect(callArg.saldoFinal).toBe(7970);
    });

    it('uses saldoInicial = 0 when no previous period resumen exists', async () => {
      // Empty Resumenes sheet (header only)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal', 'balanceOk', 'balanceDiff']],
      });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [
          makeMovimientoRow({ credito: 500, debito: null }),
          makeMovimientoRow({ credito: null, debito: 15 }),
        ],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'control-spreadsheet-id',
        'movimientos-spreadsheet-id',
        '2026-05',
        { collectorId: '123456789' },
        '2026-06-12'
      );

      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg.saldoInicial).toBe(0);
      expect(callArg.saldoFinal).toBe(485); // 0 + 500 - 15
    });

    it('passes correct fixed fields to storeResumenBancario', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow({ credito: 100, debito: null })],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'control-spreadsheet-id',
        'mov-spreadsheet-id',
        '2026-05',
        { collectorId: '987654321' },
        '2026-06-12'
      );

      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg.banco).toBe('Mercado Pago');
      expect(callArg.numeroCuenta).toBe('987654321');
      expect(callArg.moneda).toBe('ARS');
      expect(callArg.fechaDesde).toBe('2026-05-01');
      expect(callArg.fechaHasta).toBe('2026-05-31');
      expect(callArg.fileId).toBe('mov-spreadsheet-id');
      expect(callArg.fileName).toBe('2026-05 - Resumen - Mercado Pago - 987654321 ARS');
      expect(callArg.confidence).toBe(1);
      expect(callArg.needsReview).toBe(false);
    });

    it('uses movimientos spreadsheet Drive URL format for hyperlink (drive.google.com/file/d/{id}/view)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow({ credito: 100, debito: null })],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'control-spreadsheet-id',
        'my-mov-sheet-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      // fileId is used by storeResumenBancario to construct the hyperlink URL
      // URL format: https://drive.google.com/file/d/{fileId}/view
      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg.fileId).toBe('my-mov-sheet-id');
      // The hyperlink URL (built inside storeResumenBancario) will be:
      // https://drive.google.com/file/d/my-mov-sheet-id/view
    });

    it('sets cantidadMovimientos to count of transaction rows (excluding SALDO INICIAL)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      // readMovimientosForPeriod already excludes SALDO INICIAL/FINAL
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [
          makeMovimientoRow({ credito: 100 }),
          makeMovimientoRow({ debito: 3 }),
          makeMovimientoRow({ credito: 200 }),
          makeMovimientoRow({ debito: 6 }),
        ],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'control-spreadsheet-id',
        'mov-spreadsheet-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg.cantidadMovimientos).toBe(4);
    });

    it('passes controlSpreadsheetId as the second argument to storeResumenBancario', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow()],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'control-sheet-id',
        'mov-sheet-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      expect(storeResumenBancario).toHaveBeenCalledWith(
        expect.any(Object),
        'control-sheet-id',
        undefined,
        { skipFileIdCheck: true }
      );
    });

    it('reads previous period resumen from Resumenes sheet of controlSpreadsheetId', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow()],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'ctrl-sheet',
        'mov-sheet',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      // getValues is called on the control spreadsheet for Resumenes
      expect(getValues).toHaveBeenCalledWith('ctrl-sheet', expect.stringContaining('Resumenes'));
    });

    it('looks up previous period (2026-04) when processing 2026-05', async () => {
      // Return a row for 2026-04 (the previous period)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal', 'balanceOk', 'balanceDiff'],
          // 2025-03 row (ignored — wrong banco)
          ['2026-04', '2026-04-01', '2026-04-30', 'old-id', 'old.pdf', 'BBVA', '111', 'ARS', 0, 100, 'SI', 0],
          // 2026-04 row with Mercado Pago and correct collectorId
          ['2026-04', '2026-04-01', '2026-04-30', 'prev-id', 'prev.pdf', 'Mercado Pago', '456', 'ARS', 0, 3000, 'SI', 0],
        ],
      });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow({ credito: 500, debito: null })],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'ctrl-sheet',
        'mov-sheet',
        '2026-05',
        { collectorId: '456' },
        '2026-06-12'
      );

      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg.saldoInicial).toBe(3000); // from Mercado Pago 456 row in 2026-04
    });

    it('handles cross-year boundary: previous period for 2026-01 is 2025-12', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['periodo', 'fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal', 'balanceOk', 'balanceDiff'],
          ['2025-12', '2025-12-01', '2025-12-31', 'prev-id', 'prev.pdf', 'Mercado Pago', '111', 'ARS', 0, 9999, 'SI', 0],
        ],
      });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow({ credito: 1, debito: null })],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'ctrl-sheet',
        'mov-sheet',
        '2026-01',
        { collectorId: '111' },
        '2026-02-10'
      );

      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg.saldoInicial).toBe(9999); // from 2025-12 row
    });

    it('balanceDiff is 0 by construction (saldos derive from same rows)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      const rows = [
        makeMovimientoRow({ credito: 500, debito: null }),
        makeMovimientoRow({ credito: null, debito: 15 }),
        makeMovimientoRow({ credito: 300, debito: null }),
      ];
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({ ok: true, value: rows });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      const { saldoInicial, saldoFinal, movimientos } = callArg;

      // Verify balanceDiff = 0 by construction
      // calculateBalanceDiff(saldoInicial, movimientos, saldoFinal) must be 0
      let computed = saldoInicial;
      for (const mov of (movimientos ?? [])) {
        computed += (mov.credito ?? 0) - (mov.debito ?? 0);
      }
      expect(computed - saldoFinal).toBe(0);
    });

    it('passes skipFileIdCheck to storeResumenBancario (MP fileId repeats across periods)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow({ credito: 100, debito: null })],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      // The ADV-308 fileId reprocessing check must be skipped: the MP fileId is
      // the movimientos spreadsheet id, shared by every period of the account —
      // without the skip, the second closed period would be silently dropped.
      expect(storeResumenBancario).toHaveBeenCalledWith(
        expect.anything(),
        'control-id',
        undefined,
        { skipFileIdCheck: true }
      );
    });

    it('returns written:false and does not call storeResumenBancario on duplicate (dedupe path)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow({ credito: 100, debito: null })],
      });
      // storeResumenBancario returns stored:false (duplicate detected by dedupe)
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: false, existingFileId: 'existing-id' },
      });

      const result = await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.written).toBe(false);
      }
    });
  });

  // ─── Open period (current month) ──────────────────────────────────────────

  describe('open period', () => {
    it('returns written:false for current month without calling storeResumenBancario', async () => {
      const result = await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-06',
        { collectorId: '123' },
        '2026-06-12'  // today is in 2026-06
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.written).toBe(false);
      }
      expect(storeResumenBancario).not.toHaveBeenCalled();
      expect(readMovimientosForPeriod).not.toHaveBeenCalled();
    });

    it('returns written:false for current month on the last day of the month', async () => {
      const result = await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-06',
        { collectorId: '123' },
        '2026-06-30'  // last day of June
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.written).toBe(false);
      }
    });

    it('proceeds for last month even on the first day of the new month', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({ ok: true, value: [makeMovimientoRow()] });
      vi.mocked(storeResumenBancario).mockResolvedValue({ ok: true, value: { stored: true } });

      const result = await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-01'  // first day of June → May is closed
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.written).toBe(true);
      }
      expect(storeResumenBancario).toHaveBeenCalled();
    });
  });

  // ─── Zero transaction rows ─────────────────────────────────────────────────

  describe('zero transaction rows', () => {
    it('returns written:false and logs info when period tab has no transactions', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({ ok: true, value: [] });

      const result = await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.written).toBe(false);
      }
      expect(storeResumenBancario).not.toHaveBeenCalled();
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining('no transactions'),
        expect.objectContaining({ periodo: '2026-05' })
      );
    });
  });

  // ─── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns ok:false when readMovimientosForPeriod fails', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: false,
        error: new Error('Sheets read error'),
      });

      const result = await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Sheets read error');
      }
    });

    it('returns ok:false when storeResumenBancario returns error', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow()],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: false,
        error: new Error('Store failed'),
      });

      const result = await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Store failed');
      }
    });

    it('uses saldoInicial=0 when Resumenes getValues fails gracefully', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: false,
        error: new Error('getValues failed'),
      });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({
        ok: true,
        value: [makeMovimientoRow({ credito: 100, debito: null })],
      });
      vi.mocked(storeResumenBancario).mockResolvedValue({
        ok: true,
        value: { stored: true },
      });

      const result = await writeMpResumenIfClosed(
        'control-id',
        'mov-id',
        '2026-05',
        { collectorId: '123' },
        '2026-06-12'
      );

      expect(result.ok).toBe(true);
      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg.saldoInicial).toBe(0);
    });
  });

  // ─── fechaDesde / fechaHasta ────────────────────────────────────────────────

  describe('period boundary dates', () => {
    it('fechaDesde is first day of periodo', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({ ok: true, value: [makeMovimientoRow()] });
      vi.mocked(storeResumenBancario).mockResolvedValue({ ok: true, value: { stored: true } });

      await writeMpResumenIfClosed('ctrl', 'mov', '2026-03', { collectorId: '1' }, '2026-04-01');

      const callArg = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg.fechaDesde).toBe('2026-03-01');
    });

    it('fechaHasta is last day of periodo (handles different month lengths)', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({ ok: true, value: [makeMovimientoRow()] });
      vi.mocked(storeResumenBancario).mockResolvedValue({ ok: true, value: { stored: true } });

      // February 2026 (non-leap year) → last day is 28
      await writeMpResumenIfClosed('ctrl', 'mov', '2026-02', { collectorId: '1' }, '2026-03-01');

      const callArg1 = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg1.fechaHasta).toBe('2026-02-28');

      vi.clearAllMocks();
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['periodo']] });
      vi.mocked(readMovimientosForPeriod).mockResolvedValue({ ok: true, value: [makeMovimientoRow()] });
      vi.mocked(storeResumenBancario).mockResolvedValue({ ok: true, value: { stored: true } });

      // May 2026 → 31 days
      await writeMpResumenIfClosed('ctrl', 'mov', '2026-05', { collectorId: '1' }, '2026-06-01');

      const callArg2 = vi.mocked(storeResumenBancario).mock.calls[0][0];
      expect(callArg2.fechaHasta).toBe('2026-05-31');
    });
  });

  // ─── Unexpected errors ────────────────────────────────────────────────────

  describe('unexpected errors', () => {
    it('logs at error level (not warn) and returns ok:false when a dependency throws', async () => {
      vi.mocked(getValues).mockRejectedValue(new Error('boom'));

      const result = await writeMpResumenIfClosed(
        'ctrl',
        'mov',
        '2026-05',
        { collectorId: '1' },
        '2026-06-12'
      );

      expect(result.ok).toBe(false);
      expect(vi.mocked(logErrorMock)).toHaveBeenCalled();
      expect(vi.mocked(warnMock)).not.toHaveBeenCalled();
    });
  });
});
