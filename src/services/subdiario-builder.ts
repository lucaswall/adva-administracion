/**
 * Subdiario de Ventas builder — pure function
 *
 * NOTE: This is a cross-worker stub created by worker-4.
 * The authoritative implementation is provided by worker-3 (ADV-247).
 * The team lead resolves imports at merge time.
 *
 * This stub exports the minimal interface needed by subdiario-writer.ts
 * to compile and pass type checks.
 */

import type { SubdiarioRow, SubdiarioInput } from './subdiario-writer.js';

/**
 * Builds Subdiario de Ventas rows from source data.
 *
 * @param _input - Source data bundle
 * @returns Array of comprobante rows for the Comprobantes sheet
 */
export function buildSubdiarioRows(_input: SubdiarioInput): SubdiarioRow[] {
  // Stub — replaced by worker-3's implementation at merge time
  return [];
}
