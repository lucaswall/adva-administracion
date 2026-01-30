/**
 * Storage operations for resumenes (bank accounts, credit cards, brokers)
 * Handles writing statements to Control de Resumenes spreadsheets
 */

import type { Result, ResumenBancario, ResumenTarjeta, ResumenBroker, StoreResult } from '../../types/index.js';
import type { ScanContext } from '../scanner.js';
import { appendRowsWithLinks, sortSheet, getValues, getSpreadsheetTimezone, type CellValueOrLink, type CellDate, type CellNumber } from '../../services/sheets.js';
import { generateResumenFileName, generateResumenTarjetaFileName, generateResumenBrokerFileName } from '../../utils/file-naming.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withLock } from '../../utils/concurrency.js';

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
  const rowsResult = await getValues(spreadsheetId, 'Resumenes!A:J');
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 8) continue;

    // Columns: periodo, fechaDesde, fechaHasta, fileId, fileName, banco, numeroCuenta, moneda, saldoInicial, saldoFinal
    const rowFechaDesde = row[1];
    const rowFechaHasta = row[2];
    const rowFileId = row[3];
    const rowBanco = row[5];
    const rowNumeroCuenta = row[6];
    const rowMoneda = row[7];

    // Convert serial numbers to date strings for comparison
    const rowFechaDesdeStr = normalizeSpreadsheetDate(rowFechaDesde);
    const rowFechaHastaStr = normalizeSpreadsheetDate(rowFechaHasta);

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
  const rowsResult = await getValues(spreadsheetId, 'Resumenes!A:J');
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 8) continue;

    // Columns: periodo, fechaDesde, fechaHasta, fileId, fileName, banco, numeroCuenta, tipoTarjeta, pagoMinimo, saldoActual
    const rowFechaDesde = row[1];
    const rowFechaHasta = row[2];
    const rowFileId = row[3];
    const rowBanco = row[5];
    const rowNumeroCuenta = row[6];
    const rowTipoTarjeta = row[7];

    const rowFechaDesdeStr = normalizeSpreadsheetDate(rowFechaDesde);
    const rowFechaHastaStr = normalizeSpreadsheetDate(rowFechaHasta);

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
  const rowsResult = await getValues(spreadsheetId, 'Resumenes!A:I');
  if (!rowsResult.ok || rowsResult.value.length <= 1) {
    return { isDuplicate: false };
  }

  // Skip header row
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 7) continue;

    // Columns: periodo, fechaDesde, fechaHasta, fileId, fileName, broker, numeroCuenta, saldoARS, saldoUSD
    const rowFechaDesde = row[1];
    const rowFechaHasta = row[2];
    const rowFileId = row[3];
    const rowBroker = row[5];
    const rowNumeroCuenta = row[6];

    const rowFechaDesdeStr = normalizeSpreadsheetDate(rowFechaDesde);
    const rowFechaHastaStr = normalizeSpreadsheetDate(rowFechaHasta);

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
 * Stores a bank account resumen in the Control de Resumenes spreadsheet
 *
 * @param resumen - The resumen to store
 * @param spreadsheetId - The Control de Resumenes spreadsheet ID
 * @param context - Optional scan context for cache optimization
 * @returns Store result indicating if stored or duplicate
 */
