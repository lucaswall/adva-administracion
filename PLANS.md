# Implementation Plan

**Status:** COMPLETE

**Branch:** feat/ADV-144-movimientos-matching-fixes
**Issues:** ADV-144, ADV-145, ADV-146, ADV-147, ADV-148, ADV-149, ADV-150
**Created:** 2026-02-24
**Last Updated:** 2026-02-24

## Summary

Fix 4 bugs in bank movimientos matching (cross-bank deduplication, ARS tolerance inconsistency, USD cross-currency debit matching, force mode stale match clearing), optimize document lookup from O(N) to O(1), improve type safety by replacing `any` types, and fix documentation column order.

## Issues

### ADV-144: Cross-bank deduplication gap: same document matched to multiple bank movements

**Priority:** Medium
**Labels:** Bug
**Description:** `excludeFileIds` in `matchBankMovimientos` is built per-bank only. When processing multiple bank spreadsheets sequentially in `matchAllMovimientos`, there is no shared exclusion state — the same document can be matched to movements in different banks simultaneously.

**Acceptance Criteria:**
- [ ] `matchAllMovimientos` maintains a global `excludeFileIds` set shared across all bank spreadsheets
- [ ] When a document is matched in Bank A, it's excluded from matching in Bank B
- [ ] Existing tests pass; new tests verify cross-bank dedup
- [ ] MANUAL matches contribute to the global exclusion set

### ADV-145: Inconsistent ARS tolerance in credit movement matching

**Priority:** Medium
**Labels:** Bug
**Description:** In `matchCreditMovement`, ARS Facturas Emitidas are matched using `amountsMatch(amount, factura.importeTotal, this.crossCurrencyTolerancePercent)` which passes `5` as an absolute ARS tolerance ($5). Debit matching uses `amountsMatchCrossCurrency` which applies `$1` tolerance for ARS/ARS. The inconsistency means credit matching is more permissive than debit matching for the same currency.

**Acceptance Criteria:**
- [ ] Credit matching for ARS Facturas Emitidas uses consistent tolerance with debit matching ($1 ARS)
- [ ] Both lines 702 and 718 in `matchCreditMovement` are fixed
- [ ] Tests verify consistent tolerance across debit and credit matching

### ADV-146: Missing cross-currency matching for USD Pagos Enviados without importeEnPesos in debit matching

**Priority:** Medium
**Labels:** Bug
**Description:** In `matchMovement` (debit matching), when a USD Pago Enviado lacks `importeEnPesos`, the code falls back to `amountsMatch(pago.importePagado, amount)` which compares USD directly against ARS — always fails. Credit matching correctly uses `amountsMatchCrossCurrency` for this case.

**Acceptance Criteria:**
- [ ] Debit matching for USD Pagos Enviados uses `amountsMatchCrossCurrency` as fallback when `importeEnPesos` is not available
- [ ] Confidence is appropriately reduced for cross-currency pago matches
- [ ] Tests verify USD pagos without importeEnPesos can match ARS debit movements

### ADV-147: O(N) linear scan in findDocumentByFileId — use Map for O(1) lookup

**Priority:** Low
**Labels:** Performance
**Description:** `findDocumentByFileId` performs 5 sequential `.find()` calls across document arrays for each movement with an existing match. This is O(M*N) per bank. Replace with a pre-built `Map<string, {document, type}>` for O(1) lookups.

**Acceptance Criteria:**
- [ ] Build a `Map<string, {document, type}>` from all document arrays once before the matching loop
- [ ] Replace all `findDocumentByFileId` calls with Map.get()
- [ ] Also replace `buildMatchQualityFromFileId` to use the Map
- [ ] No change in matching behavior (pure performance optimization)

### ADV-148: Force mode doesn't clear stale AUTO matches when re-matching finds no match

**Priority:** Low
**Labels:** Bug
**Description:** When `matchAllMovimientos` runs with `force=true` and a previously-matched AUTO row now has no match, the old `matchedFileId`, `matchedType`, and `detalle` persist in the spreadsheet. The no-match branch (line 1051) only restores `ownFileId` to `excludeFileIds` without writing a clearing update.

**Acceptance Criteria:**
- [ ] In force mode, when a previously-matched AUTO row has no new match, push an update clearing `matchedFileId`, `matchedType`, and `detalle`
- [ ] MANUAL rows remain untouched (already skipped earlier in loop)
- [ ] Test verifies force mode clears stale AUTO matches

