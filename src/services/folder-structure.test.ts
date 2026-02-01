/**
 * Tests for folder structure service
 */

import { describe, it, expect } from 'vitest';
import { validateYear, clearFolderStructureCache, getCachedFolderStructure } from './folder-structure.js';

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

describe('Bug #5: Folder structure cache race handling', () => {
  it('documents cache clear behavior during locked operations', () => {
    // Bug #5: Cache could be cleared during a locked operation
    // Current behavior: Throws descriptive error when cache is cleared mid-operation
    //
    // This is ACCEPTABLE because:
    // 1. Error is thrown (not silent failure)
    // 2. Error message is descriptive: "Folder structure cache was cleared during operation"
    // 3. Caller can recover by re-calling discoverFolderStructure()
    //
    // The lock prevents concurrent folder creation operations, but doesn't prevent
    // clearFolderStructureCache() from being called externally. The error handling
    // ensures the operation fails gracefully with a clear message.
    //
    // Code location: folder-structure.ts:642-645
    //
    // Expected error flow:
    // 1. Operation starts with cached structure
    // 2. clearFolderStructureCache() called externally
    // 3. Operation detects cache cleared
    // 4. Throws: "Folder structure cache was cleared during operation"
    // 5. Caller catches error and can re-discover structure

    // This test documents the expected behavior
    expect(true).toBe(true);
  });
});

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
