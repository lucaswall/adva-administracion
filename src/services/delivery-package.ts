/**
 * Delivery package service
 * Gathers resumen PDFs and movimientos workbook into a flat Entregas/ Drive folder
 * for a chosen period range (Envío a Contadores feature).
 */

import type { Result } from '../types/index.js';
import {
  CONTROL_RESUMENES_BANCARIO_SHEET,
  CONTROL_RESUMENES_TARJETA_SHEET,
  CONTROL_RESUMENES_BROKER_SHEET,
} from '../constants/spreadsheet-headers.js';
import {
  getValues,
  getSheetMetadata,
  createSheet,
  appendRowsWithLinks,
  formatSheet,
  deleteSheet,
  renameSheet,
  type CellDate,
  type CellNumber,
  type CellValueOrLink,
} from './sheets.js';
import {
  findByName,
  createFolder,
  listByMimeType,
  listFilesInFolder,
  deleteFileById,
  copyFile,
  createSpreadsheet,
} from './drive.js';
import { discoverMovimientosSpreadsheets, validateYear } from './folder-structure.js';
import { readMovimientosForPeriod } from './movimientos-reader.js';
import { debug, info, warn } from '../utils/logger.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const BANCOS_FOLDER_NAME = 'Bancos';
const CONTROL_RESUMENES_SPREADSHEET_NAME = 'Control de Resumenes';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A single resumen PDF entry within the delivery scope
 */
export interface ResumenScopeItem {
  fileId: string;
  fileName: string;
  type: 'bancario' | 'tarjeta' | 'broker';
  periodo: string;
}

/**
 * A single movimientos tab entry within the delivery scope
 */
export interface MovimientoScopeItem {
  spreadsheetId: string;
  /** Month tab name in YYYY-MM format */
  sheetName: string;
  banco: string;
  numeroCuenta: string;
  moneda: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a 1-based column count to an A1 column letter (supports A–Z). */
function colLetter(count: number): string {
  return String.fromCharCode(64 + count);
}

/** Builds an inclusive list of YYYY-MM strings from `from` to `to`. */
function buildMonthList(from: string, to: string): string[] {
  const months: string[] = [];
  let current = from;
  while (current <= to) {
    months.push(current);
    const [yearStr, monthStr] = current.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (month === 12) {
      current = `${year + 1}-01`;
    } else {
      current = `${year}-${String(month + 1).padStart(2, '0')}`;
    }
  }
  return months;
}

// ── Task 1: parsePeriodRange ─────────────────────────────────────────────────

/**
 * Parses a period range string into from/to YYYY-MM boundaries.
 *
 * Accepts:
 * - `YYYY-MM` — single month (from === to)
 * - `YYYY-MM..YYYY-MM` — inclusive range
 *
 * Returns a Spanish-language error for any validation failure.
 *
 * @param input - Period string to parse
 * @returns Result with {from, to} or error
 */
export function parsePeriodRange(input: string): Result<{ from: string; to: string }, Error> {
  if (!input || typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: new Error('El período no puede estar vacío') };
  }

  // Strict: no leading/trailing/internal whitespace tolerated inside the token
  const match = input.match(/^(\d{4})-(\d{2})(\.\.(\d{4})-(\d{2}))?$/);
  if (!match) {
    return {
      ok: false,
      error: new Error(
        `Formato de período inválido: "${input}". Use YYYY-MM o YYYY-MM..YYYY-MM`
      ),
    };
  }

  const [, fromYear, fromMonth, , toYear, toMonth] = match;
  const fromYearNum = parseInt(fromYear, 10);
  const fromMonthNum = parseInt(fromMonth, 10);

  if (fromYearNum < 2000 || fromYearNum > 2100) {
    return {
      ok: false,
      error: new Error(`Año inválido: ${fromYear}. Debe estar entre 2000 y 2100`),
    };
  }

  if (fromMonthNum < 1 || fromMonthNum > 12) {
    return {
      ok: false,
      error: new Error(`Mes inválido: ${fromMonth}. Debe estar entre 01 y 12`),
    };
  }