### ADV-149: SPREADSHEET_FORMAT.md shows wrong column order for Movimientos H/I

**Priority:** Low
**Labels:** Technical Debt
**Description:** SPREADSHEET_FORMAT.md line 266-267 shows H=detalle, I=matchedType. The actual code (`spreadsheet-headers.ts:238-239`, `movimientos-reader.ts:76-77`, `movimientos-detalle.ts:176`) consistently uses H=matchedType, I=detalle. CLAUDE.md also lists the wrong order.

**Acceptance Criteria:**
- [ ] SPREADSHEET_FORMAT.md updated to show H=matchedType, I=detalle
- [ ] CLAUDE.md updated to match the correct column order

### ADV-150: Type safety gap: `any` type in findDocumentByFileId and buildMatchQuality

**Priority:** Low
**Labels:** Convention
**Description:** `findDocumentByFileId` (line 661), `buildMatchQuality` (line 605), and `buildDetalleForDocument` (line 760) use `any` for document parameters. This bypasses TypeScript type checking for property access.

**Acceptance Criteria:**
- [ ] Replace `any` with a discriminated union type covering Factura, Pago, Recibo, Retencion (with `row` field)
- [ ] Use type narrowing based on the `type` discriminator in each function
- [ ] No runtime behavior changes

## Prerequisites

- [ ] All existing tests pass (verified via pre-flight)
- [ ] On `main` branch with clean working tree

## Implementation Tasks

### Task 1: Fix ARS tolerance inconsistency in credit matching

**Issue:** ADV-145
**Files:**
- `src/bank/matcher.ts` (modify)
- `src/bank/matcher.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/bank/matcher.test.ts`:
   - Test: ARS factura matched via credit matching uses $1 tolerance (amount diff of $2 should NOT match)
   - Test: ARS factura matched via credit matching with retenciones uses $1 tolerance
   - Reference existing credit matching tests to follow patterns
   - Run verifier with pattern "matcher" — expect fail

2. **GREEN** — Fix `src/bank/matcher.ts`:
   - Line 701-702: Replace `amountsMatch(amount, factura.importeTotal, this.crossCurrencyTolerancePercent)` with `amountsMatchCrossCurrency(factura.importeTotal, factura.moneda, factura.fechaEmision, amount, 'ARS', this.crossCurrencyTolerancePercent)` — this delegates to `amountsMatchCrossCurrency` which uses $1 for ARS/ARS (same pattern as debit matching at line 437-440)
   - Line 717-718: Same fix for the retenciones branch
   - Also update the `isCrossCurrency` variable logic: currently set before the match call (line 699), now the `amountsMatchCrossCurrency` result provides `isCrossCurrency`
   - Run verifier with pattern "matcher" — expect pass

**Notes:**
- `amountsMatchCrossCurrency` for ARS/ARS returns `{ matches: amountsMatch(a, b, 1), isCrossCurrency: false }` — see `src/utils/exchange-rate.ts:330-337`
- Debit matching already uses this unified pattern at line 437-440 — make credit matching consistent

### Task 2: Add cross-currency fallback for USD Pagos Enviados in debit matching

**Issue:** ADV-146
**Files:**
- `src/bank/matcher.ts` (modify)
- `src/bank/matcher.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/bank/matcher.test.ts`:
   - Test: USD Pago Enviado without `importeEnPesos` matches ARS bank debit via exchange rate conversion
   - Test: Confidence is reduced for cross-currency pago matches (consistent with credit matching behavior)
   - Test: USD Pago Enviado WITH `importeEnPesos` still uses direct ARS match (no regression)
   - Run verifier with pattern "matcher" — expect fail

2. **GREEN** — Fix `src/bank/matcher.ts`:
   - Lines 367-369: Replace the ternary with logic that mirrors credit matching (lines 599-610):
     - When `pago.importeEnPesos && pago.moneda === 'USD'`: use `amountsMatch(pago.importeEnPesos, amount)` (existing behavior)
     - When `pago.moneda === 'USD' && !pago.importeEnPesos`: use `amountsMatchCrossCurrency(pago.importePagado, pago.moneda, pago.fechaPago, amount, 'ARS', this.crossCurrencyTolerancePercent)`
     - Otherwise: use `amountsMatch(pago.importePagado, amount)` (ARS/ARS, existing behavior)
   - Track `isCrossCurrency` flag from the cross-currency result, and cap confidence for cross-currency pago matches (same caps as credit matching)
   - Run verifier with pattern "matcher" — expect pass

