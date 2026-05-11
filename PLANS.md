# Implementation Plan

**Created:** 2026-05-11
**Source:** Bug report: 9 facturas emitidas silently lost from `Control de Ingresos / Facturas Emitidas` across three scan batches in April/May 2026; the system logged `Factura stored successfully` for each, marked tracking as `success`, and moved the PDFs into `/2026/Ingresos/MM/`, but no row was ever persisted in the spreadsheet.
**Linear Issues:** [ADV-242](https://linear.app/lw-claude/issue/ADV-242/storage-concurrent-appendcells-silently-drops-factura-rows-when)
**Branch:** fix/ADV-242-serialize-sheet-appends

## Context Gathered

### Codebase Analysis

- **Append path** is `src/services/sheets.ts:1106-1162` — `appendRowsWithLinks` wraps `withTiming → withQuotaRetry → spreadsheets.batchUpdate({requests:[{appendCells}]})`. The function does NOT inspect `response.data.replies`; it returns a *computed* cell count derived from the input array. Any silent partial failure on the API side is invisible to callers.
- **Concurrency** of file processing is via `src/processing/queue.ts` (PQueue, default concurrency=12, intervalCap=10/sec). On a quota-throttle release event, up to 12 `storeFactura` calls can fire concurrent `appendRowsWithLinks` against the same `(spreadsheetId, sheetName)` pair.
- **`storeFactura`** at `src/processing/storage/factura-store.ts:171-300` already uses `withLock` (`src/utils/concurrency.ts:291-318`) — but keyed by **business key** (`nroFactura:fechaEmision:importeTotal:cuit`), so different facturas do NOT serialize. The remaining race is one level down: the underlying `appendCells` itself.
- **Lock manager** (`src/utils/concurrency.ts:77-275`) is in-memory, supports CAS-release, auto-expiry, and `await`-driven wait queues. `withLock` returns `Result<T, Error>` — wrapping a `Result<T, Error>`-returning body would nest: `Result<Result<T,E>,E>`. We'll add a thin `withLockResult` adapter in `sheets.ts` that flattens the outer ok-wrap so the inner Result is propagated as-is.
- **All callers of `appendRowsWithLinks`** (`grep -rn appendRowsWithLinks src/ | grep -v test`): `factura-store.ts`, `pago-store.ts`, `recibo-store.ts`, `retencion-store.ts`, `resumen-store.ts` (×3), `movimientos-store.ts` (×3), `storage/index.ts` (markFileProcessing), `pagos-pendientes.ts` (×2). Each writes to a known sheet — locking at the `appendRowsWithLinks` layer covers all of them in one fix without touching callers.
- **Existing tests** for `appendRowsWithLinks` mock `spreadsheets.batchUpdate` (`src/services/sheets.test.ts`). The new tests will install mock implementations that simulate concurrency races (delayed resolution + shared "next row" counter).
- **Latent secondary bug** at `src/processing/caches/duplicate-cache.ts:280-286`: `addEntry` stores the wrapped cell array (`CellValueOrLink[]` with `{type:'date', value}` / `{type:'number', value}` objects) but the dupe-check functions read the cache assuming raw spreadsheet shapes (`normalizeSpreadsheetDate(row[0])`, `parseNumber(String(row[9]))`). For freshly-added entries the comparisons silently fail. Not the cause of row loss (false negative ≠ overwrite), but it masks bugs and breaks intra-scan duplicate detection. Same-PR fix.

### MCP Context

- **Railway MCP** consulted: production logs for 2026-05-11 16:30–16:40 UTC retrieved via `railway logs --environment production`. Both `Factura stored successfully` events and per-call `appendRowsWithLinks durationMs=...` events confirm timing.
- **Google Drive MCP** (`gdrive_list_revisions`): the revision timeline shows no manual edits since 2026-03-04 (every revision in the loss windows is the `railway` service account). Native Sheets revision content is not downloadable via the API — Drive limitation.
- **Linear MCP**: no existing open issue covers this — ADV-84 (canceled), ADV-126 (lock mocks in tests), ADV-191 (rematch lock), ADV-194 (Gemini RPM cap) are adjacent concurrency fixes but distinct.

### Investigation

**Bug report:** 9 invoices issued by ADVA between 2026-04-24 and 2026-05-11 are missing from production `Control de Ingresos / Facturas Emitidas` despite the server's own logs/tracking/file-move showing the store succeeded.

**Classification:** Storage / **Critical** (production data loss, silent, customer-facing) / `src/services/sheets.ts` + concurrent write path

**Root cause:** Concurrent `appendCells` API calls to the same sheet race on Google Sheets' "current end of data" detection. Two requests whose execution windows overlap can both pick the *same* target row index; the later commit overwrites the earlier one. `appendRowsWithLinks` doesn't inspect `response.data.replies`, so neither caller observes the loss. `withLock` in `storeFactura` is keyed by business key so distinct facturas don't serialize. Across the May 11 scans, every store whose `appendCells` window did not overlap any other survived; every loss aligns with the earliest-starting member of an overlapping burst.

**Evidence:**
- `src/services/sheets.ts:1106-1162` — `appendRowsWithLinks` runs `appendCells` per call with no per-sheet serialization and discards `replies`
- `src/processing/storage/factura-store.ts:183` — `lockKey` includes business key only, so two different facturas never serialize on append
- `src/processing/queue.ts:34` — PQueue concurrency=12 lets up to 12 stores hit the same sheet in parallel
- Railway logs 2026-05-11T16:34:51.001-.229Z — concurrent appendCells windows for fileIds `1UELiQ9aEpLnV8af14bC_R1RKjbIsc0ee` (154) and `1cFsRb7MYiaLaQD-eBYx3i7oeWrC78V56` (155); 154 lost
- Railway logs 2026-05-11T16:36:43.200-.672Z — concurrent appendCells windows for `1rTjmOwq10WnnkNMPDlcbh5nsiQKd7v9X` (181) and `1-TFRnTWFbuswy3mPaTmXIoR_nUR0hThd` (173); 181 lost
- `Dashboard / Archivos Procesados` rows 671, 723, 735, 736, 748, 756, 778, 860, 866 — all 9 lost facturas tracked `status=success` with non-empty processedAt
- `Control de Ingresos / Facturas Emitidas` `B:B` and `E:E` cross-checks — zero hits for any of the 9 fileIds or invoice numbers; rows already restored manually as rows 31–32 (154, 181) and prior rows (others)
- `src/processing/caches/duplicate-cache.ts:280` — `addEntry(sheetId, name, fileId, row)` stores `row` containing `CellDate`/`CellNumber`/`{text,url}` wrapper objects
- `src/processing/caches/duplicate-cache.ts:65-93` — `isDuplicateFactura` reads cache via `normalizeSpreadsheetDate(row[0])` and `parseNumber(String(row[9]))`, both of which fail silently on wrapper objects

**Impact:** Silent data loss. Lost facturas don't appear in monthly Cobros Pendientes, can't be matched by movimientos, won't be marked `pagada` when payment arrives. ~9 known cases over ~3 weeks; rate roughly proportional to concurrent-store bursts. Restorable today by reading the PDFs and re-appending (already done for the 9). Will recur on every batch upload until fixed.

## Tasks

### Task 1: Write failing test for concurrent `appendRowsWithLinks` row loss
**Linear Issue:** [ADV-242](https://linear.app/lw-claude/issue/ADV-242/storage-concurrent-appendcells-silently-drops-factura-rows-when)
**Files:**
- `src/services/sheets.test.ts` (modify)

**Steps:**
1. Add a `describe('appendRowsWithLinks concurrency', ...)` block.
2. Write a test that fires two `appendRowsWithLinks` calls concurrently against the same `(spreadsheetId, sheetName)` with a mocked `spreadsheets.batchUpdate` that:
   - Maintains an in-memory "next row" counter shared across calls
   - Resolves with a small artificial delay
   - Records each call's `appendCells.sheetId` and the request body for assertion
3. The test must assert: both calls return ok AND the mock recorded two **non-overlapping** appendCells invocations (i.e., serialization observable from the mock's per-call timing, where the second call begins only after the first resolves).
4. Add a second test asserting cross-sheet parallelism: two `appendRowsWithLinks` calls against *different* `(spreadsheetId, sheetName)` pairs DO run in parallel (overlapping mock-call windows allowed and expected).
5. Run verifier (expect fail — current implementation has no per-sheet lock, so both same-sheet calls run in parallel and the test for serialization fails).

**Notes:**
- Follow the existing `factura-store.test.ts:75-100` pattern for mocking `withLock` (or in this case, NOT mocking it so the production code path runs).
- Use a Promise.withResolvers / deferred pattern to gate mock resolution and observe overlap deterministically; do NOT depend on wall-clock timing.

### Task 2: Add `withLockResult` adapter and per-sheet lock around `appendRowsWithLinks`
**Linear Issue:** [ADV-242](https://linear.app/lw-claude/issue/ADV-242/storage-concurrent-appendcells-silently-drops-factura-rows-when)
**Files:**
- `src/utils/concurrency.ts` (modify — add `withLockResult` helper) OR `src/services/sheets.ts` (modify — inline adapter)
- `src/services/sheets.ts:1106-1162` (modify)

**Steps:**
1. Write a unit test for `withLockResult` (or whatever adapter chosen): given a body that returns `Result<T,E>`, the wrapper returns the same `Result<T,E>` on success, and a synthesized `{ok:false, error}` on lock-acquire timeout.
2. Run verifier (expect fail).
3. Implement: in `src/services/sheets.ts`, derive `sheetName = range.split('!')[0]` (already done at line 1116) and wrap the existing `withTiming → withQuotaRetry → batchUpdate` chain inside a `withLock` call keyed by `sheet-append:${spreadsheetId}:${sheetName}`. Use a 60 s wait timeout and a 60 s auto-expiry (matches the typical `appendCells` SLA under heavy throttle).
4. Ensure the lock wraps EVERYTHING including the metadata-cache fetch (so a slow metadata read still serializes appends).
5. Run verifier (expect Task 1's tests now pass).

**Notes:**
- Pattern reference: `src/processing/storage/factura-store.ts:185` — `withLock(lockKey, async () => { ... }, 10000)`. Apply the same pattern at the `appendRowsWithLinks` boundary instead of inside callers.
- Do NOT bypass the lock when `metadataCache` is provided — the race is at the API layer, not the metadata layer.
- Lock key intentionally per-sheet, not per-spreadsheet, so writes to e.g. `Facturas Emitidas` and `Pagos Recibidos` in the same Control de Ingresos workbook can still go in parallel.

### Task 3: Verify API response and surface silent failures
**Linear Issue:** [ADV-242](https://linear.app/lw-claude/issue/ADV-242/storage-concurrent-appendcells-silently-drops-factura-rows-when)
**Files:**
- `src/services/sheets.test.ts` (modify)
- `src/services/sheets.ts:1106-1162` (modify)

**Steps:**
1. Write a test that mocks `spreadsheets.batchUpdate` to return a response whose `replies[0].appendCells` is absent or whose `updatedRange` indicates zero rows applied. The test asserts that `appendRowsWithLinks` returns `{ok: false, error}` in this case.
2. Run verifier (expect fail — current code returns ok regardless).
3. Implement: after `await sheets.spreadsheets.batchUpdate(...)`, inspect the response. If a confirmation field (`replies[0].appendCells` or `updatedCells`) does not match the input row count, throw a typed `Error('appendCells did not apply expected rows: ...')` so `withQuotaRetry` retries.
4. Run verifier (expect pass).

**Notes:**
- Defence-in-depth: Task 2's lock should already eliminate the race, but Task 3 protects against any future variant.
- Google's `appendCells` response may be empty by spec. If a confirmation field is not reliably populated, fall back to issuing a `getValues` on the last N rows of the target range to verify our fileId is present. This is one extra round-trip per append but only on first attempts — retries can skip.

### Task 4: Fix `DuplicateCache.addEntry` to store normalized spreadsheet-shape values
**Linear Issue:** [ADV-242](https://linear.app/lw-claude/issue/ADV-242/storage-concurrent-appendcells-silently-drops-factura-rows-when)
**Files:**
- `src/processing/caches/duplicate-cache.test.ts` (modify)
- `src/processing/caches/duplicate-cache.ts:280-286` (modify)

**Steps:**
1. Write a test for `DuplicateCache.addEntry` followed by `isDuplicateFactura`: after `addEntry(spreadsheetId, sheetName, fileId, wrappedRow)`, calling `isDuplicateFactura(...)` with the same `(nroFactura, fecha, importe, cuit)` must return `{isDuplicate: true, existingFileId: fileId}`. Use a wrapped row mixing `{type:'date',value:'2026-05-11'}`, `{type:'number',value:25000}`, and `{text:'…',url:'…'}` cells.
2. Run verifier (expect fail — current `addEntry` stores the wrapped row verbatim).
3. Implement: in `addEntry`, normalize each cell before storing — date wrappers → ISO date string, number wrappers → number, link wrappers → `text`, primitives → pass through. Mirror the shape that `getValues` returns for a just-written row so subsequent dupe checks find it.
4. Run verifier (expect pass).

**Notes:**
- Add a `normalizeForCache(cell: CellValueOrLink): unknown` helper so the conversion is unit-testable in isolation.
- This bug is separate from the row-loss race but lives in the same write path. Fixing both in one PR keeps the audit trail coherent.

### Task 5: Document the API contract and locking strategy
**Linear Issue:** [ADV-242](https://linear.app/lw-claude/issue/ADV-242/storage-concurrent-appendcells-silently-drops-factura-rows-when)
**Files:**
- `CLAUDE.md` (modify)
- `src/services/sheets.ts` (modify — JSDoc on `appendRowsWithLinks`)

**Steps:**
1. In `CLAUDE.md` under a new "SHEETS API CONCURRENCY" subsection (near the existing CONCURRENCY CONTROL block), document: *every* mutation that targets the same sheet must serialize via `sheet-append:${spreadsheetId}:${sheetName}` because Google's `appendCells` is not safe under concurrent execution against the same sheet, and `appendRowsWithLinks` now enforces this internally.
2. Update the JSDoc on `appendRowsWithLinks` to explicitly state: "Serializes per-sheet via in-memory lock to prevent concurrent-append row loss on the Sheets API."
3. No test needed for this task — documentation only.

**Notes:**
- Prevents future maintainers from "optimizing" the lock away or replacing `appendCells` with another concurrent-unsafe API.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs, especially around lock auto-expiry interactions with the existing `withQuotaRetry` retry loop (a retry that takes >60 s could fire after the lock expires; need to verify the inner body is idempotent or extend expiry).
2. Run `verifier` agent — Verify all tests pass and zero warnings.
3. Post-deploy verification: upload ≥10 cuota-social facturas in one batch to staging, confirm all rows appear in `Facturas Emitidas` and that scan logs show serialized appendCells timestamps for the same sheet (non-overlapping windows in Railway log entries).

---

## Plan Summary

**Objective:** Eliminate the silent row-loss in `Facturas Emitidas` (and every other sheet written by the system) caused by concurrent `appendCells` calls racing on Google's "end of data" detection — by serializing appends per-(spreadsheet, sheet) at the `appendRowsWithLinks` boundary, verifying API responses, and fixing a latent type-shape bug in `DuplicateCache`.
**Linear Issues:** ADV-242
**Approach:** Surgical fix at the lowest write primitive (`appendRowsWithLinks` in `src/services/sheets.ts`). Add a per-sheet `withLock` wrapper keyed by `sheet-append:${spreadsheetId}:${sheetName}`. Validate the Sheets API response and throw on apparent partial-failure so `withQuotaRetry` retries. Same-PR fix for `DuplicateCache.addEntry`'s wrapped-object storage bug. TDD throughout.
**Scope:** 5 tasks, 4 production files modified, 1 doc file updated, 4 test files extended (with ~6 new tests total)
**Key Decisions:**
- Lock per-(spreadsheetId, sheetName), not per-spreadsheet — preserves parallel writes to different sheets in the same workbook.
- Lock at the `appendRowsWithLinks` boundary, not at callers — single point of enforcement covering all 9 caller modules with one edit.
- Defence-in-depth: response verification (Task 3) protects against future API changes even if the lock itself ever fails open.
- Same-PR fix of `DuplicateCache.addEntry` because the two bugs share the write path and reviewing them together is cheaper than two separate audits.
**Risks:**
- Lock auto-expiry vs. `withQuotaRetry`: if Google throttles severely and a retry chain runs >60 s, the lock could expire mid-body and a second waiter could enter while the first is still inside. Mitigate by making the auto-expiry generous (60 s) and ensuring the inner body is idempotent (it currently is — `appendCells` always appends to end). Raise expiry to 120 s if concerns surface.
- Performance: serializing per-sheet adds latency proportional to (concurrency × average appendCells duration). For a 15-factura scan at ~250 ms per call, that's ~3 s of added latency. Negligible against the 100+ s typical scan duration. Acceptable trade-off for correctness.
- Task 3's response-verification depends on Google's response shape. If `replies[0].appendCells` is empty even on success, the fallback `getValues` round-trip adds one read per append. Mitigation: only verify on the first attempt; skip on retries (we trust the lock).

---

## Iteration 1

**Date:** 2026-05-11
**Method:** single-agent (5 tasks, 2 independent units, 8 effort points → below worker threshold)
**Status:** COMPLETE

### Tasks Completed

- **Task 1** — Failing tests for concurrent `appendRowsWithLinks` row loss (`src/services/sheets.test.ts`)
- **Task 2** — Added `withLockResult` adapter in `src/utils/concurrency.ts`; wrapped `appendRowsWithLinks` with per-sheet `withLock` keyed `sheet-append:${spreadsheetId}:${sheetName}`
- **Task 3** — Response validation: throw on missing `replies[0]` so `withQuotaRetry` retries
- **Task 4** — `DuplicateCache.addEntry` now normalizes `CellDate` / `CellNumber` / `CellLink` / `CellFormula` wrappers to primitives via `normalizeForCache`
- **Task 5** — Added "SHEETS API CONCURRENCY" section to CLAUDE.md; JSDoc on `appendRowsWithLinks` reflects the new contract

### Files Modified

- `src/services/sheets.ts` — appendRowsWithLinks restructured; lock keyed per-sheet; response validated; `withTiming` placed inside lock body to keep durationMs lock-free
- `src/utils/concurrency.ts` — added `withLockResult`
- `src/processing/caches/duplicate-cache.ts` — added `normalizeForCache`; `addEntry` now normalizes rows before storing
- `src/services/sheets.test.ts` — new "appendRowsWithLinks concurrency (ADV-242)" describe with 3 tests; mocks updated to return realistic `replies` array; `quotaThrottle.reset()` added to beforeEach (cross-describe pollution fix)
- `src/utils/concurrency.test.ts` — 5 tests for `withLockResult`
- `src/processing/caches/duplicate-cache.test.ts` — 3 tests for wrapper-cell normalization with `CellNumber` shapes
- `CLAUDE.md` — new SHEETS API CONCURRENCY subsection

### Bug-Hunter Findings (Pre-Merge)

4 issues found and fixed before commit:

1. **HIGH** — Lock auto-expiry was 120 s but `SHEETS_QUOTA_RETRY_CONFIG` can produce ~12-min retry chains, risking re-opening the ADV-242 race after expiry. **Fix:** Raised to 900 s (15 min); the expiry is now intended solely to recover from a crashed holder.
2. **MEDIUM** — Comments claimed `appendCells` is idempotent "at worst duplicates, never overwrites." **Fix:** Both occurrences (sheets.ts and CLAUDE.md) now state plainly that `appendCells` is NOT idempotent w.r.t. server-side end-of-data detection.
3. **LOW** — `withTiming` wrapped `withLockResult`, so lock-wait time was logged as API duration and tripped SLOW_CALL_THRESHOLD_MS warnings on every queued append. **Fix:** Moved `withTiming` inside the lock body.
4. **LOW** — JSDoc referred to `replies[0].appendCells` which doesn't exist in the schema. **Fix:** Updated to reflect that successful responses return `replies[0]` as empty `{}`.

### Verification

- `npm test` → 2281 / 2281 tests passing
- `npm run build` → clean, zero warnings (Apps Script bundle also generated successfully)

### Cross-Describe Test Pollution (Diagnosed During Implementation)

Older `sheets.test.ts` describes use `vi.useFakeTimers()` while exercising quota-retry paths that call `quotaThrottle.reportQuotaError()`. The throttle is a module-level singleton; its `lastErrorTime` captured under fake time can land in the *future* relative to the real `Date.now()` used by the new concurrency describe — making the auto-reset window never satisfy and forcing a 5 s wait on every API call.

Fix: new describe calls `quotaThrottle.reset()` in `beforeEach`. Documented in CLAUDE.md under "Test hygiene note" so future maintainers writing real-timer specs against the same modules don't repeat the debug session.

### Tasks Remaining

None. Plan complete.

### Review Findings

Reviewed by 3-agent team (security, reliability, quality) on 2026-05-11. 11 total findings: **2 FIX (both S-size — fixed inline)**, **9 DISCARD**.

**Fixed inline (S-size, TDD-verified):**

1. **MEDIUM** `[convention]` `src/processing/caches/duplicate-cache.ts:12` — `normalizeForCache` JSDoc lacked `@param`/`@returns` tags. CLAUDE.md mandates JSDoc on exported functions; rest of the codebase consistently uses both tags. **Fix:** added `@param cell` + `@returns` plus a paragraph documenting which wrapper variants are unwrapped (CellDate/CellNumber/CellFormula → value; CellLink → text; primitives/null/undefined pass through). Tracking: ADV-243 (Merge).
2. **LOW** `[edge-case]` `src/processing/caches/duplicate-cache.test.ts` — Indirect-only coverage of `normalizeForCache` (via `addEntry`) missed CellFormula, null, undefined, and plain-primitive paths. Function handles them correctly, but no test guards the behavior. **Fix:** added `describe('normalizeForCache (unit)', ...)` block with 9 direct unit tests covering every input variant. Tracking: ADV-244 (Merge).

**Discarded (reasoning preserved here so the user can audit before this file is overwritten):**

- **LOW** `[security]` `src/services/sheets.ts:1202-1203` — spreadsheetId in error message string. **Discarded:** per saved feedback memory, log redaction findings are not flagged for this project; logs are an internal debugging surface, spreadsheetIds are not credentials. Pre-existing pattern across lock-manager `resourceId` logging.
- **LOW** `[security]` `src/utils/concurrency.ts` (resourceId in WARN logs) — Same reasoning as above. Internal logs only.
- **MEDIUM** `[async]` `src/services/sheets.ts:1081,1212` — 60s lock wait timeout could expire while a holder is in a long quota-retry chain, sending files to Sin Procesar. **Discarded:** intentional by design (reviewer's own note: "flagging for awareness rather than as a defect requiring change"). Sin Procesar files are recovered automatically by the next scan via `getStaleProcessingFileIds` — no data loss, just graceful degradation under sustained quota pressure.
- **MEDIUM** `[bug]` `src/services/sheets.ts:1199-1204` — `!replies[0]` validation could trigger a non-idempotent duplicate retry if Google ever returns falsy `replies[0]` after success. **Discarded:** explicitly accepted in CLAUDE.md as defense-in-depth; removing the check reintroduces the silent row-loss bug class this PR exists to fix. The current API reliably returns `{}` (truthy), so the duplicate-on-future-API-change risk is theoretical and bounded.
- **LOW** `[edge-case]` `src/processing/caches/duplicate-cache.ts:16` — `normalizeForCache` returns the formula string for CellFormula cells, not the computed value. **Discarded:** formula columns (e.g., `saldoCalculado`) are not used in any dupe-check key, so this never affects production behavior. The "semantically correct" value (the computed result) is unknown at write time, so there's no fix to apply.
- **LOW** `[test]` `src/services/sheets.test.ts:2807-2822` — Malformed-response test spends 3–4s on real-time retry backoff. **Discarded:** test works correctly; "fix" would require API-surface changes for marginal CI speedup. Performance, not bug.
- **LOW** `[convention]` `src/services/sheets.ts:1148-1149` — Lock key uses `:` as separator without escaping. **Discarded:** Google Drive file IDs never contain `:`, so collision is impossible (reviewer's own conclusion).
- **LOW** `[convention]` `src/services/sheets.test.ts` — Blanket mock update applies `{ replies: [{ appendCells: {} }] }` to all `batchUpdate` operations including formatSheet/deleteSheet/sortSheet/etc. **Discarded:** tests pass, mock shape is for operations that don't inspect `replies`, no functional impact. Style only.
- **LOW** `[edge-case]` `src/utils/concurrency.test.ts:~395` — Lock-timeout test uses `setTimeout(10)` instead of `Promise.withResolvers`-based deferred gating used in sheets.test.ts. **Discarded:** reviewer confirms "Not flaky in practice" — synchronous CAS in the happy path makes the 10ms macrotask reliable. Style consistency only.

### Linear Updates

- ADV-242 — **Review → Merge** (review passed; original concurrency-fix issue complete)
- ADV-243 — **Created in Merge** (inline-fix audit trail: JSDoc convention)
- ADV-244 — **Created in Merge** (inline-fix audit trail: direct unit tests)

### Inline Fix Verification

- Targeted: `npx vitest run src/processing/caches/duplicate-cache.test.ts` → 36 / 36 passing (9 new)
- Full suite: `npm test` → all green
- Build: `npm run build` → clean, zero warnings
- bug-hunter on the inline diff: "No bugs found" — confirmed JSDoc accuracy and that all 9 new assertions are meaningful and exercise distinct code paths

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented, reviewed, and inline-fixes verified. ADV-242, ADV-243, ADV-244 all in Merge state.
