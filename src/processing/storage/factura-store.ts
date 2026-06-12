/**
 * Storage operations for facturas
 * Handles writing facturas to Control de Ingresos/Egresos spreadsheets
 */

import type { Result, Factura, StoreResult } from '../../types/index.js';
import type { ScanContext } from '../scanner.js';
import { appendRowsWithLinks, sortSheet, getValues, updateRowsWithFormatting, getSpreadsheetTimezone, type CellValueOrLink, type CellDate, type CellNumber } from '../../services/sheets.js';
import { parseNumber } from '../../utils/numbers.js';
import { generateFacturaFileName } from '../../utils/file-naming.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withLock } from '../../utils/concurrency.js';
import { STORE_LOCK_AUTO_EXPIRY_MS } from '../../config.js';
import { buildHeaderIndex } from '../../constants/spreadsheet-headers.js';

/**
 * Builds a CellValueOrLink[] row for updateRowsWithFormatting (reprocessing) and appendRowsWithLinks (insert)
 *
 * @param factura - The factura data
 * @param documentType - The document type
 * @param renamedFileName - The renamed filename
 * @returns Row with rich cell types
 */
function buildFacturaRowFormatted(
  factura: Factura,
  documentType: 'factura_emitida' | 'factura_recibida',
  renamedFileName: string
): CellValueOrLink[] {
  const fechaEmisionDate: CellDate = { type: 'date', value: factura.fechaEmision };
  const tipoDeCambioCell: CellNumber | '' = factura.tipoDeCambio
    ? { type: 'number', value: factura.tipoDeCambio }
    : '';

  if (documentType === 'factura_emitida') {
    return [
      fechaEmisionDate,                     // A (0) - proper date cell
      factura.fileId,                       // B (1)
      { text: renamedFileName, url: `https://drive.google.com/file/d/${factura.fileId}/view` }, // C (2)
      factura.tipoComprobante,              // D (3)
      factura.nroFactura,                   // E (4)
      factura.cuitReceptor || '',           // F (5)
      factura.razonSocialReceptor || '',    // G (6)
      factura.condicionIVAReceptor || '',   // H (7) - new ADV-245
      { type: 'number', value: factura.importeNeto } as CellNumber, // I (8)
      { type: 'number', value: factura.importeIva } as CellNumber,  // J (9)
      { type: 'number', value: factura.importeTotal } as CellNumber,// K (10)
      factura.moneda,                       // L (11)
      factura.concepto || '',               // M (12)
      factura.processedAt,                  // N (13)
      factura.confidence,                   // O (14)
      factura.needsReview ? 'YES' : 'NO',   // P (15)
      factura.matchedPagoFileId || '',      // Q (16)
      factura.matchConfidence || '',        // R (17)
      factura.hasCuitMatch ? 'YES' : 'NO',  // S (18)
      '',                                   // T (19) - pagada (initially empty)
      tipoDeCambioCell,                     // U (20)
    ];
  } else {
    return [
      fechaEmisionDate,                     // A - proper date cell
      factura.fileId,                       // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${factura.fileId}/view` }, // C
      factura.tipoComprobante,              // D
      factura.nroFactura,                   // E
      factura.cuitEmisor || '',             // F
      factura.razonSocialEmisor || '',      // G
      { type: 'number', value: factura.importeNeto } as CellNumber, // H
      { type: 'number', value: factura.importeIva } as CellNumber,  // I
      { type: 'number', value: factura.importeTotal } as CellNumber,// J
      factura.moneda,                       // K
      factura.concepto || '',               // L
      factura.processedAt,                  // M
      factura.confidence,                   // N
      factura.needsReview ? 'YES' : 'NO',   // O
      factura.matchedPagoFileId || '',      // P
      factura.matchConfidence || '',        // Q
      factura.hasCuitMatch ? 'YES' : 'NO',  // R
      '',                                   // S - pagada (initially empty)
      tipoDeCambioCell,                     // T
    ];
  }
}

/**
 * Finds the spreadsheet row index of a document by its fileId (column B),
 * returning the full row data for match-column preservation on reprocess (ADV-307).
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param sheetName - The sheet name
 * @param fileId - Google Drive file ID to search for
 * @returns Row found result with 1-indexed rowIndex and full rowData, or not found
 */