**Notes:**
- Cross-currency confidence caps per CLAUDE.md: Tier 1-3 → MEDIUM, Tier 4 → LOW, Tier 5 → LOW
- Follow the credit matching pattern at lines 599-610 as template
- Must handle the async exchange rate lookup (uses cached rates from prefetch)

### Task 3: Force mode clears stale AUTO matches

**Issue:** ADV-148
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/bank/match-movimientos.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/bank/match-movimientos.test.ts`:
   - Test: In force mode, a previously-matched AUTO row with no new match gets cleared (matchedFileId='', matchedType='', detalle='')
   - Test: In force mode, a previously-matched AUTO row that finds a new match still updates normally (regression guard)
   - Test: In non-force mode, a previously-matched row with no new match retains its existing match (no clearing)
   - Follow existing test patterns (mock matcher, ingresosData, egresosData)
   - Run verifier with pattern "match-movimientos" — expect fail

2. **GREEN** — Fix `src/bank/match-movimientos.ts`:
   - In the no-match else branch (around line 1051-1057): when `options.force` is true AND the movement had an existing match (`ownFileId` is set), push a clearing update with empty matchedFileId, matchedType, and detalle
   - When clearing in force mode, do NOT re-add `ownFileId` to `excludeFileIds` (the document is freed for other movements)
   - When NOT in force mode, keep existing behavior (re-add ownFileId to excludeFileIds)
   - Run verifier with pattern "match-movimientos" — expect pass

**Notes:**
- MANUAL rows are already skipped at line 860 with `continue`, so by line 1051 the row is guaranteed non-MANUAL
- `computeRowVersion(mov)` should be called for the expectedVersion of the clearing update

### Task 4: Map-based document lookup (performance)

**Issue:** ADV-147
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/bank/match-movimientos.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/bank/match-movimientos.test.ts`:
   - Test: Document Map is built correctly from all 5 document arrays, keyed by fileId
   - Test: Map lookup returns the same result as the old `findDocumentByFileId` linear scan
   - Test: Documents with duplicate fileIds across arrays (edge case) — first match wins (maintain existing behavior)
   - Run verifier with pattern "match-movimientos" — expect fail

2. **GREEN** — Implement in `src/bank/match-movimientos.ts`:
   - Create a `buildDocumentMap` function that takes the 5 document arrays and returns a `Map<string, { document: ..., type: string }>`
   - Iterate each array once, adding entries keyed by fileId. First-found wins (matching current `.find()` order: facturasEmitidas, pagosRecibidos, facturasRecibidas, pagosEnviados, recibos)
   - In `matchBankMovimientos`, call `buildDocumentMap` once before the loop
   - Replace all `findDocumentByFileId` calls with `documentMap.get(fileId)` — lines 863, 961 (used via buildMatchQualityFromFileId), and 875
   - Remove `findDocumentByFileId` function (or refactor it to delegate to the Map)
   - Refactor `buildMatchQualityFromFileId` to accept the Map instead of calling `findDocumentByFileId`
   - Run verifier with pattern "match-movimientos" — expect pass

**Notes:**
- Preserve the search order (facturasEmitidas first, recibos last) to maintain backward compatibility with which document type wins for a shared fileId
- The Map is passed down to `matchBankMovimientos` — created once for all movements in a bank
- For ADV-144 (Task 5), this Map becomes even more useful since the same Map is shared across banks

### Task 5: Cross-bank deduplication

