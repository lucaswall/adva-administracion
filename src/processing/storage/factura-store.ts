/**
 * Storage operations for facturas
 * Handles writing facturas to Control de Creditos/Debitos spreadsheets
 */

import type { Result, Factura } from '../../types/index.js';
import { appendRowsWithLinks, sortSheet, type CellValueOrLink } from '../../services/sheets.js';
import { formatUSCurrency } from '../../utils/numbers.js';
import { generateFacturaFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

/**
 * Stores a factura in the appropriate Control spreadsheet
 *
 * @param factura - The factura to store
 * @param spreadsheetId - The spreadsheet ID (Control de Creditos or Control de Debitos)
 * @param sheetName - The sheet name ('Facturas Emitidas' or 'Facturas Recibidas')
 * @param documentType - The document type for filename generation
 */
export async function storeFactura(
  factura: Factura,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'factura_emitida' | 'factura_recibida'
): Promise<Result<void, Error>> {
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
    return result;
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

  return { ok: true, value: undefined };
}
