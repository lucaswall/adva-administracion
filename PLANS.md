# Implementation Plan

**Created:** 2026-02-01
**Source:** TODO.md items #1, #2, #3, #4, #5

## Context Gathered

### Codebase Analysis

**Item #1 - SALDO INICIAL number formatting:**
- **Root cause:** `generateInitialBalanceRow()` in `src/utils/balance-formulas.ts` returns raw number at position 5 (line 27)
- **Usage:** `src/processing/storage/movimientos-store.ts` (lines 78-88) passes this raw number directly without wrapping in `CellNumber`
- **Contrast:** Transaction rows properly wrap numeric values in `CellNumber` type (lines 98-107)
- **Fix location:** `movimientos-store.ts` line 85 - wrap `initialRow[5]` in `CellNumber`

**Item #2 - processedAt timestamp formatting:**
- **Root cause:** `batchUpdate()` in `src/services/sheets.ts` (lines 281-301) doesn't process values through `convertToSheetsCellData()`
- **Retry path:** `src/processing/storage/index.ts` (lines 94-96) passes ISO string directly to `batchUpdate()`
- **New file path:** Uses `appendRowsWithLinks()` with timezone parameter, which auto-converts ISO timestamps
- **Fix:** Either enhance `batchUpdate()` or convert ISO string before calling it

**Item #3 - DuplicateCache silent failure:**
- **Root cause:** In `doLoadSheet()` (lines 39-42), when `rowsResult.ok` is false, the promise resolves normally (early return)
- **Problem:** The cache entry is never populated, but `loadSheet()` completes successfully
- **Effect:** Subsequent `isDuplicate*()` calls return `{ isDuplicate: false }` because cache is empty
- **Fix:** Track load failure state and retry on subsequent `loadSheet()` calls

**Item #4 - Empty detalles in Movimientos (BUG CONFIRMED):**
- **Root cause:** `matchAllMovimientos()` iterates over `bankSpreadsheets` from folder structure (line 805 in match-movimientos.ts)
- **Problem:** `bankSpreadsheets` is populated from root-level spreadsheets only (folder-structure.ts line 554)
- **Effect:** Root level only has Control de Ingresos/Egresos/Dashboard (filtered out), so `bankSpreadsheets` is EMPTY
- **Evidence:** Railway logs show `Match movimientos completed filled=0` and NO "Processing bank movimientos" logs
- **Real location:** Movimientos spreadsheets are created inside `{YYYY}/Bancos/{Bank}/` folders by `getOrCreateMovimientosSpreadsheet()` but IDs are NOT cached
- **Fix:** Add `movimientosSpreadsheets` cache to FolderStructure and populate it when Movimientos spreadsheets are created; use this cache in `matchAllMovimientos()`

**Item #5 - Pagos Pendientes sorting:**
- **Current behavior:** `syncPagosPendientes()` writes data in source order (no sorting)
- **Location:** `src/services/pagos-pendientes.ts` (lines 45-88)
- **Fix:** Sort `unpaidFacturas` array by `fechaEmision` ascending before writing

### MCP Context
- **MCPs used:** Railway MCP (get-logs) for item #4 investigation
- **Findings:**
  - Logs show `Match movimientos completed filled=0` confirming matching runs but processes 0 banks
  - No "Processing bank movimientos" logs found - confirming the for-loop over `bankSpreadsheets` never executes
  - Movimientos ARE being stored successfully (many "Stored bank account movimientos" logs)
  - Root cause: `bankSpreadsheets` Map is empty because it only contains root-level spreadsheets

---

## Original Plan

### Task 1: Fix SALDO INICIAL number formatting in Movimientos sheets

1. Write test in `src/processing/storage/movimientos-store.test.ts`:
   - Test that SALDO INICIAL row has `saldoCalculado` (column F) wrapped as `CellNumber`
   - Test that the value displays with `#,##0.00` formatting
   - Verify existing tests still pass after change

2. Run test-runner (expect fail)

3. Update `src/processing/storage/movimientos-store.ts` line 85:
   - Change from: `initialRow[5],  // saldoInicial value (saldoCalculado)`
   - Change to: `{ type: 'number', value: initialRow[5] } as CellNumber,  // saldoInicial value (saldoCalculado)`

4. Run test-runner (expect pass)

### Task 2: Fix processedAt timestamp formatting for retry files

1. Write test in `src/processing/storage/index.test.ts`:
   - Test that retry path converts ISO timestamp to `CellDate` with timezone
   - Test that new file path and retry path produce consistent timestamp formatting
   - Mock `batchUpdate` to verify values are properly converted