**Issue:** ADV-144
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/bank/match-movimientos.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/bank/match-movimientos.test.ts`:
   - Test: Document matched in Bank A is excluded from matching in Bank B (call matchBankMovimientos twice with shared exclusion state)
   - Test: MANUAL matches from Bank A contribute to global exclusion for Bank B
   - Test: Newly matched documents from Bank A's processing are added to global exclusion
   - Run verifier with pattern "match-movimientos" — expect fail

2. **GREEN** — Implement in `src/bank/match-movimientos.ts`:
   - Add optional `globalExcludeFileIds?: Set<string>` parameter to `matchBankMovimientos`
   - In `matchBankMovimientos`: seed `excludeFileIds` from BOTH the bank's own movements AND `globalExcludeFileIds` (if provided)
   - After the matching loop (before returning), add all newly matched fileIds from this bank's `updates` to `globalExcludeFileIds`
   - In `matchAllMovimientos` (line 1138-1169): create a `globalExcludeFileIds = new Set<string>()` before the bank loop, pass it to each `matchBankMovimientos` call
   - Run verifier with pattern "match-movimientos" — expect pass

**Notes:**
- The global set grows across bank iterations: Bank A adds its matches, Bank B sees them + adds its own, Bank C sees all
- MANUAL matches from each bank also contribute since they're pre-seeded into per-bank excludeFileIds, which then feeds back to globalExcludeFileIds
- The document Map from Task 4 is shared across banks (same ingresosData/egresosData), so this is purely about the exclusion set

### Task 6: Type safety for `any` types in document functions

**Issue:** ADV-150
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/bank/match-movimientos.test.ts` (modify — may need type adjustments)

**TDD Steps:**

1. **RED** — This is a pure type-level refactor with no runtime behavior changes. Start by defining the discriminated union type:
   - In `src/bank/match-movimientos.ts`, define a type alias (e.g., `MatchedDocument`) as a union of the document types with `row: number` that are already used in practice
   - The discriminator is the `type` field returned by `findDocumentByFileId` / document Map: `'factura_emitida' | 'pago_recibido' | 'factura_recibida' | 'pago_enviado' | 'recibo'`
   - Run verifier — expect compile errors from the `any` → union type change

2. **GREEN** — Update the functions:
   - `buildMatchQuality` (line 605): change `document?: any` to `document?: MatchedDocument`, add type narrowing based on `type` parameter
   - Document Map return type: change `{ document: any; type: ... }` to `{ document: MatchedDocument; type: ... }`
   - `buildDetalleForDocument` (line 760): change `document: any` to `document: MatchedDocument`, use type narrowing for property access
   - Run verifier — expect pass (all existing tests should still work since runtime behavior is unchanged)

**Notes:**
- The union type needs `& { row: number }` on each variant since document arrays are typed with `row` field
- Follow the `MatchedDocument` approach from the issue description but use the actual types from `src/types/index.ts`
- The type narrowing should use `if/switch` on the `type` discriminator string to access type-specific properties

### Task 7: Fix documentation column order

**Issue:** ADV-149
**Files:**
- `SPREADSHEET_FORMAT.md` (modify)
- `CLAUDE.md` (modify)

**Steps:**

1. In `SPREADSHEET_FORMAT.md` line 266-267: swap H and I columns:
   - H: `matchedType` — Match type: `AUTO` (algorithmic), `MANUAL` (user-set), or empty (unmatched)
   - I: `detalle` — Human-readable match description

2. In `CLAUDE.md`: find the Movimientos Bancario description and update column order to: `matchedFileId` (fileId of matched document), `matchedType` (AUTO/MANUAL/empty), `detalle` (human-readable match description)

3. Run verifier — expect pass (no code changes)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to In Progress at task start, Review at completion |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| ARS credit match with $2 diff | Should NOT match (was matching before fix) | Unit test (Task 1) |
| USD pago without importeEnPesos vs ARS debit | Should match via exchange rate | Unit test (Task 2) |
| Force mode + no_match on existing AUTO | Should clear match cells | Unit test (Task 3) |
| Same fileId in Bank A and Bank B | Should only match once (first bank wins) | Unit test (Task 5) |

## Risks & Open Questions

- [ ] Task 1 (ADV-145): Fixing ARS tolerance from $5 to $1 might cause some existing credit matches to break in production — they would need force re-matching. Low risk since $5 ARS is tiny ($0.005 USD).
- [ ] Task 2 (ADV-146): Cross-currency pago matching depends on exchange rate cache being populated. The prefetch in matchAllMovimientos should cover this. Verify test mocking handles exchange rate correctly.
- [ ] Task 5 (ADV-144): Cross-bank dedup means processing ORDER of banks matters — first bank gets priority. This is acceptable since it mirrors the existing behavior within a single bank.
- [ ] Task 6 (ADV-150): The discriminated union must cover all document types that can appear in findDocumentByFileId. Missing a type would cause compile errors (which is the desired safety improvement).

