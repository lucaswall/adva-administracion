/**
 * Storage operations for recibos
 * Handles writing recibos to Control de Egresos spreadsheet
 */

import type { Result, Recibo } from '../../types/index.js';
import type { ScanContext } from '../scanner.js';
import { appendRowsWithLinks, sortSheet, getSpreadsheetTimezone, getValues, type CellValueOrLink, type CellDate } from '../../services/sheets.js';
import { formatUSCurrency, parseNumber } from '../../utils/numbers.js';
import { generateReciboFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withLock } from '../../utils/concurrency.js';

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
  const rowsResult = await getValues(spreadsheetId, 'Recibos!A:R');
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
): Promise<Result<{ stored: boolean; existingFileId?: string }, Error>> {
  // Create lock key from business key (prevents concurrent identical stores)
  const lockKey = `store:recibo:${recibo.cuilEmpleado}:${recibo.periodoAbonado}:${recibo.totalNeto}`;

  return withLock(lockKey, async () => {
    const correlationId = getCorrelationId();

    // Use cache if available, otherwise API
    const dupeCheck = context?.duplicateCache
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

    // Create CellDate for proper date formatting
    const fechaPagoDate: CellDate = { type: 'date', value: recibo.fechaPago };

    const row: CellValueOrLink[] = [
      fechaPagoDate,  // proper date cell
      recibo.fileId,
      {
        text: renamedFileName,
        url: `https://drive.google.com/file/d/${recibo.fileId}/view`,
      },
      recibo.tipoRecibo,
      recibo.nombreEmpleado,
      recibo.cuilEmpleado,
      recibo.legajo,
      recibo.tareaDesempenada || '',
      recibo.cuitEmpleador,
      recibo.periodoAbonado,
      formatUSCurrency(recibo.subtotalRemuneraciones),
      formatUSCurrency(recibo.subtotalDescuentos),
      formatUSCurrency(recibo.totalNeto),
      recibo.processedAt,
      recibo.confidence,
      recibo.needsReview ? 'YES' : 'NO',
      recibo.matchedPagoFileId || '',
      recibo.matchConfidence || '',
    ];

    // Get spreadsheet timezone for proper timestamp formatting
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    const result = await appendRowsWithLinks(spreadsheetId, 'Recibos!A:R', [row], timeZone, context?.metadataCache);
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
  }, 10000); // 10 second timeout for lock
}
