/**
 * Unit tests for bank auto-fill functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockGetCachedFolderStructure = vi.fn();
const mockGetValues = vi.fn();
const mockBatchUpdate = vi.fn();
const mockGetConfig = vi.fn();

vi.mock('../../../src/services/folder-structure.js', () => ({
  getCachedFolderStructure: () => mockGetCachedFolderStructure(),
}));

vi.mock('../../../src/services/sheets.js', () => ({
  getValues: (...args: unknown[]) => mockGetValues(...args),
  batchUpdate: (...args: unknown[]) => mockBatchUpdate(...args),
}));

vi.mock('../../../src/config.js', () => ({
  getConfig: () => mockGetConfig(),
}));

const mockMatchMovement = vi.fn().mockReturnValue({
  matchType: 'NO_MATCH',
  description: '',
  confidence: 0,
});

vi.mock('../../../src/bank/matcher.js', () => ({
  BankMovementMatcher: class {
    matchMovement = mockMatchMovement;
  },
}));

// Import after mocks
import { autoFillBankMovements } from '../../../src/bank/autofill.js';

describe('autoFillBankMovements', () => {
  const mockFolderStructure = {
    rootId: 'root-id',
    entradaId: 'entrada-id',
    creditosId: 'creditos-id',
    debitosId: 'debitos-id',
    sinProcesarId: 'sin-procesar-id',
    bancosId: 'bancos-id',
    controlCreditosId: 'control-creditos-id',
    controlDebitosId: 'control-debitos-id',
    bankSpreadsheets: new Map([
      ['BBVA', 'bbva-sheet-id'],
      ['Santander', 'santander-sheet-id'],
    ]),
    monthFolders: new Map(),
    lastRefreshed: new Date(),
  };

  const mockConfig = {
    nodeEnv: 'test' as const,
    port: 3000,
    logLevel: 'info' as const,
    googleServiceAccountKey: 'mock-key',
    geminiApiKey: 'mock-key',
    driveRootFolderId: 'mock-id',
    webhookUrl: 'http://localhost/webhook',
    matchDaysBefore: 10,
    matchDaysAfter: 60,
    usdArsTolerancePercent: 5,
  };

  const emptySheetData = [
    ['header1', 'header2'], // Header row
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedFolderStructure.mockReturnValue(mockFolderStructure);
    mockGetConfig.mockReturnValue(mockConfig);
    mockBatchUpdate.mockResolvedValue({ ok: true, value: undefined });

    // Default mock for getValues - return empty data
    mockGetValues.mockResolvedValue({
      ok: true,
      value: emptySheetData,
    });
  });

  describe('error handling', () => {
    it('returns error when folder structure not initialized', async () => {
      mockGetCachedFolderStructure.mockReturnValue(null);

      const result = await autoFillBankMovements();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Folder structure not initialized');
      }
    });

    it('returns error when facturas emitidas fetch fails', async () => {
      mockGetValues.mockResolvedValueOnce({
        ok: false,
        error: new Error('Failed to fetch'),
      });

      const result = await autoFillBankMovements();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to fetch');
      }
    });

    it('handles missing bank spreadsheet gracefully', async () => {
      // Mock folder structure without bank spreadsheets
      mockGetCachedFolderStructure.mockReturnValue({
        ...mockFolderStructure,
        bankSpreadsheets: new Map([['BBVA', undefined]]),
      });

      const result = await autoFillBankMovements();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.errors).toBeGreaterThan(0);
      }
    });

    it('handles sheets API error for bank movements', async () => {
      // First 5 calls succeed (control sheets), 6th fails (bank movements)
      mockGetValues
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // facturas emitidas
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // facturas recibidas
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // pagos recibidos
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // pagos enviados
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // recibos
        .mockResolvedValueOnce({ ok: false, error: new Error('Bank sheet error') }); // movements

      const result = await autoFillBankMovements();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.errors).toBeGreaterThan(0);
      }
    });
  });

  describe('processing', () => {
    it('processes movements from all banks when no bankName specified', async () => {
      const result = await autoFillBankMovements();

      expect(result.ok).toBe(true);
      // Should call getValues for both banks (plus 5 control sheet calls)
      expect(mockGetValues).toHaveBeenCalledTimes(7); // 5 control + 2 banks
    });

    it('processes movements from specific bank when bankName provided', async () => {
      const result = await autoFillBankMovements('BBVA');

      expect(result.ok).toBe(true);
      // Should call getValues for BBVA only (plus 5 control sheet calls)
      expect(mockGetValues).toHaveBeenCalledTimes(6); // 5 control + 1 bank
    });

    it('skips rows that already have detalle', async () => {
      // Mock movements with one row having detalle already filled
      mockGetValues
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // facturas emitidas
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // facturas recibidas
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // pagos recibidos
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // pagos enviados
        .mockResolvedValueOnce({ ok: true, value: emptySheetData }) // recibos
        .mockResolvedValueOnce({
          ok: true,
          value: [
            ['Fecha', 'FechaValor', 'Concepto', 'Codigo', 'Oficina', 'AreaADVA', 'Credito', 'Debito', 'Detalle'],
            ['2024-01-15', '2024-01-15', 'TRANSFERENCIA', '001', 'CENTRAL', 'VENTAS', 1000, null, 'Already filled'],
            ['2024-01-16', '2024-01-16', 'TRANSFERENCIA', '002', 'CENTRAL', 'VENTAS', 2000, null, ''],
          ],
        });

      const result = await autoFillBankMovements('BBVA');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rowsProcessed).toBe(1); // Only the one without detalle
      }
    });

    it('correctly counts different match types', async () => {
      // This is a basic sanity check - the actual matching logic is in BankMovementMatcher
      const result = await autoFillBankMovements();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveProperty('bankFeeMatches');
        expect(result.value).toHaveProperty('creditCardPaymentMatches');
        expect(result.value).toHaveProperty('subdiarioCobroMatches');
        expect(result.value).toHaveProperty('pagoFacturaMatches');
        expect(result.value).toHaveProperty('directFacturaMatches');
        expect(result.value).toHaveProperty('reciboMatches');
        expect(result.value).toHaveProperty('pagoOnlyMatches');
        expect(result.value).toHaveProperty('noMatches');
      }
    });
  });

  describe('return values', () => {
    it('returns statistics with all fields', async () => {
      const result = await autoFillBankMovements();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveProperty('rowsProcessed');
        expect(result.value).toHaveProperty('rowsFilled');
        expect(result.value).toHaveProperty('bankFeeMatches');
        expect(result.value).toHaveProperty('creditCardPaymentMatches');
        expect(result.value).toHaveProperty('subdiarioCobroMatches');
        expect(result.value).toHaveProperty('pagoFacturaMatches');
        expect(result.value).toHaveProperty('directFacturaMatches');
        expect(result.value).toHaveProperty('reciboMatches');
        expect(result.value).toHaveProperty('pagoOnlyMatches');
        expect(result.value).toHaveProperty('noMatches');
        expect(result.value).toHaveProperty('errors');
        expect(result.value).toHaveProperty('duration');
      }
    });

    it('tracks duration', async () => {
      const result = await autoFillBankMovements();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.duration).toBeGreaterThanOrEqual(0);
        expect(typeof result.value.duration).toBe('number');
      }
    });
  });

  describe('data fetching', () => {
    it('fetches from Control de Creditos spreadsheet', async () => {
      await autoFillBankMovements();

      // Should fetch Facturas Emitidas and Pagos Recibidos
      expect(mockGetValues).toHaveBeenCalledWith('control-creditos-id', 'Facturas Emitidas!A:W');
      expect(mockGetValues).toHaveBeenCalledWith('control-creditos-id', 'Pagos Recibidos!A:R');
    });

    it('fetches from Control de Debitos spreadsheet', async () => {
      await autoFillBankMovements();

      // Should fetch Facturas Recibidas, Pagos Enviados, and Recibos
      expect(mockGetValues).toHaveBeenCalledWith('control-debitos-id', 'Facturas Recibidas!A:W');
      expect(mockGetValues).toHaveBeenCalledWith('control-debitos-id', 'Pagos Enviados!A:R');
      expect(mockGetValues).toHaveBeenCalledWith('control-debitos-id', 'Recibos!A:S');
    });

    it('fetches bank movements from correct sheet', async () => {
      await autoFillBankMovements('BBVA');

      expect(mockGetValues).toHaveBeenCalledWith('bbva-sheet-id', 'Movimientos!A:I');
    });
  });
});
