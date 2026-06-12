/**
 * Storage operations for recibos
 * Handles writing recibos to Control de Egresos spreadsheet
 */

import type { Result, Recibo, StoreResult } from '../../types/index.js';
import type { ScanContext } from '../scanner.js';
import { appendRowsWithLinks, sortSheet, getSpreadsheetTimezone, getValues, updateRowsWithFormatting, type CellValueOrLink, type CellDate, type CellNumber } from '../../services/sheets.js';
import { parseNumber } from '../../utils/numbers.js';
import { generateReciboFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withLock } from '../../utils/concurrency.js';
import { STORE_LOCK_AUTO_EXPIRY_MS } from '../../config.js';

/**
 * Builds a CellValueOrLink[] row for updateRowsWithFormatting (reprocessing) and appendRowsWithLinks (insert)
 *
 * @param recibo - The recibo data
 * @param renamedFileName - The renamed filename
 * @returns Row with rich cell types
 */
function buildReciboRowFormatted(
  recibo: Recibo,
  renamedFileName: string
): CellValueOrLink[] {
  const fechaPagoDate: CellDate = { type: 'date', value: recibo.fechaPago };

  return [
    fechaPagoDate,                                        // A - proper date cell
    recibo.fileId,                                        // B
    { text: renamedFileName, url: `https://drive.google.com/file/d/${recibo.fileId}/view` }, // C
    recibo.tipoRecibo,                                    // D
    recibo.nombreEmpleado,                                // E
    recibo.cuilEmpleado,                                  // F
    recibo.legajo,                                        // G
    recibo.tareaDesempenada || '',                         // H
    recibo.cuitEmpleador,                                 // I
    recibo.periodoAbonado,                                // J
    { type: 'number', value: recibo.subtotalRemuneraciones } as CellNumber, // K
    { type: 'number', value: recibo.subtotalDescuentos } as CellNumber,     // L
    { type: 'number', value: recibo.totalNeto } as CellNumber,              // M
    recibo.processedAt,                                   // N
    recibo.confidence,                                    // O
    recibo.needsReview ? 'YES' : 'NO',                    // P
    recibo.matchedPagoFileId || '',                       // Q
    recibo.matchConfidence || '',                         // R
    recibo.hasCuitMatch ? 'YES' : 'NO',                   // S - hasCuitMatch (ADV-189)
  ];
}

/**
 * Finds the spreadsheet row index of a document by its fileId (column B)
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param sheetName - The sheet name
 * @param fileId - Google Drive file ID to search for
 * @returns Row found result with 1-indexed rowIndex, or not found
 */
async function findRowByFileId(
  spreadsheetId: string,
  sheetName: string,
  fileId: string
): Promise<{ found: true; rowIndex: number; rowData: unknown[] } | { found: false }> {
  // Read A:S (full recibo schema, 19 cols). fileId is column B = index 1 in A:S range.
  const rowsResult = await getValues(spreadsheetId, `${sheetName}!A:S`);
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { found: false };
  }
  // Skip header row (index 0 = row 1 in spreadsheet)
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (row && String(row[1]) === fileId) {
      return { found: true, rowIndex: i + 1, rowData: row }; // 1-indexed spreadsheet row
    }
  }
  return { found: false };
}

/**
 * Duplicate key: (cuilEmpleado, periodoAbonado, totalNeto)
 * Checks for duplicate recibo based on exact business key
 *
 * @returns Duplicate check result
 */
async function isDuplicateRecibo(
  spreadsheetId: string,
  cuilEmpleado: string,
  periodoAbonado: string,
  totalNeto: number
): Promise<{ isDuplicate: boolean; existingFileId?: string }> {
  const rowsResult = await getValues(spreadsheetId, 'Recibos!A:S');
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 13) continue;

    const rowFileId = row[1];           // Column B: fileId
    const rowCuilEmpleado = row[5];     // Column F: cuilEmpleado
    const rowPeriodoAbonado = row[9];   // Column J: periodoAbonado
    const rowTotalNetoStr = row[12];    // Column M: totalNeto

    // Parse the Argentine-formatted number
    const rowTotalNeto = parseNumber(rowTotalNetoStr) ?? 0;

    // Exact match on all three key fields
    if (rowCuilEmpleado === cuilEmpleado &&
        rowPeriodoAbonado === periodoAbonado &&
        Math.abs(rowTotalNeto - totalNeto) < 0.01) {
      return { isDuplicate: true, existingFileId: String(rowFileId) };
    }
  }
  return { isDuplicate: false };
}

/**
 * Stores a recibo in the Control de Egresos spreadsheet
 *
 * @param recibo - The recibo to store
 * @param spreadsheetId - The Control de Egresos spreadsheet ID
 * @param context - Optional scan context for cache optimization
 */
