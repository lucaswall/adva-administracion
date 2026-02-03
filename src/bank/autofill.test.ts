/**
 * Unit tests for bank autofill functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoFillBankMovements, parseMovementRow } from './autofill.js';
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

describe('parseMovementRow - array bounds checking', () => {
  it('returns null for row with less than 9 elements', () => {
    // Row with only 6 elements (missing credito, debito, detalle)
    const shortRow = ['2024-01-15', '2024-01-15', 'TRANSFERENCIA', 'TRF', 'CENTRAL', 'ADMIN'];
    const result = parseMovementRow(shortRow, 1);
    expect(result).toBeNull();
  });

  it('returns null for empty row', () => {
    const emptyRow: string[] = [];
    const result = parseMovementRow(emptyRow, 1);
    expect(result).toBeNull();
  });

  it('returns valid BankMovement for row with exactly 9 elements', () => {
    const validRow = [
      '2024-01-15',    // fecha
      '2024-01-15',    // fechaValor
      'TRANSFERENCIA', // concepto
      'TRF',           // codigo
      'CENTRAL',       // oficina
      'ADMIN',         // areaAdva
      50000,           // credito
      null,            // debito
      'Pago cliente',  // detalle
    ];
    const result = parseMovementRow(validRow, 5);

    expect(result).not.toBeNull();
    expect(result?.row).toBe(5);
    expect(result?.fecha).toBe('2024-01-15');
    expect(result?.concepto).toBe('TRANSFERENCIA');
    expect(result?.credito).toBe(50000);
    expect(result?.debito).toBeNull();
    expect(result?.detalle).toBe('Pago cliente');
  });

  it('returns valid BankMovement for row with more than 9 elements', () => {
    // Extra columns should be ignored
    const longRow = [
      '2024-01-15', '2024-01-15', 'TRANSFERENCIA', 'TRF', 'CENTRAL', 'ADMIN',
      50000, null, 'Detalle', 'extra1', 'extra2',
    ];
    const result = parseMovementRow(longRow, 1);

    expect(result).not.toBeNull();
    expect(result?.detalle).toBe('Detalle');
  });

  it('returns null for row missing required fecha (index 0)', () => {
    const noFecha = [null, '2024-01-15', 'TRANSFERENCIA', 'TRF', 'CENTRAL', 'ADMIN', 50000, null, ''];
    const result = parseMovementRow(noFecha, 1);
    expect(result).toBeNull();
  });

  it('returns null for row missing required concepto (index 2)', () => {
    const noConcepto = ['2024-01-15', '2024-01-15', null, 'TRF', 'CENTRAL', 'ADMIN', 50000, null, ''];
    const result = parseMovementRow(noConcepto, 1);
    expect(result).toBeNull();
  });

  it('normalizes serial number dates in fecha and fechaValor', () => {
    const row = [
      45671,           // fecha (serial number => '2025-01-14')
      45672,           // fechaValor (serial number => '2025-01-15')
      'TRANSFERENCIA', // concepto
      'TRF',           // codigo
      'CENTRAL',       // oficina
      'ADMIN',         // areaAdva
      50000,           // credito
      null,            // debito
      '',              // detalle
    ];
    const result = parseMovementRow(row, 2);

    expect(result).not.toBeNull();
    expect(result?.fecha).toBe('2025-01-14');
    expect(result?.fechaValor).toBe('2025-01-15');
  });

  it('passes through string dates unchanged', () => {
    const row = [
      '2025-01-14',    // fecha (already string)
      '2025-01-15',    // fechaValor (already string)
      'TRANSFERENCIA', // concepto
      'TRF',           // codigo
      'CENTRAL',       // oficina
      'ADMIN',         // areaAdva
      50000,           // credito
      null,            // debito
      '',              // detalle
    ];
    const result = parseMovementRow(row, 2);

    expect(result).not.toBeNull();
    expect(result?.fecha).toBe('2025-01-14');
    expect(result?.fechaValor).toBe('2025-01-15');
  });
});
