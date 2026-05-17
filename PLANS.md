# Implementation Plan

**Created:** 2026-05-17
**Source:** Inline request: (A) Factura E hardcode `condicion='Exterior'`. (B) Subdiario one-hop pago→factura traversal so bank-confirmed cuotas count as hard-paid. (C) Replace HYPERLINK formulas with project-standard formatted-text links and switch the `movimiento` column label to a descriptive form (`{bankFolder} {YYYY-MM} #{row}`). (E) Add a clickable link to the factura PDF on the `nro` column.
**Linear Issues:** [ADV-277](https://linear.app/lw-claude/issue/ADV-277), [ADV-278](https://linear.app/lw-claude/issue/ADV-278), [ADV-279](https://linear.app/lw-claude/issue/ADV-279), [ADV-280](https://linear.app/lw-claude/issue/ADV-280), [ADV-281](https://linear.app/lw-claude/issue/ADV-281), [ADV-282](https://linear.app/lw-claude/issue/ADV-282)
**Branch:** feat/subdiario-clarity-iter-3

## Context Gathered

### Codebase Analysis

- **Parser:** `src/gemini/parser.ts:380-590` — `parseFacturaResponse` wraps Gemini extraction. `RawFacturaExtraction.tipoComprobante` is a string; `condicionIVAReceptor` is post-processed at lines 500-505 (set), 585 (canonical-list validation). `VALID_CONDICION_IVA` literal at line 401 lists 5 canonical values.
- **Subdiario builder:** `src/services/subdiario-builder.ts` — `aggregateMovimientos(fileId, movimientos)` at line 162 is the choke point for hard-paid detection. `aggregatePagosRecibidos(factura, pagosRecibidos)` at line 206 is the choke point for soft-paid detection. The priority chain at lines 745-761 picks `movAgg` > `pagoAgg` > unpaid. `SubdiarioRow.movimiento` is currently `string` (URL or empty).
- **Subdiario writer:** `src/services/sheets.ts:1341` — `rowToCellData` emits raw `Schema$CellData[]`, NOT going through `convertToSheetsCellData`. Col M (movimiento) at lines 1383-1393 emits `=HYPERLINK(url,"Mov")` formula. Col E (cliente) at line 1355 is plain `stringValue`. Col D (nro) at line 1353 is plain `stringValue`.
- **Bank movimientos read:** `src/services/subdiario-writer.ts:275-335` — `readMovimientosRows(movimientosSpreadsheets)` iterates a `Map<key, spreadsheetId>` where `key = "{year}:{bankFolderName}"`. Currently builds `sourceUrl` as `…/edit#gid=<sheetId>&range=A<rowNumber>`. The bank-folder name is in the cache key but NOT propagated to `BankMovimiento`.
- **Existing diff hack:** `src/services/subdiario-diff.ts:32-50` documents and implements the SEMANTIC PRESENCE check for `movimiento` to dodge HYPERLINK formula round-trip. This hack becomes unnecessary once we switch to text-format links (label round-trips exactly).
- **Project-standard link pattern:** `src/services/sheets.ts:918-1029` — `isCellLink` helper + `convertToSheetsCellData` emits `{ stringValue: link.text, textFormatRuns: [{ format: { link: { uri: link.url } } }] }`. Every other sheet in the project uses this via `appendRowsWithLinks` (`sheets.ts:1139`).
- **Test conventions:** Colocated `*.test.ts` files. `parser.test.ts`, `subdiario-builder.test.ts`, `subdiario-writer.test.ts`, `subdiario-diff.test.ts`, `sheets.test.ts` all exist and follow Vitest pattern.

### MCP Context

- **gdrive MCP:** Audited the freshly-generated staging Subdiario (`1fs9oeioYz1ZIk9Ye0x6aeeSB9PdSx1--FQ9LoNaNh1g`) — 145 rows, 6 hard-paid, 64 soft-paid. Cross-checked 12 Movimientos workbooks: ~145 active credit rows across the 4 eligible banks; vast majority are matched via `pago_recibido` indirection (matchedFileId = pago.fileId, not factura.fileId). This is the structural reason for the 6/145 ratio and motivates Task 3.
- **Linear MCP:** ADV-268..ADV-272 (current schema) and ADV-273..ADV-276 (last review iteration) are all Released. No active in-progress Subdiario work.
- **Railway MCP:** staging is live at commit `a438d70`, `FACTURADOR_SPREADSHEET_ID` set, deployment SUCCESS, Subdiario sync confirmed in logs.

## Tasks

### Task 1: Factura E — hardcode `condicion='Exterior'`

**Linear Issue:** [ADV-277](https://linear.app/lw-claude/issue/ADV-277)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests in `src/gemini/parser.test.ts` for `parseFacturaResponse`:
   - **Factura E with empty `condicionIVAReceptor`** in Gemini response → result has `condicionIVAReceptor === 'Exterior'` and `needsReview === false`.
   - **Factura E with extracted `Cliente del Exterior`** in Gemini response → result has `condicionIVAReceptor === 'Exterior'` (override wins, no review flag).
   - **Factura E with garbage `condicionIVAReceptor`** (e.g., `'foobar'`) → result has `condicionIVAReceptor === 'Exterior'` (override silences the canonical-list mismatch).
   - **Non-E factura (A/B/C)** with `condicionIVAReceptor='IVA Responsable Inscripto'` → unchanged (regression guard).
2. Run `verifier "parser"` (expect 4 new tests to fail).
3. Implement in `src/gemini/parser.ts`:
   - Add `'Exterior'` to `VALID_CONDICION_IVA` (keep `'Cliente del Exterior'` for backward compatibility with historical extractions in existing rows).
   - In `parseFacturaResponse` after the existing condicion-extraction block (around line 500-505), insert: `if (rawData.tipoComprobante === 'E') data.condicionIVAReceptor = 'Exterior';`.
   - The override must run BEFORE the canonical-list `needsReview` flag (line ~585) so Factura E never triggers that review.
4. Run `verifier "parser"` (expect pass).

**Notes:**
- **Migration note:** Existing Facturas Emitidas rows for Factura E may have `'Cliente del Exterior'` or empty in column H. The Subdiario reads `condicion` directly from that field, so old rows continue to display their old value until a rescan. Backfill is **deferred** — the user can re-process Factura E PDFs via the scanner, or run a one-shot Sheets `update` if they want immediate consistency. No code change in this plan addresses backfill.

### Task 2: Add `BankMovimiento.label` for descriptive link text

**Linear Issue:** [ADV-278](https://linear.app/lw-claude/issue/ADV-278)
**Files:**
- `src/types/index.ts` (modify — add `label: string` to `BankMovimiento`)
- `src/services/subdiario-writer.ts` (modify — `readMovimientosRows`)
- `src/services/subdiario-writer.test.ts` (modify)

**Steps:**
1. Write tests in `src/services/subdiario-writer.test.ts` for `readMovimientosRows`:
   - Given a `Map` with key `"2026:BBVA 007-009364/1 ARS"` and a mock sheet `2026-03` row 42 → returned `BankMovimiento.label === 'BBVA 007-009364/1 ARS 2026-03 #42'`.
   - Given key `"2025:Banco Ciudad 0003043/0 ARS"` and sheet `2025-12` row 7 → label `'Banco Ciudad 0003043/0 ARS 2025-12 #7'`.
   - `label` is always populated (never empty string) for every returned movimiento.
2. Run `verifier "subdiario-writer"` (expect new tests to fail).
3. Implement:
   - `src/types/index.ts`: add `label: string;` to the `BankMovimiento` interface alongside `sourceUrl`. Update JSDoc to clarify it's the descriptive cell text used by the Subdiario `movimiento` column (e.g., `'BBVA 007-009364/1 ARS 2026-03 #42'`).
   - `src/services/subdiario-writer.ts:readMovimientosRows`: extract `bankFolderName` from each map entry's key. Use `key.indexOf(':')` + `slice` to split on the FIRST colon only, preserving folder names that contain `:`. Build `label = `${bankFolderName} ${sheet.title} #${rowNumber}``. Set it on every emitted `BankMovimiento`.
4. Run `verifier "subdiario-writer"` (expect pass).

**Notes:**
- No schema migration. `BankMovimiento` is an in-memory type, not persisted.

### Task 3: Subdiario — one-hop pago→factura traversal in `aggregateMovimientos`

**Linear Issue:** [ADV-279](https://linear.app/lw-claude/issue/ADV-279)
**Files:**
- `src/services/subdiario-builder.ts` (modify — `aggregateMovimientos` signature + body, and call site at line 735)
- `src/services/subdiario-builder.test.ts` (modify)

**Steps:**
1. Write tests in `src/services/subdiario-builder.test.ts` for the FC priority chain (search for the existing `aggregateMovimientos` / soft-paid tests as templates):
   - **One-hop match:** factura F (fileId=`fac1`), pago P (fileId=`pago1`, `matchedFacturaFileId=fac1`), movimiento M (`matchedFileId=pago1`, `matchedType='AUTO'`, `credito=10000`, fecha 2026-03-15). Expected: factura F goes to hard-paid branch; `movimientoAgg.totalCredito === 10000`; `fechaCobro === '2026-03-15'`; `softPaid === false`; `movimientoLabel` populated from M (Task 5 will assert this; for Task 3 just assert the URL/source).
   - **Direct match still works** (regression guard): factura F (fileId=`fac1`), movimiento M (`matchedFileId=fac1`, `matchedType='AUTO'`) → hard-paid, same as today.
   - **Pago with no matched factura is ignored:** pago P with `matchedFacturaFileId=''`, movimiento matched to P. Factura F has no link → unpaid branch.
   - **Direct + one-hop both present, same movimiento:** dedupe. Movimiento M matched to P, P matched to F, AND a second movimiento M2 matched directly to F. `totalCredito === M.credito + M2.credito` (each counted once, not three times).
   - **Soft-paid only fires when no movimiento reachable:** factura F with pago P, P `matchedFacturaFileId=fac1`, NO movimiento points at P or F. → soft-paid branch (existing behavior preserved).
2. Run `verifier "subdiario-builder"` (expect new tests to fail).
3. Implement in `src/services/subdiario-builder.ts`:
   - Extend `aggregateMovimientos` signature to `aggregateMovimientos(fileId: string, movimientos: BankMovimiento[], pagosRecibidos: Pago[]): MovimientoAgg | null`.
   - Build `pagoToFactura: Set<string>` = set of pago fileIds where `pago.matchedFacturaFileId === fileId` AND `pago.fileId` non-empty.
   - Filter movimientos where `m.matchedType !== '' && m.credito > 0` AND (`m.matchedFileId === fileId` OR `pagoToFactura.has(m.matchedFileId)`).
   - Dedupe by movimiento identity (use `m.sourceUrl` as the unique key, since `sourceUrl` encodes spreadsheetId + sheetId + row).
   - The rest of `MovimientoAgg` construction is unchanged.
   - Update the call site at line ~735 to pass `pagosRecibidos`.
4. Run `verifier "subdiario-builder"` (expect pass).

**Notes:**
- **Behavioral impact:** soft-paid count will drop significantly in the next Subdiario rebuild — most current "Pendiente confirmación bancaria" rows will reclassify as hard-paid (the bank confirmation existed but wasn't being followed). This is the intended fix.
- **No schema migration.** The output rows just shift between branches; existing Subdiario rows get a regular UPDATE through the diff path.

### Task 4: Add `SubdiarioRow.facturaFileId` (data plumbing for Task 6 nro link)

**Linear Issue:** [ADV-280](https://linear.app/lw-claude/issue/ADV-280)
**Files:**
- `src/types/index.ts` (modify — add `facturaFileId: string` to `SubdiarioRow`)
- `src/services/subdiario-builder.ts` (modify — populate from factura, empty for FALTA)
- `src/services/subdiario-writer.ts` (modify — `readSubdiarioRows` sets `facturaFileId: ''`)
- `src/services/subdiario-diff.ts` (modify — exclude `facturaFileId` from equality comparison, since it's unknowable from a sheet read)
- `src/services/subdiario-builder.test.ts` (modify)
- `src/services/subdiario-writer.test.ts` (modify)
- `src/services/subdiario-diff.test.ts` (modify)

**Steps:**
1. Write tests:
   - **Builder:** FC row → `facturaFileId === factura.fileId`. NC row → `facturaFileId === ncFactura.fileId`. FALTA placeholder row → `facturaFileId === ''`.
   - **Reader (`readSubdiarioRows`):** every returned row has `facturaFileId === ''` (read path cannot recover the fileId from cell content).
   - **Diff equality:** two rows with all fields equal except `facturaFileId` (e.g., existing=`''`, desired=`'fac1'`) are considered EQUAL — no update emitted. (Rationale: existing-side is always empty after a read; comparing would force perpetual updates.)
2. Run `verifier "subdiario"` (expect fails).
3. Implement:
   - Add `facturaFileId: string;` to `SubdiarioRow` (and inherited `SubdiarioRowWithIndex`) in `src/types/index.ts`.
   - In `subdiario-builder.ts`, populate `facturaFileId: factura.fileId` for FC and NC rows; `facturaFileId: ''` for FALTA placeholders.
   - In `subdiario-writer.ts:readSubdiarioRows`, set `facturaFileId: ''` on every returned row.
   - In `subdiario-diff.ts`, when comparing rows, skip `facturaFileId` from the equality check (or treat the existing-side `''` as a wildcard match).
4. Run `verifier "subdiario"` (expect pass).

**Notes:**
- Field is consumed by Task 6 to render the col D hyperlink. Standalone field addition has no visible effect yet.

### Task 5: Add `SubdiarioRow.movimientoLabel` (replaces semantic-presence diff hack)

**Linear Issue:** [ADV-281](https://linear.app/lw-claude/issue/ADV-281)
**Depends on:** Task 2 (BankMovimiento.label)
**Files:**
- `src/types/index.ts` (modify — add `movimientoLabel: string` to `SubdiarioRow`)
- `src/services/subdiario-builder.ts` (modify — populate from `movAgg.items[last].label`; empty when no movimiento)
- `src/services/subdiario-writer.ts` (modify — `readSubdiarioRows` reads col M displayed text into `movimientoLabel`, leaves `movimiento` URL empty)
- `src/services/subdiario-diff.ts` (modify — replace the SEMANTIC PRESENCE hack on `movimiento` with exact equality on `movimientoLabel`; remove `movimiento` URL from equality entirely)
- `src/services/subdiario-builder.test.ts` (modify)
- `src/services/subdiario-writer.test.ts` (modify)
- `src/services/subdiario-diff.test.ts` (modify)

**Steps:**
1. Write tests:
   - **Builder:** FC with one matched movimiento (label `'BBVA ARS 2026-03 #42'`) → `movimientoLabel === 'BBVA ARS 2026-03 #42'`, `movimiento === <URL>`. FC with no movimiento → both empty strings.
   - **Reader:** sheet row with col M displayed text `'BBVA ARS 2026-03 #42'` → `movimientoLabel === 'BBVA ARS 2026-03 #42'`, `movimiento === ''`.
   - **Diff:** two rows with same `movimientoLabel` but different `movimiento` URLs → EQUAL (URL not compared). Two rows with different `movimientoLabel` → NOT EQUAL (update emitted).
   - **Regression:** delete or update existing tests that asserted the old SEMANTIC PRESENCE behavior; replace with exact-label expectations.
2. Run `verifier "subdiario"` (expect fails).
3. Implement:
   - Add `movimientoLabel: string;` to `SubdiarioRow` in `src/types/index.ts`, sibling of `movimiento`.
   - In `subdiario-builder.ts`, populate `movimientoLabel = movAgg ? movAgg.items[movAgg.items.length - 1]!.label : ''`. Update the existing `movimiento` URL assignment to remain in sync.
   - In `subdiario-writer.ts:readSubdiarioRows`, read col M displayed text into `movimientoLabel`, set `movimiento: ''`.
   - In `subdiario-diff.ts`, replace the `// movimiento — semantic presence` block (lines 48-50 area) with an exact equality check on `movimientoLabel`. Remove `movimiento` URL from the diff key entirely. Update the header JSDoc that documents the old hack.
4. Run `verifier "subdiario"` (expect pass).

**Notes:**
- After this task, the diff equality for movimiento becomes **exact** instead of semantic. The next sync will emit one update per row whose label changed (essentially every row that has a movimiento, due to label format change from `'Mov'` → `'<bank> <month> #<row>'`). This is a one-shot drift handled by the existing diff path — no schema migration needed.

### Task 6: Switch col D (nro) and col M (movimiento) to formatted-text links

**Linear Issue:** [ADV-282](https://linear.app/lw-claude/issue/ADV-282)
**Depends on:** Task 4 (facturaFileId) and Task 5 (movimientoLabel)
**Files:**
- `src/services/sheets.ts` (modify — `rowToCellData` col D and col M branches)
- `src/services/sheets.test.ts` (modify — extend the existing `rowToCellData` tests)

**Steps:**
1. Write tests in `src/services/sheets.test.ts` for `rowToCellData`:
   - **Col D with facturaFileId:** input row `{ nro: '00005-00000042', facturaFileId: 'fac1' }` → output cell at index 3 has `userEnteredValue.stringValue === '00005-00000042'` AND `textFormatRuns === [{ format: { link: { uri: 'https://drive.google.com/file/d/fac1/view' } } }]`.
   - **Col D without facturaFileId (FALTA row):** input `{ nro: '00005-00000050', facturaFileId: '' }` → output has plain `stringValue`, NO `textFormatRuns`.
   - **Col M with movimientoLabel + URL:** input `{ movimientoLabel: 'BBVA ARS 2026-03 #42', movimiento: 'https://docs.google.com/...&range=A42' }` → output cell at index 12 has `userEnteredValue.stringValue === 'BBVA ARS 2026-03 #42'` AND `textFormatRuns[0].format.link.uri` matches the URL.
   - **Col M empty:** input `{ movimientoLabel: '', movimiento: '' }` → output has `userEnteredValue: {}` (blank cell, no formula, no formatRuns).
   - **No HYPERLINK formula anywhere:** regression check — ensure none of the emitted cells contain `formulaValue` starting with `=HYPERLINK`.
2. Run `verifier "sheets"` (expect fails).
3. Implement in `src/services/sheets.ts:rowToCellData`:
   - **Col D (nro):** if `row.facturaFileId !== ''`, emit `{ userEnteredValue: { stringValue: row.nro }, textFormatRuns: [{ format: { link: { uri: `https://drive.google.com/file/d/${row.facturaFileId}/view` } } }] }`. Else emit current plain `{ userEnteredValue: { stringValue: row.nro } }`.
   - **Col M (movimiento):** if `row.movimientoLabel !== ''`, emit `{ userEnteredValue: { stringValue: row.movimientoLabel }, textFormatRuns: [{ format: { link: { uri: row.movimiento } } }] }`. Else emit `{ userEnteredValue: {} }`.
   - Pattern reference: `convertToSheetsCellData` at `sheets.ts:1023-1029` (the `isCellLink` branch) shows the canonical textFormatRuns shape.
   - Remove the existing HYPERLINK formula construction at lines 1387-1393 (including the double-quote escaping — no longer needed in this code path).
4. Verify `applySubdiarioDiff` field mask at `sheets.ts:~1450` covers `textFormatRuns` (search for `fields:` near `updateCells` and `appendCells`). If the current mask is `userEnteredValue,userEnteredFormat.numberFormat`, widen it to include `textFormatRuns`. Add a test asserting the field mask string includes `textFormatRuns` (sanity guard so a future narrowing doesn't silently drop the links).
5. Run `verifier "sheets"` (expect pass).
6. Run full `verifier` (no pattern) to catch any cross-file regressions (subdiario-builder, subdiario-writer, subdiario-diff all consume the changed cell shapes via the writer integration tests).

**Notes:**
- **No schema migration.** Same 14 columns. The cell *content type* changes from formula to text+format, which the diff path handles as a normal UPDATE per row.
- **One-shot expected diff:** on the first sync after deploy, every row that has either a populated `nro` (most rows) or a populated `movimientoLabel` (the new hard-paid set, much larger than today's 6) will UPDATE. The single batchUpdate handles it; sortInvariantFallback should NOT trigger.
- **After this task, the user sees:** clickable factura nro → opens the source PDF; clickable bank label → opens the exact bank movimiento row.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs (focus areas: Task 3 dedupe correctness, Task 5 diff regression coverage, Task 6 field mask)
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix the silently-misleading "Pendiente confirmación bancaria" marker (most are actually bank-confirmed via pago indirection), switch the Subdiario's link cells from HYPERLINK formulas to project-standard text-format links with descriptive labels, add a clickable nro→factura PDF link, and hardcode Factura E condicion to "Exterior" to bypass an unreliable extraction.

**Linear Issues:** ADV-277, ADV-278, ADV-279, ADV-280, ADV-281, ADV-282

**Approach:** Six TDD tasks, three layers. Parser layer: Task 1 (one-line override + tests). Builder/data layer: Task 2 (BankMovimiento.label), Task 3 (one-hop traversal), Task 4 (SubdiarioRow.facturaFileId), Task 5 (SubdiarioRow.movimientoLabel + diff cleanup). Writer/cell layer: Task 6 (rowToCellData switches col D and col M to textFormatRuns, replacing HYPERLINK formulas). Tasks 1-3 are independent and can run in parallel. Task 5 depends on Task 2. Task 6 depends on Tasks 4+5.

**Scope:** 6 tasks, ~9 modified files, ~20 new/modified tests, no spreadsheet schema changes, no data migrations required.

**Key Decisions:**
- Factura E uses new canonical value `'Exterior'` (added to `VALID_CONDICION_IVA`); pre-existing `'Cliente del Exterior'` stays valid for backward compatibility with historical extractions. No automatic backfill of existing rows — user-triggered rescan or one-shot sheet update if desired.
- One-hop pago traversal is additive (direct match still works); dedupe on `sourceUrl` since one factura can have multiple pagos and multiple movimientos.
- Label format: `'{bankFolderName} {YYYY-MM} #{rowNumber}'` (e.g., `'BBVA 007-009364/1 ARS 2026-03 #42'`). Full bank folder name preserves account number context.
- Cell URL for nro: `https://drive.google.com/file/d/{fileId}/view` (standard Drive viewer URL, opens in new tab).
- `movimiento` URL field is no longer compared in the diff (Task 5) — only `movimientoLabel` is. URL is unknowable from a cell read.
- `facturaFileId` is excluded from diff equality entirely (Task 4) — read side always empty.

**Risks:**
- **Task 3 will visibly change the Subdiario** (most "soft-paid" rows reclassify as "hard-paid"). This is the intended fix but the user should be ready for a large reshuffle on the first staging rebuild.
- **Task 6 one-shot full-update** on first sync after deploy — every row with a movimiento label or factura nro will diff. Single batchUpdate handles it; the sort-invariant fallback should not trigger because no rows are inserted/deleted, only updated. Confirm in staging before promoting.
- **Field mask widening (Task 6 step 4)** — if `applySubdiarioDiff`'s `updateCells` field mask doesn't already include `textFormatRuns`, the link formatting will be silently dropped. Tests guard against this.
- **Task 1 backfill** — existing Subdiario rows for Factura E show old condicion until backfilled. Acceptable per scope; flag if user wants a backfill task added.

---

## Iteration 1

**Status:** COMPLETE
**Method:** single-agent
**Completed:** 2026-05-17

### Tasks Completed

| Task | Linear | Outcome |
|------|--------|---------|
| 1 | [ADV-277](https://linear.app/lw-claude/issue/ADV-277) | Factura E (tipoComprobante='E') now hardcodes `condicionIVAReceptor='Exterior'` before the canonical-list `needsReview` flag fires. Added `'Exterior'` to `VALID_CONDICION_IVA` (additive — `'Cliente del Exterior'` preserved). 4 new parser tests; canonical-list test extended from 5→6 values. |
| 2 | [ADV-278](https://linear.app/lw-claude/issue/ADV-278) | `BankMovimiento.label: string` added. `readMovimientosRows` extracts `bankFolderName` from cache key (split on first `:`) and builds `label = '${bankFolderName} ${sheet.title} #${rowNumber}'`. 3 new writer tests. |
| 3 | [ADV-279](https://linear.app/lw-claude/issue/ADV-279) | `aggregateMovimientos` extended to follow one-hop pago→factura indirection. Builds `pagoToFactura: Set<string>` of pago fileIds where `pago.matchedFacturaFileId === fileId && pago.fileId !== ''`. Dedupe by `sourceUrl`. Call site at builder line ~735 updated. 5 new tests. Side effect: `makeMov` test helper now generates unique default sourceUrls per call (avoids dedupe collapsing fixture multi-cuotas). |
| 4 | [ADV-280](https://linear.app/lw-claude/issue/ADV-280) | `SubdiarioRow.facturaFileId: string` added. Populated from `factura.fileId` for FC and NC rows; empty for FALTA placeholders. `readSubdiarioRows` always reports `''`. Diff excludes the field naturally (absent from `stringFields` list). 3 builder tests + 1 reader test + 1 diff test. |
| 5 | [ADV-281](https://linear.app/lw-claude/issue/ADV-281) | `SubdiarioRow.movimientoLabel: string` added. `MovimientoAgg.items` extended with `label`; builder populates from `movAgg.items[last].label`. `readSubdiarioRows` reads col M displayed text into `movimientoLabel` and leaves `movimiento` URL as `''`. SEMANTIC PRESENCE hack in `subdiario-diff.ts` replaced with exact equality on `movimientoLabel`; `movimiento` URL excluded from diff entirely. JSDoc updated in writer + diff. 3 builder tests + 1 reader test + 4 diff tests (replaced ADV-272 SEMANTIC PRESENCE assertions). |
| 6 | [ADV-282](https://linear.app/lw-claude/issue/ADV-282) | `rowToCellData` rewritten: col D emits `textFormatRuns` link to `https://drive.google.com/file/d/{facturaFileId}/view` when populated (plain `stringValue` for FALTA); col M emits `textFormatRuns` link with `movimientoLabel` as display text and `movimiento` as URI (empty cell when label blank). `=HYPERLINK` formula construction and double-quote escaping removed entirely. `applySubdiarioDiff` field mask widened from `'userEnteredValue,userEnteredFormat.numberFormat'` → `'userEnteredValue,userEnteredFormat.numberFormat,textFormatRuns'` on both insert-path and update-path. 5 new sheets.test.ts tests; 3 old HYPERLINK formula tests replaced. |

### Bug-hunter findings (fixed)

1. **CRITICAL — Build break** (`src/services/subdiario-writer.ts:595`): The schema-migration fallback pushed `SubdiarioRowWithIndex` stub rows without the new `movimientoLabel` and `facturaFileId` fields, breaking `tsc`. Fixed by adding both fields with empty-string defaults. Stubs are index-only (full-rewrite path discards them).

### Verification

- All 2503 unit/integration tests pass (74 test files).
- `npm run build` clean — no warnings, no errors.
- `bug-hunter` post-fix: no remaining bugs.
- Lint clean.

### Files Modified

- `src/types/index.ts` — `BankMovimiento.label`, `SubdiarioRow.facturaFileId`, `SubdiarioRow.movimientoLabel`
- `src/gemini/parser.ts` — Factura E override + `'Exterior'` canonical value
- `src/gemini/parser.test.ts` — 4 new tests + 1 extended canonical-values test
- `src/services/subdiario-builder.ts` — one-hop traversal, `MovimientoAgg.items` carries label, FC/NC/FALTA construction populates new fields
- `src/services/subdiario-builder.test.ts` — 11 new tests (5 one-hop, 3 facturaFileId, 3 movimientoLabel); `makeMov` sequence counter; `label` default
- `src/services/subdiario-writer.ts` — `readMovimientosRows` builds label, `readSubdiarioRows` populates new fields, schema-migration stub fixed, JSDoc updated
- `src/services/subdiario-writer.test.ts` — 5 new tests (3 label, 1 movimientoLabel read, 1 facturaFileId read); MOCK_ROWS updated
- `src/services/subdiario-diff.ts` — SEMANTIC PRESENCE block removed, `movimientoLabel` added to `stringFields`, header JSDoc rewritten
- `src/services/subdiario-diff.test.ts` — `makeRow` updated; 3 ADV-272 SEMANTIC PRESENCE tests replaced with 4 ADV-281 exact-label tests + 1 ADV-280 facturaFileId-exclusion test
- `src/services/sheets.ts` — `rowToCellData` rewritten for col D / col M; field mask widened on both `updateCells` requests
- `src/services/sheets.test.ts` — `makeTestRow` updated; 5 new tests; 3 ADV-272 HYPERLINK tests replaced

### Behavioral notes

- **Task 3 will visibly change the Subdiario on first staging rebuild**: most rows currently flagged "Pendiente confirmación bancaria" will reclassify as hard-paid (bank-confirmed via pago indirection). This is the intended fix; user should expect a large reshuffle.
- **Task 6 first-sync UPDATE wave**: every row with a populated `nro` (most rows) and/or `movimientoLabel` (the larger new hard-paid set) will UPDATE on the first post-deploy sync. Single batchUpdate handles it; `sortInvariantFallback` does NOT trigger (no inserts/deletes).
- **Task 1 backfill deferred**: existing Facturas Emitidas rows for Factura E may still show `'Cliente del Exterior'` or empty in column H until rescanned. Subdiario reads from that cell directly, so the new `'Exterior'` value appears only for freshly-processed (or backfilled) rows.
