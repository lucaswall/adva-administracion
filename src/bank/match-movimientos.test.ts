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
import { warn } from '../utils/logger.js';

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

  it('should process all banks sequentially using movimientosSpreadsheets (not bankSpreadsheets)', async () => {
    // Bug fix: matchAllMovimientos should use movimientosSpreadsheets, not bankSpreadsheets
    // bankSpreadsheets only contains root-level spreadsheets (Control sheets)
    // movimientosSpreadsheets contains the actual Movimientos sheets inside bank folders
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map([
        // These are root-level Control spreadsheets - should NOT be used
        ['Control de Ingresos', 'control-ingresos-id'],
      ]),
      movimientosSpreadsheets: new Map([
        // These are the actual Movimientos spreadsheets inside bank folders
        ['BBVA 007-009364/1 ARS', 'movimientos-bbva-ars-id'],
        ['BBVA 007-009364/1 USD', 'movimientos-bbva-usd-id'],
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

    // Should have called getMovimientosToFill for each movimientosSpreadsheet
    expect(getMovimientosToFill).toHaveBeenCalledTimes(2);
    expect(getMovimientosToFill).toHaveBeenCalledWith('movimientos-bbva-ars-id', expect.any(Number));
    expect(getMovimientosToFill).toHaveBeenCalledWith('movimientos-bbva-usd-id', expect.any(Number));
  });

  it('should match debit movements using matchMovement', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA', 'bbva-id']]),
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
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA', 'bbva-id']]),
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
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA', 'bbva-id']]),
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
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA', 'bbva-id']]),
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
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([
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
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA', 'bbva-id']]),
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

  it('should evaluate existing match against new candidate (replacement logic)', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    // Mock Control data with two facturas - one existing (far date), one new (close date)
    vi.mocked(getValues).mockImplementation(async (_spreadsheetId, range) => {
      if (range === 'Facturas Recibidas!A:S') {
        return {
          ok: true,
          value: [
            ['fechaemision', 'fileid', 'filename', 'tipocomprobante', 'puntoventa', 'numerocomprobante', 'cuitemisor', 'razonsocialemisor', 'cuitreceptor', 'razonsocialreceptor', 'importetotal', 'moneda', 'formadepago', 'cbu', 'processedat', 'confidence', 'needsreview', 'matchedpagofileid', 'matchconfidence'],
            ['2025-01-01', 'factura-far', 'far.pdf', 'B', '1', '123', '20123456786', 'PROVEEDOR SA', '30709076783', 'ADVA', '1000', 'ARS', '', '', '2025-01-01T10:00:00Z', '0.95', 'NO', '', ''],
            ['2025-01-16', 'factura-close', 'close.pdf', 'B', '1', '124', '20123456786', 'PROVEEDOR SA', '30709076783', 'ADVA', '1000', 'ARS', '', '', '2025-01-16T10:00:00Z', '0.95', 'NO', '', ''],
          ],
        };
      }
      return { ok: true, value: [['header']] };
    });

    // Movement with existing match to far-dated factura
    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          origenConcepto: 'PAGO A PROVEEDOR SA',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: 'factura-far',  // Existing match, 14 days away
          detalle: 'Pago Factura a PROVEEDOR SA',
        },
      ],
    });

    // New match will return the closer factura
    mockMatchMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'Pago Factura a PROVEEDOR SA - UPDATED',
      matchedFileId: 'factura-close',  // New match, only 1 day away
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    // Should replace with closer match even though existing match exists
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', expect.arrayContaining([
      expect.objectContaining({
        matchedFileId: 'factura-close',
        detalle: 'Pago Factura a PROVEEDOR SA - UPDATED',
      }),
    ]));
  });

  it('should keep existing match when it is better than new candidate', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    // Mock Control data - existing match has CUIT, new candidate doesn't
    vi.mocked(getValues).mockImplementation(async (_spreadsheetId, range) => {
      if (range === 'Facturas Recibidas!A:S') {
        return {
          ok: true,
          value: [
            ['fechaemision', 'fileid', 'filename', 'tipocomprobante', 'puntoventa', 'numerocomprobante', 'cuitemisor', 'razonsocialemisor', 'cuitreceptor', 'razonsocialreceptor', 'importetotal', 'moneda', 'formadepago', 'cbu', 'processedat', 'confidence', 'needsreview', 'matchedpagofileid', 'matchconfidence'],
            ['2025-01-10', 'factura-with-cuit', 'cuit.pdf', 'B', '1', '123', '20123456786', 'PROVEEDOR SA', '30709076783', 'ADVA', '1000', 'ARS', '', '', '2025-01-10T10:00:00Z', '0.95', 'NO', '', ''],
            ['2025-01-15', 'factura-no-cuit', 'nocuit.pdf', 'B', '1', '124', '00000000000', 'OTRO SA', '30709076783', 'ADVA', '1000', 'ARS', '', '', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
          ],
        };
      }
      return { ok: true, value: [['header']] };
    });

    // Movement with existing match that has CUIT
    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          origenConcepto: 'PAGO 20123456786',  // CUIT match
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: 'factura-with-cuit',  // Existing match with CUIT, 5 days away
          detalle: 'Pago Factura a PROVEEDOR SA',
        },
      ],
    });

    // New match without CUIT but closer date
    mockMatchMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'Pago Factura a OTRO SA',
      matchedFileId: 'factura-no-cuit',  // No CUIT match, same day
      confidence: 'MEDIUM',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 0 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    // Should NOT replace - existing has CUIT match which beats closer date
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', []);
  });

  it('should not update when force=false and new match is equal quality to existing', async () => {
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    // Mock Control data - two facturas with same distance, same CUIT
    vi.mocked(getValues).mockImplementation(async (_spreadsheetId, range) => {
      if (range === 'Facturas Recibidas!A:S') {
        return {
          ok: true,
          value: [
            ['fechaemision', 'fileid', 'filename', 'tipocomprobante', 'puntoventa', 'numerocomprobante', 'cuitemisor', 'razonsocialemisor', 'cuitreceptor', 'razonsocialreceptor', 'importetotal', 'moneda', 'formadepago', 'cbu', 'processedat', 'confidence', 'needsreview', 'matchedpagofileid', 'matchconfidence'],
            ['2025-01-10', 'factura-a', 'a.pdf', 'B', '1', '123', '20123456786', 'PROVEEDOR SA', '30709076783', 'ADVA', '1000', 'ARS', '', '', '2025-01-10T10:00:00Z', '0.95', 'NO', '', ''],
            ['2025-01-20', 'factura-b', 'b.pdf', 'B', '1', '124', '20123456786', 'PROVEEDOR SA', '30709076783', 'ADVA', '1000', 'ARS', '', '', '2025-01-20T10:00:00Z', '0.95', 'NO', '', ''],
          ],
        };
      }
      return { ok: true, value: [['header']] };
    });

    // Movement with existing match, same distance as new match
    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          origenConcepto: 'PAGO 20123456786',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: 'factura-a',  // 5 days away
          detalle: 'Pago Factura a PROVEEDOR SA',
        },
      ],
    });

    // New match also 5 days away
    mockMatchMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'Pago Factura a PROVEEDOR SA',
      matchedFileId: 'factura-b',  // Also 5 days away
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 0 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    // Should NOT replace - equal quality, keep existing (no churn)
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', []);
  });

  it('keeps existing match when buildMatchQualityFromFileId returns null (bug #18)', async () => {
    // Bug: Code replaces match when existingQuality is null, but should keep it
    // and log a warning instead (can't compare quality if document doesn't exist)

    // Mock folder structure using the same structure as other tests
    const mockFolderStructure = {
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      bankSpreadsheets: new Map(),
      movimientosSpreadsheets: new Map([['BBVA ARS', 'bbva-id']]),
    };

    vi.mocked(withLock).mockImplementation(async (_id, fn) => {
      const result = await fn();
      return { ok: true, value: result };
    });

    vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any);

    // Mock Control data - only one factura exists (factura-b)
    vi.mocked(getValues).mockImplementation(async (_spreadsheetId, range) => {
      if (range === 'Facturas Recibidas!A:S') {
        return {
          ok: true,
          value: [
            ['fechaemision', 'fileid', 'filename', 'tipocomprobante', 'puntoventa', 'numerocomprobante', 'cuitemisor', 'razonsocialemisor', 'cuitreceptor', 'razonsocialreceptor', 'importetotal', 'moneda', 'formadepago', 'cbu', 'processedat', 'confidence', 'needsreview', 'matchedpagofileid', 'matchconfidence'],
            ['2025-01-20', 'factura-b', 'b.pdf', 'B', '1', '124', '20123456786', 'PROVEEDOR SA', '30709076783', 'ADVA', '1000', 'ARS', '', '', '2025-01-20T10:00:00Z', '0.95', 'NO', '', ''],
          ],
        };
      }
      return { ok: true, value: [['header']] };
    });

    // Movement with existing match to factura-a (which no longer exists in Control)
    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          origenConcepto: 'PAGO 20123456786',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: 'factura-a',  // Document no longer exists
          detalle: 'Pago Factura a PROVEEDOR SA',
        },
      ],
    });

    // New match to factura-b (which does exist)
    mockMatchMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'Pago Factura a PROVEEDOR SA',
      matchedFileId: 'factura-b',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 0 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);

    // Should keep existing match (factura-a) even though it can't be found
    // because we can't compare quality when buildMatchQualityFromFileId returns null
    // A warning should be logged about the orphaned fileId
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
      expect.objectContaining({
        matchedFileId: 'factura-a',
      })
    );

    // Should NOT replace the match
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', []);
  });
});
