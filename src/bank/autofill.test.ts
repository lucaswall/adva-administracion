/**
 * Unit tests for bank autofill functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoFillBankMovements } from './autofill.js';
import type { FolderStructure } from '../types/index.js';

// Mock dependencies
vi.mock('../services/folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(),
}));

vi.mock('../services/sheets.js', () => ({
  getValues: vi.fn(),
  batchUpdate: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { getCachedFolderStructure } from '../services/folder-structure.js';
import { getValues, batchUpdate } from '../services/sheets.js';
import { warn } from '../utils/logger.js';

describe('autofillBankMovements error context (bug #19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs bank name when movement loading fails', async () => {
    const mockFolderStructure: Partial<FolderStructure> = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([
        ['BBVA ARS', 'bbva-ars-id'],
        ['BBVA USD', 'bbva-usd-id'],
      ]),
    };

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as FolderStructure);

    // Mock Control data loading (successful)
    vi.mocked(getValues).mockImplementation(async (spreadsheetId) => {
      if (spreadsheetId === 'ingresos-id' || spreadsheetId === 'egresos-id') {
        return { ok: true, value: [['header']] };
      }
      // Bank movement loading fails
      return { ok: false, error: new Error('Network error') };
    });

    const result = await autoFillBankMovements();

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should have logged warnings for both failed banks with bank names
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
        expect.objectContaining({ bankName: 'BBVA ARS' })
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
        expect.objectContaining({ bankName: 'BBVA USD' })
      );

      // Should track failed banks
      expect(result.value.failedBanks).toEqual(['BBVA ARS', 'BBVA USD']);
      expect(result.value.errors).toBe(2);
    }
  });

  it('includes failed banks in return value', async () => {
    const mockFolderStructure: Partial<FolderStructure> = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([
        ['BBVA ARS', 'bbva-ars-id'],
        ['HSBC USD', 'hsbc-usd-id'],
        ['Galicia ARS', 'galicia-ars-id'],
      ]),
    };

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as FolderStructure);

    // Mock Control data loading (successful)
    vi.mocked(getValues).mockImplementation(async (spreadsheetId) => {
      if (spreadsheetId === 'ingresos-id' || spreadsheetId === 'egresos-id') {
        return { ok: true, value: [['header']] };
      }
      // BBVA ARS succeeds, others fail
      if (spreadsheetId === 'bbva-ars-id') {
        return { ok: true, value: [['header']] };
      }
      return { ok: false, error: new Error('Network error') };
    });

    const result = await autoFillBankMovements();

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should only include failed banks, not successful ones
      expect(result.value.failedBanks).toEqual(['HSBC USD', 'Galicia ARS']);
      expect(result.value.errors).toBe(2);
    }
  });

  it('returns empty failedBanks when all banks succeed', async () => {
    const mockFolderStructure: Partial<FolderStructure> = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([
        ['BBVA ARS', 'bbva-ars-id'],
      ]),
    };

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as FolderStructure);

    // All loads succeed
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['header']] });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 0 });

    const result = await autoFillBankMovements();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.failedBanks).toEqual([]);
      expect(result.value.errors).toBe(0);
    }
  });
});
