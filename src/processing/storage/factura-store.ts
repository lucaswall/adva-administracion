/**
 * Storage operations for facturas
 * Handles writing facturas to Control de Ingresos/Egresos spreadsheets
 */

import type { Result, Factura, StoreResult } from '../../types/index.js';
import { appendRowsWithLinks, sortSheet, getValues, type CellValueOrLink } from '../../services/sheets.js';
import { formatUSCurrency, parseNumber } from '../../utils/numbers.js';
import { generateFacturaFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

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
  cuit: string
): Promise<{ isDuplicate: boolean; existingFileId?: string }> {
  const rowsResult = await getValues(spreadsheetId, `${sheetName}!A:J`);
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 10) continue;

    const rowFecha = row[0];        // Column A: fechaEmision
    const rowFileId = row[1];       // Column B: fileId
    const rowNroFactura = row[4];   // Column E: nroFactura
    const rowCuit = row[5];         // Column F: cuitReceptor/cuitEmisor
    const rowImporteStr = row[9];   // Column J: importeTotal

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
 */
export async function storeFactura(
  factura: Factura,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'factura_emitida' | 'factura_recibida'
): Promise<Result<StoreResult, Error>> {
  // Check for duplicates
  const counterpartyCuit = documentType === 'factura_emitida'
    ? (factura.cuitReceptor || '')
    : (factura.cuitEmisor || '');

  const dupeCheck = await isDuplicateFactura(
    spreadsheetId,
    sheetName,
    factura.nroFactura,
    factura.fechaEmision,
    factura.importeTotal,
    counterpartyCuit
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
    return { ok: true, value: { stored: false, existingFileId: dupeCheck.existingFileId } };
  }

  // Calculate the renamed filename that will be used when the file is moved
  const renamedFileName = generateFacturaFileName(factura, documentType);

  // Build row based on document type - only include counterparty info
  let row: CellValueOrLink[];
  let range: string;

  if (documentType === 'factura_emitida') {
    // Facturas Emitidas: Only receptor info (columns A:R)
    row = [
      factura.fechaEmision,                 // A
      factura.fileId,                       // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${factura.fileId}/view` }, // C
      factura.tipoComprobante,              // D
      factura.nroFactura,                   // E
      factura.cuitReceptor || '',           // F - counterparty
      factura.razonSocialReceptor || '',    // G - counterparty
      formatUSCurrency(factura.importeNeto), // H
      formatUSCurrency(factura.importeIva),  // I
      formatUSCurrency(factura.importeTotal),// J
      factura.moneda,                       // K
      factura.concepto || '',               // L
      factura.processedAt,                  // M
      factura.confidence,                   // N
      factura.needsReview ? 'YES' : 'NO',   // O
      factura.matchedPagoFileId || '',      // P
      factura.matchConfidence || '',        // Q
      factura.hasCuitMatch ? 'YES' : 'NO',  // R
    ];
    range = `${sheetName}!A:R`;
  } else {
    // Facturas Recibidas: Only emisor info (columns A:S)
    row = [
      factura.fechaEmision,                 // A
      factura.fileId,                       // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${factura.fileId}/view` }, // C
      factura.tipoComprobante,              // D
      factura.nroFactura,                   // E
      factura.cuitEmisor || '',             // F - counterparty
      factura.razonSocialEmisor || '',      // G - counterparty
      formatUSCurrency(factura.importeNeto), // H
      formatUSCurrency(factura.importeIva),  // I
      formatUSCurrency(factura.importeTotal),// J
      factura.moneda,                       // K
      factura.concepto || '',               // L
      factura.processedAt,                  // M
      factura.confidence,                   // N
      factura.needsReview ? 'YES' : 'NO',   // O
      factura.matchedPagoFileId || '',      // P
      factura.matchConfidence || '',        // Q
      factura.hasCuitMatch ? 'YES' : 'NO',  // R
      '',                                   // S - pagada (initially empty)
    ];
    range = `${sheetName}!A:S`;
  }

  const result = await appendRowsWithLinks(spreadsheetId, range, [row]);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  info('Factura stored successfully', {
    module: 'storage',
    phase: 'factura',
    fileId: factura.fileId,
    documentType,
    spreadsheet: sheetName,
    correlationId: getCorrelationId(),
  });

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

  return { ok: true, value: { stored: true } };
}
