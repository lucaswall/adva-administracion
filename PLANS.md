# Bug Fix Plan

**Created:** 2026-02-23
**Bug Report:** Movimientos matching has duplicate fileId assignments (same document matched to multiple movements), no matchedType column for MANUAL locking, and missing PAGOS AFIP bank fee pattern. Direct debit auto-labeling was reported but already resolved (dead code).
**Category:** Matching

## Investigation

### Context Gathered
- **MCPs used:** Google Drive MCP (read BBVA ARS movimientos + Control sheets), Linear MCP (checked existing issues)
- **Files examined:** BBVA ARS Movimientos spreadsheet (staging), Control de Ingresos, Control de Egresos, match-movimientos.ts, matcher.ts, movimientos-reader.ts, movimientos-detalle.ts, types/index.ts, SPREADSHEET_FORMAT.md

### Evidence

**Duplicate fileId matches found in BBVA ARS staging data:**
- 126,000 ARS: 3 bank credits all matched to Gustavo del Gerbo, but Tomas Carceglia and Gabriel Rosa also have 126K facturas
- 130,000 ARS: 2 bank credits all matched to Eclipse, but Perspectiva and Whiteboard Games also have 130K facturas
- 58,500 ARS: 2 An Otter credits matched to same factura (00005-00000023), but An Otter has a second factura (00005-00000012)
- 776,160 ARS: 2 same-day debits matched to LOPEZ pago, but COLS NICOLAS AGUSTIN has a separate 776K pago

**Root cause:** `matchBankMovimientos()` at `src/bank/match-movimientos.ts:794` processes each movement independently. Each call to `matcher.matchMovement()`/`matcher.matchCreditMovement()` sees the FULL pool of documents. No `usedFileIds` Set tracks which documents have already been assigned within a bank's matching pass.

**MANUAL locking gap:** ADV-132 previously removed dead MANUAL lock code from movimientos because there was no `matchConfidence` column. User now wants a `matchedType` column (AUTO/MANUAL) with proper MANUAL semantics: user sets matchedFileId + MANUAL → system generates detalle + file excluded from pool.

**PAGOS AFIP:** Bank concept `PAGOS AFIP` appears in movimientos but is not recognized by `BANK_FEE_PATTERNS` at `src/bank/matcher.ts:227-244`. User confirmed these are bank fees (Gasto bancario).

**Direct debit:** `isDirectDebit()` at `src/bank/matcher.ts:87` and `DIRECT_DEBIT_PATTERNS` at line 46 are dead code — never called from match-movimientos.ts. Direct debits already go through normal document matching. No fix needed.

### Root Cause

The matching loop in `matchBankMovimientos()` has no mechanism to track which document fileIds have already been assigned to movements within a single bank pass. Each movement sees the entire document pool, causing the same high-quality match to be assigned repeatedly.

#### Related Code
- `src/bank/match-movimientos.ts:754-934` — `matchBankMovimientos()` function: the main loop at line 794 iterates movements and calls `matcher.matchMovement()`/`matcher.matchCreditMovement()` without a `usedFileIds` set
- `src/bank/match-movimientos.ts:90-128` — `VersionableRow` interface and `computeRowVersion()`: needs `matchedType` field for TOCTOU protection
- `src/bank/matcher.ts:227-244` — `BANK_FEE_PATTERNS` array: missing PAGOS AFIP pattern
- `src/bank/matcher.ts:46-51` — `DIRECT_DEBIT_PATTERNS` + `isDirectDebit()`: dead code, can be removed
- `src/services/movimientos-reader.ts:44-64` — `parseMovimientoRow()`: reads columns A:H, needs A:I for matchedType
- `src/services/movimientos-reader.ts:117` — Range `A:H` needs to be `A:I`
- `src/services/movimientos-detalle.ts:17-32` — `DetalleUpdate` interface: needs `matchedType` field
- `src/services/movimientos-detalle.ts:53-71` — `computeVersionFromRow()`: needs matchedType in hash
- `src/services/movimientos-detalle.ts:170-172` — Write range `G:H` needs to be `G:I`, values need matchedType
- `src/types/index.ts:844-865` — `MovimientoRow` interface: needs `matchedType` field

### Impact
- Duplicate matches cause incorrect financial reconciliation — one document appears matched to multiple bank movements
- Without MANUAL locking, users cannot override algorithmic mistakes in movimientos
- PAGOS AFIP debits remain unmatched instead of being auto-labeled as bank fees

## Fix Plan

