/**
 * Storage operations for movimientos (individual transactions)
 * Handles writing transactions to per-month sheets in Movimientos spreadsheets
 */

import type { Result, MovimientoBancario, MovimientoTarjeta, MovimientoBroker } from '../../types/index.js';
import { getOrCreateMonthSheet, formatEmptyMonthSheet, appendRowsWithLinks, type CellDate, type CellNumber } from '../../services/sheets.js';
import { MOVIMIENTOS_BANCARIO_SHEET, MOVIMIENTOS_TARJETA_SHEET, MOVIMIENTOS_BROKER_SHEET } from '../../constants/spreadsheet-headers.js';
import { info } from '../../utils/logger.js';
import type { SheetOrderBatch } from '../caches/index.js';
import {
  generateInitialBalanceRow,
  generateMovimientoRowWithFormula,
  generateFinalBalanceRow,
} from '../../utils/balance-formulas.js';

/**
 * Stores bank account transactions to Movimientos spreadsheet
 * All transactions are stored in the resumen's month (from fechaHasta)
 *
 * @param movimientos - Array of bank transactions
 * @param spreadsheetId - Movimientos spreadsheet ID
 * @param period - Statement period (determines target month via fechaHasta)
 * @param saldoInicial - Starting balance for running balance formulas
 * @param sheetOrderBatch - Optional batch collector to defer sheet reordering
 * @returns Success/failure result
 */
export async function storeMovimientosBancario(
  movimientos: MovimientoBancario[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string },
  saldoInicial: number,
  sheetOrderBatch?: SheetOrderBatch
): Promise<Result<void, Error>> {
  try {
    // Target month is determined by resumen's fechaHasta
    const targetMonth = period.fechaHasta.substring(0, 7);

    // Get or create the target month sheet
    const sheetResult = await getOrCreateMonthSheet(
      spreadsheetId,
      targetMonth,
      MOVIMIENTOS_BANCARIO_SHEET.headers,
      sheetOrderBatch
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

    // Build rows with balance formulas:
    // 1. Initial balance row (SALDO INICIAL)
    // 2. Transaction rows with running balance formulas
    // 3. Final balance row (SALDO FINAL)
    const rows: any[] = [];

    // Row 0 (sheet row 1): SALDO INICIAL
    const initialRow = generateInitialBalanceRow(saldoInicial, targetMonth);
    rows.push([
      initialRow[0],  // null (fecha)
      initialRow[1],  // 'SALDO INICIAL' (origenConcepto)
      initialRow[2],  // null (debito)
      initialRow[3],  // null (credito)
      initialRow[4],  // null (saldo)
      initialRow[5],  // saldoInicial value (saldoCalculado)
    ]);

    // Rows 1..N (sheet rows 2..N+1): Transactions with formulas
    sorted.forEach((mov, index) => {
      // rowIndex is the 0-based position where this transaction will be inserted
      // Row 0 is SALDO INICIAL, so first transaction is at rowIndex 1
      const rowIndex = index + 1;
      const txRow = generateMovimientoRowWithFormula(mov, rowIndex);

      // Wrap in CellDate/CellNumber types for spreadsheet formatting
      rows.push([
        { type: 'date', value: txRow[0] } as CellDate,
        txRow[1],  // origenConcepto (string)
        txRow[2] !== null ? { type: 'number', value: txRow[2] } as CellNumber : null,  // debito
        txRow[3] !== null ? { type: 'number', value: txRow[3] } as CellNumber : null,  // credito
        txRow[4] !== null ? { type: 'number', value: txRow[4] } as CellNumber : null,  // saldo
        txRow[5],  // saldoCalculado (formula string)
      ]);
    });

    // Final row (sheet row N+2): SALDO FINAL
    // Last transaction is at rowIndex = sorted.length (0-based)
    const lastTransactionRowIndex = sorted.length;
    const finalRow = generateFinalBalanceRow(lastTransactionRowIndex);
    rows.push([
      finalRow[0],  // null (fecha)
      finalRow[1],  // 'SALDO FINAL' (origenConcepto)
      finalRow[2],  // null (debito)
      finalRow[3],  // null (credito)
      finalRow[4],  // null (saldo)
      finalRow[5],  // formula referencing last saldoCalculado
    ]);

    // Append all rows to target month (A:F for 6 columns)
    const range = `${targetMonth}!A:F`;
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
 * @param sheetOrderBatch - Optional batch collector to defer sheet reordering
 * @returns Success/failure result
 */
export async function storeMovimientosTarjeta(
  movimientos: MovimientoTarjeta[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string },
  sheetOrderBatch?: SheetOrderBatch
): Promise<Result<void, Error>> {
  try {
    // Target month is determined by resumen's fechaHasta
    const targetMonth = period.fechaHasta.substring(0, 7);

    // Get or create the target month sheet
    const sheetResult = await getOrCreateMonthSheet(
      spreadsheetId,
      targetMonth,
      MOVIMIENTOS_TARJETA_SHEET.headers,
      sheetOrderBatch
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
 * @param sheetOrderBatch - Optional batch collector to defer sheet reordering
 * @returns Success/failure result
 */
export async function storeMovimientosBroker(
  movimientos: MovimientoBroker[],
  spreadsheetId: string,
  period: { fechaDesde: string; fechaHasta: string },
  sheetOrderBatch?: SheetOrderBatch
): Promise<Result<void, Error>> {
  try {
    // Target month is determined by resumen's fechaHasta
    const targetMonth = period.fechaHasta.substring(0, 7);

    // Get or create the target month sheet
    const sheetResult = await getOrCreateMonthSheet(
      spreadsheetId,
      targetMonth,
      MOVIMIENTOS_BROKER_SHEET.headers,
      sheetOrderBatch
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
