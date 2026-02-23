import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  setValues: vi.fn(),
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

import { migrateMovimientosMatchedType, runStartupMigrations } from './migrations.js';
import { getValues, setValues, getSheetMetadata } from './sheets.js';
import { getCachedFolderStructure } from './folder-structure.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('migrateMovimientosMatchedType', () => {
  it('should add matchedType header to sheets with only 8 columns', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle']],
    });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await migrateMovimientosMatchedType('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
    expect(setValues).toHaveBeenCalledWith('spreadsheet-1', "'2025-01'!I1", [['matchedType']]);
  });

  it('should skip sheets that already have matchedType header', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle', 'matchedType']],
    });

    const result = await migrateMovimientosMatchedType('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
    expect(setValues).not.toHaveBeenCalled();
  });

  it('should skip non-month sheets (e.g., Resumenes)', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: 'Resumenes', sheetId: 1, index: 0 },
        { title: '2025-01', sheetId: 2, index: 1 },
      ],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle']],
    });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await migrateMovimientosMatchedType('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
    // Only called for 2025-01, not Resumenes
    expect(getValues).toHaveBeenCalledTimes(1);
    expect(setValues).toHaveBeenCalledTimes(1);
  });

  it('should migrate multiple sheets in the same spreadsheet', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: '2025-01', sheetId: 1, index: 0 },
        { title: '2025-02', sheetId: 2, index: 1 },
        { title: '2025-03', sheetId: 3, index: 2 },
      ],
    });
    // All sheets have 8-column headers
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle']],
    });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await migrateMovimientosMatchedType('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(3);
    expect(setValues).toHaveBeenCalledTimes(3);
  });

  it('should handle getSheetMetadata failure', async () => {
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: false,
      error: new Error('API error'),
    });

    const result = await migrateMovimientosMatchedType('spreadsheet-1', 'Test Bank');

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
        value: [['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle']],
      });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await migrateMovimientosMatchedType('spreadsheet-1', 'Test Bank');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1); // Only second sheet migrated
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
      value: [['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle']],
    });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    await runStartupMigrations();

    expect(getSheetMetadata).toHaveBeenCalledTimes(2);
    expect(setValues).toHaveBeenCalledTimes(2);
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
      value: [['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle']],
    });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    await runStartupMigrations();

    // Second spreadsheet should still be processed
    expect(setValues).toHaveBeenCalledTimes(1);
  });
});
