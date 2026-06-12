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
  appendRowsWithLinks,
  formatSheet,
  renameSheet,
  columnIndexToLetter,
  type CellDate,
  type CellNumber,
  type CellValueOrLink,
} from './sheets.js';
import {
  findByName,
  createFolder,
  listByMimeType,
  listAllChildren,
  deleteFileById,
  copyFile,
  createSpreadsheet,
  renameFile,
} from './drive.js';
import { discoverMovimientosSpreadsheets, validateYear } from './folder-structure.js';
import { readMovimientosForPeriod, readCardMovimientosForPeriod } from './movimientos-reader.js';
import { debug, info, warn } from '../utils/logger.js';
import { businessDateString } from '../utils/date.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const BANCOS_FOLDER_NAME = 'Bancos';
const CONTROL_RESUMENES_SPREADSHEET_NAME = 'Control de Resumenes';
/** Card-folder type tokens (matches the set accepted by the resumen-tarjeta classifier). */
const CARD_TYPES = new Set(['Visa', 'Mastercard', 'Amex', 'Naranja', 'Cabal']);

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
 * A single movimientos tab entry within the delivery scope.
 *
 * `kind: 'bank'` items carry `moneda` (ARS|USD); `kind: 'card'` items carry
 * `tipoTarjeta` (Visa|Mastercard|Amex|Naranja|Cabal). The two have different
 * source-row schemas and produce differently named output spreadsheets.
 */
export type MovimientoScopeItem =
  | {
      kind: 'bank';
      spreadsheetId: string;
      /** Month tab name in YYYY-MM format */
      sheetName: string;
      banco: string;
      numeroCuenta: string;
      moneda: string;
    }
  | {
      kind: 'card';
      spreadsheetId: string;
      /** Month tab name in YYYY-MM format */
      sheetName: string;
      banco: string;
      tipoTarjeta: string;
      numeroCuenta: string;
    };

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalizes a `periodo` cell value to canonical YYYY-MM string regardless of
 * the underlying cell type.
 *
 * Why: `getValues()` reads with `valueRenderOption: UNFORMATTED_VALUE` +
 * `dateTimeRenderOption: SERIAL_NUMBER`. If a user typed "2026-02" into the
 * periodo column and Sheets auto-formatted it as a date, the underlying value
 * is a serial number (e.g. 46054 for Feb 2026), not the string "2026-02".
 * `String(46054)` would not lexicographically compare correctly against
 * YYYY-MM range bounds and the row would be silently dropped from delivery.
 *
 * Returns '' for null/undefined/unrecognized shapes — caller treats empty as
 * "skip this row".
 */
function normalizePeriodo(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}$/.test(value) ? value : '';
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Sheets serial date: days since 1899-12-30 (UTC). Reject non-positive
    // serials — they normalize to dates near 1899 that produce valid-looking
    // YYYY-MM strings but are unambiguously not real periodo values.
    const ms = (value - 25569) * 86_400_000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getUTCFullYear();
    if (year < 2000 || year > 2100) return '';
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
  return '';
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
  return columnIndexToLetter(widest);
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
        const periodo = normalizePeriodo(row[periodoIdx]);
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

    // Parse the folder name into a typed scope-item factory.
    // Bank accounts:  `{Bank} {Account} ARS|USD`        → kind='bank'
    // Credit cards:   `{Bank} (Visa|Mastercard|...) {Digits}` → kind='card'
    // Brokers and other folder shapes are ignored — broker movimientos use a
    // different schema and the user has not requested them in the export.
    const tokens = folderName.split(' ');
    const lastToken = tokens[tokens.length - 1];
    let scopeFactory: ((sheetName: string) => MovimientoScopeItem) | null = null;

    if (tokens.length >= 3 && (lastToken === 'ARS' || lastToken === 'USD')) {
      const moneda = lastToken;
      const numeroCuenta = tokens[tokens.length - 2];
      const banco = tokens.slice(0, tokens.length - 2).join(' ');
      scopeFactory = (sheetName) => ({
        kind: 'bank',
        spreadsheetId,
        sheetName,
        banco,
        numeroCuenta,
        moneda,
      });
    } else if (
      tokens.length >= 3 &&
      CARD_TYPES.has(tokens[tokens.length - 2]) &&
      /^\d+$/.test(lastToken)
    ) {
      const numeroCuenta = lastToken;
      const tipoTarjeta = tokens[tokens.length - 2];
      const banco = tokens.slice(0, tokens.length - 2).join(' ');
      scopeFactory = (sheetName) => ({
        kind: 'card',
        spreadsheetId,
        sheetName,
        banco,
        tipoTarjeta,
        numeroCuenta,
      });
    } else {
      continue;
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

      items.push(scopeFactory(sheet.title));
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
  const dateStr = businessDateString(deliveryDate); // Argentina business timezone (ADV-353)
  if (from === to) {
    return `${from} (entregado ${dateStr})`;
  }
  return `${from} al ${to} (entregado ${dateStr})`;
}

