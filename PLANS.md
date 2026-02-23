# Bug Fix Plan

**Created:** 2026-02-23
**Bug Report:** Monetary values written as escaped strings instead of numbers in production spreadsheets. Row 5 of Pagos Recibidos also missing fileName link and has raw ISO processedAt.
**Category:** Storage
**Linear Issues:** [ADV-123](https://linear.app/lw-claude/issue/ADV-123/replace-formatuscurrency-with-cellnumber-for-monetary-spreadsheet), [ADV-124](https://linear.app/lw-claude/issue/ADV-124/fix-batchupdate-reprocessing-path-monetary-strings-missing-links-raw)

## Investigation

### Context Gathered
- **MCPs used:** Google Drive (gsheets_read — production spreadsheet), Linear (issue search)
- **Files examined:** All 5 store files, sheets.ts, numbers.ts, spreadsheet.ts, cascade-matcher.ts, factura-pago-matcher.ts
- **Production evidence:** Spreadsheet `1m9UNuNWvF0toN-Zc4LwGoxakm7BIporiDF844DDps2g`, sheet "Pagos Recibidos"

### Evidence

**Production spreadsheet confirms:**
- All `importePagado` values (column E) are formatted strings like `"5,500.00"` — stored as text, not numbers
- Row 5: `processedAt` is `"2026-02-23T11:10:51.139Z"` (raw ISO) vs other rows with `"2026-02-23 11:07:05"` (formatted)
- Row 5: `fileName` has no hyperlink (plain text)
- Row 5 has `tipoDeCambio` and `importeEnPesos` — indicates it went through quality replacement path

**Code path analysis:**
- `formatUSCurrency()` at `src/utils/numbers.ts:179` returns formatted string `"1,200.00"`
- `convertToSheetsCellData()` at `src/services/sheets.ts:968-991` treats this string as text → `stringValue`
- Negative values (e.g., `"-500.00"`) also get `'` prefix from `sanitizeForSpreadsheet()` (formula injection protection triggers on leading `-`)
- `resumen-store.ts` already uses `CellNumber` correctly — proving the pattern works

**Two code paths affected:**
1. **`appendRowsWithLinks` path** (initial storage): Uses `CellValueOrLink[]` with rich types. `formatUSCurrency()` returns string instead of `CellNumber`.
2. **`batchUpdate` path** (reprocessing/quality replacement): Uses `CellValue[]` (plain types). `formatUSCurrency()` produces strings, `renamedFileName` has no link formula, and `processedAt` isn't timezone-formatted.

### Root Cause

`formatUSCurrency()` was used as the formatting function for monetary values, but it returns a **string** (`"1,200.00"`), not a number. When passed to `appendRowsWithLinks()`, the `convertToSheetsCellData()` function writes it as `stringValue` instead of `numberValue`. The correct approach is `CellNumber` (`{ type: 'number', value }`) which is already used successfully in `resumen-store.ts`.

For the `batchUpdate` path, additional issues exist: no hyperlink formula for fileName, and no timezone conversion for processedAt.

#### Related Code

**appendRowsWithLinks path (Bug 1):**
- `src/processing/storage/factura-store.ts:274-276, 298-300` — `formatUSCurrency(factura.importeNeto/importeIva/importeTotal)` produces strings for 6 monetary cells
- `src/processing/storage/pago-store.ts:354, 376` — `formatUSCurrency(pago.importePagado)` produces strings for 2 monetary cells
- `src/processing/storage/recibo-store.ts:120-122` — `formatUSCurrency(recibo.subtotalRemuneraciones/subtotalDescuentos/totalNeto)` produces strings for 3 monetary cells
- `src/processing/storage/retencion-store.ts:122-123` — `formatUSCurrency(retencion.montoComprobante/montoRetencion)` produces strings for 2 monetary cells
- `src/services/sheets.ts:933-943` — `convertToSheetsCellData` correctly handles `CellNumber` with `numberValue` + `#,##0.00` format
- `src/services/sheets.ts:968-991` — string path: runs `sanitizeForSpreadsheet()` then writes `stringValue`

**batchUpdate path (Bug 2):**
- `src/processing/storage/pago-store.ts:24-73` — `buildPagoRow()` uses `formatUSCurrency` (lines 38, 58), plain string `renamedFileName` (lines 36, 56), raw `pago.processedAt` (lines 44, 64)
- `src/processing/storage/factura-store.ts:25-78` — `buildFacturaRow()` uses `formatUSCurrency` (lines 41-43, 63-65), plain string `renamedFileName` (lines 36, 58), raw `factura.processedAt` (lines 46, 68)
- `src/utils/spreadsheet.ts:26` — `sanitizeForSpreadsheet()` prefixes strings starting with `-` with `'`, breaking negative monetary values
- `src/utils/spreadsheet.ts` — has `createDriveHyperlink(fileId, fileName)` which produces `=HYPERLINK(...)` formula strings compatible with `USER_ENTERED`

### Impact
- All monetary columns across all document types display as text strings in Google Sheets
- Values cannot be summed, filtered numerically, or used in formulas
- Negative values display with `'` prefix (broken)
- Reprocessed/quality-replaced rows lose their fileName hyperlink and have unformatted timestamps
- Affects production data currently being written

## Fix Plan

### Fix 1: Replace formatUSCurrency with CellNumber in appendRowsWithLinks path
**Linear Issue:** [ADV-123](https://linear.app/lw-claude/issue/ADV-123/replace-formatuscurrency-with-cellnumber-for-monetary-spreadsheet)

1. Write tests in each store's test file verifying that monetary fields produce `CellNumber` objects (not strings) in the row arrays passed to `appendRowsWithLinks`:
   - `src/processing/storage/factura-store.test.ts` — verify importeNeto, importeIva, importeTotal are `{ type: 'number', value: <number> }`
   - `src/processing/storage/pago-store.test.ts` — verify importePagado is `CellNumber`
   - `src/processing/storage/recibo-store.test.ts` — verify subtotalRemuneraciones, subtotalDescuentos, totalNeto are `CellNumber`
   - `src/processing/storage/retencion-store.test.ts` — verify montoComprobante, montoRetencion are `CellNumber`
   - Mock `appendRowsWithLinks` and capture the row argument to assert cell types
   - Follow existing test patterns in each file (they already mock sheets functions)
   - Run `verifier` filtered to storage tests — expect fail

2. Replace `formatUSCurrency(value)` with `{ type: 'number', value: value } as CellNumber` in each store file:
   - `src/processing/storage/factura-store.ts` lines 274-276, 298-300 (6 replacements)
   - `src/processing/storage/pago-store.ts` lines 354, 376 (2 replacements)
   - `src/processing/storage/recibo-store.ts` lines 120-122 (3 replacements) — also add `CellNumber` to the import from sheets.ts
   - `src/processing/storage/retencion-store.ts` lines 122-123 (2 replacements) — also add `CellNumber` to the import from sheets.ts
   - Handle null/undefined: use pattern `value != null ? { type: 'number', value } : ''` where the field is optional
   - Run `verifier` filtered to storage tests — expect pass

**Notes:**
- `factura-store.ts` and `pago-store.ts` already import `CellNumber` from sheets.ts
- `recibo-store.ts` and `retencion-store.ts` do NOT import `CellNumber` — add to import
- Follow the exact pattern used in `resumen-store.ts:185-186` which already works correctly
- `confidence` field (e.g., `pago.confidence`) is already a plain number, which `convertToSheetsCellData` handles at line 994-997 as `numberValue` without formatting — this is correct, leave it as-is

### Fix 2: Fix batchUpdate reprocessing path
**Linear Issue:** [ADV-124](https://linear.app/lw-claude/issue/ADV-124/fix-batchupdate-reprocessing-path-monetary-strings-missing-links-raw)

1. Write tests for `buildPagoRow` and `buildFacturaRow`:
   - `src/processing/storage/pago-store.test.ts` — test that `buildPagoRow` produces raw numbers for importePagado (not formatted strings), `=HYPERLINK(...)` formula for fileName, and formatted processedAt (not raw ISO)
   - `src/processing/storage/factura-store.test.ts` — test that `buildFacturaRow` produces raw numbers for importeNeto/importeIva/importeTotal, `=HYPERLINK(...)` for fileName, and formatted processedAt
   - These functions are currently private — export them for testing (or test indirectly through the store function with a reprocessing scenario)
   - Run `verifier` filtered to storage tests — expect fail

2. Fix `buildPagoRow` in `src/processing/storage/pago-store.ts`:
   - Replace `formatUSCurrency(pago.importePagado)` (lines 38, 58) with raw `pago.importePagado` — `USER_ENTERED` correctly interprets plain numbers
   - Replace `renamedFileName` (lines 36, 56) with `createDriveHyperlink(pago.fileId, renamedFileName)` from `src/utils/spreadsheet.ts` — `USER_ENTERED` interprets `=HYPERLINK(...)` formulas
   - Add `timeZone?: string` parameter to `buildPagoRow`. In calling locations (lines 233, 290), fetch timezone from spreadsheet (already available via `getSpreadsheetTimezone`) and pass it. Format `pago.processedAt` using the same timezone logic as `appendRowsWithLinks` — convert ISO timestamp to local time string like `"2026-02-23 11:07:05"` before passing to row

3. Fix `buildFacturaRow` in `src/processing/storage/factura-store.ts`:
   - Same three fixes: raw numbers for monetary fields, `createDriveHyperlink` for fileName, timezone-formatted processedAt
   - Add `timeZone?: string` parameter, fetch and pass from calling location (line 187)
   - Run `verifier` filtered to storage tests — expect pass

**Notes:**
- `batchUpdate` uses `USER_ENTERED` value input option (`src/services/sheets.ts:293`), which correctly interprets: plain numbers as numeric cells, `=HYPERLINK(...)` as formula cells, and plain strings as text
- `createDriveHyperlink` is already imported in some files or available from `src/utils/spreadsheet.ts` — add import where needed
- For `processedAt` formatting: extract the ISO-to-local conversion logic. The simplest approach is to format the timestamp before building the row using a helper (e.g., `formatTimestampForSheet(isoString, timeZone)`) that produces `"YYYY-MM-DD HH:mm:ss"` format. This can reuse the `dateToSerialInTimezone` approach or simply format with `Intl.DateTimeFormat`.
- The `getSpreadsheetTimezone` call is already present in `storePago` (line 394) and `storeFactura` (line 316) — move it earlier so both append and batchUpdate paths can use it, or call it in the reprocessing branch too

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Iteration 1

**Implemented:** 2026-02-23
**Method:** Single-agent (1 work unit, effort 4 — no parallelism benefit)

### Tasks Completed This Iteration
- Fix 1 (ADV-123): Replace formatUSCurrency with CellNumber in appendRowsWithLinks path — replaced 13 `formatUSCurrency()` calls with `CellNumber` objects across 4 store files, cleaned up unused imports in recibo-store.ts and retencion-store.ts
- Fix 2 (ADV-124): Fix batchUpdate reprocessing path — replaced formatted strings with raw numbers, added `createDriveHyperlink()` for fileName, added `formatTimestampInTimezone()` for processedAt, moved `getSpreadsheetTimezone()` to top of `withLock` callback for both paths

### Files Modified
- `src/processing/storage/factura-store.ts` — CellNumber for monetary fields, buildFacturaRow: raw numbers + hyperlink + timezone processedAt
- `src/processing/storage/factura-store.test.ts` — Tests for CellNumber and batchUpdate path fixes
- `src/processing/storage/pago-store.ts` — CellNumber for monetary fields, buildPagoRow: raw numbers + hyperlink + timezone processedAt
- `src/processing/storage/pago-store.test.ts` — Tests for CellNumber and batchUpdate path fixes
- `src/processing/storage/recibo-store.ts` — CellNumber for monetary fields, removed formatUSCurrency import
- `src/processing/storage/recibo-store.test.ts` — Tests for CellNumber
- `src/processing/storage/retencion-store.ts` — CellNumber for monetary fields, removed formatUSCurrency import
- `src/processing/storage/retencion-store.test.ts` — Tests for CellNumber

### Linear Updates
- ADV-123: Todo → In Progress → Review
- ADV-124: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found
- verifier: All 1,745 tests pass, zero warnings

### Continuation Status
All tasks completed.

### Review Findings

Summary: 2 issue(s) found (Team: security, reliability, quality reviewers)
- FIX: 2 issue(s) — Linear issues created
- DISCARDED: 6 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [MEDIUM] BUG: Missing reprocessing path in recibo-store.ts / retencion-store.ts — `storeRecibo` and `storeRetencion` lack `findRowByFileId` check; reprocessed files are incorrectly marked as duplicates instead of updated in-place (ADV-125)
- [MEDIUM] TEST: Missing `withLock` mock in pago-store.test.ts, recibo-store.test.ts, retencion-store.test.ts — tests use real lock implementation with shared mutable state, risking flakiness (ADV-126)

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: Lock key collision from malicious PDF fields — theoretical DoS at most, not exploitable; spreadsheet-based duplicate check remains intact
- [DISCARDED] SECURITY: sheetName interpolation in range strings — all callers use hardcoded string literals, not exploitable
- [DISCARDED] SECURITY: CUIT format validation — internal inputs from Gemini extraction, low risk
- [DISCARDED] TEST: Missing error path tests in recibo-store.test.ts and retencion-store.test.ts — test coverage improvement, not a bug
- [DISCARDED] CONVENTION: Module name 'retencion-store' instead of 'storage' in retencion-store.ts — style preference not enforced by CLAUDE.md
- [DISCARDED] CONVENTION: Indentation inconsistency in factura-store.ts — style-only, zero correctness impact

### Linear Updates
- ADV-123: Review → Merge (original task)
- ADV-124: Review → Merge (original task)
- ADV-125: Created in Todo (Fix: Missing reprocessing path in recibo/retencion stores)
- ADV-126: Created in Todo (Fix: Missing withLock mock in 3 test files)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [ADV-125](https://linear.app/lw-claude/issue/ADV-125/add-reprocessing-path-findrowbyfileid-batchupdate-to-recibo-store-and), [ADV-126](https://linear.app/lw-claude/issue/ADV-126/add-missing-withlock-mock-to-pago-store-recibo-store-and-retencion)

### Fix 1: Add reprocessing path to recibo-store and retencion-store
**Linear Issue:** [ADV-125](https://linear.app/lw-claude/issue/ADV-125/add-reprocessing-path-findrowbyfileid-batchupdate-to-recibo-store-and)

1. Write tests in `src/processing/storage/recibo-store.test.ts` and `src/processing/storage/retencion-store.test.ts`:
   - Test that when `findRowByFileId` returns a matching row index, the store calls `batchUpdate` to update in-place instead of marking as duplicate
   - Test that the reprocessing row includes raw numbers for monetary fields, `=HYPERLINK(...)` for fileName, and timezone-formatted processedAt
   - Follow the reprocessing test patterns from `factura-store.test.ts` and `pago-store.test.ts`
   - Run `verifier` filtered to storage tests — expect fail

2. Add `findRowByFileId` check in `storeRecibo` (before the business-key duplicate check):
   - Import `findRowByFileId` from sheets service
   - If fileId already has a row, call `batchUpdate` with `buildReciboRow()` to update in-place
   - Create `buildReciboRow(recibo, renamedFileName, timeZone?)` function following `buildPagoRow` pattern:
     raw numbers for monetary fields, `createDriveHyperlink()` for fileName, timezone-formatted processedAt

3. Add same reprocessing path in `storeRetencion`:
   - Same pattern: `findRowByFileId` check + `buildRetencionRow()` + `batchUpdate`
   - Run `verifier` filtered to storage tests — expect pass

### Fix 2: Add missing withLock mock to 3 test files
**Linear Issue:** [ADV-126](https://linear.app/lw-claude/issue/ADV-126/add-missing-withlock-mock-to-pago-store-recibo-store-and-retencion)

1. Add `vi.mock('../../utils/concurrency.js', ...)` to `src/processing/storage/pago-store.test.ts`, `src/processing/storage/recibo-store.test.ts`, and `src/processing/storage/retencion-store.test.ts` — matching the pattern in `factura-store.test.ts`
2. Run `verifier` filtered to storage tests — expect pass

---

## Iteration 2

**Implemented:** 2026-02-23
**Method:** Single-agent (Fix Plan from review)

### Tasks Completed This Iteration
- Fix 1 (ADV-125): Add reprocessing path to recibo-store and retencion-store — added `findRowByFileId`, `buildReciboRow`/`buildRetencionRow`, reprocessing check before duplicate check, `StoreResult` return type
- Fix 2 (ADV-126): Add missing withLock mock to 3 test files — added `vi.mock('../../utils/concurrency.js', ...)` to pago-store.test.ts, recibo-store.test.ts, retencion-store.test.ts
- Bug-hunter fixes: Fixed duplicate detection tests to use `mockResolvedValueOnce` chains (recibo-store.test.ts, retencion-store.test.ts), fixed retencion-store.ts append path to use `generateRetencionFileName` instead of `retencion.fileName`

### Files Modified
- `src/processing/storage/recibo-store.ts` — Added reprocessing path (findRowByFileId, buildReciboRow, batchUpdate), StoreResult return type
- `src/processing/storage/recibo-store.test.ts` — Added withLock mock, reprocessing tests, fixed duplicate detection mocks
- `src/processing/storage/retencion-store.ts` — Added reprocessing path (findRowByFileId, buildRetencionRow, batchUpdate), StoreResult return type, fixed append path fileName
- `src/processing/storage/retencion-store.test.ts` — Added withLock mock, reprocessing tests, fixed duplicate detection mocks
- `src/processing/storage/pago-store.test.ts` — Added withLock mock

### Linear Updates
- ADV-125: Todo → In Progress → Review → Merge
- ADV-126: Todo → In Progress → Review → Merge

### Pre-commit Verification
- bug-hunter: Passed — no bugs found (second run after fixing 3 bugs from first run)
- verifier: All 1,755 tests pass, zero warnings

### Review Findings

Files reviewed: 5
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found after bug-hunter fixes — all implementations correct and follow project conventions.

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.

---

## Plan Summary

**Problem:** All monetary values in production spreadsheets are stored as text strings instead of numbers, caused by `formatUSCurrency()` returning formatted strings. Reprocessed rows additionally lose their fileName hyperlink and have unformatted timestamps.

**Root Cause:** `formatUSCurrency()` returns a string like `"1,200.00"` which `convertToSheetsCellData()` writes as `stringValue` (text). The correct approach is `CellNumber` (`{ type: 'number', value }`) which writes `numberValue` with `#,##0.00` formatting. The `batchUpdate` reprocessing path has the same issue plus missing hyperlink formulas and raw ISO timestamps.

**Linear Issues:** ADV-123, ADV-124

**Solution Approach:** Replace all `formatUSCurrency()` calls in the `appendRowsWithLinks` path with `CellNumber` objects (13 replacements across 4 store files). For the `batchUpdate` reprocessing path, use raw numbers (USER_ENTERED handles them), `createDriveHyperlink()` for fileName, and timezone-formatted processedAt.

**Scope:**
- Files affected: 4 store files + their test files
- New tests: yes
- Breaking changes: no — values will change from text to numbers in spreadsheets (improvement, not breaking)

**Risks/Considerations:**
- Existing production data has text values — manually correcting existing rows is out of scope (new writes will be correct)
- `formatUSCurrency` import may become unused in some store files after fix — clean up unused imports
