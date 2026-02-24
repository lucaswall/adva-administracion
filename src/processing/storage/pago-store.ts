/**
 * Storage operations for pagos
 * Handles writing pagos to Control de Ingresos/Egresos spreadsheets
 */

import type { Result, Pago, StoreResult } from '../../types/index.js';
import type { ScanContext } from '../scanner.js';
import { appendRowsWithLinks, sortSheet, getValues, updateRowsWithFormatting, getSpreadsheetTimezone, type CellValueOrLink, type CellDate, type CellValue, type CellNumber } from '../../services/sheets.js';
import { parseNumber } from '../../utils/numbers.js';
import { generatePagoFileName } from '../../utils/file-naming.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withLock } from '../../utils/concurrency.js';

/**
 * Builds a CellValueOrLink[] row for updateRowsWithFormatting (reprocessing/replacement) and appendRowsWithLinks (insert)
 *
 * @param pago - The pago data
 * @param documentType - The document type
 * @param renamedFileName - The renamed filename
 * @returns Row with rich cell types
 */
function buildPagoRowFormatted(
  pago: Pago,
  documentType: 'pago_enviado' | 'pago_recibido',
  renamedFileName: string
): CellValueOrLink[] {
  const fechaPagoDate: CellDate = { type: 'date', value: pago.fechaPago };
  const tipoDeCambioCell: CellNumber | '' = pago.tipoDeCambio
    ? { type: 'number', value: pago.tipoDeCambio }
    : '';
  const importeEnPesosCell: CellNumber | '' = pago.importeEnPesos
    ? { type: 'number', value: pago.importeEnPesos }
    : '';

  if (documentType === 'pago_enviado') {
    return [
      fechaPagoDate,                       // A - proper date cell
      pago.fileId,                         // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${pago.fileId}/view` }, // C
      pago.banco,                          // D
      { type: 'number', value: pago.importePagado } as CellNumber, // E
      pago.moneda || 'ARS',                // F
      pago.referencia || '',               // G
      pago.cuitBeneficiario || '',         // H
      pago.nombreBeneficiario || '',       // I
      pago.concepto || '',                 // J
      pago.processedAt,                    // K
      pago.confidence,                     // L
      pago.needsReview ? 'YES' : 'NO',     // M
      pago.matchedFacturaFileId || '',     // N
      pago.matchConfidence || '',          // O
      tipoDeCambioCell,                    // P
      importeEnPesosCell,                  // Q
    ];
  } else {
    return [
      fechaPagoDate,                       // A - proper date cell
      pago.fileId,                         // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${pago.fileId}/view` }, // C
      pago.banco,                          // D
      { type: 'number', value: pago.importePagado } as CellNumber, // E
      pago.moneda || 'ARS',                // F
      pago.referencia || '',               // G
      pago.cuitPagador || '',              // H
      pago.nombrePagador || '',            // I
      pago.concepto || '',                 // J
      pago.processedAt,                    // K
      pago.confidence,                     // L
      pago.needsReview ? 'YES' : 'NO',     // M
      pago.matchedFacturaFileId || '',     // N
      pago.matchConfidence || '',          // O
      tipoDeCambioCell,                    // P
      importeEnPesosCell,                  // Q
    ];
  }
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
 * Compares quality between a new pago and an existing spreadsheet row
 *
 * Quality signals (in order of priority):
 * 1. Has tipoDeCambio > doesn't have tipoDeCambio
 * 2. Has counterparty CUIT > doesn't have CUIT
 * 3. Higher confidence > lower confidence
 *
 * @param newPago - The new pago being stored
 * @param existingRowData - The existing row data from spreadsheet
 * @param documentType - The document type (to determine which CUIT to use)
 * @returns 'better' | 'worse' | 'equal'
 */
function isQualityBetter(
  newPago: Pago,
  existingRowData: CellValue[],
  documentType: 'pago_enviado' | 'pago_recibido'
): 'better' | 'worse' | 'equal' {
  // Column P (index 15): tipoDeCambio
  const existingTipoDeCambio = parseNumber(String(existingRowData[15] ?? '')) ?? 0;
  // Column H (index 7): counterparty CUIT
  const existingCuit = existingRowData[7] ? String(existingRowData[7]) : '';
  // Column L (index 11): confidence
  const existingConfidence = parseNumber(String(existingRowData[11] ?? '0')) ?? 0;

  const newCuit = documentType === 'pago_enviado'
    ? (newPago.cuitBeneficiario || '')
    : (newPago.cuitPagador || '');
  const newConfidence = newPago.confidence;

  // Signal 1: Has tipoDeCambio
  const newHasTipoDeCambio = (newPago.tipoDeCambio ?? 0) > 0;
  const existingHasTipoDeCambio = existingTipoDeCambio > 0;
  if (newHasTipoDeCambio && !existingHasTipoDeCambio) return 'better';
  if (!newHasTipoDeCambio && existingHasTipoDeCambio) return 'worse';

  // Signal 2: Has CUIT
  const existingHasCuit = existingCuit !== '';
  const newHasCuit = newCuit !== '';
  if (newHasCuit && !existingHasCuit) return 'better';
  if (!newHasCuit && existingHasCuit) return 'worse';

  // Signal 3: Confidence (only compared when above signals are equal)
  if (newConfidence > existingConfidence + 0.001) return 'better';
  if (newConfidence < existingConfidence - 0.001) return 'worse';

  return 'equal';
}

/**
 * Checks if a pago already exists in the sheet
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param sheetName - The sheet name
 * @param fecha - Payment date
 * @param importePagado - Amount paid
 * @param cuit - CUIT of counterparty (pagador or beneficiario)
 * @returns Duplicate check result with row index for potential replacement
 */
async function isDuplicatePago(
  spreadsheetId: string,
  sheetName: string,
  fecha: string,
  importePagado: number,
  cuit: string
): Promise<{ isDuplicate: boolean; existingFileId?: string; existingRowIndex?: number; existingRowData?: CellValue[] }> {
  // Extended range to A:Q to support quality comparison (includes tipoDeCambio at col P)
  const rowsResult = await getValues(spreadsheetId, `${sheetName}!A:Q`);
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 8) continue;

    const rowFechaRaw = row[0];     // Column A: fechaPago (serial number or string)
    const rowFileId = row[1];       // Column B: fileId
    const rowImporteStr = row[4];   // Column E: importePagado
    const rowCuit = row[7];         // Column H: cuitBeneficiario/cuitPagador

    // Convert serial number to date string for comparison
    const rowFecha = normalizeSpreadsheetDate(rowFechaRaw);

    // Parse the Argentine-formatted number
    const rowImporte = parseNumber(rowImporteStr) ?? 0;

    // Match on fecha + importe + CUIT
    if (rowFecha === fecha &&
        Math.abs(rowImporte - importePagado) < 0.01 &&
        rowCuit === cuit) {
      return {
        isDuplicate: true,
        existingFileId: String(rowFileId),
        existingRowIndex: i + 1, // 1-indexed
        existingRowData: row,
      };
    }
  }
  return { isDuplicate: false };
}

