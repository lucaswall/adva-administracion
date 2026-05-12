/**
 * Subdiario de Ventas writer service
 * Orchestrates reading source data and writing to the Subdiario de Ventas workbook.
 *
 * Cross-worker dependencies (resolved at merge time by team lead):
 *  - buildSubdiarioRows from ./subdiario-builder.js  (worker-3)
 *  - readFacturador       from ./facturador-reader.js (worker-2)
 */

import type { Result } from '../types/index.js';
import {
  getValues,
  setValues,
  appendRowsWithLinks,
  clearSheetData,
  getSpreadsheetTimezone,
  getSheetMetadata,
  renameSheet,
  formatSheet,
  type CellValueOrLink,
} from './sheets.js';
import { findByName, createSpreadsheet } from './drive.js';
import { getCachedFolderStructure } from './folder-structure.js';
import { SUBDIARIO_COMPROBANTES_HEADERS } from '../constants/spreadsheet-headers.js';
import { info, warn, error as logError } from '../utils/logger.js';
import { getCorrelationId } from '../utils/correlation.js';

// Cross-worker deps — imported by name; lead resolves at merge
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { buildSubdiarioRows } from './subdiario-builder.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { readFacturador } from './facturador-reader.js';

/** MIME type for Google Sheets spreadsheets */
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Name of the Subdiario workbook in Drive */
const SUBDIARIO_NAME = 'Subdiario de Ventas';

/** Name of the Comprobantes sheet inside the Subdiario workbook */
const COMPROBANTES_SHEET = 'Comprobantes';

/**
 * Minimum shape of a SubdiarioRow as produced by buildSubdiarioRows.
 * The authoritative interface lives in subdiario-builder.ts (worker-3).
 * Fields MUST match SUBDIARIO_COMPROBANTES_HEADERS order.
 */
export interface SubdiarioRow {
  /** Date of the comprobante (ISO YYYY-MM-DD) */
  fecha: string;
  /** Comprobante code (e.g., tipoComprobante: A, B, C, …) */
  cod: string;
  /** Human-readable document type */
  tipo: string;
  /** Full comprobante number (e.g., "00003-00001957") */
  nro: string;
  /** Client / counterparty name */
  cliente: string;
  /** Client CUIT */
  cuit: string;
  /** IVA condition label */
  condicion: string;
  /** Total amount (ARS) */
  total: number;
  /** Concept / description */
  concepto: string;
  /** Category for accounting */
  categoria: string;
  /** Date payment was received (ISO YYYY-MM-DD, or null if not yet paid) */
  fechaCobro: string | null;
  /** Amount actually received (0 if not paid) */
  recibido: number;
  /** Free-form notes */
  notas: string;
  /** Whether this row represents a detected payment gap */
  gap?: boolean;
}

/**
 * Input data bundle passed to buildSubdiarioRows.
 * All arrays include the raw header row at index 0.
 */
export interface SubdiarioInput {
  /** Raw rows from Facturas Emitidas (Control de Ingresos) */
  facturasEmitidas: unknown[][];
  /** Raw rows from Pagos Recibidos (Control de Ingresos) */
  pagosRecibidos: unknown[][];
  /** Raw rows from Retenciones Recibidas (Control de Ingresos) */
  retencionesRecibidas: unknown[][];
  /**
   * Facturador de Socios data keyed by CUIT.
   * Type is unknown here; authoritative type lives in facturador-reader.ts (worker-2).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  facturador: Map<string, any>;
  /** Flat array of all bank-movement rows from all movimientos spreadsheets */
  movimientos: unknown[][];
}

/**
 * Result of the Subdiario sync operation.
 */