async function findRowByFileId(
  spreadsheetId: string,
  sheetName: string,
  fileId: string
): Promise<{ found: true; rowIndex: number; rowData: unknown[]; headerRow: unknown[] } | { found: false } | { error: Error }> {
  // Read A:U (widest factura schema, covers both emitida 21-col and recibida 20-col).
  // fileId is column B = index 1 in this range.
  const rowsResult = await getValues(spreadsheetId, `${sheetName}!A:U`);
  if (!rowsResult.ok) {
    return { error: rowsResult.error }; // ADV-358: propagate read error
  }
  if (rowsResult.value.length <= 1) {
    return { found: false };
  }
  const headerRow = rowsResult.value[0]; // ADV-362: capture header for index derivation
  // Skip header row (index 0 = row 1 in spreadsheet)
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (row && String(row[1]) === fileId) {
      return { found: true, rowIndex: i + 1, rowData: row, headerRow }; // 1-indexed spreadsheet row
    }
  }
  return { found: false };
}

/**
 * Checks if a factura already exists in the sheet
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param sheetName - The sheet name
 * @param nroFactura - Invoice number
 * @param fecha - Issue date
 * @param importeTotal - Total amount
 * @param cuit - CUIT of counterparty (emisor or receptor)
 * @returns Duplicate check result
 */
async function isDuplicateFactura(
  spreadsheetId: string,
  sheetName: string,
  nroFactura: string,
  fecha: string,
  importeTotal: number,
  cuit: string,
  documentType: 'factura_emitida' | 'factura_recibida'
): Promise<{ isDuplicate: boolean; existingFileId?: string }> {
  // factura_emitida has condicionIVAReceptor at H (ADV-245), so importeTotal shifted to K (col 11, idx 10)
  // factura_recibida is unchanged — importeTotal stays at J (col 10, idx 9)
  const isEmitida = documentType === 'factura_emitida';
  const lastCol = isEmitida ? 'K' : 'J';
  const importeColIdx = isEmitida ? 10 : 9;
  const minRowLength = importeColIdx + 1;

  const rowsResult = await getValues(spreadsheetId, `${sheetName}!A:${lastCol}`);
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < minRowLength) continue;

    const rowFechaRaw = row[0];                // Column A: fechaEmision (serial number or string)
    const rowFileId = row[1];                  // Column B: fileId
    const rowNroFactura = row[4];              // Column E: nroFactura
    const rowCuit = row[5];                    // Column F: cuitReceptor/cuitEmisor
    const rowImporteStr = row[importeColIdx];  // Column J or K: importeTotal

    // Convert serial number to date string for comparison
    const rowFecha = normalizeSpreadsheetDate(rowFechaRaw);

    // Parse the Argentine-formatted number
    const rowImporte = parseNumber(rowImporteStr) ?? 0;

    // Match on all four criteria
    if (rowNroFactura === nroFactura &&
        rowFecha === fecha &&
        Math.abs(rowImporte - importeTotal) < 0.01 &&
        rowCuit === cuit) {
      return { isDuplicate: true, existingFileId: String(rowFileId) };
    }
  }
  return { isDuplicate: false };
}

/**
 * Stores a factura in the appropriate Control spreadsheet
 *
 * @param factura - The factura to store
 * @param spreadsheetId - The spreadsheet ID (Control de Ingresos or Control de Egresos)
 * @param sheetName - The sheet name ('Facturas Emitidas' or 'Facturas Recibidas')
 * @param documentType - The document type for filename generation
 * @param context - Optional scan context for cache optimization
 */
