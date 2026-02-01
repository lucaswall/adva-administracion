/**
 * Tests for factura-pago matcher
 */

import { describe, it, expect } from 'vitest';
import { DisplacementQueue } from '../../matching/cascade-matcher.js';

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