export interface SyncSubdiarioResult {
  /** Number of data rows written to Comprobantes */
  rowsWritten: number;
  /** Number of rows flagged as payment gaps by the builder */
  gapsDetected: number;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Resolves the Subdiario spreadsheet ID.
 * Resolution order: FolderStructure cache → Drive search → create.
 *
 * @param rootFolderId - Root Drive folder ID
 * @returns `{ id, isNew }` — isNew=true when the workbook was just created
 */
async function resolveSubdiarioId(
  rootFolderId: string
): Promise<Result<{ id: string; isNew: boolean }, Error>> {
  const cached = getCachedFolderStructure();

  // 1. Check cache
  if (cached?.subdiarioId) {
    return { ok: true, value: { id: cached.subdiarioId, isNew: false } };
  }

  // 2. Search Drive
  const findResult = await findByName(rootFolderId, SUBDIARIO_NAME, SPREADSHEET_MIME);
  if (!findResult.ok) return findResult;

  if (findResult.value) {
    const id = findResult.value.id;
    if (cached) cached.subdiarioId = id;
    return { ok: true, value: { id, isNew: false } };
  }

  // 3. Create new workbook
  const createResult = await createSpreadsheet(rootFolderId, SUBDIARIO_NAME);
  if (!createResult.ok) return createResult;

  const id = createResult.value.id;
  if (cached) cached.subdiarioId = id;
  info('Created Subdiario de Ventas workbook', {
    module: 'subdiario-writer',
    phase: 'create-workbook',
    spreadsheetId: id,
  });
  return { ok: true, value: { id, isNew: true } };
}

/**
 * Renames Sheet1 → Comprobantes, freezes row 1, and writes the header row.
 * Called only when the workbook was just created.
 *
 * @param spreadsheetId - The newly-created Subdiario spreadsheet ID
 */
async function initializeComprobantesSheet(
  spreadsheetId: string
): Promise<Result<void, Error>> {
  // Get current sheet metadata to find Sheet1
  const metadataResult = await getSheetMetadata(spreadsheetId);
  if (!metadataResult.ok) return metadataResult;

  // Fall back to the first available sheet if the locale-specific name differs
  // (e.g. "Hoja 1" on Spanish Drive, "Feuille 1" on French Drive).
  const sheet1 = metadataResult.value.find((s) => s.title === 'Sheet1') ?? metadataResult.value[0];
  if (!sheet1) {
    return { ok: false, error: new Error('No sheets found in newly-created workbook') };
  }

  const renameResult = await renameSheet(spreadsheetId, sheet1.sheetId, COMPROBANTES_SHEET);
  if (!renameResult.ok) return renameResult;

  // Freeze row 1 + bold header
  const formatResult = await formatSheet(spreadsheetId, sheet1.sheetId, { frozenRows: 1 });
  if (!formatResult.ok) return formatResult;

  // Write header row
  const setResult = await setValues(
    spreadsheetId,
    `${COMPROBANTES_SHEET}!A1`,
    [SUBDIARIO_COMPROBANTES_HEADERS]
  );
  if (!setResult.ok) return setResult;

  return { ok: true, value: undefined };
}

/**
 * Reads all movimiento rows from the provided movimientos spreadsheets.
 * Returns a flat array of raw rows (excluding header rows from each sheet).
 */
async function readMovimientosRows(
  movimientosSpreadsheets: Map<string, string>
): Promise<unknown[][]> {
  if (movimientosSpreadsheets.size === 0) return [];

  const allRows: unknown[][] = [];

  for (const [key, spreadsheetId] of movimientosSpreadsheets) {
    // Get list of monthly sheets in this spreadsheet
    const metadataResult = await getSheetMetadata(spreadsheetId);
    if (!metadataResult.ok) {
      warn('Failed to get movimientos sheet metadata', {
        module: 'subdiario-writer',
        phase: 'read-movimientos',
        key,
        error: metadataResult.error.message,
      });
      continue;
    }

    for (const sheet of metadataResult.value) {
      // Skip non-YYYY-MM sheets (e.g., "Status")
      if (!/^\d{4}-\d{2}$/.test(sheet.title)) continue;

      const rowsResult = await getValues(spreadsheetId, `${sheet.title}!A:I`);
      if (!rowsResult.ok) {
        warn('Failed to read movimientos sheet', {
          module: 'subdiario-writer',
          phase: 'read-movimientos',
          key,
          sheet: sheet.title,
          error: rowsResult.error.message,
        });
        continue;
      }

      // Skip header row (index 0)
      const dataRows = rowsResult.value.slice(1);
      allRows.push(...dataRows);
    }
  }

  return allRows;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Syncs the Subdiario de Ventas workbook.
 *
 * Orchestrates:
 *   1. Resolve or create the Subdiario spreadsheet
 *   2. Initialize Comprobantes sheet on first run (rename, freeze, header)
 *   3. Read source data (Facturas Emitidas, Pagos Recibidos, Retenciones, Facturador, Movimientos)
 *   4. Delegate to buildSubdiarioRows
 *   5. Clear Comprobantes data rows (subsequent runs)
 *   6. Write new rows via appendRowsWithLinks
 *
 * @param rootFolderId       - Drive root folder ID
 * @param controlIngresosId  - Control de Ingresos spreadsheet ID
 * @param controlEgresosId   - Control de Egresos spreadsheet ID (reserved for future use)
 * @param facturadorYear     - Year used to read Facturador de Socios data
 * @param movimientosSpreadsheets - Map of (year:bankFolder) → movimientos spreadsheet IDs
 * @returns rowsWritten and gapsDetected counts
 */
export async function syncSubdiario(
  rootFolderId: string,
  controlIngresosId: string,
  _controlEgresosId: string,
  facturadorYear: number,
  movimientosSpreadsheets: Map<string, string>
): Promise<Result<SyncSubdiarioResult, Error>> {
  const correlationId = getCorrelationId();

  try {
    info('Starting Subdiario de Ventas sync', {
      module: 'subdiario-writer',
      phase: 'sync',
      rootFolderId,
      controlIngresosId,
      facturadorYear,
      movimientosCount: movimientosSpreadsheets.size,
      correlationId,
    });

    // Step 1: Resolve subdiarioId
    const resolveResult = await resolveSubdiarioId(rootFolderId);
    if (!resolveResult.ok) return resolveResult;

    const { id: subdiarioId, isNew } = resolveResult.value;

    // Step 2: Initialize sheet on first creation
    if (isNew) {
      const initResult = await initializeComprobantesSheet(subdiarioId);
      if (!initResult.ok) return initResult;
    }

    // Step 3: Read source data
    const [facturasResult, pagosResult, retencionesResult] = await Promise.all([
      getValues(controlIngresosId, 'Facturas Emitidas!A:T'),
      getValues(controlIngresosId, 'Pagos Recibidos!A:Q'),
      getValues(controlIngresosId, 'Retenciones Recibidas!A:O'),
    ]);

    if (!facturasResult.ok) {
      warn('Failed to read Facturas Emitidas', {
        module: 'subdiario-writer',
        phase: 'read-data',
        error: facturasResult.error.message,
        correlationId,
      });
      return facturasResult;
    }
    if (!pagosResult.ok) {
      warn('Failed to read Pagos Recibidos', {
        module: 'subdiario-writer',
        phase: 'read-data',
        error: pagosResult.error.message,
        correlationId,
      });
      return pagosResult;
    }
    if (!retencionesResult.ok) {
      warn('Failed to read Retenciones Recibidas', {
        module: 'subdiario-writer',
        phase: 'read-data',
        error: retencionesResult.error.message,
        correlationId,
      });
      return retencionesResult;
    }

    const facturadorResult = await readFacturador(facturadorYear);
    if (!facturadorResult.ok) {
      warn('Failed to read Facturador de Socios', {
        module: 'subdiario-writer',
        phase: 'read-data',
        error: facturadorResult.error.message,
        correlationId,
      });
      return facturadorResult;
    }

    const movimientosRows = await readMovimientosRows(movimientosSpreadsheets);

    const input: SubdiarioInput = {
      facturasEmitidas: facturasResult.value,
      pagosRecibidos: pagosResult.value,
      retencionesRecibidas: retencionesResult.value,
      facturador: facturadorResult.value,
      movimientos: movimientosRows,
    };

    // Step 4: Build rows (pure — throws on error)
    let rows: SubdiarioRow[];
    try {
      rows = buildSubdiarioRows(input);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logError('buildSubdiarioRows threw an error', {
        module: 'subdiario-writer',
        phase: 'build-rows',
        error: error.message,
        correlationId,
      });
      return { ok: false, error };
    }

    info('Builder produced rows', {
      module: 'subdiario-writer',
      phase: 'build-rows',
      rowCount: rows.length,
      correlationId,
    });

    // Step 5: Clear existing data rows (subsequent runs only)
    if (!isNew) {
      const clearResult = await clearSheetData(subdiarioId, COMPROBANTES_SHEET);
      if (!clearResult.ok) return clearResult;
    }

    // Step 6: Write rows
    const rowsWritten = rows.length;
    const gapsDetected = rows.filter((r) => r.gap === true).length;

    if (rowsWritten > 0) {
      // Convert SubdiarioRow[] to CellValueOrLink[][]
      const cellRows: CellValueOrLink[][] = rows.map((row) => [
        { type: 'date' as const, value: row.fecha },
        row.cod,
        row.tipo,
        row.nro,
        row.cliente,
        row.cuit,
        row.condicion,
        { type: 'number' as const, value: row.total },
        row.concepto,
        row.categoria,
        row.fechaCobro !== null ? { type: 'date' as const, value: row.fechaCobro } : '',
        { type: 'number' as const, value: row.recibido },
        row.notas,
      ]);

      const tzResult = await getSpreadsheetTimezone(subdiarioId);
      if (!tzResult.ok) {
        warn('Failed to get spreadsheet timezone — timestamps may be in UTC', {
          module: 'subdiario-writer',
          phase: 'write-rows',
          error: tzResult.error.message,
          correlationId,
        });
      }
      const timeZone = tzResult.ok ? tzResult.value : undefined;

      const writeResult = await appendRowsWithLinks(
        subdiarioId,
        `${COMPROBANTES_SHEET}`,
        cellRows,
        timeZone
      );
      if (!writeResult.ok) return writeResult;
    }

    info('Subdiario de Ventas sync complete', {
      module: 'subdiario-writer',
      phase: 'sync',
      rowsWritten,
      gapsDetected,
      correlationId,
    });

    return { ok: true, value: { rowsWritten, gapsDetected } };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logError('Subdiario sync failed unexpectedly', {
      module: 'subdiario-writer',
      phase: 'sync',
      error: error.message,
      correlationId,
    });
    return { ok: false, error };
  }
}
