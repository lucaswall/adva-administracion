/**
 * Storage operations for movimientos (individual transactions)
 * Handles writing transactions to per-month sheets in Movimientos spreadsheets
 */

import type { Result, MovimientoBancario, MovimientoTarjeta, MovimientoBroker } from '../../types/index.js';
import { getOrCreateMonthSheet, formatEmptyMonthSheet, appendRowsWithLinks, type CellDate, type CellNumber } from '../../services/sheets.js';
import { MOVIMIENTOS_BANCARIO_SHEET, MOVIMIENTOS_TARJETA_SHEET, MOVIMIENTOS_BROKER_SHEET } from '../../constants/spreadsheet-headers.js';
import { info } from '../../utils/logger.js';

/**
 * Stores bank account transactions to Movimientos spreadsheet
 * All transactions are stored in the resumen's month (from fechaHasta)
 *
 * @param movimientos - Array of bank transactions
 * @param spreadsheetId - Movimientos spreadsheet ID
 * @param period - Statement period (determines target month via fechaHasta)
 * @returns Success/failure result
 */
export async function storeMovimientosBancario(
  movimientos: MovimientoBancario[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string }
): Promise<Result<void, Error>> {
  try {
    // Target month is determined by resumen's fechaHasta
    const targetMonth = period.fechaHasta.substring(0, 7);

    // Get or create the target month sheet
    const sheetResult = await getOrCreateMonthSheet(
      spreadsheetId,
      targetMonth,
      MOVIMIENTOS_BANCARIO_SHEET.headers
    );
    if (!sheetResult.ok) return sheetResult;

    // If no movements, just format the empty sheet
    if (movimientos.length === 0) {
      const formatResult = await formatEmptyMonthSheet(
        spreadsheetId,
        sheetResult.value,
        MOVIMIENTOS_BANCARIO_SHEET.headers.length
      );
      if (!formatResult.ok) return formatResult;

      info('Created empty month sheet for bank account', {
        module: 'movimientos-store',
        phase: 'store-bancario',
        month: targetMonth
      });

      return { ok: true, value: undefined };
    }

    // Sort all movimientos by fecha (preserving original dates)
    const sorted = [...movimientos].sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
    );

    // Transform to spreadsheet rows
    const rows = sorted.map(mov => [
      { type: 'date', value: mov.fecha } as CellDate,
      mov.origenConcepto,
      mov.debito !== null ? { type: 'number', value: mov.debito } as CellNumber : null,
      mov.credito !== null ? { type: 'number', value: mov.credito } as CellNumber : null,
      { type: 'number', value: mov.saldo } as CellNumber
    ]);

    // Append all rows to target month
    const range = `${targetMonth}!A:E`;
    const appendResult = await appendRowsWithLinks(spreadsheetId, range, rows);
    if (!appendResult.ok) return { ok: false, error: appendResult.error };

    info('Stored bank account movimientos', {
      module: 'movimientos-store',
      phase: 'store-bancario',
      month: targetMonth,
      count: sorted.length
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Stores credit card transactions to Movimientos spreadsheet
 * All transactions are stored in the resumen's month (from fechaHasta)
 *
 * @param movimientos - Array of credit card transactions
 * @param spreadsheetId - Movimientos spreadsheet ID
 * @param period - Statement period (determines target month via fechaHasta)
 * @returns Success/failure result
 */
export async function storeMovimientosTarjeta(
  movimientos: MovimientoTarjeta[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string }
): Promise<Result<void, Error>> {
  try {
    // Target month is determined by resumen's fechaHasta
    const targetMonth = period.fechaHasta.substring(0, 7);

    // Get or create the target month sheet
    const sheetResult = await getOrCreateMonthSheet(
      spreadsheetId,
      targetMonth,
      MOVIMIENTOS_TARJETA_SHEET.headers
    );
    if (!sheetResult.ok) return sheetResult;

    // If no movements, just format the empty sheet
    if (movimientos.length === 0) {
      const formatResult = await formatEmptyMonthSheet(
        spreadsheetId,
        sheetResult.value,
        MOVIMIENTOS_TARJETA_SHEET.headers.length
      );
      if (!formatResult.ok) return formatResult;

      info('Created empty month sheet for credit card', {
        module: 'movimientos-store',
        phase: 'store-tarjeta',
        month: targetMonth
      });

      return { ok: true, value: undefined };
    }

    // Sort all movimientos by fecha (preserving original dates)
    const sorted = [...movimientos].sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
    );

    // Transform to spreadsheet rows
    const rows = sorted.map(mov => [
      { type: 'date', value: mov.fecha } as CellDate,
      mov.descripcion,
      mov.nroCupon,
      mov.pesos !== null ? { type: 'number', value: mov.pesos } as CellNumber : null,
      mov.dolares !== null ? { type: 'number', value: mov.dolares } as CellNumber : null
    ]);

    // Append all rows to target month
    const range = `${targetMonth}!A:E`;
    const appendResult = await appendRowsWithLinks(spreadsheetId, range, rows);
    if (!appendResult.ok) return { ok: false, error: appendResult.error };

    info('Stored credit card movimientos', {
      module: 'movimientos-store',
      phase: 'store-tarjeta',
      month: targetMonth,
      count: sorted.length
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Stores broker transactions to Movimientos spreadsheet
 * All transactions are stored in the resumen's month (from fechaHasta)
 *
 * @param movimientos - Array of broker transactions
 * @param spreadsheetId - Movimientos spreadsheet ID
 * @param period - Statement period (determines target month via fechaHasta)
 * @returns Success/failure result
 */
export async function storeMovimientosBroker(
  movimientos: MovimientoBroker[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string }
): Promise<Result<void, Error>> {
  try {
    // Target month is determined by resumen's fechaHasta
    const targetMonth = period.fechaHasta.substring(0, 7);

    // Get or create the target month sheet
    const sheetResult = await getOrCreateMonthSheet(
      spreadsheetId,
      targetMonth,
      MOVIMIENTOS_BROKER_SHEET.headers
    );
    if (!sheetResult.ok) return sheetResult;

    // If no movements, just format the empty sheet
    if (movimientos.length === 0) {
      const formatResult = await formatEmptyMonthSheet(
        spreadsheetId,
        sheetResult.value,
        MOVIMIENTOS_BROKER_SHEET.headers.length
      );
      if (!formatResult.ok) return formatResult;

      info('Created empty month sheet for broker', {
        module: 'movimientos-store',
        phase: 'store-broker',
        month: targetMonth
      });

      return { ok: true, value: undefined };
    }

    // Sort all movimientos by fechaConcertacion (preserving original dates)
    const sorted = [...movimientos].sort((a, b) =>
      a.fechaConcertacion.localeCompare(b.fechaConcertacion)
    );

    // Transform to spreadsheet rows
    const rows = sorted.map(mov => [
      mov.descripcion,
      mov.cantidadVN !== null ? { type: 'number', value: mov.cantidadVN } as CellNumber : null,
      { type: 'number', value: mov.saldo } as CellNumber,
      mov.precio !== null ? { type: 'number', value: mov.precio } as CellNumber : null,
      mov.bruto !== null ? { type: 'number', value: mov.bruto } as CellNumber : null,
      mov.arancel !== null ? { type: 'number', value: mov.arancel } as CellNumber : null,
      mov.iva !== null ? { type: 'number', value: mov.iva } as CellNumber : null,
      mov.neto !== null ? { type: 'number', value: mov.neto } as CellNumber : null,
      { type: 'date', value: mov.fechaConcertacion } as CellDate,
      { type: 'date', value: mov.fechaLiquidacion } as CellDate
    ]);

    // Append all rows to target month
    const range = `${targetMonth}!A:J`;
    const appendResult = await appendRowsWithLinks(spreadsheetId, range, rows);
    if (!appendResult.ok) return { ok: false, error: appendResult.error };

    info('Stored broker movimientos', {
      module: 'movimientos-store',
      phase: 'store-broker',
      month: targetMonth,
      count: sorted.length
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