export async function storeFactura(
  factura: Factura,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'factura_emitida' | 'factura_recibida',
  context?: ScanContext
): Promise<Result<StoreResult, Error>> {
  // Create lock key from business key (prevents concurrent identical stores)
  const counterpartyCuit = documentType === 'factura_emitida'
    ? (factura.cuitReceptor || '')
    : (factura.cuitEmisor || '');

  const lockKey = `store:factura:${factura.nroFactura}:${factura.fechaEmision}:${factura.importeTotal}:${counterpartyCuit}`;

  return withLock(lockKey, async () => {
    // Get spreadsheet timezone early — used by both reprocessing and append paths
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    // REPROCESSING CHECK: If the same fileId already exists in sheet, update it in place
    const fileIdCheck = await findRowByFileId(spreadsheetId, sheetName, factura.fileId);
    if ('error' in fileIdCheck) throw fileIdCheck.error; // ADV-358: propagate read error
    if (fileIdCheck.found) {
      const renamedFileName = generateFacturaFileName(factura, documentType);
      const updateRow = buildFacturaRowFormatted(factura, documentType, renamedFileName);

      // ADV-307 / ADV-362: Preserve match columns from existing row so that MANUAL locks and
      // pagada=SI are never clobbered by a re-extraction of the same file.
      // Use header-derived indices (ADV-362) so schema drift causes a loud failure, not silent
      // carry-forward of the wrong column.
      const existing = fileIdCheck.rowData;
      const col = buildHeaderIndex(fileIdCheck.headerRow.map(h => String(h ?? '')));
      const matchedPagoFileIdIdx = col('matchedPagoFileId');
      const matchConfidenceIdx = col('matchConfidence');
      const hasCuitMatchIdx = col('hasCuitMatch');
      const pagadaIdx = col('pagada');

      if (String(existing[matchConfidenceIdx]) === 'MANUAL') {
        updateRow[matchedPagoFileIdIdx] = existing[matchedPagoFileIdIdx] as CellValueOrLink;
        updateRow[matchConfidenceIdx] = existing[matchConfidenceIdx] as CellValueOrLink;
        updateRow[hasCuitMatchIdx] = existing[hasCuitMatchIdx] as CellValueOrLink;
      }
      if (String(existing[pagadaIdx]) === 'SI') updateRow[pagadaIdx] = 'SI';

      const lastCol = documentType === 'factura_emitida' ? 'U' : 'T';
      const updateResult = await updateRowsWithFormatting(spreadsheetId, [{
        range: `${sheetName}!A${fileIdCheck.rowIndex}:${lastCol}${fileIdCheck.rowIndex}`,
        values: updateRow,
      }], timeZone, context?.metadataCache);
      if (!updateResult.ok) {
        throw updateResult.error;
      }

      info('Factura reprocessed (existing row updated)', {
        module: 'storage',
        phase: 'factura',
        fileId: factura.fileId,
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

    // DUPLICATE CHECK (business key): Use cache if loaded, otherwise API.
    // ADV-297: Check isLoaded() first — an unloaded cache returns isDuplicate:false for
    // every query (fail-open). Only use the cache when preload actually succeeded.
    // documentType drives the importeTotal column index — Facturas Emitidas
    // shifted it to K (10) after ADV-245; Recibidas stays at J (9).
    const dupeCheck = context?.duplicateCache?.isLoaded(spreadsheetId, sheetName)
      ? context.duplicateCache.isDuplicateFactura(
          spreadsheetId,
          sheetName,
          factura.nroFactura,
          factura.fechaEmision,
          factura.importeTotal,
          counterpartyCuit,
          documentType
        )
      : await isDuplicateFactura(
          spreadsheetId,
          sheetName,
          factura.nroFactura,
          factura.fechaEmision,
          factura.importeTotal,
          counterpartyCuit,
          documentType
        );

    if (dupeCheck.isDuplicate) {
      warn('Duplicate factura detected, skipping', {
        module: 'storage',
        phase: 'factura',
        nroFactura: factura.nroFactura,
        fecha: factura.fechaEmision,
        importe: factura.importeTotal,
        existingFileId: dupeCheck.existingFileId,
        newFileId: factura.fileId,
        correlationId: getCorrelationId(),
      });
      return { stored: false, existingFileId: dupeCheck.existingFileId };
    }

    // Calculate the renamed filename that will be used when the file is moved
    const renamedFileName = generateFacturaFileName(factura, documentType);

    // Build row based on document type - only include counterparty info
    const row = buildFacturaRowFormatted(factura, documentType, renamedFileName);
    const range = documentType === 'factura_emitida' ? `${sheetName}!A:U` : `${sheetName}!A:T`;

    const result = await appendRowsWithLinks(spreadsheetId, range, [row], timeZone, context?.metadataCache);
    if (!result.ok) {
      throw result.error;
    }

    // Update cache if available
    context?.duplicateCache?.addEntry(spreadsheetId, sheetName, factura.fileId, row);

    info('Factura stored successfully', {
      module: 'storage',
      phase: 'factura',
      fileId: factura.fileId,
      documentType,
      spreadsheet: sheetName,
      correlationId: getCorrelationId(),
    });

    // Defer sort if context available, otherwise sort immediately
    if (context) {
      // Sort sheet by fechaEmision (column A, index 0) in descending order (most recent first)
      context.sortBatch.addPendingSort(spreadsheetId, sheetName, 0, true);
    } else {
      // Sort sheet by fechaEmision (column A, index 0) in descending order (most recent first)
      const sortResult = await sortSheet(spreadsheetId, sheetName, 0, true);
      if (!sortResult.ok) {
        warn(`Failed to sort sheet ${sheetName}`, {
          module: 'storage',
          phase: 'factura',
          error: sortResult.error.message,
          correlationId: getCorrelationId(),
        });
        // Don't fail the operation if sorting fails
      }
    }

    return { stored: true };
  }, 10000, STORE_LOCK_AUTO_EXPIRY_MS); // 10 s wait; 15 min expiry for crash recovery (ADV-344)
}
