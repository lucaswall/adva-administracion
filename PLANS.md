# Implementation Plan

**Created:** 2026-02-24
**Source:** Inline request: Fix A (updateRowsWithFormatting) + Fix C (normalizeTimestamp) + Dashboard processedAt startup migration
**Linear Issues:** [ADV-152](https://linear.app/lw-claude/issue/ADV-152/add-updaterowswithformatting-to-sheetsts), [ADV-153](https://linear.app/lw-claude/issue/ADV-153/add-normalizetimestamp-utility-for-reading-processedat-from-sheets), [ADV-154](https://linear.app/lw-claude/issue/ADV-154/use-updaterowswithformatting-in-storage-reprocessing-paths), [ADV-155](https://linear.app/lw-claude/issue/ADV-155/fix-dashboard-processedat-and-pagos-pendientes-date-passthrough), [ADV-156](https://linear.app/lw-claude/issue/ADV-156/startup-migration-fix-existing-dashboard-processedat-format)

## Context Gathered

### Codebase Analysis

**Core write functions in sheets.ts:**
- `appendRowsWithLinks` (line 1036) — uses `spreadsheets.batchUpdate` with `appendCells`, calls `convertToSheetsCellData` for rich formatting (CellDate, CellNumber, CellLink, ISO→serial conversion)
- `batchUpdate` (line 284) — uses `spreadsheets.values.batchUpdate` with `USER_ENTERED`, flat `CellValue[]` only
- `formatEmptyMonthSheet` (line 1523) — already uses `updateCells` pattern with grid coordinates (template for new function)
- `convertToSheetsCellData` (line 909) — existing cell conversion logic to reuse
- `columnIndexToLetter` (line 19) — exists, reverse `columnLetterToIndex` needed

**Storage modules with dual write paths:**
- `src/processing/storage/factura-store.ts` — `buildFacturaRow` (line 27) + `batchUpdate` (line 200) vs `appendRowsWithLinks` (line 326)
- `src/processing/storage/pago-store.ts` — `buildPagoRow` (line 26) + `batchUpdate` (lines 245, 302) vs `appendRowsWithLinks` (line 404)
- `src/processing/storage/recibo-store.ts` — `buildReciboRow` (line 25) + `batchUpdate` (line 152) vs `appendRowsWithLinks` (line 234)
- `src/processing/storage/retencion-store.ts` — `buildRetencionRow` (line 26) + `batchUpdate` (line 156) vs `appendRowsWithLinks` (line 247)
- `src/processing/storage/index.ts` — `batchUpdate` (line 97, ADV-105 workaround) vs `appendRowsWithLinks` (line 116)

**Read-side processedAt sites using String():**
- `src/processing/matching/factura-pago-matcher.ts:343,376`
- `src/processing/matching/recibo-pago-matcher.ts:310,336`

**Date utility patterns:**
- `src/utils/date.ts` — `normalizeSpreadsheetDate` (line 199) handles serial→date string, `serialToDateString` (line 180) for date-only serial conversion
- `src/processing/storage/index.ts:351-360` — `getStaleProcessingFileIds` handles both serial and string processedAt (reference implementation)

**Pagos-pendientes passthrough:**
- `src/services/pagos-pendientes.ts:142-153` — reads serial numbers from getValues, passes raw to setValues

**Existing migration pattern:**
- `src/services/migrations.ts` — `migrateMovimientosColumns` reads sheet data, identifies rows needing migration, uses `batchUpdate` to fix. `runStartupMigrations` iterates spreadsheets from folder structure.

### Test Conventions
- Colocated `*.test.ts` files
- `vi.mock` for googleapis, google-auth
- Mock `getSheetsService` returning mock API
- Existing sheets.test.ts has patterns for all sheets functions

## Original Plan

### Task 1: Add updateRowsWithFormatting to sheets.ts
**Linear Issue:** [ADV-152](https://linear.app/lw-claude/issue/ADV-152/add-updaterowswithformatting-to-sheetsts)

1. Write tests in `src/services/sheets.test.ts`:
   - Test `columnLetterToIndex`: A→1, Z→26, AA→27, AZ→52
   - Test `parseA1Range`: `'Sheet1'!A5:S5` → `{ sheetName: 'Sheet1', startCol: 0, endCol: 18, startRow: 4, endRow: 4 }`
   - Test `parseA1Range` with escaped sheet names: `'Sheet ''1'''!A5` → sheetName `Sheet '1'`
   - Test `updateRowsWithFormatting` with a CellDate value → mock verifies `updateCells` request has `numberValue` + DATE format
   - Test `updateRowsWithFormatting` with a CellNumber value → mock verifies `numberValue` + NUMBER `#,##0.00` format
   - Test `updateRowsWithFormatting` with ISO timestamp string → mock verifies DATE_TIME serial conversion
   - Test `updateRowsWithFormatting` with multiple rows → mock verifies multiple `updateCells` requests in single `batchUpdate` call
   - Test metadata cache path (cache hit vs fresh lookup)
2. Run verifier with pattern "sheets" (expect fail)
3. Implement in `src/services/sheets.ts`:
   - Add `columnLetterToIndex(letter: string): number` — reverse of `columnIndexToLetter`. Export it.
   - Add internal `parseA1Range(range: string): { sheetName: string; startCol: number; endCol: number; startRow: number; endRow: number }` — parses A1 notation like `'Sheet Name'!A5:S5` into 0-indexed grid coordinates. Handle quoted sheet names (single quotes, doubled-quote escapes).
   - Add exported `updateRowsWithFormatting(spreadsheetId, updates, timeZone?, metadataCache?)`:
     - `updates`: `Array<{ range: string; values: CellValueOrLink[] }>` — each entry is a single row
     - Group updates by sheet name for efficient metadata lookups
     - For each group: resolve sheetName→sheetId via metadata (use cache if provided)
     - Build `updateCells` requests using `convertToSheetsCellData` for each cell value
     - Send all requests in a single `spreadsheets.batchUpdate` call
     - Wrap in `withQuotaRetry`
   - Follow the pattern of `formatEmptyMonthSheet` (line 1562-1576) for `updateCells` request structure
   - The `fields` parameter should be `'userEnteredValue,userEnteredFormat,textFormatRuns'` to cover all cell data types (values, formats, and link formatting)
4. Run verifier with pattern "sheets" (expect pass)

**Notes:**
- `updateCells` requires 0-indexed `GridRange` with `sheetId`, `startRowIndex`, `endRowIndex`, `startColumnIndex`, `endColumnIndex`
- A1 `A5:S5` → startRow=4, endRow=5, startCol=0, endCol=19 (endRow/endCol are exclusive in GridRange)
- Multiple `updateCells` requests can be batched in a single API call (array of requests)

### Task 2: Add normalizeTimestamp utility
**Linear Issue:** [ADV-153](https://linear.app/lw-claude/issue/ADV-153/add-normalizetimestamp-utility-for-reading-processedat-from-sheets)

1. Write tests in `src/utils/date.test.ts`:
   - Test serial number input (e.g., `45993.604`) → returns `"2025-12-02 14:29:46"` (YYYY-MM-DD HH:MM:SS)
   - Test integer serial (e.g., `45993`) → returns `"2025-12-02 00:00:00"`
   - Test ISO string input → returned as-is
   - Test formatted string input (e.g., `"2025-12-02 14:30:00"`) → returned as-is
   - Test null/undefined → returns `''`
   - Test empty string → returns `''`
2. Run verifier with pattern "date" (expect fail)
3. Implement `normalizeTimestamp(value: unknown): string` in `src/utils/date.ts`:
   - If `typeof value === 'number'`: convert serial to datetime string using Sheets epoch (1899-12-30), extract hours/minutes/seconds from fractional part
   - If `typeof value === 'string'`: return as-is
   - Otherwise: return `''`
   - Reference: `getStaleProcessingFileIds` in `storage/index.ts:354-357` for serial→timestamp conversion logic
4. Replace `String(row[N])` with `normalizeTimestamp(row[N])` in:
   - `src/processing/matching/factura-pago-matcher.ts:343` — `processedAt: normalizeTimestamp(row[12])`
   - `src/processing/matching/factura-pago-matcher.ts:376` — `processedAt: normalizeTimestamp(row[10])`
   - `src/processing/matching/recibo-pago-matcher.ts:310` — `processedAt: normalizeTimestamp(row[13])`
   - `src/processing/matching/recibo-pago-matcher.ts:336` — `processedAt: normalizeTimestamp(row[10])`
   - Add import of `normalizeTimestamp` from `../../utils/date.js` in both matcher files
5. Run verifier with pattern "date" (expect pass)

### Task 3: Use updateRowsWithFormatting in storage reprocessing paths
**Linear Issue:** [ADV-154](https://linear.app/lw-claude/issue/ADV-154/use-updaterowswithformatting-in-storage-reprocessing-paths)

**Depends on:** Task 1 (updateRowsWithFormatting must exist)

1. Write tests in each storage module's test file:
   - `src/processing/storage/factura-store.test.ts`: Test that reprocessing path (fileId already exists) calls `updateRowsWithFormatting` instead of `batchUpdate`. Verify the row passed contains CellDate for fechaEmision, CellNumber for monetary values, CellLink for fileName.
   - `src/processing/storage/pago-store.test.ts`: Same pattern for pago reprocessing and quality replacement paths.
   - `src/processing/storage/recibo-store.test.ts`: Same pattern for recibo reprocessing.
   - `src/processing/storage/retencion-store.test.ts`: Same pattern for retencion reprocessing.
2. Run verifier (expect fail — tests call updateRowsWithFormatting which reprocessing paths don't use yet)
3. Implement per module — the pattern is the same for all four:

   **For each storage module (factura-store, pago-store, recibo-store, retencion-store):**
   a. Extract the row-building code from the append path into a shared function (e.g., `buildFacturaRowFormatted`) that returns `CellValueOrLink[]`. This is the code that creates CellDate, CellNumber, CellLink objects. The shared function takes the same parameters as the current `buildRow` + the fields needed for rich types (timeZone for processedAt, fileId for CellLink URL).
   b. Update the append path to call the shared builder, then pass the row to `appendRowsWithLinks` (same as before, just extracted).
   c. Update the reprocessing path to call the shared builder, then pass the row to `updateRowsWithFormatting` instead of `batchUpdate`.
   d. Remove the old `buildFacturaRow`/`buildPagoRow`/`buildReciboRow`/`buildRetencionRow` functions.
   e. Add import of `updateRowsWithFormatting` from `../../services/sheets.js`.

   **Key difference between append and reprocessing paths:**
   - Append: `appendRowsWithLinks(spreadsheetId, range, [row], timeZone, metadataCache)`
   - Reprocessing: `updateRowsWithFormatting(spreadsheetId, [{ range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`, values: row }], timeZone, metadataCache)`

4. Run verifier (expect pass)

**Notes:**
- The `formatTimestampInTimezone` import in each storage module can be removed once `buildRow` functions are deleted (processedAt will be the raw ISO string, and `convertToSheetsCellData` in `updateRowsWithFormatting` will handle timezone conversion).
- `createDriveHyperlink` usage in buildRow can be replaced with `CellLink` objects (same as append path).

### Task 4: Fix Dashboard processedAt and pagos-pendientes
**Linear Issue:** [ADV-155](https://linear.app/lw-claude/issue/ADV-155/fix-dashboard-processedat-and-pagos-pendientes-date-passthrough)

**Depends on:** Task 1 (updateRowsWithFormatting)

1. Write tests:
   - In `src/processing/storage/index.test.ts` (or relevant test file): Test `markFileProcessing` retry path produces a cell with DATE_TIME format (mock `updateRowsWithFormatting` and verify call args).
   - In `src/services/pagos-pendientes.test.ts` (or create if needed): Test that serial number fechaEmision values from source sheet are converted to date strings before writing. Mock `getValues` to return serial numbers, verify `setValues` receives date strings.
2. Run verifier (expect fail)
3. Fix `src/processing/storage/index.ts`:
   - In `markFileProcessing` retry path (line 97-98): Replace `batchUpdate` with `updateRowsWithFormatting` for the processedAt cell. Build the update with the ISO string as the value (convertToSheetsCellData will detect it and convert to DATE_TIME serial).
   - Actually, the full row update at line 97-98 writes `[processedAt, documentType, 'processing', '']` to columns C:F. Only column C (processedAt) needs rich formatting. Simplest approach: use `updateRowsWithFormatting` for just the processedAt cell (column C), and keep `batchUpdate` for the other columns (D:F are plain strings). OR use `updateRowsWithFormatting` for all four columns — the non-date columns will just be strings passed through `convertToSheetsCellData` as `stringValue`.
   - Remove the ADV-105 comment (lines 95-96).
   - Add import of `updateRowsWithFormatting`.
4. Fix `src/services/pagos-pendientes.ts`:
   - In the mapping at line 142-153: for `row[fechaEmisionIdx]`, check if it's a number (serial) and convert using `normalizeSpreadsheetDate` from `utils/date.js`. This produces a YYYY-MM-DD string that `USER_ENTERED` in `setValues` will correctly parse as a date.
   - Add import of `normalizeSpreadsheetDate` from `../utils/date.js`.
5. Run verifier (expect pass)

### Task 5: Startup migration for existing Dashboard processedAt
**Linear Issue:** [ADV-156](https://linear.app/lw-claude/issue/ADV-156/startup-migration-fix-existing-dashboard-processedat-format)

**Depends on:** Task 1 (updateRowsWithFormatting)

**Migration note:** Affects production Dashboard Operativo Contable spreadsheet (Archivos Procesados sheet, column C). Non-destructive and idempotent.

1. Write tests in `src/services/migrations.test.ts` (create file if needed):
   - Test `migrateDashboardProcessedAt`: mock `getValues` returning rows with mixed processedAt formats (some serial numbers, some ISO strings, some formatted strings, some empty). Verify `updateRowsWithFormatting` is called with the correct ISO string values for string rows, and that serial-number rows are also re-written (to re-apply DATE_TIME format). Empty rows should be skipped.
   - Test idempotency: calling migration twice with same data should produce same result.
   - Test no-op case: all processedAt values already properly formatted → no updates needed (or updates are harmless re-applications).
2. Run verifier with pattern "migration" (expect fail)
3. Implement `migrateDashboardProcessedAt` in `src/services/migrations.ts`:
   - Takes `dashboardId: string` parameter
   - Read `Archivos Procesados!A:F` via `getValues`
   - Get spreadsheet timezone via `getSpreadsheetTimezone`
   - For each data row (skip header):
     - Column C (index 2) is processedAt
     - If empty → skip
     - If string (ISO or formatted) → include in update batch (will be converted to proper DATE_TIME serial by `convertToSheetsCellData`)
     - If number (already serial) → include in update batch too (to ensure DATE_TIME format is applied, since some serials may lack format from direct API writes)
   - Build updates array: `{ range: 'Archivos Procesados!C${rowNum}', values: [processedAtValue] }` for each row needing migration
   - If any updates needed, call `updateRowsWithFormatting(dashboardId, updates, timeZone)`
   - Log migration count
4. Update `runStartupMigrations` in `src/services/migrations.ts`:
   - Get Dashboard spreadsheet ID from `folderStructure.dashboardSpreadsheetId` (verify this field exists in `getCachedFolderStructure()` return type)
   - Call `migrateDashboardProcessedAt(dashboardId)` after existing migrations
5. Run verifier with pattern "migration" (expect pass)

**Notes:**
- For string processedAt values: pass the raw string to `updateRowsWithFormatting`. The `isISOTimestamp` check in `convertToSheetsCellData` will convert ISO strings to DATE_TIME serials. Non-ISO formatted strings (e.g., "2025-01-15 11:30:00") won't match `isISOTimestamp` — for these, convert to ISO first using `new Date(value).toISOString()` before passing (if valid date).
- For serial processedAt values: pass the number directly. `convertToSheetsCellData` for numbers just creates `numberValue` without format. To apply DATE_TIME format, wrap in a new `CellDateTime` type, OR handle specially in the migration. Simplest: convert serial back to ISO string using the epoch math, then pass the ISO string which `convertToSheetsCellData` will re-serialize with proper format.
- The migration should chunk updates to avoid hitting Sheets API limits (use `SHEETS_BATCH_UPDATE_LIMIT` from config).

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Ensure all spreadsheet date/timestamp cells use proper DATE_TIME formatting via `updateRowsWithFormatting`, and all read paths handle serial numbers correctly.

**Request:** Fix A (create `updateRowsWithFormatting` for updating existing rows with rich formatting) + Fix C (add `normalizeTimestamp` for reading processedAt) + Dashboard processedAt startup migration.

**Linear Issues:** ADV-152, ADV-153, ADV-154, ADV-155, ADV-156

**Approach:** Create a new `updateRowsWithFormatting` function in sheets.ts that mirrors `appendRowsWithLinks` but uses `updateCells` for existing rows. Replace all storage reprocessing paths that use `batchUpdate` with flat values. Add `normalizeTimestamp` utility for read-side serial number handling. Add startup migration to fix existing Dashboard data.

**Scope:**
- Tasks: 5
- Files affected: ~15 (sheets.ts, date.ts, 4 storage modules, 2 matchers, index.ts, pagos-pendientes.ts, migrations.ts, + test files)
- New tests: yes

**Key Decisions:**
- Use `updateCells` in `spreadsheets.batchUpdate` API (not `values.batchUpdate`) to get rich cell formatting
- Reuse existing `convertToSheetsCellData` for consistent cell conversion
- Extract shared row builders from append paths to serve both append and reprocessing paths
- Migration re-writes ALL processedAt values (both string and serial) to ensure consistent DATE_TIME format

**Risks/Considerations:**
- `updateRowsWithFormatting` requires A1→grid coordinate parsing and sheet metadata lookup — adds one API call per unique sheet (cacheable)
- Storage module refactoring touches 4 modules with similar patterns — risk of copy-paste errors across modules
- Migration is idempotent but adds API calls at startup — should be efficient (batch all updates in single call per Dashboard)
- Pagos-pendientes fix uses `normalizeSpreadsheetDate` which strips time info from dates — acceptable since fechaEmision is date-only

---

## Iteration 1

**Implemented:** 2026-02-24
**Method:** Agent team (2 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Add updateRowsWithFormatting to sheets.ts - Added `columnLetterToIndex`, `parseA1Range`, `updateRowsWithFormatting` with full CellDate/CellNumber/CellLink support (worker-1)
- Task 2: Add normalizeTimestamp utility - Converts serial numbers to YYYY-MM-DD HH:MM:SS, replaced String() in 4 matcher sites (worker-2)
- Task 3: Use updateRowsWithFormatting in storage reprocessing paths - Refactored all 4 storage modules with shared `buildXxxRowFormatted` builders (worker-1)
- Task 4: Fix Dashboard processedAt and pagos-pendientes - markFileProcessing uses updateRowsWithFormatting, pagos-pendientes converts serial fechaEmision (worker-2)
- Task 5: Startup migration for Dashboard processedAt - migrateDashboardProcessedAt converts all processedAt to DATE_TIME format (worker-2)

### Files Modified
- `src/services/sheets.ts` - Added columnLetterToIndex, parseA1Range, updateRowsWithFormatting
- `src/services/sheets.test.ts` - 6 new tests for updateRowsWithFormatting + helpers
- `src/utils/date.ts` - Added normalizeTimestamp
- `src/utils/date.test.ts` - 8 new tests for normalizeTimestamp
- `src/processing/storage/factura-store.ts` - Shared row builder, updateRowsWithFormatting in reprocessing
- `src/processing/storage/factura-store.test.ts` - Updated for new reprocessing path
- `src/processing/storage/pago-store.ts` - Same refactor pattern
- `src/processing/storage/pago-store.test.ts` - Updated tests
- `src/processing/storage/recibo-store.ts` - Same refactor pattern
- `src/processing/storage/recibo-store.test.ts` - Updated tests
- `src/processing/storage/retencion-store.ts` - Same refactor pattern
- `src/processing/storage/retencion-store.test.ts` - Updated tests
- `src/processing/matching/factura-pago-matcher.ts` - normalizeTimestamp for processedAt
- `src/processing/matching/recibo-pago-matcher.ts` - normalizeTimestamp for processedAt
- `src/processing/storage/index.ts` - updateRowsWithFormatting in retry path
- `src/processing/storage/index.test.ts` - Updated retry path tests
- `src/services/pagos-pendientes.ts` - normalizeSpreadsheetDate for fechaEmision
- `src/services/pagos-pendientes.test.ts` - New test for serial fechaEmision
- `src/services/migrations.ts` - migrateDashboardProcessedAt + runStartupMigrations update
- `src/services/migrations.test.ts` - 7 new migration tests

### Linear Updates
- ADV-152: Todo → In Progress → Review
- ADV-153: Todo → In Progress → Review
- ADV-154: Todo → In Progress → Review
- ADV-155: Todo → In Progress → Review
- ADV-156: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 bugs (3 HIGH already fixed by merge integration, 1 MEDIUM partial-failure logging fixed)
- verifier: All 1874 tests pass, zero warnings

### Work Partition
- Worker 1: Tasks 1, 3 (sheets.ts foundation + storage reprocessing refactor)
- Worker 2: Tasks 2, 4, 5 (date utilities + Dashboard fixes + migration)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: auto-merge, 3 type mismatches in sheets.ts stub vs real signature (resolved: removed stub, fixed nested→flat values)

### Continuation Status
All tasks completed.
