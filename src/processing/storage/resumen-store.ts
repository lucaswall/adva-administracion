/**
 * Storage operations for resumenes (bank accounts, credit cards, brokers)
 * Handles writing statements to Control de Resumenes spreadsheets
 */

import type { Result, ResumenBancario, ResumenTarjeta, ResumenBroker, StoreResult } from '../../types/index.js';
import { appendRowsWithLinks, sortSheet, getValues, type CellValueOrLink, type CellDate } from '../../services/sheets.js';
import { generateResumenFileName, generateResumenTarjetaFileName, generateResumenBrokerFileName } from '../../utils/file-naming.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

/**
 * Checks if a bank account resumen already exists in the sheet
 * Duplicate key: (banco, numeroCuenta, fechaDesde, fechaHasta, moneda)
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param resumen - The resumen to check
 * @returns Duplicate check result
 */
async function isDuplicateResumenBancario(
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
    const rowFechaDesde = row[0];
    const rowFechaHasta = row[1];
    const rowFileId = row[2];
    const rowBanco = row[4];
    const rowNumeroCuenta = row[5];
    const rowMoneda = row[6];

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
 * Checks if a credit card resumen already exists in the sheet
 * Duplicate key: (banco, tipoTarjeta, numeroCuenta, fechaDesde, fechaHasta)
 */
async function isDuplicateResumenTarjeta(
  spreadsheetId: string,
  resumen: ResumenTarjeta
): Promise<{ isDuplicate: boolean; existingFileId?: string }> {
  const rowsResult = await getValues(spreadsheetId, 'Resumenes!A:I');
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 7) continue;

    // Columns: fechaDesde, fechaHasta, fileId, fileName, banco, numeroCuenta, tipoTarjeta, pagoMinimo, saldoActual
    const rowFechaDesde = row[0];
    const rowFechaHasta = row[1];
    const rowFileId = row[2];
    const rowBanco = row[4];
    const rowNumeroCuenta = row[5];
    const rowTipoTarjeta = row[6];

    const rowFechaDesdeStr = typeof rowFechaDesde === 'number'
      ? serialToDateString(rowFechaDesde)
      : String(rowFechaDesde);
    const rowFechaHastaStr = typeof rowFechaHasta === 'number'
      ? serialToDateString(rowFechaHasta)
      : String(rowFechaHasta);

    if (rowBanco === resumen.banco &&
        rowFechaDesdeStr === resumen.fechaDesde &&
        rowFechaHastaStr === resumen.fechaHasta &&
        rowNumeroCuenta === resumen.numeroCuenta &&
        rowTipoTarjeta === resumen.tipoTarjeta) {
      return { isDuplicate: true, existingFileId: String(rowFileId) };
    }
  }
  return { isDuplicate: false };
}

/**
 * Checks if a broker resumen already exists in the sheet
 * Duplicate key: (broker, numeroCuenta, fechaDesde, fechaHasta)
 */