  const from = `${fromYear}-${fromMonth}`;

  if (!toYear) {
    return { ok: true, value: { from, to: from } };
  }

  const toYearNum = parseInt(toYear, 10);
  const toMonthNum = parseInt(toMonth, 10);

  if (toYearNum < 2000 || toYearNum > 2100) {
    return {
      ok: false,
      error: new Error(`Año inválido: ${toYear}. Debe estar entre 2000 y 2100`),
    };
  }

  if (toMonthNum < 1 || toMonthNum > 12) {
    return {
      ok: false,
      error: new Error(`Mes inválido: ${toMonth}. Debe estar entre 01 y 12`),
    };
  }

  const to = `${toYear}-${toMonth}`;

  if (to < from) {
    return {
      ok: false,
      error: new Error(
        `Rango inválido: el período final "${to}" no puede ser anterior al inicial "${from}"`
      ),
    };
  }

  return { ok: true, value: { from, to } };
}

// ── Task 2: enumerateResumenes ───────────────────────────────────────────────

/**
 * Classifies a Resumenes sheet by inspecting its headers.
 *
 * Each per-account `Control de Resumenes` spreadsheet has a single `Resumenes`
 * tab whose schema depends on the account type:
 * - `moneda` header → bancario
 * - `tipoTarjeta` header → tarjeta
 * - `broker` header → broker
 */
function classifyResumenSheet(headerRow: string[]): 'bancario' | 'tarjeta' | 'broker' | null {
  const lowered = headerRow.map(h => h.toLowerCase());
  if (lowered.includes('moneda')) return 'bancario';
  if (lowered.includes('tipotarjeta')) return 'tarjeta';
  if (lowered.includes('broker')) return 'broker';
  return null;
}

/**
 * Computes the broadest A1 column range needed to read any Resumenes schema.
 * Returns the column letter for the widest of the three schemas.
 */
function widestResumenesColumn(): string {
  const widest = Math.max(
    CONTROL_RESUMENES_BANCARIO_SHEET.headers.length,
    CONTROL_RESUMENES_TARJETA_SHEET.headers.length,
    CONTROL_RESUMENES_BROKER_SHEET.headers.length
  );
  return colLetter(widest);
}

/**
 * Enumerates all resumen PDFs (bancario, tarjeta, broker) within a period range
 * by walking each per-account `Control de Resumenes` spreadsheet under
 * `{YYYY}/Bancos/{Account folder}/`. The spreadsheet schema is detected from
 * its headers (each account type has a distinct schema).
 *
 * Per-account read failures are logged as warnings and skipped — only a top-level
 * directory-listing failure aborts the whole operation. This mirrors
 * `enumerateMovimientos`.
 *
 * @param from - Start period YYYY-MM (inclusive)
 * @param to - End period YYYY-MM (inclusive)
 * @param rootFolderId - Drive root folder ID
 * @returns List of scope items or error
 */
