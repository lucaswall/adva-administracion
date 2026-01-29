/**
 * Unit tests for cascading match displacement
 * Tests the core data structures and helpers for cascading matches
 */

import { describe, it, expect } from 'vitest';
import type { Factura, Pago, Recibo, MatchConfidence } from '../types/index.js';
import {
  DisplacementQueue,
  DisplacementQueueItem,
  CascadeState,
  CascadeClaims,
  isBetterMatch,
  detectCycle,
} from './cascade-matcher.js';
import type { MatchQuality } from './matcher.js';

// Helper to create test Factura
function createFactura(
  fileId: string,
  fechaEmision: string,
  importeTotal: number,
  cuitEmisor?: string,
  matchedPagoFileId?: string,
  matchConfidence?: MatchConfidence
): Factura & { row: number } {
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    tipoComprobante: 'A',
    nroFactura: '00001-00001234',
    fechaEmision,
    cuitEmisor: cuitEmisor || '20123456786',
    razonSocialEmisor: 'TEST SA',
    importeNeto: importeTotal / 1.21,
    importeIva: importeTotal - importeTotal / 1.21,
    importeTotal,
    moneda: 'ARS',
    processedAt: new Date().toISOString(),
    confidence: 0.95,
    needsReview: false,
    matchedPagoFileId,
    matchConfidence,
    row: 2, // Arbitrary row number
  };
}

// Helper to create test Pago
function createPago(
  fileId: string,
  fechaPago: string,
  importePagado: number,
  cuitBeneficiario?: string,
  matchedFacturaFileId?: string
): Pago {
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    banco: 'BBVA',
    fechaPago,
    importePagado,
    moneda: 'ARS',
    cuitBeneficiario,
    nombreBeneficiario: 'TEST SA',
    processedAt: new Date().toISOString(),
    confidence: 0.9,
    needsReview: false,
    matchedFacturaFileId,
  };
}

// Helper to create test Recibo
function createRecibo(
  fileId: string,
  fechaPago: string,
  totalNeto: number,
  cuilEmpleado?: string,
  matchedPagoFileId?: string,
  matchConfidence?: MatchConfidence
): Recibo & { row: number } {
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    tipoRecibo: 'sueldo',
    nombreEmpleado: 'MARTIN, Miguel',
    cuilEmpleado: cuilEmpleado || '20271190523',
    legajo: '1',
    cuitEmpleador: '30709076783',
    periodoAbonado: 'enero/2024',
    fechaPago,
    subtotalRemuneraciones: totalNeto * 1.3,
    subtotalDescuentos: totalNeto * 0.3,
    totalNeto,
    processedAt: new Date().toISOString(),
    confidence: 0.95,
    needsReview: false,
    matchedPagoFileId,
    matchConfidence,
    row: 2,
  };
}

