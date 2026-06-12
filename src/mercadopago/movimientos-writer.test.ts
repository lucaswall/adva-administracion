/**
 * Tests for MP movimientos writer
 * Idempotent incremental append to per-month tabs in a Movimientos spreadsheet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeMpMovimientos } from './movimientos-writer.js';
import type { MovimientoBancario } from '../types/index.js';

// Mock dependencies
vi.mock('../services/sheets.js', () => ({
  getOrCreateMonthSheet: vi.fn(),
  appendRowsWithLinks: vi.fn(),
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

vi.mock('../constants/spreadsheet-headers.js', () => ({
  MOVIMIENTOS_BANCARIO_SHEET: {
    headers: [
      'fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado',
      'matchedFileId', 'matchedType', 'detalle',
    ],
  },
}));

import {
  getOrCreateMonthSheet,
  appendRowsWithLinks,
  getValues,
} from '../services/sheets.js';

// Helper: build a pair of MovimientoBancario rows for one MP payment op
function makeMpOp(
  id: string,
  fecha: string,
  creditoAmount: number,
  feeAmount: number
): MovimientoBancario[] {
  return [
    {
      fecha,
      concepto: `MP ${id} - CUIT 20123456786 - Unipersonal`,
      credito: creditoAmount,
      debito: null,
      saldo: creditoAmount,
    },
    {
      fecha,
      concepto: `MP ${id} - Comisión Mercado Pago`,
      credito: null,
      debito: feeAmount,
      saldo: creditoAmount - feeAmount,
    },
  ];
}

describe('writeMpMovimientos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Empty / new month tab ────────────────────────────────────────────────

  describe('empty/new month tab', () => {
    it('writes SALDO INICIAL row followed by all movimiento rows (no SALDO FINAL)', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      // Empty sheet: header row only
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      const movimientos = makeMpOp('111', '2026-05-10', 1000, 30);

      const result = await writeMpMovimientos(
        'spreadsheet-id',
        '2026-05',
        movimientos,
        5000
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appended).toBe(2);
        expect(result.value.skippedExisting).toBe(0);
      }

      expect(appendRowsWithLinks).toHaveBeenCalledTimes(1);
      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];

      // SALDO INICIAL + 2 movimiento rows = 3 rows total
      expect(rows).toHaveLength(3);

      // First row is SALDO INICIAL
      expect(rows[0][1]).toBe('SALDO INICIAL');
      // saldoCalculado column (index 5) holds the initial balance as CellNumber
      expect(rows[0][5]).toEqual({ type: 'number', value: 5000 });

      // No SALDO FINAL row
      const lastRow = rows[rows.length - 1];
      expect(lastRow[1]).not.toBe('SALDO FINAL');
    });

    it('writes movimiento rows with running balance formulas starting from SALDO INICIAL', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      const movimientos = makeMpOp('111', '2026-05-10', 1000, 30);

      await writeMpMovimientos('spreadsheet-id', '2026-05', movimientos, 5000);

      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];

      // Row 0: SALDO INICIAL (sheet row 2)
      // Row 1: first movimiento (sheet row 3) → formula =F2+D3-C3
      // Row 2: second movimiento (sheet row 4) → formula =F3+D4-C4
      expect(rows[1][5]).toEqual({ type: 'formula', value: '=F2+D3-C3' });
      expect(rows[2][5]).toEqual({ type: 'formula', value: '=F3+D4-C4' });
    });

    it('uses getOrCreateMonthSheet with MOVIMIENTOS_BANCARIO_SHEET headers', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      await writeMpMovimientos('spreadsheet-id', '2026-05', makeMpOp('111', '2026-05-10', 100, 3), 0);

      expect(getOrCreateMonthSheet).toHaveBeenCalledWith(
        'spreadsheet-id',
        '2026-05',
        expect.arrayContaining(['fecha', 'concepto']),
        undefined
      );
    });

    it('appends to range {periodo}!A:I', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      await writeMpMovimientos('spreadsheet-id', '2026-05', makeMpOp('111', '2026-05-10', 100, 3), 0);

      expect(appendRowsWithLinks).toHaveBeenCalledWith(
        'spreadsheet-id',
        '2026-05!A:I',
        expect.any(Array)
      );
    });
  });

  // ─── Incremental append (existing tab) ───────────────────────────────────

  describe('incremental append to existing tab', () => {
    it('appends only new op rows when tab already has some ops', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      // Existing sheet: header + SALDO INICIAL + 2 rows (op 111) + 2 rows (op 222)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'matchedType', 'detalle'],
          [null, 'SALDO INICIAL', null, null, null, 5000, '', '', ''],
          ['2026-05-01', 'MP 111 - CUIT 20123456786 - Unipersonal', null, 500, 500, '=F2+D3-C3', '', '', ''],
          ['2026-05-01', 'MP 111 - Comisión Mercado Pago', 15, null, 485, '=F3+D4-C4', '', '', ''],
          ['2026-05-02', 'MP 222 - CUIT 20123456786 - Unipersonal', null, 800, 800, '=F4+D5-C5', '', '', ''],
          ['2026-05-02', 'MP 222 - Comisión Mercado Pago', 24, null, 776, '=F5+D6-C6', '', '', ''],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      // Call with ops 111, 222, 333
      const movimientos = [
        ...makeMpOp('111', '2026-05-01', 500, 15),
        ...makeMpOp('222', '2026-05-02', 800, 24),
        ...makeMpOp('333', '2026-05-03', 1200, 36),
      ];

      const result = await writeMpMovimientos(
        'spreadsheet-id',
        '2026-05',
        movimientos,
        5000
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 4 existing ops skipped (2 rows each = 4 rows total for ops 111 and 222)
        expect(result.value.appended).toBe(2);      // op 333 rows
        expect(result.value.skippedExisting).toBe(4); // ops 111+222 rows
      }

      expect(appendRowsWithLinks).toHaveBeenCalledTimes(1);
      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];

      // Only op 333's 2 rows should be appended (no SALDO INICIAL)
      expect(rows).toHaveLength(2);
      expect(rows[0][1]).toBe('MP 333 - CUIT 20123456786 - Unipersonal');
      expect(rows[1][1]).toBe('MP 333 - Comisión Mercado Pago');
    });

    it('continues formula row offsets from existing chain', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      // Existing: header + SALDO INICIAL + 4 rows (ops 111, 222) = 6 rows total
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'matchedType', 'detalle'],
          [null, 'SALDO INICIAL', null, null, null, 5000, '', '', ''],
          ['2026-05-01', 'MP 111 - CUIT 20123456786 - Unipersonal', null, 500, 500, '=F2+D3-C3', '', '', ''],
          ['2026-05-01', 'MP 111 - Comisión Mercado Pago', 15, null, 485, '=F3+D4-C4', '', '', ''],
          ['2026-05-02', 'MP 222 - CUIT 20123456786 - Unipersonal', null, 800, 800, '=F4+D5-C5', '', '', ''],
          ['2026-05-02', 'MP 222 - Comisión Mercado Pago', 24, null, 776, '=F5+D6-C6', '', '', ''],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      const movimientos = [
        ...makeMpOp('333', '2026-05-03', 1200, 36),
      ];

      await writeMpMovimientos('spreadsheet-id', '2026-05', movimientos, 5000);

      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];

      // Existing 5 data rows → startRowOffset = 5
      // New rows appended at sheet rows 7 and 8 (after header=1, data=5)
      // First new row (op 333 credit): rowIndex=0, offset=5 → prev=6, curr=7 → =F6+D7-C7
      // Second new row (op 333 fee): rowIndex=1, offset=5 → prev=7, curr=8 → =F7+D8-C8
      expect(rows[0][5]).toEqual({ type: 'formula', value: '=F6+D7-C7' });
      expect(rows[1][5]).toEqual({ type: 'formula', value: '=F7+D8-C8' });
    });

    it('does not write SALDO INICIAL on incremental append', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'matchedType', 'detalle'],
          [null, 'SALDO INICIAL', null, null, null, 5000, '', '', ''],
          ['2026-05-01', 'MP 111 - CUIT 20123456786 - Unipersonal', null, 500, 500, '=F2+D3-C3', '', '', ''],
          ['2026-05-01', 'MP 111 - Comisión Mercado Pago', 15, null, 485, '=F3+D4-C4', '', '', ''],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      await writeMpMovimientos('spreadsheet-id', '2026-05', makeMpOp('222', '2026-05-02', 800, 24), 5000);

      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];
      // Should only have 2 rows (op 222 credit + fee), no SALDO INICIAL
      expect(rows).toHaveLength(2);
      expect(rows[0][1]).not.toBe('SALDO INICIAL');
    });
  });

  // ─── Idempotency ─────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns appended=0 and counts skipped when all ops already exist', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'matchedType', 'detalle'],
          [null, 'SALDO INICIAL', null, null, null, 5000, '', '', ''],
          ['2026-05-01', 'MP 111 - CUIT 20123456786 - Unipersonal', null, 500, 500, '=F2+D3-C3', '', '', ''],
          ['2026-05-01', 'MP 111 - Comisión Mercado Pago', 15, null, 485, '=F3+D4-C4', '', '', ''],
        ],
      });

      const result = await writeMpMovimientos(
        'spreadsheet-id',
        '2026-05',
        makeMpOp('111', '2026-05-01', 500, 15),
        5000
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appended).toBe(0);
        expect(result.value.skippedExisting).toBe(2); // 2 rows for op 111
      }

      // Must NOT call appendRowsWithLinks when nothing new to append
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('skips both credit and fee rows of an op when op id already exists', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      // op 111 is already present (both credit and fee rows)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'matchedType', 'detalle'],
          [null, 'SALDO INICIAL', null, null, null, 5000, '', '', ''],
          ['2026-05-01', 'MP 111 - CUIT 20123456786 - Unipersonal', null, 500, 500, '=F2+D3-C3', '', '', ''],
          ['2026-05-01', 'MP 111 - Comisión Mercado Pago', 15, null, 485, '=F3+D4-C4', '', '', ''],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      // Pass both op 111 and op 222; only op 222 should be new
      const movimientos = [
        ...makeMpOp('111', '2026-05-01', 500, 15),  // already exists → skip both rows
        ...makeMpOp('222', '2026-05-02', 800, 24),  // new → append both rows
      ];

      const result = await writeMpMovimientos(
        'spreadsheet-id',
        '2026-05',
        movimientos,
        5000
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appended).toBe(2);
        expect(result.value.skippedExisting).toBe(2);
      }

      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];
      expect(rows).toHaveLength(2);
      // Only op 222 rows
      expect(rows[0][1]).toContain('MP 222');
      expect(rows[1][1]).toContain('MP 222');
    });
  });

  // ─── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns ok:false when getValues fails (never blind-append)', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({ ok: false, error: new Error('Sheets API error') });

      const result = await writeMpMovimientos(
        'spreadsheet-id',
        '2026-05',
        makeMpOp('111', '2026-05-01', 500, 15),
        5000
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Sheets API error');
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('returns ok:false when getOrCreateMonthSheet fails', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({
        ok: false,
        error: new Error('Sheet creation failed'),
      });

      const result = await writeMpMovimientos(
        'spreadsheet-id',
        '2026-05',
        makeMpOp('111', '2026-05-01', 500, 15),
        5000
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Sheet creation failed');
      }
    });

    it('returns ok:false when appendRowsWithLinks fails', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({
        ok: false,
        error: new Error('Append failed'),
      });

      const result = await writeMpMovimientos(
        'spreadsheet-id',
        '2026-05',
        makeMpOp('111', '2026-05-01', 500, 15),
        5000
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Append failed');
      }
    });
  });

  // ─── Dedupe key parsing ────────────────────────────────────────────────────

  describe('dedupe key: MP {id} prefix parsing', () => {
    it('parses MP op id from concepto with CUIT suffix', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'matchedType', 'detalle'],
          [null, 'SALDO INICIAL', null, null, null, 5000, '', '', ''],
          // MP 999888777666 already exists (both rows)
          ['2026-05-01', 'MP 999888777666 - CUIT 27234567891 - Empresa', null, 300, 300, '=F2+D3-C3', '', '', ''],
          ['2026-05-01', 'MP 999888777666 - Comisión Mercado Pago', 9, null, 291, '=F3+D4-C4', '', '', ''],
        ],
      });

      const movimientos: MovimientoBancario[] = [
        {
          fecha: '2026-05-01',
          concepto: 'MP 999888777666 - CUIT 27234567891 - Empresa',
          credito: 300,
          debito: null,
          saldo: 300,
        },
        {
          fecha: '2026-05-01',
          concepto: 'MP 999888777666 - Comisión Mercado Pago',
          credito: null,
          debito: 9,
          saldo: 291,
        },
      ];

      const result = await writeMpMovimientos('spreadsheet-id', '2026-05', movimientos, 5000);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appended).toBe(0);
        expect(result.value.skippedExisting).toBe(2);
      }
    });

    it('treats SALDO INICIAL concepto as not an MP op id (does not dedupe against it)', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      // Only SALDO INICIAL exists (no MP op rows yet)
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'matchedType', 'detalle'],
          [null, 'SALDO INICIAL', null, null, null, 5000, '', '', ''],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      const result = await writeMpMovimientos(
        'spreadsheet-id',
        '2026-05',
        makeMpOp('111', '2026-05-01', 500, 15),
        5000
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Both rows should be appended (SALDO INICIAL is not an op id)
        expect(result.value.appended).toBe(2);
        expect(result.value.skippedExisting).toBe(0);
      }
    });
  });

  // ─── Row formatting ────────────────────────────────────────────────────────

  describe('row formatting', () => {
    it('formats fecha as CellDate, debito/credito/saldo as CellNumber', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      const movimientos: MovimientoBancario[] = [
        {
          fecha: '2026-05-10',
          concepto: 'MP 111 - CUIT 20123456786 - Unipersonal',
          credito: 1000,
          debito: null,
          saldo: 6000,
        },
        {
          fecha: '2026-05-10',
          concepto: 'MP 111 - Comisión Mercado Pago',
          credito: null,
          debito: 30,
          saldo: 5970,
        },
      ];

      await writeMpMovimientos('spreadsheet-id', '2026-05', movimientos, 5000);

      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];
      const creditRow = rows[1]; // index 1 (after SALDO INICIAL at 0)
      const feeRow = rows[2];

      // fecha
      expect(creditRow[0]).toEqual({ type: 'date', value: '2026-05-10' });
      expect(feeRow[0]).toEqual({ type: 'date', value: '2026-05-10' });

      // credito
      expect(creditRow[3]).toEqual({ type: 'number', value: 1000 });
      expect(feeRow[3]).toBeNull();

      // debito
      expect(creditRow[2]).toBeNull();
      expect(feeRow[2]).toEqual({ type: 'number', value: 30 });

      // saldo
      expect(creditRow[4]).toEqual({ type: 'number', value: 6000 });
    });

    it('writes empty strings for matchedFileId, matchedType, detalle columns', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      await writeMpMovimientos('spreadsheet-id', '2026-05', makeMpOp('111', '2026-05-10', 100, 3), 0);

      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];
      const txRow = rows[1]; // first movimiento

      expect(txRow[6]).toBe(''); // matchedFileId
      expect(txRow[7]).toBe(''); // matchedType
      expect(txRow[8]).toBe(''); // detalle
    });

    it('each row has 9 columns', async () => {
      vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

      await writeMpMovimientos('spreadsheet-id', '2026-05', makeMpOp('111', '2026-05-10', 100, 3), 0);

      const rows = vi.mocked(appendRowsWithLinks).mock.calls[0][2] as unknown[][];
      rows.forEach(row => expect(row).toHaveLength(9));
    });
  });
});
