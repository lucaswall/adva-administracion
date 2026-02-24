/**
 * Spreadsheet schema migrations
 * Runs at startup to ensure existing spreadsheets match the current schema
 */

import type { Result } from '../types/index.js';
import type { CellValue, CellValueOrLink } from './sheets.js';
import { getValues, batchUpdate, updateRowsWithFormatting, getSpreadsheetTimezone, getSheetMetadata } from './sheets.js';
import { getCachedFolderStructure } from './folder-structure.js';
import { MOVIMIENTOS_BANCARIO_SHEET } from '../constants/spreadsheet-headers.js';
import { SHEETS_BATCH_UPDATE_LIMIT } from '../config.js';
import { info, warn, debug } from '../utils/logger.js';

/**
 * Expected column layout (A:I):
 *   G (6): matchedFileId
 *   H (7): matchedType
 *   I (8): detalle
 *
 * Old layout (A:H):
 *   G (6): matchedFileId
 *   H (7): detalle
 *
 * Migration: insert matchedType at H, move detalle to I
 */

/**
 * Migrates a single Movimientos spreadsheet to the new column layout.
 * Handles two cases:
 * 1. Old 8-column sheets (A:H): detalle is at H — move it to I, add matchedType header at H
 * 2. Already 9-column sheets with correct layout: skip
 *
 * @param spreadsheetId - The Movimientos spreadsheet ID
 * @param spreadsheetName - Human-readable name for logging
 * @returns Result with number of sheets migrated
 */
export async function migrateMovimientosColumns(
  spreadsheetId: string,
  spreadsheetName: string
): Promise<Result<number, Error>> {
  const headers = MOVIMIENTOS_BANCARIO_SHEET.headers;
  // Expected: headers[7] = 'matchedType', headers[8] = 'detalle'

  // Get all sheets in this spreadsheet
  const metadataResult = await getSheetMetadata(spreadsheetId);
  if (!metadataResult.ok) return metadataResult;

  let migratedCount = 0;

  for (const sheet of metadataResult.value) {
    // Only migrate month sheets (YYYY-MM format)
    if (!/^\d{4}-\d{2}$/.test(sheet.title)) continue;

    // Read columns G:I for the entire sheet to understand current state
    const dataResult = await getValues(spreadsheetId, `'${sheet.title}'!G:I`);
    if (!dataResult.ok) {
      warn('Failed to read columns for migration', {
        module: 'migrations',
        spreadsheet: spreadsheetName,
        sheet: sheet.title,
        error: dataResult.error.message,
      });
      continue;
    }

    const rows = dataResult.value;
    if (!rows || rows.length === 0) continue;

    // Check header row to determine migration state
    const headerRow = rows[0];
    const colH = String(headerRow?.[1] ?? '');
    const colI = String(headerRow?.[2] ?? '');

    // Already in correct layout: H=matchedType, I=detalle
    if (colH === headers[7] && colI === headers[8]) {
      continue;
    }

    // Old layout: H=detalle, no column I — need to shift detalle→I and insert matchedType at H
    // Also handles: H=detalle, I=matchedType (wrong order from previous bad migration)
    const isOldLayout = colH === 'detalle';
    const isSwapped = colH === 'detalle' && colI === 'matchedType';

    if (!isOldLayout && headerRow && headerRow.length >= 2) {
      // Unknown layout — warn but attempt migration anyway
      warn('Unexpected column layout, migrating to new schema', {
        module: 'migrations',
        spreadsheet: spreadsheetName,
        sheet: sheet.title,
        colH,
        colI,
      });
    }

    // Build batch updates: for each row, set H=matchedType value, I=detalle value
    const updates: Array<{ range: string; values: CellValue[][] }> = [];

    // Header row (row 1)
    updates.push({
      range: `'${sheet.title}'!H1:I1`,
      values: [[headers[7], headers[8]]], // matchedType, detalle
    });

    // Data rows (row 2 onwards)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const rowNum = i + 1; // 1-indexed sheet row
      const currentH = row[1] ?? ''; // Currently detalle (old) or matchedType (new)
      const currentI = row[2] ?? ''; // Currently empty (old) or detalle/matchedType

      let newMatchedType: CellValue;
      let newDetalle: CellValue;

      if (isSwapped) {
        // H=detalle, I=matchedType — just swap them
        newMatchedType = currentI; // was in I
        newDetalle = currentH; // was in H
      } else {
        // Old layout: H=detalle, I=empty — move detalle to I, set H to empty
        newMatchedType = '';
        newDetalle = currentH; // detalle was in H
      }

      updates.push({
        range: `'${sheet.title}'!H${rowNum}:I${rowNum}`,
        values: [[newMatchedType, newDetalle]],
      });
    }

    const updateResult = await batchUpdate(spreadsheetId, updates);
    if (!updateResult.ok) {
      warn('Failed to migrate columns', {
        module: 'migrations',
        spreadsheet: spreadsheetName,
        sheet: sheet.title,
        error: updateResult.error.message,
      });
      continue;
    }

    migratedCount++;
    info('Migrated Movimientos sheet columns (matchedType→H, detalle→I)', {
      module: 'migrations',
      spreadsheet: spreadsheetName,
      sheet: sheet.title,
      rowsUpdated: rows.length,
    });
  }

  return { ok: true, value: migratedCount };
}

