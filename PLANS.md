# Implementation Plan

**Created:** 2026-01-30
**Source:** Inline request: Add balance validation for resumenes - running balance formulas in Movimientos sheets with initial/final balance verification against Control Resumenes

## Context Gathered

### Codebase Analysis

**Related files:**
- `src/processing/storage/movimientos-store.ts` - Stores individual transactions to per-month sheets
- `src/processing/storage/resumen-store.ts` - Stores resumen summaries to Control Resumenes sheets
- `src/constants/spreadsheet-headers.ts` - Defines sheet headers and column configurations
- `src/types/index.ts` - Type definitions for MovimientoBancario, ResumenBancario, etc.
- `src/services/sheets.ts` - Low-level Sheets API (supports formulas via strings starting with `=`)

**Existing patterns:**
- Movimientos sheets have per-month tabs (e.g., "2025-01")
- MovimientoBancario has `saldo` field (parsed from document, not computed)
- ResumenBancario has `saldoInicial` and `saldoFinal` fields
- Control Resumenes has 10 columns (A:J) for bancario type
- Sheets service supports formulas via `{ userEnteredValue: { formulaValue: value } }` when string starts with `=`

**Test conventions:**
- Tests colocated as `*.test.ts`
- Use vi.mock for dependencies
- Helper functions like `createTestResumen()`

### Problem Analysis

**Current state:**
- Movimientos sheets store transactions but the `saldo` column is just a parsed value (from PDF)
- No formula-based running balance calculation
- No validation that transactions reconcile to reported saldoFinal
- Errors in parsing movimientos are hard to detect without manual inspection

**User requirements:**
1. Each Movimientos month sheet should start with an initial balance row (from resumen.saldoInicial)
2. Each transaction row should have a running balance formula: `=previous_saldo + credito - debito`
3. Compare final computed balance to resumen.saldoFinal
4. Control Resumenes should show a "balanceOk" indicator

### Proposed Improvements

Based on the user's request, I propose the following enhancements:

1. **Initial Balance Row**: Add a "SALDO INICIAL" row at the top of each month sheet before transactions
2. **Running Balance Formulas**: Replace static `saldo` values with formulas that compute running balance
3. **Final Balance Formula Row**: Add a "SALDO FINAL" row at the bottom that equals the last running balance
4. **Balance Match Column**: Add `balanceOk` column to Control Resumenes showing `SI` or `NO` based on comparison
5. **Balance Difference Column**: Add `balanceDiff` column showing the difference (for debugging)

**Why this is valuable:**
- Immediately identifies parsing errors in movimientos
- Self-documenting spreadsheet that shows exactly how balance is computed
- Easy to spot discrepancies without running code
- Accountant-friendly format they can verify manually

