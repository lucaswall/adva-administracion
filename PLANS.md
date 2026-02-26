# Implementation Plan

**Status:** COMPLETE
**Created:** 2026-02-26
**Source:** Inline request: Add TC orig/liq exchange rate info to movimientos detalle when matching Factura Emitida E
**Linear Issues:** [ADV-168](https://linear.app/lw-claude/issue/ADV-168/add-tc-origliq-to-detalle-for-factura-e-credit-matches)

## Context Gathered

### Codebase Analysis

- **Matcher code:** `src/bank/matcher.ts` — `matchCreditMovement()` (lines 574-835) handles CREDIT bank movement matching
- **Two code paths build detalle for Factura Emitida matches:**
  - **Tier 1 (pago linked to factura):** Lines 637-670 — currently appends `pago.tipoDeCambio` as `- tipo de cambio X` (lines 650-652)
  - **Direct factura match:** Lines 774-785 — currently does NOT append any exchange rate info
- **Factura data available:** `tipoComprobante`, `moneda`, `importeTotal`, `tipoDeCambio` (column S) are all parsed and available in the `Factura` object
- **Bank credit amount:** Available as `amount` variable (extracted from `movement.credito`)
- **Cross-currency detection:** `amountsMatchCrossCurrency()` returns `isCrossCurrency` flag; for Tier 1 with `importeEnPesos`, `isCrossCurrency` is `false` even though the underlying factura is USD
- **Existing tests:** `src/bank/matcher.test.ts` has comprehensive tests including a `Detalle description includes tipoDeCambio for COMEX (ADV-117)` describe block (line 1596) that tests current behavior. An existing test at line 1788 asserts direct factura match does NOT contain `tipo de cambio` — this will need updating.

### Key Design Decisions

1. **Condition:** `factura.tipoComprobante === 'E' && factura.moneda === 'USD'` — not based on `isCrossCurrency` flag, because Tier 1 matches via `importeEnPesos` set `isCrossCurrency=false` even though the economic reality is cross-currency
2. **For Tier 1 (pago+factura):** When factura is E/USD, the new TC format replaces the old `pago.tipoDeCambio` format. For non-E facturas, the old `pago.tipoDeCambio` behavior is preserved unchanged.
3. **TC liq uses bank movement amount:** `credit_ARS / factura.importeTotal_USD` — represents the actual effective exchange rate, as requested by the user ("the actual exchange rate with respect to the original value of the Factura and the bank movement")

## Original Plan

### Task 1: Add TC orig/liq to detalle for Factura E credit matches
**Linear Issue:** [ADV-168](https://linear.app/lw-claude/issue/ADV-168/add-tc-origliq-to-detalle-for-factura-e-credit-matches)

1. Write/update tests in `src/bank/matcher.test.ts`:
   - **New tests** (add to existing `Detalle description includes tipoDeCambio for COMEX (ADV-117)` describe block or create a sibling):
     - Credit Tier 1 (pago+factura E): Factura E USD with `tipoDeCambio=1200`, bank credit 1050000 ARS, factura total 1000 USD → detalle ends with `- TC orig: 1200.00 / TC liq: 1050.00`
     - Credit Tier 1 (pago+factura E): Factura E USD without `tipoDeCambio`, bank credit 1050000 ARS, factura total 1000 USD → detalle ends with `- TC liq: 1050.00`
     - Credit direct factura E: Factura E USD with `tipoDeCambio=850`, bank credit 92000 ARS (via cross-currency match at ~850 rate), factura total 100 USD → detalle ends with `- TC orig: 850.00 / TC liq: 920.00`
     - Credit direct factura E: Factura E USD without `tipoDeCambio`, same amounts → detalle ends with `- TC liq: 920.00`
     - Credit Tier 1 with non-E USD factura + pago with `tipoDeCambio` → old format preserved: `- tipo de cambio X` (regression guard)
   - **Update existing test** at line 1788 (`does not append tipoDeCambio for direct factura match (no pago available)`) — this test uses Factura E with USD and will now contain TC info. Update assertion to expect TC liq in detalle.
   - **Update existing test** at line 1611 (`appends tipoDeCambio when pago has it`) — this test uses Factura E. Update assertion to expect TC orig/liq format instead of old `tipo de cambio` format.
2. Run verifier with pattern "matcher" (expect fail)
3. Implement in `src/bank/matcher.ts`:
   - **Tier 1 path (lines 650-652):** Replace the `if (pago.tipoDeCambio)` block with: if `linkedFactura.tipoComprobante === 'E' && linkedFactura.moneda === 'USD'`, calculate `tcLiq = amount / linkedFactura.importeTotal` and append TC orig/liq format (using `linkedFactura.tipoDeCambio` for TC orig if present). Else keep existing `pago.tipoDeCambio` behavior.
   - **Direct factura path (after line 782):** After building the base description, if `factura.tipoComprobante === 'E' && factura.moneda === 'USD'`, calculate `tcLiq = amount / factura.importeTotal` and append TC orig/liq format (using `factura.tipoDeCambio` for TC orig if present).
   - Format: `.toFixed(2)` for both TC values
4. Run verifier with pattern "matcher" (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add exchange rate information (TC orig / TC liq) to movimientos detalle when matching Factura Emitida E

**Request:** When matching a Factura E in movimientos, include tipo de cambio original (from the Factura) and tipo de cambio liquidado (calculated from bank movement amount / factura USD total)

**Linear Issues:** ADV-168

**Approach:** Modify the two credit matching paths in `src/bank/matcher.ts` (Tier 1 pago+factura and direct factura) to append TC orig/liq info to the detalle string when the matched factura is type E and USD. TC orig comes from the factura's extracted `tipoDeCambio` field, TC liq is calculated as `credit_ARS / factura_total_USD`. Existing behavior for non-E facturas is preserved.

**Scope:**
- Tasks: 1
- Files affected: 2 (matcher.ts, matcher.test.ts)
- New tests: yes

**Key Decisions:**
- Condition based on `tipoComprobante === 'E' && moneda === 'USD'` rather than `isCrossCurrency` flag, to handle Tier 1 matches via `importeEnPesos` correctly
- TC liq uses actual bank credit amount (not pago.importeEnPesos) for accuracy
- For Tier 1 with Factura E, the new TC format replaces the old `pago.tipoDeCambio` format

**Risks/Considerations:**
- Two existing tests need assertion updates (they currently test the old behavior for Factura E specifically)

---

## Iteration 1

**Implemented:** 2026-02-26
**Method:** Single-agent (1 task, 1 work unit, effort score 2)

### Tasks Completed This Iteration
- Task 1: Add TC orig/liq to detalle for Factura E credit matches (ADV-168) — Modified both credit matching paths (Tier 1 pago+factura and direct factura), added 6 new tests, updated 1 existing test

### Files Modified
- `src/bank/matcher.ts` - Added TC orig/liq logic to both credit matching paths, with division-by-zero guard and gross amount calculation for retencion cases
- `src/bank/matcher.test.ts` - Updated Tier 1 credit test for new format, added 6 new tests covering: TC orig+liq, TC liq only, non-E regression guard, direct factura with/without tipoDeCambio, retencion+Factura E combination

### Linear Updates
- ADV-168: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 medium bugs (division by zero, retencion gross amount), both fixed
- verifier: All 1,902 tests pass, zero warnings

### Review Findings

Files reviewed: 2 (matcher.ts, matcher.test.ts)
Reviewer: single-agent (2 files)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions, Test Quality

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- ADV-168: Review → Merge

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
