/**
 * Condición IVA Receptor backfill service (ADV-380)
 *
 * Populates blank col H (condicionIVAReceptor) on existing Facturas Emitidas
 * rows in Control de Ingresos. Idempotent — rows already filled are skipped.
 *
 * HYBRID SOURCING strategy per row:
 *  1. Already filled → skip (idempotent)
 *  2. nroFactura matches a socio in Facturador → use Facturador's Cond IVA (no Gemini)
 *  3. Non-socio → re-extract via existing Gemini pipeline (processFile)
 */

import type { Result, FacturadorEntry } from '../types/index.js';
import type { Factura } from '../types/index.js';
import { getValues, updateRowsWithFormatting, getSpreadsheetTimezone } from './sheets.js';
import { readFacturador, normalizeNroComprobante } from './facturador-reader.js';
import { processFile } from '../processing/extractor.js';
import { businessYear } from '../utils/date.js';
import { warn, info } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of the pure sourcing decision for a single row */
export interface SourcingDecision {
  strategy: 'facturador' | 'parse' | 'skip';
  /** The condición IVA value — only set when strategy = 'facturador' */
  condIVA?: string;
}

/** Options for backfillCondicionIva */
export interface BackfillOptions {
  /** Control de Ingresos spreadsheet ID */
  controlIngresosId: string;
  /**
   * Maximum number of data rows to process in this run.
   * Omit to process all blank-H rows (full backfill).
   */
  limit?: number;
}

/** Summary of the backfill run */
export interface BackfillResult {
  /** Total data rows examined (excludes header) */
  scanned: number;
  /** Rows filled using the Facturador (no Gemini call) */
  filledFromFacturador: number;
  /** Rows filled via Gemini re-extraction */
  filledFromParse: number;
  /** Rows that already had condicionIVAReceptor set (skipped) */
  skipped: number;
  /** Rows where sourcing or writing failed */
  failed: number;
}

// ---------------------------------------------------------------------------
// Col indices for Facturas Emitidas (A:U, 0-indexed)
// ---------------------------------------------------------------------------

const COL_FILE_ID = 1;     // B
const COL_FILE_NAME = 2;   // C
const COL_NRO_FACTURA = 4; // E
const COL_COND_IVA = 7;   // H

// ---------------------------------------------------------------------------
// Pure sourcing-decision function (no I/O — unit-testable)
// ---------------------------------------------------------------------------

/**
 * Decides how to source condicionIVAReceptor for a Facturas Emitidas row.
 *
 * Rules (in order):
 *  1. currentCondIVA is non-blank → skip (already filled; idempotent)
 *  2. nroFactura matches a socio in facturadorMap AND condIVA is non-blank → facturador
 *  3. Otherwise → parse (Gemini re-extraction)
 *
 * @param row - Minimal row fields needed for the decision
 * @param facturadorMap - Map keyed by normalised comprobante → FacturadorEntry
 * @returns Sourcing decision with optional condIVA value for facturador strategy
 */