2. Run test-runner (expect fail)

3. Update `src/processing/storage/index.ts` lines 94-96:
   - Option A: Convert ISO string to `CellDate` before calling `batchUpdate()`
   - Option B: Create helper function `convertTimestampForBatchUpdate()` that handles timezone
   - Implementation: Replace direct ISO string with proper date serial number conversion using `dateToSerialInTimezone()` from sheets.ts

4. Run test-runner (expect pass)

### Task 3: Fix DuplicateCache failed promise caching bug

1. Write test in `src/processing/caches/duplicate-cache.test.ts`:
   - Confirm the documented test case (lines 621-668) is already written
   - If test exists and fails, proceed to fix
   - If test doesn't exist, write test that:
     - First `loadSheet()` fails (mock `getValues` to return error)
     - Second `loadSheet()` succeeds (mock `getValues` to return valid data)
     - Verify cache is populated after second attempt

2. Run test-runner (expect fail - test should fail with current implementation)

3. Update `src/processing/caches/duplicate-cache.ts`:
   - Add `failedKeys` Set to track failed loads
   - In `loadSheet()` (line 21): Also check `!this.failedKeys.has(key)` before returning early
   - In `doLoadSheet()` failure path (lines 40-42): Add key to `failedKeys` before early return
   - In `doLoadSheet()` success path (line 54): Remove key from `failedKeys` if present
   - In `clear()` method: Also clear `failedKeys`

4. Run test-runner (expect pass)

### Task 4: Fix matchAllMovimientos using empty bankSpreadsheets Map

**Bug:** `matchAllMovimientos()` iterates over `bankSpreadsheets` which is always empty because Movimientos spreadsheets are inside bank folders, not at root level.

1. Write test in `src/bank/match-movimientos.test.ts`:
   - Test that `matchAllMovimientos` processes banks from `movimientosSpreadsheets` cache
   - Test with mock folder structure containing movimientosSpreadsheets entries
   - Verify iteration happens over the correct Map

2. Run test-runner (expect fail)

3. Update `src/types/index.ts` - Add to FolderStructure interface:
   - Add `movimientosSpreadsheets: Map<string, string>` field
   - Key format: `{folderName}` (e.g., "BBVA 007-009364/1 ARS")
   - Value: Movimientos spreadsheet ID

4. Update `src/services/folder-structure.ts`:
   - Initialize `movimientosSpreadsheets: new Map()` in structure (around line 582)
   - In `getOrCreateMovimientosSpreadsheet()` (line 1498): Cache the spreadsheet ID
     ```typescript
     requireCachedStructure().movimientosSpreadsheets.set(folderName, spreadsheetId);
     ```

5. Update `src/bank/match-movimientos.ts` line 784:
   - Change from: `const { controlIngresosId, controlEgresosId, bankSpreadsheets } = folderStructure;`
   - Change to: `const { controlIngresosId, controlEgresosId, movimientosSpreadsheets } = folderStructure;`

6. Update `src/bank/match-movimientos.ts` line 805:
   - Change from: `for (const [bankName, spreadsheetId] of bankSpreadsheets)`
   - Change to: `for (const [bankName, spreadsheetId] of movimientosSpreadsheets)`

7. Run test-runner (expect pass)

### Task 5: Sort Pagos Pendientes by fechaEmision ascending

1. Write test in `src/services/pagos-pendientes.test.ts`:
   - Test that output rows are sorted by fechaEmision ascending (oldest first)
   - Test with mixed date orders in input
   - Verify column mapping is preserved after sorting

2. Run test-runner (expect fail)

3. Update `src/services/pagos-pendientes.ts`:
   - After filtering unpaid facturas (around line 60)
   - Before mapping to output format
   - Sort array by `fechaEmision` (column A, index 0) ascending
   - Use date comparison: `unpaidFacturas.sort((a, b) => String(a[fechaEmisionIdx]).localeCompare(String(b[fechaEmisionIdx])))`

4. Run test-runner (expect pass)

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Plan Summary

**Objective:** Fix 5 bugs related to number formatting, timestamp formatting, cache failure handling, Movimientos matching, and data sorting.

**Source Items:** #1, #2, #3, #4, #5

**Approach:** Each bug has a clear root cause identified through codebase exploration. Fixes follow existing patterns: CellNumber wrapping for number formatting, date serial conversion for timestamps, state tracking for cache failures, new cache Map for Movimientos spreadsheets, and array sorting for data ordering.

