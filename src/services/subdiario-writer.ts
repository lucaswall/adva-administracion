/**
 * Subdiario de Ventas writer service
 * Orchestrates reading source data and writing to the Subdiario de Ventas workbook.
 *
 * Cross-worker dependencies (resolved at merge time by team lead):
 *  - buildSubdiarioRows from ./subdiario-builder.js  (worker-3)
 *  - readFacturador       from ./facturador-reader.js (worker-2)
 */

import type {
  Result,
  SubdiarioRow,
  SubdiarioInput,
  BankMovimiento,
} from '../types/index.js';
import {
  getValues,
  setValues,
  appendRowsWithLinks,
  clearSheetData,
  getSpreadsheetTimezone,
  getSheetMetadata,
  renameSheet,
  formatSheet,
  type CellValue,
  type CellValueOrLink,
} from './sheets.js';
import { findByName, createSpreadsheet } from './drive.js';
import { getCachedFolderStructure } from './folder-structure.js';
import { SUBDIARIO_COMPROBANTES_HEADERS } from '../constants/spreadsheet-headers.js';
import { info, warn, error as logError } from '../utils/logger.js';
import { getCorrelationId } from '../utils/correlation.js';
import { normalizeSpreadsheetDate } from '../utils/date.js';
import { parseNumber } from '../utils/numbers.js';
import {
  parseFacturasEmitidas,
  parsePagos,
  parseRetenciones,
} from '../bank/match-movimientos.js';
import { buildSubdiarioRows } from './subdiario-builder.js';
import { readFacturador } from './facturador-reader.js';

/** MIME type for Google Sheets spreadsheets */
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Name of the Subdiario workbook in Drive */
const SUBDIARIO_NAME = 'Subdiario de Ventas';

/** Name of the Comprobantes sheet inside the Subdiario workbook */
const COMPROBANTES_SHEET = 'Comprobantes';

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
 * Reads all movimiento rows from the provided movimientos spreadsheets
 * and parses them into typed `BankMovimiento` objects.
 *
 * Movimientos sheet schema (9 cols A:I):
 *   A fecha | B descripcion | C credito | D debito | E saldo
 *   F saldoCalculado | G matchedFileId | H matchedType | I detalle
 */
async function readMovimientosRows(
  movimientosSpreadsheets: Map<string, string>
): Promise<BankMovimiento[]> {
  if (movimientosSpreadsheets.size === 0) return [];

  const allMovs: BankMovimiento[] = [];

  for (const [key, spreadsheetId] of movimientosSpreadsheets) {
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

      const dataRows = rowsResult.value.slice(1);
      for (const row of dataRows) {
        if (!row || row.length === 0) continue;
        const fecha = normalizeSpreadsheetDate(row[0]);
        if (!fecha) continue;
        const matchedTypeRaw = String(row[7] ?? '');
        const matchedType: BankMovimiento['matchedType'] =
          matchedTypeRaw === 'AUTO' || matchedTypeRaw === 'MANUAL' ? matchedTypeRaw : '';
        allMovs.push({
          fecha,
          credito: parseNumber(row[2]) || null,
          debito: parseNumber(row[3]) || null,
          matchedFileId: String(row[6] ?? ''),
          matchedType,
          concepto: String(row[1] ?? ''),
        });
      }
    }
  }

  return allMovs;
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

    const movimientos = await readMovimientosRows(movimientosSpreadsheets);

    const input: SubdiarioInput = {
      currentYear: facturadorYear,
      facturasEmitidas: parseFacturasEmitidas(facturasResult.value as CellValue[][]),
      pagosRecibidos: parsePagos(pagosResult.value as CellValue[][]),
      retencionesRecibidas: parseRetenciones(retencionesResult.value as CellValue[][]),
      facturador: facturadorResult.value,
      movimientos,
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
    // Placeholder rows for AFIP numbering gaps have cliente='FALTA <nro>'
    const gapsDetected = rows.filter((r) => r.cliente.startsWith('FALTA ')).length;

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
        // fechaCobro may be 'YYYY-MM-DD' (date cell), 'NC 00003-...' string, or ''
        /^\d{4}-\d{2}-\d{2}$/.test(row.fechaCobro)
          ? { type: 'date' as const, value: row.fechaCobro }
          : row.fechaCobro,
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