**Scope Decision - Bancario Only:**
This implementation focuses on `resumen_bancario` (bank accounts) only because:
- It's the only type with true debito/credito/saldo structure
- `resumen_tarjeta` has pesos/dolares but no running balance concept (credit cards don't work that way)
- `resumen_broker` has different saldo semantics (position values, not account balance)

## Original Plan

### Task 1: Update spreadsheet headers for Control Resumenes with balance validation columns

1. Write test in `src/constants/spreadsheet-headers.test.ts`:
   - Test CONTROL_RESUMENES_BANCARIO_SHEET has 12 columns (A:L)
   - Test `balanceOk` is column K
   - Test `balanceDiff` is column L
   - Test numberFormats includes new column for balanceDiff (currency format)
2. Run test-runner (expect fail)
3. Update `src/constants/spreadsheet-headers.ts`:
   - Add `balanceOk` and `balanceDiff` columns to CONTROL_RESUMENES_BANCARIO_SHEET headers
   - Update numberFormats Map with index 11 for balanceDiff (currency format)
4. Run test-runner (expect pass)

### Task 2: Update Movimientos bancario headers with saldoCalculado column

1. Write test in `src/constants/spreadsheet-headers.test.ts`:
   - Test MOVIMIENTOS_BANCARIO_SHEET has 6 columns (A:F)
   - Test `saldoCalculado` is column F
   - Test numberFormats includes column 5 for saldoCalculado (currency format)
2. Run test-runner (expect fail)
3. Update `src/constants/spreadsheet-headers.ts`:
   - Add `saldoCalculado` column to MOVIMIENTOS_BANCARIO_SHEET headers
   - Update numberFormats Map with index 5 for saldoCalculado (currency format)
4. Run test-runner (expect pass)

### Task 3: Create balance formula generation utility

1. Write test in `src/utils/balance-formulas.test.ts` (new file):
   - Test `generateInitialBalanceRow()` returns correct row format with saldo in saldoCalculado column
   - Test `generateMovimientoRowWithFormula()` returns row with formula in saldoCalculado column
   - Test formula references previous row correctly (e.g., `=F2+D3-C3` for row 3)
   - Test first transaction row references initial balance row
   - Test `generateFinalBalanceRow()` returns row referencing last transaction saldo
2. Run test-runner (expect fail)
3. Implement `src/utils/balance-formulas.ts`:
   - `generateInitialBalanceRow(saldoInicial: number, sheetName: string)` - returns row for initial balance
   - `generateMovimientoRowWithFormula(mov: MovimientoBancario, rowIndex: number)` - returns row with formula
   - `generateFinalBalanceRow(lastRowIndex: number)` - returns final balance row referencing last saldo
   - `generateBalanceOkFormula(movimientosSheetId: string, monthSheetName: string, saldoFinalColumn: number, resumenRowIndex: number)` - generates formula for Control sheet
4. Run test-runner (expect pass)

### Task 4: Update storeMovimientosBancario to use balance formulas

1. Write test in `src/processing/storage/movimientos-store.test.ts`:
   - Test that initial balance row is inserted first with label "SALDO INICIAL" and saldo value
   - Test that each transaction row has formula in saldoCalculado column
   - Test that final balance row is inserted last with label "SALDO FINAL"
   - Test formula references are correct (F2, F3+D4-C4, etc.)
   - Test that original `saldo` column still contains parsed value (for comparison)
   - Update existing tests to expect 6 columns instead of 5
2. Run test-runner (expect fail)
3. Update `src/processing/storage/movimientos-store.ts`:
   - Import balance formula utilities
   - Modify `storeMovimientosBancario()` to:
     - Accept additional parameter `saldoInicial: number`
     - Insert initial balance row first
     - Generate formula-based saldoCalculado for each transaction row
     - Insert final balance row last
   - Update range from `A:E` to `A:F`
4. Run test-runner (expect pass)

### Task 5: Update scanner to pass saldoInicial to storeMovimientosBancario

1. Write test in `src/processing/scanner.test.ts`:
   - Test that storeMovimientosBancario is called with saldoInicial from parsed resumen
   - Test error handling if storeMovimientosBancario fails
2. Run test-runner (expect fail)
3. Update `src/processing/scanner.ts`:
   - Modify call to `storeMovimientosBancario()` to pass `resumen.saldoInicial`
4. Run test-runner (expect pass)

### Task 6: Update storeResumenBancario to include balance validation columns

1. Write test in `src/processing/storage/resumen-store.test.ts`:
   - Test that row has 12 columns (A:L)
   - Test that `balanceOk` column contains formula comparing computed vs reported saldoFinal
   - Test that `balanceDiff` column contains formula for difference
   - Test formula references correct Movimientos spreadsheet and month sheet
   - Update existing tests for new column count
2. Run test-runner (expect fail)
3. Update `src/processing/storage/resumen-store.ts`:
   - Import balance formula utilities
   - Modify `storeResumenBancario()` to:
     - Accept additional parameter `movimientosSpreadsheetId: string` (needed for cross-sheet formula)
     - Add `balanceOk` formula column (compares SALDO FINAL row to saldoFinal)
     - Add `balanceDiff` formula column (SALDO FINAL - saldoFinal)
   - Update range from `A:J` to `A:L`
4. Run test-runner (expect pass)

### Task 7: Update scanner to pass movimientosSpreadsheetId to storeResumenBancario

1. Write test in `src/processing/scanner.test.ts`:
   - Test that storeResumenBancario is called with movimientosSpreadsheetId
2. Run test-runner (expect fail)
3. Update `src/processing/scanner.ts`:
   - Modify call to `storeResumenBancario()` to pass `movimientosSpreadsheetId`
4. Run test-runner (expect pass)

### Task 8: Update duplicate detection for new column count

1. Write test in `src/processing/storage/resumen-store.test.ts`:
   - Test isDuplicateResumenBancario reads correct columns from 12-column sheet
   - Test duplicate detection still works correctly
2. Run test-runner (expect fail)
3. Update `src/processing/storage/resumen-store.ts`:
   - Update `isDuplicateResumenBancario()` range from `A:J` to `A:L`
   - Column indices remain the same (business key columns unchanged)
4. Run test-runner (expect pass)

### Task 9: Update documentation

1. Update `SPREADSHEET_FORMAT.md`:
   - Document new `saldoCalculado` column in Movimientos Bancario section
   - Document SALDO INICIAL and SALDO FINAL rows format
   - Document `balanceOk` and `balanceDiff` columns in Control Resumenes Bancario section
   - Add formula documentation showing cross-sheet references
   - Update column counts (bancario movimientos: 6 cols A:F, control resumenes bancario: 12 cols A:L)

2. Update `CLAUDE.md`:
   - Update SPREADSHEETS section with new column counts
   - Add note about balance validation feature

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings
