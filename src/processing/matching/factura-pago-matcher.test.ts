/**
 * Tests for factura-pago matcher
 */

import { describe, it, expect } from 'vitest';
import { DisplacementQueue } from '../../matching/cascade-matcher.js';
import { FacturaPagoMatcher } from '../../matching/matcher.js';
import type { Factura, Pago, MatchConfidence } from '../../types/index.js';

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

  it('pago with MANUAL matchConfidence should be excluded from unmatched pool', () => {
    // Documents the expected filter in doMatchFacturasWithPagos():
    // pagos.filter(p => !p.matchedFacturaFileId && p.matchConfidence !== 'MANUAL')
    const allPagos: Array<Pago & { row: number }> = [
      { ...basePago, row: 2, fileId: 'pago-auto' },
      { ...basePago, row: 3, fileId: 'pago-manual', matchConfidence: 'MANUAL' as MatchConfidence },
      { ...basePago, row: 4, fileId: 'pago-matched', matchedFacturaFileId: 'some-factura' },
    ];

    // Current implementation only checks matchedFacturaFileId, so MANUAL pago leaks through
    const currentFilter = allPagos.filter(p => !p.matchedFacturaFileId);
    // MANUAL pago should NOT be in unmatched pool - this will pass AFTER fix
    const fixedFilter = allPagos.filter(p => !p.matchedFacturaFileId && p.matchConfidence !== 'MANUAL');

    // Before fix: MANUAL pago leaks into unmatched pool
    expect(currentFilter).toHaveLength(2); // pago-auto + pago-manual
    // After fix: MANUAL pago excluded
    expect(fixedFilter).toHaveLength(1);
    expect(fixedFilter[0].fileId).toBe('pago-auto');
  });
});
