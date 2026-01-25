/**
 * Storage operations for retenciones (tax withholding certificates)
 * Handles writing retenciones to Control de Ingresos spreadsheet
 */

import type { Result, Retencion } from '../../types/index.js';
import { appendRowsWithLinks, sortSheet, getSpreadsheetTimezone, getValues, type CellValueOrLink, type CellDate } from '../../services/sheets.js';
import { formatUSCurrency, parseNumber } from '../../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

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
 */
export async function storeRetencion(
  retencion: Retencion,
  spreadsheetId: string
): Promise<Result<{ stored: boolean; existingFileId?: string }, Error>> {
  const sheetName = 'Retenciones Recibidas';
  const correlationId = getCorrelationId();

  // Check for duplicates
  const dupeCheck = await isDuplicateRetencion(
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
    return { ok: true, value: { stored: false, existingFileId: dupeCheck.existingFileId } };
  }

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
    // Get spreadsheet timezone for proper timestamp formatting
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    await appendRowsWithLinks(spreadsheetId, range, [row], timeZone);

    info('Retencion stored successfully', {
      module: 'retencion-store',
      phase: 'store-complete',
      correlationId,
      fileId: retencion.fileId,
      nroCertificado: retencion.nroCertificado
    });

    // Sort sheet by fechaEmision (column A) in descending order
    await sortSheet(spreadsheetId, sheetName, 0, true);

    return { ok: true, value: { stored: true } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
