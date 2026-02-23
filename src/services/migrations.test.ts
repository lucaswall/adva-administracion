import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  batchUpdate: vi.fn(),
  getSheetMetadata: vi.fn(),
}));

vi.mock('./folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

import { migrateMovimientosColumns, runStartupMigrations } from './migrations.js';
import { getValues, batchUpdate, getSheetMetadata } from './sheets.js';
import { getCachedFolderStructure } from './folder-structure.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('migrateMovimientosColumns', () => {
  it('should migrate 8-column sheet: move detalle from H to I, add matchedType at H', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    // G:I data — old layout: G=matchedFileId, H=detalle, I=empty
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['matchedFileId', 'detalle', ''],  // header row
        ['file-1', 'Pago a proveedor', ''],  // data row
        ['', '', ''],  // empty row
      ],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 6 });

    const result = await migrateMovimientosColumns('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);

    const calls = vi.mocked(batchUpdate).mock.calls[0];
    const updates = calls[1];

    // Header row: H=matchedType, I=detalle
    expect(updates[0]).toEqual({
      range: "'2025-01'!H1:I1",
      values: [['matchedType', 'detalle']],
    });

    // Data row: H='' (no matchedType), I='Pago a proveedor' (moved from H)
    expect(updates[1]).toEqual({
      range: "'2025-01'!H2:I2",
      values: [['', 'Pago a proveedor']],
    });
  });

  it('should skip sheets already in correct layout', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    // Already correct: G=matchedFileId, H=matchedType, I=detalle
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['matchedFileId', 'matchedType', 'detalle'],
        ['file-1', 'AUTO', 'Pago a proveedor'],
      ],
    });

    const result = await migrateMovimientosColumns('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('should handle swapped layout: detalle at H, matchedType at I', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    // Wrong order from previous bad migration
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['matchedFileId', 'detalle', 'matchedType'],
        ['file-1', 'Pago a proveedor', 'AUTO'],
      ],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 4 });

    const result = await migrateMovimientosColumns('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);

    const updates = vi.mocked(batchUpdate).mock.calls[0][1];

    // Data row: swap values — H='AUTO' (was in I), I='Pago a proveedor' (was in H)
    expect(updates[1]).toEqual({
      range: "'2025-01'!H2:I2",
      values: [['AUTO', 'Pago a proveedor']],
    });
  });

  it('should skip non-month sheets', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: 'Resumenes', sheetId: 1, index: 0 },
        { title: '2025-01', sheetId: 2, index: 1 },
      ],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['matchedFileId', 'detalle', '']],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 2 });

    const result = await migrateMovimientosColumns('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
    // Only called for 2025-01, not Resumenes
    expect(getValues).toHaveBeenCalledTimes(1);
  });

  it('should migrate multiple sheets in the same spreadsheet', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: '2025-01', sheetId: 1, index: 0 },
        { title: '2025-02', sheetId: 2, index: 1 },
      ],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['matchedFileId', 'detalle', '']],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 2 });

    const result = await migrateMovimientosColumns('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(2);
    expect(batchUpdate).toHaveBeenCalledTimes(2);
  });

  it('should handle getSheetMetadata failure', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: false,
      error: new Error('API error'),
    });

    const result = await migrateMovimientosColumns('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(false);
  });

  it('should continue if one sheet fails to read', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: '2025-01', sheetId: 1, index: 0 },
        { title: '2025-02', sheetId: 2, index: 1 },
      ],
    });
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: false, error: new Error('Read failed') })
      .mockResolvedValueOnce({
        ok: true,
        value: [['matchedFileId', 'detalle', '']],
      });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 2 });

    const result = await migrateMovimientosColumns('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
  });

  it('should preserve existing matchedFileId data in column G', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['matchedFileId', 'detalle', ''],
        ['abc123', 'FC-A-0001-00001234 EMPRESA SA', ''],
        ['def456', 'Gastos bancarios', ''],
      ],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 6 });

    await migrateMovimientosColumns('spreadsheet-1', 'Test Bank');

    const updates = vi.mocked(batchUpdate).mock.calls[0][1];
    // Only updates H:I, not G — matchedFileId untouched
    expect(updates[1].range).toBe("'2025-01'!H2:I2");
    expect(updates[1].values).toEqual([['', 'FC-A-0001-00001234 EMPRESA SA']]);
    expect(updates[2].range).toBe("'2025-01'!H3:I3");
    expect(updates[2].values).toEqual([['', 'Gastos bancarios']]);
  });
});

describe('runStartupMigrations', () => {
  it('should skip when folder structure is not initialized', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(null);

    await runStartupMigrations();

    expect(getSheetMetadata).not.toHaveBeenCalled();
  });

  it('should skip when no movimientos spreadsheets exist', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue({
      movimientosSpreadsheets: new Map(),
    } as any);

    await runStartupMigrations();

    expect(getSheetMetadata).not.toHaveBeenCalled();
  });

  it('should migrate all movimientos spreadsheets', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue({
      movimientosSpreadsheets: new Map([
        ['2025:BBVA 123 ARS', 'ss-1'],
        ['2025:MACRO 456 ARS', 'ss-2'],
      ]),
    } as any);
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['matchedFileId', 'detalle', '']],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 2 });

    await runStartupMigrations();

    expect(getSheetMetadata).toHaveBeenCalledTimes(2);
    expect(batchUpdate).toHaveBeenCalledTimes(2);
  });

  it('should continue if one spreadsheet migration fails', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue({
      movimientosSpreadsheets: new Map([
        ['2025:BBVA 123 ARS', 'ss-1'],
        ['2025:MACRO 456 ARS', 'ss-2'],
      ]),
    } as any);
    vi.mocked(getSheetMetadata)
      .mockResolvedValueOnce({ ok: false, error: new Error('API error') })
      .mockResolvedValueOnce({
        ok: true,
        value: [{ title: '2025-01', sheetId: 1, index: 0 }],
      });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['matchedFileId', 'detalle', '']],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 2 });

    await runStartupMigrations();

    // Second spreadsheet should still be processed
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });
});
