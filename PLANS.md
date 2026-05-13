# Implementation Plan

**Created:** 2026-05-13
**Source:** Inline request: Subdiario de Ventas — soft-drop prior-year paid FCs and surface soft-paid (pago_recibido) state with bank-row hyperlinks. Trust Resumen Bancario as authority; comprobante is a soft preview.
**Linear Issues:** [ADV-268](https://linear.app/lw-claude/issue/ADV-268/subdiario-surface-pagada-on-facturas-emitidas), [ADV-269](https://linear.app/lw-claude/issue/ADV-269/subdiario-surface-bank-row-hyperlink-on-bankmovimiento), [ADV-270](https://linear.app/lw-claude/issue/ADV-270/subdiario-soft-drop-scope-filter-trust-pagadasi-on-prior-year-fcs), [ADV-271](https://linear.app/lw-claude/issue/ADV-271/subdiario-soft-paid-intermediate-status-pago-recibido-without), [ADV-272](https://linear.app/lw-claude/issue/ADV-272/subdiario-add-movimiento-column-hyperlink-to-bank-row-with-schema)
**Branch:** feat/subdiario-soft-paid-and-soft-drop

## Context Gathered

### Codebase Analysis

- **Builder (pure):** `src/services/subdiario-builder.ts`
  - `aggregateMovimientos` at lines 155-176: matches movimientos by `matchedFileId === fileId && matchedType !== ''`.
  - `applyScopeFilter` at lines 339-399: rules (a-f); rule (e) currently uses *movimiento evidence* to drop prior-year paid FCs, missing the `pagada=SI` column entirely.
  - Row build at lines 670-690: priority is NC cancel → movimiento → unpaid. No soft-paid tier.
  - `composeNotas` at lines 416-489: already loads `pagosRecibidos` but uses it only for `tipoDeCambio` lookup on USD invoices.
- **Writer / orchestrator:** `src/services/subdiario-writer.ts`
  - `readMovimientosRows` (lines 269-324) loads movimientos but drops sheet metadata — no link back to the bank row.
  - `readSubdiarioRows` (lines 142-206) and `initializeComprobantesSheet` (lines 220-259) assume 13 cols A:M.
  - Sort-invariant fallback (lines 544-573) already does a full-rewrite path — reuse for schema migration.
- **Parsers:** `src/bank/match-movimientos.ts`
  - `parseFacturasEmitidas` (lines 282-362) does NOT parse `pagada` (whereas `parseFacturasRecibidas` does at line 398). `pagada` column T exists in Facturas Emitidas (21 cols A:U after ADV-245).
- **Types:** `src/types/index.ts`
  - `Factura` (lines 88-148): missing `pagada` field. Add as optional string.
  - `BankMovimiento` (lines 1060-1073): missing source-row metadata for hyperlinking.
  - `SubdiarioRow` (lines 1108-1141): 13 fields; new column gets added between `recibido` and `notas`.
- **Headers:** `src/constants/spreadsheet-headers.ts:548-562` — `SUBDIARIO_COMPROBANTES_HEADERS` (13 entries).
- **Existing pagada writers** (background, no change needed):
  - `src/processing/matching/nc-factura-matcher.ts:262-281` (NC cancels FC)
  - `src/processing/matching/factura-pago-matcher.ts:572-584` (pago_recibido matched)
  - `src/bank/match-movimientos.ts:1097-1108` (bank credit matched)

- **Existing patterns to follow:**
  - Pure-function builder + thin writer (`subdiario-builder.ts` + `subdiario-writer.ts`).
  - Spreadsheet hyperlinks via Sheets `HYPERLINK` formula (already used for Drive fileId links in dashboards).
  - Schema migration via header detection + full rewrite (the sort-invariant fallback path is the template).
  - `Result<T, E>` for all I/O paths.
- **Test conventions:**
  - Builder tests are pure, inline fixtures via `makeFc`/`makeNc` helpers (`subdiario-builder.test.ts:29-60`). No mocks.
  - Writer tests use `vi.mock` against `./sheets.js` and `./drive.js` (`subdiario-writer.test.ts` follows project Vitest patterns).
  - Quota-throttle reset rule (CLAUDE.md "Test hygiene note") still applies to any new top-level describe blocks that exercise quota-retry paths.

### MCP Context

- **MCPs consulted:** Linear (team `ADVA Administracion`, statuses confirmed: Todo/In Progress/Review/Merge/Done).
- **Findings:** No existing open issues for soft-paid or scope-filter rework. Creating fresh Todos.

## Tasks

### Task 1: Surface `pagada` on Facturas Emitidas

**Linear Issue:** [ADV-268](https://linear.app/lw-claude/issue/ADV-268/subdiario-surface-pagada-on-facturas-emitidas)

**Files:**
- `src/types/index.ts` (modify — add `pagada` to `Factura`)
- `src/bank/match-movimientos.ts` (modify — extend `parseFacturasEmitidas`)
- `src/bank/match-movimientos.test.ts` (modify — extend parser tests)

**Steps:**
1. Write tests in `src/bank/match-movimientos.test.ts` for `parseFacturasEmitidas` that:
   - A row with `pagada='SI'` is parsed with `factura.pagada === 'SI'`.
   - A row with `pagada=''` (or missing column) yields `factura.pagada === undefined`.
   - Whitespace and casing are preserved as-is (no trim/upper inside the parser — match `parseFacturasRecibidas` behavior).
2. Run verifier (expect fail).
3. Add optional `pagada?: string` field to `Factura` in `src/types/index.ts`.
4. Extend `parseFacturasEmitidas` in `src/bank/match-movimientos.ts`:
   - Add `pagada: headers.indexOf('pagada')` to `colIndex` (mirror line 398 of `parseFacturasRecibidas`).
   - Populate `pagada` in the returned Factura when `colIndex.pagada >= 0` (truthy raw value → `String(...)`; otherwise omit).
5. Run verifier (expect pass).

**Notes:**
- Follow the exact pattern in `parseFacturasRecibidas` (same file, lines 368-410+).
- No write path changes — three existing writers (NC matcher, bank movimientos matcher, factura-pago matcher) already populate column T.
- Foundational for Tasks 3 and 5; no behavior change yet.

---

### Task 2: Surface bank-row hyperlink on `BankMovimiento`

**Linear Issue:** [ADV-269](https://linear.app/lw-claude/issue/ADV-269/subdiario-surface-bank-row-hyperlink-on-bankmovimiento)

**Files:**
- `src/types/index.ts` (modify — add hyperlink field to `BankMovimiento`)
- `src/services/subdiario-writer.ts` (modify — `readMovimientosRows`)
- `src/services/subdiario-writer.test.ts` (modify — extend reader tests)

**Steps:**
1. Write tests in `src/services/subdiario-writer.test.ts` for `readMovimientosRows` covering:
   - Each parsed `BankMovimiento` carries a `sourceUrl` of the form `https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit#gid={sheetId}&range=A{rowNumber}` (or equivalent canonical Sheets cell URL).
   - `sourceUrl` points to the actual row in the actual sheet (verify with two fixture rows in different YYYY-MM sheets).
   - Movimientos with empty `matchedFileId` still get a `sourceUrl` (the URL is row-identity, not match-identity).
2. Run verifier (expect fail).
3. Add `sourceUrl: string` to `BankMovimiento` in `src/types/index.ts`. Update JSDoc to clarify it's the Google Sheets URL for the bank row (used by Subdiario to hyperlink).
4. Update `readMovimientosRows` in `src/services/subdiario-writer.ts`:
   - Inside the per-sheet loop, capture `sheet.sheetId` from metadata.
   - For each pushed `BankMovimiento`, set `sourceUrl` to the cell URL using `spreadsheetId`, `sheet.sheetId`, and the 1-based `rowNumber` (header is row 1 → first data row is row 2). `rowNumber = i + 2` where `i` is the index into `dataRows`.
5. Run verifier (expect pass).

**Notes:**
- Builder tests (Tasks 3, 4, 5) supply `sourceUrl` directly on fixture movimientos; no metadata fetch in builder unit tests.
- URL format: prefer `#gid={sheetId}&range=A{rowNumber}` — this opens Sheets at the specific row and matches Drive-style hyperlinks used elsewhere. If `src/services/sheets.ts` already exposes a helper for building cell URLs, reuse it rather than re-construct.

---

### Task 3: Soft-drop scope filter (trust `pagada=SI` on prior-year FCs)

**Linear Issue:** [ADV-270](https://linear.app/lw-claude/issue/ADV-270/subdiario-soft-drop-scope-filter-trust-pagadasi-on-prior-year-fcs) (depends on ADV-268)

**Files:**
- `src/services/subdiario-builder.ts` (modify — `applyScopeFilter`)
- `src/services/subdiario-builder.test.ts` (modify — add soft-drop scenarios)

**Steps:**
1. Write tests in `src/services/subdiario-builder.test.ts` covering the new scope filter rules:
   - Prior-year FC with `pagada='SI'`, no currentYear event of any kind → **dropped** (was rule e / rule d false-positive).
   - Prior-year FC with `pagada='SI'`, matched movimiento with fecha in currentYear → **kept** (rule b).
   - Prior-year FC with `pagada='SI'`, cancelling NC issued in currentYear → **kept** (NC pairing visible).
   - Prior-year FC with `pagada='SI'`, matched pago_recibido with fechaPago in currentYear → **kept** (soft-paid in currentYear is a currentYear event).
   - Prior-year FC with `pagada` unset/empty/`NO`, no matched movimiento, no NC → **kept** (rule d unchanged — still pending).
   - Prior-year FC with `pagada='SI'`, all matched movimientos in prior year → **dropped** (no currentYear event).
   - CurrentYear FC always kept regardless of `pagada` (rule a unchanged).
2. Run verifier (expect fail).
3. Refactor `applyScopeFilter` in `src/services/subdiario-builder.ts`:
   - Replace rule (e)'s "all paid in prior years" amount-tolerance check with the simpler **soft-drop** predicate: `pagada === 'SI'` AND no currentYear event.
   - "CurrentYear event" = ANY of:
     - matched movimiento with `fecha` parsed to currentYear,
     - cancelling NC with `fechaEmision` parsed to currentYear (rules (c)/(f) stay),
     - matched pago_recibido (`p.matchedFacturaFileId === factura.fileId`) with `fechaPago` parsed to currentYear.
   - Update function signature to accept `pagosRecibidos: Pago[]` (currently takes only `cancellingNCs` and `movimientos`). Thread it through from `buildSubdiarioRows`.
   - Keep rule (d) intact: if no `pagada=SI` and no resolution, still in scope.
4. Run verifier (expect pass).

**Notes:**
- Whitespace and casing on `pagada`: trim + uppercase before comparing to `'SI'`, mirroring `pagos-pendientes.ts:119-125`.
- `parseInt(fechaEmision.substring(0, 4), 10)` is the existing year-extraction idiom in this file — reuse, do not change.
- Drop the partial-payment tolerance branch (current `subdiario-builder.ts:381-394`): the new rule subsumes it — if `pagada=SI` we trust the column; if not, rule (d) keeps the row regardless of partial prior-year movimientos.

---

### Task 4: Soft-paid intermediate status (pago_recibido without movimiento)

**Linear Issue:** [ADV-271](https://linear.app/lw-claude/issue/ADV-271/subdiario-soft-paid-intermediate-status-pago-recibido-without)

**Files:**
- `src/services/subdiario-builder.ts` (modify — add `aggregatePagosRecibidos`, integrate priority, update `composeNotas`)
- `src/services/subdiario-builder.test.ts` (modify — soft-paid scenarios)

**Steps:**
1. Write tests in `src/services/subdiario-builder.test.ts`:
   - FC with matched movimiento → `fechaCobro` = mov date, `recibido` = sum of credito, notas does NOT contain `"Pendiente confirmación bancaria"`.
   - FC with matched pago_recibido only (no movimiento) → `fechaCobro` = pago `fechaPago`, `recibido` = `importeEnPesos` (USD) or `importePagado` (ARS), notas STARTS with `"Pendiente confirmación bancaria"`.
   - FC with BOTH matched movimiento AND matched pago_recibido → movimiento wins (hard paid), no "Pendiente" marker (dedupe by `factura.fileId` join).
   - FC with neither → `fechaCobro=''`, `recibido=null`, no "Pendiente" marker.
   - NC cancellation takes precedence over soft-paid (FC cancelled by NC + pago_recibido → fechaCobro shows `NC nnn`, no "Pendiente" marker).
   - Multi-pago aggregation: 2 pagos for one factura → `recibido` = sum, `fechaCobro` = latest `fechaPago`.
2. Run verifier (expect fail).
3. In `src/services/subdiario-builder.ts`:
   - Add `aggregatePagosRecibidos(fileId: string, pagos: Pago[]): { totalARS: number; latestFecha: string; count: number } | null` next to `aggregateMovimientos`. Filter by `p.matchedFacturaFileId === fileId`. For each pago, contribute `importeEnPesos` when `moneda === 'USD' && importeEnPesos`, else `importePagado`. Compute latest by `fechaPago` lexical order (YYYY-MM-DD is lex-sortable, matching the movimientos pattern).
   - In `buildSubdiarioRows` row-construction (lines 670-690), update the priority chain for FCs:
     1. NC cancellation → `fechaCobro = "NC {nro}"`, `recibido = null` (unchanged).
     2. Else movimiento aggregate non-null → `fechaCobro = movAgg.latestFecha`, `recibido = movAgg.totalCredito` (unchanged).
     3. Else pago_recibido aggregate non-null → `fechaCobro = pagoAgg.latestFecha`, `recibido = pagoAgg.totalARS` (NEW soft-paid tier).
     4. Else `fechaCobro = ''`, `recibido = null` (unchanged).
   - Pass a `softPaid: boolean` (or the `pagoAgg` itself) into `composeNotas`.
4. Update `composeNotas` in the same file:
   - When `softPaid && tipo === 'FC'`, prepend `"Pendiente confirmación bancaria"` to `parts` BEFORE the existing socio/export/retencion parts.
   - Never emit the marker when a movimiento aggregate exists (dedupe — hard paid silences soft).
5. Run verifier (expect pass).

**Notes:**
- The marker is a fixed string; define it as a top-level constant `const SOFT_PAID_NOTE = 'Pendiente confirmación bancaria';` near the formatting helpers (`subdiario-builder.ts:44-67`).
- USD soft-paid edge case: if `pago.moneda === 'USD'` but `importeEnPesos` is missing/zero, fall back to `importePagado * factura.tipoDeCambio` if both present; otherwise contribute `0` and leave the row visibly soft (no crash). One test for this fallback.
- Multi-cuota notas (lines 476-481) keys off `movimientoAgg.items.length >= 2` — leave that behavior unchanged; soft-paid does not emit a "cuotas" breakdown.

---

### Task 5: Add `movimiento` column to Subdiario schema with migration

**Linear Issue:** [ADV-272](https://linear.app/lw-claude/issue/ADV-272/subdiario-add-movimiento-column-hyperlink-to-bank-row-with-schema) (depends on ADV-269 and ADV-271)

**Files:**
- `src/constants/spreadsheet-headers.ts` (modify — extend `SUBDIARIO_COMPROBANTES_HEADERS`)
- `src/types/index.ts` (modify — add `movimiento` to `SubdiarioRow`)
- `src/services/subdiario-builder.ts` (modify — populate `movimiento` in row build; carry `sourceUrl` into `MovimientoAgg.items`)
- `src/services/subdiario-builder.test.ts` (modify — column population tests)
- `src/services/subdiario-writer.ts` (modify — reader, header init, migration trigger, diff cell emission, range A:N)
- `src/services/subdiario-writer.test.ts` (modify — schema migration and round-trip tests)
- `src/services/subdiario-diff.ts` and `subdiario-diff.test.ts` (modify — `movimiento` participates in row-equality check)
- `SPREADSHEET_FORMAT.md` (modify — document new 14-column schema)

**Steps:**
1. Write tests in `src/services/subdiario-builder.test.ts`:
   - Hard-paid FC: `movimiento` cell equals `mov.sourceUrl` of the LATEST matched movimiento.
   - Multi-cuota hard-paid: `movimiento` cell equals the LATEST cuota's `sourceUrl` (notas already enumerates the cuotas; column is single-valued).
   - Soft-paid FC: `movimiento` cell is empty string (marker lives in `notas`, not the link column — Resumen Bancario is the only valid target for this column).
   - Unpaid FC, NC-cancelled FC, NC rows, and gap placeholders: `movimiento` cell is empty string.
2. Write tests in `src/services/subdiario-writer.test.ts`:
   - **Migration path**: an existing Comprobantes sheet with the OLD 13-column header (A:M, ends in `notas`) triggers a full rewrite — header row becomes 14 cols A:N (ends in `notas` at N, with `movimiento` at M), all data rows are re-emitted.
   - **Steady-state round-trip**: writing a row and re-reading via `readSubdiarioRows` round-trips `movimiento` without producing a spurious update on next diff.
   - **Diff sanity**: changing only the `movimiento` cell on an existing row produces exactly one `updates` entry (no inserts/deletes), assuming `movimiento` is part of the equality check.
3. Run verifier (expect fail).
4. In `src/constants/spreadsheet-headers.ts:548-562`, insert `'movimiento'` between `'recibido'` and `'notas'`. Final order: `fecha, cod, tipo, nro, cliente, cuit, condicion, total, concepto, categoria, fechaCobro, recibido, movimiento, notas` (14 entries, A:N).
5. In `src/types/index.ts`, add `movimiento: string` (URL or empty string) to `SubdiarioRow` between `recibido` and `notas`. Update the JSDoc.
6. In `src/services/subdiario-builder.ts`:
   - Extend `MovimientoAgg.items` shape from `{credito, fecha}` to `{credito, fecha, sourceUrl}` (carry `sourceUrl` through from the input).
   - In the FC branch of `buildSubdiarioRows`, set `movimiento = movAgg ? movAgg.items[movAgg.items.length - 1].sourceUrl : ''`.
   - For NC rows, soft-paid, unpaid, and gap placeholders: `movimiento = ''`.
   - Add `movimiento` to the final `rows.push({...})` payload.
7. In `src/services/subdiario-writer.ts`:
   - Update range reads/writes from `A:M` to `A:N` within this file.
   - Extend `readSubdiarioRows` to parse column M as `movimiento` (raw string — accept either a hyperlink formula echo, displayed URL, or empty; coerce to string), and column N as `notas`. Adjust indices accordingly.
   - Update `initializeComprobantesSheet` `numberFormats` map: keep date format at col 0, number formats at cols 7 (total) and 11 (recibido); date at col 10 (fechaCobro). Columns 12 (movimiento) and 13 (notas) are plain text.
   - Add a **schema migration trigger** at the start of step 7's lock callback: read `A1:N1` first. If the existing header row has 13 cells (or if M1 = `'notas'` and N1 is empty), set `schemaMigration = true` and follow the same full-rewrite branch already used for `sortInvariantViolated` — emitting a full set of deletes (all existing rows) + inserts (all desired rows), preceded by a header overwrite at `A1:N1`.
   - Add a one-line `info` log when the migration triggers: `"Comprobantes schema migration: 13 → 14 cols (added movimiento)"`.
8. In `src/services/subdiario-diff.ts`: include `movimiento` in the field-equality check that decides update vs no-op. Add one diff test that flips only the `movimiento` cell on an existing row.
9. Update `SPREADSHEET_FORMAT.md` Subdiario section to document the new 14-column schema (col M = `movimiento`, col N = `notas`).
10. Cell emission must use Sheets `HYPERLINK` formula so the URL is clickable. Reuse the existing formula-cell pattern from `src/services/sheets.ts` (whatever the dashboard writers already use for Drive links). Write `movimiento` as `=HYPERLINK("url","Mov")` when non-empty, else empty string. Add a test asserting the emitted cell shape.
11. Run verifier (expect pass).

**Notes:**
- **Migration note:** Existing Subdiario de Ventas workbooks in **production** and **staging** have 13 columns (A:M). On first startup after deploy, the sync detects the old header and performs a one-shot full rewrite to upgrade to 14 columns. The rewrite is idempotent (subsequent runs no-op via the existing diff path). Log `MIGRATIONS.md` entry with the trigger condition and the rewrite path.
- Display text for the HYPERLINK formula: `"Mov"` — short, keeps column narrow; the date is already in `fechaCobro`.
- Round-trip caveat: `getValues` with `UNFORMATTED_VALUE` returns the formula's *computed* string for HYPERLINK cells. `readSubdiarioRows` must handle both the formula echo and the displayed text — easiest is to compare semantic equality on URL presence rather than exact cell content; alternative is to read with `FORMULA` render option for this column only. Document the chosen approach in the function header.
- Keep `readSubdiarioRows` tolerant of the OLD 13-col layout during the migration window only: if `A1:N1` shows old header, return an empty list (forcing the full rewrite to insert all rows). Do NOT try to parse 13-col data as 14-col data.

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review git changes for bugs.
2. Run `verifier` agent — Verify all tests pass and zero warnings.

---

## Plan Summary

**Objective:** Make the 2026 Subdiario de Ventas faithful to actual current-year activity by trusting the `pagada=SI` column for prior-year FCs (soft-drop) and surfacing pago_recibido matches as soft-paid (with `"Pendiente confirmación bancaria"` in notas) until the Resumen Bancario row arrives — which is the only authoritative payment signal and gets hyperlinked from a new `movimiento` column.

**Linear Issues:** ADV-268, ADV-269, ADV-270, ADV-271, ADV-272

**Approach:**
1. Parse `pagada` on Facturas Emitidas and bank-row hyperlinks on `BankMovimiento` (data plumbing — Tasks 1, 2).
2. Rewrite scope rule (e) as soft-drop (Task 3) and add a soft-paid tier between hard-paid and unpaid (Task 4).
3. Add a new column to the Subdiario for the bank-row hyperlink, with a one-shot schema migration on existing production/staging workbooks (Task 5).

**Scope:** 5 tasks, ~10 files touched (types, parsers, builder, writer, diff, headers, format doc), ~25 new test cases.

**Key Decisions:**
- Soft-drop, not hard-drop: prior-year FC with `pagada=SI` is dropped UNLESS a currentYear event exists (movimiento credit, cancelling NC, or matched pago_recibido), which pulls the FC back so the 2026-side event has a visible partner row.
- Soft-paid is permanent (Policy A) — no timeout, no auto-promote. The `"Pendiente confirmación bancaria"` notas marker is the visual signal; users can manually accept non-bank rails by leaving the marker in place.
- Movimiento column is single-valued (one URL per row). Multi-cuota detail stays in `notas` via the existing aggregation; column shows the latest cuota's bank-row link.
- Hyperlink in column = ONLY Resumen Bancario rows. Soft-paid leaves the column blank — column semantics stay clean: "this cell links to the authoritative bank movement".
- Schema migration is full-rewrite via the existing sort-invariant fallback path, not surgical column insertion — safer and idempotent.

**Risks:**
- `pagada=SI` set by mistake (manual edit, bad match) would permanently hide the factura from the Subdiario. Acceptable per the user's "2025 is closed" boundary; worth a quick spot-check of the Cobros Pendientes list before deploy to confirm no obvious-paid-but-actually-unpaid rows would silently disappear.
- HYPERLINK formula round-trip — Sheets returns the displayed text via `UNFORMATTED_VALUE`, not the underlying formula. `readSubdiarioRows` and the diff equality check need to tolerate this or read with `FORMULA` render option for the `movimiento` column. Mitigation in Task 5 step notes.
- Migration runs on every container boot until the schema is upgraded. Idempotency is preserved by the existing diff path (no-op after the first run), and the migration log line surfaces if it fires more than once.

---

## Iteration 1 — 2026-05-13

**Method:** single-agent (5 tasks across 2 work units, ~11 effort points, heavy file overlap on `subdiario-builder.ts` and `types/index.ts` — worker overhead would have exceeded the implementation work).

**Tasks completed:**

- **Task 1 (ADV-268):** Added `pagada?: string` to `Factura`; extended `parseFacturasEmitidas` to read column T. 4 new parser tests.
- **Task 2 (ADV-269):** Added `sourceUrl: string` to `BankMovimiento` (required); built Sheets cell URLs in `readMovimientosRows` using captured `sheet.sheetId` and 1-indexed row number. 2 new reader tests.
- **Task 3 (ADV-270):** Rewrote `applyScopeFilter` — rule (e) is now soft-drop based on `pagada='SI'` (trim+upper). Added `pagosRecibidos: Pago[]` parameter; "currentYear event" expanded to include matched `pago_recibido` with `fechaPago` in currentYear. Dropped the partial-payment tolerance branch. Updated Tests 9 + 14d to set `pagada: 'SI'`; added 8 new scope tests.
- **Task 4 (ADV-271):** Added `aggregatePagosRecibidos` next to `aggregateMovimientos`; inserted soft-paid tier into the FC priority chain (NC > movimiento > pago > unpaid). `composeNotas` prepends `"Pendiente confirmación bancaria"` when `softPaid && !movimientoAgg`. `SOFT_PAID_NOTE` constant declared. USD fallback: `importeEnPesos` → `importePagado * factura.tipoDeCambio` → 0. 7 new soft-paid tests.
- **Task 5 (ADV-272):** Added `movimiento: string` to `SubdiarioRow` (col M, between recibido and notas); extended `MovimientoAgg.items` with `sourceUrl`; builder populates `movimiento` only for hard-paid FCs (latest cuota's URL). Writer bumped to A:N range, parses col M as movimiento and col N as notas. New cell emission in `rowToCellData`: `=HYPERLINK("url","Mov")` formula or blank, with double-quote escaping. Schema migration trigger reads `A1:N1`; if <14 cells (or `M1='notas'` with empty `N1`), overwrites header to 14 cols, reads `A2:N` for old row count, emits full-rewrite diff via `sortInvariantViolated=true`. Diff equality on `movimiento` uses semantic presence (empty ↔ non-empty) to avoid perpetual updates from the HYPERLINK round-trip caveat. 7 new builder tests + 3 new diff tests + 3 new writer migration tests + 3 new sheets cell-emission tests.

**Migration:** Documented in MIGRATIONS.md and SPREADSHEET_FORMAT.md. One-shot full rewrite to 14 cols on first deploy; idempotent on subsequent runs.

**Bugs found and fixed (bug-hunter pass 1):**
- CRITICAL: `makeTestRow` in `sheets.test.ts` was missing `movimiento: ''` — broke `npm run build`. Fixed.
- MEDIUM: Migration row counting via `A2:A` would miss rows with manually cleared fecha. Switched to `A2:N`. Fixed.
- MEDIUM: No coverage for HYPERLINK formula emission/escaping. Added 3 tests. Fixed.
- MEDIUM: No coverage for header-read failure propagation. Added test. Fixed.
- LOW: Pre-existing stale doc (Facturas Emitidas: 20→21 cols A:U). Fixed.

Bug-hunter pass 2: clean (0 bugs).

**Verifier (full mode):** all tests pass (74 files, 2473 tests), zero warnings, build passes.

**Linear:** ADV-268, ADV-269, ADV-270, ADV-271, ADV-272 all moved Todo → In Progress → Review.

## Status: COMPLETE
