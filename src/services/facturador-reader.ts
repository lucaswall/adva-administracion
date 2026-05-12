/**
 * Facturador de Socios reader service
 *
 * NOTE: This is a cross-worker stub created by worker-4.
 * The authoritative implementation is provided by worker-2 (ADV-246).
 * The team lead resolves imports at merge time.
 *
 * This stub exports the minimal interface needed by subdiario-writer.ts
 * to compile and pass type checks.
 */

import type { Result } from '../types/index.js';

/**
 * Entry in the Facturador de Socios data.
 * Authoritative interface is defined by worker-2.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FacturadorEntry = Record<string, any>;

/**
 * Reads the Facturador de Socios spreadsheet for the given year.
 *
 * @param _year - Year to read (e.g., 2025)
 * @returns Map from CUIT string to FacturadorEntry
 */
export async function readFacturador(
  _year: number
): Promise<Result<Map<string, FacturadorEntry>, Error>> {
  // Stub — replaced by worker-2's implementation at merge time
  return { ok: true, value: new Map() };
}
