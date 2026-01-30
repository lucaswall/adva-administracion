/**
 * Balance formula generation utilities for bank account statements
 *
 * Generates Google Sheets formulas to compute running balances and validate
 * that parsed transactions reconcile to reported final balance.
 */

import type { MovimientoBancario } from '../types/index.js';

/**
 * Generates initial balance row for Movimientos sheet
 *
 * @param saldoInicial - Starting balance from resumen
 * @param _sheetName - Month sheet name (e.g., "2025-01") - not currently used
 * @returns Row data with initial balance in saldoCalculado column
 */
export function generateInitialBalanceRow(
  saldoInicial: number,
  _sheetName: string
): [null, string, null, null, null, number] {
  return [
    null,              // fecha (empty for initial balance)
    'SALDO INICIAL',   // origenConcepto
    null,              // debito (empty)
    null,              // credito (empty)
    null,              // saldo (empty)
    saldoInicial,      // saldoCalculado (initial balance value)
  ];
}

/**
 * Generates transaction row with running balance formula
 *
 * Formula: =F{previousRow}+D{currentRow}-C{currentRow}
 * - F = saldoCalculado column (running balance)
 * - D = credito column
 * - C = debito column
 *
 * @param mov - Bank transaction data
 * @param rowIndex - 0-based row index where this transaction will be inserted
 * @returns Row data with formula in saldoCalculado column
 */
export function generateMovimientoRowWithFormula(
  mov: MovimientoBancario,
  rowIndex: number
): [string, string, number | null, number | null, number | null, string] {
  // Sheet rows are 1-based, rowIndex is 0-based
  // Previous row in sheet = rowIndex (e.g., rowIndex 2 -> row 2 in sheet)
  // Current row in sheet = rowIndex + 1 (e.g., rowIndex 2 -> row 3 in sheet)
  const previousSheetRow = rowIndex;
  const currentSheetRow = rowIndex + 1;

  // Formula: =F{prev}+D{curr}-C{curr}
  // Example: for rowIndex 2 (sheet row 3): =F2+D3-C3
  const formula = `=F${previousSheetRow}+D${currentSheetRow}-C${currentSheetRow}`;

  return [
    mov.fecha,         // fecha (string in YYYY-MM-DD format)
    mov.origenConcepto,
    mov.debito,
    mov.credito,
    mov.saldo,         // Parsed from PDF (for comparison)
    formula,           // saldoCalculado formula
  ];
}

/**
 * Generates final balance row for Movimientos sheet
 *
 * This row simply references the last transaction's computed saldoCalculado.
 * Used for cross-sheet IMPORTRANGE validation in Control Resumenes.
 *
 * @param lastRowIndex - 0-based row index of last transaction
 * @returns Row data with formula referencing last transaction's saldoCalculado
 */
export function generateFinalBalanceRow(
  lastRowIndex: number
): [null, string, null, null, null, string] {
  // Convert 0-based index to 1-based sheet row
  const lastSheetRow = lastRowIndex + 1;

  return [
    null,                    // fecha (empty)
    'SALDO FINAL',           // origenConcepto
    null,                    // debito (empty)
    null,                    // credito (empty)
    null,                    // saldo (empty)
    `=F${lastSheetRow}`,     // saldoCalculado (reference to last transaction)
  ];
}

/**
 * Generates balanceOk formula for Control Resumenes sheet
 *
 * Compares computed SALDO FINAL from Movimientos sheet against reported saldoFinal
 * in Control Resumenes. Returns "SI" if match, "NO" if mismatch.
 *
 * Formula: =IF(IMPORTRANGE("spreadsheetId","sheetName!F{finalRow}")=J{resumenRow},"SI","NO")
 * - IMPORTRANGE pulls SALDO FINAL from Movimientos spreadsheet
 * - J column contains saldoFinal (reported from PDF)
 *
 * @param movimientosSpreadsheetId - ID of Movimientos spreadsheet
 * @param monthSheetName - Month sheet tab name (e.g., "2025-01")
 * @param finalRowIndex - 0-based row index of SALDO FINAL row in Movimientos
 * @param resumenRowIndex - 0-based row index of this resumen in Control sheet
 * @returns Formula string for balanceOk column
 */
export function generateBalanceOkFormula(
  movimientosSpreadsheetId: string,
  monthSheetName: string,
  finalRowIndex: number,
  resumenRowIndex: number
): string {
  const finalSheetRow = finalRowIndex + 1;
  const resumenSheetRow = resumenRowIndex + 1;

  // J column (index 9) is saldoFinal in Control Resumenes bancario sheet
  return `=IF(IMPORTRANGE("${movimientosSpreadsheetId}","${monthSheetName}!F${finalSheetRow}")=J${resumenSheetRow},"SI","NO")`;
}

/**
 * Generates balanceDiff formula for Control Resumenes sheet
 *
 * Calculates difference between computed and reported balance.
 * Difference = SALDO FINAL (computed) - saldoFinal (reported)
 *
 * Formula: =IMPORTRANGE("spreadsheetId","sheetName!F{finalRow}")-J{resumenRow}
 *
 * @param movimientosSpreadsheetId - ID of Movimientos spreadsheet
 * @param monthSheetName - Month sheet tab name (e.g., "2025-01")
 * @param finalRowIndex - 0-based row index of SALDO FINAL row in Movimientos
 * @param resumenRowIndex - 0-based row index of this resumen in Control sheet
 * @returns Formula string for balanceDiff column
 */
export function generateBalanceDiffFormula(
  movimientosSpreadsheetId: string,
  monthSheetName: string,
  finalRowIndex: number,
  resumenRowIndex: number
): string {
  const finalSheetRow = finalRowIndex + 1;
  const resumenSheetRow = resumenRowIndex + 1;

  // J column (index 9) is saldoFinal in Control Resumenes bancario sheet
  return `=IMPORTRANGE("${movimientosSpreadsheetId}","${monthSheetName}!F${finalSheetRow}")-J${resumenSheetRow}`;
}
