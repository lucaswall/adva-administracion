/**
 * Storage operations for recibos
 * Handles writing recibos to Control de Egresos spreadsheet
 */

import type { Result, Recibo } from '../../types/index.js';
import { appendRowsWithLinks, sortSheet, type CellValueOrLink, type CellDate } from '../../services/sheets.js';
import { formatUSCurrency } from '../../utils/numbers.js';
import { generateReciboFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

/**
 * Stores a recibo in the Control de Egresos spreadsheet
 *
 * @param recibo - The recibo to store
 * @param spreadsheetId - The Control de Egresos spreadsheet ID
 */
export async function storeRecibo(
  recibo: Recibo,
  spreadsheetId: string
): Promise<Result<void, Error>> {
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

  const result = await appendRowsWithLinks(spreadsheetId, 'Recibos!A:R', [row]);
  if (!result.ok) {
    return result;
  }

  info('Recibo stored successfully', {
    module: 'storage',
    phase: 'recibo',
    fileId: recibo.fileId,
    correlationId: getCorrelationId(),
  });

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

  return { ok: true, value: undefined };
}
