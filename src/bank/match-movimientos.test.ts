/**
 * Tests for match-movimientos orchestration service
 * Matches bank movements against Control de Ingresos/Egresos
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  matchAllMovimientos,
  isBetterMatch,
  type MatchQuality,
} from './match-movimientos.js';

// Mock all dependencies
vi.mock('../utils/concurrency.js', () => ({
  withLock: vi.fn(),
  clearAllLocks: vi.fn(),
}));

vi.mock('../services/folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(),
}));

vi.mock('../services/sheets.js', () => ({
  getValues: vi.fn(),
}));

vi.mock('../services/movimientos-reader.js', () => ({
  getMovimientosToFill: vi.fn(),
}));

vi.mock('../services/movimientos-detalle.js', () => ({
  updateDetalle: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Create mockable matcher methods
let mockMatchMovement = vi.fn();
let mockMatchCreditMovement = vi.fn();

vi.mock('./matcher.js', () => {
  return {
    BankMovementMatcher: class MockBankMovementMatcher {
      matchMovement = mockMatchMovement;
      matchCreditMovement = mockMatchCreditMovement;
    },
  };
});

import { withLock } from '../utils/concurrency.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { getValues } from '../services/sheets.js';
import { getMovimientosToFill } from '../services/movimientos-reader.js';
import { updateDetalle } from '../services/movimientos-detalle.js';

describe('isBetterMatch', () => {
  it('should prefer CUIT match over no CUIT match', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      hasCuitMatch: false,
      dateDistance: 1,
      isExactAmount: true,
      hasLinkedPago: true,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      hasCuitMatch: true,
      dateDistance: 10,
      isExactAmount: false,
      hasLinkedPago: false,
    };

    expect(isBetterMatch(existing, candidate)).toBe(true);
  });

  it('should prefer existing when it has CUIT match and candidate does not', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      hasCuitMatch: true,
      dateDistance: 10,
      isExactAmount: false,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      hasCuitMatch: false,
      dateDistance: 1,
      isExactAmount: true,
      hasLinkedPago: true,
    };

    expect(isBetterMatch(existing, candidate)).toBe(false);
  });

  it('should prefer closer date when CUIT match is equal', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      hasCuitMatch: true,
      dateDistance: 15,
      isExactAmount: true,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      hasCuitMatch: true,
      dateDistance: 2,
      isExactAmount: true,
      hasLinkedPago: false,
    };

    expect(isBetterMatch(existing, candidate)).toBe(true);
  });

  it('should prefer existing when closer date', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      hasCuitMatch: true,
      dateDistance: 2,
      isExactAmount: false,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      hasCuitMatch: true,
      dateDistance: 15,
      isExactAmount: true,
      hasLinkedPago: true,
    };

    expect(isBetterMatch(existing, candidate)).toBe(false);
  });

  it('should prefer exact amount when CUIT and date are equal', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: false,
      hasLinkedPago: true,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: true,
      hasLinkedPago: false,
    };

    expect(isBetterMatch(existing, candidate)).toBe(true);
  });

  it('should prefer linked pago when all else is equal', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: true,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: true,
      hasLinkedPago: true,
    };

    expect(isBetterMatch(existing, candidate)).toBe(true);
  });

  it('should keep existing when quality is exactly equal (no churn)', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: true,
      hasLinkedPago: true,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: true,
      hasLinkedPago: true,
    };

    expect(isBetterMatch(existing, candidate)).toBe(false);
  });
});

describe('matchAllMovimientos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset mock functions
    mockMatchMovement = vi.fn().mockReturnValue({
      matchType: 'no_match',
      description: '',
      matchedFileId: '',
      confidence: 'LOW',
    });
    mockMatchCreditMovement = vi.fn().mockReturnValue({
      matchType: 'no_match',
      description: '',
      matchedFileId: '',
      confidence: 'LOW',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return skipped result when lock cannot be acquired', async () => {
    vi.mocked(withLock).mockResolvedValue({
      ok: false,
      error: new Error('Lock timeout'),
    });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
      expect(result.value.reason).toBe('already_running');
    }
  });

  it('should use unified lock ID from config', async () => {
    vi.mocked(withLock).mockResolvedValue({
      ok: false,
      error: new Error('Lock timeout'),
    });

    await matchAllMovimientos();

    expect(withLock).toHaveBeenCalledWith(
      'document-processing',  // PROCESSING_LOCK_ID
      expect.any(Function),
      300000,  // PROCESSING_LOCK_TIMEOUT_MS
      300000   // Auto-expiry
    );
  });

  it('should return error when folder structure is not cached', async () => {
    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(null);

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Folder structure not cached');
    }
  });

  it('should process all banks sequentially', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([
        ['BBVA ARS', 'bbva-ars-id'],
        ['BBVA USD', 'bbva-usd-id'],
      ]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    // Mock Control data reads
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['header']],  // Empty sheets
    });

    // Mock movimientos reads - empty for simplicity
    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [],
    });

    vi.mocked(updateDetalle).mockResolvedValue({
      ok: true,
      value: 0,
    });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(false);
      expect(result.value.results).toHaveLength(2);
    }

    // Should have called getMovimientosToFill for each bank
    expect(getMovimientosToFill).toHaveBeenCalledTimes(2);
    expect(getMovimientosToFill).toHaveBeenCalledWith('bbva-ars-id', expect.any(Number));
    expect(getMovimientosToFill).toHaveBeenCalledWith('bbva-usd-id', expect.any(Number));
  });

  it('should match debit movements using matchMovement', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([['BBVA', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['header']],
    });

    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          origenConcepto: 'PAGO TEST',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: '',
          detalle: '',
        },
      ],
    });

    // Set up debit match mock
    mockMatchMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'Pago Factura a TEST SA',
      matchedFileId: 'factura123',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(mockMatchMovement).toHaveBeenCalled();
  });

  it('should match credit movements using matchCreditMovement', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([['BBVA', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['header']],
    });

    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          origenConcepto: 'TRANSFERENCIA RECIBIDA',
          debito: null,
          credito: 5000,
          saldo: 15000,
          saldoCalculado: 15000,
          matchedFileId: '',
          detalle: '',
        },
      ],
    });

    // Set up credit match mock
    mockMatchCreditMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'Cobro Factura de TEST SA',
      matchedFileId: 'factura456',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(mockMatchCreditMovement).toHaveBeenCalled();
  });

  it('should not update movements with no match', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([['BBVA', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['header']],
    });

    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          origenConcepto: 'UNKNOWN TX',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: '',
          detalle: '',
        },
      ],
    });

    // mockMatchMovement already defaults to no_match in beforeEach

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 0 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.results[0].noMatches).toBe(1);
    }

    // updateDetalle should be called with empty array (no updates)
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', []);
  });

  it('should clear existing matches when force option is true', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([['BBVA', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['header']],
    });

    // Movement with existing match
    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          origenConcepto: 'PAGO TEST',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: 'old-file-id',  // Has existing match
          detalle: 'Old match',
        },
      ],
    });

    // Set up debit match mock with new match
    mockMatchMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'New match',
      matchedFileId: 'new-file-id',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos({ force: true });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    // With force=true, the new match should replace the old one
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', expect.arrayContaining([
      expect.objectContaining({
        matchedFileId: 'new-file-id',
        detalle: 'New match',
      }),
    ]));
  });

  it('should continue processing when one bank fails', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([
        ['BBVA', 'bbva-id'],
        ['SANTANDER', 'santander-id'],
      ]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['header']],
    });

    // First bank fails, second succeeds
    vi.mocked(getMovimientosToFill)
      .mockResolvedValueOnce({ ok: false, error: new Error('BBVA error') })
      .mockResolvedValueOnce({ ok: true, value: [] });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 0 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.results).toHaveLength(2);
      expect(result.value.results[0].errors).toBe(1);
      expect(result.value.results[1].errors).toBe(0);
    }
  });

  it('should calculate statistics correctly', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([['BBVA', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['header']],
    });

    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        { sheetName: '2025-01', rowNumber: 2, fecha: '2025-01-15', origenConcepto: 'TX1', debito: 1000, credito: null, saldo: 9000, saldoCalculado: 9000, matchedFileId: '', detalle: '' },
        { sheetName: '2025-01', rowNumber: 3, fecha: '2025-01-16', origenConcepto: 'TX2', debito: null, credito: 2000, saldo: 11000, saldoCalculado: 11000, matchedFileId: '', detalle: '' },
        { sheetName: '2025-01', rowNumber: 4, fecha: '2025-01-17', origenConcepto: 'TX3', debito: 500, credito: null, saldo: 10500, saldoCalculado: 10500, matchedFileId: '', detalle: '' },
      ],
    });

    let debitCalls = 0;

    // Set up debit mock - first call matches, second doesn't
    mockMatchMovement.mockImplementation(() => {
      debitCalls++;
      return debitCalls === 1
        ? { matchType: 'direct_factura', description: 'Match', matchedFileId: 'f1', confidence: 'HIGH' }
        : { matchType: 'no_match', description: '', matchedFileId: '', confidence: 'LOW' };
    });

    // Set up credit mock - always matches
    mockMatchCreditMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'Credit Match',
      matchedFileId: 'f2',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 2 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalProcessed).toBe(3);
      expect(result.value.totalFilled).toBe(2);
      expect(result.value.totalDebitsFilled).toBe(1);
      expect(result.value.totalCreditsFilled).toBe(1);
    }
  });
});
