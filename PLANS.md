# Implementation Plan

**Status:** IMPLEMENTED
**Branch:** feat/ADV-80-backlog-batch
**Issues:** ADV-80, ADV-81, ADV-83, ADV-88, ADV-89, ADV-90, ADV-94, ADV-95
**Created:** 2026-02-21
**Last Updated:** 2026-02-21

## Summary

Fix 8 backlog issues from code audit: add timeout to exchange-rate fetch (ADV-80), fix token usage logger TOCTOU race + async callback (ADV-81), fix formula injection in `appendRowsWithFormatting` (ADV-83), add runtime validation for enum casts from spreadsheet cells (ADV-88), replace placeholder tests (ADV-89), add durationMs logging for external API calls (ADV-90), remove dead Apps Script function (ADV-94), and fix npm audit vulnerabilities (ADV-95).

## Issues

### ADV-80: No timeout on exchange-rate API fetch

**Priority:** High
**Labels:** Performance
**Description:** `getExchangeRate()` calls the ArgentinaDatos API via `fetch(url)` with no timeout or `AbortController`. If the external service is unresponsive, the call hangs indefinitely, blocking the queue slot permanently.

**Acceptance Criteria:**
- [ ] `fetch()` call in `getExchangeRate` uses an `AbortController` with a timeout
- [ ] Timeout value is configurable via `src/config.ts`

### ADV-81: Token usage logger race condition and unhandled async callback

**Priority:** High
**Labels:** Bug
**Description:** Two bugs in token usage logging: (1) TOCTOU race — `logTokenUsage` reads row count via `getValues('Uso de API!A:A')` to compute `nextRow`, then uses that in a formula `=F${nextRow}*I${nextRow}+...`. With concurrent queue slots, multiple workers read the same row count and produce formulas referencing wrong cells. (2) `UsageCallback` is typed as `() => void` but implemented as async in `extractor.ts`. The `callUsageCallback` in `client.ts` calls the callback without catching the returned Promise, so if `tokenBatch.add()` throws, it becomes an unhandled rejection.

**Acceptance Criteria:**
- [ ] Formula in `logTokenUsage` does not depend on pre-read row count (uses ROW()-based self-referencing)
- [ ] Concurrent `logTokenUsage` calls produce correct formula references
- [ ] `UsageCallback` type accounts for async callbacks (returns `void | Promise<void>`)
- [ ] `callUsageCallback` catches async rejection

### ADV-83: Formula injection via strings starting with '='

**Priority:** Medium
**Labels:** Bug
**Description:** `appendRowsWithFormatting` treats any string starting with `=` as a spreadsheet formula by setting `formulaValue` instead of `stringValue`. The `appendRowsWithLinks` function already has the correct pattern — it uses `CellFormula` wrapper objects checked via `isCellFormula()`. `appendRowsWithFormatting` should do the same.

**Acceptance Criteria:**
- [ ] Only `CellFormula`-wrapped values are treated as formulas in `appendRowsWithFormatting`
- [ ] Raw string data starting with `=` is stored as `stringValue`
- [ ] Callers that need formulas updated to use `CellFormula` wrapper

### ADV-88: Unchecked string-to-enum casts from spreadsheet cells

**Priority:** Medium
**Labels:** Bug
**Description:** Multiple locations cast raw spreadsheet cell values to discriminated union types (`TipoComprobante`, `Moneda`, `MatchConfidence`) using `String(row[...]) as SomeType` without runtime validation. Also, `(String(row[5]) as 'ARS' | 'USD') || 'ARS'` has a subtle bug: `String(undefined)` produces `"undefined"` (truthy), so the `||` fallback never triggers for missing cells.

**Acceptance Criteria:**
- [ ] Spreadsheet cell values are validated against allowed enum values before assignment
- [ ] Invalid values produce a warning log and fall back to a safe default
- [ ] `String(undefined)` bug is fixed

### ADV-89: Placeholder tests with expect(true).toBe(true)

**Priority:** Medium
**Labels:** Technical Debt
**Description:** Three test cases contain only `expect(true).toBe(true)` providing false coverage: `folder-structure.test.ts:114`, `scanner.test.ts:866`, `concurrency.test.ts:622`.

**Acceptance Criteria:**
- [ ] Each placeholder test has meaningful assertions or is removed
- [ ] No `expect(true).toBe(true)` patterns remain

### ADV-90: Missing durationMs on external API call logs

