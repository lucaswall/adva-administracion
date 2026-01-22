/**
 * Storage operations for pagos
 * Handles writing pagos to Control de Creditos/Debitos spreadsheets
 */

import type { Result, Pago } from '../../types/index.js';
import { appendRowsWithLinks, sortSheet, type CellValueOrLink } from '../../services/sheets.js';
import { formatUSCurrency } from '../../utils/numbers.js';
import { generatePagoFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

/**
 * Stores a pago in the appropriate Control spreadsheet
 *
 * @param pago - The pago to store
 * @param spreadsheetId - The spreadsheet ID (Control de Creditos or Control de Debitos)
 * @param sheetName - The sheet name ('Pagos Recibidos' or 'Pagos Enviados')
 * @param documentType - The document type for filename generation
 */
export async function storePago(
  pago: Pago,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'pago_enviado' | 'pago_recibido'
): Promise<Result<void, Error>> {
  // Calculate the renamed filename that will be used when the file is moved
  const renamedFileName = generatePagoFileName(pago, documentType);

  // Build row based on document type - only include counterparty info
  let row: CellValueOrLink[];
  let range: string;

  if (documentType === 'pago_enviado') {
    // Pagos Enviados: Only beneficiario info (columns A:O)
    row = [
      pago.fechaPago,                      // A
      pago.fileId,                         // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${pago.fileId}/view` }, // C
      pago.banco,                          // D
      formatUSCurrency(pago.importePagado),// E
      pago.moneda || 'ARS',                // F
      pago.referencia || '',               // G
      pago.cuitBeneficiario || '',         // H - counterparty
      pago.nombreBeneficiario || '',       // I - counterparty
      pago.concepto || '',                 // J
      pago.processedAt,                    // K
      pago.confidence,                     // L
      pago.needsReview ? 'YES' : 'NO',     // M
      pago.matchedFacturaFileId || '',     // N
      pago.matchConfidence || '',          // O
    ];
    range = `${sheetName}!A:O`;
  } else {
    // Pagos Recibidos: Only pagador info (columns A:O)
    row = [
      pago.fechaPago,                      // A
      pago.fileId,                         // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${pago.fileId}/view` }, // C
      pago.banco,                          // D
      formatUSCurrency(pago.importePagado),// E
      pago.moneda || 'ARS',                // F
      pago.referencia || '',               // G
      pago.cuitPagador || '',              // H - counterparty
      pago.nombrePagador || '',            // I - counterparty
      pago.concepto || '',                 // J
      pago.processedAt,                    // K
      pago.confidence,                     // L
      pago.needsReview ? 'YES' : 'NO',     // M
      pago.matchedFacturaFileId || '',     // N
      pago.matchConfidence || '',          // O
    ];
    range = `${sheetName}!A:O`;
  }

  const result = await appendRowsWithLinks(spreadsheetId, range, [row]);
  if (!result.ok) {
    return result;
  }

  info('Pago stored successfully', {
    module: 'storage',
    phase: 'pago',
    fileId: pago.fileId,
    documentType,
    spreadsheet: sheetName,
    correlationId: getCorrelationId(),
  });

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

  return { ok: true, value: undefined };
}