**Scope:**
- Tasks: 5 code changes
- Files affected: 7 (movimientos-store.ts, storage/index.ts, duplicate-cache.ts, types/index.ts, folder-structure.ts, match-movimientos.ts, pagos-pendientes.ts, plus test files)
- New tests: yes (5 test additions/modifications)

**Key Decisions:**
- Item #2 fix converts ISO timestamp before `batchUpdate()` rather than modifying `batchUpdate()` itself (less invasive)
- Item #3 fix uses a `failedKeys` Set rather than removing promise caching entirely (preserves thundering herd protection)
- Item #4 fix adds `movimientosSpreadsheets` cache to FolderStructure and uses it in `matchAllMovimientos()` instead of the incorrectly-used `bankSpreadsheets`

**Dependencies/Prerequisites:**
- None - all tasks are independent and can be implemented in any order

---

## Iteration 1

### Completed

**Task 1: Fix SALDO INICIAL number formatting** ✓
- Added test in `movimientos-store.test.ts:245-267` verifying `saldoCalculado` is wrapped as `CellNumber`
- Fixed `movimientos-store.ts:85` to wrap `initialRow[5]` in `CellNumber`

**Task 2: Fix processedAt timestamp formatting for retry files** ✓
- Added test in `storage/index.test.ts:106-135` verifying serial number conversion
- Fixed `storage/index.ts:94-101` to use `dateToSerialInTimezone()` before `batchUpdate()`

**Task 3: DuplicateCache failed promise caching** - NOT A BUG
- Investigation: The test at `duplicate-cache.test.ts:621-668` PASSES with current code
- The existing implementation already deletes failed promises (lines 40-42) enabling retry
- No fix needed - the plan incorrectly identified this as a bug

**Task 4: Fix matchAllMovimientos using empty bankSpreadsheets Map** ✓
- Added `movimientosSpreadsheets: Map<string, string>` to `FolderStructure` interface (`types/index.ts:1017`)
- Initialize `movimientosSpreadsheets: new Map()` in `folder-structure.ts:578`
- Cache spreadsheet ID in `getOrCreateMovimientosSpreadsheet()` (`folder-structure.ts:1501-1503`)
- Updated `match-movimientos.ts:784` to destructure `movimientosSpreadsheets`
- Updated `match-movimientos.ts:805` to iterate over `movimientosSpreadsheets`
- Added test in `match-movimientos.test.ts:271-327` verifying the correct Map is used

**Task 5: Sort Pagos Pendientes by fechaEmision ascending** ✓
- Added test in `pagos-pendientes.test.ts:400-461` verifying sort order
- Fixed `pagos-pendientes.ts:86-95` to sort by `fechaEmision` before writing

### Review Findings

Summary: 0 issues found

Files reviewed: 12
- `src/processing/storage/movimientos-store.ts`
- `src/processing/storage/movimientos-store.test.ts`
- `src/processing/storage/index.ts`
- `src/processing/storage/index.test.ts`
- `src/types/index.ts`
- `src/types/index.test.ts`
- `src/services/folder-structure.ts`
- `src/bank/match-movimientos.ts`
- `src/bank/match-movimientos.test.ts`
- `src/services/pagos-pendientes.ts`
- `src/services/pagos-pendientes.test.ts`
- `src/processing/caches/duplicate-cache.ts`

Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

**Review Details:**

1. **Task 1 (SALDO INICIAL formatting):** Correctly wraps raw number in `CellNumber` type matching the pattern used for other numeric values in the same function.

2. **Task 2 (processedAt timestamp):** Properly fetches timezone via `getSpreadsheetTimezone()` and converts ISO timestamp to serial number using `dateToSerialInTimezone()`. Falls back to UTC when timezone fetch fails.

3. **Task 3 (DuplicateCache):** No changes made - investigation confirmed existing code already handles retries correctly by deleting failed promises.

4. **Task 4 (movimientosSpreadsheets):** Clean implementation adding a new cache Map. Only caches `bancario` type (line 1501-1503) since tarjeta/broker don't have detalle column needing matching. The iteration over the new Map in `matchAllMovimientos` is correct.

5. **Task 5 (Pagos Pendientes sorting):** Uses `localeCompare()` for string comparison which works correctly for ISO date format (YYYY-MM-DD). Sort happens after filtering but before mapping.

**Build & Tests:**
- All 1,363 tests pass
- Zero build warnings

No issues found - all implementations are correct and follow project conventions.

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