export async function storeResumenBancario(
  resumen: ResumenBancario,
  spreadsheetId: string,
  context?: ScanContext
): Promise<Result<StoreResult, Error>> {
  // Create lock key from business key (prevents concurrent identical stores)
  const lockKey = `store:resumen-bancario:${resumen.banco}:${resumen.numeroCuenta}:${resumen.fechaDesde}:${resumen.fechaHasta}:${resumen.moneda}`;

  return withLock(lockKey, async () => {
    // Always use API-based check for resumenes (bank sheets not pre-loaded in cache)
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
        stored: false,
        existingFileId: dupeCheck.existingFileId,
      };
    }

    // Build the row with CellDate for proper date formatting and CellNumber for monetary values
    const fileName = generateResumenFileName(resumen);
    const periodo = resumen.fechaHasta.substring(0, 7); // YYYY-MM-DD -> YYYY-MM
    const fechaDesdeDate: CellDate = { type: 'date', value: resumen.fechaDesde };
    const fechaHastaDate: CellDate = { type: 'date', value: resumen.fechaHasta };
    const saldoInicialNum: CellNumber = { type: 'number', value: resumen.saldoInicial };
    const saldoFinalNum: CellNumber = { type: 'number', value: resumen.saldoFinal };

    const row: CellValueOrLink[] = [
      periodo,
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
      saldoInicialNum,
      saldoFinalNum,
    ];

    // Get spreadsheet timezone for proper timestamp formatting
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    // Append the row
    const appendResult = await appendRowsWithLinks(
      spreadsheetId,
      'Resumenes!A:J',
      [row],
      timeZone,
      context?.metadataCache
    );

    if (!appendResult.ok) {
      throw appendResult.error;
    }

    // Update cache if available
    context?.duplicateCache?.addEntry(spreadsheetId, 'Resumenes', resumen.fileId, row);

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

    // Defer sort if context available, otherwise sort immediately
    if (context) {
      // Sort by periodo (column 0) ascending (oldest first)
      context.sortBatch.addPendingSort(spreadsheetId, 'Resumenes', 0, false);
    } else {
      // Sort by periodo (column 0) ascending (oldest first)
      const sortResult = await sortSheet(spreadsheetId, 'Resumenes', 0, false);
      if (!sortResult.ok) {
        warn('Failed to sort Resumenes sheet', {
          module: 'storage',
          phase: 'resumen-bancario',
          error: sortResult.error.message,
          correlationId: getCorrelationId(),
        });
      }
    }

    return {
      stored: true,
    };
  }, 10000); // 10 second timeout for lock
}

/**
 * Stores a credit card resumen in the Control de Resumenes spreadsheet
 *
 * @param resumen - The resumen to store
 * @param spreadsheetId - The Control de Resumenes spreadsheet ID
 * @param context - Optional scan context for cache optimization
 * @returns Store result indicating if stored or duplicate
 */
export async function storeResumenTarjeta(
  resumen: ResumenTarjeta,
  spreadsheetId: string,
  context?: ScanContext
): Promise<Result<StoreResult, Error>> {
  // Create lock key from business key (prevents concurrent identical stores)
  const lockKey = `store:resumen-tarjeta:${resumen.banco}:${resumen.tipoTarjeta}:${resumen.numeroCuenta}:${resumen.fechaDesde}:${resumen.fechaHasta}`;

  return withLock(lockKey, async () => {
    // Always use API-based check for resumenes (bank sheets not pre-loaded in cache)
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
        stored: false,
        existingFileId: dupeCheck.existingFileId,
      };
    }

    // Build the row with CellDate for proper date formatting and CellNumber for monetary values
    const fileName = generateResumenTarjetaFileName(resumen);
    const periodo = resumen.fechaHasta.substring(0, 7); // YYYY-MM-DD -> YYYY-MM
    const fechaDesdeDate: CellDate = { type: 'date', value: resumen.fechaDesde };
    const fechaHastaDate: CellDate = { type: 'date', value: resumen.fechaHasta };
    const pagoMinimoNum: CellNumber = { type: 'number', value: resumen.pagoMinimo };
    const saldoActualNum: CellNumber = { type: 'number', value: resumen.saldoActual };

    const row: CellValueOrLink[] = [
      periodo,
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
      pagoMinimoNum,
      saldoActualNum,
    ];

    // Get spreadsheet timezone for proper timestamp formatting
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    // Append the row
    const appendResult = await appendRowsWithLinks(
      spreadsheetId,
      'Resumenes!A:J',
      [row],
      timeZone,
      context?.metadataCache
    );

    if (!appendResult.ok) {
      throw appendResult.error;
    }

    // Update cache if available
    context?.duplicateCache?.addEntry(spreadsheetId, 'Resumenes', resumen.fileId, row);

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

    // Defer sort if context available, otherwise sort immediately
    if (context) {
      // Sort by periodo (column 0) ascending (oldest first)
      context.sortBatch.addPendingSort(spreadsheetId, 'Resumenes', 0, false);
    } else {
      // Sort by periodo (column 0) ascending (oldest first)
      const sortResult = await sortSheet(spreadsheetId, 'Resumenes', 0, false);
      if (!sortResult.ok) {
        warn('Failed to sort Resumenes sheet', {
          module: 'storage',
          phase: 'resumen-tarjeta',
          error: sortResult.error.message,
          correlationId: getCorrelationId(),
        });
      }
    }

    return {
      stored: true,
    };
  }, 10000); // 10 second timeout for lock
}

