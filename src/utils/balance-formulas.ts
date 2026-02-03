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
    'SALDO INICIAL',   // concepto
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
 * Row mapping (accounts for header row):
 * - Row 1 (sheet): Headers
 * - Row 2 (sheet): SALDO INICIAL (array index 0)
 * - Row N+2 (sheet): Transaction at array index N
 *
 * @param mov - Bank transaction data
 * @param rowIndex - 0-based array index where this transaction will be inserted
 * @returns Row data with formula in saldoCalculado column
 */
export function generateMovimientoRowWithFormula(
  mov: MovimientoBancario,
  rowIndex: number
): [string, string, number | null, number | null, number | null, string] {
  // Account for header row: array index N → sheet row N + 2
  // Previous row in sheet = rowIndex + 1 (previous array position + 2)
  // Current row in sheet = rowIndex + 2
  const previousSheetRow = rowIndex + 1;
  const currentSheetRow = rowIndex + 2;

  // Formula: =F{prev}+D{curr}-C{curr}
  // Example: for array index 1 (sheet row 3): =F2+D3-C3
  const formula = `=F${previousSheetRow}+D${currentSheetRow}-C${currentSheetRow}`;

  return [
    mov.fecha,         // fecha (string in YYYY-MM-DD format)
    mov.concepto,
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
 * Row mapping (accounts for header row):
 * - Last transaction at array index N is at sheet row N + 2
 *
 * @param lastRowIndex - 0-based array index of last transaction
 * @returns Row data with formula referencing last transaction's saldoCalculado
 */
export function generateFinalBalanceRow(
  lastRowIndex: number
): [null, string, null, null, null, string] {
  // Account for header row: array index N → sheet row N + 2
  const lastSheetRow = lastRowIndex + 2;

  return [
    null,                    // fecha (empty)
    'SALDO FINAL',           // concepto
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

/**
 * Calculates the difference between computed and reported final balance
 *
 * This is calculated at write time and stored as a value (not a formula).
 * It allows immediate validation without requiring IMPORTRANGE permissions.
 *
 * @param saldoInicial - Starting balance from resumen
 * @param movimientos - Array of transactions from resumen
 * @param saldoFinal - Reported final balance from resumen
 * @returns Difference (computed - reported), should be ~0 if parsing is correct
 */
export function calculateBalanceDiff(
  saldoInicial: number,
  movimientos: MovimientoBancario[],
  saldoFinal: number
): number {
  let computedBalance = saldoInicial;
  for (const mov of movimientos) {
    computedBalance += (mov.credito ?? 0) - (mov.debito ?? 0);
  }
  return computedBalance - saldoFinal;
}

/**
 * Generates the balanceOk formula for Control Resumenes
 *
 * Uses INDIRECT with ROW() so it works regardless of row position after sorting.
 * References balanceDiff in column L and checks if it's within 0.01 tolerance.
 *
 * @returns Formula string checking if balanceDiff (column L) is within tolerance
 */
export function generateBalanceOkFormulaLocal(): string {
  // Column L contains balanceDiff
  // Returns "SI" if |balanceDiff| < 0.01, "NO" otherwise
  return '=IF(ABS(INDIRECT("L"&ROW()))<0.01,"SI","NO")';
}
