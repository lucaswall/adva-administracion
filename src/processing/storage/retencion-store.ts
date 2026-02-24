/**
 * Storage operations for retenciones (tax withholding certificates)
 * Handles writing retenciones to Control de Ingresos spreadsheet
 */

import type { Result, Retencion, StoreResult } from '../../types/index.js';
import type { ScanContext } from '../scanner.js';
import { appendRowsWithLinks, sortSheet, getSpreadsheetTimezone, getValues, updateRowsWithFormatting, type CellValueOrLink, type CellDate, type CellNumber } from '../../services/sheets.js';
import { parseNumber } from '../../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { generateRetencionFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withLock } from '../../utils/concurrency.js';

/**
 * Builds a CellValueOrLink[] row for updateRowsWithFormatting (reprocessing) and appendRowsWithLinks (insert)
 *
 * @param retencion - The retencion data
 * @param renamedFileName - The renamed filename
 * @returns Row with rich cell types
 */
function buildRetencionRowFormatted(
  retencion: Retencion,
  renamedFileName: string
): CellValueOrLink[] {
  const fechaEmisionDate: CellDate = { type: 'date', value: retencion.fechaEmision };

  return [
    fechaEmisionDate,                                     // A - proper date cell
    retencion.fileId,                                     // B
    { text: renamedFileName, url: `https://drive.google.com/file/d/${retencion.fileId}/view` }, // C
    retencion.nroCertificado,                             // D
    retencion.cuitAgenteRetencion,                        // E
    retencion.razonSocialAgenteRetencion,                 // F
    retencion.impuesto,                                   // G
    retencion.regimen,                                    // H
    { type: 'number', value: retencion.montoComprobante } as CellNumber, // I
    { type: 'number', value: retencion.montoRetencion } as CellNumber,   // J
    retencion.processedAt,                                // K
    retencion.confidence,                                 // L
    retencion.needsReview ? 'YES' : 'NO',                  // M
    retencion.matchedFacturaFileId || '',                 // N
    retencion.matchConfidence || '',                      // O
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
): Promise<{ found: true; rowIndex: number } | { found: false }> {
  const rowsResult = await getValues(spreadsheetId, `${sheetName}!B:B`);
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { found: false };
  }
  // Skip header row (index 0 = row 1 in spreadsheet)
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (row && String(row[0]) === fileId) {
      return { found: true, rowIndex: i + 1 }; // 1-indexed spreadsheet row
    }
  }
  return { found: false };
}

/**
 * Duplicate key: (nroCertificado, cuitAgenteRetencion, fechaEmision, montoRetencion)
 * Checks for duplicate retencion based on exact business key
 *
 * @returns Duplicate check result
 */
async function isDuplicateRetencion(
  spreadsheetId: string,
  nroCertificado: string,
  cuitAgenteRetencion: string,
  fechaEmision: string,
  montoRetencion: number
): Promise<{ isDuplicate: boolean; existingFileId?: string }> {
  const rowsResult = await getValues(spreadsheetId, 'Retenciones Recibidas!A:O');
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 10) continue;

    const rowFechaEmisionRaw = row[0];  // Column A: fechaEmision (serial number or string)
    const rowFileId = row[1];           // Column B: fileId
    const rowNroCertificado = row[3];   // Column D: nroCertificado
    const rowCuitAgente = row[4];       // Column E: cuitAgenteRetencion
    const rowMontoRetencionStr = row[9];// Column J: montoRetencion

    // Convert serial number to date string for comparison
    const rowFechaEmision = normalizeSpreadsheetDate(rowFechaEmisionRaw);

    // Parse the Argentine-formatted number
    const rowMontoRetencion = parseNumber(rowMontoRetencionStr) ?? 0;

    // Exact match on all four key fields
    if (rowNroCertificado === nroCertificado &&
        rowCuitAgente === cuitAgenteRetencion &&
        rowFechaEmision === fechaEmision &&
        Math.abs(rowMontoRetencion - montoRetencion) < 0.01) {
      return { isDuplicate: true, existingFileId: String(rowFileId) };
    }
  }
  return { isDuplicate: false };
}

/**
 * Stores a retencion in Control de Ingresos
 *
 * @param retencion - The retencion to store
 * @param spreadsheetId - The Control de Ingresos spreadsheet ID
 * @param context - Optional scan context for cache optimization
 */
