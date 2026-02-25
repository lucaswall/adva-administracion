import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  batchUpdate: vi.fn(),
  getSheetMetadata: vi.fn(),
  updateRowsWithFormatting: vi.fn(),
  getSpreadsheetTimezone: vi.fn(() => Promise.resolve({ ok: true, value: 'America/Argentina/Buenos_Aires' })),
}));

vi.mock('./folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(),
  migrateTipoDeCambioHeaders: vi.fn(),
  migrateArchivosProcesadosHeaders: vi.fn(),
}));

vi.mock('./schema-version.js', () => ({
  readSchemaVersion: vi.fn(),
  writeSchemaVersion: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

import { migrateMovimientosColumns, migrateDashboardProcessedAt, runStartupMigrations, CURRENT_SCHEMA_VERSION } from './migrations.js';
import { getValues, batchUpdate, getSheetMetadata, updateRowsWithFormatting, getSpreadsheetTimezone } from './sheets.js';
import { getCachedFolderStructure, migrateTipoDeCambioHeaders, migrateArchivosProcesadosHeaders } from './folder-structure.js';
import { readSchemaVersion, writeSchemaVersion } from './schema-version.js';

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

describe('migrateDashboardProcessedAt', () => {
  it('should re-write string processedAt values with updateRowsWithFormatting', async () => {
    // ISO string processedAt rows — should be re-written to apply DATE_TIME format
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fileId', 'fileName', 'processedAt', 'documentType', 'status', 'originalFileId'],
        ['file-1', 'a.pdf', '2025-12-01T10:00:00.000Z', 'factura_emitida', 'success', ''],
        ['file-2', 'b.pdf', '2025-12-02T11:00:00.000Z', 'pago_recibido', 'processing', ''],
        ['file-3', 'c.pdf', '', 'recibo', 'failed', ''], // empty — should be skipped
      ],
    });
    vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });

    await migrateDashboardProcessedAt('dashboard-id');

    // Should call updateRowsWithFormatting for rows with non-empty processedAt
    expect(updateRowsWithFormatting).toHaveBeenCalledOnce();
    const [calledId, calledUpdates, calledTimezone] = vi.mocked(updateRowsWithFormatting).mock.calls[0];
    expect(calledId).toBe('dashboard-id');
    expect(calledTimezone).toBe('America/Argentina/Buenos_Aires');

    // Should include row 2 (file-1) and row 3 (file-2), skip row 4 (empty)
    expect(calledUpdates).toHaveLength(2);
    expect(calledUpdates[0].range).toBe('Archivos Procesados!C2');
    expect(calledUpdates[0].values[0]).toBe('2025-12-01T10:00:00.000Z');
    expect(calledUpdates[1].range).toBe('Archivos Procesados!C3');
    expect(calledUpdates[1].values[0]).toBe('2025-12-02T11:00:00.000Z');
  });

  it('should convert serial number processedAt to ISO string before passing to updateRowsWithFormatting', async () => {
    // Serial number processedAt (from old appendRowsWithLinks writes)
    // 45993.5 = 2025-12-02 12:00:00 UTC
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fileId', 'fileName', 'processedAt', 'documentType', 'status', 'originalFileId'],
        ['file-1', 'a.pdf', 45993.5, 'factura_emitida', 'success', ''],
      ],
    });
    vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });

    await migrateDashboardProcessedAt('dashboard-id');

    expect(updateRowsWithFormatting).toHaveBeenCalledOnce();
    const calledUpdates = vi.mocked(updateRowsWithFormatting).mock.calls[0][1];
    expect(calledUpdates).toHaveLength(1);
    // Should convert serial to ISO string so updateRowsWithFormatting applies DATE_TIME format
    const processedAtValue = calledUpdates[0].values[0];
    expect(typeof processedAtValue).toBe('string');
    expect(processedAtValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should skip empty processedAt values', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fileId', 'fileName', 'processedAt', 'documentType', 'status', 'originalFileId'],
        ['file-1', 'a.pdf', '', 'factura_emitida', 'success', ''],
        ['file-2', 'b.pdf', null, 'pago_recibido', 'processing', ''],
      ],
    });
    vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });

    await migrateDashboardProcessedAt('dashboard-id');

    // Nothing to migrate — should not call updateRowsWithFormatting
    expect(updateRowsWithFormatting).not.toHaveBeenCalled();
  });

  it('should be idempotent — running twice produces the same result', async () => {
    const rows = [
      ['fileId', 'fileName', 'processedAt', 'documentType', 'status', 'originalFileId'],
      ['file-1', 'a.pdf', '2025-12-01T10:00:00.000Z', 'factura_emitida', 'success', ''],
    ];
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: rows });
    vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });

    await migrateDashboardProcessedAt('dashboard-id');
    vi.clearAllMocks();
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: rows });
    vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });

    await migrateDashboardProcessedAt('dashboard-id');

    // Second run should still call updateRowsWithFormatting with same args (re-applies format)
    expect(updateRowsWithFormatting).toHaveBeenCalledOnce();
    const calledUpdates = vi.mocked(updateRowsWithFormatting).mock.calls[0][1];
    expect(calledUpdates[0].values[0]).toBe('2025-12-01T10:00:00.000Z');
  });

  it('should handle only-header sheet gracefully', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fileId', 'fileName', 'processedAt', 'documentType', 'status', 'originalFileId'],
      ],
    });

    await migrateDashboardProcessedAt('dashboard-id');

    expect(updateRowsWithFormatting).not.toHaveBeenCalled();
  });

  it('should return error on getValues failure', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: false,
      error: new Error('API error'),
    });

    const result = await migrateDashboardProcessedAt('dashboard-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API error');
    }
    expect(updateRowsWithFormatting).not.toHaveBeenCalled();
  });
});

describe('runStartupMigrations', () => {
  const mockFolderStructure = {
    rootId: 'root-id',
    controlIngresosId: 'ingresos-id',
    controlEgresosId: 'egresos-id',
    dashboardOperativoId: 'dashboard-id',
    movimientosSpreadsheets: new Map([['2025:BBVA 123 ARS', 'ss-1']]),
  } as any;

  it('should skip when folder structure is not initialized', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(null);

    await runStartupMigrations();

    expect(readSchemaVersion).not.toHaveBeenCalled();
  });

  it('should create version file and skip migrations when no .schema_version exists (version 0)', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure);
    vi.mocked(readSchemaVersion).mockResolvedValue({
      ok: true,
      value: { version: 0, fileId: null },
    });
    vi.mocked(writeSchemaVersion).mockResolvedValue({
      ok: true,
      value: 'new-file-id',
    });

    await runStartupMigrations();

    expect(writeSchemaVersion).toHaveBeenCalledWith('root-id', CURRENT_SCHEMA_VERSION, null);
    // Should NOT call any migration functions
    expect(migrateTipoDeCambioHeaders).not.toHaveBeenCalled();
    expect(migrateArchivosProcesadosHeaders).not.toHaveBeenCalled();
    expect(getSheetMetadata).not.toHaveBeenCalled();
    expect(updateRowsWithFormatting).not.toHaveBeenCalled();
  });

  it('should skip all migrations when version equals CURRENT_SCHEMA_VERSION', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure);
    vi.mocked(readSchemaVersion).mockResolvedValue({
      ok: true,
      value: { version: CURRENT_SCHEMA_VERSION, fileId: 'file-id' },
    });

    await runStartupMigrations();

    expect(writeSchemaVersion).not.toHaveBeenCalled();
    expect(migrateTipoDeCambioHeaders).not.toHaveBeenCalled();
    expect(migrateArchivosProcesadosHeaders).not.toHaveBeenCalled();
  });

  it('should run only pending migrations when version is behind', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure);
    vi.mocked(readSchemaVersion).mockResolvedValue({
      ok: true,
      value: { version: 2, fileId: 'file-id' },
    });
    // Mock migration functions that v3 and v4 call
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['matchedFileId', 'matchedType', 'detalle']],
    });
    vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(writeSchemaVersion).mockResolvedValue({ ok: true, value: 'file-id' });

    await runStartupMigrations();

    // Should NOT run v1 or v2 migrations
    expect(migrateTipoDeCambioHeaders).not.toHaveBeenCalled();
    expect(migrateArchivosProcesadosHeaders).not.toHaveBeenCalled();
    // Should run v3 (movimientos) — getSheetMetadata is called by migrateMovimientosColumns
    expect(getSheetMetadata).toHaveBeenCalled();
    // Should update version to CURRENT
    expect(writeSchemaVersion).toHaveBeenCalledWith('root-id', CURRENT_SCHEMA_VERSION, 'file-id');
  });

  it('should stop and not update version when a migration fails', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure);
    vi.mocked(readSchemaVersion).mockResolvedValue({
      ok: true,
      value: { version: 0, fileId: 'file-id' },
    });
    // v1 migration: migrateTipoDeCambioHeaders fails
    vi.mocked(migrateTipoDeCambioHeaders).mockResolvedValue({
      ok: false,
      error: new Error('API error'),
    });

    await runStartupMigrations();

    // Should NOT update version file (so it retries next startup)
    expect(writeSchemaVersion).not.toHaveBeenCalled();
    // Should NOT proceed to v2+
    expect(migrateArchivosProcesadosHeaders).not.toHaveBeenCalled();
  });

  it('should run all 4 migrations when version is 0 and fileId exists (explicit run)', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure);
    vi.mocked(readSchemaVersion).mockResolvedValue({
      ok: true,
      value: { version: 0, fileId: 'file-id' },
    });
    // v1: tipoDeCambio
    vi.mocked(migrateTipoDeCambioHeaders).mockResolvedValue({ ok: true, value: undefined });
    // v2: archivos procesados
    vi.mocked(migrateArchivosProcesadosHeaders).mockResolvedValue({ ok: true, value: undefined });
    // v3: movimientos columns
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '2025-01', sheetId: 1, index: 0 }],
    });
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['matchedFileId', 'matchedType', 'detalle']],
    });
    // v4: dashboard processedAt
    vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(writeSchemaVersion).mockResolvedValue({ ok: true, value: 'file-id' });

    await runStartupMigrations();

    // v1: 4 calls to migrateTipoDeCambioHeaders
    expect(migrateTipoDeCambioHeaders).toHaveBeenCalledTimes(4);
    // v2: 1 call to migrateArchivosProcesadosHeaders
    expect(migrateArchivosProcesadosHeaders).toHaveBeenCalledTimes(1);
    // v3: movimientos migration runs
    expect(getSheetMetadata).toHaveBeenCalled();
    // Version updated
    expect(writeSchemaVersion).toHaveBeenCalledWith('root-id', CURRENT_SCHEMA_VERSION, 'file-id');
  });

  it('should propagate readSchemaVersion error gracefully', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure);
    vi.mocked(readSchemaVersion).mockResolvedValue({
      ok: false,
      error: new Error('Drive error'),
    });

    // Should not throw
    await runStartupMigrations();

    expect(writeSchemaVersion).not.toHaveBeenCalled();
    expect(migrateTipoDeCambioHeaders).not.toHaveBeenCalled();
  });
});
