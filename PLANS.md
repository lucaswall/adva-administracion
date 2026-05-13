# Implementation Plan

**Created:** 2026-05-12
**Source:** Inline request: Replace the Subdiario de Ventas full-sheet clear-and-rewrite (which pollutes revision history) with an incremental keyed-diff sync, and apply one-time idempotent sheet chrome (column widths, text wrap, banding, header background, ARS locale, view-only protected range, string-typed comprobante numbers) so the workbook renders cleanly for the contador.
**Linear Issues:** [ADV-263](https://linear.app/lw-claude/issue/ADV-263/subdiario-incremental-diff-core-diffsubdiariorows-pure-function), [ADV-264](https://linear.app/lw-claude/issue/ADV-264/subdiario-incremental-readsubdiariorows-sheet-reader), [ADV-265](https://linear.app/lw-claude/issue/ADV-265/subdiario-incremental-writer-diff-path-replaces-clearappend-single), [ADV-266](https://linear.app/lw-claude/issue/ADV-266/subdiario-chrome-widths-wrap-banding-header-bg-protected-range-locale), [ADV-267](https://linear.app/lw-claude/issue/ADV-267/subdiario-incremental-surface-diff-stats-in-endpoint-response-match)
**Branch:** feat/subdiario-incremental-sync

## Context Gathered

### Codebase Analysis

**Source code map** (verified from current main, post-PR-116):

- **Writer (replace clear+append path):** `src/services/subdiario-writer.ts:228-449` (`syncSubdiario`). Steps 5-6 (lines 361-428) currently do `clearSheetData(subdiarioId, COMPROBANTES_SHEET)` then `appendRowsWithLinks(...)`. This is the block being replaced. Sheet identity is hardcoded: `SUBDIARIO_NAME='Subdiario de Ventas'`, `COMPROBANTES_SHEET='Comprobantes'` (lines 47-50).
- **Builder (UNTOUCHED):** `src/services/subdiario-builder.ts:628-729` — pure `buildSubdiarioRows(input: SubdiarioInput): SubdiarioRow[]`. All 26 tests in `subdiario-builder.test.ts` stay green; this work adds no test changes here.
- **Row + Input types:** `src/types/index.ts:1108-1141` (`SubdiarioRow`) and `1146-1161` (`SubdiarioInput`). `SubdiarioRow` has 13 fields: `fecha, cod, tipo, nro, cliente, cuit, condicion, total, concepto, categoria, fechaCobro, recibido, notas`. `recibido` is `number | null`; `fechaCobro` is `'YYYY-MM-DD'` OR `'NC 00003-00000140'` OR `''`.
- **Headers constant:** `src/constants/spreadsheet-headers.ts:548-562` (`SUBDIARIO_COMPROBANTES_HEADERS`).
- **Cell emission shape (current):** `subdiario-writer.ts:382-400` builds `CellValueOrLink[][]` rows for `appendRowsWithLinks`. `fecha` → `{ type:'date', value }`; `total` → `{ type:'number', value }`; `fechaCobro` → date or plain string depending on regex match; `recibido` → number or `''` for null.
- **Sheets helpers (re-used):**
  - `getValues(spreadsheetId, range)` — `src/services/sheets.ts:227-244`. Used for the new sheet-reader.
  - `formatSheet(spreadsheetId, sheetId, options)` — `src/services/sheets.ts:580-684`. Today only supports `frozenRows` and `numberFormats`. The chrome module will use direct `spreadsheets.batchUpdate` for new request types (column widths, wrap, banding, protected range, locale) rather than expanding `formatSheet` — these are one-shot boot-time concerns, not per-write.
  - `getSheetMetadata(spreadsheetId)` — used at `subdiario-writer.ts:115, 119`. Returns `[{ title, sheetId, index }]`. The chrome module needs an additional helper for grid properties (column widths, banded ranges, protected ranges, locale) — either extend `sheets.ts` with a new `getSpreadsheetProperties` wrapper or invoke `spreadsheets.get` directly inside the chrome module.
  - `appendRowsWithLinks` lock key: `sheet-append:${spreadsheetId}:${sheetName}` — `src/services/sheets.ts:1149`. The new diff path MUST acquire the same lock around its `batchUpdate` so it serializes with any other writer to Comprobantes.
- **Concurrency:** `src/utils/concurrency.ts:291-318` (`withLock`) + `withLockResult` (lines 334-345). Sheets append constants: `APPEND_LOCK_WAIT_TIMEOUT_MS=60_000`, `APPEND_LOCK_AUTO_EXPIRY_MS=900_000` (`sheets.ts:1097-1098`).
- **Quota retry:** `withQuotaRetry` at `src/utils/concurrency.ts:621-718`. The new `batchUpdate` calls (writer diff path AND chrome module) MUST go through this wrapper — matches the `formatSheet` and `appendCells` patterns.
- **Result type:** `src/types/index.ts:10-12` — `Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }`.
- **Sync trigger (unchanged):** `src/bank/match-movimientos.ts:1313-1338` calls `syncSubdiario` after every match. Errors are caught and logged but don't fail the match operation. Trigger frequency stays.
- **Endpoint (response contract preserved, additively extended):** `src/routes/subdiario.ts:19-23, 40-119` — `POST /api/rebuild-subdiario`. Today returns `{ rowsWritten, gapsDetected, durationMs }`. Apps Script consumer (`apps-script/src/main.ts:254-303`) reads `rowsWritten` only — adding diff counts is safe.
- **Boot orchestration:** `src/server.ts:351-357` runs `initializeFolderStructure()`, `runStartupMigrations()`, then `initializeRealTimeMonitoring()`. The chrome-ensure step plugs in after `runStartupMigrations()` (line 354).
- **Date normalization (CLAUDE.md rule):** When reading `fecha` / `fechaCobro` back from the sheet, MUST use `normalizeSpreadsheetDate(cellValue)` from `src/utils/date.ts` — `getValues` returns serial numbers for `CellDate` fields.

**Existing patterns to follow:**

- **Test mocking:** `src/services/subdiario-writer.test.ts:14-66` — `vi.mock()` for drive/sheets/folder-structure/facturador/builder/logger/correlation. Default mocks via `setupDefaultMocks()` helper (lines 102-122). Fixture builder convention in `subdiario-builder.test.ts:29-76` (`makeFc`, `makeNc`, `makeMov`, `makeRetCert`).
- **Result<T,E>:** All async I/O paths return `Result`. Never throw across module boundaries — wrap in `Result.err`.
- **Logger:** Pino via `src/utils/logger.ts`. Field convention: `{ module: 'subdiario-writer', phase: 'sync', correlationId }`.
- **Idempotent format application:** `formatSheet` re-applies bold/freeze unconditionally today (cheap, but bloats revision history when called every sync). The new chrome module reads state once at boot and only emits divergent requests.

### MCP Context

- **Linear MCP:** Verified team `ADVA Administracion` (`65ba2564-914a-4482-8ce9-dcd399ffa202`). All 18 Subdiario issues ADV-245..262 are Done; no overlap. New issues created in Todo state.
- **Web research (from roadmap session 499353d4):** `autoResizeDimensions` unreliable (googleapis/google-api-nodejs-client#1832 + issuetracker.google.com/254659439) — use explicit `pixelSize`. `addBanding` errors on overlap — store `bandedRangeId` and use `updateBanding` on subsequent runs. `deleteDimension`→`appendCells` race is a documented backend issue (`discuss.google.dev/t/345218`) — mitigation: pack all sub-requests into one `batchUpdate` so Google serializes server-side. AFIP comprobante numbers (`00003-00000140`) must be emitted as `userEnteredValue.stringValue` to preserve leading zeros and the dash.

### Migration Note

This is a **behavior change, not a schema change** — no new `CURRENT_SCHEMA_VERSION` entry, no `migrations.ts` registration. The Comprobantes sheet content survives the cutover because the diff path matches existing rows by `(cod, nro)` and updates them in place. **First sync after deploy** may trigger the sort-invariant fallback (one-shot rewrite under that sync only — single revision history entry, then incremental from the next sync onward) if the existing sheet's row order doesn't match `fecha ASC, nro ASC`. No manual migration required.

## Tasks

### Task 1: Diff core — `diffSubdiarioRows` pure function

**Linear Issue:** [ADV-263](https://linear.app/lw-claude/issue/ADV-263/subdiario-incremental-diff-core-diffsubdiariorows-pure-function)
**Files:**
- `src/services/subdiario-diff.ts` (create)
- `src/services/subdiario-diff.test.ts` (create)

**Behavioral spec:**

Pure function `diffSubdiarioRows(existing, desired): SubdiarioDiff` keyed by `(cod, nro)`. No I/O, no `Result<T,E>` (cannot fail at this layer; sort-invariant and duplicate-keys are signaled via fields, not errors).

Return shape:

- `SubdiarioRowWithIndex extends SubdiarioRow` with a `rowIndex: number` (0-indexed; first data row in the sheet = index 0).
- `SubdiarioDiff` with:
  - `updates: { rowIndex: number; row: SubdiarioRow }[]` — `(cod, nro)` matched but at least one field differs; `rowIndex` is the existing sheet row to update in place.
  - `inserts: { insertAt: number; row: SubdiarioRow }[]` — rows in `desired` with no matching key in `existing`; `insertAt` is the chronological position in `desired`.
  - `deletes: number[]` — existing row indices to delete, sorted DESCENDING (bottom-up to avoid index shift).
  - `sortInvariantViolated: boolean` — true when `existing` is not sorted by `(fecha ASC, nro ASC)`; caller falls back to one-shot rewrite.
  - `duplicateKeysDetected: boolean` — true when `(cod, nro)` is non-unique in `existing`; caller logs and treats second/subsequent occurrences as deletes (first wins).

**Equality semantics (load-bearing):**

A `(cod, nro)` match is an UPDATE iff at least one field of `SubdiarioRow` differs after normalization:

- `total: number` — `Math.abs(a - b) < 0.005` (ARS is 2-decimal; protects against floating-point round-trip noise on the first sync after deploy).
- `recibido: number | null` — `null === null` is no-op; `null vs number` is an update; `number vs number` uses the same epsilon as `total`.
- All string fields — strict equality after `.trim()`.

This matters because the FIRST sync after deploy reads back rows the OLD writer just wrote — if equality is too strict (floating point round-trip, whitespace), every row triggers a spurious update on day one and the very migration we're avoiding gets re-introduced.

**Steps:**

1. Write tests in `src/services/subdiario-diff.test.ts`:
   - Empty existing + N desired → all inserts, no updates/deletes, `sortInvariantViolated=false`
   - Identical existing + desired → empty diff (no updates, no inserts, no deletes)
   - One row value change (e.g. `recibido` flips from `null` → `50000`) → one update at the correct `rowIndex`; no inserts/deletes
   - One row deleted from desired → one delete with the correct `rowIndex`; deletes returned descending
   - Two new rows inserted at correct chronological positions → two inserts with `insertAt` reflecting position in `desired`
   - Mixed: some updates + some inserts + some deletes
   - Existing sheet has rows in wrong chronological order → `sortInvariantViolated=true`
   - Existing sheet has duplicate `(cod, nro)` → `duplicateKeysDetected=true`; first occurrence kept, second emitted as a delete
   - Floating-point round-trip equality: existing.total=`1234.567` vs desired.total=`1234.5670000001` → NO update (within epsilon)
   - NC row (`tipo='NC'`, `total<0`) treated identically to FC under the keyed diff
   - Whitespace-only differences in string fields → no update (post-trim equality)
2. Run verifier (expect fail).
3. Implement `diffSubdiarioRows` in `src/services/subdiario-diff.ts`. Build the `existing` index as `Map<key, SubdiarioRowWithIndex>` where `key = '${cod}|${nro}'`. Walk `desired` linearly to detect inserts/updates; walk `existing` keys not in `desired` for deletes. Detect sort-invariant via a pairwise scan over `existing`.
4. Run verifier (expect pass).

**Notes:**

- Follow the pure-function style of `src/services/subdiario-builder.ts` — no I/O, deterministic output.
- Reuse the type definitions from `src/types/index.ts` for `SubdiarioRow`; add `SubdiarioRowWithIndex` and `SubdiarioDiff` to `src/types/index.ts` near the existing `SubdiarioRow` declaration (line 1108).

---

### Task 2: Sheet reader — `readSubdiarioRows`

**Linear Issue:** [ADV-264](https://linear.app/lw-claude/issue/ADV-264/subdiario-incremental-readsubdiariorows-sheet-reader)
**Files:**
- `src/services/subdiario-writer.ts` (modify — add internal helper near `resolveSubdiarioId` at line 71)
- `src/services/subdiario-writer.test.ts` (modify)

**Behavioral spec:**

Internal helper:

```
async function readSubdiarioRows(spreadsheetId: string): Promise<Result<SubdiarioRowWithIndex[], Error>>
```

Reads `Comprobantes!A2:M` via `getValues`, parses each row into `SubdiarioRowWithIndex` matching `SUBDIARIO_COMPROBANTES_HEADERS` column order. `rowIndex` is 0-indexed (first data row = 0).

**Parsing rules — mirror the writer's emission at `subdiario-writer.ts:382-400` exactly:**

- `fecha` (col A) — `normalizeSpreadsheetDate(cell)`. If empty after normalization → skip the row entirely (defensive against any stray blank rows in the sheet).
- `cod, tipo, nro, cliente, cuit, condicion, concepto, categoria, notas` — `String(cell ?? '').trim()`
- `total` (col H) — `parseNumber(cell)` (already imported at `subdiario-writer.ts:34`); 0 fallback if NaN.
- `fechaCobro` (col K) — if cell is a number (serial), use `normalizeSpreadsheetDate`; if it's a string, pass through as-is (covers `'NC 00003-00000140'` and `''`).
- `recibido` (col L) — empty/blank cell → `null`; non-empty → `parseNumber(cell)`.
- `tipo` must be `'FC' | 'NC'` — warn on unknown but keep the row (it'll fail to match anything in `desired` and end up as a delete, which is the correct cleanup behavior).

**Steps:**

1. Write tests in `src/services/subdiario-writer.test.ts` under a new `describe('readSubdiarioRows')` block:
   - Empty sheet (only header) → `{ok: true, value: []}`
   - Two FC rows + one NC row → parsed correctly; rowIndex 0/1/2; `recibido=null` for empty col L cell
   - `fecha` returned as serial number (e.g. `45993`) → normalized to `'2025-12-02'`
   - `fechaCobro='NC 00003-00000140'` (string) → passed through as string, not date-parsed
   - `fechaCobro` returned as serial number → normalized to YYYY-MM-DD
   - `total=1234567.89` round-trips numerically
   - `getValues` returns `{ok: false, error}` → propagated
   - Row with empty `fecha` cell → skipped (not in result; rowIndex of subsequent rows still reflects sheet position)
2. Run verifier (expect fail).
3. Implement `readSubdiarioRows` in `src/services/subdiario-writer.ts`. Use existing `getValues`, `normalizeSpreadsheetDate`, `parseNumber` imports.
4. Run verifier (expect pass).

**Notes:**

- Follow the CLAUDE.md rule (Reading dates from spreadsheets section): `normalizeSpreadsheetDate` not `String()` for `CellDate` fields.
- This helper is internal to `subdiario-writer.ts`. If the test cannot reach it without an export, add an `export` and document it as internal-test-only — do not let callers outside this module depend on it.

---

### Task 3: Writer diff path — replace clear+append with single `batchUpdate`

**Linear Issue:** [ADV-265](https://linear.app/lw-claude/issue/ADV-265/subdiario-incremental-writer-diff-path-replaces-clearappend-single)
**Files:**
- `src/services/subdiario-writer.ts` (modify — lines 361-428)
- `src/services/subdiario-writer.test.ts` (modify)
- `src/services/sheets.ts` (modify — add `applySubdiarioDiff` primitive)
- `src/types/index.ts` (modify — extend `SyncSubdiarioResult` if it lives there; today it's at `subdiario-writer.ts:55-60`)

**Behavioral spec:**

Replace `subdiario-writer.ts:361-428` (the `if (!isNew) clearSheetData; appendRowsWithLinks` block) with this sequence:

1. **Resolve `Comprobantes` sheetId** via `getSheetMetadata(subdiarioId)` (lookup the sheet by title once; cache on cached folder structure if beneficial, but a per-sync lookup is acceptable).
2. **Read current sheet** via `readSubdiarioRows(subdiarioId)` (Task 2). On first-ever sync (`isNew=true`), skip the read and treat existing as `[]`.
3. **Diff** via `diffSubdiarioRows(existing, desired)` (Task 1).
4. **No-op short-circuit:** if `updates`, `inserts`, and `deletes` are all empty AND `sortInvariantViolated=false`, skip the `batchUpdate` entirely. Log at `debug`. Return success with diff counts all zero.
5. **Sort-invariant fallback:** if `diff.sortInvariantViolated=true`, build a single one-shot rewrite: a `deleteDimension` over all existing data rows plus `insertDimension`+`updateCells` (or equivalent `appendCells`) for the full desired set — emitted inside the SAME `batchUpdate`. Log a warning with the sheet's first 10 out-of-order rowIndex pairs. Set `sortInvariantFallback=true` in the result.
6. **Single `batchUpdate`:** otherwise emit ONE `batchUpdate` containing in this order:
   - `deleteDimension` requests for each `diff.deletes` entry (already DESC; pack as one or many sub-requests, implementer's choice).
   - `insertDimension` + `updateCells` pairs for each `diff.inserts` entry. The `insertDimension` `range.startIndex` = `insert.insertAt + 1` (1 for the header row). The `updateCells` writes the row at the same range.
   - `updateCells` requests for each `diff.updates` entry, `fields` scoped to `userEnteredValue` only (preserves any per-cell formatting the contador may have applied locally).
7. **Lock acquisition:** wrap the entire `read → diff → batchUpdate` sequence in `withLockResult('sheet-append:${subdiarioId}:${COMPROBANTES_SHEET}', ...)` reusing the same lock key as `appendRowsWithLinks`. This serializes the diff path with any future writer to Comprobantes (defense against the ADV-242 class of bug per CLAUDE.md SHEETS-API-CONCURRENCY section).
8. **Quota retry:** the `batchUpdate` call goes through `withQuotaRetry` (match the `formatSheet` pattern).
9. **Return type:** extend `SyncSubdiarioResult` (lines 55-60) with `inserts: number`, `updates: number`, `deletes: number`, `sortInvariantFallback: boolean`. Existing fields `rowsWritten` and `gapsDetected` keep their semantics — `rowsWritten = desired.length` (the count of rows that SHOULD be in the sheet, not the count of API operations); `gapsDetected` keeps its existing computation at line 378.

**Cell emission rules (per row, in BOTH `updateCells` and `insertDimension+updateCells`):**

Build the `CellData[]` with the same value semantics as today's `cellRows.map` at `subdiario-writer.ts:382-400`, PLUS this NEW INVARIANT:

- `nro` (col D) — emitted as `userEnteredValue: { stringValue: row.nro }` explicitly. NEVER `numberValue`. AFIP numbers like `00003-00001956` and gap placeholder rows MUST round-trip with leading zeros and the dash preserved. Add an explicit assertion test.
- `fecha` (col A) — `userEnteredValue: { numberValue: <serial> }` with the date number format applied via the chrome module (Task 4). The diff path emits the serial; chrome applies the display pattern.
- `total` (col H) — `userEnteredValue: { numberValue: row.total }`.
- `recibido` (col L) — `userEnteredValue: { numberValue: row.recibido }` when not null; empty `userEnteredValue` object (no value key) when null — produces a blank cell.
- `fechaCobro` (col K) — `numberValue` (serial) when matching `^\d{4}-\d{2}-\d{2}$`; `stringValue` otherwise (covers `'NC 00003-...'` and `''`).

**Steps:**

1. Write tests in `src/services/subdiario-writer.test.ts`:
   - Happy path: existing has 2 rows; desired has 1 update + 1 insert + 1 delete → exactly ONE `batchUpdate` call; assert the lock was acquired with key `sheet-append:${subdiarioId}:Comprobantes`.
   - No-op: existing == desired → ZERO `batchUpdate` calls; result has `inserts=0, updates=0, deletes=0, sortInvariantFallback=false`.
   - Sort-invariant fallback: existing has rows out of chronological order → one `batchUpdate` with delete-all + full insert; warning logged; `sortInvariantFallback=true`; `inserts = desired.length`.
   - First-ever sync (`isNew=true`): skips the read, treats existing as empty, all rows are inserts.
   - `getSheetMetadata` failure → `Result.err` propagated; no `batchUpdate` issued.
   - `batchUpdate` failure → `Result.err` propagated; lock released cleanly (verify via the next call acquiring without timeout).
   - `nro` emission: inspect the `batchUpdate` request body; every `userEnteredValue` for col D is `{ stringValue: ... }` — not `{ numberValue: ... }`.
   - `gapsDetected` count survives — placeholder rows with `cliente.startsWith('FALTA ')` still counted from the same `rows.filter` logic at line 378.
   - `recibido=null` row → emitted `userEnteredValue` is empty (blank cell), not `numberValue: 0`.
   - Concurrency: two concurrent `syncSubdiario` calls on the same `subdiarioId` — second one waits on the lock (uses `vi.useFakeTimers()` + the lock-state inspection helpers if available; otherwise verify mock-call ordering).
2. Run verifier (expect fail).
3. In `src/services/sheets.ts`: add an exported primitive `applySubdiarioDiff(spreadsheetId, sheetId, diff, desiredRows): Promise<Result<{updates: number; inserts: number; deletes: number}, Error>>` that builds the sub-requests, wraps the `batchUpdate` call in `withQuotaRetry`, and returns counts. Keeping it Subdiario-shaped is fine — the row→`CellData[]` conversion is row-shape-specific. The lock acquisition stays in `subdiario-writer.ts` so the writer controls the read+diff+apply atomicity.
4. In `src/services/subdiario-writer.ts`: replace lines 361-428. Update `SyncSubdiarioResult` interface. Verify all consumers of the result (`src/bank/match-movimientos.ts:1313-1338`, `src/routes/subdiario.ts:99-107`) still destructure correctly.
5. Run verifier (expect pass).

**Notes:**

- **Concurrency anti-pattern guard (CLAUDE.md SHEETS API CONCURRENCY):** The new diff path MUST run under the `sheet-append:${id}:${name}` lock. Do NOT bypass with raw `batchUpdate`. ADV-242 was caused by exactly this kind of unlocked path.
- **Delete-then-append race:** packing all sub-requests into one `batchUpdate` mitigates the documented `deleteDimension`→`appendCells` ordering issue.
- **Builder is untouched.** All 26 `subdiario-builder.test.ts` tests must still pass without modification.
- **Within-batch index semantics:** Google's docs are ambiguous on how `insertDimension` and `deleteDimension` interleave inside a single `batchUpdate`. The spec mandates deletes-first sorted DESC, but the implementer must verify against the live API. If interleaving turns out to shift indices unexpectedly, fall back to: deletes-only in one batch, then inserts+updates in a second batch — still under the same lock.

---

### Task 4: Chrome module — `ensureSubdiarioChrome` (widths, wrap, banding, header bg, protected range, locale)

**Linear Issue:** [ADV-266](https://linear.app/lw-claude/issue/ADV-266/subdiario-chrome-widths-wrap-banding-header-bg-protected-range-locale)
**Files:**
- `src/services/subdiario-chrome.ts` (create)
- `src/services/subdiario-chrome.test.ts` (create)
- `src/services/subdiario-writer.ts` (modify — export `resolveSubdiarioId`)
- `src/services/sheets.ts` (modify — add `getSpreadsheetProperties` helper that returns the typed shape from `spreadsheets.get`)
- `src/server.ts` (modify — add `initializeSubdiarioChrome` boot step after line 354)

**Behavioral spec:**

Exported function:

```
export async function ensureSubdiarioChrome(
  spreadsheetId: string,
  sheetId: number
): Promise<Result<{ changesApplied: number }, Error>>
```

Runs once per server boot from `src/server.ts` after `runStartupMigrations()`. Reads current sheet state via `spreadsheets.get` with a scoped `fields` mask, then emits a SINGLE `batchUpdate` containing only requests that diverge from the target state. Skips entirely (returns `{ changesApplied: 0 }`) when state matches.

**Target state:**

1. **Column widths** (13 columns A-M, explicit `pixelSize`). Recommended baseline (implementer can tune by reading sample data):
   `fecha 90 · cod 50 · tipo 50 · nro 130 · cliente 240 · cuit 110 · condicion 180 · total 110 · concepto 320 · categoria 100 · fechaCobro 110 · recibido 110 · notas 380`
   Emit `updateDimensionProperties` per-column ONLY if current `pixelSize` differs.
2. **Text wrap** — `wrapStrategy: WRAP` on `Comprobantes!A2:M` (data range only; header row unchanged). Emit `repeatCell` with `fields: 'userEnteredFormat.wrapStrategy'` only when divergent. State check: sample one row's `effectiveFormat.wrapStrategy` via the `spreadsheets.get` `ranges` parameter.
3. **Banding** — alternating row colors on `Comprobantes!A2:M`. Header band: `{ red: 0.85, green: 0.85, blue: 0.85 }`. First band: white. Second band: `{ red: 0.96, green: 0.96, blue: 0.96 }`.
   - On boot, read existing `bandedRanges` via `spreadsheets.get`. If a banding already exists on Comprobantes, capture its `bandedRangeId` and use `updateBanding` (no-op if colors already match). If no banding exists, emit `addBanding`. **NEVER emit `addBanding` twice on the same range — the API errors on overlap.**
4. **Header background** — grey (`{ red: 0.85, green: 0.85, blue: 0.85 }`) on row 1, cols A-M. Bold is already set by `formatSheet` on first creation; preserve it. Idempotent via `effectiveFormat.backgroundColor` state-check on a header cell.
5. **Protected range** — `addProtectedRange` with `warningOnly: true` over `Comprobantes!A2:M`. Description: `"Sistema — Subdiario de Ventas auto-sincronizado"`. Idempotent rule: read existing `protectedRanges` first; only emit if no protected range with this exact description already exists.
6. **`total` number format** — `numberFormat: { type: 'NUMBER', pattern: '#,##0.00' }` on col H (currency separator rendering comes from the locale, set below).
7. **`fecha` and `fechaCobro` date format** — `numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }` on cols A and K. Emit only when divergent.
8. **Spreadsheet locale** — read `properties.locale` from `spreadsheets.get`. If not `'es_AR'`, emit `updateSpreadsheetProperties` with `locale: 'es_AR'`, `fields: 'locale'`. This makes `#,##0.00` render as `$ 1.234,56` instead of `$ 1,234.56`.

**State-check approach (single API read):**

```
spreadsheets.get({
  spreadsheetId,
  fields: 'properties.locale,sheets(properties(sheetId,title,gridProperties(columnCount,frozenRowCount)),data(columnMetadata(pixelSize),rowData(values(effectiveFormat(wrapStrategy,backgroundColor,numberFormat)))),bandedRanges,protectedRanges)',
  ranges: ['Comprobantes!A1:M2']
})
```

One read per boot. Run inside `withQuotaRetry`.

**Boot hook:**

In `src/server.ts` after line 354 (`await runStartupMigrations();`), call a new `await initializeSubdiarioChrome();` (sibling pattern to `initializeFolderStructure` at line 60):

1. Read `getCachedFolderStructure()`. If null → log warn, return (matches the guard at lines 360-362).
2. Resolve `subdiarioId` via the exported `resolveSubdiarioId(rootFolderId)` from `subdiario-writer.ts`. (Side benefit: pre-populates the cached `subdiarioId` so the first sync skips its own resolve step.)
3. Resolve `Comprobantes` sheetId via `getSheetMetadata(subdiarioId)`.
4. Call `ensureSubdiarioChrome(subdiarioId, sheetId)`.
5. Log result. **Failures here are NOT fatal** — log at `warn` and continue. Chrome is cosmetic; the data sync still works without it.

**Steps:**

1. Write tests in `src/services/subdiario-chrome.test.ts`:
   - Empty/missing state (new workbook, no widths set, no banding, no protected range, locale `en_US`) → batchUpdate emitted with ALL target requests; locale request present.
   - Fully-aligned state → ZERO `batchUpdate` calls; `changesApplied: 0`.
   - Partial divergence (widths match but locale is `en_US`) → batchUpdate with ONLY `updateSpreadsheetProperties` for locale.
   - Existing banding with different colors → `updateBanding` (with adopted `bandedRangeId`), NOT `addBanding`.
   - Existing protected range with our description → no new protected-range request.
   - `spreadsheets.get` failure → `Result.err` propagated; NO `batchUpdate`.
   - `batchUpdate` failure → `Result.err` propagated.
   - Re-run on identical state (idempotency) → second call is a no-op.
   - One column width matches exactly, twelve diverge → batchUpdate contains 12 `updateDimensionProperties`, not 13.
2. Run verifier (expect fail).
3. Add `getSpreadsheetProperties(spreadsheetId, fieldsMask, ranges?): Promise<Result<SpreadsheetProperties, Error>>` to `src/services/sheets.ts` (thin wrapper around `spreadsheets.get` with `withQuotaRetry`).
4. Export `resolveSubdiarioId` from `src/services/subdiario-writer.ts` (currently file-private at line 71).
5. Implement `ensureSubdiarioChrome` in `src/services/subdiario-chrome.ts`. Pure decision logic (state→requests) is easiest to test; keep the API calls in a thin orchestration layer.
6. Add `initializeSubdiarioChrome()` in `src/server.ts` (sibling to `initializeFolderStructure`). Call it after `runStartupMigrations()` at line 354. Wrap in try/catch — log warn, do NOT throw.
7. Run verifier (expect pass).

**Notes:**

- **`addBanding` overlap error** is the sharpest edge — enforce read-before-emit in tests.
- **`autoResizeDimensions` is unreliable** (googleapis/google-api-nodejs-client#1832, issuetracker.google.com/254659439) — do NOT use it. Explicit `pixelSize` per column.
- **Failure isolation:** chrome failure must not block server startup. Log warn and continue.
- The header background `{ 0.85, 0.85, 0.85 }` matches the read research's suggested grey; tune to match other ADVA workbooks' aesthetic if needed.

---

### Task 5: Surface diff stats in endpoint response and match-hook log

**Linear Issue:** [ADV-267](https://linear.app/lw-claude/issue/ADV-267/subdiario-incremental-surface-diff-stats-in-endpoint-response-match)
**Files:**
- `src/routes/subdiario.ts` (modify)
- `src/bank/match-movimientos.ts` (modify — the post-match sync hook log at lines 1313-1338)
- `src/routes/subdiario.test.ts` (create if missing; modify if exists)

**Behavioral spec:**

`SyncSubdiarioResult` (Task 3) gains `inserts`, `updates`, `deletes`, `sortInvariantFallback`. Surface them:

1. **Route response** at `src/routes/subdiario.ts:19-23, 107` — extend `RebuildSubdiarioResponse` (line 19) with `inserts: number, updates: number, deletes: number, sortInvariantFallback: boolean`. Pass through from `innerResult.value` at line 107: `return { ...innerResult.value, durationMs }`. Existing fields (`rowsWritten`, `gapsDetected`, `durationMs`) unchanged. Apps Script consumer (`apps-script/src/main.ts:254-303`) reads `rowsWritten` only — additive fields are safe; no apps-script bundle rebuild needed for this task.
2. **Match hook log** at `src/bank/match-movimientos.ts:1313-1338` — when `syncSubdiario` returns ok, log diff counts at `info` level so post-match observability shows whether each sync actually changed anything. The "no-op sync" case becomes visible in logs as `inserts: 0, updates: 0, deletes: 0`.

**Steps:**

1. Write tests in `src/routes/subdiario.test.ts`:
   - Successful sync → response body contains `inserts`, `updates`, `deletes`, `sortInvariantFallback` matching the writer's return.
   - No-op sync (all zeros) → response succeeds with all zero counts and `sortInvariantFallback=false`.
   - Sync failure → 500 response, no diff fields in error body (matches existing error shape).
   - Sort-invariant fallback path → response has `sortInvariantFallback=true` and `inserts` matches `rowsWritten`.
2. Run verifier (expect fail).
3. Update `RebuildSubdiarioResponse` interface and the return statement at line 107. Update the match-movimientos log call (around line 1325) to include diff fields from `subdiarioResult.value`.
4. Run verifier (expect pass).

**Notes:**

- This is purely additive — Apps Script's `triggerRebuildSubdiario` (`apps-script/src/main.ts:254-303`) only reads `rowsWritten` and renders it in the success toast. New fields land in the JSON but are ignored. **No apps-script bundle change required.**

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review changes for: lock acquisition around the diff path, batchUpdate sub-request ordering, sort-invariant fallback correctness, chrome idempotency (especially the `addBanding` vs `updateBanding` branch), `nro` stringValue emission, no-op short-circuit not stomping the gap-count, and failure isolation of the chrome boot step.
2. Run `verifier` agent — Verify all tests pass and zero warnings.

---

## Plan Summary

**Objective:** Replace the per-match Subdiario clear-and-rewrite with a keyed-diff incremental sync that preserves Google Sheets revision history, and apply one-time idempotent sheet chrome (column widths, text wrap, banding, header background, ARS locale, view-only protected range, string-typed comprobante numbers) so the workbook renders cleanly for the contador.

**Linear Issues:** ADV-263, ADV-264, ADV-265, ADV-266, ADV-267

**Approach:** A pure `diffSubdiarioRows` function keyed on `(cod, nro)` plus a `readSubdiarioRows` helper. The writer's clear+append block becomes one `batchUpdate` with `updateCells` / `insertDimension+updateCells` / `deleteDimension` sub-requests, all under the existing `sheet-append:${id}:Comprobantes` lock. Sort-invariant violations fall back to a one-shot rewrite for that sync only. A separate `ensureSubdiarioChrome` boot step reads current sheet state via `spreadsheets.get` and only emits divergent format requests. The builder layer and all 26 builder tests stay untouched.

**Scope:** 5 tasks · ~6 files modified, 3 files created · ~40 new test cases (11 diff core + 7 sheet reader + 10 writer diff path + 9 chrome + 4 endpoint).

**Key Decisions:**

- Keyed PK is `(cod, nro)` — deterministic from the builder, AFIP-stable.
- Single `batchUpdate` per sync mitigates the documented `deleteDimension`→`appendCells` backend race.
- Chrome state-check via one `spreadsheets.get` per boot — no per-sync format requests, no revision-history bloat from formatting.
- `addBanding` is replaced with `updateBanding` after the first boot (adopt existing `bandedRangeId`).
- `nro` always emitted as `userEnteredValue.stringValue` (preserves leading zeros + dash).
- Protected range is `warningOnly: true` — sheet stays writable for the SA but the contador sees a "view-only" warning if they click into a cell.
- Equality uses ε=0.005 for `total` and `recibido` to avoid spurious updates from floating-point round-trip on the first post-deploy sync.
- No schema migration — first sync after deploy may hit the sort-invariant fallback ONCE if existing rows aren't sorted; subsequent syncs are incremental.

**Risks:**

- `batchUpdate` sub-request ordering with mixed `insertDimension` and `deleteDimension` against the same sheet can shift indices in subtle ways. The spec mandates deletes-first sorted DESC, but the implementer must verify against the live API; if interleaving is unpredictable, fall back to delete-batch then insert/update-batch under the same lock.
- Equality semantics for `total` and `recibido` rely on ε=0.005. If a future feature stores higher-precision values, the threshold may need revisiting.
- Chrome idempotency depends on accurate state-reads. If `spreadsheets.get` doesn't return `effectiveFormat.wrapStrategy` for empty/never-touched cells, the chrome module may emit a redundant wrap request on every boot. Cheap, but observable in revision history. Monitor on first deploy.

## Status: COMPLETE

---

## Iteration 1

**Implemented:** 2026-05-13
**Method:** Agent team (2 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1 (ADV-263): `diffSubdiarioRows` pure function — keyed-diff on `(cod, nro)` with float-ε equality, sort-invariant + duplicate-key detection (worker-1, 12 tests)
- Task 2 (ADV-264): `readSubdiarioRows` sheet reader — parses `Comprobantes!A2:M` mirroring the writer's emission rules (worker-1, 8 tests)
- Task 3 (ADV-265): writer diff path — replaces clear+append with single `batchUpdate` (deletes DESC → inserts → updates) under the existing `sheet-append:${id}:Comprobantes` lock; no-op short-circuit; sort-invariant fallback (worker-1, 10+ tests in `subdiario-writer.test.ts` + 6 in `sheets.test.ts`)
- Task 4 (ADV-266): `ensureSubdiarioChrome` boot step — state-checked idempotent application of widths, wrap, banding, header bg, protected range, locale; failure-isolated (worker-2, 9 tests)
- Task 5 (ADV-267): surface diff stats in route response + match-hook log — `RebuildSubdiarioResponse` and post-match info log extended with `inserts/updates/deletes/sortInvariantFallback` (worker-1, 4 tests)

### Files Modified
- `src/services/subdiario-diff.ts` (new) - pure keyed-diff function
- `src/services/subdiario-diff.test.ts` (new) - 12 tests
- `src/services/subdiario-chrome.ts` (new) - boot-time chrome with single-read state check
- `src/services/subdiario-chrome.test.ts` (new) - 9 tests
- `src/services/subdiario-writer.ts` - `readSubdiarioRows` added; `resolveSubdiarioId` exported; clear+append block replaced with locked diff path; `SyncSubdiarioResult` extended; `fechaCobro` serial=0 guard (bug-hunter fix)
- `src/services/subdiario-writer.test.ts` - reader tests, writer-diff tests, serial=0 regression test
- `src/services/sheets.ts` - `applySubdiarioDiff` + `rowToCellData` primitive (single batchUpdate, no internal lock); `getSpreadsheetProperties` and `executeBatchRequests` helpers
- `src/services/sheets.test.ts` - 6 tests covering applySubdiarioDiff including the mixed-batch index-shift regression
- `src/types/index.ts` - `SubdiarioRowWithIndex`, `SubdiarioDiff` (with `desiredIndex` on updates)
- `src/routes/subdiario.ts` - `RebuildSubdiarioResponse` extended with diff fields
- `src/routes/subdiario.test.ts` - 4 tests for diff-field surface
- `src/bank/match-movimientos.ts` - post-match info log includes diff counts
- `src/bank/match-movimientos.test.ts` - log expectations updated
- `src/server.ts` - `initializeSubdiarioChrome()` boot step after `runStartupMigrations()`, try/catch + warn (non-fatal)

### Linear Updates
- ADV-263: Todo → In Progress → Review
- ADV-264: Todo → In Progress → Review
- ADV-265: Todo → In Progress → Review
- ADV-266: Todo → In Progress → Review
- ADV-267: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: 1 MEDIUM bug found and fixed (`fechaCobro` serial=0 in `readSubdiarioRows` produced `'1899-12-30'` instead of `''`, which would have caused spurious updates on every sync for rows with that serial; fixed at the parsing layer with a regression test)
- verifier: 2442 tests pass across 75 test files, zero build warnings

### Work Partition
- Worker 1: Tasks 1, 2, 3, 5 — incremental diff pipeline (diff core, sheet reader, writer integration, route/log surfacing). All tightly coupled around `subdiario-writer.ts` + `sheets.ts` + `types/index.ts`.
- Worker 2: Task 4 — chrome boot step (independent module + boot wiring + tiny additive edits to `sheets.ts` and `subdiario-writer.ts`).

### Merge Summary
- Worker 1: merge --no-ff, no conflicts; typecheck clean.
- Worker 2: merge --no-ff, auto-merged `sheets.ts` and `subdiario-writer.ts` (worker-2 additions were strictly additive — single `export` keyword + new helpers appended); typecheck clean.

### Continuation Status
All 5 tasks completed.
