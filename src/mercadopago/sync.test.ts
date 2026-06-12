/**
 * Tests for syncMercadopago orchestrator [ADV-369]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Module mocks (all must come before imports that reference them) ---

// Mock MP_ACCESS_TOKEN and PROCESSING_LOCK constants from config
let mockMpAccessToken: string | undefined = 'test-mp-token';
vi.mock('../config.js', () => ({
  get MP_ACCESS_TOKEN() { return mockMpAccessToken; },
  PROCESSING_LOCK_ID: 'document-processing',
  PROCESSING_LOCK_TIMEOUT_MS: 300000,
  PROCESSING_LOCK_EXPIRY_MS: 900000,
}));

// Mock concurrency - capture withLock calls for assertions
const mockWithLockFn = vi.fn();
vi.mock('../utils/concurrency.js', () => ({
  withLock: (...args: unknown[]) => mockWithLockFn(...args),
}));

// Mock logger
const mockWarn = vi.fn();
const mockInfo = vi.fn();
const mockLogError = vi.fn();
vi.mock('../utils/logger.js', () => ({
  warn: (...args: unknown[]) => mockWarn(...args),
  info: (...args: unknown[]) => mockInfo(...args),
  error: (...args: unknown[]) => mockLogError(...args),
  debug: vi.fn(),
}));

// Mock MP client
const mockSearchApprovedPayments = vi.fn();
vi.mock('./client.js', () => ({
  searchApprovedPayments: (...args: unknown[]) => mockSearchApprovedPayments(...args),
}));

// Mock transform
const mockPaymentsToMovimientos = vi.fn();
vi.mock('./transform.js', () => ({
  paymentsToMovimientos: (...args: unknown[]) => mockPaymentsToMovimientos(...args),
}));

// Mock movimientos-writer
const mockWriteMpMovimientos = vi.fn();
vi.mock('./movimientos-writer.js', () => ({
  writeMpMovimientos: (...args: unknown[]) => mockWriteMpMovimientos(...args),
}));

// Mock resumen-writer
const mockWriteMpResumenIfClosed = vi.fn();
vi.mock('./resumen-writer.js', () => ({
  writeMpResumenIfClosed: (...args: unknown[]) => mockWriteMpResumenIfClosed(...args),
}));

// Mock folder-structure
const mockGetOrCreateBankAccountFolder = vi.fn();
const mockGetOrCreateMovimientosSpreadsheet = vi.fn();
const mockGetOrCreateBankAccountSpreadsheet = vi.fn();
vi.mock('../services/folder-structure.js', () => ({
  getOrCreateBankAccountFolder: (...args: unknown[]) => mockGetOrCreateBankAccountFolder(...args),
  getOrCreateMovimientosSpreadsheet: (...args: unknown[]) => mockGetOrCreateMovimientosSpreadsheet(...args),
  getOrCreateBankAccountSpreadsheet: (...args: unknown[]) => mockGetOrCreateBankAccountSpreadsheet(...args),
}));

// Mock match-movimientos
const mockMatchAllMovimientos = vi.fn();
vi.mock('../bank/match-movimientos.js', () => ({
  matchAllMovimientos: (...args: unknown[]) => mockMatchAllMovimientos(...args),
}));

// Mock date utilities (so we can control "current period")
const mockBusinessDateString = vi.fn();
vi.mock('../utils/date.js', () => ({
  businessDateString: (d?: Date) => mockBusinessDateString(d),
}));

// --- Import after mocks ---
import { syncMercadopago } from './sync.js';

// Helper: sets up withLock to actually call its callback (simulating lock acquisition)
function setupWithLockPassthrough() {
  mockWithLockFn.mockImplementation(async (_id: string, fn: () => Promise<unknown>, _timeout?: number, _expiry?: number) => {
    try {
      const result = await fn();
      return { ok: true, value: result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
  });
}

// Helper: default payments fixture
function makePayment(overrides: Partial<{ collector_id: number; id: number }> = {}) {
  return {
    id: overrides.id ?? 1001,
    status: 'approved',
    date_approved: '2025-05-15T10:00:00Z',
    currency_id: 'ARS',
    transaction_amount: 1000,
    collector_id: overrides.collector_id ?? 987654,
  };
}

describe('syncMercadopago', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: current date in AR timezone is 2025-06-12
    mockBusinessDateString.mockReturnValue('2025-06-12');
    // Default: lock passthrough
    setupWithLockPassthrough();
    // Default folder/spreadsheet creation
    mockGetOrCreateBankAccountFolder.mockResolvedValue({ ok: true, value: 'folder-id' });
    mockGetOrCreateMovimientosSpreadsheet.mockResolvedValue({ ok: true, value: 'movimientos-id' });
    mockGetOrCreateBankAccountSpreadsheet.mockResolvedValue({ ok: true, value: 'control-id' });
    // Default writers
    mockWriteMpMovimientos.mockResolvedValue({ ok: true, value: { appended: 0, skippedExisting: 0 } });
    mockWriteMpResumenIfClosed.mockResolvedValue({ ok: true, value: { written: false } });
    // Default match
    mockMatchAllMovimientos.mockResolvedValue({ ok: true, value: { skipped: false, totalFilled: 0 } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- Disabled path ---

  describe('when MP_ACCESS_TOKEN is unset', () => {
    beforeEach(() => {
      mockMpAccessToken = undefined;
    });

    afterEach(() => {
      mockMpAccessToken = 'test-mp-token';
    });

    it('returns skipped result with reason mp_disabled', async () => {
      const result = await syncMercadopago();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ skipped: true, reason: 'mp_disabled' });
    });

    it('logs a warning', async () => {
      await syncMercadopago();
      expect(mockWarn).toHaveBeenCalledOnce();
    });

    it('makes no API calls', async () => {
      await syncMercadopago();
      expect(mockSearchApprovedPayments).not.toHaveBeenCalled();
    });

    it('does not acquire the processing lock', async () => {
      await syncMercadopago();
      expect(mockWithLockFn).not.toHaveBeenCalled();
    });
  });

  // --- Default periods ---

  describe('default periods (no arg)', () => {
    it('uses previous and current month in AR timezone', async () => {
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [], skipped: 0 });

      await syncMercadopago();

      // businessDateString returns '2025-06-12', so current = '2025-06', previous = '2025-05'
      expect(mockSearchApprovedPayments).toHaveBeenCalledWith('2025-05');
      expect(mockSearchApprovedPayments).toHaveBeenCalledWith('2025-06');
      expect(mockSearchApprovedPayments).toHaveBeenCalledTimes(2);
    });

    it('handles year-boundary rollover (January → previous is December of prior year)', async () => {
      mockBusinessDateString.mockReturnValue('2025-01-15');
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [], skipped: 0 });

      await syncMercadopago();

      expect(mockSearchApprovedPayments).toHaveBeenCalledWith('2024-12');
      expect(mockSearchApprovedPayments).toHaveBeenCalledWith('2025-01');
    });
  });

  // --- Period validation ---

  describe('period validation', () => {
    it('rejects malformed period format', async () => {
      const result = await syncMercadopago(['garbage']);
      expect(result.ok).toBe(false);
    });

    it('rejects period with invalid month (13)', async () => {
      const result = await syncMercadopago(['2025-13']);
      expect(result.ok).toBe(false);
    });

    it('rejects future period', async () => {
      // Current is 2025-06 so 2025-07 is future
      const result = await syncMercadopago(['2025-07']);
      expect(result.ok).toBe(false);
    });

    it('accepts current period', async () => {
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [], skipped: 0 });

      const result = await syncMercadopago(['2025-06']);
      expect(result.ok).toBe(true);
    });
  });

  // --- Happy path ---

  describe('happy path', () => {
    const payment = makePayment({ collector_id: 987654 });
    const movimiento = {
      fecha: '2025-05-15',
      concepto: 'Pago MP',
      debito: null,
      credito: 1000,
      saldo: 1000,
    };

    beforeEach(() => {
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [payment] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [movimiento], skipped: 0 });
      mockWriteMpMovimientos.mockResolvedValue({ ok: true, value: { appended: 1, skippedExisting: 0 } });
      mockWriteMpResumenIfClosed.mockResolvedValue({ ok: true, value: { written: true } });
    });

    it('creates bank folder with banco=Mercado Pago, numeroCuenta=collector_id, moneda=ARS', async () => {
      await syncMercadopago(['2025-05']);

      expect(mockGetOrCreateBankAccountFolder).toHaveBeenCalledWith(
        '2025',
        'Mercado Pago',
        '987654',
        'ARS'
      );
    });

    it('creates movimientos spreadsheet', async () => {
      await syncMercadopago(['2025-05']);

      expect(mockGetOrCreateMovimientosSpreadsheet).toHaveBeenCalledWith(
        'folder-id',
        '2025',
        expect.stringContaining('Mercado Pago'),
        'bancario'
      );
    });

    it('creates control (resumen) spreadsheet', async () => {
      await syncMercadopago(['2025-05']);

      expect(mockGetOrCreateBankAccountSpreadsheet).toHaveBeenCalledWith(
        'folder-id',
        '2025',
        'Mercado Pago',
        '987654',
        'ARS'
      );
    });

    it('calls writeMpMovimientos with correct args', async () => {
      await syncMercadopago(['2025-05']);

      expect(mockWriteMpMovimientos).toHaveBeenCalledWith(
        'movimientos-id',
        '2025-05',
        [movimiento],
        expect.any(Number)
      );
    });

    it('calls writeMpResumenIfClosed with correct args', async () => {
      await syncMercadopago(['2025-05']);

      expect(mockWriteMpResumenIfClosed).toHaveBeenCalledWith(
        'control-id',
        'movimientos-id',
        '2025-05',
        { collectorId: '987654' },
        expect.any(Date)
      );
    });

    it('returns aggregated stats', async () => {
      const result = await syncMercadopago(['2025-05']);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const stats = result.value;
      if ('skipped' in stats) throw new Error('unexpected skipped');
      expect(stats.periods).toEqual(['2025-05']);
      expect(stats.fetched).toBe(1);
      expect(stats.appended).toBe(1);
      expect(stats.skippedExisting).toBe(0);
      expect(stats.resumenesWritten).toBe(1);
    });

    it('aggregates stats across multiple periods', async () => {
      mockWriteMpMovimientos.mockResolvedValue({ ok: true, value: { appended: 2, skippedExisting: 1 } });
      mockWriteMpResumenIfClosed.mockResolvedValue({ ok: true, value: { written: false } });

      const result = await syncMercadopago(['2025-05', '2025-06']);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const stats = result.value;
      if ('skipped' in stats) throw new Error('unexpected skipped');
      expect(stats.periods).toEqual(['2025-05', '2025-06']);
      expect(stats.fetched).toBe(2); // 1 payment per period
      expect(stats.appended).toBe(4); // 2 per period
      expect(stats.skippedExisting).toBe(2); // 1 per period
      expect(stats.resumenesWritten).toBe(0); // written=false both times
    });
  });

  // --- Zero payments path ---

  describe('period with zero payments', () => {
    beforeEach(() => {
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [], skipped: 0 });
    });

    it('skips folder/workbook creation', async () => {
      await syncMercadopago(['2025-05']);

      expect(mockGetOrCreateBankAccountFolder).not.toHaveBeenCalled();
      expect(mockGetOrCreateMovimientosSpreadsheet).not.toHaveBeenCalled();
      expect(mockGetOrCreateBankAccountSpreadsheet).not.toHaveBeenCalled();
    });

    it('skips writes', async () => {
      await syncMercadopago(['2025-05']);

      expect(mockWriteMpMovimientos).not.toHaveBeenCalled();
      expect(mockWriteMpResumenIfClosed).not.toHaveBeenCalled();
    });

    it('still reports period in stats', async () => {
      const result = await syncMercadopago(['2025-05']);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const stats = result.value;
      if ('skipped' in stats) throw new Error('unexpected skipped');
      expect(stats.periods).toContain('2025-05');
      expect(stats.fetched).toBe(0);
    });
  });

  // --- Processing lock ---

  describe('processing lock', () => {
    it('acquires PROCESSING_LOCK_ID with correct timeout and expiry', async () => {
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [], skipped: 0 });

      // Override withLock to capture args
      let capturedId: string | undefined;
      let capturedTimeout: number | undefined;
      let capturedExpiry: number | undefined;
      mockWithLockFn.mockImplementation(async (id: string, fn: () => Promise<unknown>, timeout: number, expiry: number) => {
        capturedId = id;
        capturedTimeout = timeout;
        capturedExpiry = expiry;
        const result = await fn();
        return { ok: true, value: result };
      });

      await syncMercadopago(['2025-05']);

      expect(capturedId).toBe('document-processing');
      expect(capturedTimeout).toBe(300000);
      expect(capturedExpiry).toBe(900000);
    });

    it('returns error when lock cannot be acquired', async () => {
      mockWithLockFn.mockResolvedValue({ ok: false, error: new Error('Lock timeout') });

      const result = await syncMercadopago(['2025-05']);

      expect(result.ok).toBe(false);
    });
  });

  // --- Match auto-trigger ---

  describe('match auto-trigger', () => {
    it('triggers matchAllMovimientos after lock release when appended > 0', async () => {
      const payment = makePayment();
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [payment] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [{ fecha: '2025-05-15', concepto: 'x', debito: null, credito: 100, saldo: 100 }], skipped: 0 });
      mockWriteMpMovimientos.mockResolvedValue({ ok: true, value: { appended: 1, skippedExisting: 0 } });
      mockWriteMpResumenIfClosed.mockResolvedValue({ ok: true, value: { written: false } });

      await syncMercadopago(['2025-05']);

      // Allow any pending microtasks to settle
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockMatchAllMovimientos).toHaveBeenCalled();
    });

    it('does NOT trigger matchAllMovimientos when nothing was appended', async () => {
      const payment = makePayment();
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [payment] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [{ fecha: '2025-05-15', concepto: 'x', debito: null, credito: 100, saldo: 100 }], skipped: 0 });
      mockWriteMpMovimientos.mockResolvedValue({ ok: true, value: { appended: 0, skippedExisting: 1 } });
      mockWriteMpResumenIfClosed.mockResolvedValue({ ok: true, value: { written: false } });

      await syncMercadopago(['2025-05']);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockMatchAllMovimientos).not.toHaveBeenCalled();
    });

    it('does NOT trigger matchAllMovimientos when there are zero payments', async () => {
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [], skipped: 0 });

      await syncMercadopago(['2025-05']);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockMatchAllMovimientos).not.toHaveBeenCalled();
    });

    it('triggers matchAllMovimientos AFTER lock is released (not inside)', async () => {
      const payment = makePayment();
      mockSearchApprovedPayments.mockResolvedValue({ ok: true, value: [payment] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [{ fecha: '2025-05-15', concepto: 'x', debito: null, credito: 100, saldo: 100 }], skipped: 0 });
      mockWriteMpMovimientos.mockResolvedValue({ ok: true, value: { appended: 1, skippedExisting: 0 } });
      mockWriteMpResumenIfClosed.mockResolvedValue({ ok: true, value: { written: false } });

      let matchCalledDuringLock = false;
      let lockReleased = false;
      mockWithLockFn.mockImplementation(async (_id: string, fn: () => Promise<unknown>) => {
        const result = await fn();
        lockReleased = true;
        // Check if matchAllMovimientos was called BEFORE lock released
        matchCalledDuringLock = mockMatchAllMovimientos.mock.calls.length > 0;
        return { ok: true, value: result };
      });

      await syncMercadopago(['2025-05']);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(lockReleased).toBe(true);
      expect(matchCalledDuringLock).toBe(false); // match was NOT called inside lock
      expect(mockMatchAllMovimientos).toHaveBeenCalled(); // but was called after
    });
  });

  // --- Partial failure ---

  describe('partial failure handling', () => {
    it('returns ok:false when a period fails but still attempts remaining periods', async () => {
      // Period 2025-05 fails, 2025-06 succeeds
      mockSearchApprovedPayments
        .mockResolvedValueOnce({ ok: false, error: new Error('API error for 2025-05') })
        .mockResolvedValueOnce({ ok: true, value: [] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [], skipped: 0 });

      const result = await syncMercadopago(['2025-05', '2025-06']);

      expect(result.ok).toBe(false);
      // Both periods should have been attempted
      expect(mockSearchApprovedPayments).toHaveBeenCalledTimes(2);
    });

    it('continues processing after a period error', async () => {
      const payment = makePayment();
      mockSearchApprovedPayments
        .mockResolvedValueOnce({ ok: false, error: new Error('Period 1 error') })
        .mockResolvedValueOnce({ ok: true, value: [payment] });
      mockPaymentsToMovimientos.mockReturnValue({ movimientos: [{ fecha: '2025-05-15', concepto: 'x', debito: null, credito: 100, saldo: 100 }], skipped: 0 });
      mockWriteMpMovimientos.mockResolvedValue({ ok: true, value: { appended: 1, skippedExisting: 0 } });
      mockWriteMpResumenIfClosed.mockResolvedValue({ ok: true, value: { written: false } });

      const result = await syncMercadopago(['2025-05', '2025-06']);

      expect(result.ok).toBe(false);
      // Second period should have been processed (folder/workbook created)
      expect(mockGetOrCreateBankAccountFolder).toHaveBeenCalledTimes(1);
    });
  });
});