### Fix 1: Add matchedType column to movimientos schema
**Linear Issue:** [ADV-139](https://linear.app/lw-claude/issue/ADV-139/add-matchedtype-column-i-to-movimientos-schema)

Expand the movimientos spreadsheet schema from 8 columns (A:H) to 9 columns (A:I) with a new `matchedType` column after `detalle`.

**Migration note:** Schema change from 8→9 columns. Existing spreadsheets have no column I. The reader must handle rows with only 8 values gracefully (matchedType defaults to empty string). No startup migration needed — old rows parse correctly with the 9th value absent.

1. Write test in `src/types/index.ts` — no test needed, just add `matchedType: string` field to `MovimientoRow` interface (values: `'AUTO'` | `'MANUAL'` | `''`)

2. Write test in `src/services/movimientos-reader.test.ts` for `parseMovimientoRow` handling 8-column (backward compat) and 9-column rows
3. Run verifier (expect fail)
4. Update `parseMovimientoRow` in `src/services/movimientos-reader.ts`:
   - Read `row[8]` as matchedType (default `''` if absent — backward compat)
   - Change range from `A:H` to `A:I` at line 117
5. Run verifier (expect pass)

6. Write test in `src/services/movimientos-detalle.test.ts` for `DetalleUpdate` with matchedType, `computeVersionFromRow` including matchedType, and write range `G:I`
7. Run verifier (expect fail)
8. Update `src/services/movimientos-detalle.ts`:
   - Add `matchedType` field to `DetalleUpdate` interface
   - Include matchedType in `computeVersionFromRow` hash (index 8)
   - Change write range from `G${row}:H${row}` to `G${row}:I${row}` at line 171
   - Add matchedType to values array at line 172
9. Run verifier (expect pass)

10. Update `src/bank/match-movimientos.ts`:
    - Add `matchedType` to `VersionableRow` interface
    - Include matchedType in `computeRowVersion` hash
    - Add `matchedType: 'AUTO'` to all `updates.push()` calls (line 916-922)
11. Run verifier (expect pass — existing tests should adapt)

12. Update `SPREADSHEET_FORMAT.md` — add column I (matchedType) to Movimientos schema
13. Update `CLAUDE.md` — remove note that movimientos don't support MANUAL locking

### Fix 2: Implement usedFileIds deduplication and MANUAL support
**Linear Issue:** [ADV-140](https://linear.app/lw-claude/issue/ADV-140/implement-usedfileids-deduplication-and-manual-support-for-movimientos)

Prevent the same document from being matched to multiple movements within a bank. Implement MANUAL lock semantics: MANUAL rows are never overwritten, their fileIds are excluded from the matching pool, and blank detalles on MANUAL rows get auto-generated.

1. Write tests in `src/bank/match-movimientos.test.ts`:
   - Test: MANUAL row is skipped (not overwritten) even with `force=true`
   - Test: MANUAL row's fileId is excluded from the matching pool (other movements can't match it)
   - Test: MANUAL row with blank detalle gets detalle auto-generated from matched document
   - Test: Same fileId is not assigned to two different movements (usedFileIds dedup)
   - Test: After a fileId is used by one movement, the next movement with same amount gets a different match
2. Run verifier (expect fail)

3. Implement in `src/bank/match-movimientos.ts` — `matchBankMovimientos()`:
   - **Pre-processing phase** (before the main loop):
     a. Scan all movimientos for rows with `matchedType === 'MANUAL'`
     b. Collect their `matchedFileId` values into `usedFileIds: Set<string>`
     c. For MANUAL rows with blank `detalle` and non-empty `matchedFileId`: look up the document in ingresosData/egresosData and generate a detalle description, push to updates with `matchedType: 'MANUAL'`
   - **Main matching loop** (line 794):
     a. Skip MANUAL rows entirely (never overwrite, even with force)
     b. After a successful match, add `matchResult.matchedFileId` to `usedFileIds`
     c. Pass `usedFileIds` to matcher methods so they exclude already-used documents
   - **Matcher integration**: `BankMovementMatcher.matchMovement()` and `matchCreditMovement()` need an optional `excludeFileIds?: Set<string>` parameter. Filter candidates whose fileId is in the set before ranking.

4. Write tests in `src/bank/matcher.test.ts`:
   - Test: `matchMovement` with `excludeFileIds` excludes specified fileIds from candidates
   - Test: `matchCreditMovement` with `excludeFileIds` excludes specified fileIds from candidates
5. Run verifier (expect fail)

6. Implement in `src/bank/matcher.ts`:
   - Add optional `excludeFileIds?: Set<string>` parameter to `matchMovement()` and `matchCreditMovement()`
   - Filter candidates early (after collecting all tiered candidates, before selecting best) — remove any candidate whose fileId is in `excludeFileIds`
7. Run verifier (expect pass)

### Fix 3: Add PAGOS AFIP to bank fee patterns and clean up dead code
**Linear Issue:** [ADV-141](https://linear.app/lw-claude/issue/ADV-141/add-pagos-afip-to-bank-fee-patterns-and-remove-dead-direct-debit-code)

Add PAGOS AFIP pattern to `BANK_FEE_PATTERNS`. Remove dead `DIRECT_DEBIT_PATTERNS` and `isDirectDebit()` code.

1. Write test in `src/bank/matcher.test.ts`:
   - Test: `isBankFee('PAGOS AFIP')` returns true
   - Test: `isBankFee('D 500 PAGOS AFIP')` returns true (with bank origin prefix)
2. Run verifier (expect fail)

3. Implement in `src/bank/matcher.ts`:
   - Add `/^PAGOS\s*AFIP/i` to `BANK_FEE_PATTERNS` array (line 227-244)
4. Run verifier (expect pass)

5. Remove dead code in `src/bank/matcher.ts`:
   - Remove `DIRECT_DEBIT_PATTERNS` (lines 46-51) and `isDirectDebit()` function (lines 82-92)
   - Remove the export — check no imports exist (already verified: no callers)
6. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Problem:** Bank movimientos matching assigns the same document to multiple movements (duplicate fileId) and lacks MANUAL locking support and PAGOS AFIP bank fee recognition.

**Root Cause:** `matchBankMovimientos()` processes movements independently without tracking used fileIds. No `matchedType` column exists for MANUAL locking. PAGOS AFIP is missing from `BANK_FEE_PATTERNS`.

**Linear Issues:** [ADV-139](https://linear.app/lw-claude/issue/ADV-139/add-matchedtype-column-i-to-movimientos-schema), [ADV-140](https://linear.app/lw-claude/issue/ADV-140/implement-usedfileids-deduplication-and-manual-support-for-movimientos), [ADV-141](https://linear.app/lw-claude/issue/ADV-141/add-pagos-afip-to-bank-fee-patterns-and-remove-dead-direct-debit-code)

**Solution Approach:** Add a `matchedType` column (I) to the movimientos schema, implement `usedFileIds` tracking in the matching loop to prevent duplicates, add MANUAL pre-processing that excludes locked fileIds and auto-generates missing detalles, pass `excludeFileIds` to the matcher, add PAGOS AFIP pattern, and remove dead direct debit code.

**Scope:**
- Fixes: 3
- Files affected: ~8 (types/index.ts, movimientos-reader.ts, movimientos-detalle.ts, match-movimientos.ts, matcher.ts, SPREADSHEET_FORMAT.md, CLAUDE.md, plus test files)
- New tests: yes
- Breaking changes: no — 9th column is additive, reader handles 8-column rows gracefully

**Risks/Considerations:**
- Schema expansion from 8→9 columns — mitigated by backward-compatible parsing (missing 9th column defaults to empty)
- `excludeFileIds` changes matcher method signatures — needs careful integration with existing tests
- MANUAL detalle generation reuses existing document lookup logic from `findDocumentByFileId` — no new API calls needed

---

## Iteration 1

**Implemented:** 2026-02-23
**Method:** Single-agent (7 effort points across 2 units)

### Tasks Completed This Iteration
- Fix 1 (ADV-139): Add matchedType column (I) to movimientos schema — expanded from 8→9 columns with backward-compatible parsing
- Fix 2 (ADV-140): Implement usedFileIds deduplication and MANUAL support — pre-seeds ALL existing matchedFileIds into excludeFileIds, MANUAL rows skipped from matching, blank MANUAL detalles auto-generated, temporary own-fileId removal for re-evaluation
- Fix 3 (ADV-141): Add PAGOS AFIP to bank fee patterns and remove dead direct debit code

### Files Modified
- `src/types/index.ts` — Added `matchedType: string` to `MovimientoRow` interface
- `src/services/movimientos-reader.ts` — Range A:H→A:I, parse matchedType from row[8] with backward compat
- `src/services/movimientos-reader.test.ts` — Tests for 9-column and 8-column compatibility
- `src/services/movimientos-detalle.ts` — matchedType in DetalleUpdate, computeVersionFromRow hash, G:I write range, updated JSDoc
- `src/services/movimientos-detalle.test.ts` — Updated ranges, values, hash inputs for 9-column schema
- `src/bank/match-movimientos.ts` — Pre-seed excludeFileIds with all existing matchedFileIds, temporary own-fileId removal, MANUAL pre-processing with detalle generation, buildDetalleForDocument helper, zero-amount movement fileId restoration, removed dead recibo concepto branch
- `src/bank/match-movimientos.test.ts` — 8 new tests (MANUAL skip, excludeFileIds pool, detalle generation, usedFileIds dedup, accumulation, AUTO pre-seeding, zero-amount restoration)
- `src/bank/matcher.ts` — excludeFileIds parameter on matchMovement/matchCreditMovement, PAGOS AFIP pattern, removed DIRECT_DEBIT_PATTERNS and isDirectDebit
- `src/bank/matcher.test.ts` — PAGOS AFIP tests, excludeFileIds tests
- `SPREADSHEET_FORMAT.md` — 9 columns, matchedType column, MANUAL locking support
- `CLAUDE.md` — Updated movimientos column count, MANUAL support note

### Linear Updates
- ADV-139: Todo → In Progress → Review
- ADV-140: Todo → In Progress → Review
- ADV-141: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs (1 HIGH, 2 MEDIUM), all fixed before commit
  - HIGH: Zero-amount movements leaked ownFileId from excludeFileIds on continue
  - MEDIUM: Stale JSDoc in computeVersionFromRow (A:H → A:I)
  - MEDIUM: Dead concepto branch in buildDetalleForDocument for recibo type
- verifier: All 1808 tests pass, zero warnings, clean build

### Continuation Status
All tasks completed.