## Scope Boundaries

**In Scope:**
- 4 bug fixes in matcher.ts and match-movimientos.ts
- 1 performance optimization (Map-based lookup)
- 1 type safety improvement
- 1 documentation fix

**Out of Scope:**
- Refactoring the matching algorithm itself
- Adding new matching tiers or patterns
- Changing the spreadsheet schema (no migration needed)
- UI/Apps Script changes

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Iteration 1

**Implemented:** 2026-02-24
**Method:** Agent team (2 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Fix ARS tolerance inconsistency in credit matching — `matchCreditMovement` now uses `amountsMatchCrossCurrency` for consistent $1 ARS tolerance (worker-1)
- Task 2: Add cross-currency fallback for USD Pagos Enviados in debit matching — mirrors credit matching pattern with confidence capping (worker-1)
- Task 3: Force mode clears stale AUTO matches — pushes empty update when no new match found in force mode (worker-1)
- Task 4: Map-based document lookup — `buildDocumentMap` replaces O(N) linear scans with O(1) Map lookups (worker-2)
- Task 5: Cross-bank deduplication — `globalExcludeFileIds` shared across all bank spreadsheets (worker-2)
- Task 6: Type safety for `any` types — `MatchedDocument` discriminated union replaces `any` in document functions (worker-2)
- Task 7: Fix documentation column order — SPREADSHEET_FORMAT.md and CLAUDE.md corrected to H=matchedType, I=detalle (lead)

### Files Modified
- `src/bank/matcher.ts` — ARS tolerance fix, USD pago cross-currency fallback
- `src/bank/matcher.test.ts` — Tests for Tasks 1 and 2
- `src/bank/match-movimientos.ts` — Map lookup, cross-bank dedup, type safety, force mode clearing, bug-hunter fixes
- `src/bank/match-movimientos.test.ts` — Tests for Tasks 3, 4, 5, 6
- `SPREADSHEET_FORMAT.md` — Column order fix (H=matchedType, I=detalle)
- `CLAUDE.md` — Column order fix

### Linear Updates
- ADV-144: Todo → In Progress → Review
- ADV-145: Todo → Review
- ADV-146: Todo → Review
- ADV-147: Todo → In Progress → Review
- ADV-148: Todo → Review
- ADV-149: Todo → Review
- ADV-150: Todo → Review

### Pre-commit Verification
- bug-hunter: Found 2 bugs (MEDIUM: cross-bank dedup bypass for pre-existing duplicates, LOW: noMatches overcounting in force mode), both fixed
- verifier: All 1843 tests pass, zero warnings

### Work Partition
- Worker 1: Tasks 1, 2, 3 (bug fixes domain — matcher.ts, match-movimientos.ts force mode)
- Worker 2: Tasks 4, 5, 6 (refactoring domain — Map lookup, dedup, type safety)
- Lead: Task 7 (documentation fix)

### Merge Summary
- Worker 2: fast-forward (no conflicts)
- Worker 1: auto-merged (no conflicts)

### Continuation Status
All tasks completed.

### Review Findings

Summary: 1 issue found, fixed inline (single-agent review)
- FIXED INLINE: 1 issue — verified via TDD + bug-hunter

**Issues fixed inline:**
- [LOW] BUG: Credit pago_only confidence hardcoded to 'MEDIUM' (`src/bank/matcher.ts:691`) — changed to `tierToConfidence(tier, amountOk.isCrossCurrency)` for consistency with debit matching + test

**Discarded findings (not bugs):**
- [DISCARDED] noMatches counter in force-mode clear path — intentionally not incremented per earlier bug-hunter fix that addressed overcounting
- [DISCARDED] Global exclusion propagation for zero-amount rows — correct by design; cross-bank dedup should prevent document reuse across banks
- [DISCARDED] Exhaustive type check in buildDetalleForDocument — style-only future-proofing, zero correctness impact today

### Linear Updates
- ADV-144: Review → Merge
- ADV-145: Review → Merge
- ADV-146: Review → Merge
- ADV-147: Review → Merge
- ADV-148: Review → Merge
- ADV-149: Review → Merge
- ADV-150: Review → Merge
- ADV-151: Created in Merge (Fix: credit pago_only confidence — fixed inline)

### Inline Fix Verification
- Unit tests: all 1845 pass
- Bug-hunter: no new issues in inline fix

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
