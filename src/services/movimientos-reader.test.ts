/**
 * Tests for movimientos-reader service
 * Reads bank movements from per-month sheets for matching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRecentMovimientoSheets,
  readMovimientosForPeriod,
  getMovimientosToFill,
  isSpecialRow,
} from './movimientos-reader.js';

// Mock dependencies
vi.mock('./sheets.js', () => ({
  getSheetMetadata: vi.fn(),
  getValues: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { getSheetMetadata, getValues } from './sheets.js';

describe('isSpecialRow', () => {
  it('should skip SALDO INICIAL', () => {
    expect(isSpecialRow('SALDO INICIAL')).toBe(true);
  });

  it('should skip SALDO INICIAL AJUSTADO', () => {
    expect(isSpecialRow('SALDO INICIAL AJUSTADO')).toBe(true);
  });

  it('should skip SALDO FINAL', () => {
    expect(isSpecialRow('SALDO FINAL')).toBe(true);
  });

  it('should skip with leading/trailing whitespace', () => {
    expect(isSpecialRow('  SALDO INICIAL  ')).toBe(true);
    expect(isSpecialRow('  SALDO FINAL  ')).toBe(true);
  });

  it('should skip case-insensitive', () => {
    expect(isSpecialRow('saldo inicial')).toBe(true);
    expect(isSpecialRow('Saldo Final')).toBe(true);
  });

  it('should not skip regular transaction rows', () => {
    expect(isSpecialRow('TRANSFERENCIA DESDE TEST SA')).toBe(false);
    expect(isSpecialRow('DEBITO AUTOMATICO')).toBe(false);
    expect(isSpecialRow('PAGO TARJETA')).toBe(false);
  });

  it('should not skip empty string', () => {
    expect(isSpecialRow('')).toBe(false);
  });
});

describe('getRecentMovimientoSheets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return sheets for current and previous year only', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: '2025-01', sheetId: 1, index: 0 },
        { title: '2025-06', sheetId: 2, index: 1 },
        { title: '2025-12', sheetId: 3, index: 2 },
        { title: '2026-01', sheetId: 4, index: 3 },
        { title: '2024-12', sheetId: 5, index: 4 },  // Previous year
        { title: '2023-12', sheetId: 6, index: 5 },  // Too old - excluded
        { title: 'Resumenes', sheetId: 7, index: 6 }, // Not YYYY-MM - excluded
      ],
    });

    const result = await getRecentMovimientoSheets('spreadsheet-id', 2026);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('2026-01');
      expect(result.value).toContain('2025-01');
      expect(result.value).toContain('2025-06');
      expect(result.value).toContain('2025-12');
      expect(result.value).not.toContain('2024-12');  // Too old (only current + previous year)
      expect(result.value).not.toContain('2023-12');  // Way too old
      expect(result.value).not.toContain('Resumenes'); // Not YYYY-MM format
    }
  });

  it('should return empty array if no matching sheets', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: 'Resumenes', sheetId: 1, index: 0 },
        { title: 'Config', sheetId: 2, index: 1 },
      ],
    });

    const result = await getRecentMovimientoSheets('spreadsheet-id', 2026);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('should propagate error from getSheetMetadata', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: false,
      error: new Error('API error'),
    });

    const result = await getRecentMovimientoSheets('spreadsheet-id', 2026);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API error');
    }
  });

  it('should filter by YYYY-MM regex pattern', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: '2026-01', sheetId: 1, index: 0 },
        { title: '2026-1', sheetId: 2, index: 1 },    // Invalid format
        { title: '26-01', sheetId: 3, index: 2 },     // Invalid format
        { title: '2026-13', sheetId: 4, index: 3 },   // Invalid month (matches pattern but ok)
        { title: '2026-00', sheetId: 5, index: 4 },   // Invalid month (matches pattern but ok)
      ],
    });

    const result = await getRecentMovimientoSheets('spreadsheet-id', 2026);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('2026-01');
      expect(result.value).not.toContain('2026-1');
      expect(result.value).not.toContain('26-01');
      // Pattern matches but month is invalid - we allow it (regex only validates format)
      expect(result.value).toContain('2026-13');
      expect(result.value).toContain('2026-00');
    }
  });
});

describe('readMovimientosForPeriod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse movimientos correctly from sheet data', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        ['2025-01-15', 'TRANSFERENCIA TEST SA', 1000, null, 9000, 9000, '', ''],
        ['2025-01-16', 'DEPOSITO', null, 5000, 14000, 14000, 'file123', 'Cobro Factura'],
      ],
    });

    const result = await readMovimientosForPeriod('spreadsheet-id', '2025-01');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);

      const mov1 = result.value[0];
      expect(mov1.sheetName).toBe('2025-01');
      expect(mov1.rowNumber).toBe(2);  // Row 2 (1-indexed, after header)
      expect(mov1.fecha).toBe('2025-01-15');
      expect(mov1.concepto).toBe('TRANSFERENCIA TEST SA');
      expect(mov1.debito).toBe(1000);
      expect(mov1.credito).toBeNull();
      expect(mov1.saldo).toBe(9000);
      expect(mov1.matchedFileId).toBe('');
      expect(mov1.detalle).toBe('');

      const mov2 = result.value[1];
      expect(mov2.rowNumber).toBe(3);
      expect(mov2.credito).toBe(5000);
      expect(mov2.matchedFileId).toBe('file123');
      expect(mov2.detalle).toBe('Cobro Factura');
    }
  });

  it('should skip SALDO INICIAL and SALDO FINAL rows', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        [null, 'SALDO INICIAL', null, null, null, 10000, '', ''],
        ['2025-01-15', 'TRANSFERENCIA', 1000, null, 9000, 9000, '', ''],
        [null, 'SALDO FINAL', null, null, null, 9000, '', ''],
      ],
    });

    const result = await readMovimientosForPeriod('spreadsheet-id', '2025-01');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].concepto).toBe('TRANSFERENCIA');
    }
  });

  it('should skip SALDO INICIAL AJUSTADO rows', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        [null, 'SALDO INICIAL AJUSTADO', null, null, null, 10000, '', ''],
        ['2025-01-15', 'PAGO', 500, null, 9500, 9500, '', ''],
      ],
    });

    const result = await readMovimientosForPeriod('spreadsheet-id', '2025-01');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].concepto).toBe('PAGO');
    }
  });

  it('should handle empty sheet (header only)', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
      ],
    });

    const result = await readMovimientosForPeriod('spreadsheet-id', '2025-01');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('should handle missing columns gracefully', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        ['2025-01-15', 'PAGO'],  // Missing columns
      ],
    });

    const result = await readMovimientosForPeriod('spreadsheet-id', '2025-01');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].debito).toBeNull();
      expect(result.value[0].credito).toBeNull();
      expect(result.value[0].matchedFileId).toBe('');
      expect(result.value[0].detalle).toBe('');
    }
  });

  it('should propagate error from getValues', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: false,
      error: new Error('Sheet read error'),
    });

    const result = await readMovimientosForPeriod('spreadsheet-id', '2025-01');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Sheet read error');
    }
  });

  it('should normalize serial number dates via normalizeSpreadsheetDate', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        [45993, 'TRANSFERENCIA TEST SA', 1000, null, 9000, 9000, '', ''],
        [45671, 'DEPOSITO', null, 5000, 14000, 14000, 'file123', 'Cobro'],
      ],
    });

    const result = await readMovimientosForPeriod('spreadsheet-id', '2025-12');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      // Serial number 45993 should be converted to '2025-12-02'
      expect(result.value[0].fecha).toBe('2025-12-02');
      // Serial number 45671 should be converted to '2025-01-14'
      expect(result.value[1].fecha).toBe('2025-01-14');
    }
  });

  it('should pass through string dates unchanged', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        ['2025-01-15', 'TRANSFERENCIA', 1000, null, 9000, 9000, '', ''],
      ],
    });

    const result = await readMovimientosForPeriod('spreadsheet-id', '2025-01');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].fecha).toBe('2025-01-15');
    }
  });

  it('should use correct range format with quoted sheet name', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['header']],
    });

    await readMovimientosForPeriod('spreadsheet-id', '2025-01');

    expect(getValues).toHaveBeenCalledWith('spreadsheet-id', "'2025-01'!A:H");
  });
});

describe('getMovimientosToFill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read all movimientos from all recent sheets', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: '2025-01', sheetId: 1, index: 0 },
        { title: '2025-02', sheetId: 2, index: 1 },
      ],
    });

    vi.mocked(getValues)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
          ['2025-01-15', 'TX1', 1000, null, 9000, 9000, '', ''],
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
          ['2025-02-10', 'TX2', null, 2000, 11000, 11000, '', ''],
        ],
      });

    const result = await getMovimientosToFill('spreadsheet-id', 2025);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].concepto).toBe('TX1');
      expect(result.value[1].concepto).toBe('TX2');
    }
  });

  it('should return all movimientos including those with existing matches (for replacement logic)', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: '2025-01', sheetId: 1, index: 0 },
      ],
    });

    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        ['2025-01-15', 'TX1', 1000, null, 9000, 9000, '', ''],  // No match
        ['2025-01-16', 'TX2', null, 2000, 11000, 11000, 'file123', 'Existing match'],  // Has match
      ],
    });

    const result = await getMovimientosToFill('spreadsheet-id', 2025);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      // Both returned - replacement logic will decide what to update
      expect(result.value[0].matchedFileId).toBe('');
      expect(result.value[1].matchedFileId).toBe('file123');
    }
  });

  it('should propagate error from getSheetMetadata', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: false,
      error: new Error('Metadata error'),
    });

    const result = await getMovimientosToFill('spreadsheet-id', 2025);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Metadata error');
    }
  });

  it('should continue processing if one sheet fails (partial results)', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: '2025-01', sheetId: 1, index: 0 },
        { title: '2025-02', sheetId: 2, index: 1 },
      ],
    });

    vi.mocked(getValues)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
          ['2025-01-15', 'TX1', 1000, null, 9000, 9000, '', ''],
        ],
      })
      .mockResolvedValueOnce({
        ok: false,
        error: new Error('Sheet 2 error'),
      });

    const result = await getMovimientosToFill('spreadsheet-id', 2025);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should have movimientos from first sheet
      expect(result.value).toHaveLength(1);
      expect(result.value[0].concepto).toBe('TX1');
    }
  });

  it('should return empty array when no recent sheets exist', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: 'Resumenes', sheetId: 1, index: 0 },
      ],
    });

    const result = await getMovimientosToFill('spreadsheet-id', 2025);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });
});
