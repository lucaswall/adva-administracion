/**
 * Storage operations for movimientos (individual transactions)
 * Handles writing transactions to per-month sheets in Movimientos spreadsheets
 */

import type { Result, MovimientoBancario, MovimientoTarjeta, MovimientoBroker } from '../../types/index.js';
import { getOrCreateMonthSheet, formatEmptyMonthSheet, appendRowsWithLinks, type CellDate, type CellNumber } from '../../services/sheets.js';
import { MOVIMIENTOS_BANCARIO_SHEET, MOVIMIENTOS_TARJETA_SHEET, MOVIMIENTOS_BROKER_SHEET } from '../../constants/spreadsheet-headers.js';
import { info } from '../../utils/logger.js';

/**
 * Groups movimientos by month (YYYY-MM format)
 */
function groupByMonth<T extends { fecha: string }>(movimientos: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const mov of movimientos) {
    const month = mov.fecha.substring(0, 7); // Extract YYYY-MM
    const existing = groups.get(month) || [];
    existing.push(mov);
    groups.set(month, existing);
  }

  return groups;
}

/**
 * Stores bank account transactions to Movimientos spreadsheet
 * Groups transactions by month and creates per-month sheets
 *
 * @param movimientos - Array of bank transactions
 * @param spreadsheetId - Movimientos spreadsheet ID
 * @param period - Statement period (for logging)
 * @returns Success/failure result
 */
