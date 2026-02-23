/**
 * Spreadsheet schema migrations
 * Runs at startup to ensure existing spreadsheets match the current schema
 */

import type { Result } from '../types/index.js';
import { getValues, setValues, getSheetMetadata } from './sheets.js';
import { getCachedFolderStructure } from './folder-structure.js';
import { MOVIMIENTOS_BANCARIO_SHEET } from '../constants/spreadsheet-headers.js';
import { info, warn, debug } from '../utils/logger.js';

/**
 * Migrates a single Movimientos spreadsheet to add the matchedType header (column I)
 * to any sheets that only have 8 columns (A:H).
 *
 * @param spreadsheetId - The Movimientos spreadsheet ID
 * @param spreadsheetName - Human-readable name for logging
 * @returns Result with number of sheets migrated
 */
export async function migrateMovimientosMatchedType(
  spreadsheetId: string,
  spreadsheetName: string
): Promise<Result<number, Error>> {
  const expectedHeader = MOVIMIENTOS_BANCARIO_SHEET.headers[8]; // 'matchedType'

  // Get all sheets in this spreadsheet
  const metadataResult = await getSheetMetadata(spreadsheetId);
  if (!metadataResult.ok) return metadataResult;

  let migratedCount = 0;

  for (const sheet of metadataResult.value) {
    // Only migrate month sheets (YYYY-MM format)
    if (!/^\d{4}-\d{2}$/.test(sheet.title)) continue;

    // Read just the header row (row 1)
    const headerResult = await getValues(spreadsheetId, `'${sheet.title}'!1:1`);
    if (!headerResult.ok) {
      warn('Failed to read header row for migration', {
        module: 'migrations',
        spreadsheet: spreadsheetName,
        sheet: sheet.title,
        error: headerResult.error.message,
      });
      continue;
    }

    const headerRow = headerResult.value[0];
    if (!headerRow) continue;

    // Check if column I header already exists
    if (headerRow.length >= 9 && headerRow[8] === expectedHeader) {
      continue; // Already migrated
    }

    // Warn if column I has unexpected content
    if (headerRow.length >= 9 && headerRow[8] && headerRow[8] !== expectedHeader) {
      warn('Unexpected value in column I header, overwriting', {
        module: 'migrations',
        spreadsheet: spreadsheetName,
        sheet: sheet.title,
        found: String(headerRow[8]),
        expected: expectedHeader,
      });
    }

    // Add the matchedType header to column I
    const updateResult = await setValues(
      spreadsheetId,
      `'${sheet.title}'!I1`,
      [[expectedHeader]]
    );

    if (!updateResult.ok) {
      warn('Failed to add matchedType header', {
        module: 'migrations',
        spreadsheet: spreadsheetName,
        sheet: sheet.title,
        error: updateResult.error.message,
      });
      continue;
    }

    migratedCount++;
    debug('Added matchedType header to sheet', {
      module: 'migrations',
      spreadsheet: spreadsheetName,
      sheet: sheet.title,
    });
  }

  return { ok: true, value: migratedCount };
}

/**
 * Runs all startup migrations for spreadsheet schemas.
 * Called during server initialization after folder structure is discovered.
 *
 * Currently handles:
 * - Adding matchedType column header (I) to Movimientos Bancario sheets
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

  const { movimientosSpreadsheets } = folderStructure;

  if (movimientosSpreadsheets.size === 0) {
    debug('No Movimientos spreadsheets found, skipping migrations', {
      module: 'migrations',
      phase: 'startup',
    });
    return;
  }

  info('Running startup migrations', {
    module: 'migrations',
    phase: 'startup',
    spreadsheetCount: movimientosSpreadsheets.size,
  });

  let totalMigrated = 0;

  for (const [name, spreadsheetId] of movimientosSpreadsheets) {
    const result = await migrateMovimientosMatchedType(spreadsheetId, name);
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
    info('Startup migrations complete', {
      module: 'migrations',
      phase: 'startup',
      sheetsMigrated: totalMigrated,
    });
  } else {
    debug('No migrations needed', {
      module: 'migrations',
      phase: 'startup',
    });
  }
}
