/**
 * Movimientos detalle service
 * Handles batch updates of matchedFileId and detalle columns
 */

import type { Result } from '../types/index.js';
import { SHEETS_BATCH_UPDATE_LIMIT } from '../config.js';
import { batchUpdate, type CellValue } from './sheets.js';
import { debug } from '../utils/logger.js';

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
 * Updates matchedFileId and detalle columns for specified rows using batchUpdate
 * Automatically chunks to respect 500 operations limit per API call
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param updates - Array of updates to apply
 * @returns Number of rows updated
 */
export async function updateDetalle(
  spreadsheetId: string,
  updates: DetalleUpdate[]
): Promise<Result<number, Error>> {
  if (updates.length === 0) {
    return { ok: true, value: 0 };
  }

  // Build update operations for batchUpdate
  const allUpdates: Array<{ range: string; values: CellValue[][] }> = updates.map(u => ({
    range: `'${escapeSheetName(u.sheetName)}'!G${u.rowNumber}:H${u.rowNumber}`,
    values: [[u.matchedFileId, u.detalle]],
  }));

  debug('Preparing detalle updates', {
    module: 'movimientos-detalle',
    spreadsheetId,
    totalUpdates: allUpdates.length,
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