export async function storeMovimientosBancario(
  movimientos: MovimientoBancario[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string }
): Promise<Result<void, Error>> {
  try {
    // Group by month
    const monthGroups = groupByMonth(movimientos);

    // If no movements at all, create empty sheet for the period start month
    if (monthGroups.size === 0) {
      const emptyMonth = period.fechaDesde.substring(0, 7);
      const sheetResult = await getOrCreateMonthSheet(
        spreadsheetId,
        emptyMonth,
        MOVIMIENTOS_BANCARIO_SHEET.headers
      );
      if (!sheetResult.ok) return sheetResult;

      const formatResult = await formatEmptyMonthSheet(
        spreadsheetId,
        sheetResult.value,
        MOVIMIENTOS_BANCARIO_SHEET.headers.length
      );
      if (!formatResult.ok) return formatResult;

      info('Created empty month sheet for bank account', {
        module: 'movimientos-store',
        phase: 'store-bancario',
        month: emptyMonth
      });

      return { ok: true, value: undefined };
    }

    // Process each month
    for (const [month, monthMovimientos] of monthGroups) {
      const sheetResult = await getOrCreateMonthSheet(
        spreadsheetId,
        month,
        MOVIMIENTOS_BANCARIO_SHEET.headers
      );
      if (!sheetResult.ok) return sheetResult;

      // Sort by date ascending
      const sorted = [...monthMovimientos].sort((a, b) =>
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

      // Append rows
      const range = `${month}!A:E`;
      const appendResult = await appendRowsWithLinks(spreadsheetId, range, rows);
      if (!appendResult.ok) return { ok: false, error: appendResult.error };

      info('Stored bank account movimientos', {
        module: 'movimientos-store',
        phase: 'store-bancario',
        month,
        count: sorted.length
      });
    }

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
 * Groups transactions by month and creates per-month sheets
 *
 * @param movimientos - Array of credit card transactions
 * @param spreadsheetId - Movimientos spreadsheet ID
 * @param period - Statement period (for logging)
 * @returns Success/failure result
 */
export async function storeMovimientosTarjeta(
  movimientos: MovimientoTarjeta[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string }
): Promise<Result<void, Error>> {
  try {
    const monthGroups = groupByMonth(movimientos);

    if (monthGroups.size === 0) {
      const emptyMonth = period.fechaDesde.substring(0, 7);
      const sheetResult = await getOrCreateMonthSheet(
        spreadsheetId,
        emptyMonth,
        MOVIMIENTOS_TARJETA_SHEET.headers
      );
      if (!sheetResult.ok) return sheetResult;

      const formatResult = await formatEmptyMonthSheet(
        spreadsheetId,
        sheetResult.value,
        MOVIMIENTOS_TARJETA_SHEET.headers.length
      );
      if (!formatResult.ok) return formatResult;

      info('Created empty month sheet for credit card', {
        module: 'movimientos-store',
        phase: 'store-tarjeta',
        month: emptyMonth
      });

      return { ok: true, value: undefined };
    }

    for (const [month, monthMovimientos] of monthGroups) {
      const sheetResult = await getOrCreateMonthSheet(
        spreadsheetId,
        month,
        MOVIMIENTOS_TARJETA_SHEET.headers
      );
      if (!sheetResult.ok) return sheetResult;

      const sorted = [...monthMovimientos].sort((a, b) =>
        a.fecha.localeCompare(b.fecha)
      );

      const rows = sorted.map(mov => [
        { type: 'date', value: mov.fecha } as CellDate,
        mov.descripcion,
        mov.nroCupon,
        mov.pesos !== null ? { type: 'number', value: mov.pesos } as CellNumber : null,
        mov.dolares !== null ? { type: 'number', value: mov.dolares } as CellNumber : null
      ]);

      const range = `${month}!A:E`;
      const appendResult = await appendRowsWithLinks(spreadsheetId, range, rows);
      if (!appendResult.ok) return { ok: false, error: appendResult.error };

      info('Stored credit card movimientos', {
        module: 'movimientos-store',
        phase: 'store-tarjeta',
        month,
        count: sorted.length
      });
    }

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
 * Groups transactions by month (fechaConcertacion) and creates per-month sheets
 *
 * @param movimientos - Array of broker transactions
 * @param spreadsheetId - Movimientos spreadsheet ID
 * @param period - Statement period (for logging)
 * @returns Success/failure result
 */
export async function storeMovimientosBroker(
  movimientos: MovimientoBroker[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string }
): Promise<Result<void, Error>> {
  try {
    // For broker, group by fechaConcertacion (settlement date)
    const monthGroups = new Map<string, MovimientoBroker[]>();

    for (const mov of movimientos) {
      const month = mov.fechaConcertacion.substring(0, 7);
      const existing = monthGroups.get(month) || [];
      existing.push(mov);
      monthGroups.set(month, existing);
    }

    if (monthGroups.size === 0) {
      const emptyMonth = period.fechaDesde.substring(0, 7);
      const sheetResult = await getOrCreateMonthSheet(
        spreadsheetId,
        emptyMonth,
        MOVIMIENTOS_BROKER_SHEET.headers
      );
      if (!sheetResult.ok) return sheetResult;

      const formatResult = await formatEmptyMonthSheet(
        spreadsheetId,
        sheetResult.value,
        MOVIMIENTOS_BROKER_SHEET.headers.length
      );
      if (!formatResult.ok) return formatResult;

      info('Created empty month sheet for broker', {
        module: 'movimientos-store',
        phase: 'store-broker',
        month: emptyMonth
      });

      return { ok: true, value: undefined };
    }

    for (const [month, monthMovimientos] of monthGroups) {
      const sheetResult = await getOrCreateMonthSheet(
        spreadsheetId,
        month,
        MOVIMIENTOS_BROKER_SHEET.headers
      );
      if (!sheetResult.ok) return sheetResult;

      const sorted = [...monthMovimientos].sort((a, b) =>
        a.fechaConcertacion.localeCompare(b.fechaConcertacion)
      );

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

      const range = `${month}!A:J`;
      const appendResult = await appendRowsWithLinks(spreadsheetId, range, rows);
      if (!appendResult.ok) return { ok: false, error: appendResult.error };

      info('Stored broker movimientos', {
        module: 'movimientos-store',
        phase: 'store-broker',
        month,
        count: sorted.length
      });
    }

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
