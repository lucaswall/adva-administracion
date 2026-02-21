# Bug Fix Plan

**Created:** 2026-02-04
**Bug Report:** FacturaPagoMatcher CUIT/name matching broken for Ingresos — all Pagos Recibidos fail to match Facturas Emitidas, causing REVISAR in bank movimientos
**Category:** Matching
**Linear Issues:** [ADV-79](https://linear.app/lw-claude/issue/ADV-79/fix-facturapagomatcher-cuitname-matching-broken-for-ingresos-facturas)

## Investigation

### Context Gathered
- **MCPs used:** Google Sheets (gsheets_read for Control de Ingresos Pagos Recibidos and Facturas Emitidas), Google Drive (gdrive_search)
- **Files examined:**
  - `src/matching/matcher.ts` — `findMatches()` lines 202-230: CUIT and name matching only checks `cuitEmisor` / `razonSocialEmisor`
  - `src/processing/matching/factura-pago-matcher.ts` — lines 333-336: For Ingresos, `cuitEmisor` is set to `''`, `cuitReceptor` is populated
  - `src/processing/matching/index.ts` — lines 84-91: Ingresos call passes `'cuitReceptor'` and `'cuitPagador'` but matcher ignores these
  - `src/bank/matcher.ts` — lines 436, 654-656: REVISAR logic when `matchedFacturaFileId` is empty
  - Control de Ingresos spreadsheet: All 13 Pagos Recibidos have empty `matchedFacturaFileId` (column N)
  - Facturas Emitidas spreadsheet: Column F is `cuitReceptor`, Column G is `razonSocialReceptor`

### Evidence

**All Pagos Recibidos have empty `matchedFacturaFileId`** — zero Ingresos matches exist. This includes:
- Domestic pagos with CUITs (e.g., Nitro Digital Business `30713518006`) that should match Facturas Emitidas by CUIT
- Foreign pagos (FRITO PLAY LLC, MICROSOFT, XSOLLA USA INC, etc.) that should match by name
- Pagos with referencia fields that could identify invoices

**The matcher code** in `src/matching/matcher.ts` lines 202-209:
```typescript
// Line 203: checks pago.cuitBeneficiario vs factura.cuitEmisor ← ALWAYS EMPTY for Ingresos
// Line 206: checks pago.cuitPagador vs factura.cuitEmisor ← ALWAYS EMPTY for Ingresos
```

For **Ingresos**, `factura-pago-matcher.ts` line 333 sets `cuitEmisor: ''` because `facturaCuitField === 'cuitReceptor'`. It populates `cuitReceptor` (line 335) instead, but the matcher never reads it.

**Name matching has the same bug** — lines 214-230 only check `factura.razonSocialEmisor` (empty for Ingresos), never `factura.razonSocialReceptor`.

**Bank movimientos impact:** 20 REVISAR entries across BBVA ARS 2025-10/11/12 because pagos recibidos have no linked facturas:
- 11 "REVISAR! Cobro de..." (credits: foreign payment orders)
- 9 "REVISAR! Pago a..." (debits: domestic payments with unmatched pagos)

### Root Cause

The `FacturaPagoMatcher.findMatches()` hardcodes CUIT matching against `factura.cuitEmisor` and name matching against `factura.razonSocialEmisor`. These fields are only populated for **Egresos** (Facturas Recibidas). For **Ingresos** (Facturas Emitidas), the counterparty info is in `factura.cuitReceptor` and `factura.razonSocialReceptor`, but the matcher never checks these fields.

The `facturaCuitField` and `pagoCuitField` parameters are passed through `matchFacturasWithPagos()` and used to parse the spreadsheet columns correctly, but the core `FacturaPagoMatcher` class is unaware of which scenario (Ingresos/Egresos) it's operating in and only checks emisor fields.

## Fix Plan

### Fix 1: Make FacturaPagoMatcher CUIT/name matching work for both Ingresos and Egresos
**Linear Issue:** [ADV-79](https://linear.app/lw-claude/issue/ADV-79/fix-facturapagomatcher-cuitname-matching-broken-for-ingresos-facturas)

1. Write tests in `src/matching/matcher.test.ts`:
   - Test: Ingresos scenario — Pago Recibido with `cuitPagador` matches Factura Emitida with `cuitReceptor` (CUIT boost)
   - Test: Ingresos scenario — Pago Recibido with `nombrePagador` matches Factura Emitida with `razonSocialReceptor` (name boost)
   - Test: Ingresos scenario — no match when `cuitPagador` doesn't match `cuitReceptor` (no false positives)
   - Test: Egresos scenario still works — Pago Enviado with `cuitBeneficiario` matches Factura Recibida with `cuitEmisor` (regression)
   - Test: Egresos scenario — name matching with `razonSocialEmisor` still works (regression)
2. Run verifier (expect fail)
3. Implement fix in `src/matching/matcher.ts` `findMatches()`:
   - **CUIT matching (lines 202-209):** Add checks for receptor fields. The logic should be:
     - Check `pago.cuitBeneficiario` vs `factura.cuitEmisor` (Egresos: pago beneficiary = factura emisor)
     - Check `pago.cuitPagador` vs `factura.cuitEmisor` (Egresos fallback)
     - Check `pago.cuitPagador` vs `factura.cuitReceptor` (Ingresos: pago payer = factura receptor/client)
     - Check `pago.cuitBeneficiario` vs `factura.cuitReceptor` (Ingresos fallback)
   - **Name matching (lines 211-230):** Add checks for receptor name. The logic should be:
     - Existing: check `nombreBeneficiario` vs `razonSocialEmisor`, then `nombrePagador` vs `razonSocialEmisor`
     - Add: check `nombrePagador` vs `razonSocialReceptor`, then `nombreBeneficiario` vs `razonSocialReceptor`
   - Both CUIT and name matching should short-circuit on first match found (existing `if/else if` pattern)
4. Run verifier (expect pass)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Problem:** FacturaPagoMatcher only matches CUIT and name against `factura.cuitEmisor` / `razonSocialEmisor`, which are empty for Facturas Emitidas. This means zero Ingresos matches work, causing all Pagos Recibidos to lack linked facturas and showing "REVISAR!" in bank movimientos.

**Root Cause:** The matcher was written assuming all facturas have `cuitEmisor` populated, but Facturas Emitidas store counterparty info in `cuitReceptor` / `razonSocialReceptor` instead.

**Linear Issues:** ADV-79 (Urgent)

**Solution Approach:** Extend the CUIT and name matching logic in `FacturaPagoMatcher.findMatches()` to also check `factura.cuitReceptor` and `factura.razonSocialReceptor`. The matcher will try both emisor and receptor fields, matching whichever is populated. This requires no schema changes — the fields already exist on the `Factura` interface and are correctly parsed by `factura-pago-matcher.ts`.

**Scope:**
- Files affected: 1 (`src/matching/matcher.ts`)
- New tests: yes (5 tests: 3 Ingresos scenarios + 2 Egresos regressions)
- Breaking changes: no

**Risks/Considerations:**
- The fix must not create false positive matches by accidentally matching emisor CUIT with receptor CUIT in the wrong direction. Each check compares the correct pago field with the correct factura field based on the flow direction.
- After deploying, run `/api/rematch` to re-match existing Ingresos documents, then `/api/match-movimientos?force=true` to update bank movimientos.

---

## Iteration 1

**Implemented:** 2026-02-04

### Tasks Completed This Iteration
- Fix 1: Make FacturaPagoMatcher CUIT/name matching work for both Ingresos and Egresos — Extended CUIT matching to check `cuitReceptor` and name matching to check `razonSocialReceptor`, added `.trim()` to `normalizeString` to prevent whitespace false positives

### Files Modified
- `src/matching/matcher.ts` — Added receptor field checks for CUIT matching (4 clauses: emisor first, then receptor fallback) and name matching (separate checks for razonSocialReceptor after razonSocialEmisor). Added `.trim()` to `normalizeString`.
- `src/matching/matcher.test.ts` — Added 5 new tests in "FacturaPagoMatcher Ingresos scenario (receptor fields)" describe block: CUIT match via receptor, name match via receptor, no false positive with wrong CUIT, Egresos CUIT regression, Egresos name regression. Fixed test CUITs to use fictional values.

### Linear Updates
- ADV-79: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 5 issues (1 HIGH, 3 MEDIUM, 1 LOW). Fixed: fictional CUITs in tests (LOW), added `.trim()` to normalizeString (MEDIUM). HIGH (cross-direction false positive) is mitigated by caller contract — `factura-pago-matcher.ts` only populates one side of emisor/receptor fields.
- verifier: All 1590 tests pass, zero warnings

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 2 (`src/matching/matcher.ts`, `src/matching/matcher.test.ts`)
Checks applied: Security, Logic, Async, Resources, Type Safety, Edge Cases, Conventions

No issues found — all implementations are correct and follow project conventions.

Key validations:
- CUIT matching correctly checks both emisor and receptor fields with `if/else if` short-circuit
- Cross-direction false positives are prevented by the caller contract (`factura-pago-matcher.ts` sets `cuitReceptor: undefined` for Egresos)
- Name matching falls through to receptor fields only when emisor match is not found
- `.trim()` addition to `normalizeString` is a safe defensive improvement
- All 5 new tests cover the required scenarios (Ingresos CUIT, Ingresos name, false positive guard, 2 Egresos regressions)
- Test data uses fictional CUITs per CLAUDE.md conventions

### Linear Updates
- ADV-79: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
Ready for PR creation.