**Priority:** Medium
**Labels:** Convention
**Description:** External API calls to ArgentinaDatos (exchange rate) do not log `durationMs` in completion logs. This makes it impossible to identify slow external calls from log data.

**Acceptance Criteria:**
- [ ] ArgentinaDatos API call logs `durationMs` on completion
- [ ] Timing is captured at DEBUG level to avoid log noise

### ADV-94: Dead triggerAutofillBank function in Apps Script build

**Priority:** Low
**Labels:** Technical Debt
**Description:** The build footer in `apps-script/build.js` exposes a `triggerAutofillBank()` global function that no longer exists in `apps-script/src/main.ts`.

**Acceptance Criteria:**
- [ ] `triggerAutofillBank` is removed from the build footer in `apps-script/build.js`

### ADV-95: Fix npm audit vulnerabilities and update dependencies

**Priority:** Low
**Labels:** Security
**Description:** `npm audit` reports 8 vulnerabilities (2 low, 1 moderate, 5 high) in dependencies. All fixable via `npm audit fix`. Also several packages are behind latest minor/patch versions.

**Acceptance Criteria:**
- [ ] `npm audit fix` applied and lock file updated
- [ ] `npm audit` reports 0 high/critical vulnerabilities
- [ ] All packages updated to latest within semver ranges (`npm update`)
- [ ] Full test suite passes after updates

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Add timeout to exchange-rate API fetch (ADV-80)