/**
 * Extracts the period-prefix portion of a delivery folder name (everything
 * before the " (entregado YYYY-MM-DD)" suffix), preserving the trailing space
 * to make prefix matching unambiguous (so `"2025-01 "` does not match `"2025-10 …"`).
 */
function extractPeriodPrefix(folderName: string): string {
  const idx = folderName.indexOf(' (entregado ');
  if (idx < 0) return folderName;
  return folderName.substring(0, idx) + ' ';
}

/**
 * Finds or creates the delivery folder inside `Entregas/` within the root.
 *
 * Re-delivery is idempotent across days: any existing folder under `Entregas/`
 * whose name starts with the period prefix (e.g. `"2025-01 "`) is reused —
 * its contents (PDFs and the Movimientos spreadsheet) are deleted, and the
 * folder is renamed to reflect the new delivery date.
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
    FOLDER_MIME
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

  // Step 2: Look for any existing delivery folder for the same period
  // (matches by the "YYYY-MM " or "YYYY-MM al YYYY-MM " prefix, ignoring the
  // delivery-date suffix so re-deliveries on different days reuse the folder).
  const prefix = extractPeriodPrefix(folderName);
  const existingFoldersResult = await listByMimeType(entregasFolderId, FOLDER_MIME);
  if (!existingFoldersResult.ok) return existingFoldersResult;

  const existing = existingFoldersResult.value.find(
    f => f.name === folderName || extractPeriodPrefix(f.name) === prefix
  );

  if (existing) {
    // Folder exists — clear ALL contents. The delivery folder is documented as
    // "operation-owned": re-delivery is an overwrite, so any leftover files
    // (PDFs, the prior Movimientos workbook, plus anything else a user may have
    // dropped in — images, docs, zips) must go.
    const folderId = existing.id;

    const childrenResult = await listAllChildren(folderId);
    if (!childrenResult.ok) return childrenResult;
    const filesToDelete = childrenResult.value;

    for (const file of filesToDelete) {
      const deleteResult = await deleteFileById(file.id);
      if (!deleteResult.ok) return deleteResult;
    }

    // Rename to reflect the latest delivery date if it changed
    if (existing.name !== folderName) {
      const renameResult = await renameFile(folderId, folderName);
      if (!renameResult.ok) return renameResult;
    }

    info('Delivery folder cleared for re-delivery', {
      module: 'delivery',
      phase: 'prepare-folder',
      folderId,
      previousName: existing.name,
      folderName,
      filesDeleted: filesToDelete.length,
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

// ── Task 7: buildMovimientosFiles (one spreadsheet per scope item) ────────────

/** Bank-account movimientos output schema */
const BANK_OUTPUT_HEADERS = ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'detalle'];
/** Credit-card movimientos output schema */
const CARD_OUTPUT_HEADERS = ['fecha', 'descripcion', 'nroCupon', 'pesos', 'dolares', 'detalle'];

/** Number formats for the bank movimientos output columns */
const BANK_NUMBER_FORMATS = new Map([
  [0, { type: 'date' as const }],
  [2, { type: 'currency' as const, decimals: 2 as const }],
  [3, { type: 'currency' as const, decimals: 2 as const }],
  [4, { type: 'currency' as const, decimals: 2 as const }],
]);

/** Number formats for the card movimientos output columns */
const CARD_NUMBER_FORMATS = new Map([
  [0, { type: 'date' as const }],
  [3, { type: 'currency' as const, decimals: 2 as const }],
  [4, { type: 'currency' as const, decimals: 2 as const }],
]);