/**
 * Migrates existing Dashboard Operativo processedAt cells to use DATE_TIME format.
 *
 * Reads the Archivos Procesados sheet and re-writes all processedAt values
 * using `updateRowsWithFormatting`, which applies the DATE_TIME cell format.
 * This is a one-time fix for rows written via batchUpdate (plain strings) or
 * via appendRowsWithLinks (which writes DATE_TIME serials without proper format).
 *
 * Safe to run multiple times (idempotent — re-applies the correct format).
 *
 * @param dashboardId - Dashboard Operativo Contable spreadsheet ID
 */
export async function migrateDashboardProcessedAt(dashboardId: string): Promise<void> {
  const dataResult = await getValues(dashboardId, 'Archivos Procesados!A:F');
  if (!dataResult.ok) {
    warn('Failed to read Archivos Procesados for processedAt migration', {
      module: 'migrations',
      phase: 'startup',
      error: dataResult.error.message,
    });
    return;
  }

  const timezoneResult = await getSpreadsheetTimezone(dashboardId);
  const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

  const rows = dataResult.value;
  const EXCEL_EPOCH = new Date(Date.UTC(1899, 11, 30)).getTime();

  const updates: Array<{ range: string; values: CellValueOrLink[] }> = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const processedAtRaw = row[2];
    if (processedAtRaw === '' || processedAtRaw === null || processedAtRaw === undefined) continue;

    const rowNum = i + 1; // 1-indexed spreadsheet row

    let processedAtIso: string;

    if (typeof processedAtRaw === 'number') {
      // Serial number from appendRowsWithLinks — convert to ISO string
      processedAtIso = new Date(EXCEL_EPOCH + processedAtRaw * 86400000).toISOString();
    } else {
      const str = String(processedAtRaw);
      if (!str) continue;
      // Ensure we have an ISO string: parse and re-serialize if needed
      const parsed = new Date(str);
      processedAtIso = isNaN(parsed.getTime()) ? str : parsed.toISOString();
    }

    updates.push({
      range: `Archivos Procesados!C${rowNum}`,
      values: [processedAtIso],
    });
  }

  if (updates.length === 0) {
    debug('No processedAt values to migrate in Dashboard', {
      module: 'migrations',
      phase: 'startup',
    });
    return;
  }

  // Chunk updates to avoid Sheets API limits
  let failedRows = 0;
  for (let i = 0; i < updates.length; i += SHEETS_BATCH_UPDATE_LIMIT) {
    const chunk = updates.slice(i, i + SHEETS_BATCH_UPDATE_LIMIT);
    const updateResult = await updateRowsWithFormatting(dashboardId, chunk, timeZone);
    if (!updateResult.ok) {
      failedRows += chunk.length;
      warn('Failed to migrate processedAt chunk in Dashboard', {
        module: 'migrations',
        phase: 'startup',
        chunkStart: i,
        error: updateResult.error.message,
      });
    }
  }

  if (failedRows === 0) {
    info('Migrated Dashboard processedAt cells to DATE_TIME format', {
      module: 'migrations',
      phase: 'startup',
      rowsMigrated: updates.length,
    });
  } else {
    warn('Partial failure migrating Dashboard processedAt cells', {
      module: 'migrations',
      phase: 'startup',
      rowsMigrated: updates.length - failedRows,
      failedRows,
    });
  }
}

/**
 * Runs all startup migrations for spreadsheet schemas.
 * Called during server initialization after folder structure is discovered.
 *
 * Currently handles:
 * - Reordering columns H/I: matchedType at H, detalle at I
 * - Re-applying DATE_TIME format to processedAt cells in Dashboard
 */
export async function runStartupMigrations(): Promise<void> {
  const folderStructure = getCachedFolderStructure();
  if (!folderStructure) {
    warn('Cannot run migrations: folder structure not initialized', {
      module: 'migrations',
      phase: 'startup',
    });
    return;
  }

  const { movimientosSpreadsheets, dashboardOperativoId } = folderStructure;

  if (movimientosSpreadsheets.size > 0) {
    info('Running Movimientos column migrations', {
      module: 'migrations',
      phase: 'startup',
      spreadsheetCount: movimientosSpreadsheets.size,
    });

    let totalMigrated = 0;

    for (const [name, spreadsheetId] of movimientosSpreadsheets) {
      const result = await migrateMovimientosColumns(spreadsheetId, name);
      if (result.ok) {
        totalMigrated += result.value;
      } else {
        warn('Migration failed for spreadsheet', {
          module: 'migrations',
          phase: 'startup',
          spreadsheet: name,
          error: result.error.message,
        });
      }
    }

    if (totalMigrated > 0) {
      info('Movimientos column migrations complete', {
        module: 'migrations',
        phase: 'startup',
        sheetsMigrated: totalMigrated,
      });
    } else {
      debug('No Movimientos column migrations needed', {
        module: 'migrations',
        phase: 'startup',
      });
    }
  }

  // Migrate Dashboard processedAt cells to DATE_TIME format
  if (dashboardOperativoId) {
    await migrateDashboardProcessedAt(dashboardOperativoId);
  }
}
