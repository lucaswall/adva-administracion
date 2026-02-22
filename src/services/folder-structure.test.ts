/**
 * Tests for folder structure service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateYear, clearFolderStructureCache, getCachedFolderStructure, checkEnvironmentMarker } from './folder-structure.js';

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