describe('Cascade Matcher - Core Data Structures', () => {
  describe('DisplacementQueue', () => {
    it('should add and pop items in FIFO order', () => {
      const queue = new DisplacementQueue();
      const pago1 = createPago('pago-1', '2024-01-15', 1000);
      const pago2 = createPago('pago-2', '2024-01-16', 2000);

      queue.add({
        documentType: 'pago',
        document: pago1,
        row: 2,
        depth: 0,
      });
      queue.add({
        documentType: 'pago',
        document: pago2,
        row: 3,
        depth: 1,
      });

      expect(queue.isEmpty()).toBe(false);
      const first = queue.pop();
      expect(first?.document.fileId).toBe('pago-1');
      const second = queue.pop();
      expect(second?.document.fileId).toBe('pago-2');
      expect(queue.isEmpty()).toBe(true);
    });

    it('should track processed documents to prevent duplicates', () => {
      const queue = new DisplacementQueue();
      const pago1 = createPago('pago-1', '2024-01-15', 1000);

      queue.add({
        documentType: 'pago',
        document: pago1,
        row: 2,
        depth: 0,
      });

      // Try to add same document again
      queue.add({
        documentType: 'pago',
        document: pago1,
        row: 2,
        depth: 1,
      });

      // Should only have one item
      expect(queue.pop()?.document.fileId).toBe('pago-1');
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return undefined when popping from empty queue', () => {
      const queue = new DisplacementQueue();
      expect(queue.pop()).toBeUndefined();
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('CascadeState', () => {
    it('should initialize with empty state', () => {
      const state: CascadeState = {
        updates: new Map(),
        displacedCount: 0,
        maxDepthReached: 0,
        cycleDetected: false,
        startTime: Date.now(),
      };

      expect(state.updates.size).toBe(0);
      expect(state.displacedCount).toBe(0);
      expect(state.maxDepthReached).toBe(0);
      expect(state.cycleDetected).toBe(false);
      expect(state.startTime).toBeGreaterThan(0);
    });

    it('should track multiple updates', () => {
      const state: CascadeState = {
        updates: new Map(),
        displacedCount: 0,
        maxDepthReached: 0,
        cycleDetected: false,
        startTime: Date.now(),
      };

      // Add some updates
      state.updates.set('fact-1', {
        facturaFileId: 'fact-1',
        facturaRow: 2,
        pagoFileId: 'pago-1',
        confidence: 'HIGH',
        hasCuitMatch: true,
      });
      state.updates.set('fact-2', {
        facturaFileId: 'fact-2',
        facturaRow: 3,
        pagoFileId: 'pago-2',
        confidence: 'MEDIUM',
        hasCuitMatch: false,
      });

      expect(state.updates.size).toBe(2);
      expect(state.updates.get('fact-1')?.pagoFileId).toBe('pago-1');
      expect(state.updates.get('fact-2')?.confidence).toBe('MEDIUM');
    });
  });

  describe('CascadeClaims', () => {
    it('should track claimed documents across all types', () => {
      const claims: CascadeClaims = {
        claimedFacturas: new Set(),
        claimedPagos: new Set(),
        claimedRecibos: new Set(),
      };

      claims.claimedFacturas.add('fact-1');
      claims.claimedFacturas.add('fact-2');
      claims.claimedPagos.add('pago-1');
      claims.claimedRecibos.add('recibo-1');

      expect(claims.claimedFacturas.size).toBe(2);
      expect(claims.claimedPagos.size).toBe(1);
      expect(claims.claimedRecibos.size).toBe(1);
      expect(claims.claimedFacturas.has('fact-1')).toBe(true);
      expect(claims.claimedFacturas.has('fact-3')).toBe(false);
    });
  });
});

describe('Cascade Matcher - Quality Comparison', () => {
  describe('isBetterMatch', () => {
    it('should detect HIGH confidence > MEDIUM confidence', () => {
      const highMatch: MatchQuality = {
        confidence: 'HIGH',
        hasCuitMatch: false,
        dateProximityDays: 10,
      };
      const mediumMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 5,
      };

      expect(isBetterMatch(highMatch, mediumMatch)).toBe(true);
      expect(isBetterMatch(mediumMatch, highMatch)).toBe(false);
    });

    it('should detect MEDIUM confidence > LOW confidence', () => {
      const mediumMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 20,
      };
      const lowMatch: MatchQuality = {
        confidence: 'LOW',
        hasCuitMatch: true,
        dateProximityDays: 1,
      };

      expect(isBetterMatch(mediumMatch, lowMatch)).toBe(true);
      expect(isBetterMatch(lowMatch, mediumMatch)).toBe(false);
    });

    it('should prefer CUIT match within same confidence tier', () => {
      const withCuit: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 10,
      };
      const withoutCuit: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 5,
      };

      expect(isBetterMatch(withCuit, withoutCuit)).toBe(true);
      expect(isBetterMatch(withoutCuit, withCuit)).toBe(false);
    });

    it('should prefer closer date within same confidence and CUIT match', () => {
      const closerDate: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 3,
      };
      const fartherDate: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 15,
      };

      expect(isBetterMatch(closerDate, fartherDate)).toBe(true);
      expect(isBetterMatch(fartherDate, closerDate)).toBe(false);
    });

    it('should return false for equal quality matches', () => {
      const match1: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 5,
      };
      const match2: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 5,
      };

      expect(isBetterMatch(match1, match2)).toBe(false);
      expect(isBetterMatch(match2, match1)).toBe(false);
    });

    it('should handle same-tier displacement by date proximity', () => {
      const closer: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 2,
      };
      const farther: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 10,
      };

      expect(isBetterMatch(closer, farther)).toBe(true);
      expect(isBetterMatch(farther, closer)).toBe(false);
    });
  });

  describe('detectCycle', () => {
    it('should detect simple cycle A→B→A', () => {
      const visited = new Set<string>(['pago-A', 'pago-B']);
      expect(detectCycle(visited, 'pago-A')).toBe(true);
    });

    it('should detect complex cycle A→B→C→A', () => {
      const visited = new Set<string>(['pago-A', 'pago-B', 'pago-C']);
      expect(detectCycle(visited, 'pago-A')).toBe(true);
    });

    it('should not detect cycle for new document', () => {
      const visited = new Set<string>(['pago-A', 'pago-B', 'pago-C']);
      expect(detectCycle(visited, 'pago-D')).toBe(false);
    });

    it('should not detect cycle with empty visited set', () => {
      const visited = new Set<string>();
      expect(detectCycle(visited, 'pago-A')).toBe(false);
    });

    it('should detect immediate cycle A→A', () => {
      const visited = new Set<string>(['pago-A']);
      expect(detectCycle(visited, 'pago-A')).toBe(true);
    });
  });
});

