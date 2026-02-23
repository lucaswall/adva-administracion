# Bug Fix Plan

**Created:** 2026-02-23
**Bug Report:** Pagos Recibidos and Retenciones don't match in staging. USD payments miss due to $1 tolerance (bank fees ~$20), 60-day date cap (international wires take 75+ days), punctuation in names preventing substring matching, and no retencion→factura matching logic. Also need a manual match locking column to prevent automatic overwrite of user-confirmed matches.
**Category:** Matching
**Linear Issues:** [ADV-127](https://linear.app/lw-claude/issue/ADV-127/add-dollar30-same-currency-tolerance-for-usd-factura-pago-matching), [ADV-128](https://linear.app/lw-claude/issue/ADV-128/extend-low-date-range-to-90-days-for-usd-factura-matching), [ADV-129](https://linear.app/lw-claude/issue/ADV-129/improve-name-matching-by-stripping-punctuation-in-normalizestring), [ADV-130](https://linear.app/lw-claude/issue/ADV-130/implement-retencionfactura-matching-in-runmatching-pipeline), [ADV-131](https://linear.app/lw-claude/issue/ADV-131/add-matchmanual-column-to-all-matching-sheets-for-manual-match-locking)

## Investigation

### Context Gathered
- **MCPs used:** Google Drive (gsheets_read — staging Control de Ingresos), Linear (issue search)
- **Files examined:** Staging spreadsheet `1mt5VB7Qp7trCnl1tR8oFH35WWBWLbzsMhtzS_z7f2YQ` (Facturas Emitidas, Pagos Recibidos, Retenciones Recibidas), all matching code, exchange-rate.ts, config.ts, spreadsheet-headers.ts, types/index.ts

### Evidence

**Staging spreadsheet analysis (11 Pagos Recibidos, all USD):**

| Pago | Amount | Factura Match? | Root Cause |
|------|--------|----------------|------------|
| MICROSOFT (Dec 23) | 5,500 USD | Factura exists (5,500 USD, Oct 9) | Date gap 75 days > 60-day LOW max |
| DEVOLVER DIGITAL (Nov 1) | 1,780 USD | Factura exists (1,800 USD, Oct 21) | Amount diff $20 > $1 tolerance |
| STANDARD CHARTERED (Oct 30) | 1,200 USD | No factura for this company | Expected — no factura exists |
| ODACLICK (Oct 22) | 2,480 USD | Factura exists (2,500 USD, Oct 17) | Amount diff $20 > $1 tolerance |
| FRITO PLAY (Oct 22) | 430 USD | Matched MEDIUM | Comma in "FRITO PLAY, LLC" prevents HIGH |
| FRITO PLAY (Oct 16) | 6,750 USD | Matched MEDIUM | Same comma issue |

**Retenciones Recibidas (2 rows, both CFI):**
- CERT-8884: montoComprobante=12M ARS → Factura 00003-00002175 (CFI, 12M ARS) — obvious match by CUIT + amount
- CERT-8987: montoComprobante=242,984 ARS → 2× Factura 121,492 ARS — multi-factura case
- Both have empty matchedFacturaFileId — no retencion matching code exists

**All Pagos Recibidos have empty `cuitPagador`** — CUIT matching never fires for Ingresos.

### Root Causes

1. **USD amount tolerance:** `amountsMatchCrossCurrency()` at `src/utils/exchange-rate.ts:328-332` calls `amountsMatch(facturaAmount, pagoAmount)` with default tolerance $1. International wire fees ($10-30) cause mismatches.

2. **USD date range:** `FacturaPagoMatcher` at `src/matching/matcher.ts:111` uses single `dateRangeAfter` (60 days). International USD payments can take 75+ days.

3. **Name punctuation:** `normalizeString()` at `src/matching/matcher.ts:43-49` strips accents but not punctuation. "FRITO PLAY, LLC" vs "Frito Play LLC" fails substring match.

4. **Missing retencion matching:** `runMatching()` at `src/processing/matching/index.ts:29-193` has 4 matching steps but none for retenciones→facturas. Schema has columns N:O (matchedFacturaFileId, matchConfidence) but they're never populated.

5. **No manual lock:** No mechanism exists to prevent automatic matching from overwriting user-confirmed matches. The `matchConfidence` column already exists on all matching sheets — adding a `MANUAL` value avoids schema changes.

#### Related Code

**Fix 1 (USD tolerance):**
- `src/utils/exchange-rate.ts:319-375` — `amountsMatchCrossCurrency()`: same-currency path at line 328-332 calls `amountsMatch` with implicit $1 tolerance
- `src/utils/numbers.ts:233-246` — `amountsMatch()`: accepts `tolerance` param (default 1)
- `src/matching/matcher.ts:142-153` — `findMatches()` calls `amountsMatchCrossCurrency` without USD tolerance
- `src/matching/matcher.ts:91-114` — `FacturaPagoMatcher` constructor: takes `crossCurrencyTolerancePercent` but no same-currency tolerance
- `src/config.ts:164-167` — Config interface: has `usdArsTolerancePercent` but no USD same-currency tolerance

**Fix 2 (USD date range):**
- `src/matching/matcher.ts:107-112` — date ranges set at construction time, single `dateRangeAfter` for LOW tier
- `src/matching/matcher.ts:162-169` — `isWithinLowRange` check uses single range for all currencies
- `src/config.ts:165-166` — `matchDaysBefore`/`matchDaysAfter` (single value, no per-currency)
- `src/processing/matching/factura-pago-matcher.ts:405-408` — matcher constructed with `config.matchDaysAfter`

**Fix 3 (Name punctuation):**
- `src/matching/matcher.ts:43-49` — `normalizeString()`: strips accents via NFD, but no punctuation removal
- `src/matching/matcher.ts:217-248` — name matching: uses `normalizeString` then `.includes()` comparison

**Fix 4 (Retencion matching):**
- `src/processing/matching/index.ts:29-193` — `runMatching()`: no retencion step
- `src/processing/matching/nc-factura-matcher.ts` — model for non-cascading matcher (CUIT + amount matching)
- `src/constants/spreadsheet-headers.ts:96-112` — `RETENCIONES_RECIBIDAS_HEADERS`: columns N (matchedFacturaFileId) and O (matchConfidence) at indices 13-14
- `src/types/index.ts` — `Retencion` type: has `matchedFacturaFileId?` and `matchConfidence?` fields

**Fix 5 (matchConfidence=MANUAL locking):**
- `src/types/index.ts:69` — `MatchConfidence` type: add `'MANUAL'` to the union
- `src/utils/validation.ts:383-388` — `validateMatchConfidence()`: add `'MANUAL'` to `validLevels` array
- `src/matching/matcher.ts:54-86` — `compareMatchQuality()` and `confidenceOrder`: add `MANUAL: 4` (highest)
- `src/matching/matcher.ts:250-287` — `findMatches()`: skip facturas where `matchConfidence === 'MANUAL'`
- `src/processing/matching/factura-pago-matcher.ts:390` — `unmatchedPagos` filter: exclude `matchConfidence === 'MANUAL'`
- `src/processing/matching/recibo-pago-matcher.ts:346` — same MANUAL skip pattern for recibos and pagos
- `src/processing/matching/nc-factura-matcher.ts` — same MANUAL skip pattern for NCs and facturas
- `src/bank/match-movimientos.ts:870-910` — bank matching loop: skip movimientos with `matchConfidence === 'MANUAL'`
- No schema changes needed — `matchConfidence` column already exists in all matching sheets (Ingresos, Egresos, Movimientos)

### Impact
- 4 out of 11 Pagos Recibidos in staging fail to match (36% miss rate)
- All retenciones fail to match (100% miss rate)
- Matched pagos get MEDIUM instead of HIGH due to punctuation (reduced confidence)
- Users cannot lock manual corrections — risk of overwrite on next scan

## Fix Plan

### Fix 1: Add $30 same-currency tolerance for USD matching
**Linear Issue:** [ADV-127](https://linear.app/lw-claude/issue/ADV-127/add-dollar30-same-currency-tolerance-for-usd-factura-pago-matching)

1. Write tests in `src/utils/exchange-rate.test.ts`:
   - Test `amountsMatchCrossCurrency` with USD/USD: $1780 vs $1800 should match with tolerance=30
   - Test USD/USD: $1780 vs $1800 should NOT match with default tolerance=1
   - Test ARS/ARS: amounts must still use $1 tolerance (unchanged)
   - Run `verifier` filtered — expect fail

2. Add `sameCurrencyUsdTolerance` optional param to `amountsMatchCrossCurrency()` in `src/utils/exchange-rate.ts`:
   - Signature: add `sameCurrencyUsdTolerance?: number` (default 1)
   - In same-currency path (line 328-332): when both are USD, use `amountsMatch(facturaAmount, pagoAmount, sameCurrencyUsdTolerance)`; when ARS, keep default $1

3. Add `USD_SAME_CURRENCY_TOLERANCE = 30` constant in `src/config.ts`

4. Thread through `FacturaPagoMatcher`:
   - Add `sameCurrencyUsdTolerance` constructor param in `src/matching/matcher.ts`
   - Pass to `amountsMatchCrossCurrency()` call at line 142
   - In `src/processing/matching/factura-pago-matcher.ts:405-408`: pass `USD_SAME_CURRENCY_TOLERANCE` to matcher constructor

5. Write test in `src/matching/matcher.test.ts`:
   - Test FacturaPagoMatcher finds match for USD pago $1780 vs USD factura $1800
   - Run `verifier` filtered — expect pass

### Fix 2: Extend LOW date range to 90 days for USD factura matching
**Linear Issue:** [ADV-128](https://linear.app/lw-claude/issue/ADV-128/extend-low-date-range-to-90-days-for-usd-factura-matching)

1. Write tests in `src/matching/matcher.test.ts`:
   - Test FacturaPagoMatcher matches USD factura at 75 days distance with usdDaysAfter=90
   - Test ARS factura at 75 days distance is NOT matched (keeps 60-day range)
   - Run `verifier` filtered — expect fail

2. Add `MATCH_DAYS_AFTER_USD` env var and `usdMatchDaysAfter` to Config:
   - `src/config.ts`: add `usdMatchDaysAfter: number` to Config interface
   - In `getConfig()`: read `MATCH_DAYS_AFTER_USD` env var (default 90)
   - Add env var documentation to CLAUDE.md

3. Modify `FacturaPagoMatcher` in `src/matching/matcher.ts`:
   - Add `usdDateRangeAfter` constructor param (default same as `dateRangeAfter`)
   - Store as `this.dateRanges.lowUsd: { before, after }` alongside existing `this.dateRanges.low`
   - In `findMatches()`: after line 164, compute `isWithinLowRange` using `lowUsd` range when `factura.moneda === 'USD'`, standard `low` range otherwise
   - HIGH and MEDIUM ranges stay the same for all currencies

4. Pass `config.usdMatchDaysAfter` from `factura-pago-matcher.ts` matcher construction (line 405-408)
   - Run `verifier` filtered — expect pass

### Fix 3: Improve name matching by stripping punctuation
**Linear Issue:** [ADV-129](https://linear.app/lw-claude/issue/ADV-129/improve-name-matching-by-stripping-punctuation-in-normalizestring)

1. Write tests in `src/matching/matcher.test.ts`:
   - Test: "FRITO PLAY, LLC" matches "Frito Play LLC" (comma stripped)
   - Test: "S.R.L." matches "SRL" (periods stripped)
   - Test: "Empresa (Argentina)" matches "Empresa Argentina" (parens stripped)
   - Run `verifier` filtered — expect fail

2. Modify `normalizeString()` in `src/matching/matcher.ts:43-49`:
   - Add `.replace(/[.,\-_()]/g, '')` after accent removal
   - Add `.replace(/\s+/g, ' ')` to collapse multiple spaces from removed chars
   - Final `.trim()`
   - Run `verifier` filtered — expect pass

### Fix 4: Implement retencion→factura matching
**Linear Issue:** [ADV-130](https://linear.app/lw-claude/issue/ADV-130/implement-retencionfactura-matching-in-runmatching-pipeline)

1. Write tests in new `src/processing/matching/retencion-factura-matcher.test.ts`:
   - Test: retencion with matching CUIT + montoComprobante = importeTotal → match with HIGH confidence
   - Test: retencion with matching CUIT but different amount → no match
   - Test: retencion with different CUIT → no match
   - Test: already-matched retencion → skip (don't re-match)
   - Test: date outside 90-day window → no match
   - Run `verifier` filtered — expect fail

2. Create `src/processing/matching/retencion-factura-matcher.ts`:
   - Follow the `nc-factura-matcher.ts` pattern (non-cascading, direct matching)
   - Export `matchRetencionesWithFacturas(spreadsheetId: string): Promise<Result<number, Error>>`
   - Read Retenciones Recibidas (A:O or A:P if matchManual added) and Facturas Emitidas (A:S or A:T)
   - For each unmatched retencion:
     - Find facturas where `cuitReceptor === cuitAgenteRetencion`
     - Check `montoComprobante === importeTotal` (using `amountsMatch` with $1 tolerance — retenciones are always ARS)
     - Check date: retencion `fechaEmision` within 0-90 days after factura `fechaEmision`
     - Set confidence: CUIT match + amount match + close date → HIGH; CUIT match + amount only → MEDIUM
   - Write to Retenciones columns N:O (matchedFacturaFileId, matchConfidence)
   - Use `batchUpdate()` for writes, same pattern as nc-factura-matcher

3. Add to `runMatching()` in `src/processing/matching/index.ts`:
   - Import `matchRetencionesWithFacturas`
   - Add as step 5 after NC matching (around line 155), reading from `folderStructure.controlIngresosId`
   - Re-export from index.ts

4. Update `src/processing/matching/index.ts` exports
   - Run `verifier` filtered — expect pass

### Fix 5: Use matchConfidence=MANUAL to lock manual matches
**Linear Issue:** [ADV-131](https://linear.app/lw-claude/issue/ADV-131/add-matchmanual-column-to-all-matching-sheets-for-manual-match-locking)

**No migration needed.** Reuses existing `matchConfidence` column in all 6 sheets. Users set `matchConfidence` to `MANUAL` in the spreadsheet to lock a match. No schema changes, no new columns.

**Semantics:**
- Empty `matchConfidence` → unmatched (can be matched automatically)
- `HIGH` / `MEDIUM` / `LOW` → automatic match (can be displaced by better match)
- `MANUAL` → user-confirmed match (never displaced, never cleared by matchers)

1. Write tests in `src/processing/matching/factura-pago-matcher.test.ts`:
   - Test: pago with `matchConfidence='MANUAL'` is excluded from unmatched pool (treated as matched)
   - Test: factura with `matchConfidence='MANUAL'` is never displaced even if a better automatic match exists
   - Test: the displaced pago from a MANUAL factura is not "unmatched" (MANUAL factura's matchedPagoFileId is never cleared)
   - Run `verifier` filtered — expect fail

2. Update `MatchConfidence` type in `src/types/index.ts:69`:
   - Change from `'HIGH' | 'MEDIUM' | 'LOW'` to `'HIGH' | 'MEDIUM' | 'LOW' | 'MANUAL'`

3. Update `validateMatchConfidence()` in `src/utils/validation.ts:383-388`:
   - Add `'MANUAL'` to the `validLevels` array

4. Update `compareMatchQuality()` in `src/matching/matcher.ts:54-86`:
   - Add `MANUAL: 4` to the `confidenceOrder` map (highest priority)
   - This ensures MANUAL matches are never considered "worse" than any automatic match

5. Update `FacturaPagoMatcher.findMatches()` in `src/matching/matcher.ts`:
   - Skip facturas with `matchConfidence === 'MANUAL'` — do not generate candidates for them (they are locked)
   - This is the key guard: MANUAL facturas are invisible to the matcher

6. Update `src/processing/matching/factura-pago-matcher.ts`:
   - In unmatched pago filter (line 390): add `&& p.matchConfidence !== 'MANUAL'` — pagos with MANUAL are already locked
   - In displacement logic: already handled by step 5 (MANUAL facturas won't appear as candidates), but also guard against displacing a pago that has MANUAL on its side

7. Write tests in `src/processing/matching/recibo-pago-matcher.test.ts`:
   - Test: recibo with `matchConfidence='MANUAL'` is not re-matched
   - Test: pago with `matchConfidence='MANUAL'` is excluded from unmatched pool
   - Run `verifier` filtered — expect fail

8. Update `src/processing/matching/recibo-pago-matcher.ts`:
   - Same MANUAL skip pattern: exclude MANUAL recibos and MANUAL pagos from matching

9. Update `src/processing/matching/nc-factura-matcher.ts`:
   - Same MANUAL skip pattern for NCs and facturas

10. Update `src/processing/matching/retencion-factura-matcher.ts` (from Fix 4):
    - Build with MANUAL support from the start — skip retenciones and facturas with MANUAL confidence

11. Write tests in `src/bank/match-movimientos.test.ts`:
    - Test: movimiento row with `matchConfidence='MANUAL'` is not re-matched (skipped entirely)
    - Run `verifier` filtered — expect fail

12. Update `src/bank/match-movimientos.ts`:
    - In the main matching loop (around line 870-910): when a movimiento already has a match and `matchConfidence === 'MANUAL'`, skip it entirely — do not evaluate candidates or call `isBetterMatch()`
    - The `isBetterMatch()` function itself doesn't need changes — the guard is at the row level before it's called

13. Update `SPREADSHEET_FORMAT.md` and `CLAUDE.md` with MANUAL confidence documentation
    - Run `verifier` — expect pass

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Problem:** Pagos Recibidos and Retenciones don't match in staging due to strict USD amount tolerance ($1), short date range (60 days), punctuation-sensitive name matching, missing retencion matching logic, and no manual match locking.

**Root Cause:** Five independent issues: (1) same-currency USD tolerance too tight for wire transfer fees, (2) LOW date range too short for international payments, (3) punctuation not stripped in name normalization, (4) retencion→factura matching never implemented, (5) no mechanism to lock manual matches.

**Linear Issues:** ADV-127, ADV-128, ADV-129, ADV-130, ADV-131

**Solution Approach:** Add $30 USD same-currency tolerance and 90-day LOW range for USD facturas. Strip punctuation in normalizeString for better name matching. Create new retencion-factura-matcher following the NC matcher pattern. Use existing `matchConfidence` column with new `MANUAL` value to lock matches — no new columns or schema migration needed.

**Scope:**
- Files affected: ~13 (matchers, bank matcher, config, types, validation, exchange-rate, SPREADSHEET_FORMAT.md, CLAUDE.md)
- New tests: yes (all 5 fixes)
- New file: `src/processing/matching/retencion-factura-matcher.ts` + test
- Breaking changes: no — `MANUAL` is a new value in existing column, no schema changes

**Risks/Considerations:**
- Retencion matching for multi-factura cases (montoComprobante = sum of multiple facturas) is deferred — first implementation matches 1:1 only
- USD tolerance of $30 could theoretically match wrong documents if two USD facturas have amounts within $30 of each other for the same client — mitigated by CUIT/name matching tiers
- Users must manually type `MANUAL` in the matchConfidence column — consider documenting in OPERATION-MANUAL.es.md

---

## Iteration 1

**Implemented:** 2026-02-23
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Fix 1 (ADV-127): Add $30 same-currency USD tolerance — `sameCurrencyUsdTolerance` param in exchange-rate.ts, `USD_SAME_CURRENCY_TOLERANCE=30` constant (worker-1)
- Fix 2 (ADV-128): Extend LOW date range to 90 days for USD — `usdMatchDaysAfter` config, `lowUsd` date range in matcher (worker-1)
- Fix 3 (ADV-129): Punctuation stripping in normalizeString — commas, periods, hyphens, underscores, parens stripped (worker-1)
- Fix 4 (ADV-130): Retencion→factura matcher — new `retencion-factura-matcher.ts` with CUIT + amount + date matching, added as step 5 in runMatching pipeline (worker-2)
- Fix 5 (ADV-131): MANUAL match locking — `MANUAL` added to MatchConfidence type, all 6 matchers skip MANUAL rows, docs updated (worker-3 + worker-2 step 10)

### Files Modified
- `src/utils/exchange-rate.ts` — sameCurrencyUsdTolerance param
- `src/utils/exchange-rate.test.ts` — USD tolerance tests
- `src/config.ts` — USD_SAME_CURRENCY_TOLERANCE, usdMatchDaysAfter
- `src/matching/matcher.ts` — lowUsd range, sameCurrencyUsdTolerance, punctuation stripping, MANUAL:4 in confidenceOrder, MANUAL guards
- `src/matching/matcher.test.ts` — USD tolerance, date range, punctuation tests
- `src/processing/matching/factura-pago-matcher.ts` — new matcher params, MANUAL guard
- `src/processing/matching/factura-pago-matcher.test.ts` — MANUAL locking tests
- `src/processing/matching/recibo-pago-matcher.ts` — MANUAL guard
- `src/processing/matching/recibo-pago-matcher.test.ts` — MANUAL locking tests
- `src/processing/matching/nc-factura-matcher.ts` — MANUAL guard
- `src/processing/matching/nc-factura-matcher.test.ts` — MANUAL locking tests
- `src/processing/matching/retencion-factura-matcher.ts` — NEW: retencion-factura matching with MANUAL support
- `src/processing/matching/retencion-factura-matcher.test.ts` — NEW: 16 tests
- `src/processing/matching/index.ts` — step 5: retencion matching
- `src/bank/match-movimientos.ts` — MANUAL guard for movimientos
- `src/bank/match-movimientos.test.ts` — MANUAL locking test
- `src/types/index.ts` — MANUAL in MatchConfidence, matchConfidence in MovimientoRow
- `src/utils/validation.ts` — MANUAL in validateMatchConfidence
- `SPREADSHEET_FORMAT.md` — MANUAL confidence documentation
- `CLAUDE.md` — MANUAL Confidence Lock section, MATCH_DAYS_AFTER_USD env var
- `src/middleware/auth.test.ts`, `src/routes/scan.test.ts`, `src/routes/status.test.ts`, `src/server.test.ts` — Config mock updates

### Linear Updates
- ADV-127: Todo → In Progress → Review
- ADV-128: Todo → In Progress → Review
- ADV-129: Todo → In Progress → Review
- ADV-130: Todo → In Progress → Review
- ADV-131: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 issues (2 medium, 2 low) — all fixed before proceeding
- verifier: All 1,792 tests pass, zero warnings

### Work Partition
- Worker 1: Fix 1, Fix 2, Fix 3 (matcher improvements — USD tolerance, date range, punctuation)
- Worker 2: Fix 4, Fix 5 step 10 (retencion-factura matcher with MANUAL support)
- Worker 3: Fix 5 steps 1-9, 11-13 (MANUAL locking across all existing matchers + docs)

### Merge Summary
- Worker 3: fast-forward (foundation — types, validation, all existing matcher guards)
- Worker 2: auto-merge, 1 conflict in matcher.ts (duplicate MANUAL key — resolved, kept MANUAL:4)
- Worker 1: auto-merge (no conflicts — orthogonal matcher improvements)

### Continuation Status
All tasks completed.

### Review Findings

Summary: 4 issue(s) found (Team: security, reliability, quality reviewers)
- FIX: 4 issue(s) — Linear issues created
- DISCARDED: 5 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [HIGH] BUG: MANUAL lock for movimientos is dead code — matchConfidence column missing from schema, reader never populates it, guard condition also requires matchedFileId (`src/bank/match-movimientos.ts:796`, `src/services/movimientos-reader.ts:52-63`)
- [MEDIUM] TEST: MANUAL pago exclusion test doesn't test production function — tests local filter instead of `doMatchFacturasWithPagos` (`src/processing/matching/factura-pago-matcher.test.ts:228-247`)
- [LOW] TEST: Missing test for multi-retencion same factura design rule (`src/processing/matching/retencion-factura-matcher.ts:186-188`)
- [LOW] TEST: Timing test assertion is a tautology — `Math.abs(a-b)/Math.max(a,b) < 1.0` always passes for positive numbers (`src/middleware/auth.test.ts:196-200`)

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: Internal error messages returned verbatim in API responses — internal API, authenticated, standard practice for internal APIs
- [DISCARDED] CONVENTION: Identical debug log messages across success/error paths in exchange-rate.ts — style-only, zero correctness impact
- [DISCARDED] TYPE: `result.reason` logged without coercing to string in prefetchExchangeRates — Pino handles arbitrary objects, rejected reasons are typically Error objects
- [DISCARDED] TYPE: `displaced.document as Pago` unsafe cast — correct in context, only Pago objects are enqueued in the displacement queue
- [DISCARDED] CONVENTION: Map key used instead of `update.facturaFileId` — functionally equivalent, key IS the facturaFileId

### Linear Updates
- ADV-127: Review → Merge (original task)
- ADV-128: Review → Merge (original task)
- ADV-129: Review → Merge (original task)
- ADV-130: Review → Merge (original task)
- ADV-131: Review → Merge (original task)
- ADV-132: Created in Todo (Fix: MANUAL lock for movimientos dead code)
- ADV-133: Created in Todo (Fix: MANUAL pago exclusion test)
- ADV-134: Created in Todo (Fix: Missing multi-retencion test)
- ADV-135: Created in Todo (Fix: Timing test tautology)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [ADV-132](https://linear.app/lw-claude/issue/ADV-132/manual-lock-for-movimientos-is-dead-code-missing-matchconfidence), [ADV-133](https://linear.app/lw-claude/issue/ADV-133/manual-pago-exclusion-test-doesnt-test-production-function), [ADV-134](https://linear.app/lw-claude/issue/ADV-134/missing-test-for-multi-retencion-same-factura-design-rule), [ADV-135](https://linear.app/lw-claude/issue/ADV-135/timing-test-assertion-is-a-tautology-always-passes)

### Fix 1: MANUAL lock for movimientos — add matchConfidence column + fix guard
**Linear Issue:** [ADV-132](https://linear.app/lw-claude/issue/ADV-132/manual-lock-for-movimientos-is-dead-code-missing-matchconfidence)

1. Write tests in `src/services/movimientos-reader.test.ts`:
   - Test: `parseMovimientoRow` with 9-column row (including matchConfidence in col I) populates `matchConfidence`
   - Test: `parseMovimientoRow` with 8-column row (legacy) leaves `matchConfidence` undefined
   - Run `verifier` filtered — expect fail

2. Update `src/services/movimientos-reader.ts`:
   - In `parseMovimientoRow`: read `row[8]` as matchConfidence using `validateMatchConfidence`
   - Import `validateMatchConfidence` from `../utils/validation.js`

3. Write tests in `src/bank/match-movimientos.test.ts`:
   - Test: movimiento with `matchConfidence='MANUAL'` and empty `matchedFileId` is skipped (not overwritten)
   - Test: movimiento with `matchConfidence='MANUAL'` is skipped even in force mode
   - Run `verifier` filtered — expect fail

4. Fix guard in `src/bank/match-movimientos.ts:796`:
   - Change `if (mov.matchedFileId && mov.matchConfidence === 'MANUAL')` to `if (mov.matchConfidence === 'MANUAL')`

5. Update `src/bank/match-movimientos.ts` write logic:
   - When writing detalle updates, preserve existing matchConfidence value (don't overwrite column I)
   - Or if matchConfidence is written as part of the update, ensure it's preserved

6. Add startup migration in `src/services/movimientos-detalle.ts` or appropriate location:
   - On first access to a movimientos spreadsheet, check if column I header is `matchConfidence`
   - If missing (8-column legacy format), add the header to all YYYY-MM sheets

7. Update `SPREADSHEET_FORMAT.md`:
   - Movimientos Bancario: 8 cols (A:H) → 9 cols (A:I)
   - Add column I: `matchConfidence | enum | HIGH|MEDIUM|LOW|MANUAL`

8. Update `CLAUDE.md`:
   - Update "Movimientos Bancario: 8 cols (A:H)" to "9 cols (A:I)"
   - Run `verifier` filtered — expect pass

### Fix 2: MANUAL pago exclusion test — rewrite to test production function
**Linear Issue:** [ADV-133](https://linear.app/lw-claude/issue/ADV-133/manual-pago-exclusion-test-doesnt-test-production-function)

1. Rewrite test in `src/processing/matching/factura-pago-matcher.test.ts:228-247`:
   - Call `doMatchFacturasWithPagos` with a pago that has `matchConfidence='MANUAL'` and a matching factura
   - Assert the MANUAL pago is NOT re-matched (its existing match is preserved)
   - Run `verifier` filtered — expect pass (test now exercises production code path)

### Fix 3: Missing multi-retencion same factura test
**Linear Issue:** [ADV-134](https://linear.app/lw-claude/issue/ADV-134/missing-test-for-multi-retencion-same-factura-design-rule)

1. Add test in `src/processing/matching/retencion-factura-matcher.test.ts`:
   - Create two retenciones with different `impuesto` (e.g., "IVA" and "Ganancias") but same `cuitAgenteRetencion` and `montoComprobante`
   - Create one matching factura
   - Assert both retenciones match the same factura (no "claimed factura" exclusion)
   - Run `verifier` filtered — expect pass

### Fix 4: Timing test tautology
**Linear Issue:** [ADV-135](https://linear.app/lw-claude/issue/ADV-135/timing-test-assertion-is-a-tautology-always-passes)

1. Update test in `src/middleware/auth.test.ts:196-200`:
   - Remove the tautological timing ratio assertion
   - Replace with a simpler test that just verifies both valid and invalid tokens complete without timing-based assertions (constant-time is guaranteed by `crypto.timingSafeEqual`, not reliably testable in CI)
   - Run `verifier` filtered — expect pass

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings
