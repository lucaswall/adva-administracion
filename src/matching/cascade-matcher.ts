/**
 * Cascading match displacement system
 * Allows better-quality matches to replace existing matches with automatic re-matching
 */

import type { Pago, Factura, Recibo, MatchConfidence } from '../types/index.js';
import { compareMatchQuality, type MatchQuality } from './matcher.js';

/**
 * Item in the displacement queue
 * Represents a document that was displaced and needs to be re-matched
 */
export interface DisplacementQueueItem {
  /** Type of document being displaced */
  documentType: 'pago' | 'factura' | 'recibo';
  /** The displaced document */
  document: Pago | Factura | Recibo;
  /** Row number in the spreadsheet */
  row: number;
  /** File ID of the previous match (if any) */
  previousMatchFileId?: string;
  /** Current depth in the cascade chain */
  depth: number;
}

/**
 * Queue for managing cascading displacements
 * Uses FIFO order and tracks processed documents to prevent duplicates
 */
export class DisplacementQueue {
  private queue: DisplacementQueueItem[] = [];
  private processed: Set<string> = new Set();

  /**
   * Adds an item to the queue if not already processed
   */
  add(item: DisplacementQueueItem): void {
    const docId = (item.document as { fileId: string }).fileId;
    if (!this.processed.has(docId)) {
      this.queue.push(item);
      this.processed.add(docId);
    }
  }

  /**
   * Removes and returns the next item from the queue
   */
  pop(): DisplacementQueueItem | undefined {
    return this.queue.shift();
  }

  /**
   * Checks if the queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Returns the number of items currently in the queue
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clears the queue and processed set
   */
  clear(): void {
    this.queue = [];
    this.processed.clear();
  }
}

/**
 * Match update to be applied to spreadsheet
 */
export interface MatchUpdate {
  /** File ID of the factura or recibo being updated */
  facturaFileId?: string;
  reciboFileId?: string;
  /** Row number in the spreadsheet */
  facturaRow?: number;
  reciboRow?: number;
  /** File ID of the matched pago (or empty string to unmatch) */
  pagoFileId: string;
  /** Match confidence level */
  confidence: MatchConfidence;
  /** Whether the match has CUIT/CUIL match */
  hasCuitMatch: boolean;
  /** Whether the factura has been paid (facturas only) */
  pagada?: boolean;
}

/**
 * State tracking for the cascade operation
 */
export interface CascadeState {
  /** Map of updates keyed by document fileId */
  updates: Map<string, MatchUpdate>;
  /** Number of displacements that occurred */
  displacedCount: number;
  /** Maximum depth reached in the cascade */
  maxDepthReached: number;
  /** Whether a cycle was detected */
  cycleDetected: boolean;
  /** Start time for timeout detection */
  startTime: number;
}

/**
 * Tracks which documents have been claimed during the cascade
 * Prevents multiple pagos from claiming the same factura/recibo
 */
export interface CascadeClaims {
  /** Set of claimed factura fileIds */
  claimedFacturas: Set<string>;
  /** Set of claimed pago fileIds */
  claimedPagos: Set<string>;
  /** Set of claimed recibo fileIds */
  claimedRecibos: Set<string>;
}

/**
 * Compares two match qualities to determine if new match is strictly better
 * Uses the three-tier comparison system:
 * 1. Confidence level (HIGH > MEDIUM > LOW)
 * 2. CUIT/CUIL match (has match > no match)
 * 3. Date proximity (closer > farther)
 *
 * @returns true if newQuality is strictly better than existingQuality
 */
export function isBetterMatch(
  newQuality: MatchQuality,
  existingQuality: MatchQuality
): boolean {
  return compareMatchQuality(newQuality, existingQuality) > 0;
}

/**
 * Detects if adding a document would create a cycle in the displacement chain
 *
 * @param visited - Set of already visited document IDs
 * @param newDocId - ID of the document to check
 * @returns true if adding newDocId would create a cycle
 */
export function detectCycle(visited: Set<string>, newDocId: string): boolean {
  return visited.has(newDocId);
}

/**
 * Builds a match update object for a factura-pago match
 */
export function buildFacturaMatchUpdate(
  facturaFileId: string,
  facturaRow: number,
  pagoFileId: string,
  confidence: MatchConfidence,
  hasCuitMatch: boolean,
  pagada: boolean = true
): MatchUpdate {
  return {
    facturaFileId,
    facturaRow,
    pagoFileId,
    confidence,
    hasCuitMatch,
    pagada,
  };
}

/**
 * Builds a match update object for a recibo-pago match
 */
export function buildReciboMatchUpdate(
  reciboFileId: string,
  reciboRow: number,
  pagoFileId: string,
  confidence: MatchConfidence,
  hasCuitMatch: boolean
): MatchUpdate {
  return {
    reciboFileId,
    reciboRow,
    pagoFileId,
    confidence,
    hasCuitMatch,
  };
}

/**
 * Builds a match update object to unmatch a document
 */
export function buildUnmatchUpdate(
  documentFileId: string,
  documentRow: number,
  documentType: 'factura' | 'recibo'
): MatchUpdate {
  if (documentType === 'factura') {
    return {
      facturaFileId: documentFileId,
      facturaRow: documentRow,
      pagoFileId: '',
      confidence: 'LOW',
      hasCuitMatch: false,
      pagada: false,
    };
  } else {
    return {
      reciboFileId: documentFileId,
      reciboRow: documentRow,
      pagoFileId: '',
      confidence: 'LOW',
      hasCuitMatch: false,
    };
  }
}
