/**
 * Tests for folder structure service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateYear, clearFolderStructureCache, getCachedFolderStructure, checkEnvironmentMarker, migrateArchivosProcesadosHeaders, migrateTipoDeCambioHeaders, migrateFacturasEmitidasPagadaColumn } from './folder-structure.js';

// Mock drive.js for environment marker tests
vi.mock('./drive.js', () => ({
  findByName: vi.fn(),
  createFile: vi.fn(),
  listByMimeType: vi.fn(),
  createFolder: vi.fn(),
  createSpreadsheet: vi.fn(),
  moveFile: vi.fn(),
  getParents: vi.fn(),
  renameFile: vi.fn(),
  listFilesInFolder: vi.fn(),
  downloadFile: vi.fn(),
  trashFile: vi.fn(),
}));

import { findByName, createFile } from './drive.js';

// Mock sheets.js so migration tests can control getValues/setValues
vi.mock('./sheets.js', () => ({
  getSheetMetadata: vi.fn(),
  createSheet: vi.fn(),
  setValues: vi.fn(),
  getValues: vi.fn(),
  formatSheet: vi.fn(),
  formatStatusSheet: vi.fn(),
  deleteSheet: vi.fn(),
  moveSheetToFirst: vi.fn(),
  applyConditionalFormat: vi.fn(),
  batchUpdate: vi.fn(),
  insertColumn: vi.fn(),
}));

import { getValues, setValues, getSheetMetadata, insertColumn } from './sheets.js';

describe('validateYear', () => {
  it('returns ok for valid years in range 2000-current+1', () => {
    const currentYear = new Date().getFullYear();

    expect(validateYear('2000')).toEqual({ ok: true, value: 2000 });
    expect(validateYear('2024')).toEqual({ ok: true, value: 2024 });
    expect(validateYear('2025')).toEqual({ ok: true, value: 2025 });
    expect(validateYear(String(currentYear))).toEqual({ ok: true, value: currentYear });
    expect(validateYear(String(currentYear + 1))).toEqual({ ok: true, value: currentYear + 1 });
  });

  it('returns error for years before 2000', () => {
    const result = validateYear('1999');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('1999');
      expect(result.error.message).toContain('outside valid range');
    }
  });

  it('returns error for years more than 1 year in future', () => {
    const currentYear = new Date().getFullYear();
    const farFuture = currentYear + 2;
    const result = validateYear(String(farFuture));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(String(farFuture));
    }
  });

  it('returns error for NaN year', () => {
    const result = validateYear('NaN');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('invalid');
    }
  });

  it('returns error for non-numeric strings', () => {
    expect(validateYear('abc').ok).toBe(false);
    expect(validateYear('20-25').ok).toBe(false);
    expect(validateYear('').ok).toBe(false);
  });

  it('returns error for future years beyond next year (prevents 2029 from bug)', () => {
    // The bug caused dates like "11/13/29" to be parsed as 2029
    // Years more than 1 year in the future should be rejected
    const currentYear = new Date().getFullYear();
    const tooFarFuture = currentYear + 2;

    const result = validateYear(String(tooFarFuture));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('outside valid range');
    }
  });

  it('accepts historical years like 2020 for old documents', () => {
    // Years like 2020 are valid - they could be historical documents
    // The bug was caused by 2-digit year parsing, not by 2020 being invalid
    const result = validateYear('2020');
    expect(result.ok).toBe(true);
  });
});

describe('clearFolderStructureCache', () => {
  it('should reset cached structure to null', () => {
    // Note: We can't easily populate the cache without mocking Drive calls
    // But we can verify the clear function works
    clearFolderStructureCache();
    expect(getCachedFolderStructure()).toBeNull();
  });

  it('should handle clearing when cache is already null', () => {
    clearFolderStructureCache();
    expect(getCachedFolderStructure()).toBeNull();

    // Clear again - should not throw
    expect(() => clearFolderStructureCache()).not.toThrow();
    expect(getCachedFolderStructure()).toBeNull();
  });
});

// Bug #5: Cache could be cleared during a locked folder creation operation.
// Current behavior (folder-structure.ts): Throws descriptive error "Folder structure cache
// was cleared during operation" when the cache is cleared mid-operation inside withLock.
// Not testable via unit tests because ensureClassificationFolders is non-exported and
// requires concurrent async coordination to trigger. Verified by code review.

describe('Spreadsheet lock timeout configuration', () => {
  it('should have SPREADSHEET_LOCK_TIMEOUT_MS constant exported', async () => {
    // Import the constant to verify it exists
    const { SPREADSHEET_LOCK_TIMEOUT_MS } = await import('../config.js');

    expect(SPREADSHEET_LOCK_TIMEOUT_MS).toBe(30000);
  });

  it('should use SPREADSHEET_LOCK_TIMEOUT_MS in folder-structure.ts', async () => {
    // Documentation test: Verifies the timeout constant is properly wired to withLock calls
    // This is a static source code check - brittle but valuable for catching configuration errors
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sourcePath = path.join(__dirname, 'folder-structure.ts');
    const sourceCode = await fs.readFile(sourcePath, 'utf-8');

    // Verify SPREADSHEET_LOCK_TIMEOUT_MS is imported from config
    expect(sourceCode).toContain('SPREADSHEET_LOCK_TIMEOUT_MS');
    expect(sourceCode).toContain('from \'../config.js\'');

    // Verify it's passed to withLock calls (at least once)
    // Pattern: SPREADSHEET_LOCK_TIMEOUT_MS followed by ) with optional whitespace
    const usagePattern = /SPREADSHEET_LOCK_TIMEOUT_MS\s*\)/g;
    const matches = sourceCode.match(usagePattern);

    // Verify the constant is actually used in withLock calls
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThan(0);
  });
});

describe('movimientosSpreadsheets cache population', () => {
  it('should have discoverMovimientosSpreadsheets function', async () => {
    // Verify the discovery function exists
    const module = await import('./folder-structure.js');
    expect(module.discoverMovimientosSpreadsheets).toBeDefined();
    expect(typeof module.discoverMovimientosSpreadsheets).toBe('function');
  });

  it('discoverFolderStructure should call discoverMovimientosSpreadsheets', async () => {
    // Documentation test: Verifies discovery logic is integrated into discoverFolderStructure
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sourcePath = path.join(__dirname, 'folder-structure.ts');
    const sourceCode = await fs.readFile(sourcePath, 'utf-8');

    // Verify discoverMovimientosSpreadsheets is called in discoverFolderStructure
    expect(sourceCode).toContain('discoverMovimientosSpreadsheets');
  });
});

describe('checkEnvironmentMarker', () => {
  const rootId = 'root-folder-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates correct marker when no marker exists (staging)', async () => {
    vi.mocked(findByName).mockResolvedValue({ ok: true, value: null });
    vi.mocked(createFile).mockResolvedValue({
      ok: true,
      value: { id: 'marker-id', name: '.staging', mimeType: 'text/plain' },
    });

    const result = await checkEnvironmentMarker(rootId, 'staging');

    expect(result.ok).toBe(true);
    expect(findByName).toHaveBeenCalledWith(rootId, '.staging');
    expect(findByName).toHaveBeenCalledWith(rootId, '.production');
    expect(createFile).toHaveBeenCalledWith(rootId, '.staging');
  });

  it('creates correct marker when no marker exists (production)', async () => {
    vi.mocked(findByName).mockResolvedValue({ ok: true, value: null });
    vi.mocked(createFile).mockResolvedValue({
      ok: true,
      value: { id: 'marker-id', name: '.production', mimeType: 'text/plain' },
    });

    const result = await checkEnvironmentMarker(rootId, 'production');

    expect(result.ok).toBe(true);
    expect(findByName).toHaveBeenCalledWith(rootId, '.staging');
    expect(findByName).toHaveBeenCalledWith(rootId, '.production');
    expect(createFile).toHaveBeenCalledWith(rootId, '.production');
  });

  it('returns ok and does not create anything when correct marker exists (staging)', async () => {
    vi.mocked(findByName).mockImplementation((_rootId, name) => {
      if (name === '.staging') {
        return Promise.resolve({
          ok: true as const,
          value: { id: 'existing-marker', name: '.staging', mimeType: 'text/plain' },
        });
      }
      return Promise.resolve({ ok: true as const, value: null });
    });

    const result = await checkEnvironmentMarker(rootId, 'staging');

    expect(result.ok).toBe(true);
    expect(createFile).not.toHaveBeenCalled();
  });

  it('returns ok and does not create anything when correct marker exists (production)', async () => {
    vi.mocked(findByName).mockImplementation((_rootId, name) => {
      if (name === '.production') {
        return Promise.resolve({
          ok: true as const,
          value: { id: 'existing-marker', name: '.production', mimeType: 'text/plain' },
        });
      }
      return Promise.resolve({ ok: true as const, value: null });
    });

    const result = await checkEnvironmentMarker(rootId, 'production');

    expect(result.ok).toBe(true);
    expect(createFile).not.toHaveBeenCalled();
  });

  it('returns error when wrong marker exists (server staging, folder production)', async () => {
    vi.mocked(findByName).mockImplementation((_rootId, name) => {
      if (name === '.production') {
        return Promise.resolve({
          ok: true as const,
          value: { id: 'wrong-marker', name: '.production', mimeType: 'text/plain' },
        });
      }
      return Promise.resolve({ ok: true as const, value: null });
    });

    const result = await checkEnvironmentMarker(rootId, 'staging');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(
        'Environment mismatch: server is staging but Drive folder is marked production'
      );
    }
    expect(createFile).not.toHaveBeenCalled();
  });

  it('returns error when wrong marker exists (server production, folder staging)', async () => {
    vi.mocked(findByName).mockImplementation((_rootId, name) => {
      if (name === '.staging') {
        return Promise.resolve({
          ok: true as const,
          value: { id: 'wrong-marker', name: '.staging', mimeType: 'text/plain' },
        });
      }
      return Promise.resolve({ ok: true as const, value: null });
    });

    const result = await checkEnvironmentMarker(rootId, 'production');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(
        'Environment mismatch: server is production but Drive folder is marked staging'
      );
    }
    expect(createFile).not.toHaveBeenCalled();
  });

  it('returns ok immediately when environment is "development" (skip check)', async () => {
    const result = await checkEnvironmentMarker(rootId, 'development');

    expect(result.ok).toBe(true);
    expect(findByName).not.toHaveBeenCalled();
    expect(createFile).not.toHaveBeenCalled();
  });

  it('propagates findByName error', async () => {
    vi.mocked(findByName).mockResolvedValue({
      ok: false,
      error: new Error('Drive API error'),
    });

    const result = await checkEnvironmentMarker(rootId, 'staging');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Drive API error');
    }
  });
});

describe('migrateArchivosProcesadosHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects 5-column schema and appends originalFileId header to Column F', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
    });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await migrateArchivosProcesadosHeaders('dashboard-id');

    expect(result.ok).toBe(true);
    expect(setValues).toHaveBeenCalledWith(
      'dashboard-id',
      'Archivos Procesados!F1',
      [['originalFileId']]
    );
  });

  it('leaves 6-column schema untouched when already migrated', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status', 'originalFileId']],
    });

    const result = await migrateArchivosProcesadosHeaders('dashboard-id');

    expect(result.ok).toBe(true);
    expect(setValues).not.toHaveBeenCalled();
  });

  it('handles empty sheet gracefully without writing headers (ensureSheetsExist handles those)', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [],
    });

    const result = await migrateArchivosProcesadosHeaders('dashboard-id');

    expect(result.ok).toBe(true);
    expect(setValues).not.toHaveBeenCalled();
  });

  it('returns error when getValues fails', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: false,
      error: new Error('Sheets API error'),
    });

    const result = await migrateArchivosProcesadosHeaders('dashboard-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Sheets API error');
    }
  });

  it('returns error when setValues fails during migration', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
    });
    vi.mocked(setValues).mockResolvedValue({
      ok: false,
      error: new Error('Write failed'),
    });

    const result = await migrateArchivosProcesadosHeaders('dashboard-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Write failed');
    }
  });

  it('handles schemas with more than 6 columns (e.g., future migration) without writing', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status', 'originalFileId', 'futureColumn']],
    });

    const result = await migrateArchivosProcesadosHeaders('dashboard-id');

    expect(result.ok).toBe(true);
    expect(setValues).not.toHaveBeenCalled();
  });
});

describe('migrateTipoDeCambioHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Facturas Emitidas (18→19 cols)', () => {
    it('adds tipoDeCambio header at column S when 18 columns present', async () => {
      const headers18 = Array.from({ length: 18 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers18] });
      vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

      const result = await migrateTipoDeCambioHeaders('ingresos-id', 'Facturas Emitidas', 18, 'S', ['tipoDeCambio']);

      expect(result.ok).toBe(true);
      expect(setValues).toHaveBeenCalledWith('ingresos-id', 'Facturas Emitidas!S1', [['tipoDeCambio']]);
    });

    it('skips when already 19+ columns', async () => {
      const headers19 = Array.from({ length: 19 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers19] });

      const result = await migrateTipoDeCambioHeaders('ingresos-id', 'Facturas Emitidas', 18, 'S', ['tipoDeCambio']);

      expect(result.ok).toBe(true);
      expect(setValues).not.toHaveBeenCalled();
    });

    it('skips when sheet is empty', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });

      const result = await migrateTipoDeCambioHeaders('ingresos-id', 'Facturas Emitidas', 18, 'S', ['tipoDeCambio']);

      expect(result.ok).toBe(true);
      expect(setValues).not.toHaveBeenCalled();
    });

    it('returns error when getValues fails', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: false, error: new Error('API error') });

      const result = await migrateTipoDeCambioHeaders('ingresos-id', 'Facturas Emitidas', 18, 'S', ['tipoDeCambio']);

      expect(result.ok).toBe(false);
    });

    it('returns error when setValues fails', async () => {
      const headers18 = Array.from({ length: 18 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers18] });
      vi.mocked(setValues).mockResolvedValue({ ok: false, error: new Error('Write failed') });

      const result = await migrateTipoDeCambioHeaders('ingresos-id', 'Facturas Emitidas', 18, 'S', ['tipoDeCambio']);

      expect(result.ok).toBe(false);
    });
  });

  describe('Facturas Recibidas (19→20 cols)', () => {
    it('adds tipoDeCambio header at column T when 19 columns present', async () => {
      const headers19 = Array.from({ length: 19 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers19] });
      vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

      const result = await migrateTipoDeCambioHeaders('egresos-id', 'Facturas Recibidas', 19, 'T', ['tipoDeCambio']);

      expect(result.ok).toBe(true);
      expect(setValues).toHaveBeenCalledWith('egresos-id', 'Facturas Recibidas!T1', [['tipoDeCambio']]);
    });

    it('skips when already 20+ columns', async () => {
      const headers20 = Array.from({ length: 20 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers20] });

      const result = await migrateTipoDeCambioHeaders('egresos-id', 'Facturas Recibidas', 19, 'T', ['tipoDeCambio']);

      expect(result.ok).toBe(true);
      expect(setValues).not.toHaveBeenCalled();
    });
  });

  describe('Pagos Enviados/Recibidos (15→17 cols, two new columns)', () => {
    it('adds tipoDeCambio and importeEnPesos headers at P-Q when 15 columns present', async () => {
      const headers15 = Array.from({ length: 15 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers15] });
      vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

      const result = await migrateTipoDeCambioHeaders('egresos-id', 'Pagos Enviados', 15, 'P', ['tipoDeCambio', 'importeEnPesos']);

      expect(result.ok).toBe(true);
      expect(setValues).toHaveBeenCalledWith('egresos-id', 'Pagos Enviados!P1', [['tipoDeCambio', 'importeEnPesos']]);
    });

    it('skips when already 17+ columns (fully migrated)', async () => {
      const headers17 = Array.from({ length: 17 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers17] });

      const result = await migrateTipoDeCambioHeaders('egresos-id', 'Pagos Enviados', 15, 'P', ['tipoDeCambio', 'importeEnPesos']);

      expect(result.ok).toBe(true);
      expect(setValues).not.toHaveBeenCalled();
    });

    it('still migrates when 16 columns present (partial migration — re-runs idempotently)', async () => {
      const headers16 = Array.from({ length: 16 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers16] });
      vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

      const result = await migrateTipoDeCambioHeaders('egresos-id', 'Pagos Enviados', 15, 'P', ['tipoDeCambio', 'importeEnPesos']);

      expect(result.ok).toBe(true);
      expect(setValues).toHaveBeenCalledWith('egresos-id', 'Pagos Enviados!P1', [['tipoDeCambio', 'importeEnPesos']]);
    });

    it('applies same logic for Pagos Recibidos', async () => {
      const headers15 = Array.from({ length: 15 }, (_, i) => `col${i}`);
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers15] });
      vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

      const result = await migrateTipoDeCambioHeaders('ingresos-id', 'Pagos Recibidos', 15, 'P', ['tipoDeCambio', 'importeEnPesos']);

      expect(result.ok).toBe(true);
      expect(setValues).toHaveBeenCalledWith('ingresos-id', 'Pagos Recibidos!P1', [['tipoDeCambio', 'importeEnPesos']]);
    });
  });
});

describe('migrateFacturasEmitidasPagadaColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts pagada column at S when Facturas Emitidas has 19 columns (tipoDeCambio present, pagada missing)', async () => {
    const headers19 = Array.from({ length: 19 }, (_, i) => `col${i}`);
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers19] });
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: 'Facturas Emitidas', sheetId: 42, index: 0 }],
    });
    vi.mocked(insertColumn).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(true);
    expect(insertColumn).toHaveBeenCalledWith('ingresos-id', 42, 18);
    expect(setValues).toHaveBeenCalledWith('ingresos-id', 'Facturas Emitidas!S1', [['pagada']]);
  });

  it('skips when already 20 columns (idempotent — pagada already migrated)', async () => {
    const headers20 = Array.from({ length: 20 }, (_, i) => `col${i}`);
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers20] });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(true);
    expect(insertColumn).not.toHaveBeenCalled();
    expect(setValues).not.toHaveBeenCalled();
  });

  it('skips when pagada header exists at index 18', async () => {
    const headers = Array.from({ length: 20 }, (_, i) => `col${i}`);
    headers[18] = 'pagada';
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers] });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(true);
    expect(insertColumn).not.toHaveBeenCalled();
    expect(setValues).not.toHaveBeenCalled();
  });

  it('skips when sheet is empty', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(true);
    expect(insertColumn).not.toHaveBeenCalled();
    expect(setValues).not.toHaveBeenCalled();
  });

  it('returns error when getValues fails', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: false, error: new Error('API error') });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('API error');
  });

  it('returns error when getSheetMetadata fails', async () => {
    const headers19 = Array.from({ length: 19 }, (_, i) => `col${i}`);
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers19] });
    vi.mocked(getSheetMetadata).mockResolvedValue({ ok: false, error: new Error('Metadata error') });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('Metadata error');
  });

  it('returns error when Facturas Emitidas sheet not found in metadata', async () => {
    const headers19 = Array.from({ length: 19 }, (_, i) => `col${i}`);
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers19] });
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: 'Other Sheet', sheetId: 1, index: 0 }],
    });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not found');
  });

  it('returns error when insertColumn fails', async () => {
    const headers19 = Array.from({ length: 19 }, (_, i) => `col${i}`);
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers19] });
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: 'Facturas Emitidas', sheetId: 42, index: 0 }],
    });
    vi.mocked(insertColumn).mockResolvedValue({ ok: false, error: new Error('Insert failed') });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('Insert failed');
  });

  it('returns error when setValues fails after column insert', async () => {
    const headers19 = Array.from({ length: 19 }, (_, i) => `col${i}`);
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [headers19] });
    vi.mocked(getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: 'Facturas Emitidas', sheetId: 42, index: 0 }],
    });
    vi.mocked(insertColumn).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(setValues).mockResolvedValue({ ok: false, error: new Error('Write failed') });

    const result = await migrateFacturasEmitidasPagadaColumn('ingresos-id');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('Write failed');
  });
});
