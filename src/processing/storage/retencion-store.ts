/**
 * Storage operations for retenciones (tax withholding certificates)
 * Handles writing retenciones to Control de Ingresos spreadsheet
 */

import type { Result, Retencion } from '../../types/index.js';
import { appendRowsWithLinks, sortSheet, type CellValueOrLink, type CellDate } from '../../services/sheets.js';
import { formatUSCurrency } from '../../utils/numbers.js';
import { info } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

/**
 * Stores a retencion in Control de Ingresos
 *
 * @param retencion - The retencion to store
 * @param spreadsheetId - The Control de Ingresos spreadsheet ID
 */
export async function storeRetencion(
  retencion: Retencion,
  spreadsheetId: string
): Promise<Result<void, Error>> {
  const sheetName = 'Retenciones Recibidas';

  // Create CellDate for proper date formatting
  const fechaEmisionDate: CellDate = { type: 'date', value: retencion.fechaEmision };

  // Build row (columns A:O)
  const row: CellValueOrLink[] = [
    fechaEmisionDate,                          // A - proper date cell
    retencion.fileId,                          // B
    { text: retencion.fileName, url: `https://drive.google.com/file/d/${retencion.fileId}/view` }, // C
    retencion.nroCertificado,                  // D
    retencion.cuitAgenteRetencion,             // E
    retencion.razonSocialAgenteRetencion,      // F
    retencion.impuesto,                        // G
    retencion.regimen,                         // H
    formatUSCurrency(retencion.montoComprobante), // I
    formatUSCurrency(retencion.montoRetencion),   // J
    retencion.processedAt,                     // K
    retencion.confidence,                      // L
    retencion.needsReview ? 'YES' : 'NO',      // M
    retencion.matchedFacturaFileId || '',      // N
    retencion.matchConfidence || '',           // O
  ];

  const range = `${sheetName}!A:O`;

  const correlationId = getCorrelationId();
  info('Storing retencion', {
    module: 'retencion-store',
    phase: 'store',
    correlationId,
    fileId: retencion.fileId,
    nroCertificado: retencion.nroCertificado,
    spreadsheetId,
    sheetName
  });

  try {
    await appendRowsWithLinks(spreadsheetId, range, [row]);

    info('Retencion stored successfully', {
      module: 'retencion-store',
      phase: 'store-complete',
      correlationId,
      fileId: retencion.fileId,
      nroCertificado: retencion.nroCertificado
    });

    // Sort sheet by fechaEmision (column A) in descending order
    await sortSheet(spreadsheetId, sheetName, 0, true);

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
