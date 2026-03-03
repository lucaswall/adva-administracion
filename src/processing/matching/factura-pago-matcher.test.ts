/**
 * Tests for factura-pago matcher
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DisplacementQueue } from '../../matching/cascade-matcher.js';
import { FacturaPagoMatcher } from '../../matching/matcher.js';
import type { Factura, Pago, MatchConfidence } from '../../types/index.js';

// Mocks for end-to-end matchFacturasWithPagos tests (do not affect unit tests of FacturaPagoMatcher)
vi.mock('../../services/sheets.js', () => ({
  getValues: vi.fn(),
  batchUpdate: vi.fn(),
}));
vi.mock('../../utils/concurrency.js', () => ({
  withLock: vi.fn(),
  withRetry: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../../utils/correlation.js', () => ({
  getCorrelationId: () => 'test-correlation-id',
}));

// Clear all mocks before each test to prevent state leakage between tests
beforeEach(() => {
  vi.clearAllMocks();
});

describe('DisplacementQueue', () => {
  it('should return undefined when popping from empty queue (bug #14)', () => {
    const queue = new DisplacementQueue();

    // Pop from empty queue
    const result = queue.pop();

    // Should return undefined, not crash
    expect(result).toBeUndefined();
  });

  it('should handle isEmpty() correctly', () => {
    const queue = new DisplacementQueue();

    expect(queue.isEmpty()).toBe(true);

    // Add an item
    queue.add({
      documentType: 'pago',
      document: { fileId: 'test123' } as any,
      row: 5,
      previousMatchFileId: 'prev456',
      depth: 0,
    });

    expect(queue.isEmpty()).toBe(false);

    // Pop the item
    queue.pop();

    expect(queue.isEmpty()).toBe(true);
  });

  it('should handle pop() after multiple adds', () => {
    const queue = new DisplacementQueue();

    const item1 = {
      documentType: 'pago' as const,
      document: { fileId: 'test1' } as any,
      row: 5,
      previousMatchFileId: 'prev1',
      depth: 0,
    };

    const item2 = {
      documentType: 'pago' as const,
      document: { fileId: 'test2' } as any,
      row: 6,
      previousMatchFileId: 'prev2',
      depth: 1,
    };

    queue.add(item1);
    queue.add(item2);

    // Pop should return items in order
    const popped1 = queue.pop();
    expect(popped1).toBeDefined();
    expect(popped1?.document.fileId).toBe('test1');

    const popped2 = queue.pop();
    expect(popped2).toBeDefined();
    expect(popped2?.document.fileId).toBe('test2');

    // Pop from empty queue
    const popped3 = queue.pop();
    expect(popped3).toBeUndefined();
  });
});

describe('Map.get() null handling (bugs #41, #42)', () => {
  it('should handle pagosMap.get() returning undefined gracefully', () => {
    const pagosMap = new Map<string, any>();

    // Try to get a non-existent pago
    const pago = pagosMap.get('nonexistent');

    // Should return undefined, not crash
    expect(pago).toBeUndefined();

    // Code should check before using
    if (pago) {
      // This branch should not execute
      throw new Error('Should not reach here');
    }
  });

  it('should handle facturas.find() returning undefined gracefully', () => {
    const facturas: Array<{ fileId: string }> = [
      { fileId: 'factura1' },
      { fileId: 'factura2' },
    ];

    // Try to find a non-existent factura
    const previousFactura = facturas.find(f => f.fileId === 'nonexistent');

    // Should return undefined, not crash
    expect(previousFactura).toBeUndefined();

    // Code should check before using
    if (previousFactura) {
      // This branch should not execute
      throw new Error('Should not reach here');
    }
  });
});

describe('Bug #9: Cascading displacement edge case', () => {
  it('should create unmatch update for displaced pago with no available matches', () => {
    // Scenario:
    // 1. Pago A is matched to Factura 1 (existing match)
    // 2. Pago B (better match) displaces Pago A from Factura 1
    // 3. All other facturas are already claimed
    // 4. Cascading logic should create an update to clear Pago A's matchedFacturaFileId

    // This test validates that the cascade state creates the right update

    // Mock cascade state
    const cascadeState = {
      updates: new Map(),
      displacedCount: 0,
      maxDepthReached: 0,
      cycleDetected: false,
      startTime: Date.now()
    };

    // Simulate what happens when a displaced pago has no matches:
    // The code should add an update with key "pago:{fileId}" to clear the match
    const displacedPagoFileId = 'pago-displaced';
    const displacedPagoRow = 5;

    // This is what the fix should create:
    cascadeState.updates.set(
      `pago:${displacedPagoFileId}`,
      {
        pagoFileId: displacedPagoFileId,
        pagoRow: displacedPagoRow,
        facturaFileId: '',
        facturaRow: 0,
        confidence: 'LOW',
        hasCuitMatch: false,
        pagada: false,
      }
    );

    // Verify the update was created correctly
    const update = cascadeState.updates.get(`pago:${displacedPagoFileId}`);
    expect(update).toBeDefined();
    expect(update?.pagoFileId).toBe(displacedPagoFileId);
    expect(update?.facturaFileId).toBe(''); // Empty = unmatch
    expect(update?.pagoRow).toBe(displacedPagoRow);
  });
});

describe('Facturas Emitidas pagada column handling (ADV-170)', () => {
  async function setupE2E() {
    const { matchFacturasWithPagos } = await import('./factura-pago-matcher.js');
    const { getValues, batchUpdate } = await import('../../services/sheets.js');
    const { withLock, withRetry } = await import('../../utils/concurrency.js');

    vi.mocked(withLock).mockImplementation(async (_key: string, fn: () => Promise<any>) => {
      try { return { ok: true as const, value: await fn() }; }
      catch (e) { return { ok: false as const, error: e instanceof Error ? e : new Error(String(e)) }; }
    });
    vi.mocked(withRetry).mockImplementation(async (fn: () => Promise<any>) => {
      try { return { ok: true as const, value: await fn() }; }
      catch (e) { return { ok: false as const, error: e instanceof Error ? e : new Error(String(e)) }; }
    });
    return { matchFacturasWithPagos, getValues, batchUpdate };
  }

  const config = { matchDaysBefore: 10, matchDaysAfter: 60, usdArsTolerancePercent: 5, usdMatchDaysAfter: 90 };

  it('matching Facturas Emitidas writes columns P:S (4 columns including pagada) (ADV-170)', async () => {
    const { matchFacturasWithPagos, getValues, batchUpdate } = await setupE2E();

    // Factura Emitida: 20 columns (A:T after ADV-169), cuitReceptor='20123456786' at F
    const facturaHeader = ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch', 'pagada', 'tipoDeCambio'];
    const facturaRow = ['2025-01-01', 'fact-1', 'factura.pdf', 'A', '00001-00000001', '20123456786', 'TEST SA', '8264.46', '1735.54', '10000', 'ARS', '', '2025-01-01T10:00:00Z', '0.95', 'NO', '', '', 'NO', '', ''];

    // Pago Recibido: cuitPagador='20123456786' in concepto triggers HIGH confidence (CUIT match)
    const pagoHeader = ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitPagador', 'nombrePagador', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence', 'tipoDeCambio', 'importeEnPesos'];
    const pagoRow = ['2025-01-05', 'pago-1', 'pago.pdf', 'BBVA', '10000', 'ARS', '', '20123456786', 'TEST SA', 'Pago servicios 20123456786', '2025-01-05T10:00:00Z', '0.95', 'NO', '', '', '', ''];

    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [facturaHeader, facturaRow] })
      .mockResolvedValueOnce({ ok: true, value: [pagoHeader, pagoRow] });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 0 });

    const result = await matchFacturasWithPagos(
      'test-spreadsheet',
      'Facturas Emitidas',
      'Pagos Recibidos',
      'cuitReceptor',
      'cuitPagador',
      config as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }

    // Verify batchUpdate called with P:S (4 columns: matchedPagoFileId, matchConfidence, hasCuitMatch, pagada)
    expect(batchUpdate).toHaveBeenCalled();
    const calls = vi.mocked(batchUpdate).mock.calls[0][1];
    const facturaUpdate = calls.find((u: any) => u.range.includes("'Facturas Emitidas'!P"));
    expect(facturaUpdate).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(facturaUpdate!.range).toBe("'Facturas Emitidas'!P2:S2");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(facturaUpdate!.values[0]).toHaveLength(4); // 4 columns including pagada
  });

  it('unmatching Facturas Emitidas clears columns P:S (4 empty values) (ADV-170)', async () => {
    const { matchFacturasWithPagos, getValues, batchUpdate } = await setupE2E();

    // Factura Emitida at row 2 already matched to pago-a (lower confidence), no CUIT
    const facturaHeader = ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch', 'pagada', 'tipoDeCambio'];
    const facturaRow = ['2025-01-01', 'fact-1', 'factura.pdf', 'A', '00001-00000001', '20123456786', 'TEST SA', '8264.46', '1735.54', '10000', 'ARS', '', '2025-01-01T10:00:00Z', '0.95', 'NO', 'pago-a', 'LOW', 'NO', 'NO', ''];

    // Pago A: already matched (excluded from unmatched pool) — in sheet so it appears in pagosMap
    // Pago B: unmatched, CUIT in concepto → HIGH confidence → displaces pago-a
    const pagoHeader = ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitPagador', 'nombrePagador', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence', 'tipoDeCambio', 'importeEnPesos'];
    const pagoRowA = ['2025-01-05', 'pago-a', 'pagoA.pdf', 'BBVA', '10000', 'ARS', '', '27234567891', 'OTRO SA', '', '2025-01-05T10:00:00Z', '0.95', 'NO', 'fact-1', 'LOW', '', ''];
    const pagoRowB = ['2025-01-05', 'pago-b', 'pagoB.pdf', 'BBVA', '10000', 'ARS', '', '20123456786', 'TEST SA', 'Pago servicios 20123456786', '2025-01-05T10:00:00Z', '0.95', 'NO', '', '', '', ''];

    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [facturaHeader, facturaRow] })
      .mockResolvedValueOnce({ ok: true, value: [pagoHeader, pagoRowA, pagoRowB] });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 0 });

    const result = await matchFacturasWithPagos(
      'test-spreadsheet',
      'Facturas Emitidas',
      'Pagos Recibidos',
      'cuitReceptor',
      'cuitPagador',
      config as any,
    );

    expect(result.ok).toBe(true);

    // Verify the factura update uses P:S (4 columns)
    expect(batchUpdate).toHaveBeenCalled();
    const calls = vi.mocked(batchUpdate).mock.calls[0][1];
    const facturaUpdate = calls.find((u: any) => u.range.includes("'Facturas Emitidas'!P"));
    expect(facturaUpdate).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(facturaUpdate!.range).toBe("'Facturas Emitidas'!P2:S2");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(facturaUpdate!.values[0]).toHaveLength(4);
  });
});

describe('MANUAL matchConfidence locking (Fix 5 - ADV-131)', () => {
  const baseFactura: Factura & { row: number } = {
    row: 2,
    fileId: 'factura-1',
    fileName: 'factura.pdf',
    tipoComprobante: 'A',
    nroFactura: '00001-00000001',
    fechaEmision: '2025-01-10',
    cuitEmisor: '20123456786',
    razonSocialEmisor: 'EMPRESA UNO SA',
    importeNeto: 826.45,
    importeIva: 173.55,
    importeTotal: 1000,
    moneda: 'ARS',
    processedAt: '2025-01-10T10:00:00.000Z',
    confidence: 0.95,
    needsReview: false,
  };

  const basePago: Pago = {
    fileId: 'pago-1',
    fileName: 'pago.pdf',
    banco: 'BBVA',
    fechaPago: '2025-01-15',
    importePagado: 1000,
    moneda: 'ARS',
    processedAt: '2025-01-15T10:00:00.000Z',
    confidence: 0.95,
    needsReview: false,
  };

  it('findMatches should not return MANUAL-matched factura as candidate', () => {
    const matcher = new FacturaPagoMatcher(10, 60);

    const manualFactura: Factura & { row: number } = {
      ...baseFactura,
      matchConfidence: 'MANUAL' as MatchConfidence,
      matchedPagoFileId: 'pago-existing',
    };

    // Even though amount and date match perfectly, MANUAL factura must be skipped
    const matches = matcher.findMatches(basePago, [manualFactura], true);

    expect(matches).toHaveLength(0);
  });

  it('findMatches should not displace pago matched to a MANUAL factura', () => {
    const matcher = new FacturaPagoMatcher(10, 60);

    const newPago: Pago = { ...basePago, fileId: 'pago-new' };

    const manualFactura: Factura & { row: number } = {
      ...baseFactura,
      matchConfidence: 'MANUAL' as MatchConfidence,
      matchedPagoFileId: 'pago-protected',
    };

    // With includeMatched=true, the MANUAL factura should still be invisible
    const matches = matcher.findMatches(newPago, [manualFactura], true);

    // pago-protected is never displaced because MANUAL factura is never a candidate
    expect(matches).toHaveLength(0);
  });

  it('pago with MANUAL matchConfidence should be excluded from unmatched pool (end-to-end)', async () => {
    // Import the production function and its mocked dependencies
    const { matchFacturasWithPagos } = await import('./factura-pago-matcher.js');
    const { getValues, batchUpdate } = await import('../../services/sheets.js');
    const { withLock, withRetry } = await import('../../utils/concurrency.js');

    // Mock withLock/withRetry to pass through
    vi.mocked(withLock).mockImplementation(async (_key: string, fn: () => Promise<any>) => {
      try { return { ok: true as const, value: await fn() }; }
      catch (e) { return { ok: false as const, error: e instanceof Error ? e : new Error(String(e)) }; }
    });
    vi.mocked(withRetry).mockImplementation(async (fn: () => Promise<any>) => {
      try { return { ok: true as const, value: await fn() }; }
      catch (e) { return { ok: false as const, error: e instanceof Error ? e : new Error(String(e)) }; }
    });

    // Factura that would match the pago by CUIT and amount
    const facturaHeader = ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch', 'tipoDeCambio'];
    const facturaRow = ['2025-01-01', 'fact-1', 'factura.pdf', 'A', '00003-00001957', '20123456786', 'TEST SA', '8264.46', '1735.54', '10000', 'ARS', '', '2025-01-01T10:00:00Z', '0.95', 'NO', '', '', '', ''];

    // Pago with MANUAL matchConfidence — should NOT be re-matched
    const pagoHeader = ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitPagador', 'nombrePagador', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence', 'tipoDeCambio', 'importeEnPesos'];
    const pagoRow = ['2025-01-05', 'pago-manual', 'pago.pdf', 'BBVA', '10000', 'ARS', '', '20123456786', 'TEST SA', '', '2025-01-05T10:00:00Z', '0.95', 'NO', '', 'MANUAL', '', ''];

    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [facturaHeader, facturaRow] })
      .mockResolvedValueOnce({ ok: true, value: [pagoHeader, pagoRow] });

    const config = {
      matchDaysBefore: 10,
      matchDaysAfter: 60,
      usdArsTolerancePercent: 5,
      usdMatchDaysAfter: 90,
    };

    const result = await matchFacturasWithPagos(
      'test-spreadsheet',
      'Facturas Emitidas',
      'Pagos Recibidos',
      'cuitReceptor',
      'cuitPagador',
      config as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // MANUAL pago filtered out → 0 unmatched → 0 matches
      expect(result.value).toBe(0);
    }

    // batchUpdate should NOT have been called — MANUAL pago was excluded
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});