export async function storeRetencion(
  retencion: Retencion,
  spreadsheetId: string,
  context?: ScanContext
): Promise<Result<StoreResult, Error>> {
  // Create lock key from business key (prevents concurrent identical stores)
  const lockKey = `store:retencion:${retencion.nroCertificado}:${retencion.cuitAgenteRetencion}:${retencion.fechaEmision}:${retencion.montoRetencion}`;

  return withLock(lockKey, async () => {
    const sheetName = 'Retenciones Recibidas';
    const correlationId = getCorrelationId();

    // Get spreadsheet timezone early — used by both reprocessing and append paths
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    // REPROCESSING CHECK: If same fileId already exists, update the row in place
    const fileIdCheck = await findRowByFileId(spreadsheetId, sheetName, retencion.fileId);
    if (fileIdCheck.found) {
      const renamedFileName = generateRetencionFileName(retencion);
      const updateRow = buildRetencionRowFormatted(retencion, renamedFileName);
      const updateResult = await updateRowsWithFormatting(spreadsheetId, [{
        range: `${sheetName}!A${fileIdCheck.rowIndex}:O${fileIdCheck.rowIndex}`,
        values: updateRow,
      }], timeZone, context?.metadataCache);
      if (!updateResult.ok) {
        throw updateResult.error;
      }

      info('Retencion reprocessed (existing row updated)', {
        module: 'storage',
        phase: 'retencion',
        fileId: retencion.fileId,
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

    // Use cache if available, otherwise API
    const dupeCheck = context?.duplicateCache
      ? context.duplicateCache.isDuplicateRetencion(
          spreadsheetId,
          retencion.nroCertificado,
          retencion.cuitAgenteRetencion,
          retencion.fechaEmision,
          retencion.montoRetencion
        )
      : await isDuplicateRetencion(
          spreadsheetId,
          retencion.nroCertificado,
          retencion.cuitAgenteRetencion,
          retencion.fechaEmision,
          retencion.montoRetencion
        );

    if (dupeCheck.isDuplicate) {
      warn('Duplicate retencion detected, skipping', {
        module: 'retencion-store',
        phase: 'store',
        fileId: retencion.fileId,
        nroCertificado: retencion.nroCertificado,
        existingFileId: dupeCheck.existingFileId,
        correlationId,
      });
      return { stored: false, existingFileId: dupeCheck.existingFileId };
    }

    // Calculate the renamed filename that will be used when the file is moved
    const renamedFileName = generateRetencionFileName(retencion);

    // Build row (columns A:O)
    const row = buildRetencionRowFormatted(retencion, renamedFileName);
    const range = `${sheetName}!A:O`;

    info('Storing retencion', {
      module: 'retencion-store',
      phase: 'store',
      correlationId,
      fileId: retencion.fileId,
      nroCertificado: retencion.nroCertificado,
      spreadsheetId,
      sheetName
    });

    const appendResult = await appendRowsWithLinks(spreadsheetId, range, [row], timeZone, context?.metadataCache);
    if (!appendResult.ok) {
      throw appendResult.error;
    }

    // Update cache if available
    context?.duplicateCache?.addEntry(spreadsheetId, sheetName, retencion.fileId, row);

    info('Retencion stored successfully', {
      module: 'retencion-store',
      phase: 'store-complete',
      correlationId,
      fileId: retencion.fileId,
      nroCertificado: retencion.nroCertificado
    });

    // Defer sort if context available, otherwise sort immediately
    if (context) {
      // Sort sheet by fechaEmision (column A) in descending order
      context.sortBatch.addPendingSort(spreadsheetId, sheetName, 0, true);
    } else {
      // Sort sheet by fechaEmision (column A) in descending order
      const sortResult = await sortSheet(spreadsheetId, sheetName, 0, true);
      if (!sortResult.ok) {
        warn(`Failed to sort sheet ${sheetName}`, {
          module: 'retencion-store',
          phase: 'store',
          error: sortResult.error.message,
          correlationId: getCorrelationId(),
        });
        // Don't fail the operation if sorting fails
      }
    }

    return { stored: true };
  }, 10000); // 10 second timeout for lock
}