/**
 * Replaces characters Google Drive / Sheets reject in file or tab titles. Real
 * bank account numbers can contain "/" (e.g. `BBVA 007-009364/1 ARS`) — without
 * sanitisation, createSpreadsheet/createSheet silently fails and the file is
 * dropped.
 */
function sanitizeFileTitle(title: string): string {
  return title.replace(/[\\/?*[\]:]/g, '-');
}

/** Builds the output filename for a single scope item. */
function buildFileName(item: MovimientoScopeItem): string {
  if (item.kind === 'bank') {
    return sanitizeFileTitle(`${item.banco} ${item.numeroCuenta} ${item.moneda} ${item.sheetName}`);
  }
  return sanitizeFileTitle(`${item.banco} ${item.tipoTarjeta} ${item.numeroCuenta} ${item.sheetName}`);
}

/**
 * Reads source movimientos for a scope item and projects them into output
 * rows. Returns Result.err only on read failure — caller treats that as a
 * skipped item, not a fatal error.
 */
async function buildScopeItemRows(
  item: MovimientoScopeItem
): Promise<Result<CellValueOrLink[][], Error>> {
  if (item.kind === 'bank') {
    const rowsResult = await readMovimientosForPeriod(item.spreadsheetId, item.sheetName);
    if (!rowsResult.ok) return rowsResult;
    const out: CellValueOrLink[][] = [BANK_OUTPUT_HEADERS];
    for (const mov of rowsResult.value) {
      out.push([
        { type: 'date', value: mov.fecha } as CellDate,
        mov.concepto,
        { type: 'number', value: mov.debito } as CellNumber,
        { type: 'number', value: mov.credito } as CellNumber,
        { type: 'number', value: mov.saldo } as CellNumber,
        mov.detalle,
      ]);
    }
    return { ok: true, value: out };
  }

  // Card branch
  const rowsResult = await readCardMovimientosForPeriod(item.spreadsheetId, item.sheetName);
  if (!rowsResult.ok) return rowsResult;
  const out: CellValueOrLink[][] = [CARD_OUTPUT_HEADERS];
  for (const mov of rowsResult.value) {
    out.push([
      { type: 'date', value: mov.fecha } as CellDate,
      mov.descripcion,
      mov.nroCupon,
      { type: 'number', value: mov.pesos } as CellNumber,
      { type: 'number', value: mov.dolares } as CellNumber,
      mov.detalle,
    ]);
  }
  return { ok: true, value: out };
}

/**
 * Creates one Google Sheets file per `MovimientoScopeItem` directly inside the
 * delivery folder. Each file is named:
 *   - bank:  `{banco} {numeroCuenta} {moneda} {YYYY-MM}` (e.g. `BBVA 007-009364-1 ARS 2026-01`)
 *   - card:  `{banco} {tipoTarjeta} {numeroCuenta} {YYYY-MM}` (e.g. `BBVA Visa 0941198918 2026-01`)
 *
 * Why one file per (account × month) instead of a single workbook with N
 * tabs: accountants asked for files they can grab and forward individually.
 *
 * Per-item failures (source read or Sheets API errors) are accumulated into
 * `failed`; the run never aborts mid-scope. The caller's response surfaces
 * the count.
 *
 * @param folderId - Delivery folder ID to create the files in
 * @param scope - List of bank+card scope items
 * @returns {created, failed} where `created` is the number of files written
 */
export async function buildMovimientosFiles(
  folderId: string,
  scope: MovimientoScopeItem[]
): Promise<
  Result<
    { created: number; failed: Array<{ name: string; error: string }> },
    Error
  >