export async function enumerateResumenes(
  from: string,
  to: string,
  rootFolderId: string
): Promise<Result<ResumenScopeItem[], Error>> {
  const items: ResumenScopeItem[] = [];
  const rangeColumn = widestResumenesColumn();
  const range = `${CONTROL_RESUMENES_BANCARIO_SHEET.title}!A:${rangeColumn}`;

  const yearFoldersResult = await listByMimeType(rootFolderId, FOLDER_MIME);
  if (!yearFoldersResult.ok) return yearFoldersResult;

  for (const yearFolder of yearFoldersResult.value) {
    if (!validateYear(yearFolder.name).ok) continue;

    const bancosResult = await findByName(yearFolder.id, BANCOS_FOLDER_NAME, FOLDER_MIME);
    if (!bancosResult.ok) {
      warn('Failed to locate Bancos folder for year — skipping', {
        module: 'delivery',
        phase: 'enumerate-resumenes',
        year: yearFolder.name,
        error: bancosResult.error.message,
      });
      continue;
    }
    if (!bancosResult.value) continue;

    const accountFoldersResult = await listByMimeType(bancosResult.value.id, FOLDER_MIME);
    if (!accountFoldersResult.ok) {
      warn('Failed to list account folders — skipping year', {
        module: 'delivery',
        phase: 'enumerate-resumenes',
        year: yearFolder.name,
        error: accountFoldersResult.error.message,
      });
      continue;
    }

    for (const accountFolder of accountFoldersResult.value) {
      const sheetFileResult = await findByName(
        accountFolder.id,
        CONTROL_RESUMENES_SPREADSHEET_NAME,
        SPREADSHEET_MIME
      );
      if (!sheetFileResult.ok) {
        warn('Failed to locate Control de Resumenes spreadsheet — skipping account', {
          module: 'delivery',
          phase: 'enumerate-resumenes',
          year: yearFolder.name,
          account: accountFolder.name,
          error: sheetFileResult.error.message,
        });
        continue;
      }
      if (!sheetFileResult.value) continue;

      const valuesResult = await getValues(sheetFileResult.value.id, range);
      if (!valuesResult.ok) {
        warn('Failed to read Resumenes tab — skipping account', {
          module: 'delivery',
          phase: 'enumerate-resumenes',
          year: yearFolder.name,
          account: accountFolder.name,
          spreadsheetId: sheetFileResult.value.id,
          error: valuesResult.error.message,
        });
        continue;
      }

      const rows = valuesResult.value;
      if (rows.length < 2) continue;

      const headerRow = rows[0].map(h => String(h ?? '').toLowerCase());
      const type = classifyResumenSheet(headerRow);
      if (type === null) {
        warn('Unrecognized Resumenes schema — skipping account', {
          module: 'delivery',
          phase: 'enumerate-resumenes',
          year: yearFolder.name,
          account: accountFolder.name,
        });
        continue;
      }

      const periodoIdx = headerRow.indexOf('periodo');
      const fileIdIdx = headerRow.indexOf('fileid');
      const fileNameIdx = headerRow.indexOf('filename');
      if (periodoIdx < 0 || fileIdIdx < 0 || fileNameIdx < 0) continue;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const periodo = String(row[periodoIdx] ?? '');
        if (!periodo || periodo < from || periodo > to) continue;

        const fileId = String(row[fileIdIdx] ?? '');
        if (!fileId) continue;

        items.push({
          fileId,
          fileName: String(row[fileNameIdx] ?? ''),
          type,
          periodo,
        });
      }
    }
  }

  debug('Enumerated resumenes for period range', {
    module: 'delivery',
    phase: 'enumerate-resumenes',
    from,
    to,
    count: items.length,
  });

  return { ok: true, value: items };
}

// ── Task 3: enumerateMovimientos ─────────────────────────────────────────────

/**
 * Enumerates all movimientos tabs within a period range across all bank accounts.
 *
 * Only enumerates scope — actual row reading happens in buildMovimientosWorkbook.
 * Fails per-account (warns + skips), never propagates individual account errors.
 *
 * @param from - Start period YYYY-MM (inclusive)
 * @param to - End period YYYY-MM (inclusive)
 * @param rootFolderId - Drive root folder ID for discovery
 * @returns List of scope items or error
 */