async function isDuplicateResumenBroker(
  spreadsheetId: string,
  resumen: ResumenBroker
): Promise<{ isDuplicate: boolean; existingFileId?: string }> {
  const rowsResult = await getValues(spreadsheetId, 'Resumenes!A:H');
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 6) continue;

    // Columns: fechaDesde, fechaHasta, fileId, fileName, broker, numeroCuenta, saldoARS, saldoUSD
    const rowFechaDesde = row[0];
    const rowFechaHasta = row[1];
    const rowFileId = row[2];
    const rowBroker = row[4];
    const rowNumeroCuenta = row[5];

    const rowFechaDesdeStr = typeof rowFechaDesde === 'number'
      ? serialToDateString(rowFechaDesde)
      : String(rowFechaDesde);
    const rowFechaHastaStr = typeof rowFechaHasta === 'number'
      ? serialToDateString(rowFechaHasta)
      : String(rowFechaHasta);

    if (rowBroker === resumen.broker &&
        rowFechaDesdeStr === resumen.fechaDesde &&
        rowFechaHastaStr === resumen.fechaHasta &&
        rowNumeroCuenta === resumen.numeroCuenta) {
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
 * Stores a bank account resumen in the Control de Resumenes spreadsheet
 *
 * @param resumen - The resumen to store
 * @param spreadsheetId - The Control de Resumenes spreadsheet ID
 * @returns Store result indicating if stored or duplicate
 */
export async function storeResumenBancario(
  resumen: ResumenBancario,
  spreadsheetId: string
): Promise<Result<StoreResult, Error>> {
  // Check for duplicates
  const dupeCheck = await isDuplicateResumenBancario(spreadsheetId, resumen);

  if (dupeCheck.isDuplicate) {
    warn('Duplicate bank account resumen detected, skipping', {
      module: 'storage',
      phase: 'resumen-bancario',
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
    fechaDesdeDate,
    fechaHastaDate,
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

  info('Stored bank account resumen', {
    module: 'storage',
    phase: 'resumen-bancario',
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
      phase: 'resumen-bancario',
      error: sortResult.error.message,
      correlationId: getCorrelationId(),
    });
  }

  return {
    ok: true,
    value: {
      stored: true,
    },
  };
}

/**
 * Stores a credit card resumen in the Control de Resumenes spreadsheet
 *
 * @param resumen - The resumen to store
 * @param spreadsheetId - The Control de Resumenes spreadsheet ID
 * @returns Store result indicating if stored or duplicate
 */
export async function storeResumenTarjeta(
  resumen: ResumenTarjeta,
  spreadsheetId: string
): Promise<Result<StoreResult, Error>> {
  // Check for duplicates
  const dupeCheck = await isDuplicateResumenTarjeta(spreadsheetId, resumen);

  if (dupeCheck.isDuplicate) {
    warn('Duplicate credit card resumen detected, skipping', {
      module: 'storage',
      phase: 'resumen-tarjeta',
      banco: resumen.banco,
      tipoTarjeta: resumen.tipoTarjeta,
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
  const fileName = generateResumenTarjetaFileName(resumen);
  const fechaDesdeDate: CellDate = { type: 'date', value: resumen.fechaDesde };
  const fechaHastaDate: CellDate = { type: 'date', value: resumen.fechaHasta };

  const row: CellValueOrLink[] = [
    fechaDesdeDate,
    fechaHastaDate,
    resumen.fileId,
    {
      text: fileName,
      url: `https://drive.google.com/file/d/${resumen.fileId}/view`,
    },
    resumen.banco,
    resumen.numeroCuenta,
    resumen.tipoTarjeta,
    resumen.pagoMinimo,
    resumen.saldoActual,
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

  info('Stored credit card resumen', {
    module: 'storage',
    phase: 'resumen-tarjeta',
    banco: resumen.banco,
    tipoTarjeta: resumen.tipoTarjeta,
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
      phase: 'resumen-tarjeta',
      error: sortResult.error.message,
      correlationId: getCorrelationId(),
    });
  }

  return {
    ok: true,
    value: {
      stored: true,
    },
  };
}

/**
 * Stores a broker resumen in the Control de Resumenes spreadsheet
 *
 * @param resumen - The resumen to store
 * @param spreadsheetId - The Control de Resumenes spreadsheet ID
 * @returns Store result indicating if stored or duplicate
 */
export async function storeResumenBroker(
  resumen: ResumenBroker,
  spreadsheetId: string
): Promise<Result<StoreResult, Error>> {
  // Check for duplicates
  const dupeCheck = await isDuplicateResumenBroker(spreadsheetId, resumen);

  if (dupeCheck.isDuplicate) {
    warn('Duplicate broker resumen detected, skipping', {
      module: 'storage',
      phase: 'resumen-broker',
      broker: resumen.broker,
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
  const fileName = generateResumenBrokerFileName(resumen);
  const fechaDesdeDate: CellDate = { type: 'date', value: resumen.fechaDesde };
  const fechaHastaDate: CellDate = { type: 'date', value: resumen.fechaHasta };

  const row: CellValueOrLink[] = [
    fechaDesdeDate,
    fechaHastaDate,
    resumen.fileId,
    {
      text: fileName,
      url: `https://drive.google.com/file/d/${resumen.fileId}/view`,
    },
    resumen.broker,
    resumen.numeroCuenta,
    resumen.saldoARS ?? '',  // Optional - empty string if not present
    resumen.saldoUSD ?? '',  // Optional - empty string if not present
  ];

  // Append the row
  const appendResult = await appendRowsWithLinks(
    spreadsheetId,
    'Resumenes!A:H',
    [row]
  );

  if (!appendResult.ok) {
    return appendResult;
  }

  info('Stored broker resumen', {
    module: 'storage',
    phase: 'resumen-broker',
    broker: resumen.broker,
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
      phase: 'resumen-broker',
      error: sortResult.error.message,
      correlationId: getCorrelationId(),
    });
  }

  return {
    ok: true,
    value: {
      stored: true,
    },
  };
}