**Linear Issue:** [ADV-80](https://linear.app/lw-claude/issue/ADV-80/no-timeout-on-exchange-rate-api-fetch)
**Files:**
- `src/config.ts` (modify — add constant)
- `src/utils/exchange-rate.ts` (modify — add AbortController)
- `src/utils/exchange-rate.test.ts` (modify — add timeout test)

**TDD Steps:**

1. **RED** — Write test in `src/utils/exchange-rate.test.ts`:
   - Test: `getExchangeRate` aborts fetch after timeout period (mock `fetch` to never resolve, verify it returns an error within timeout)
   - Test: `getExchangeRate` clears timeout on successful response (no lingering timers)
   - Follow existing test patterns in the file (Result<T,E> pattern, vi.mock for fetch)
2. **Run verifier** (expect fail — timeout not implemented)
3. **GREEN** — Implement:
   - Add `EXCHANGE_RATE_TIMEOUT_MS` constant to `src/config.ts` (30 seconds — reasonable for a simple REST API, much shorter than Gemini's 5-minute timeout for large PDFs)
   - In `getExchangeRate()` at line 149, add `AbortController` with timeout following the exact pattern from `src/gemini/client.ts:226-241`: create controller, set timeout, pass `signal` to fetch, clear timeout on response
4. **Run verifier** (expect pass)

**Reference patterns:**
- `src/gemini/client.ts:226-241` — AbortController timeout pattern
- `src/config.ts:119` — `FETCH_TIMEOUT_MS` constant for reference

### Task 2: Fix formula injection in appendRowsWithFormatting (ADV-83)

**Linear Issue:** [ADV-83](https://linear.app/lw-claude/issue/ADV-83/formula-injection-via-strings-starting-with)
**Files:**
- `src/services/sheets.ts` (modify — change `appendRowsWithFormatting` type and logic)
- `src/services/token-usage-logger.ts` (modify — use `CellFormula` wrapper)
- `src/services/sheets.test.ts` (modify — add tests)
- `src/services/token-usage-logger.test.ts` (modify — update test expectations if needed)

**TDD Steps:**

1. **RED** — Write tests in `src/services/sheets.test.ts`:
   - Test: `appendRowsWithFormatting` treats a `CellFormula` object as `formulaValue` (pass `{ type: 'formula', value: '=A1+B1' }`)
   - Test: `appendRowsWithFormatting` treats a raw string starting with `=` as `stringValue` (NOT formula) — e.g., `"=IMPORTRANGE(...)"` must become `{ stringValue: "=IMPORTRANGE(...)" }`
   - Follow existing test patterns — see the `CellFormula` test at line 2100 for `appendRowsWithLinks`
2. **Run verifier** (expect fail — `appendRowsWithFormatting` doesn't accept `CellFormula` objects yet)
3. **GREEN** — Implement:
   - Change `appendRowsWithFormatting` signature from `CellValue[][]` to `(CellValue | CellFormula)[][]`
   - In the cell processing logic (line 1293-1299), add a `CellFormula` check BEFORE the string check: if `isCellFormula(value)`, set `{ formulaValue: value.value }`
   - Remove the `startsWith('=')` check from the string branch (line 1294-1296) — raw strings always become `stringValue`
   - Update `src/services/token-usage-logger.ts` line 129: wrap the formula string in a `CellFormula` object: `{ type: 'formula', value: \`=F...\` }` instead of raw `\`=F...\``
   - Import `CellFormula` type in token-usage-logger.ts
4. **Run verifier** (expect pass)

**Reference patterns:**
- `src/services/sheets.ts:946-950` — existing `CellFormula` handling in `appendRowsWithLinks`
- `src/services/sheets.ts:179-186` — `CellFormula` interface definition
- `src/services/sheets.ts:882-885` — `isCellFormula` helper

### Task 3: Fix token usage logger race condition and async callback (ADV-81)

**Linear Issue:** [ADV-81](https://linear.app/lw-claude/issue/ADV-81/token-usage-logger-race-condition-and-unhandled-async-callback)
**Files:**
- `src/services/token-usage-logger.ts` (modify — replace formula, remove getValues read)
- `src/gemini/client.ts` (modify — fix UsageCallback type and callUsageCallback)
- `src/services/token-usage-logger.test.ts` (modify — add concurrency test)
- `src/gemini/client.test.ts` (modify — add async callback test)

**TDD Steps:**

1. **RED** — Write tests:
   - In `src/services/token-usage-logger.test.ts`: Test that the formula uses `ROW()`-based self-referencing (inspect the row data passed to `appendRowsWithFormatting` — the formula `CellFormula` value should contain `ROW()` and NOT contain a hardcoded row number)
   - In `src/services/token-usage-logger.test.ts`: Test that `logTokenUsage` does NOT call `getValues` (it should no longer need to read row count)
   - In `src/gemini/client.test.ts`: Test that `callUsageCallback` catches async rejection from callback (pass a callback that returns a rejected Promise, verify no unhandled rejection and warning is logged)
2. **Run verifier** (expect fail)
3. **GREEN** — Implement:
   - **TOCTOU fix in `token-usage-logger.ts`:** Replace the absolute formula `=F${nextRow}*I${nextRow}+G${nextRow}*J${nextRow}+H${nextRow}*K${nextRow}` with a ROW()-based self-referencing formula like `=INDIRECT("F"&ROW())*INDIRECT("I"&ROW())+INDIRECT("G"&ROW())*INDIRECT("J"&ROW())+INDIRECT("H"&ROW())*INDIRECT("K"&ROW())`. Remove the `getValues('Uso de API!A:A')` call (lines 101-108) since `nextRow` is no longer needed. The formula must still be wrapped in `CellFormula` (from Task 2).
   - **Async callback fix in `client.ts`:** Change `UsageCallback` type (line 47) to `(data: UsageCallbackData) => void | Promise<void>`. In `callUsageCallback` (line 350+), wrap the callback invocation: if the callback returns a Promise (check via `instanceof Promise` or `typeof result?.then === 'function'`), attach a `.catch()` that logs a warning using the Pino logger.
4. **Run verifier** (expect pass)

**Depends on:** Task 2 (CellFormula wrapper must be in place for the formula)

**Reference patterns:**
- `src/services/token-usage-batch.ts:76-96` — batch mode calculates cost directly (no formula)
- `src/gemini/client.ts:350-370` — current `callUsageCallback` implementation

### Task 4: Add runtime validation for enum casts from spreadsheet cells (ADV-88)

**Linear Issue:** [ADV-88](https://linear.app/lw-claude/issue/ADV-88/unchecked-string-to-enum-casts-from-spreadsheet-cells)
**Files:**
- `src/utils/validation.ts` (modify — add enum validation functions)
- `src/utils/validation.test.ts` (modify — add tests for new functions)
- `src/bank/match-movimientos.ts` (modify — replace unchecked casts)
- `src/processing/matching/factura-pago-matcher.ts` (modify — replace unchecked casts)
- `src/processing/matching/recibo-pago-matcher.ts` (modify — replace unchecked casts)

**TDD Steps:**

1. **RED** — Write tests in `src/utils/validation.test.ts`:
   - Test: `validateMoneda` returns valid value for `'ARS'` and `'USD'`, returns default `'ARS'` for `'undefined'`, `''`, and invalid strings
   - Test: `validateMatchConfidence` returns valid value for `'HIGH'`, `'MEDIUM'`, `'LOW'`, returns `undefined` for invalid/empty
   - Test: `validateTipoComprobante` returns valid value for known types (`'A'`, `'B'`, `'C'`, etc.), returns default `'A'` for invalid
   - Test: Each validator logs a warning when falling back to default (spy on logger)
2. **Run verifier** (expect fail)
3. **GREEN** — Implement:
   - Add validation functions to `src/utils/validation.ts`: `validateMoneda(raw: unknown): 'ARS' | 'USD'`, `validateMatchConfidence(raw: unknown): MatchConfidence | undefined`, `validateTipoComprobante(raw: unknown): TipoComprobante`
   - Each function: normalize input (handle undefined/null/empty), check against allowed values, log warning on fallback, return default
   - Fix the `String(undefined)` → `"undefined"` bug: check for `null`/`undefined` BEFORE calling `String()`
   - Replace all unchecked casts in `match-movimientos.ts`, `factura-pago-matcher.ts`, `recibo-pago-matcher.ts` with the new validation functions
4. **Run verifier** (expect pass)

**Reference patterns:**
- `src/utils/validation.ts` — existing validation functions
- `src/types/index.ts` — enum type definitions (`Moneda`, `MatchConfidence`, `TipoComprobante`)

### Task 5: Add durationMs to exchange-rate API call logs (ADV-90)

**Linear Issue:** [ADV-90](https://linear.app/lw-claude/issue/ADV-90/missing-durationms-on-external-api-call-logs)
**Files:**
- `src/utils/exchange-rate.ts` (modify — add timing)
- `src/utils/exchange-rate.test.ts` (modify — add test)

**TDD Steps:**

1. **RED** — Write test in `src/utils/exchange-rate.test.ts`:
   - Test: `getExchangeRate` logs `durationMs` at debug level on successful fetch (spy on `debug` logger, verify `durationMs` field is present and is a number)
   - Test: `getExchangeRate` logs `durationMs` on error too (the timing should cover both success and error paths)
2. **Run verifier** (expect fail)
3. **GREEN** — Implement:
   - In `getExchangeRate()`: add `const startTime = Date.now()` before the `fetch()` call
   - After the fetch completes (both success and error paths), compute `durationMs = Date.now() - startTime`
   - Add `debug('Exchange rate API call completed', { module: 'exchange-rate', durationMs, url })` log
   - Place the timing/logging in the right spots to cover both success and error branches within the try/catch
4. **Run verifier** (expect pass)

**Reference patterns:**
- `src/gemini/client.ts:203,263` — timing pattern with `Date.now()` start/end

**Notes:** The issue originally mentioned Drive and Sheets API calls too, but those are Google client library calls (not raw `fetch`). Adding timing to every `googleapis` method call would be invasive and low-value — the Google client library has its own retry/timeout logic. Focusing on the ArgentinaDatos API fetch (the only raw `fetch` to an external API) addresses the real operational gap.

### Task 6: Replace placeholder tests (ADV-89)

**Linear Issue:** [ADV-89](https://linear.app/lw-claude/issue/ADV-89/placeholder-tests-with-expecttruetobetrue)
**Files:**
- `src/services/folder-structure.test.ts` (modify — line 114)
- `src/processing/scanner.test.ts` (modify — line 866)
- `src/utils/concurrency.test.ts` (modify — line 622)

**Steps:**

1. Read each placeholder test and its surrounding context to understand what behavior it's documenting
2. For each test, either:
   - **Replace** with a meaningful assertion that verifies the documented behavior (e.g., check function-scoped state, observable side effects)
   - **Remove** the test if the behavior is not meaningfully testable (comment-as-documentation is better than a fake test)
3. **Run verifier** (expect pass — we're fixing tests, not breaking them)

**Notes:** No TDD red-green cycle needed since we're improving existing tests, not writing new functionality. The goal is to eliminate false coverage, not add new coverage.

### Task 7: Remove dead triggerAutofillBank from Apps Script build (ADV-94)

**Linear Issue:** [ADV-94](https://linear.app/lw-claude/issue/ADV-94/dead-triggerautofillbank-function-in-apps-script-build)
**Files:**
- `apps-script/build.js` (modify — remove from build footer around lines 180-182)

**Steps:**

1. Remove the `triggerAutofillBank` function from the build footer in `apps-script/build.js`
2. Verify the build still works: `npm run build:script`

**Notes:** No TDD needed — this is a build script cleanup with no runtime behavior to test.

### Task 8: Fix npm audit vulnerabilities and update dependencies (ADV-95)

**Linear Issue:** [ADV-95](https://linear.app/lw-claude/issue/ADV-95/fix-npm-audit-vulnerabilities-and-update-dependencies)
**Files:**
- `package.json` (modify)
- `package-lock.json` (modify)

**Steps:**

1. Run `npm audit fix` to fix known vulnerabilities
2. Run `npm update` to update packages within semver ranges
3. Run `npm audit` to verify 0 high/critical vulnerabilities remain
4. Run full test suite and build to verify nothing broke

**Notes:** No TDD needed — dependency updates verified by existing test suite. This task should be done LAST since it changes the lock file.

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review changes for bugs, fix all real issues
2. Run `verifier` agent — Verify all tests pass and zero warnings

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues through Todo → In Progress → Review |

## Risks & Open Questions

- [ ] Task 3 (ADV-81) depends on Task 2 (ADV-83) — the formula must be wrapped in `CellFormula` before switching to ROW()-based references
- [ ] Task 4 (ADV-88) touches many files across matching modules — risk of subtle behavior changes if default values differ from current implicit behavior
- [ ] Task 8 (ADV-95) — dependency updates could introduce regressions; run full suite after

## Scope Boundaries

**In Scope:**
- All 8 backlog issues as described above

**Out of Scope:**
- Adding durationMs to Google Drive/Sheets API calls (ADV-90 scoped to ArgentinaDatos only — googleapis calls are managed by the client library)
- Changing `appendRowsWithLinks` (already uses `CellFormula` correctly)
- Changing token-usage-batch.ts (already calculates cost directly without formulas)

---

## Iteration 1

**Implemented:** 2026-02-21
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Add timeout to exchange-rate API fetch (ADV-80) — Added AbortController with 30s timeout to `getExchangeRate()`, added `EXCHANGE_RATE_TIMEOUT_MS` config constant (worker-1)
- Task 2: Fix formula injection in appendRowsWithFormatting (ADV-83) — Changed signature to accept `CellFormula`, removed `startsWith('=')` check, raw strings always `stringValue` (worker-2)
- Task 3: Fix token usage logger race condition and async callback (ADV-81) — Replaced absolute row formula with ROW()-based self-referencing, removed `getValues` call (TOCTOU fix), fixed `UsageCallback` type to handle async, added `.catch()` for async rejections (worker-2)
- Task 4: Add runtime validation for enum casts from spreadsheet cells (ADV-88) — Updated `validateMoneda`/`validateTipoComprobante` to return defaults with warnings, fixed `String(undefined)` bug, replaced all unchecked casts in matching modules (worker-3)
- Task 5: Add durationMs to exchange-rate API call logs (ADV-90) — Added `Date.now()` timing and debug-level `durationMs` logging on success and error paths (worker-1)
- Task 6: Replace placeholder tests (ADV-89) — Replaced `expect(true).toBe(true)` in concurrency.test.ts with meaningful assertion, removed untestable placeholders in scanner.test.ts and folder-structure.test.ts (worker-3)
- Task 7: Remove dead triggerAutofillBank from Apps Script build (ADV-94) — Removed from build footer in apps-script/build.js (worker-3)
- Task 8: Fix npm audit vulnerabilities and update dependencies (ADV-95) — Reduced from 8 to 4 vulnerabilities; remaining 4 are in googleapis transitive chain via @google/clasp (latest version, unfixable) (lead)

### Files Modified
- `src/config.ts` — Added EXCHANGE_RATE_TIMEOUT_MS constant
- `src/utils/exchange-rate.ts` — AbortController timeout + durationMs logging
- `src/utils/exchange-rate.test.ts` — Timeout and durationMs tests, afterEach fix
- `src/services/sheets.ts` — appendRowsWithFormatting CellFormula support, removed startsWith('=') check
- `src/services/sheets.test.ts` — Formula injection tests
- `src/services/token-usage-logger.ts` — ROW()-based formula, CellFormula wrapper, removed getValues
- `src/services/token-usage-logger.test.ts` — New test file for token usage logger
- `src/gemini/client.ts` — UsageCallback async type, callUsageCallback .catch()
- `src/gemini/client.test.ts` — Async callback rejection test
- `src/utils/validation.ts` — Updated enum validators with defaults and warnings
- `src/utils/validation.test.ts` — Updated validation tests
- `src/bank/match-movimientos.ts` — Replaced unchecked casts with validation functions
- `src/processing/matching/factura-pago-matcher.ts` — Replaced unchecked casts
- `src/processing/matching/recibo-pago-matcher.ts` — Replaced unchecked casts
- `src/services/folder-structure.test.ts` — Removed placeholder test
- `src/processing/scanner.test.ts` — Removed placeholder test
- `src/utils/concurrency.test.ts` — Replaced placeholder with meaningful assertion
- `apps-script/build.js` — Removed dead triggerAutofillBank
- `package.json` — Updated dependencies
- `package-lock.json` — Updated lock file
- `.gitignore` — Added bare `node_modules` entry for worktree symlinks

### Linear Updates
- ADV-80: Todo → In Progress → Review
- ADV-81: Todo → In Progress → Review
- ADV-83: Todo → In Progress → Review
- ADV-88: Todo → In Progress → Review
- ADV-89: Todo → Review
- ADV-90: Todo → In Progress → Review
- ADV-94: Todo → Review
- ADV-95: Todo → Review

### Pre-commit Verification
- bug-hunter: Found 1 medium bug (vi.useRealTimers not in afterEach), fixed before commit
- verifier: All 1605 tests pass, zero warnings

### Work Partition
- Worker 1: Tasks 1, 5 (exchange-rate domain — timeout, durationMs logging)
- Worker 2: Tasks 2, 3 (sheets/logger/client domain — formula injection, TOCTOU race, async callback)
- Worker 3: Tasks 4, 6, 7 (validation/matching + test cleanup + dead code removal)
- Lead: Task 8 (npm audit fix — CLI commands)

### Merge Summary
- Worker 2: fast-forward (no conflicts)
- Worker 1: merged, no conflicts
- Worker 3: merged, no conflicts

### Review Findings

Summary: 5 findings evaluated (Team: security, reliability, quality reviewers)
- FIX: 3 issue(s) — Linear issues created in Todo
- DISCARDED: 2 finding(s) — not applicable

**Issues requiring fix:**
- [HIGH] BUG: Missing unmatch cleanup in recibo-pago cascade displacement (`src/processing/matching/recibo-pago-matcher.ts:175-183`) — displaced pago with no new match leaves orphaned match references in spreadsheet
- [MEDIUM] BUG: usageMetadata discarded on Gemini error responses (`src/gemini/client.ts:258-261`) — `parseResult.ok &&` condition prevents extracting token counts from error responses, undercounting costs
- [MEDIUM] SECURITY: API_SECRET single quote injection in Apps Script build (`apps-script/build.js:142-144`) — raw string substitution without escaping single quotes

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: `setValues()`/`appendRows()`/`batchUpdate()` use `USER_ENTERED` without formula sanitization (`src/services/sheets.ts:232,266,295`) — current callers pass only hardcoded headers; safe alternatives (`appendRowsWithFormatting`, `appendRowsWithLinks`) are used for document data
- [DISCARDED] BUG: `movimientosFilled` reported even when `updateDetalle` fails (`src/bank/match-movimientos.ts:929`) — `errors` field correctly reports the write failure; `movimientosFilled` semantically means "matches found" not "writes completed"

### Linear Updates
- ADV-80: Review → Merge
- ADV-81: Review → Merge
- ADV-83: Review → Merge
- ADV-88: Review → Merge
- ADV-89: Review → Merge
- ADV-90: Review → Merge
- ADV-94: Review → Merge
- ADV-95: Review → Merge
- ADV-97: Created in Todo (Fix: Missing unmatch cleanup in recibo-pago cascade)
- ADV-98: Created in Todo (Fix: usageMetadata discarded on error responses)
- ADV-99: Created in Todo (Fix: API_SECRET single quote injection)

<!-- REVIEW COMPLETE -->

### Continuation Status
Fix Plan pending — 3 bugs found during review.

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [ADV-97](https://linear.app/lw-claude/issue/ADV-97/missing-unmatch-cleanup-in-recibo-pago-cascade-displacement), [ADV-98](https://linear.app/lw-claude/issue/ADV-98/usagemetadata-discarded-on-gemini-error-responses), [ADV-99](https://linear.app/lw-claude/issue/ADV-99/api-secret-single-quote-injection-in-apps-script-build)

### Fix 1: Missing unmatch cleanup in recibo-pago cascade displacement (ADV-97)
**Linear Issue:** [ADV-97](https://linear.app/lw-claude/issue/ADV-97/missing-unmatch-cleanup-in-recibo-pago-cascade-displacement)

1. Write test in `src/processing/matching/recibo-pago-matcher.test.ts` verifying that when a displaced pago has no remaining recibo match, unmatch updates are produced for both the recibo and the pago
2. Run verifier (expect fail)
3. In `src/processing/matching/recibo-pago-matcher.ts:175-183`, add unmatch cleanup logic matching the pattern from `factura-pago-matcher.ts:176-213`:
   - If displaced pago had a `previousMatchFileId` and that recibo isn't claimed, add `buildUnmatchUpdate` for the recibo
   - Add `cascadeState.updates.set('pago:${id}', ...)` entry to clear the pago's match reference
   - Import `buildUnmatchUpdate` from `cascade-matcher.js` if not already imported
4. Run verifier (expect pass)

### Fix 2: usageMetadata discarded on Gemini error responses (ADV-98)
**Linear Issue:** [ADV-98](https://linear.app/lw-claude/issue/ADV-98/usagemetadata-discarded-on-gemini-error-responses)

1. Write test in `src/gemini/client.test.ts` verifying that when Gemini returns an error response with usageMetadata (e.g., SAFETY block), the usage callback receives the actual token counts (not zeros)
2. Run verifier (expect fail)
3. In `src/gemini/client.ts:258-261`, change the condition from `if (parseResult.ok && 'usageMetadata' in parseResult)` to `if ('usageMetadata' in parseResult)`
4. Run verifier (expect pass)

### Fix 3: API_SECRET single quote injection in Apps Script build (ADV-99)
**Linear Issue:** [ADV-99](https://linear.app/lw-claude/issue/ADV-99/api-secret-single-quote-injection-in-apps-script-build)

1. Write test in `apps-script/build.test.js` (or inline assertion) verifying that a secret containing single quotes is properly escaped in the generated output
2. Run verifier (expect fail)
3. In `apps-script/build.js:142-144`, escape the substituted values before injection: `secret.replace(/\\/g, '\\\\').replace(/'/g, "\\'")`
4. Apply same escaping to `API_BASE_URL` if it uses the same pattern
5. Run verifier (expect pass)

### Post-Fix Checklist

1. Run `bug-hunter` agent — Review fix changes for new bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Iteration 2

**Implemented:** 2026-02-21
**Method:** Single-agent (3 fixes, effort score 4 — worker overhead exceeds implementation time)

### Tasks Completed This Iteration
- Fix 1: Missing unmatch cleanup in recibo-pago cascade displacement (ADV-97) — Added `buildUnmatchUpdate` for unclaimed recibos, added `pago:` unmatch entries, updated update loop to handle `pago:` keys and recibo unmatch entries
- Fix 2: usageMetadata discarded on Gemini error responses (ADV-98) — Changed condition from `parseResult.ok && 'usageMetadata' in parseResult` to `'usageMetadata' in parseResult`
- Fix 3: API_SECRET single quote injection in Apps Script build (ADV-99) — Added `escapeTemplateValue` function, applied to both `API_BASE_URL` and `API_SECRET` substitutions, guarded top-level build execution for testability

### Files Modified
- `src/processing/matching/recibo-pago-matcher.ts` — Added unmatch cleanup in cascade displacement, `pago:` key handling in update loop, used `update.reciboFileId` instead of `key`
- `src/processing/matching/recibo-pago-matcher.test.ts` — Added cascade displacement cleanup tests
- `src/gemini/client.ts` — Fixed usageMetadata extraction from error responses
- `src/gemini/client.test.ts` — Added test for SAFETY block usageMetadata extraction
- `apps-script/build.js` — Added `escapeTemplateValue` function, applied escaping, guarded top-level execution
- `apps-script/build.test.js` — New test file for build helpers
- `vitest.config.ts` — Added `apps-script/**/*.test.js` to include pattern

### Linear Updates
- ADV-97: Todo → In Progress → Review
- ADV-98: Todo → In Progress → Review
- ADV-99: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 bugs (fragile key usage in update loop, unreliable isDirectExecution check), fixed before commit
- verifier: All 1612 tests pass, zero warnings

### Continuation Status
All tasks completed.