export async function enumerateMovimientos(
  from: string,
  to: string,
  rootFolderId: string
): Promise<Result<MovimientoScopeItem[], Error>> {
  const discoverResult = await discoverMovimientosSpreadsheets(rootFolderId);
  if (!discoverResult.ok) return discoverResult;

  const spreadsheets = discoverResult.value;
  const months = buildMonthList(from, to);
  const items: MovimientoScopeItem[] = [];
  const YYYY_MM = /^\d{4}-\d{2}$/;

  for (const [key, spreadsheetId] of spreadsheets.entries()) {
    // key format: "{year}:{folderName}"
    const colonIdx = key.indexOf(':');
    const folderName = key.substring(colonIdx + 1);

    // Parse banco / numeroCuenta / moneda from folder name tokens
    const tokens = folderName.split(' ');
    let banco: string;
    let numeroCuenta: string;
    let moneda: string;

    const lastToken = tokens[tokens.length - 1];
    if (tokens.length >= 3 && (lastToken === 'ARS' || lastToken === 'USD')) {
      moneda = lastToken;
      numeroCuenta = tokens[tokens.length - 2];
      banco = tokens.slice(0, tokens.length - 2).join(' ');
    } else {
      // No currency suffix (credit cards, brokers)
      moneda = '';
      numeroCuenta = lastToken;
      banco = tokens.slice(0, tokens.length - 1).join(' ');
    }

    // Get sheet metadata for this spreadsheet
    const metaResult = await getSheetMetadata(spreadsheetId);
    if (!metaResult.ok) {
      warn('Failed to get sheet metadata for movimientos spreadsheet', {
        module: 'delivery',
        phase: 'enumerate-movimientos',
        spreadsheetId,
        error: metaResult.error.message,
      });
      continue;
    }

    // Intersect available YYYY-MM tabs with the requested month list
    for (const sheet of metaResult.value) {
      if (!YYYY_MM.test(sheet.title)) continue;
      if (!months.includes(sheet.title)) continue;

      items.push({
        spreadsheetId,
        sheetName: sheet.title,
        banco,
        numeroCuenta,
        moneda,
      });
    }
  }

  debug('Enumerated movimientos scope', {
    module: 'delivery',
    phase: 'enumerate-movimientos',
    from,
    to,
    items: items.length,
  });

  return { ok: true, value: items };
}

// ── Task 5: formatDeliveryFolderName + prepareDeliveryFolder ─────────────────

/**
 * Formats the delivery folder name from period boundaries and delivery date.
 *
 * - Single month: `"YYYY-MM (entregado YYYY-MM-DD)"`
 * - Range:        `"YYYY-MM al YYYY-MM (entregado YYYY-MM-DD)"`
 *
 * @param opts - {from, to, deliveryDate}
 * @returns Folder name string
 */
export function formatDeliveryFolderName(opts: {
  from: string;
  to: string;
  deliveryDate: Date;
}): string {
  const { from, to, deliveryDate } = opts;
  const dateStr = deliveryDate.toISOString().substring(0, 10);
  if (from === to) {
    return `${from} (entregado ${dateStr})`;
  }
  return `${from} al ${to} (entregado ${dateStr})`;
}

/**
 * Finds or creates the delivery folder inside `Entregas/` within the root.
 * If the period folder already exists, deletes its contents first (idempotent re-delivery).
 *
 * @param rootFolderId - Drive root folder ID
 * @param folderName - Full formatted folder name (from formatDeliveryFolderName)
 * @param deliveryDate - Delivery date (used for logging)
 * @returns {folderId, folderUrl, isReuse} or error
 */
export async function prepareDeliveryFolder(
  rootFolderId: string,
  folderName: string,
  deliveryDate: Date
): Promise<Result<{ folderId: string; folderUrl: string; isReuse: boolean }, Error>> {
  debug('Preparing delivery folder', {
    module: 'delivery',
    phase: 'prepare-folder',
    folderName,
    deliveryDate: deliveryDate.toISOString(),
  });

  // Step 1: Find or create the Entregas/ parent folder
  const entregasResult = await findByName(
    rootFolderId,
    'Entregas',
    'application/vnd.google-apps.folder'
  );
  if (!entregasResult.ok) return entregasResult;

  let entregasFolderId: string;
  if (entregasResult.value) {
    entregasFolderId = entregasResult.value.id;
  } else {
    const createResult = await createFolder(rootFolderId, 'Entregas');
    if (!createResult.ok) return createResult;
    entregasFolderId = createResult.value.id;
  }

  // Step 2: Find or create the period folder inside Entregas/
  const periodResult = await findByName(
    entregasFolderId,
    folderName,
    'application/vnd.google-apps.folder'
  );
  if (!periodResult.ok) return periodResult;

  if (periodResult.value) {
    // Folder exists — clear its contents (re-delivery)
    const folderId = periodResult.value.id;
    const filesResult = await listFilesInFolder(folderId);
    if (!filesResult.ok) return filesResult;

    for (const file of filesResult.value) {
      const deleteResult = await deleteFileById(file.id);
      if (!deleteResult.ok) return deleteResult;
    }

    info('Delivery folder cleared for re-delivery', {
      module: 'delivery',
      phase: 'prepare-folder',
      folderId,
      filesDeleted: filesResult.value.length,
    });

    return {
      ok: true,
      value: {
        folderId,
        folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
        isReuse: true,
      },
    };
  }

  // Folder does not exist — create it
  const createResult = await createFolder(entregasFolderId, folderName);
  if (!createResult.ok) return createResult;

  const folderId = createResult.value.id;
  info('Delivery folder created', {
    module: 'delivery',
    phase: 'prepare-folder',
    folderId,
    folderName,
  });

  return {
    ok: true,
    value: {
      folderId,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
      isReuse: false,
    },
  };
}