describe('Cascade Matcher - Displacement Scenarios', () => {
  describe('Basic Displacement', () => {
    it('should allow HIGH confidence to displace MEDIUM confidence', () => {
      // Fact-1 currently matched to Pago-A (MEDIUM confidence, no CUIT match, 10 days)
      // Pago-B wants to match Fact-1 with HIGH confidence (CUIT match, 5 days)
      const existingMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 10,
      };
      const newMatch: MatchQuality = {
        confidence: 'HIGH',
        hasCuitMatch: true,
        dateProximityDays: 5,
      };

      expect(isBetterMatch(newMatch, existingMatch)).toBe(true);
    });

    it('should allow MEDIUM confidence to displace LOW confidence', () => {
      const existingMatch: MatchQuality = {
        confidence: 'LOW',
        hasCuitMatch: false,
        dateProximityDays: 30,
      };
      const newMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 15,
      };

      expect(isBetterMatch(newMatch, existingMatch)).toBe(true);
    });
  });

  describe('Same-Tier Displacement', () => {
    it('should allow MEDIUM closer date to displace MEDIUM farther date', () => {
      const existingMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 20,
      };
      const newMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 5,
      };

      expect(isBetterMatch(newMatch, existingMatch)).toBe(true);
    });

    it('should allow LOW with CUIT to displace LOW without CUIT', () => {
      const existingMatch: MatchQuality = {
        confidence: 'LOW',
        hasCuitMatch: false,
        dateProximityDays: 10,
      };
      const newMatch: MatchQuality = {
        confidence: 'LOW',
        hasCuitMatch: true,
        dateProximityDays: 15,
      };

      expect(isBetterMatch(newMatch, existingMatch)).toBe(true);
    });
  });

  describe('Equal Quality No-Op', () => {
    it('should NOT allow displacement for equal quality matches', () => {
      const existingMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 10,
      };
      const newMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 10,
      };

      expect(isBetterMatch(newMatch, existingMatch)).toBe(false);
    });

    it('should NOT allow worse match to displace better match', () => {
      const existingMatch: MatchQuality = {
        confidence: 'HIGH',
        hasCuitMatch: true,
        dateProximityDays: 3,
      };
      const newMatch: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 15,
      };

      expect(isBetterMatch(newMatch, existingMatch)).toBe(false);
    });
  });

  describe('CUIT Priority', () => {
    it('should allow CUIT match to displace non-CUIT match in same tier', () => {
      const withoutCuit: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: false,
        dateProximityDays: 5,
      };
      const withCuit: MatchQuality = {
        confidence: 'MEDIUM',
        hasCuitMatch: true,
        dateProximityDays: 10,
      };

      // CUIT match should win even with slightly worse date proximity
      expect(isBetterMatch(withCuit, withoutCuit)).toBe(true);
    });

    it('should NOT allow non-CUIT to displace CUIT in same tier', () => {
      const withCuit: MatchQuality = {
        confidence: 'HIGH',
        hasCuitMatch: true,
        dateProximityDays: 10,
      };
      const withoutCuit: MatchQuality = {
        confidence: 'HIGH',
        hasCuitMatch: false,
        dateProximityDays: 3,
      };

      // Even with better date, no CUIT should not displace CUIT match
      expect(isBetterMatch(withoutCuit, withCuit)).toBe(false);
    });
  });

  describe('Termination Conditions', () => {
    it('should stop at max cascade depth (10 iterations)', () => {
      // This will be tested in integration tests with full cascade logic
      // Here we just verify the depth tracking in queue items
      const queue = new DisplacementQueue();
      const pago = createPago('pago-deep', '2024-01-15', 1000);

      queue.add({
        documentType: 'pago',
        document: pago,
        row: 2,
        depth: 10,
      });

      const item = queue.pop();
      expect(item?.depth).toBe(10);
    });

    it('should track cycle detection state', () => {
      const state: CascadeState = {
        updates: new Map(),
        displacedCount: 0,
        maxDepthReached: 0,
        cycleDetected: false,
        startTime: Date.now(),
      };

      // Simulate cycle detection
      state.cycleDetected = true;
      expect(state.cycleDetected).toBe(true);
    });

    it('should track elapsed time for timeout detection', () => {
      const state: CascadeState = {
        updates: new Map(),
        displacedCount: 0,
        maxDepthReached: 0,
        cycleDetected: false,
        startTime: Date.now(),
      };

      const elapsed = Date.now() - state.startTime;
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });
  });
});
