# Implementation Plan

**Status:** IN_PROGRESS
**Created:** 2026-06-16
**Source:** Inline request: Generate the full, up-to-date Subdiario de Ventas as part of the Entrega, matching the accountants' template (`Subdiario de Ventas 2026`, id `12QCAReVk4vjOsZ1pWX6-h3x-wEsqbcYrTZ4qlz-w_No`) in data **and** design/format.
**Linear Issues:** [ADV-379](https://linear.app/lw-claude/issue/ADV-379), [ADV-380](https://linear.app/lw-claude/issue/ADV-380), [ADV-381](https://linear.app/lw-claude/issue/ADV-381), [ADV-382](https://linear.app/lw-claude/issue/ADV-382), [ADV-383](https://linear.app/lw-claude/issue/ADV-383), [ADV-384](https://linear.app/lw-claude/issue/ADV-384)
**Branch:** feat/subdiario-entrega-deliverable

## Context Gathered

### Codebase Analysis
- **Subdiario engine:** `src/services/subdiario-builder.ts` (`buildSubdiarioRows`, pure) produces a flat `SubdiarioRow[]` (incl. FALTA gap rows, notas with "Socio N - …" prefix, condicion = `factura.condicionIVAReceptor || facturadorEntry.condIVA`, categoria = facturador membresia). `src/services/subdiario-writer.ts` (`syncSubdiario`) gathers source data + diff-applies it to the flat root workbook "Subdiario de Ventas" via `POST /api/rebuild-subdiario`.
- **Extraction path:** `src/processing/extractor.ts` (~363-382) assembles the `Factura` from `parseFacturaResponse` output; `src/gemini/prompts.ts` (FACTURA_PROMPT), `src/gemini/parser.ts` (`VALID_CONDICION_IVA`, condicion block 583-602), `src/processing/storage/factura-store.ts:45` (writes col H).
- **Delivery:** `src/services/delivery-package.ts` + `src/routes/delivery.ts` (`/api/delivery/plan|copy-pdfs|build-movimientos`, `DELIVERY_LOCK_ID`, IDOR guard via `isDescendantOf`); `apps-script/src/main.ts` (Entrega menu flow).
- **Facturador:** `src/services/facturador-reader.ts` (`readFacturador`, `normalizeNroComprobante`); months via `SPANISH_MONTHS` in `src/utils/spanish-date.ts`.
- **Sheets primitives:** `src/services/sheets.ts` — `appendRowsWithLinks` (per-sheet lock, ADV-242), `formatSheet` (frozen + bold header + number formats only), `CellValueOrLink`, `ConditionalFormatRule`.
- **Existing patterns:** pure-function tests (`subdiario-builder.test.ts`), writer tests (`subdiario-writer.test.ts`), route tests (`delivery.test.ts`), extractor tests (`extractor.test.ts`).
- **Test conventions:** Vitest, colocated `*.test.ts`, fake CUITs `20123456786` / fictional names per CLAUDE.md.

### MCP Context
- **MCPs used:** Google Drive (Drive/Sheets reads + template PDF export), Gemini (live prompt test), Railway (env vars + deploy status), Linear (issues).
- **Findings:**
  - **condicion bug confirmed:** Gemini (gemini-2.5-flash) returns `condicionIVAReceptor` correctly for ADVA's Factura C, but `extractor.ts` drops it → **0 of 371** facturas have col H. Root-caused to the extractor object literal.
  - **categoria:** `FACTURADOR_SPREADSHEET_ID` was unset in production → already **set** to `1WUEB-8B79-Ma6-yZ5FNS1Nj2cTi7p2P9lUNGMc8R2lU` ("ADVA - Facturador de Socios", `2026` tab has Membresia + Cond IVA keyed by comprobante).
  - **Template format:** 13 cols (no `movimiento`; notas at M); sections `PERIODO {YEAR}` (carryover) + `PERIODO {MES} {YEAR}` (current, per month, label in `cliente` col); bold per-section subtotal of `total`; blank separators; no grand total; cream background = FC cancelled by NC; red = NC + FALTA rows; blue hyperlink on `nro`; `#,##0.00` on total/recibido. ~165 rows, current through May 2026 (deliverable must include the latest month).

## Tasks

### Task 1: Fix extractor dropping `condicionIVAReceptor`
**Linear Issue:** [ADV-379](https://linear.app/lw-claude/issue/ADV-379)
**Files:**
- `src/processing/extractor.ts` (modify)
- `src/processing/extractor.test.ts` (modify)

**Steps:**
1. Write test in `extractor.test.ts`: a `factura_emitida` whose parsed data has `condicionIVAReceptor="Responsable Monotributo"` → `extractDocument` result `Factura.condicionIVAReceptor === "Responsable Monotributo"`; a Factura E case → `"Exterior"`; a `factura_recibida` does NOT carry the field.
2. Run verifier (expect fail).
3. Add `condicionIVAReceptor: parseResult.value.data.condicionIVAReceptor,` to the `Factura` object literal at `extractor.ts` ~363-382 (follow the existing field-copy pattern).
4. Run verifier (expect pass).

**Notes:**
- Single-field addition; type already has it (`types/index.ts:117`), store already writes col H. Fixes all NEW facturas; existing rows → Task 2.

### Task 2: Backfill `condicionIVAReceptor` on existing facturas (hybrid)
**Linear Issue:** [ADV-380](https://linear.app/lw-claude/issue/ADV-380)
**Files:**
- `src/services/condicion-backfill.ts` (create) + `src/services/condicion-backfill.test.ts` (create)
- route file (create/modify) + test, if endpoint mechanism chosen
- Reuse: `facturador-reader.ts`, the factura extractor, in-place update by fileId (`factura-store.ts` `findRowByFileId` + `updateRowsWithFormatting`).

**Steps:**
1. Write test for the pure sourcing decision: socio comprobante → Facturador `Cond IVA`; non-socio → "needs parse"; only blank-H rows processed (idempotency).
2. Run verifier (expect fail).
3. Implement hybrid backfill: blank-H rows → Facturador `Cond IVA` when comprobante matches a socio, else re-extract from the PDF via the existing factura path; write col H in place by fileId; idempotent. Expose as an auth-guarded one-shot endpoint `POST /api/admin/backfill-condicion-iva` (`?limit` batch) or standalone script; return `{scanned, filledFromFacturador, filledFromParse, skipped, failed}`.
4. Run verifier (expect pass).

**Notes:**
- Gemini calls reuse existing timeout + JSON-parse/transient retry; Sheets writes update-in-place (no duplicate appends), per-sheet lock; endpoint: auth + error sanitization (respond500/503).
- **Migration note:** one-time correction of production data (Control de Ingresos → Facturas Emitidas, col H). No schema change (col H exists). Run once after Task 1 deploys. Socios already resolve via the builder's render-time Facturador fallback; this task mainly fixes non-socios and the Control sheet's durability.

### Task 3: Deliverable render model — period sections, subtotals, 13-col projection (pure)
**Linear Issue:** [ADV-381](https://linear.app/lw-claude/issue/ADV-381)
**Files:**
- `src/services/subdiario-deliverable.ts` (create) + `src/services/subdiario-deliverable.test.ts` (create)
- Follow the pure-function pattern of `src/services/subdiario-builder.ts`.

**Steps:**
1. Write tests: prior-year block per year + monthly current-year blocks; labels (`PERIODO {YEAR}`; `PERIODO {MES uppercase} {YEAR}`); signed subtotal sums (NC negative); ordering (chronological blocks, builder order within); style flags `isNC` / `isFalta` / `isCancelledByNC`; 13-col projection (drop `movimiento`); blank separators; empty input → empty.
2. Run verifier (expect fail).
3. Implement the pure transform `SubdiarioRow[] + currentYear → RenderRow[]` (tagged `'blank'|'header'|'data'|'subtotal'`), grouping/sections/subtotals/blank-rows/flags as specified; reuse `SPANISH_MONTHS` (uppercased).
4. Run verifier (expect pass).

**Notes:**
- notas kept verbatim (Socio prefix + export/retención/cuotas — NOT suppressed). FALTA rows kept (painted red by Task 4).

### Task 4: Deliverable formatted writer — sheet creation + styling
**Linear Issue:** [ADV-382](https://linear.app/lw-claude/issue/ADV-382)
**Files:**
- `src/services/subdiario-deliverable-writer.ts` (create) + `src/services/subdiario-deliverable-writer.test.ts` (create)
- Reuse `sheets.ts` (`appendRowsWithLinks`, `formatSheet`); **add** a batchUpdate helper for per-row `backgroundColor` + text `foregroundColor` (repeatCell `userEnteredFormat`).

**Steps:**
1. Write tests (mock sheets API): cell projection per render-row type; formatting requests built correctly — cream background on `isCancelledByNC` rows, red text on `isNC || isFalta` rows, bold on header/subtotal rows, hyperlink on `nro`. Follow `subdiario-writer.test.ts`.
2. Run verifier (expect fail).
3. Implement the writer: create/replace `Subdiario de Ventas {YEAR}` in the caller-provided folder; bold frozen 13-col header; write render rows; apply styling + `#,##0.00` / date number formats; `nro` blue hyperlink via `CellValueOrLink` (uses `facturaFileId`). Lift exact hex colors + column widths from the template by reading its cell formats via the Sheets API.
4. Run verifier (expect pass).

**Notes:**
- Writes via `appendRowsWithLinks` (per-sheet lock) + `withQuotaRetry`. Idempotent: delete any existing same-named sheet before write.

### Task 5: Entrega integration — `POST /api/delivery/build-subdiario`
**Linear Issue:** [ADV-383](https://linear.app/lw-claude/issue/ADV-383)
**Files:**
- `src/routes/delivery.ts` (modify) + `src/routes/delivery.test.ts` (modify)
- `src/services/delivery-package.ts` (add orchestration helper) + test
- `CLAUDE.md` (modify — API ENDPOINTS table + FACTURADOR note)

**Steps:**
1. Write tests: IDOR rejection for a folder outside `Entregas/`; happy path creates one `Subdiario de Ventas {YEAR}` file; idempotent re-run replaces it; lock contention → 503. Follow `delivery.test.ts`.
2. Run verifier (expect fail).
3. Implement endpoint `POST /api/delivery/build-subdiario` (`{ folderId }`, `onRequest: authMiddleware`): IDOR guard via `findByName` + `isDescendantOf` (like build-movimientos); acquire `DELIVERY_LOCK_ID`; gather full-current-year source data (`businessYear()`) reusing `syncSubdiario`'s data-gathering (extract a shared helper); `buildSubdiarioRows` → Task 3 model → Task 4 writer into the folder; delete-before-create idempotency; sanitize errors (respond500/503, raw via Pino). Update `CLAUDE.md`.
4. Run verifier (expect pass).

**Notes:**
- Concurrency via `DELIVERY_LOCK` (reads source, writes only into `Entregas/`); Google API timeout/rate-limit via `withQuotaRetry`.

### Task 6: Apps Script — add Subdiario to the Entrega flow
**Linear Issue:** [ADV-384](https://linear.app/lw-claude/issue/ADV-384)
**Files:**
- `apps-script/src/main.ts` (modify) + test if present

**Steps:**
1. If the apps-script flow has tests, add a case asserting `build-subdiario` is called in the delivery sequence; otherwise rely on verifier (bundle compiles) + bug-hunter.
2. Run verifier (expect fail/pass as applicable).
3. Implement: after the build-movimientos step, call `POST /api/delivery/build-subdiario` with the same `folderId`, with a `progressToast` + summary line + failure surfacing in the final alert. Follow the existing delivery-flow helpers (`getApiUrl`, `postToDelivery`, `progressToast`).
4. Run verifier (expect pass).

**Notes:**
- Bundle auto-pushes to the Apps Script project on server boot (no manual deploy).

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs.
2. Run `verifier` agent — Verify all tests pass and zero warnings.

---

## Plan Summary

**Objective:** Generate the full, up-to-date Subdiario de Ventas as part of every Entrega, matching the accountants' template in data and design.
**Linear Issues:** ADV-379, ADV-380, ADV-381, ADV-382, ADV-383, ADV-384
**Approach:** Fix the extractor bug that blanks `condicion` and backfill existing rows (hybrid Facturador → re-parse); add a pure period-sectioned render model + a formatted writer that match the template (cream = NC-cancelled, red = NC/FALTA, blue `nro` hyperlinks, per-section subtotals); expose it via `POST /api/delivery/build-subdiario` writing into `Entregas/{period}/` and wire it into the Apps Script Entrega flow.
**Scope:** 6 tasks, ~13 files, 6 new/updated test suites.
**Key Decisions:** Deliverable is a separate `Subdiario de Ventas {YEAR}` per Entrega (formatted); the internal root `Subdiario de Ventas` stays flat. `FALTA` gap rows are kept and painted red (missing-factura signal). notas keep the Socio prefix. `categoria`/socio-`condicion` come from the now-configured Facturador.
**Risks:** Backfill re-extracts non-socio PDFs via Gemini (cost/time — batch it); exact template hex colors must be lifted programmatically for design fidelity; `formatSheet` needs extending for per-row background/text colors.

---

## Iteration 1

**Implemented:** 2026-06-16
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Fix extractor dropping `condicionIVAReceptor` — one-line field copy in the Factura object literal + 3 tests (factura_emitida → "Responsable Monotributo", Factura E → "Exterior", factura_recibida → undefined) (worker-1, ADV-379)
- Task 2: Hybrid `condicionIVAReceptor` backfill — `condicion-backfill.ts` (pure `decideSourcing` + `backfillCondicionIva` orchestrator) + `POST /api/admin/backfill-condicion-iva` (auth, `?limit`, idempotent, in-place by fileId; socios→Facturador, non-socios→re-extract); returns `{scanned, filledFromFacturador, filledFromParse, skipped, failed}` (worker-1, ADV-380)
- Task 3: Pure deliverable render model `buildSubdiarioDeliverable(rows, currentYear) → DeliverableRenderRow[]` — period sections (`PERIODO {YEAR}` carryover + `PERIODO {MES} {YEAR}` monthly), signed subtotals, 13-col projection, style flags (worker-2, ADV-381)
- Task 4: Formatted writer `writeSubdiarioDeliverable` — creates/replaces `Subdiario de Ventas {YEAR}`, cream/red styling, blue `nro` hyperlinks; added exported `applyRowStyles` + `RowStyleSpec` helper to `sheets.ts` (worker-2, ADV-382)
- Task 5: `POST /api/delivery/build-subdiario` — IDOR guard, `DELIVERY_LOCK`, extracted shared `gatherSubdiarioInput` from `syncSubdiario`, `buildSubdiarioDeliverableFile` orchestrator (worker-3, ADV-383)
- Task 6: Apps Script Entrega wiring — `build-subdiario` step after `build-movimientos` in `triggerEnvioContadores` with progress toast + summary line (worker-3, ADV-384)

### Files Modified
- `src/processing/extractor.ts` / `.test.ts` — propagate `condicionIVAReceptor`
- `src/services/condicion-backfill.ts` / `.test.ts` — new hybrid backfill
- `src/routes/backfill.ts`, `src/server.ts` — new admin endpoint + registration
- `src/services/subdiario-deliverable.ts` / `.test.ts` — new render model
- `src/services/subdiario-deliverable-writer.ts` / `.test.ts` — new formatted writer
- `src/services/sheets.ts` — new `applyRowStyles` + `RowStyleSpec`
- `src/routes/delivery.ts` / `.test.ts` — new `build-subdiario` endpoint
- `src/services/delivery-package.ts` / `.test.ts` — `buildSubdiarioDeliverableFile`
- `src/services/subdiario-writer.ts` / `.test.ts` — extracted `gatherSubdiarioInput`
- `apps-script/src/main.ts` — Entrega flow build-subdiario step
- `CLAUDE.md` — API ENDPOINTS table

### Linear Updates
- ADV-379: Todo → In Progress → Review
- ADV-380: Todo → In Progress → Review
- ADV-381: Todo → In Progress → Review
- ADV-382: Todo → In Progress → Review
- ADV-383: Todo → In Progress → Review
- ADV-384: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs, all fixed before proceeding:
  1. [HIGH] `writeSubdiarioDeliverable` idempotency broke when the target sheet was the workbook's only sheet (delete-the-only-sheet → API error on every re-run). Fixed: create a temp sheet first (name keyed on the old sheetId) → delete old → rename, so the workbook never reaches zero sheets. Added a single-sheet regression test.
  2. [MEDIUM] Double ERROR log on the `syncSubdiario` read-failure path (both `gatherSubdiarioInput` and `syncSubdiario` logged). Fixed: `gatherSubdiarioInput` is the sole owner of read-failure logging (now takes an optional `correlationId`); `syncSubdiario` no longer re-logs.
  3. [MEDIUM] Apps Script "N comprobantes" counted structural render rows (header/subtotal/blank), not invoices. Fixed: added `dataRowsWritten` (count of `type==='data'`) to `WriteDeliverableResult`, threaded through the route, and used it in the summary.
- verifier (full): 3026 tests pass, zero lint warnings, clean `tsc` build + Apps Script bundle (10.4kb, no warnings)

### Work Partition
- Worker 1: Tasks 1–2 (condición domain — extractor fix + backfill)
- Worker 2: Tasks 3–4 (deliverable domain — pure render model + formatted writer)
- Worker 3: Tasks 5–6 (integration domain — endpoint + Apps Script wiring)

### Merge Summary
- Worker 2 merged first (foundation: services worker-3 imports) — no conflicts
- Worker 1 merged — no conflicts (disjoint files); typecheck clean
- Worker 3 merged — no conflicts (disjoint files); the 2 expected "module not found" errors against worker-2's modules resolved once worker-2 was present; typecheck clean
- No file overlapped across workers, so all three merges were conflict-free

### Known Degradation (for review / fine-tuning)
- Subagents have no MCP access, so the writer could not lift the template's exact hex colors. The palette is approximated with named constants in `subdiario-deliverable-writer.ts`: `CREAM_BG` ~#FFF2CC, `RED_FG` #FF0000, link blue (Sheets default). Visual fidelity vs. the template (`12QCAReVk4vjOsZ1pWX6-h3x-wEsqbcYrTZ4qlz-w_No`) should be spot-checked against a real render and the constants tuned if needed.

### Continuation Status
All tasks completed.

---

## Plan Adjustment (2026-06-16)

**ADV-380 — backfill is a one-time data-op, not shipped code.** The Iteration 1
implementation over-built the backfill as a permanent endpoint + service + test
suite. Per user direction, that code was removed (no value in keeping run-once
logic in the codebase forever):
- Deleted `src/routes/backfill.ts`, `src/services/condicion-backfill.ts`,
  `src/services/condicion-backfill.test.ts`, and the `backfillRoutes`
  import/registration in `src/server.ts`.
- The ADV-379 extractor fix **stays** — that is the durable fix that prevents the
  bug going forward (the deploy is only for new facturas; no deploy is needed for
  the data correction itself).
- The actual production correction of the blank `condicionIVAReceptor` (col H) in
  Control de Ingresos → Facturas Emitidas is performed **once** as a manual data
  operation via the `data-ops` skill (the only context where the gated
  `gsheets_update` write tool is pre-approved). Sourcing: socios → Facturador
  `Cond IVA`; non-socios → re-extract from the PDF.

Post-removal verification: 3012 tests pass, zero lint warnings, clean build.

**ADV-383 — Subdiario endpoint kept as-is.** Confirmed: the Entrega flow is a
chain of server endpoints invoked by the Apps Script menu (`plan` → `copy-pdfs`
→ `build-movimientos` → `build-subdiario`). `build-subdiario` is the integrated
4th step (wired in ADV-384), not a separate user operation. No change.