// ── Task 6: copyPdfsToDelivery ────────────────────────────────────────────────

/**
 * Copies all resumen PDFs in scope sequentially to the delivery folder.
 *
 * Per-PDF failures are accumulated rather than thrown — the caller decides
 * whether to escalate. Overall Result is always ok (never fails).
 *
 * @param folderId - Destination delivery folder ID
 * @param scope - List of resumen items to copy
 * @returns {copied, failed} counts, always Result.ok
 */
export async function copyPdfsToDelivery(
  folderId: string,
  scope: ResumenScopeItem[]
): Promise<Result<{ copied: number; failed: Array<{ fileId: string; error: string }> }, Error>> {
  const failed: Array<{ fileId: string; error: string }> = [];
  let copied = 0;

  for (const item of scope) {
    const result = await copyFile(item.fileId, folderId);
    if (result.ok) {
      copied++;
      debug('PDF copied to delivery folder', {
        module: 'delivery',
        phase: 'copy-pdfs',
        fileId: item.fileId,
        fileName: item.fileName,
      });
    } else {
      failed.push({ fileId: item.fileId, error: result.error.message });
    }
  }

  info('PDF copy complete', {
    module: 'delivery',
    phase: 'copy-pdfs',
    copied,
    failed: failed.length,
  });

  return { ok: true, value: { copied, failed } };
}

// ── Task 7: buildMovimientosWorkbook ─────────────────────────────────────────

/** Output column headers for the movimientos workbook */
const MOVIMIENTOS_OUTPUT_HEADERS = ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'detalle'];

/** Number formats for movimientos workbook columns */
const MOVIMIENTOS_NUMBER_FORMATS = new Map([
  [0, { type: 'date' as const }],
  [2, { type: 'currency' as const, decimals: 2 as const }],
  [3, { type: 'currency' as const, decimals: 2 as const }],
  [4, { type: 'currency' as const, decimals: 2 as const }],
]);

/**
 * Creates a Google Sheets workbook in the delivery folder with one tab per
 * MovimientoScopeItem. Each tab contains six projected columns from the source:
 * fecha, concepto, debito, credito, saldo (PDF value), detalle.
 *
 * Tab names follow the pattern `YYYY-MM {banco} {numeroCuenta} [{moneda}]`
 * so they sort lexicographically by month.
 *
 * Empty scope: leaves the default Sheet1 renamed to "Sin Movimientos" with
 * only the header row. Returns tabCount: 0.
 *
 * @param folderId - Delivery folder ID to create the workbook in
 * @param scope - List of movimiento tabs to include
 * @returns {workbookId, workbookUrl, tabCount} or error
 */
