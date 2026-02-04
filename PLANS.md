# Implementation Plan

**Created:** 2026-02-03
**Source:** Inline request: Implement the MATCHING.md bank movimientos matching algorithm — full rewrite of matcher.ts with tier-based ranking, hard identity filters, referencia extraction, expanded date windows, and cleanup of unused code/tests.
**Linear Issues:** [ADV-66](https://linear.app/adva-administracion/issue/ADV-66/add-bankmatchtier-type-and-extractreferencia-function), [ADV-67](https://linear.app/adva-administracion/issue/ADV-67/update-credit-card-payment-pattern-to-match-card-type-names), [ADV-68](https://linear.app/adva-administracion/issue/ADV-68/update-pago-date-window-from-±1-to-±15-days), [ADV-69](https://linear.app/adva-administracion/issue/ADV-69/rewrite-bankmovementmatcher-with-tier-based-algorithm), [ADV-70](https://linear.app/adva-administracion/issue/ADV-70/update-matchquality-and-isbettermatch-for-tier-based-comparison), [ADV-71](https://linear.app/adva-administracion/issue/ADV-71/simplify-bankmovement-→-use-movimientorow-directly), [ADV-72](https://linear.app/adva-administracion/issue/ADV-72/delete-autofillts-and-remove-apiautofill-bank-route), [ADV-73](https://linear.app/adva-administracion/issue/ADV-73/update-description-formats-per-matchingmd-phase-6), [ADV-74](https://linear.app/adva-administracion/issue/ADV-74/final-cleanup-and-documentation-for-matching-rewrite)

## Context Gathered

### Codebase Analysis

**Current implementation (to be rewritten):**
- `src/bank/matcher.ts` (1,291 lines) — `BankMovementMatcher` class with flat priority chain + confidence levels
- `src/bank/match-movimientos.ts` (1,056 lines) — Orchestration with confidence-based replacement logic
- `src/bank/autofill.ts` (320 lines) — Legacy auto-fill, superseded by `match-movimientos.ts`
- `src/bank/autofill.test.ts` (234 lines) — Tests for legacy autofill

**Key gaps between current and MATCHING.md:**
1. No tier-based ranking system (current uses flat priority + confidence)
2. CUIT is a ranking bonus, not a hard filter
3. No referencia extraction from `ORDEN DE PAGO` patterns
4. Pago date window is ±1 day (MATCHING.md: ±15 days)
5. Credit card pattern only matches digits, not card type names
6. Keyword matching gated to direct debits only (MATCHING.md: all movements)
7. Factura matching requires CUIT or keyword (MATCHING.md: amount+date sufficient at Tier 5)
8. Pagos Recibidos use `amountsMatch()` not cross-currency
9. `compareMatches()` on class is legacy, unused by orchestration
10. Cross-currency confidence caps differ from MATCHING.md tier definitions
11. `BankMovement` has 10 fields but `MovimientoRow` only has 8 (adapter fills dummy values)

**Files to keep unchanged:**
- `src/utils/exchange-rate.ts` — Reusable cross-currency logic
- `src/services/movimientos-reader.ts` — Sheet reading
- `src/services/movimientos-detalle.ts` — TOCTOU-protected writes
- `src/matching/` — Separate system (document-to-document)
- `src/processing/matching/` — Separate system

**Files to delete:**
- `src/bank/autofill.ts` — Legacy, superseded by `match-movimientos.ts`
- `src/bank/autofill.test.ts` — Tests for legacy code

**Files to update (cleanup):**
- `src/routes/scan.ts` — Remove `/api/autofill-bank` route and `autoFillBankMovements` import
- `src/routes/scan.test.ts` — Remove autofill-bank tests
- `src/types/index.ts` — Remove `BankAutoFillResult`, update `BankMovement` and `BankMovementMatchResult`, add `BankMatchTier`

**Existing test patterns:**
- `src/bank/matcher.test.ts` (1,167 lines) — Will be largely rewritten for new algorithm
- `src/bank/match-movimientos.test.ts` (1,884 lines) — `isBetterMatch` tests need updating for tier-based comparison

### MCP Context
- **MCPs used:** Linear (issue creation)

## Original Plan

### Task 1: Add BankMatchTier type and extractReferencia function
**Linear Issue:** [ADV-66](https://linear.app/adva-administracion/issue/ADV-66/add-bankmatchtier-type-and-extractreferencia-function)

Add the tier type and referencia extraction that the new algorithm depends on.

1. Write tests in `src/bank/matcher.test.ts`:
   - Test `extractReferencia("ORDEN DE PAGO DEL EXTERIOR 4083953.01.8584")` returns `"4083953"`
   - Test `extractReferencia("ORDEN DE PAGO 1234567.02.1234")` returns `"1234567"`
   - Test `extractReferencia("TRANSFERENCIA RECIBIDA")` returns `undefined` (no match)
   - Test `extractReferencia("PAGO 123456")` returns `undefined` (6 digits, not 7)
   - Test `extractReferencia("")` returns `undefined`
2. Run verifier (expect fail)
3. Add to `src/types/index.ts`:
   - `export type BankMatchTier = 1 | 2 | 3 | 4 | 5;`
   - Add `tier?: BankMatchTier` to `BankMovementMatchResult`
4. Implement `extractReferencia(concepto: string): string | undefined` in `src/bank/matcher.ts`:
   - Pattern: `/(\d{7})\.\d{2}\.\d{4}/` — extract the 7-digit portion from ORDEN DE PAGO format
5. Run verifier (expect pass)

### Task 2: Update credit card payment pattern
**Linear Issue:** [ADV-67](https://linear.app/adva-administracion/issue/ADV-67/update-credit-card-payment-pattern-to-match-card-type-names)

Expand `CREDIT_CARD_PAYMENT_PATTERNS` to also match card type names per MATCHING.md.

1. Write tests in `src/bank/matcher.test.ts`:
   - Test `isCreditCardPayment("PAGO TARJETA VISA EMPRESA")` returns `true`
   - Test `isCreditCardPayment("PAGO TARJETA MASTERCARD")` returns `true`
   - Test `isCreditCardPayment("PAGO TARJETA 4563")` returns `true` (existing behavior preserved)
   - Test `isCreditCardPayment("PAGO TARJETA")` returns `false` (bare phrase, no identifier)
   - Test `isCreditCardPayment("PAGO RECIBIDO")` returns `false`
2. Run verifier (expect fail for new patterns)
3. Update `CREDIT_CARD_PAYMENT_PATTERNS` in `src/bank/matcher.ts`:
   - Add pattern: `/^PAGO TARJETA\s+(?:VISA|MASTERCARD|AMEX|NARANJA|CABAL)\b/i`
   - Keep existing: `/^PAGO TARJETA\s+\d+/i`
4. Run verifier (expect pass)

### Task 3: Update date window constants
**Linear Issue:** [ADV-68](https://linear.app/adva-administracion/issue/ADV-68/update-pago-date-window-from-±1-to-±15-days)

Change pago date window from ±1 to ±15 days per MATCHING.md.

1. Write tests in `src/bank/matcher.test.ts`:
   - Test that a pago 10 days before bank date is matched (currently rejected at ±1)
   - Test that a pago 15 days after bank date is matched
   - Test that a pago 16 days after bank date is NOT matched
2. Run verifier (expect fail)
3. Update `src/bank/matcher.ts`:
   - Change `PAGO_DATE_RANGE = 1` to `PAGO_DATE_RANGE = 15`
4. Run verifier (expect pass)

### Task 4: Rewrite BankMovementMatcher with tier-based algorithm
**Linear Issue:** [ADV-69](https://linear.app/adva-administracion/issue/ADV-69/rewrite-bankmovementmatcher-with-tier-based-algorithm)

This is the core rewrite. Replace the flat priority chain in `matchMovement()` and `matchCreditMovement()` with the 6-phase algorithm from MATCHING.md.

1. Write tests in `src/bank/matcher.test.ts` for the new algorithm. Rewrite/replace existing tests that conflict with the new behavior:
   - **Phase 0 (auto-detect):** Bank fee and credit card patterns — preserve existing tests
   - **Phase 1 (identity extraction):** Test CUIT extraction, referencia extraction, name token extraction — preserve and extend existing tests
   - **Phase 2 (pool selection):** Debit→Egresos, Credit→Ingresos — already handled by orchestration
   - **Phase 3 (candidate gathering with hard filters):**
     - Test: CUIT in concepto → only documents with matching CUIT considered → no fallthrough to unfiltered
     - Test: CUIT in concepto, no matching document → NO MATCH (not a lower-tier match)
     - Test: Referencia in concepto → only Pagos Recibidos with matching referencia → no fallthrough
     - Test: No identity → all documents in pool considered
     - Test: Amount+date within pago window (±15 days) finds pago candidates
     - Test: Amount+date within factura window (-5/+30 days) finds factura candidates
     - Test: Cross-currency matching works for Pagos Recibidos (currently uses simple tolerance)
   - **Phase 4 (tier ranking):**
     - Test: Tier 1 (Pago+Factura) beats Tier 2 (CUIT match) regardless of date distance
     - Test: Tier 2 (CUIT match) beats Tier 4 (name match) regardless of date
     - Test: Tier 4 (name score ≥ 2) beats Tier 5 (amount+date only)
     - Test: Within same tier, closer date wins
     - Test: Within same tier and date, exact amount beats tolerance
     - Test: Tier 5 — factura matched by amount+date only (no CUIT/keyword required)
     - Test: Cross-currency Tier 1-3 remain HIGH confidence
     - Test: Cross-currency Tier 4 remains MEDIUM
     - Test: Cross-currency Tier 5 remains LOW
   - **Keyword matching scope:**
     - Test: Name token matching applies to ALL movements (not just direct debits)
     - Test: Name tokens match against entity name and concepto field
2. Run verifier (expect fail)
3. Rewrite `matchMovement()` in `src/bank/matcher.ts`:
   - Phase 0: Bank fee / credit card auto-detect (keep as-is)
   - Phase 1: Extract identity (CUIT, referencia, name tokens) from `concepto`
   - Phase 3: Gather candidates with hard filters:
     - If CUIT extracted → filter documents to matching CUIT only, search all doc types in date windows
     - If referencia extracted → filter to Pagos with matching `referencia` only
     - If neither → search all documents, no filter
   - Phase 4: Score each candidate with tier:
     - Tier 1: Pago with linked Factura
     - Tier 2: CUIT match from concepto
     - Tier 3: Referencia match
     - Tier 4: Name token score ≥ 2
     - Tier 5: Amount + date only
   - Sort candidates by tier (lower wins), then date distance, then exact amount
   - Return best candidate, or no_match if empty
4. Rewrite `matchCreditMovement()` following the same pattern:
   - Same phases, but pool is Ingresos (Facturas Emitidas, Pagos Recibidos, Retenciones)
   - Retenciones adjustment: if direct amount fails, try `bank_credit + retenciones ≈ factura`
   - Cross-currency for Pagos Recibidos: use `amountsMatchCrossCurrency()` instead of `amountsMatch()`
5. Remove `compareMatches()` method (unused by orchestration)
6. Remove `findMatchingPagos()`, `findMatchingFacturas()`, `findMatchingRecibos()`, `findMatchingPagosRecibidos()`, `findMatchingFacturasEmitidas()` private methods (replaced by unified gathering)
7. Simplify: remove `fechaValor` from matching logic — `MovimientoRow` doesn't have it, adapter fills it with `fecha`. Use only `fecha`.
8. Run verifier (expect pass)

### Task 5: Update BankMovementMatchResult and replacement logic for tiers
**Linear Issue:** [ADV-70](https://linear.app/adva-administracion/issue/ADV-70/update-matchquality-and-isbettermatch-for-tier-based-comparison)

Update `MatchQuality` and `isBetterMatch` in `match-movimientos.ts` to use tiers instead of confidence+CUIT.

1. Write tests in `src/bank/match-movimientos.test.ts`:
   - Rewrite `isBetterMatch` tests for the new algorithm:
     - Test: Lower tier always wins (Tier 1 beats Tier 3 even with worse date)
     - Test: Same tier, closer date wins
     - Test: Same tier, same date, exact amount beats tolerance
     - Test: Equal → keep existing (no churn)
   - Remove hasCuitMatch and hasLinkedPago from quality comparison tests
2. Run verifier (expect fail)
3. Update `src/bank/matcher.ts`:
   - Update `MatchQuality` interface: replace `hasCuitMatch` + `hasLinkedPago` with `tier: BankMatchTier`
4. Update `src/bank/match-movimientos.ts`:
   - Update `isBetterMatch()`: compare `tier` first (lower tier wins), then `dateDistance`, then `isExactAmount`, then keep existing
   - Update `buildMatchQuality()` and `buildMatchQualityFromFileId()` to compute tier from document type and match context
   - Remove `CONFIDENCE_RANK` (confidence no longer used for comparison — tier replaces it)
5. Run verifier (expect pass)

### Task 6: Simplify BankMovement → use MovimientoRow directly
**Linear Issue:** [ADV-71](https://linear.app/adva-administracion/issue/ADV-71/simplify-bankmovement-→-use-movimientorow-directly)

The `BankMovement` interface has dummy fields (`fechaValor`, `codigo`, `oficina`, `areaAdva`) that are only populated by `autofill.ts` (being deleted). Simplify the matcher to work with `MovimientoRow` directly.

1. Write tests: update test helpers in `src/bank/matcher.test.ts` to use `MovimientoRow` shape instead of `BankMovement`
2. Run verifier (expect fail)
3. Update `src/bank/matcher.ts`:
   - Change `matchMovement()` and `matchCreditMovement()` signatures to accept `MovimientoRow` instead of `BankMovement`
   - Remove references to `fechaValor`, `codigo`, `oficina`, `areaAdva`
   - Update `createBankFeeMatch()`, `createCreditCardPaymentMatch()`, `noMatch()`, etc. to work with `MovimientoRow`
   - Update `BankMovementMatchResult.movement` type from `BankMovement` to `MovimientoRow`
4. Update `src/bank/match-movimientos.ts`:
   - Remove `movimientoRowToBankMovement()` conversion function
   - Pass `MovimientoRow` directly to matcher
5. Update `src/types/index.ts`:
   - Update `BankMovementMatchResult.movement` type to `MovimientoRow`
6. Run verifier (expect pass)

### Task 7: Delete autofill.ts and remove /api/autofill-bank route
**Linear Issue:** [ADV-72](https://linear.app/adva-administracion/issue/ADV-72/delete-autofillts-and-remove-apiautofill-bank-route)

Remove legacy code that is fully superseded by `match-movimientos.ts`.

1. Write tests: verify no remaining imports of autofill — `grep` for `autofill` across codebase
2. Run verifier (confirm current state passes)
3. Delete files:
   - `src/bank/autofill.ts`
   - `src/bank/autofill.test.ts`
4. Update `src/routes/scan.ts`:
   - Remove `import { autoFillBankMovements } from '../bank/autofill.js'`
   - Remove `import type { BankAutoFillResult } from '../types/index.js'` (if only used for autofill)
   - Remove `AutofillRequest` interface
   - Remove `POST /api/autofill-bank` route handler
5. Update `src/routes/scan.test.ts`:
   - Remove `vi.mock('../bank/autofill.js', ...)` mock
   - Remove `POST /api/autofill-bank` test describe block
6. Update `src/types/index.ts`:
   - Remove `BankAutoFillResult` interface
   - Remove `BankMovement` interface (no longer used — matcher now uses `MovimientoRow`)
7. Update `CLAUDE.md`:
   - Remove `/api/autofill-bank` from API ENDPOINTS table
8. Run verifier (expect pass)

### Task 8: Update description formats per MATCHING.md
**Linear Issue:** [ADV-73](https://linear.app/adva-administracion/issue/ADV-73/update-description-formats-per-matchingmd-phase-6)

Update the description format strings to match MATCHING.md Phase 6 specifications.

1. Write tests in `src/bank/matcher.test.ts`:
   - Test debit Pago→Factura: `"Pago Factura a {razonSocial} - {concepto}"`
   - Test debit Direct Factura: `"Pago Factura a {razonSocial} - {concepto}"`
   - Test debit Recibo: `"Sueldo {periodo} - {nombreEmpleado}"`
   - Test debit Pago-only: `"REVISAR! Pago a {nombre} {cuit} ({concepto})"`
   - Test credit Pago→Factura: `"Cobro Factura de {razonSocial} - {concepto}"`
   - Test credit Direct Factura: `"Cobro Factura de {razonSocial} - {concepto}"`
   - Test credit Pago-only: `"REVISAR! Cobro de {nombre}"`
   - Verify existing format strings match (most already correct, validate completeness)
2. Run verifier (expect pass — verify existing formats are correct, fix any that differ)
3. If any formats differ from MATCHING.md, fix in `src/bank/matcher.ts`
4. Run verifier (expect pass)

### Task 9: Final cleanup and documentation
**Linear Issue:** [ADV-74](https://linear.app/adva-administracion/issue/ADV-74/final-cleanup-and-documentation-for-matching-rewrite)

Clean up any dead code, update documentation.

1. Search for dead code:
   - Grep for unused imports across `src/bank/`
   - Check for unused type exports in `src/types/index.ts`
   - Check for any remaining references to deleted files/functions
2. Update `CLAUDE.md`:
   - Update MATCHING section if any algorithm constants are new
   - Ensure API ENDPOINTS reflects removal of autofill-bank
   - Update STRUCTURE to remove autofill.ts
3. Run verifier (expect pass — all tests pass, zero warnings)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Rewrite bank movimientos matching algorithm per MATCHING.md — tier-based ranking, hard identity filters, referencia extraction, expanded date windows, and cleanup of unused legacy code.

**Request:** Implement the full MATCHING.md algorithm, adapt the codebase as needed, and clean up unused code and tests left behind.

**Linear Issues:** [ADV-66](https://linear.app/adva-administracion/issue/ADV-66/add-bankmatchtier-type-and-extractreferencia-function), [ADV-67](https://linear.app/adva-administracion/issue/ADV-67/update-credit-card-payment-pattern-to-match-card-type-names), [ADV-68](https://linear.app/adva-administracion/issue/ADV-68/update-pago-date-window-from-±1-to-±15-days), [ADV-69](https://linear.app/adva-administracion/issue/ADV-69/rewrite-bankmovementmatcher-with-tier-based-algorithm), [ADV-70](https://linear.app/adva-administracion/issue/ADV-70/update-matchquality-and-isbettermatch-for-tier-based-comparison), [ADV-71](https://linear.app/adva-administracion/issue/ADV-71/simplify-bankmovement-→-use-movimientorow-directly), [ADV-72](https://linear.app/adva-administracion/issue/ADV-72/delete-autofillts-and-remove-apiautofill-bank-route), [ADV-73](https://linear.app/adva-administracion/issue/ADV-73/update-description-formats-per-matchingmd-phase-6), [ADV-74](https://linear.app/adva-administracion/issue/ADV-74/final-cleanup-and-documentation-for-matching-rewrite)

**Approach:**
- Incrementally build new capabilities (referencia extraction, expanded patterns, date windows) before the core rewrite to keep tasks self-contained
- Rewrite the matching core (Task 4) as a single task since the phases are tightly coupled
- Update the replacement/comparison logic (Task 5) after the matcher produces tier information
- Simplify types by removing `BankMovement` adapter and working with `MovimientoRow` directly
- Delete legacy `autofill.ts` and its route after all matcher changes are complete
- Final cleanup pass for dead code and documentation

**Scope:**
- Tasks: 9
- Files affected: ~12 source files + ~5 test files + CLAUDE.md
- New tests: yes (extensive rewrite of matcher.test.ts, updates to match-movimientos.test.ts)

**Key Decisions:**
- `BankMovement` interface is eliminated — matcher works directly with `MovimientoRow`, removing the adapter layer
- `autofill.ts` and `/api/autofill-bank` route are deleted entirely (superseded by `match-movimientos.ts`)
- Tier replaces confidence+CUIT+linkedPago in `MatchQuality` for comparison — simpler and matches MATCHING.md
- `fechaValor` is dropped from matching (was always a copy of `fecha` in MovimientoRow path)
- CUIT hard filter means if CUIT is found in concepto but no document matches, result is NO MATCH (not a lower-tier fallthrough)
- Cross-currency for Pagos Recibidos upgraded from `amountsMatch()` to `amountsMatchCrossCurrency()`

**Risks/Considerations:**
- Task 4 (core rewrite) is large — it replaces most of the matcher logic. Tests must be thorough to avoid regressions.
- Hard CUIT filter is a behavior change — movements that previously matched a wrong CUIT document will now show no match. This is intentional per MATCHING.md.
- Removing `/api/autofill-bank` is a breaking API change — verify no external clients depend on it.
- Existing spreadsheet data with matches won't be affected (match-movimientos only updates when `isBetterMatch` or force mode).

## Implementation Complete

**Status:** ALL 9 TASKS COMPLETE
**Date:** 2026-02-03

### Tasks Completed
1. **ADV-66** — Added BankMatchTier type and extractReferencia function
2. **ADV-67** — Updated credit card payment pattern to match card type names
3. **ADV-68** — Updated pago date window from ±1 to ±15 days
4. **ADV-69** — Rewrote BankMovementMatcher with tier-based algorithm
5. **ADV-70** — Updated MatchQuality and isBetterMatch for tier-based comparison
6. **ADV-71** — Simplified BankMovement → uses MovimientoRow directly
7. **ADV-72** — Deleted autofill.ts and removed /api/autofill-bank route
8. **ADV-73** — Verified description formats match MATCHING.md Phase 6
9. **ADV-74** — Final cleanup and documentation

### Bug Fixes from Post-Implementation Review
- Added Tier 3 referencia matching to debit side (was extracted but not used)
- Added keyword matching (Tier 4) to credit side for Facturas Emitidas
- Fixed stale JSDoc comments (PAGO_DATE_RANGE, tierToConfidence)

### Known Limitations
- `buildMatchQuality()` in match-movimientos.ts cannot reconstruct Tier 3/4 — existing matches are approximated as Tier 2 or 5 for replacement comparison
- Recibos use Tier 5 + HIGH confidence (intentional: salary payments are reliable matches even without CUIT)

### Review Findings

Files reviewed: 7 source files + 3 test files
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Edge Cases, Conventions

Summary: 1 issue found
- MEDIUM: 1

**Documented (no fix required for merge):**
- [MEDIUM] DEAD CODE: `triggerAutofillBank()` in `apps-script/src/main.ts:70-73` still calls deleted `/api/autofill-bank` endpoint. `README.md` and `DEVELOPMENT.md` also reference it. Users clicking the Dashboard menu item will get a 404 error.

**No CRITICAL or HIGH issues found.** The core implementation (matcher, orchestration, types, routes, tests) is correct and follows all project conventions.

### Linear Updates
- ADV-66: Review → Merge
- ADV-67: Review → Merge
- ADV-68: Review → Merge
- ADV-69: Review → Merge
- ADV-70: Review → Merge
- ADV-71: Review → Merge
- ADV-72: Review → Merge
- ADV-73: Review → Merge
- ADV-74: Review → Merge
- ADV-75: Created in Todo (Fix: dead triggerAutofillBank + docs cleanup)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Implementation
**Linear Issues:** [ADV-75](https://linear.app/adva-administracion/issue/ADV-75/remove-dead-triggerautofillbank-from-apps-script-and-update-docs)

### Fix 1: Remove dead triggerAutofillBank() and update docs
**Linear Issue:** [ADV-75](https://linear.app/adva-administracion/issue/ADV-75/remove-dead-triggerautofillbank-from-apps-script-and-update-docs)

1. Delete `triggerAutofillBank()` function from `apps-script/src/main.ts`
2. Remove `/api/autofill-bank` references from `README.md`
3. Remove autofill reference from `DEVELOPMENT.md:126`
4. Run verifier (expect pass)

---

## Iteration 1 (Fix Plan)

**Implemented:** 2026-02-03

### Tasks Completed This Iteration
- Fix 1: Remove dead triggerAutofillBank() and update docs — Deleted function and menu item from apps-script/src/main.ts, removed all /api/autofill-bank references from README.md and DEVELOPMENT.md, updated docs to reference /api/match-movimientos instead

### Bug Fix (Pre-existing)
- Fixed HIGH bug in match-movimientos.ts: quality comparison guard `if (fechaDocumento && cuitDocumento)` silently dropped better matches when document had no CUIT (empty string is falsy). Changed to `if (fechaDocumento)` since buildMatchQuality already handles empty cuitDocumento correctly.

### Files Modified
- `apps-script/src/main.ts` — Removed triggerAutofillBank() function and menu item
- `README.md` — Replaced autofill-bank references with match-movimientos, removed maintenance task
- `DEVELOPMENT.md` — Updated project structure (removed autofill.ts, added match-movimientos.ts), updated route comment and module description
- `src/bank/match-movimientos.ts` — Fixed guard condition on line 826

### Linear Updates
- ADV-75: Todo → In Progress → Review
- ADV-76: Created in Review (pre-existing bug fix)

### Pre-commit Verification
- bug-hunter: Found 1 HIGH bug (pre-existing), fixed before proceeding
- verifier: All 1580 tests pass, zero warnings

### Review Findings

Files reviewed: 4 (apps-script/src/main.ts, README.md, DEVELOPMENT.md, src/bank/match-movimientos.ts)
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Edge Cases, Conventions

No issues found — all implementations are correct and follow project conventions.

Verification:
- `triggerAutofillBank()` fully removed from Apps Script, replaced with `triggerMatchMovimientos()`
- All `/api/autofill-bank` references removed from README.md and DEVELOPMENT.md
- No remaining autofill references in `src/`, `apps-script/`, or documentation files
- Bug fix in `match-movimientos.ts:826` is correct: `buildMatchQuality` handles empty `cuitDocumento` by setting `hasCuitMatch = false`, so the guard only needs `fechaDocumento`

### Linear Updates
- ADV-75: Review → Merge
- ADV-76: Review → Merge

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
Ready for PR creation.