/**
 * Stores a broker resumen in the Control de Resumenes spreadsheet
 *
 * @param resumen - The resumen to store
 * @param spreadsheetId - The Control de Resumenes spreadsheet ID
 * @param context - Optional scan context for cache optimization
 * @returns Store result indicating if stored or duplicate
 */
export async function storeResumenBroker(
  resumen: ResumenBroker,
  spreadsheetId: string,
  context?: ScanContext
): Promise<Result<StoreResult, Error>> {
  // Create lock key from business key (prevents concurrent identical stores)
  const lockKey = `store:resumen-broker:${resumen.broker}:${resumen.numeroCuenta}:${resumen.fechaDesde}:${resumen.fechaHasta}`;

  return withLock(lockKey, async () => {
    // Always use API-based check for resumenes (bank sheets not pre-loaded in cache)
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
        stored: false,
        existingFileId: dupeCheck.existingFileId,
      };
    }

    // Build the row with CellDate for proper date formatting and CellNumber for monetary values
    const fileName = generateResumenBrokerFileName(resumen);
    const periodo = resumen.fechaHasta.substring(0, 7); // YYYY-MM-DD -> YYYY-MM
    const fechaDesdeDate: CellDate = { type: 'date', value: resumen.fechaDesde };
    const fechaHastaDate: CellDate = { type: 'date', value: resumen.fechaHasta };

    // Build CellNumber for optional saldos, or empty string if not present
    const saldoARSValue: CellNumber | '' = resumen.saldoARS !== undefined
      ? { type: 'number', value: resumen.saldoARS }
      : '';
    const saldoUSDValue: CellNumber | '' = resumen.saldoUSD !== undefined
      ? { type: 'number', value: resumen.saldoUSD }
      : '';

    const row: CellValueOrLink[] = [
      periodo,
      fechaDesdeDate,
      fechaHastaDate,
      resumen.fileId,
      {
        text: fileName,
        url: `https://drive.google.com/file/d/${resumen.fileId}/view`,
      },
      resumen.broker,
      resumen.numeroCuenta,
      saldoARSValue,
      saldoUSDValue,
    ];

    // Get spreadsheet timezone for proper timestamp formatting
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    // Append the row
    const appendResult = await appendRowsWithLinks(
      spreadsheetId,
      'Resumenes!A:I',
      [row],
      timeZone,
      context?.metadataCache
    );

    if (!appendResult.ok) {
      throw appendResult.error;
    }

    // Update cache if available
    context?.duplicateCache?.addEntry(spreadsheetId, 'Resumenes', resumen.fileId, row);

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

    // Defer sort if context available, otherwise sort immediately
    if (context) {
      // Sort by periodo (column 0) ascending (oldest first)
      context.sortBatch.addPendingSort(spreadsheetId, 'Resumenes', 0, false);
    } else {
      // Sort by periodo (column 0) ascending (oldest first)
      const sortResult = await sortSheet(spreadsheetId, 'Resumenes', 0, false);
      if (!sortResult.ok) {
        warn('Failed to sort Resumenes sheet', {
          module: 'storage',
          phase: 'resumen-broker',
          error: sortResult.error.message,
          correlationId: getCorrelationId(),
        });
      }
    }

    return {
      stored: true,
    };
  }, 10000); // 10 second timeout for lock
}