/**
 * Stores a pago in the appropriate Control spreadsheet
 *
 * @param pago - The pago to store
 * @param spreadsheetId - The spreadsheet ID (Control de Ingresos or Control de Egresos)
 * @param sheetName - The sheet name ('Pagos Recibidos' or 'Pagos Enviados')
 * @param documentType - The document type for filename generation
 * @param context - Optional scan context for cache optimization
 */
export async function storePago(
  pago: Pago,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'pago_enviado' | 'pago_recibido',
  context?: ScanContext
): Promise<Result<StoreResult, Error>> {
  // Create lock key from business key (prevents concurrent identical stores)
  const counterpartyCuit = documentType === 'pago_enviado'
    ? (pago.cuitBeneficiario || '')
    : (pago.cuitPagador || '');

  const lockKey = `store:pago:${pago.fechaPago}:${pago.importePagado}:${counterpartyCuit}`;

  return withLock(lockKey, async () => {
    // Get spreadsheet timezone early — used by both reprocessing and append paths
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    // REPROCESSING CHECK: If same fileId already exists, update the row in place
    const fileIdCheck = await findRowByFileId(spreadsheetId, sheetName, pago.fileId);
    if (fileIdCheck.found) {
      const renamedFileName = generatePagoFileName(pago, documentType);
      const updateRow = buildPagoRowFormatted(pago, documentType, renamedFileName);
      const updateResult = await updateRowsWithFormatting(spreadsheetId, [{
        range: `${sheetName}!A${fileIdCheck.rowIndex}:Q${fileIdCheck.rowIndex}`,
        values: updateRow,
      }], timeZone, context?.metadataCache);
      if (!updateResult.ok) {
        throw updateResult.error;
      }

      info('Pago reprocessed (existing row updated)', {
        module: 'storage',
        phase: 'pago',
        fileId: pago.fileId,
        documentType,
        spreadsheet: sheetName,
        rowIndex: fileIdCheck.rowIndex,
        correlationId: getCorrelationId(),
      });

      if (context) {
        context.sortBatch.addPendingSort(spreadsheetId, sheetName, 0, true);
      } else {
        await sortSheet(spreadsheetId, sheetName, 0, true);
      }

      return { stored: true, updated: true };
    }

    // DUPLICATE CHECK (business key): Use cache for fast non-duplicate detection.
    // If cache reports a duplicate, always fall through to API to get full row data for quality comparison.
    const cacheHit = context?.duplicateCache
      ? context.duplicateCache.isDuplicatePago(
          spreadsheetId,
          sheetName,
          pago.fechaPago,
          pago.importePagado,
          counterpartyCuit
        )
      : null;

    const dupeCheck: { isDuplicate: boolean; existingFileId?: string; existingRowIndex?: number; existingRowData?: CellValue[] } =
      (cacheHit === null || cacheHit.isDuplicate)
        ? await isDuplicatePago(
            spreadsheetId,
            sheetName,
            pago.fechaPago,
            pago.importePagado,
            counterpartyCuit
          )
        : cacheHit;

    if (dupeCheck.isDuplicate) {
      // QUALITY COMPARISON: If new document is better, replace the existing one
      if (dupeCheck.existingRowData && dupeCheck.existingRowIndex) {
        const quality = isQualityBetter(pago, dupeCheck.existingRowData, documentType);
        if (quality === 'better') {
          const renamedFileName = generatePagoFileName(pago, documentType);
          const updateRow = buildPagoRowFormatted(pago, documentType, renamedFileName);
          const updateResult = await updateRowsWithFormatting(spreadsheetId, [{
            range: `${sheetName}!A${dupeCheck.existingRowIndex}:Q${dupeCheck.existingRowIndex}`,
            values: updateRow,
          }], timeZone, context?.metadataCache);
          if (!updateResult.ok) {
            throw updateResult.error;
          }

          info('Better quality pago replaced existing', {
            module: 'storage',
            phase: 'pago',
            newFileId: pago.fileId,
            replacedFileId: dupeCheck.existingFileId,
            correlationId: getCorrelationId(),
          });

          if (context) {
            context.sortBatch.addPendingSort(spreadsheetId, sheetName, 0, true);
          } else {
            await sortSheet(spreadsheetId, sheetName, 0, true);
          }

          return { stored: true, replacedFileId: dupeCheck.existingFileId };
        }
      }

      warn('Duplicate pago detected, skipping', {
        module: 'storage',
        phase: 'pago',
        fecha: pago.fechaPago,
        importe: pago.importePagado,
        existingFileId: dupeCheck.existingFileId,
        newFileId: pago.fileId,
        correlationId: getCorrelationId(),
      });
      return { stored: false, existingFileId: dupeCheck.existingFileId };
    }

    // Calculate the renamed filename that will be used when the file is moved
    const renamedFileName = generatePagoFileName(pago, documentType);

    // Build row based on document type - only include counterparty info
    const row = buildPagoRowFormatted(pago, documentType, renamedFileName);
    const range = `${sheetName}!A:Q`;

    const result = await appendRowsWithLinks(spreadsheetId, range, [row], timeZone, context?.metadataCache);
    if (!result.ok) {
      throw result.error;
    }

    // Update cache if available
    context?.duplicateCache?.addEntry(spreadsheetId, sheetName, pago.fileId, row);

    info('Pago stored successfully', {
      module: 'storage',
      phase: 'pago',
      fileId: pago.fileId,
      documentType,
      spreadsheet: sheetName,
      correlationId: getCorrelationId(),
    });

    // Defer sort if context available, otherwise sort immediately
    if (context) {
      // Sort sheet by fechaPago (column A, index 0) in descending order (most recent first)
      context.sortBatch.addPendingSort(spreadsheetId, sheetName, 0, true);
    } else {
      // Sort sheet by fechaPago (column A, index 0) in descending order (most recent first)
      const sortResult = await sortSheet(spreadsheetId, sheetName, 0, true);
      if (!sortResult.ok) {
        warn(`Failed to sort sheet ${sheetName}`, {
          module: 'storage',
          phase: 'pago',
          error: sortResult.error.message,
          correlationId: getCorrelationId(),
        });
        // Don't fail the operation if sorting fails
      }
    }

    return { stored: true };
  }, 10000); // 10 second timeout for lock
}