export function decideSourcing(
  row: { nroFactura: string; currentCondIVA: string },
  facturadorMap: Map<string, FacturadorEntry>
): SourcingDecision {
  // Rule 1: already filled → skip
  if (row.currentCondIVA.trim() !== '') {
    return { strategy: 'skip' };
  }

  // Rule 2: socio in Facturador with non-blank condIVA → use it directly
  const normalizedNro = normalizeNroComprobante(row.nroFactura);
  const entry = facturadorMap.get(normalizedNro);
  if (entry && entry.condIVA.trim() !== '') {
    return { strategy: 'facturador', condIVA: entry.condIVA };
  }

  // Rule 3: non-socio or missing condIVA → re-extract via Gemini
  return { strategy: 'parse' };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Backfills condicionIVAReceptor (col H) on existing Facturas Emitidas rows.
 *
 * Idempotent: rows that already have col H filled are counted as skipped and
 * not touched. Safe to run multiple times.
 *
 * @param opts - Backfill options (spreadsheet ID, optional limit)
 * @returns Result with tally of processed/skipped/failed rows
 */
export async function backfillCondicionIva(opts: BackfillOptions): Promise<Result<BackfillResult, Error>> {
  const { controlIngresosId, limit } = opts;

  // 1. Read all Facturas Emitidas rows (A:U covers the full 21-col emitida schema)
  const rowsResult = await getValues(controlIngresosId, 'Facturas Emitidas!A:U');
  if (!rowsResult.ok) {
    return { ok: false, error: rowsResult.error };
  }

  const allRows = rowsResult.value;
  if (allRows.length < 2) {
    // Header-only or empty sheet
    return {
      ok: true,
      value: { scanned: 0, filledFromFacturador: 0, filledFromParse: 0, skipped: 0, failed: 0 },
    };
  }

  // 2. Load Facturador map for current business year
  const facturadorResult = await readFacturador(businessYear());
  if (!facturadorResult.ok) {
    return { ok: false, error: facturadorResult.error };
  }
  const facturadorMap = facturadorResult.value;

  // 3. Get spreadsheet timezone for updateRowsWithFormatting
  const tzResult = await getSpreadsheetTimezone(controlIngresosId);
  const timeZone = tzResult.ok ? tzResult.value : undefined;

  // 4. Iterate over data rows (skip header at index 0)
  const dataRows = allRows.slice(1);
  const rowsToProcess = limit !== undefined ? dataRows.slice(0, limit) : dataRows;

  const tally: BackfillResult = {
    scanned: 0,
    filledFromFacturador: 0,
    filledFromParse: 0,
    skipped: 0,
    failed: 0,
  };

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];

    // Skip completely empty rows
    if (!row || row.length === 0) continue;

    const fileId = String(row[COL_FILE_ID] || '');
    if (!fileId) continue;

    const fileName = String(row[COL_FILE_NAME] || '');
    const nroFactura = String(row[COL_NRO_FACTURA] || '');
    const currentCondIVA = String(row[COL_COND_IVA] || '');

    // Spreadsheet row index (1-indexed; +1 for header row, +1 for 0→1-base)
    const spreadsheetRowIndex = i + 2;

    tally.scanned++;

    const decision = decideSourcing({ nroFactura, currentCondIVA }, facturadorMap);

    if (decision.strategy === 'skip') {
      tally.skipped++;
      continue;
    }

    let condIVA: string | undefined;

    if (decision.strategy === 'facturador') {
      condIVA = decision.condIVA;
      tally.filledFromFacturador++;
    } else {
      // 'parse': re-extract via Gemini
      const extractResult = await processFile({
        id: fileId,
        name: fileName,
        mimeType: 'application/pdf',
        lastUpdated: new Date(),
      });

      if (!extractResult.ok) {
        warn('Backfill: extraction failed for row', {
          module: 'condicion-backfill',
          phase: 'parse',
          fileId,
          nroFactura,
          error: extractResult.error.message,
        });
        tally.failed++;
        continue;
      }

      if (extractResult.value.documentType !== 'factura_emitida') {
        warn('Backfill: unexpected document type on re-extraction', {
          module: 'condicion-backfill',
          phase: 'parse',
          fileId,
          documentType: extractResult.value.documentType,
        });
        tally.failed++;
        continue;
      }

      const factura = extractResult.value.document as Factura | undefined;
      condIVA = factura?.condicionIVAReceptor;

      if (!condIVA) {
        warn('Backfill: extraction succeeded but condicionIVAReceptor is absent', {
          module: 'condicion-backfill',
          phase: 'parse',
          fileId,
          nroFactura,
        });
        tally.failed++;
        continue;
      }

      tally.filledFromParse++;
    }

    // 5. Write col H in place (single-cell update)
    const cellRange = `Facturas Emitidas!H${spreadsheetRowIndex}:H${spreadsheetRowIndex}`;
    const updateResult = await updateRowsWithFormatting(
      controlIngresosId,
      [{ range: cellRange, values: [condIVA ?? ''] }],
      timeZone
    );

    if (!updateResult.ok) {
      warn('Backfill: failed to write condicionIVAReceptor', {
        module: 'condicion-backfill',
        phase: 'write',
        fileId,
        spreadsheetRowIndex,
        error: updateResult.error.message,
      });
      tally.failed++;
      // Revert the increment for this row
      if (decision.strategy === 'facturador') {
        tally.filledFromFacturador--;
      } else {
        tally.filledFromParse--;
      }
    } else {
      info('Backfill: filled condicionIVAReceptor', {
        module: 'condicion-backfill',
        fileId,
        nroFactura,
        strategy: decision.strategy,
        condIVA,
        spreadsheetRowIndex,
      });
    }
  }

  return { ok: true, value: tally };
}
