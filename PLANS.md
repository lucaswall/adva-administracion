# Bug Fix Plan

**Created:** 2026-01-30
**Bug Report:** Formulas in Movimientos sheets are being inserted as strings instead of formulas, formula row references are off by one, and balance validation columns in Control Resumenes are empty.
**Category:** Storage

## Investigation

### Context Gathered
- **Files examined:**
  - `src/processing/storage/movimientos-store.ts` - Uses `appendRowsWithLinks`
  - `src/processing/storage/resumen-store.ts` - Stores resumenes, currently writes 10 columns
  - `src/services/sheets.ts` - `appendRowsWithLinks` sanitizes formula strings
  - `src/utils/balance-formulas.ts` - Generates formulas but doesn't account for header row
  - `src/constants/spreadsheet-headers.ts` - Defines 12-column schema with balanceOk/balanceDiff

### Evidence

**Problem 1: Formulas inserted as strings in Movimientos sheets**

In `movimientos-store.ts:102`, formula strings like `=F2+D3-C3` are passed to `appendRowsWithLinks`. However, `convertToSheetsCellData` (sheets.ts:925) sanitizes all strings starting with `=` by prefixing with a single quote, making them render as text instead of formulas.

**Problem 2: Formula row indexing off by one**

`getOrCreateMonthSheet` creates sheets with headers in row 1. When rows are appended:
- Row 1: Headers
- Row 2: SALDO INICIAL (array index 0)
- Row 3: First transaction (array index 1)

But `generateMovimientoRowWithFormula` generates `=F1+D2-C2` for rowIndex=1, which references:
- F1 = Header cell (not a number!)
- D2-C2 = SALDO INICIAL row (empty!)

Correct formula should be `=F2+D3-C3`.

**Problem 3: Balance validation columns empty in Control Resumenes**

The schema defines `balanceOk` and `balanceDiff` columns (indices 10-11) but `storeResumenBancario` only writes 10 columns (A:J), leaving these empty.

### Root Cause Summary

1. **Formula strings sanitized:** Security feature blocks legitimate formulas
2. **Missing header row offset:** Formulas reference wrong rows
3. **Validation columns not populated:** Code doesn't calculate or write balance validation data

## Fix Plan

### Fix 1: Add CellFormula type to allow explicit formulas

**Problem:** The security sanitization blocks all strings starting with `=`, including our generated formulas.

**Solution:** Add a `CellFormula` type following the existing `CellDate`/`CellNumber` pattern.

1. Write test in `src/services/sheets.test.ts`:
   - Test that `CellFormula` values are inserted with `formulaValue`
   - Test that regular strings starting with `=` are still sanitized
   - Add test in "Formula injection sanitization" describe block

2. Update `src/services/sheets.ts`:
   - Add `CellFormula` interface:
     ```typescript
     export interface CellFormula {
       type: 'formula';
       value: string;
     }
     ```
   - Add `isCellFormula` helper function
   - Update `CellValueOrLink` type to include `CellFormula`
   - Handle `CellFormula` in `convertToSheetsCellData`:
     ```typescript
     if (isCellFormula(value)) {
       return {
         userEnteredValue: { formulaValue: value.value },
       };
     }
     ```

3. Update `src/processing/storage/movimientos-store.ts`:
   - Import `CellFormula` type
   - Wrap formula strings: `{ type: 'formula', value: txRow[5] } as CellFormula`
   - Update for SALDO INICIAL row (index 0) - saldoCalculado is a number, not formula
   - Update for transaction rows - saldoCalculado is a formula
   - Update for SALDO FINAL row - saldoCalculado is a formula

### Fix 2: Fix formula row indexing to account for header row

**Problem:** Formulas reference wrong rows because they don't account for headers in row 1.

**Correct mapping:**
- Array index 0 (SALDO INICIAL) → Sheet row 2
- Array index N → Sheet row N + 2

For transaction at array index `rowIndex`:
- Previous row in sheet = rowIndex + 1
- Current row in sheet = rowIndex + 2

