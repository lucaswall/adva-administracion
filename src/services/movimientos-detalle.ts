/**
 * Movimientos detalle service
 * Handles batch updates of matchedFileId and detalle columns
 */

import { createHash } from 'crypto';
import type { Result } from '../types/index.js';
import { SHEETS_BATCH_UPDATE_LIMIT } from '../config.js';
import { batchUpdate, getValues, type CellValue } from './sheets.js';
import { debug, warn } from '../utils/logger.js';
import { parseNumber } from '../utils/numbers.js';

/**
 * Represents an update to the matchedFileId and detalle columns
 */
export interface DetalleUpdate {
  /** Sheet name (e.g., "2025-01") */
  sheetName: string;
  /** Row number in sheet (1-indexed) */
  rowNumber: number;
  /** Google Drive fileId of matched document (column G) */
  matchedFileId: string;
  /** Human-readable description (column H) */
  detalle: string;
  /**
   * Expected version hash of the row (for TOCTOU protection).
   * If provided, the update will be skipped if the row's current version
   * doesn't match, preventing concurrent modification overwrites.
   */
  expectedVersion?: string;
}

/**
 * Escapes a sheet name for use in A1 notation
 * Single quotes in sheet names must be escaped by doubling them
 *
 * @param sheetName - The sheet name to escape
 * @returns Escaped sheet name suitable for A1 notation
 */
function escapeSheetName(sheetName: string): string {
  // Escape single quotes by doubling them
  return sheetName.replace(/'/g, "''");
}

/**
 * Computes version hash from raw row data (columns A-H)
 * Must match the algorithm in match-movimientos.ts computeRowVersion
 *
 * @param row - Raw cell values from spreadsheet [fecha, origenConcepto, debito, credito, saldo, saldoCalculado, matchedFileId, detalle]
 * @returns Hex string hash (16 chars)
 */
function computeVersionFromRow(row: CellValue[]): string {
  const fecha = String(row[0] || '');
  const origenConcepto = String(row[1] || '');
  const debito = parseNumber(row[2]);
  const credito = parseNumber(row[3]);
  const matchedFileId = String(row[6] || '');
  const detalle = String(row[7] || '');

  const data = [
    fecha,
    origenConcepto,
    debito?.toString() ?? '',
    credito?.toString() ?? '',
    matchedFileId,
    detalle,
  ].join('|');

  return createHash('md5').update(data).digest('hex').slice(0, 16);
}

/**
 * Updates matchedFileId and detalle columns for specified rows using batchUpdate
 * Automatically chunks to respect 500 operations limit per API call
 *
 * TOCTOU Protection: If updates include expectedVersion, the function will verify
 * that the row hasn't changed since it was read. Updates where the current version
 * doesn't match expectedVersion are skipped to prevent overwriting concurrent changes.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param updates - Array of updates to apply
 * @returns Number of rows actually updated (may be less than updates.length if versions mismatch)
 */
export async function updateDetalle(
  spreadsheetId: string,
  updates: DetalleUpdate[]
): Promise<Result<number, Error>> {
  if (updates.length === 0) {
    return { ok: true, value: 0 };
  }

  // Filter updates that need version verification
  const updatesWithVersion = updates.filter(u => u.expectedVersion);
  const updatesWithoutVersion = updates.filter(u => !u.expectedVersion);

  // For updates with version, verify the row hasn't changed
  let verifiedUpdates: DetalleUpdate[] = [...updatesWithoutVersion];

  if (updatesWithVersion.length > 0) {
    // Group updates by sheet for efficient batch reads
    const updatesBySheet = new Map<string, DetalleUpdate[]>();
    for (const update of updatesWithVersion) {
      const existing = updatesBySheet.get(update.sheetName) || [];
      existing.push(update);
      updatesBySheet.set(update.sheetName, existing);
    }

    // Verify each sheet's updates
    for (const [sheetName, sheetUpdates] of updatesBySheet) {
      // Read the full sheet to get current state (columns A:H)
      const range = `'${escapeSheetName(sheetName)}'!A:H`;
      const readResult = await getValues(spreadsheetId, range);

      if (!readResult.ok) {
        warn('Failed to read sheet for version verification, skipping updates', {
          module: 'movimientos-detalle',
          sheetName,
          error: readResult.error.message,
        });
        continue;
      }

      const sheetData = readResult.value;

      // Verify each update in this sheet
      for (const update of sheetUpdates) {
        // Row numbers are 1-indexed, array is 0-indexed
        const rowIndex = update.rowNumber - 1;

        if (rowIndex >= 0 && rowIndex < sheetData.length) {
          const currentRow = sheetData[rowIndex];
          const currentVersion = computeVersionFromRow(currentRow);

          if (currentVersion === update.expectedVersion) {
            // Version matches - safe to update
            verifiedUpdates.push(update);
          } else {
            // Version mismatch - row was modified concurrently, skip update
            warn('Skipping update due to version mismatch (TOCTOU protection)', {
              module: 'movimientos-detalle',
              sheetName,
              rowNumber: update.rowNumber,
              expectedVersion: update.expectedVersion,
              currentVersion,
            });
          }
        } else {
          warn('Row index out of bounds, skipping update', {
            module: 'movimientos-detalle',
            sheetName,
            rowNumber: update.rowNumber,
            totalRows: sheetData.length,
          });
        }
      }
    }
  }

  if (verifiedUpdates.length === 0) {
    debug('No updates to apply after version verification', {
      module: 'movimientos-detalle',
      spreadsheetId,
      originalCount: updates.length,
    });
    return { ok: true, value: 0 };
  }

  // Build update operations for batchUpdate
  const allUpdates: Array<{ range: string; values: CellValue[][] }> = verifiedUpdates.map(u => ({
    range: `'${escapeSheetName(u.sheetName)}'!G${u.rowNumber}:H${u.rowNumber}`,
    values: [[u.matchedFileId, u.detalle]],
  }));

  debug('Preparing detalle updates', {
    module: 'movimientos-detalle',
    spreadsheetId,
    totalUpdates: allUpdates.length,
    skippedByVersion: updates.length - verifiedUpdates.length,
    chunks: Math.ceil(allUpdates.length / SHEETS_BATCH_UPDATE_LIMIT),
  });

  // Chunk updates to respect API limit (500 operations max per call)
  let totalUpdated = 0;

  for (let i = 0; i < allUpdates.length; i += SHEETS_BATCH_UPDATE_LIMIT) {
    const chunk = allUpdates.slice(i, i + SHEETS_BATCH_UPDATE_LIMIT);

    const result = await batchUpdate(spreadsheetId, chunk);
    if (!result.ok) {
      return result;
    }

    totalUpdated += chunk.length;

    debug('Processed detalle update chunk', {
      module: 'movimientos-detalle',
      chunkSize: chunk.length,
      totalUpdated,
      remaining: allUpdates.length - totalUpdated,
    });
  }

  return { ok: true, value: totalUpdated };
}