export async function buildMovimientosWorkbook(
  folderId: string,
  scope: MovimientoScopeItem[]
): Promise<Result<{ workbookId: string; workbookUrl: string; tabCount: number }, Error>> {
  // Create the spreadsheet in the delivery folder
  const createResult = await createSpreadsheet(folderId, 'Movimientos');
  if (!createResult.ok) return createResult;

  const workbookId = createResult.value.id;
  const workbookUrl = `https://docs.google.com/spreadsheets/d/${workbookId}/edit`;

  // Get initial metadata to discover the default Sheet1 tab ID
  const initMetaResult = await getSheetMetadata(workbookId);
  if (!initMetaResult.ok) return initMetaResult;
  const defaultSheet = initMetaResult.value[0];

  // Empty scope: rename default tab and add placeholder headers
  if (scope.length === 0) {
    const renameResult = await renameSheet(workbookId, defaultSheet.sheetId, 'Sin Movimientos');
    if (!renameResult.ok) return renameResult;

    const appendResult = await appendRowsWithLinks(
      workbookId,
      'Sin Movimientos!A:F',
      [MOVIMIENTOS_OUTPUT_HEADERS]
    );
    if (!appendResult.ok) return appendResult;

    return { ok: true, value: { workbookId, workbookUrl, tabCount: 0 } };
  }

  // Sort scope lexicographically by sheetName (month-major)
  const sortedScope = [...scope].sort((a, b) => a.sheetName.localeCompare(b.sheetName));

  let tabCount = 0;

  for (const item of sortedScope) {
    // Build tab name: YYYY-MM {banco} {numeroCuenta} [{moneda}]
    const tabParts = [item.sheetName, item.banco, item.numeroCuenta];
    if (item.moneda) tabParts.push(item.moneda);
    const tabName = tabParts.join(' ');

    // Create the tab
    const createTabResult = await createSheet(workbookId, tabName);
    if (!createTabResult.ok) {
      warn('Failed to create movimientos tab', {
        module: 'delivery',
        phase: 'build-movimientos',
        tabName,
        error: createTabResult.error.message,
      });
      continue;
    }
    const sheetId = createTabResult.value;

    // Read source movimientos (already filtered by readMovimientosForPeriod)
    const rowsResult = await readMovimientosForPeriod(item.spreadsheetId, item.sheetName);
    if (!rowsResult.ok) {
      warn('Failed to read movimientos for tab', {
        module: 'delivery',
        phase: 'build-movimientos',
        sheetName: item.sheetName,
        spreadsheetId: item.spreadsheetId,
        error: rowsResult.error.message,
      });
    }

    // Build rows: header + data
    const rows: CellValueOrLink[][] = [MOVIMIENTOS_OUTPUT_HEADERS];

    if (rowsResult.ok) {
      for (const mov of rowsResult.value) {
        const row: CellValueOrLink[] = [
          { type: 'date', value: mov.fecha } as CellDate,
          mov.concepto,
          { type: 'number', value: mov.debito } as CellNumber,
          { type: 'number', value: mov.credito } as CellNumber,
          { type: 'number', value: mov.saldo } as CellNumber,
          mov.detalle,
        ];
        rows.push(row);
      }
    }

    // Write rows to tab
    const appendResult = await appendRowsWithLinks(workbookId, `${tabName}!A:F`, rows);
    if (!appendResult.ok) {
      warn('Failed to write movimientos data', {
        module: 'delivery',
        phase: 'build-movimientos',
        tabName,
        error: appendResult.error.message,
      });
    }

    // Format tab: freeze header, number formats for date/currency columns
    await formatSheet(workbookId, sheetId, {
      numberFormats: MOVIMIENTOS_NUMBER_FORMATS,
      frozenRows: 1,
    });

    tabCount++;
  }

  // Delete the default Sheet1 tab (must happen after all real tabs are added)
  const deleteResult = await deleteSheet(workbookId, defaultSheet.sheetId);
  if (!deleteResult.ok) {
    warn('Failed to delete default sheet tab', {
      module: 'delivery',
      phase: 'build-movimientos',
      workbookId,
      error: deleteResult.error.message,
    });
  }

  info('Movimientos workbook built', {
    module: 'delivery',
    phase: 'build-movimientos',
    workbookId,
    tabCount,
  });

  return { ok: true, value: { workbookId, workbookUrl, tabCount } };
}