1. Update tests in `src/utils/balance-formulas.test.ts`:
   - Change expected formula for rowIndex=1 from `=F1+D2-C2` to `=F2+D3-C3`
   - Change expected formula for rowIndex=2 from `=F2+D3-C3` to `=F3+D4-C4`
   - Change SALDO FINAL with lastRowIndex=2 from `=F3` to `=F4`
   - Update all affected test cases

2. Update `src/utils/balance-formulas.ts`:
   - Fix `generateMovimientoRowWithFormula`:
     ```typescript
     // Account for header row: array index N → sheet row N + 2
     const previousSheetRow = rowIndex + 1;
     const currentSheetRow = rowIndex + 2;
     const formula = `=F${previousSheetRow}+D${currentSheetRow}-C${currentSheetRow}`;
     ```
   - Fix `generateFinalBalanceRow`:
     ```typescript
     // Last transaction at array index N is at sheet row N + 2
     const lastSheetRow = lastRowIndex + 2;
     return [..., `=F${lastSheetRow}`];
     ```
   - Update JSDoc comments to clarify row mapping

3. Update `src/processing/storage/movimientos-store.test.ts`:
   - Fix formula assertions:
     - First transaction: `=F2+D3-C3`
     - Second transaction: `=F3+D4-C4`
     - SALDO FINAL (2 transactions): `=F4`

### Fix 3: Implement balance validation columns in Control Resumenes

**Problem:** `balanceOk` and `balanceDiff` columns are defined in schema but never populated.

**Solution:** Calculate balanceDiff in code at write time, use formula for balanceOk.

**How balanceDiff is calculated:**
```typescript
let computedBalance = saldoInicial;
for (const mov of movimientos) {
  computedBalance += (mov.credito ?? 0) - (mov.debito ?? 0);
}
const balanceDiff = computedBalance - saldoFinal;
```

**Schema (12 columns A:L - already defined):**
- A-J: existing columns (periodo through saldoFinal)
- K (index 10): balanceOk - Formula: `=IF(ABS(INDIRECT("L"&ROW()))<0.01,"SI","NO")`
- L (index 11): balanceDiff - Number: computed balance minus parsed saldoFinal

1. Add balance calculation utility in `src/utils/balance-formulas.ts`:
   ```typescript
   /**
    * Calculates the difference between computed and reported final balance
    * @param saldoInicial - Starting balance from resumen
    * @param movimientos - Array of transactions
    * @param saldoFinal - Reported final balance from resumen
    * @returns Difference (computed - reported), should be ~0 if parsing correct
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
    * Uses INDIRECT with ROW() so it works regardless of row position after sorting
    * @returns Formula string checking if balanceDiff (column L) is within 0.01 tolerance
    */
   export function generateBalanceOkFormula(): string {
     return '=IF(ABS(INDIRECT("L"&ROW()))<0.01,"SI","NO")';
   }
   ```

2. Write tests in `src/utils/balance-formulas.test.ts`:
   - Test `calculateBalanceDiff` with various scenarios:
     - Perfect match (diff = 0)
     - Small rounding difference
     - Parsing error (large diff)
     - Empty movimientos array
     - Mix of debits and credits
   - Test `generateBalanceOkFormula` returns correct formula string

3. Update `src/processing/storage/resumen-store.ts`:
   - Import `calculateBalanceDiff`, `generateBalanceOkFormula`, and `CellFormula` type
   - In `storeResumenBancario`:
     - Calculate balanceDiff: `calculateBalanceDiff(resumen.saldoInicial, resumen.movimientos, resumen.saldoFinal)`
     - Build row with 12 columns (A:L):
       ```typescript
       const balanceDiff = calculateBalanceDiff(
         resumen.saldoInicial,
         resumen.movimientos,
         resumen.saldoFinal
       );

       const row: CellValueOrLink[] = [
         // ... existing 10 columns (periodo through saldoFinal) ...
         { type: 'formula', value: generateBalanceOkFormula() } as CellFormula,  // K: balanceOk
         { type: 'number', value: balanceDiff } as CellNumber,                    // L: balanceDiff
       ];
       ```
     - Update append range from `'Resumenes!A:J'` to `'Resumenes!A:L'`
   - Update `isDuplicateResumenBancario`:
     - Update getValues range from `'Resumenes!A:J'` to `'Resumenes!A:L'`
     - Column indices for business key remain unchanged

