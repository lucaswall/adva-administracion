/**
 * Tests for match-movimientos orchestration service
 * Matches bank movements against Control de Ingresos/Egresos
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  matchAllMovimientos,
  isBetterMatch,
  getRequiredColumnIndex,
  parseFacturasEmitidas,
  parseFacturasRecibidas,
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

describe('getRequiredColumnIndex', () => {
  it('returns correct index when header exists', () => {
    const headers = ['fechaemision', 'fileid', 'importetotal'];
    expect(getRequiredColumnIndex(headers, 'fileid')).toBe(1);
    expect(getRequiredColumnIndex(headers, 'fechaemision')).toBe(0);
    expect(getRequiredColumnIndex(headers, 'importetotal')).toBe(2);
  });

  it('throws error when required header is missing', () => {
    const headers = ['fechaemision', 'fileid', 'importetotal'];
    expect(() => getRequiredColumnIndex(headers, 'cuitemisor')).toThrow(
      /Required header 'cuitemisor' not found/
    );
  });

  it('throws error with case mismatch (exact match required)', () => {
    const headers = ['FechaEmision', 'FileId', 'ImporteTotal'];
    // Headers should be lowercased before calling this function
    // If not lowercased, it should fail
    expect(() => getRequiredColumnIndex(headers, 'fechaemision')).toThrow(
      /Required header 'fechaemision' not found/
    );
  });

  it('throws error with empty headers array', () => {
    const headers: string[] = [];
    expect(() => getRequiredColumnIndex(headers, 'fileid')).toThrow(
      /Required header 'fileid' not found/
    );
  });

  it('lists available headers in error message', () => {
    const headers = ['fechaemision', 'fileid'];
    try {
      getRequiredColumnIndex(headers, 'cuitemisor');
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('fechaemision');
      expect((e as Error).message).toContain('fileid');
    }
  });
});

describe('parseFacturasEmitidas', () => {
  it('requires cuitReceptor and razonSocialReceptor headers', () => {
    const data = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
      ['2025-01-15', 'file1', 'test.pdf', 'A', '00001-00000001', '20123456786', 'CLIENTE SA', '', '', '1000', 'ARS', '', '2025-01-15T10:00:00Z', '0.95', 'NO', '', '', ''],
    ];

    const result = parseFacturasEmitidas(data);

    expect(result).toHaveLength(1);
    expect(result[0].cuitReceptor).toBe('20123456786');
    expect(result[0].razonSocialReceptor).toBe('CLIENTE SA');
  });

  it('throws error when cuitReceptor header is missing', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'razonSocialReceptor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', 'CLIENTE SA', '1000', 'ARS'],
    ];

    expect(() => parseFacturasEmitidas(data)).toThrow(/Required header 'cuitreceptor' not found/);
  });

  it('throws error when razonSocialReceptor header is missing', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', '20123456786', '1000', 'ARS'],
    ];

    expect(() => parseFacturasEmitidas(data)).toThrow(/Required header 'razonsocialreceptor' not found/);
  });

  it('handles optional headers gracefully when missing', () => {
    // Minimal required headers only
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', '20123456786', 'CLIENTE SA', '1000', 'ARS'],
    ];

    const result = parseFacturasEmitidas(data);

    expect(result).toHaveLength(1);
    expect(result[0].importeNeto).toBe(0); // Default for missing optional
    expect(result[0].importeIva).toBe(0);
    expect(result[0].matchedPagoFileId).toBeUndefined();
  });

  it('returns empty array for data with only headers', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeTotal', 'moneda'],
    ];

    expect(parseFacturasEmitidas(data)).toEqual([]);
  });

  it('returns empty array for empty data', () => {
    expect(parseFacturasEmitidas([])).toEqual([]);
  });

  it('skips rows without fileId', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', '20123456786', 'CLIENTE SA', '1000', 'ARS'],
      ['2025-01-16', '', 'A', '00001-00000002', '27234567891', 'OTRO CLIENTE', '2000', 'ARS'],
      ['2025-01-17', 'file3', 'B', '00001-00000003', '20111111119', 'TERCER CLIENTE', '3000', 'ARS'],
    ];

    const result = parseFacturasEmitidas(data);

    expect(result).toHaveLength(2);
    expect(result[0].fileId).toBe('file1');
    expect(result[1].fileId).toBe('file3');
  });

  it('includes row number (1-indexed, accounting for header)', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', '20123456786', 'CLIENTE SA', '1000', 'ARS'],
      ['2025-01-16', 'file2', 'B', '00001-00000002', '27234567891', 'OTRO CLIENTE', '2000', 'ARS'],
    ];

    const result = parseFacturasEmitidas(data);

    expect(result[0].row).toBe(2); // Row 2 in spreadsheet (1 is header)
    expect(result[1].row).toBe(3);
  });

  it('normalizes serial number dates in fechaEmision', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeTotal', 'moneda'],
      [45671, 'file1', 'A', '00001-00000001', '20123456786', 'CLIENTE SA', 1000, 'ARS'],
    ];

    const result = parseFacturasEmitidas(data);

    expect(result).toHaveLength(1);
    // Serial number 45671 => '2025-01-14'
    expect(result[0].fechaEmision).toBe('2025-01-14');
  });
});

describe('parseFacturasRecibidas', () => {
  it('requires cuitEmisor and razonSocialEmisor headers', () => {
    const data = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence'],
      ['2025-01-15', 'file1', 'test.pdf', 'A', '00001-00000001', '20123456786', 'PROVEEDOR SA', '30709076783', 'ADVA', '', '', '1000', 'ARS', '', '2025-01-15T10:00:00Z', '0.95', 'NO', '', ''],
    ];

    const result = parseFacturasRecibidas(data);

    expect(result).toHaveLength(1);
    expect(result[0].cuitEmisor).toBe('20123456786');
    expect(result[0].razonSocialEmisor).toBe('PROVEEDOR SA');
  });

  it('throws error when cuitEmisor header is missing', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'razonSocialEmisor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', 'PROVEEDOR SA', '1000', 'ARS'],
    ];

    expect(() => parseFacturasRecibidas(data)).toThrow(/Required header 'cuitemisor' not found/);
  });

  it('throws error when razonSocialEmisor header is missing', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', '20123456786', '1000', 'ARS'],
    ];

    expect(() => parseFacturasRecibidas(data)).toThrow(/Required header 'razonsocialemisor' not found/);
  });

  it('handles optional headers gracefully when missing', () => {
    // Minimal required headers only
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', '20123456786', 'PROVEEDOR SA', '1000', 'ARS'],
    ];

    const result = parseFacturasRecibidas(data);

    expect(result).toHaveLength(1);
    expect(result[0].cuitReceptor).toBe(''); // Missing optional
    expect(result[0].razonSocialReceptor).toBe('');
    expect(result[0].importeNeto).toBe(0);
  });

  it('returns empty array for data with only headers', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeTotal', 'moneda'],
    ];

    expect(parseFacturasRecibidas(data)).toEqual([]);
  });

  it('returns empty array for empty data', () => {
    expect(parseFacturasRecibidas([])).toEqual([]);
  });

  it('skips rows without fileId', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', '20123456786', 'PROVEEDOR SA', '1000', 'ARS'],
      ['2025-01-16', '', 'A', '00001-00000002', '27234567891', 'OTRO PROVEEDOR', '2000', 'ARS'],
      ['2025-01-17', 'file3', 'B', '00001-00000003', '20111111119', 'TERCER PROVEEDOR', '3000', 'ARS'],
    ];

    const result = parseFacturasRecibidas(data);

    expect(result).toHaveLength(2);
    expect(result[0].fileId).toBe('file1');
    expect(result[1].fileId).toBe('file3');
  });

  it('includes row number (1-indexed, accounting for header)', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeTotal', 'moneda'],
      ['2025-01-15', 'file1', 'A', '00001-00000001', '20123456786', 'PROVEEDOR SA', '1000', 'ARS'],
      ['2025-01-16', 'file2', 'B', '00001-00000002', '27234567891', 'OTRO PROVEEDOR', '2000', 'ARS'],
    ];

    const result = parseFacturasRecibidas(data);

    expect(result[0].row).toBe(2); // Row 2 in spreadsheet (1 is header)
    expect(result[1].row).toBe(3);
  });

  it('normalizes serial number dates in fechaEmision', () => {
    const data = [
      ['fechaEmision', 'fileId', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeTotal', 'moneda'],
      [45671, 'file1', 'A', '00001-00000001', '20123456786', 'PROVEEDOR SA', 1000, 'ARS'],
    ];

    const result = parseFacturasRecibidas(data);

    expect(result).toHaveLength(1);
    // Serial number 45671 => '2025-01-14'
    expect(result[0].fechaEmision).toBe('2025-01-14');
  });
});

describe('isBetterMatch', () => {
  // ADV-34: Confidence level should be compared FIRST, before CUIT match
  it('should prefer HIGH confidence over MEDIUM with same metrics', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      confidence: 'MEDIUM',
      hasCuitMatch: true,
      dateDistance: 1,
      isExactAmount: true,
      hasLinkedPago: true,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 1,
      isExactAmount: true,
      hasLinkedPago: true,
    };

    expect(isBetterMatch(existing, candidate)).toBe(true);
  });

  it('should prefer MEDIUM confidence over LOW with same metrics', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      confidence: 'LOW',
      hasCuitMatch: true,
      dateDistance: 1,
      isExactAmount: true,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'MEDIUM',
      hasCuitMatch: true,
      dateDistance: 1,
      isExactAmount: true,
      hasLinkedPago: false,
    };

    expect(isBetterMatch(existing, candidate)).toBe(true);
  });

  it('should compare confidence before date distance', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      confidence: 'LOW',
      hasCuitMatch: true,
      dateDistance: 0,  // Same day
      isExactAmount: true,
      hasLinkedPago: true,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 30,  // 30 days away
      isExactAmount: false,
      hasLinkedPago: false,
    };

    // HIGH confidence should beat LOW even with worse date distance
    expect(isBetterMatch(existing, candidate)).toBe(true);
  });

  it('should prefer CUIT match over no CUIT match', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      confidence: 'HIGH',
      hasCuitMatch: false,
      dateDistance: 1,
      isExactAmount: true,
      hasLinkedPago: true,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
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
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 10,
      isExactAmount: false,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
      hasCuitMatch: false,
      dateDistance: 1,
      isExactAmount: true,
      hasLinkedPago: true,
    };

    expect(isBetterMatch(existing, candidate)).toBe(false);
  });

  it('should prefer closer date when confidence and CUIT match are equal', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 15,
      isExactAmount: true,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
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
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 2,
      isExactAmount: false,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 15,
      isExactAmount: true,
      hasLinkedPago: true,
    };

    expect(isBetterMatch(existing, candidate)).toBe(false);
  });

  it('should prefer exact amount when confidence, CUIT and date are equal', () => {
    const existing: MatchQuality = {
      fileId: 'file1',
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: false,
      hasLinkedPago: true,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
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
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: true,
      hasLinkedPago: false,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
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
      confidence: 'HIGH',
      hasCuitMatch: true,
      dateDistance: 5,
      isExactAmount: true,
      hasLinkedPago: true,
    };
    const candidate: MatchQuality = {
      fileId: 'file2',
      confidence: 'HIGH',
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
          concepto: 'PAGO TEST',
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
          concepto: 'TRANSFERENCIA RECIBIDA',
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
          concepto: 'UNKNOWN TX',
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
          concepto: 'PAGO TEST',
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
        { sheetName: '2025-01', rowNumber: 2, fecha: '2025-01-15', concepto: 'TX1', debito: 1000, credito: null, saldo: 9000, saldoCalculado: 9000, matchedFileId: '', detalle: '' },
        { sheetName: '2025-01', rowNumber: 3, fecha: '2025-01-16', concepto: 'TX2', debito: null, credito: 2000, saldo: 11000, saldoCalculado: 11000, matchedFileId: '', detalle: '' },
        { sheetName: '2025-01', rowNumber: 4, fecha: '2025-01-17', concepto: 'TX3', debito: 500, credito: null, saldo: 10500, saldoCalculado: 10500, matchedFileId: '', detalle: '' },
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
            ['fechaemision', 'fileid', 'filename', 'tipocomprobante', 'nrofactura', 'cuitemisor', 'razonsocialemisor', 'importeneto', 'importeiva', 'importetotal', 'moneda', 'concepto', 'processedat', 'confidence', 'needsreview', 'matchedpagofileid', 'matchconfidence', 'hascuitmatch', 'pagada'],
            ['2025-01-01', 'factura-far', 'far.pdf', 'B', '123', '20123456786', 'PROVEEDOR SA', '', '', '1000', 'ARS', '', '2025-01-01T10:00:00Z', '0.95', 'NO', '', '', '', ''],
            ['2025-01-16', 'factura-close', 'close.pdf', 'B', '124', '20123456786', 'PROVEEDOR SA', '', '', '1000', 'ARS', '', '2025-01-16T10:00:00Z', '0.95', 'NO', '', '', '', ''],
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
          concepto: 'PAGO A PROVEEDOR SA',
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
            ['fechaemision', 'fileid', 'filename', 'tipocomprobante', 'nrofactura', 'cuitemisor', 'razonsocialemisor', 'importeneto', 'importeiva', 'importetotal', 'moneda', 'concepto', 'processedat', 'confidence', 'needsreview', 'matchedpagofileid', 'matchconfidence', 'hascuitmatch', 'pagada'],
            ['2025-01-10', 'factura-with-cuit', 'cuit.pdf', 'B', '123', '20123456786', 'PROVEEDOR SA', '', '', '1000', 'ARS', '', '2025-01-10T10:00:00Z', '0.95', 'NO', '', '', 'YES', ''],
            ['2025-01-15', 'factura-no-cuit', 'nocuit.pdf', 'B', '124', '00000000000', 'OTRO SA', '', '', '1000', 'ARS', '', '2025-01-15T10:00:00Z', '0.95', 'NO', '', '', '', ''],
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
          concepto: 'PAGO 20123456786',  // CUIT match
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
            ['fechaemision', 'fileid', 'filename', 'tipocomprobante', 'nrofactura', 'cuitemisor', 'razonsocialemisor', 'importeneto', 'importeiva', 'importetotal', 'moneda', 'concepto', 'processedat', 'confidence', 'needsreview', 'matchedpagofileid', 'matchconfidence', 'hascuitmatch', 'pagada'],
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
          concepto: 'PAGO 20123456786',
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
            ['fechaemision', 'fileid', 'filename', 'tipocomprobante', 'nrofactura', 'cuitemisor', 'razonsocialemisor', 'importeneto', 'importeiva', 'importetotal', 'moneda', 'concepto', 'processedat', 'confidence', 'needsreview', 'matchedpagofileid', 'matchconfidence', 'hascuitmatch', 'pagada'],
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
          concepto: 'PAGO 20123456786',
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

describe('bank fee and credit card payment detalle writing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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

  it('should write detalle for bank_fee match with empty matchedFileId', async () => {
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
          concepto: 'COMISION MAN CUENTA',
          debito: 500,
          credito: null,
          saldo: 9500,
          saldoCalculado: 9500,
          matchedFileId: '',
          detalle: '',
        },
      ],
    });

    mockMatchMovement.mockReturnValue({
      matchType: 'bank_fee',
      description: 'Gastos bancarios',
      matchedFileId: '',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', expect.arrayContaining([
      expect.objectContaining({
        detalle: 'Gastos bancarios',
        matchedFileId: '',
      }),
    ]));
  });

  it('should write detalle for credit_card_payment match with empty matchedFileId', async () => {
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
          rowNumber: 3,
          fecha: '2025-01-20',
          concepto: 'PAGO TARJETA 4563',
          debito: 15000,
          credito: null,
          saldo: 5000,
          saldoCalculado: 5000,
          matchedFileId: '',
          detalle: '',
        },
      ],
    });

    mockMatchMovement.mockReturnValue({
      matchType: 'credit_card_payment',
      description: 'Pago de tarjeta de credito',
      matchedFileId: '',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', expect.arrayContaining([
      expect.objectContaining({
        detalle: 'Pago de tarjeta de credito',
        matchedFileId: '',
      }),
    ]));
  });

  it('should still produce no update for no_match results', async () => {
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
          concepto: 'UNKNOWN TX',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: '',
          detalle: '',
        },
      ],
    });

    // mockMatchMovement defaults to no_match

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 0 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', []);
  });

  it('should update bank_fee match in force mode', async () => {
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
          concepto: 'COMISION MAN CUENTA',
          debito: 500,
          credito: null,
          saldo: 9500,
          saldoCalculado: 9500,
          matchedFileId: '',
          detalle: 'Gastos bancarios',
        },
      ],
    });

    mockMatchMovement.mockReturnValue({
      matchType: 'bank_fee',
      description: 'Gastos bancarios',
      matchedFileId: '',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos({ force: true });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', expect.arrayContaining([
      expect.objectContaining({
        detalle: 'Gastos bancarios',
      }),
    ]));
  });

  it('should not overwrite existing bank_fee detalle when not in force mode', async () => {
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
          concepto: 'COMISION MAN CUENTA',
          debito: 500,
          credito: null,
          saldo: 9500,
          saldoCalculado: 9500,
          matchedFileId: '',
          detalle: 'Gastos bancarios',  // Already has detalle
        },
      ],
    });

    mockMatchMovement.mockReturnValue({
      matchType: 'bank_fee',
      description: 'Gastos bancarios',
      matchedFileId: '',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 0 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    // Should NOT update - existing bank_fee detalle, no quality improvement possible
    expect(updateDetalle).toHaveBeenCalledWith('bbva-id', []);
  });

  it('should increment debitsFilled counter for bank_fee debit matches', async () => {
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
          concepto: 'COMISION MAN CUENTA',
          debito: 500,
          credito: null,
          saldo: 9500,
          saldoCalculado: 9500,
          matchedFileId: '',
          detalle: '',
        },
      ],
    });

    mockMatchMovement.mockReturnValue({
      matchType: 'bank_fee',
      description: 'Gastos bancarios',
      matchedFileId: '',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalDebitsFilled).toBe(1);
      expect(result.value.totalCreditsFilled).toBe(0);
    }
  });
});

describe('computeRowVersion', () => {
  it('computes consistent version for same row data', async () => {
    const { computeRowVersion } = await import('./match-movimientos.js');

    const row = {
      fecha: '2025-01-15',
      concepto: 'PAGO TEST',
      debito: 1000,
      credito: null,
      matchedFileId: 'file123',
      detalle: 'Test detalle',
    };

    const version1 = computeRowVersion(row);
    const version2 = computeRowVersion(row);

    expect(version1).toBe(version2);
    expect(version1).toMatch(/^[a-f0-9]+$/); // Should be a hex string
  });

  it('computes different versions for different matchedFileId', async () => {
    const { computeRowVersion } = await import('./match-movimientos.js');

    const row1 = {
      fecha: '2025-01-15',
      concepto: 'PAGO TEST',
      debito: 1000,
      credito: null,
      matchedFileId: 'file123',
      detalle: 'Test detalle',
    };

    const row2 = {
      ...row1,
      matchedFileId: 'file456',
    };

    expect(computeRowVersion(row1)).not.toBe(computeRowVersion(row2));
  });

  it('computes different versions for different detalle', async () => {
    const { computeRowVersion } = await import('./match-movimientos.js');

    const row1 = {
      fecha: '2025-01-15',
      concepto: 'PAGO TEST',
      debito: 1000,
      credito: null,
      matchedFileId: 'file123',
      detalle: 'Detalle A',
    };

    const row2 = {
      ...row1,
      detalle: 'Detalle B',
    };

    expect(computeRowVersion(row1)).not.toBe(computeRowVersion(row2));
  });

  it('handles null/empty values consistently', async () => {
    const { computeRowVersion } = await import('./match-movimientos.js');

    const row1 = {
      fecha: '2025-01-15',
      concepto: 'PAGO TEST',
      debito: null,
      credito: 1000,
      matchedFileId: '',
      detalle: '',
    };

    const row2 = {
      fecha: '2025-01-15',
      concepto: 'PAGO TEST',
      debito: null,
      credito: 1000,
      matchedFileId: '',
      detalle: '',
    };

    expect(computeRowVersion(row1)).toBe(computeRowVersion(row2));
  });
});

describe('TOCTOU protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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

  it('skips update when row version changed between read and write', async () => {
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

    // Initial read returns row with empty match
    vi.mocked(getMovimientosToFill).mockResolvedValue({
      ok: true,
      value: [
        {
          sheetName: '2025-01',
          rowNumber: 2,
          fecha: '2025-01-15',
          concepto: 'PAGO TEST',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: '',  // Empty initially
          detalle: '',
        },
      ],
    });

    mockMatchMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'Pago Factura TEST',
      matchedFileId: 'factura123',
      confidence: 'HIGH',
    });

    // updateDetalle should receive expected version and skip if mismatch
    // The mock will simulate version mismatch by returning 0 updates
    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 0 });

    const resultPromise = matchAllMovimientos();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    // updateDetalle should be called with version information
    expect(updateDetalle).toHaveBeenCalledWith(
      'bbva-id',
      expect.arrayContaining([
        expect.objectContaining({
          sheetName: '2025-01',
          rowNumber: 2,
          matchedFileId: 'factura123',
          detalle: 'Pago Factura TEST',
          expectedVersion: expect.any(String),  // Version computed from initial read
        }),
      ])
    );
  });

  it('includes expectedVersion in DetalleUpdate for TOCTOU protection', async () => {
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
          concepto: 'PAGO TEST',
          debito: 1000,
          credito: null,
          saldo: 9000,
          saldoCalculado: 9000,
          matchedFileId: 'old-file',
          detalle: 'Old detalle',
        },
      ],
    });

    mockMatchMovement.mockReturnValue({
      matchType: 'direct_factura',
      description: 'New detalle',
      matchedFileId: 'new-file',
      confidence: 'HIGH',
    });

    vi.mocked(updateDetalle).mockResolvedValue({ ok: true, value: 1 });

    const resultPromise = matchAllMovimientos({ force: true });
    await vi.runAllTimersAsync();
    await resultPromise;

    // Verify expectedVersion is included and is based on initial row state
    const updateCall = vi.mocked(updateDetalle).mock.calls[0];
    const updates = (updateCall[1] as any) as Array<{expectedVersion: string}>;
    expect(updates.length).toBe(1);
    expect(updates[0]).toHaveProperty('expectedVersion');
    expect(typeof updates[0].expectedVersion).toBe('string');
    expect(updates[0].expectedVersion.length).toBeGreaterThan(0);
  });
});
