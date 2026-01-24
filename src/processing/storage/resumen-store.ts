/**
 * Storage operations for resumenes bancarios
 * Handles writing bank statements to Control de Resumenes spreadsheets
 */

import type { Result, ResumenBancario, StoreResult } from '../../types/index.js';
import { appendRowsWithLinks, sortSheet, getValues, type CellValueOrLink, type CellDate } from '../../services/sheets.js';
import { generateResumenFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

/**
 * Checks if a resumen already exists in the sheet
 * Duplicate key: (banco, fechaDesde, fechaHasta, numeroCuenta, moneda)
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param resumen - The resumen to check
 * @returns Duplicate check result
 */
async function isDuplicateResumen(
  spreadsheetId: string,
  resumen: ResumenBancario
): Promise<{ isDuplicate: boolean; existingFileId?: string }> {
  const rowsResult = await getValues(spreadsheetId, 'Resumenes!A:I');
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 7) continue;

    // Columns: fechaDesde, fechaHasta, fileId, fileName, banco, numeroCuenta, moneda, saldoInicial, saldoFinal
    const rowFechaDesde = row[0];    // Column A: fechaDesde (serial number or date string)
    const rowFechaHasta = row[1];    // Column B: fechaHasta (serial number or date string)
    const rowFileId = row[2];        // Column C: fileId
    const rowBanco = row[4];         // Column E: banco
    const rowNumeroCuenta = row[5];  // Column F: numeroCuenta
    const rowMoneda = row[6];        // Column G: moneda

    // Convert serial numbers to date strings for comparison (if needed)
    const rowFechaDesdeStr = typeof rowFechaDesde === 'number'
      ? serialToDateString(rowFechaDesde)
      : String(rowFechaDesde);
    const rowFechaHastaStr = typeof rowFechaHasta === 'number'
      ? serialToDateString(rowFechaHasta)
      : String(rowFechaHasta);

    // Match on all 5 fields
    if (rowBanco === resumen.banco &&
        rowFechaDesdeStr === resumen.fechaDesde &&
        rowFechaHastaStr === resumen.fechaHasta &&
        rowNumeroCuenta === resumen.numeroCuenta &&
        rowMoneda === resumen.moneda) {
      return { isDuplicate: true, existingFileId: String(rowFileId) };
    }
  }
  return { isDuplicate: false };
}

/**
 * Converts a Google Sheets serial number to date string (yyyy-mm-dd)
 * Google Sheets uses December 30, 1899 as day 0 (epoch)
 */
function serialToDateString(serial: number): string {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(epoch.getTime() + serial * 24 * 60 * 60 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Stores a resumen bancario in the Control de Resumenes spreadsheet
 *
 * @param resumen - The resumen to store
 * @param spreadsheetId - The Control de Resumenes spreadsheet ID
 * @returns Store result indicating if stored or duplicate
 */
export async function storeResumen(
  resumen: ResumenBancario,
  spreadsheetId: string
): Promise<Result<StoreResult, Error>> {
  // Check for duplicates
  const dupeCheck = await isDuplicateResumen(spreadsheetId, resumen);

  if (dupeCheck.isDuplicate) {
    warn('Duplicate resumen detected, skipping', {
      module: 'storage',
      phase: 'resumen',
      banco: resumen.banco,
      numeroCuenta: resumen.numeroCuenta,
      fechaDesde: resumen.fechaDesde,
      fechaHasta: resumen.fechaHasta,
      existingFileId: dupeCheck.existingFileId,
      newFileId: resumen.fileId,
      correlationId: getCorrelationId(),
    });

    return {
      ok: true,
      value: {
        stored: false,
        existingFileId: dupeCheck.existingFileId,
      },
    };
  }

  // Build the row with CellDate for proper date formatting
  const fileName = generateResumenFileName(resumen);
  const fechaDesdeDate: CellDate = { type: 'date', value: resumen.fechaDesde };
  const fechaHastaDate: CellDate = { type: 'date', value: resumen.fechaHasta };

  const row: CellValueOrLink[] = [
    fechaDesdeDate,   // proper date cell
    fechaHastaDate,   // proper date cell
    resumen.fileId,
    {
      text: fileName,
      url: `https://drive.google.com/file/d/${resumen.fileId}/view`,
    },
    resumen.banco,
    resumen.numeroCuenta,
    resumen.moneda,
    resumen.saldoInicial,
    resumen.saldoFinal,
  ];

  // Append the row
  const appendResult = await appendRowsWithLinks(
    spreadsheetId,
    'Resumenes!A:I',
    [row]
  );

  if (!appendResult.ok) {
    return appendResult;
  }

  info('Stored resumen bancario', {
    module: 'storage',
    phase: 'resumen',
    banco: resumen.banco,
    numeroCuenta: resumen.numeroCuenta,
    fechaDesde: resumen.fechaDesde,
    fechaHasta: resumen.fechaHasta,
    fileId: resumen.fileId,
    correlationId: getCorrelationId(),
  });

  // Sort by fechaDesde (column 0) ascending (oldest first)
  const sortResult = await sortSheet(spreadsheetId, 'Resumenes', 0, false);
  if (!sortResult.ok) {
    warn('Failed to sort Resumenes sheet', {
      module: 'storage',
      phase: 'resumen',
      error: sortResult.error.message,
      correlationId: getCorrelationId(),
    });
    // Don't fail the operation if sort fails
  }

  return {
    ok: true,
    value: {
      stored: true,
    },
  };
}
