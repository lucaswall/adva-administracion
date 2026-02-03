# Implementation Plan

**Created:** 2026-02-03
**Source:** Linear Backlog issues
**Linear Issues:** [ADV-57](https://linear.app/adva-administracion/issue/ADV-57/date-serial-number-parsing-broken-in-bank-movimientos-matching), [ADV-58](https://linear.app/adva-administracion/issue/ADV-58/date-serial-number-parsing-broken-in-bank-autofill), [ADV-59](https://linear.app/adva-administracion/issue/ADV-59/date-serial-number-parsing-broken-in-recibo-pago-matcher), [ADV-60](https://linear.app/adva-administracion/issue/ADV-60/date-serial-number-parsing-broken-in-nc-factura-matcher), [ADV-61](https://linear.app/adva-administracion/issue/ADV-61/version-hash-in-movimientos-detalle-uses-raw-serial-number-for-fecha), [ADV-62](https://linear.app/adva-administracion/issue/ADV-62/add-date-handling-guidelines-to-claudemd), [ADV-56](https://linear.app/adva-administracion/issue/ADV-56/dynamic-concurrency-throttling-under-quota-pressure)

## Context Gathered

### Codebase Analysis

**Root cause:** `getValues()` in `sheets.ts` uses `UNFORMATTED_VALUE` + `SERIAL_NUMBER` render options, so `CellDate` fields come back as numbers (e.g., `45993` instead of `"2025-12-23"`). Multiple modules use `String(row[N] || '')` to convert these, producing unparseable strings like `"45993"`. The correct function `normalizeSpreadsheetDate()` in `src/utils/date.ts` handles serial numbers, CellDate objects, and strings.

**Already fixed (correct pattern):**
- `src/processing/matching/factura-pago-matcher.ts:327,363` — uses `normalizeSpreadsheetDate(row[0])`
- `src/processing/caches/duplicate-cache.ts` — uses `normalizeSpreadsheetDate()` throughout
- All storage modules (`factura-store.ts`, `pago-store.ts`, `resumen-store.ts`, `retencion-store.ts`) — use `normalizeSpreadsheetDate()`

**Broken modules (need fix):**

| File | Lines | Date fields | Import needed |
|------|-------|-------------|---------------|
| `src/bank/match-movimientos.ts` | 251, 320, 382, 441, 498 | `fechaEmision` (×3), `fechaPago` (×1), `fechaEmision` (retenciones) | Yes |
| `src/services/movimientos-reader.ts` | 54 | `fecha` | Yes |
| `src/services/movimientos-detalle.ts` | 53 | `fecha` (version hash) | Yes |
| `src/bank/autofill.ts` | 36, 37, 61, 98, 133 | `fecha`, `fechaValor`, `fechaEmision`, `fechaPago` (×2) | Yes |
| `src/processing/matching/recibo-pago-matcher.ts` | 259, 288 | `fechaPago` (×2) | Yes |
| `src/processing/matching/nc-factura-matcher.ts` | 145 | `fechaEmision` | Yes |

**Version hash consistency (ADV-61):**
- `movimientos-detalle.ts:52` `computeVersionFromRow()` hashes `String(row[0])` → serial number
- `match-movimientos.ts:82` `computeRowVersion()` hashes `row.fecha` → value from `movimientos-reader.ts`
- Both MUST produce identical hashes. Currently both use serial numbers (broken but consistent). Fix must update BOTH simultaneously.

**Existing test files for affected modules:**
- `src/bank/match-movimientos.test.ts` — mocks `getValues`, tests orchestration
- `src/bank/autofill.test.ts` — mocks `getValues`, tests autofill logic
- `src/services/movimientos-reader.test.ts` — tests movement reading
- `src/services/movimientos-detalle.test.ts` — tests detalle updates
- `src/processing/matching/nc-factura-matcher.test.ts` — tests NC matching
- `src/processing/matching/recibo-pago-matcher.test.ts` — tests recibo-pago matching
- `src/utils/date.test.ts` — already has `normalizeSpreadsheetDate` tests

**Concurrency system (ADV-56):**
- `withQuotaRetry()` in `src/utils/concurrency.ts` handles per-operation retries (5 retries, 15-65s exponential backoff)
- Google Sheets API limits: 300 read + 300 write requests/min/project
- ~22 call sites use `withQuotaRetry()` (14 in sheets.ts, 8 in drive.ts)
- Current model: each operation independently retries, no global awareness of quota pressure
- `src/utils/concurrency.test.ts` — 591 lines, comprehensive lock and retry tests
- Related constants in `src/config.ts`: `SHEETS_QUOTA_RETRY_CONFIG`, `PARALLEL_SHEET_READ_CHUNK_SIZE = 4`

### MCP Context
- **MCPs used:** Linear (issue details)
- **Findings:** All 7 issues confirmed in Backlog. ADV-57 is Urgent (complete failure of movimientos matching in production). ADV-58-60 are High (matching subsystems broken). ADV-61 is Medium (version hash consistency). ADV-62 is Low (documentation). ADV-56 is Medium (improvement).

## Original Plan

### Task 1: Fix date serial number parsing in movimientos-reader and movimientos-detalle
**Linear Issues:** [ADV-57](https://linear.app/adva-administracion/issue/ADV-57/date-serial-number-parsing-broken-in-bank-movimientos-matching), [ADV-61](https://linear.app/adva-administracion/issue/ADV-61/version-hash-in-movimientos-detalle-uses-raw-serial-number-for-fecha)

ADV-57 and ADV-61 must be fixed together to maintain version hash consistency between `computeVersionFromRow()` and `computeRowVersion()`.

1. Write tests in `src/services/movimientos-reader.test.ts`:
   - Test that `parseMovimientoRow()` (or equivalent row parsing) converts serial number dates via `normalizeSpreadsheetDate`
   - Mock `getValues` to return rows with numeric date values (e.g., `45993`) and verify `fecha` field becomes `"2025-12-23"`
   - Test that string dates pass through unchanged
2. Write tests in `src/services/movimientos-detalle.test.ts`:
   - Test that `computeVersionFromRow()` produces the same hash as `computeRowVersion()` when both receive the same row data with serial number dates
   - Test with numeric date in row[0] (serial number) → both functions must produce identical hash
3. Run verifier (expect fail)
4. Fix `src/services/movimientos-reader.ts`:
   - Add import: `import { normalizeSpreadsheetDate } from '../utils/date.js';`
   - Line 54: Replace `fecha: String(row[0] || '')` with `fecha: normalizeSpreadsheetDate(row[0])`
5. Fix `src/services/movimientos-detalle.ts`:
   - Add import: `import { normalizeSpreadsheetDate } from '../utils/date.js';`
   - Line 53: Replace `const fecha = String(row[0] || '')` with `const fecha = normalizeSpreadsheetDate(row[0])`
6. Run verifier (expect pass)

### Task 2: Fix date serial number parsing in match-movimientos
**Linear Issue:** [ADV-57](https://linear.app/adva-administracion/issue/ADV-57/date-serial-number-parsing-broken-in-bank-movimientos-matching)

5 locations in `match-movimientos.ts` use `String()` for date fields when reading from spreadsheets.

1. Write tests in `src/bank/match-movimientos.test.ts`:
   - Test `parseFacturasEmitidas` with mock data containing serial number dates → verify `fechaEmision` is normalized
   - Test `parseFacturasRecibidas` with serial number dates → verify `fechaEmision` is normalized
   - Test pago parsing with serial number dates → verify `fechaPago` is normalized
   - Test recibo parsing with serial number dates → verify `fechaPago` is normalized
   - Test retencion parsing with serial number dates → verify `fechaEmision` is normalized
2. Run verifier (expect fail)
3. Fix `src/bank/match-movimientos.ts`:
   - Add import: `import { normalizeSpreadsheetDate } from '../utils/date.js';`
   - Line 251: Replace `fechaEmision: String(row[colIndex.fechaEmision] || '')` with `fechaEmision: normalizeSpreadsheetDate(row[colIndex.fechaEmision])`
   - Line 320: Same replacement for `fechaEmision`
   - Line 382: Replace `fechaPago: String(row[colIndex.fechaPago] || '')` with `fechaPago: normalizeSpreadsheetDate(row[colIndex.fechaPago])`
   - Line 441: Same replacement for `fechaPago`
   - Line 498: Replace `fechaEmision: String(row[colIndex.fechaEmision] || '')` with `fechaEmision: normalizeSpreadsheetDate(row[colIndex.fechaEmision])`
4. Run verifier (expect pass)

### Task 3: Fix date serial number parsing in bank autofill
**Linear Issue:** [ADV-58](https://linear.app/adva-administracion/issue/ADV-58/date-serial-number-parsing-broken-in-bank-autofill)

5 date fields in `autofill.ts` use `String()`.

1. Write tests in `src/bank/autofill.test.ts`:
   - Test `parseMovementRow` with serial number in row[0] (fecha) → verify normalized
   - Test `parseMovementRow` with serial number in row[1] (fechaValor) → verify normalized
   - Test factura parsing with serial number in row[0] (fechaEmision) → verify normalized
   - Test pago parsing with serial number in row[0] (fechaPago) → verify normalized
   - Test recibo parsing with serial number in row[0] (fechaPago) → verify normalized
2. Run verifier (expect fail)
3. Fix `src/bank/autofill.ts`:
   - Add import: `import { normalizeSpreadsheetDate } from '../utils/date.js';`
   - Line 36: Replace `fecha: String(row[0] || '')` with `fecha: normalizeSpreadsheetDate(row[0])`
   - Line 37: Replace `fechaValor: String(row[1] || '')` with `fechaValor: normalizeSpreadsheetDate(row[1])`
   - Line 61: Replace `fechaEmision: String(row[0] || '')` with `fechaEmision: normalizeSpreadsheetDate(row[0])`
   - Line 98: Replace `fechaPago: String(row[0] || '')` with `fechaPago: normalizeSpreadsheetDate(row[0])`
   - Line 133: Replace `fechaPago: String(row[0] || '')` with `fechaPago: normalizeSpreadsheetDate(row[0])`
4. Run verifier (expect pass)

### Task 4: Fix date serial number parsing in recibo-pago matcher
**Linear Issue:** [ADV-59](https://linear.app/adva-administracion/issue/ADV-59/date-serial-number-parsing-broken-in-recibo-pago-matcher)

2 locations in `recibo-pago-matcher.ts`.

1. Write tests in `src/processing/matching/recibo-pago-matcher.test.ts`:
   - Test recibo reading with serial number in row[0] (fechaPago) → verify normalized
   - Test pago reading with serial number in row[0] (fechaPago) → verify normalized
   - Follow the same mock pattern as `factura-pago-matcher.test.ts`
2. Run verifier (expect fail)
3. Fix `src/processing/matching/recibo-pago-matcher.ts`:
   - Add import: `import { normalizeSpreadsheetDate } from '../../utils/date.js';`
   - Line 259: Replace `fechaPago: String(row[0] || '')` with `fechaPago: normalizeSpreadsheetDate(row[0])`
   - Line 288: Replace `fechaPago: String(row[0] || '')` with `fechaPago: normalizeSpreadsheetDate(row[0])`
4. Run verifier (expect pass)

### Task 5: Fix date serial number parsing in NC-factura matcher
**Linear Issue:** [ADV-60](https://linear.app/adva-administracion/issue/ADV-60/date-serial-number-parsing-broken-in-nc-factura-matcher)

Single location in `nc-factura-matcher.ts`.

1. Write test in `src/processing/matching/nc-factura-matcher.test.ts`:
   - Test factura reading with serial number in row[0] (fechaEmision) → verify normalized to ISO date string
   - Follow existing test patterns in the file
2. Run verifier (expect fail)
3. Fix `src/processing/matching/nc-factura-matcher.ts`:
   - Add import: `import { normalizeSpreadsheetDate } from '../../utils/date.js';`
   - Line 145: Replace `fechaEmision: String(row[0] || '')` with `fechaEmision: normalizeSpreadsheetDate(row[0])`
4. Run verifier (expect pass)

### Task 6: Add date handling guidelines to CLAUDE.md
**Linear Issue:** [ADV-62](https://linear.app/adva-administracion/issue/ADV-62/add-date-handling-guidelines-to-claudemd)

1. No tests needed (documentation-only change)
2. Add a "Date Handling" section to CLAUDE.md near the SPREADSHEETS section with:
   - Rule: Always use `normalizeSpreadsheetDate(cellValue)` for date fields read from spreadsheets, never `String()`
   - Explanation: `getValues()` uses `UNFORMATTED_VALUE` + `SERIAL_NUMBER` render options, so CellDate fields return as numbers
   - Correct pattern example: `fechaEmision: normalizeSpreadsheetDate(row[0])` (from `factura-pago-matcher.ts:327`)
   - Incorrect pattern to avoid: `fechaEmision: String(row[0] || '')`
   - Note: `processedAt` fields are NOT affected (stored as plain text, not CellDate)
3. Run verifier (ensure build still passes)

### Task 7: Add dynamic concurrency throttling under quota pressure
**Linear Issue:** [ADV-56](https://linear.app/adva-administracion/issue/ADV-56/dynamic-concurrency-throttling-under-quota-pressure)

Implement a global quota-aware throttle that reduces concurrency when quota errors are detected.

1. Write tests in `src/utils/concurrency.test.ts`:
   - Test `QuotaThrottle` (or equivalent) class:
     - Default state allows operations to proceed immediately
     - After `reportQuotaError()`, operations are delayed by a global backoff
     - Backoff increases with consecutive quota errors
     - Backoff resets after successful operations (no quota errors for a period)
     - Multiple concurrent operations are serialized during backoff
   - Test integration with `withQuotaRetry`:
     - When quota error is detected, global throttle is notified
     - Subsequent calls to `withQuotaRetry` check global throttle before making API calls
     - After backoff clears, operations resume at normal speed
2. Run verifier (expect fail)
3. Implement in `src/utils/concurrency.ts`:
   - Add a `QuotaThrottle` class (or module-level singleton) with:
     - `reportQuotaError()` — signals a quota error occurred, increases global backoff
     - `waitForClearance()` — returns a promise that resolves after global backoff delay (if any)
     - Exponential backoff: e.g., 5s → 15s → 30s → 60s max
     - Auto-reset: if no `reportQuotaError()` for 60s, reset backoff to 0
   - Integrate into `withQuotaRetry()`: before each retry attempt, call `throttle.waitForClearance()`
   - When `isQuotaError()` is detected, call `throttle.reportQuotaError()`
   - Export throttle instance for testing
4. Update `src/config.ts` if new constants are needed:
   - `QUOTA_THROTTLE_BASE_DELAY_MS` (e.g., 5000)
   - `QUOTA_THROTTLE_MAX_DELAY_MS` (e.g., 60000)
   - `QUOTA_THROTTLE_RESET_MS` (e.g., 60000)
5. Run verifier (expect pass)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix date serial number parsing across 6 modules and add dynamic concurrency throttling for Google Sheets API quota management.

**Linear Issues:** ADV-56, ADV-57, ADV-58, ADV-59, ADV-60, ADV-61, ADV-62

**Approach:**
- Fix the date serial number bug by replacing `String(row[N] || '')` with `normalizeSpreadsheetDate(row[N])` across all affected modules, starting with the most critical (movimientos matching, Urgent) and maintaining version hash consistency (ADV-61 paired with ADV-57)
- Add CLAUDE.md documentation to prevent recurrence of the same bug pattern
- Implement a global quota-aware throttle in the concurrency module to reduce retry storms under load

**Scope:**
- Tasks: 7
- Files affected: 8 (6 source files + CLAUDE.md + config.ts)
- New tests: yes (date normalization tests in 6 test files, throttle tests in concurrency.test.ts)

**Key Decisions:**
- ADV-57 and ADV-61 are combined in Task 1 because `computeVersionFromRow` and `computeRowVersion` must stay consistent
- ADV-57 spans Tasks 1 and 2 (reader + orchestrator are separate modules)
- Quota throttle is a cooperative singleton — operations voluntarily check clearance, not enforced by a central queue
- Documentation (ADV-62) is Task 6, after all code fixes, so examples reference the corrected code

**Dependencies/Prerequisites:**
- Task 1 must complete before Task 2 (movimientos-reader provides data to match-movimientos)
- Tasks 3, 4, 5 are independent of each other
- Task 6 has no code dependencies
- Task 7 is fully independent of Tasks 1-6

---

## Iteration 1

**Status:** COMPLETE
**Date:** 2026-02-03

### Changes Made

**Task 1 (ADV-57, ADV-61): Fix movimientos-reader and movimientos-detalle**
- `src/services/movimientos-reader.ts`: Replaced `String(row[0] || '')` with `normalizeSpreadsheetDate(row[0])` for `fecha` field
- `src/services/movimientos-detalle.ts`: Same fix for `fecha` in `computeVersionFromRow()`, maintaining hash consistency with `computeRowVersion()`
- Tests: 2 new tests in each test file (serial number normalization, string passthrough, TOCTOU version hash)

**Task 2 (ADV-57): Fix match-movimientos**
- `src/bank/match-movimientos.ts`: Replaced 5 `String()` calls with `normalizeSpreadsheetDate()` for `fechaEmision` (×3) and `fechaPago` (×2)
- Tests: Serial number normalization tests for `parseFacturasEmitidas` and `parseFacturasRecibidas`

**Task 3 (ADV-58): Fix bank autofill**
- `src/bank/autofill.ts`: Replaced 5 date fields (`fecha`, `fechaValor`, `fechaEmision`, `fechaPago` ×2) with `normalizeSpreadsheetDate()`
- Tests: 2 new tests for `parseMovementRow` (serial number normalization, string passthrough)

**Task 4 (ADV-59): Fix recibo-pago matcher**
- `src/processing/matching/recibo-pago-matcher.ts`: Replaced 2 `fechaPago` fields with `normalizeSpreadsheetDate()`
- Tests: 2 pattern verification tests for recibo and pago date normalization

**Task 5 (ADV-60): Fix NC-factura matcher**
- `src/processing/matching/nc-factura-matcher.ts`: Replaced `fechaEmision` with `normalizeSpreadsheetDate()`
- Tests: Integration test with serial number dates in both factura and NC rows

**Task 6 (ADV-62): Documentation**
- `CLAUDE.md`: Added "Reading dates from spreadsheets" guidelines under Spreadsheets Principles

**Task 7 (ADV-56): Dynamic concurrency throttling**
- `src/config.ts`: Added `QUOTA_THROTTLE_BASE_DELAY_MS`, `QUOTA_THROTTLE_MAX_DELAY_MS`, `QUOTA_THROTTLE_RESET_MS`
- `src/utils/concurrency.ts`: Added `QuotaThrottle` class with exponential backoff, `quotaThrottle` singleton, integrated into `withQuotaRetry()`
- Tests: 7 new tests (immediate clearance, delay after error, exponential backoff, max cap, auto-reset, manual reset, withQuotaRetry integration)

### Bug Fixes (from bug-hunter)
- Fixed incorrect JSDoc `@example` in `serialToDateString()` (said '2025-12-23', correct is '2025-12-02')
- Fixed `getQuotaThrottle()` to import config constants instead of hardcoding values
- Fixed misleading test comments about backoff delay values

### Verification
- **Tests:** 1,559 passed (59 test files)
- **Build:** Clean (zero warnings)
- **Bug hunter:** 4 issues found, 3 fixed (1 by-design: throttle not resetting on single success — auto-reset after quiet period handles this)

### Review Findings

Files reviewed: 14 (8 source files + 6 test files)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

**Tasks 1-5 (ADV-57, ADV-58, ADV-59, ADV-60, ADV-61): Date serial number fixes**
- All 14 `String(row[N] || '')` calls for date fields correctly replaced with `normalizeSpreadsheetDate(row[N])`
- Import of `normalizeSpreadsheetDate` verified in all 6 source files
- Version hash consistency maintained: `computeVersionFromRow()` (`movimientos-detalle.ts:54`) and `computeRowVersion()` (`match-movimientos.ts:82-93`) both use normalized dates, producing identical hashes for same row data
- Tests verify serial number normalization, string passthrough, and TOCTOU version hash consistency
- `processedAt` fields correctly left as `String()` (not CellDate, not affected)

**Task 6 (ADV-62): CLAUDE.md documentation**
- "Reading dates from spreadsheets" section correctly placed under Spreadsheets Principles
- Correct/incorrect patterns documented with clear examples
- References `normalizeSpreadsheetDate` from `utils/date.ts`

**Task 7 (ADV-56): QuotaThrottle**
- `QuotaThrottle` class implements exponential backoff: `base * 2^(errors-1)`, capped at max
- Auto-reset after quiet period (no errors for `QUOTA_THROTTLE_RESET_MS`)
- Config constants properly imported from `config.ts` (not hardcoded)
- Cooperative integration into `withQuotaRetry()`: calls `waitForClearance()` before each attempt, calls `reportQuotaError()` on quota errors
- Singleton pattern via `getQuotaThrottle()` with lazy initialization
- Exported facade object delegates to singleton, enabling testing via `quotaThrottle.reset()`
- 7 tests cover: immediate clearance, delay after error, exponential backoff, max cap, auto-reset, manual reset, withQuotaRetry integration

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- ADV-56: Review → Merge
- ADV-57: Review → Merge
- ADV-58: Review → Merge
- ADV-59: Review → Merge
- ADV-60: Review → Merge
- ADV-61: Review → Merge
- ADV-62: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
Ready for PR creation.