export async function storeRecibo(
  recibo: Recibo,
  spreadsheetId: string,
  context?: ScanContext
): Promise<Result<StoreResult, Error>> {
  // Create lock key from business key (prevents concurrent identical stores)
  const lockKey = `store:recibo:${recibo.cuilEmpleado}:${recibo.periodoAbonado}:${recibo.totalNeto}`;

  return withLock(lockKey, async () => {
    const sheetName = 'Recibos';
    const correlationId = getCorrelationId();

    // Get spreadsheet timezone early — used by both reprocessing and append paths
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    // REPROCESSING CHECK: If same fileId already exists, update the row in place
    const fileIdCheck = await findRowByFileId(spreadsheetId, sheetName, recibo.fileId);
    if (fileIdCheck.found) {
      const renamedFileName = generateReciboFileName(recibo);
      const updateRow = buildReciboRowFormatted(recibo, renamedFileName);

      // ADV-307: Preserve match columns — Q(16)=matchedPagoFileId, R(17)=matchConfidence, S(18)=hasCuitMatch
      const existing = fileIdCheck.rowData;
      if (String(existing[17]) === 'MANUAL') {
        updateRow[16] = existing[16] as CellValueOrLink; // matchedPagoFileId
        updateRow[17] = existing[17] as CellValueOrLink; // matchConfidence (MANUAL lock)
        updateRow[18] = existing[18] as CellValueOrLink; // hasCuitMatch
      }

      const updateResult = await updateRowsWithFormatting(spreadsheetId, [{
        range: `${sheetName}!A${fileIdCheck.rowIndex}:S${fileIdCheck.rowIndex}`,
        values: updateRow,
      }], timeZone, context?.metadataCache);
      if (!updateResult.ok) {
        throw updateResult.error;
      }

      info('Recibo reprocessed (existing row updated)', {
        module: 'storage',
        phase: 'recibo',
        fileId: recibo.fileId,
        rowIndex: fileIdCheck.rowIndex,
        correlationId,
      });

      if (context) {
        context.sortBatch.addPendingSort(spreadsheetId, sheetName, 0, true);
      } else {
        await sortSheet(spreadsheetId, sheetName, 0, true);
      }

      return { stored: true, updated: true };
    }

    // ADV-297: Check isLoaded() first — an unloaded cache returns isDuplicate:false (fail-open).
    // Use cache if loaded, otherwise fall back to API.
    const dupeCheck = context?.duplicateCache?.isLoaded(spreadsheetId, 'Recibos')
      ? context.duplicateCache.isDuplicateRecibo(
          spreadsheetId,
          recibo.cuilEmpleado,
          recibo.periodoAbonado,
          recibo.totalNeto
        )
      : await isDuplicateRecibo(
          spreadsheetId,
          recibo.cuilEmpleado,
          recibo.periodoAbonado,
          recibo.totalNeto
        );

    if (dupeCheck.isDuplicate) {
      warn('Duplicate recibo detected, skipping', {
        module: 'storage',
        phase: 'recibo',
        fileId: recibo.fileId,
        cuilEmpleado: recibo.cuilEmpleado,
        periodoAbonado: recibo.periodoAbonado,
        existingFileId: dupeCheck.existingFileId,
        correlationId,
      });
      return { stored: false, existingFileId: dupeCheck.existingFileId };
    }
    // Calculate the renamed filename that will be used when the file is moved
    const renamedFileName = generateReciboFileName(recibo);

    const row = buildReciboRowFormatted(recibo, renamedFileName);

    const result = await appendRowsWithLinks(spreadsheetId, `${sheetName}!A:S`, [row], timeZone, context?.metadataCache);
    if (!result.ok) {
      throw result.error;
    }

    // Update cache if available
    context?.duplicateCache?.addEntry(spreadsheetId, 'Recibos', recibo.fileId, row);

    info('Recibo stored successfully', {
      module: 'storage',
      phase: 'recibo',
      fileId: recibo.fileId,
      correlationId: getCorrelationId(),
    });

    // Defer sort if context available, otherwise sort immediately
    if (context) {
      // Sort sheet by fechaPago (column A, index 0) in descending order (most recent first)
      context.sortBatch.addPendingSort(spreadsheetId, 'Recibos', 0, true);
    } else {
      // Sort sheet by fechaPago (column A, index 0) in descending order (most recent first)
      const sortResult = await sortSheet(spreadsheetId, 'Recibos', 0, true);
      if (!sortResult.ok) {
        warn('Failed to sort sheet Recibos', {
          module: 'storage',
          phase: 'recibo',
          error: sortResult.error.message,
          correlationId: getCorrelationId(),
        });
        // Don't fail the operation if sorting fails
      }
    }

    return { stored: true };
  }, 10000, STORE_LOCK_AUTO_EXPIRY_MS); // 10 s wait; 15 min expiry for crash recovery (ADV-344)
}