> {
  const failed: Array<{ name: string; error: string }> = [];
  let created = 0;

  // Idempotent retry: a previous run (or an Apps Script timeout-and-retry)
  // may have left stale spreadsheet files inside this delivery folder.
  // Delete them all before creating the fresh set — without this, retried
  // builds accumulate duplicates. PDFs (already copied by /copy-pdfs) are
  // untouched because we filter by spreadsheet MIME.
  const existingSheetsResult = await listByMimeType(folderId, SPREADSHEET_MIME);
  if (!existingSheetsResult.ok) return existingSheetsResult;
  for (const existing of existingSheetsResult.value) {
    const deleteResult = await deleteFileById(existing.id);
    if (!deleteResult.ok) return deleteResult;
  }

  // Sort by output filename so the resulting folder lists predictably
  // (account-major, then month within account).
  const sortedScope = [...scope].sort((a, b) =>
    buildFileName(a).localeCompare(buildFileName(b))
  );

  for (const item of sortedScope) {
    const fileName = buildFileName(item);

    const rowsResult = await buildScopeItemRows(item);
    if (!rowsResult.ok) {
      warn('Failed to read movimientos for delivery file — skipping', {
        module: 'delivery',
        phase: 'build-movimientos',
        fileName,
        spreadsheetId: item.spreadsheetId,
        sheetName: item.sheetName,
        error: rowsResult.error.message,
      });
      failed.push({ name: fileName, error: rowsResult.error.message });
      continue;
    }
    const rows = rowsResult.value;

    // Skip empty months entirely (only header, no data rows). The accountant
    // doesn't need stub files for accounts without activity.
    if (rows.length <= 1) {
      debug('Skipping empty movimientos period', {
        module: 'delivery',
        phase: 'build-movimientos',
        fileName,
      });
      continue;
    }

    const createResult = await createSpreadsheet(folderId, fileName);
    if (!createResult.ok) {
      warn('Failed to create movimientos spreadsheet', {
        module: 'delivery',
        phase: 'build-movimientos',
        fileName,
        error: createResult.error.message,
      });
      failed.push({ name: fileName, error: createResult.error.message });
      continue;
    }
    const spreadsheetId = createResult.value.id;

    // Discover the default sheet ID for formatting + rename.
    const metaResult = await getSheetMetadata(spreadsheetId);
    if (!metaResult.ok) {
      warn('Failed to read newly-created spreadsheet metadata', {
        module: 'delivery',
        phase: 'build-movimientos',
        fileName,
        spreadsheetId,
        error: metaResult.error.message,
      });
      failed.push({ name: fileName, error: metaResult.error.message });
      continue;
    }
    const defaultSheet = metaResult.value[0];

    // Rename Sheet1 → "Movimientos" so the tab name is meaningful. This is
    // load-bearing: the subsequent append uses 'Movimientos!A:F' as its
    // range, so a rename failure guarantees the append fails too. Treat the
    // rename failure as fatal for this item rather than continuing into a
    // misleading second error.
    const renameResult = await renameSheet(spreadsheetId, defaultSheet.sheetId, 'Movimientos');
    if (!renameResult.ok) {
      warn('Failed to rename default sheet — skipping item', {
        module: 'delivery',
        phase: 'build-movimientos',
        fileName,
        error: renameResult.error.message,
      });
      failed.push({ name: fileName, error: renameResult.error.message });
      continue;
    }

    const appendResult = await appendRowsWithLinks(spreadsheetId, 'Movimientos!A:F', rows);
    if (!appendResult.ok) {
      warn('Failed to write movimientos rows — file is empty', {
        module: 'delivery',
        phase: 'build-movimientos',
        fileName,
        error: appendResult.error.message,
      });
      failed.push({ name: fileName, error: appendResult.error.message });
      continue;
    }

    const numberFormats = item.kind === 'bank' ? BANK_NUMBER_FORMATS : CARD_NUMBER_FORMATS;
    const formatResult = await formatSheet(spreadsheetId, defaultSheet.sheetId, {
      numberFormats,
      frozenRows: 1,
    });
    if (!formatResult.ok) {
      warn('Failed to format movimientos sheet', {
        module: 'delivery',
        phase: 'build-movimientos',
        fileName,
        error: formatResult.error.message,
      });
      // Non-fatal — file exists with data, just unformatted.
    }

    created++;
    debug('Movimientos file created', {
      module: 'delivery',
      phase: 'build-movimientos',
      fileName,
      spreadsheetId,
    });
  }

  info('Movimientos files built', {
    module: 'delivery',
    phase: 'build-movimientos',
    folderId,
    created,
    failed: failed.length,
  });

  return { ok: true, value: { created, failed } };
}