4. Update `src/processing/storage/resumen-store.test.ts`:
   - Add tests verifying:
     - Row has 12 columns
     - Column K contains balanceOk formula
     - Column L contains calculated balanceDiff as CellNumber
   - Test balanceDiff calculation scenarios

5. Update documentation:
   - Update `CLAUDE.md` SPREADSHEETS section to document balanceOk and balanceDiff behavior

### Result

When viewing Control Resumenes sheet:
- **balanceDiff** (column L): Shows actual difference (0.00 if perfect, small value if rounding, large if parsing error)
- **balanceOk** (column K): Shows "SI" if |balanceDiff| < 0.01, "NO" otherwise

Users can quickly scan the balanceOk column to spot problems, then look at balanceDiff for the exact discrepancy.

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Iteration 1

**Implemented:** 2026-01-30

### Completed

- **Fix 1: CellFormula type** - Added `CellFormula` interface to `sheets.ts` with `isCellFormula` type guard. Updated `convertToSheetsCellData` to handle `CellFormula` values using `formulaValue` (bypasses sanitization for trusted internal formulas). Updated `movimientos-store.ts` to wrap formula strings in `CellFormula` type.

- **Fix 2: Formula row indexing** - Fixed `generateMovimientoRowWithFormula` to account for header row. Array index N now maps to sheet row N+2 (since row 1 is headers, row 2 is SALDO INICIAL). Updated `generateFinalBalanceRow` similarly. Updated all related test assertions.

- **Fix 3: Balance validation columns** - Implemented `calculateBalanceDiff` function to compute (saldoInicial + credits - debits - saldoFinal). Implemented `generateBalanceOkFormulaLocal` function returning `=IF(ABS(INDIRECT("L"&ROW()))<0.01,"SI","NO")`. Updated `storeResumenBancario` to include columns K (balanceOk formula) and L (balanceDiff number). Updated range from A:J to A:L.

- **Documentation** - Updated SPREADSHEET_FORMAT.md to reflect the new 12-column schema for Resumen Bancario, adding balanceOk and balanceDiff columns.

### Checklist Results
- bug-hunter: Found 1 medium issue (SPREADSHEET_FORMAT.md outdated) - fixed
- test-runner: Passed (1114 tests across 54 files)
- builder: Passed (zero warnings)

### Notes
- The CellFormula type is intentionally bypassing sanitization. The JSDoc comment warns this is only for trusted, internally-generated formulas.
- The balanceOk formula uses INDIRECT with ROW() to work correctly even after the sheet is sorted by periodo.
- Tests were updated following TDD: write failing tests first, then implement to make them pass.

### Review Findings

Files reviewed: 8
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Conventions

**Security Analysis (CellFormula bypass):**
- The `CellFormula` type intentionally bypasses sanitization but is properly secured:
  - JSDoc comment warns it's "Only use for trusted, internally-generated formulas (never user input)"
  - Only used internally by `movimientos-store.ts` and `resumen-store.ts`
  - User input from PDFs is parsed separately and never directly converted to `CellFormula`
  - Formulas are generated by `generateMovimientoRowWithFormula`, `generateFinalBalanceRow`, and `generateBalanceOkFormulaLocal` which produce hardcoded formula patterns - no user input in formula strings

**Logic Analysis:**
- Formula row indexing correctly accounts for header row (array index N → sheet row N + 2)
- Tests verify correct formulas: `=F2+D3-C3` for index 1, `=F3+D4-C4` for index 2
- `calculateBalanceDiff` correctly handles null debito/credito values with `?? 0`

**Type Safety:**
- `isCellFormula` type guard properly checks for `type: 'formula'` property
- `CellFormula` is included in `CellValueOrLink` union type

**Conventions:**
- ESM imports with `.js` extensions ✓
- No console.log usage ✓
- Uses Pino logger ✓
- TDD workflow followed ✓

No issues found - all implementations are correct and follow project conventions.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
