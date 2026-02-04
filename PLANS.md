# Bug Fix Plan

**Created:** 2026-02-04
**Bug Report:** Cross-currency bank matching completely broken (exchange rate cache never populated) + credit movements missing referencia extraction for Tier 3
**Category:** Matching
**Linear Issues:** [ADV-77](https://linear.app/adva-administracion/issue/ADV-77/fix-add-exchange-rate-prefetch-to-matchallmovimientos-for-cross), [ADV-78](https://linear.app/adva-administracion/issue/ADV-78/fix-add-referencia-extraction-and-tier-3-matching-to-credit-movements)

## Investigation

### Context Gathered
- **MCPs used:** Google Drive (gsheets_read for BBVA ARS Movimientos, Control de Ingresos, Control de Egresos), WebFetch (ArgentinaDatos API rate verification)
- **Files examined:**
  - `src/bank/matcher.ts` — `matchMovement()` has `extractReferencia()` (line 373), `matchCreditMovement()` does not
  - `src/bank/match-movimientos.ts` — `matchAllMovimientos()` creates `new BankMovementMatcher()` (line 938) without prefetching exchange rates
  - `src/utils/exchange-rate.ts` — `prefetchExchangeRates()` defined (line 237) but never imported from production code
  - Spreadsheet BBVA ARS 2025-10, 2025-11, 2025-12 — 53 unmatched movements analyzed

### Evidence

**Bug 1: Cross-currency matching silently fails (CRITICAL)**

`prefetchExchangeRates()` is only imported in `src/utils/exchange-rate.test.ts`. No production code calls it. When `amountsMatchCrossCurrency()` encounters USD documents, it calls `getExchangeRateSync()` → cache miss → returns `{ matches: false, cacheMiss: true }`.

Verified with real data: 7 ORDEN DE PAGO DEL EXTERIOR entries have matching USD Pagos Recibidos. All are within 5% tolerance of the official venta rate (~1430-1460 ARS/USD in Oct-Dec 2025):
- FRITO PLAY (ref 4084946): Bank ARS 9,294,750 ↔ Pago USD 6,750 = -3.71% from expected → **would match**
- TINY BYTES (ref 4086424): Bank ARS 2,103,135 ↔ Pago USD 1,500 = -1.95% → **would match**
- ODACLICK (ref 4088338): Bank ARS 3,578,516 ↔ Pago USD 2,480 = +0.55% → **would match**
- FRITO PLAY (ref 4087712): Bank ARS 621,058 ↔ Pago USD 430 = +0.65% → **would match**
- DEVOLVER DIGITAL (ref 4091656): Bank ARS 2,563,271 ↔ Pago USD 1,780 = +0.00% → **would match**
- XSOLLA USA (ref 4617760): Bank ARS 6,307,200 ↔ Pago USD 4,500 = -3.34% → **would match**
- MICROSOFT (ref 4620508): Bank ARS 7,756,980 ↔ Pago USD 5,500 = -3.40% → **would match**

Zero cross-currency matches exist in any movimientos sheet, confirming the bug is systemic.

**Bug 2: Credit movements lack referencia extraction (MEDIUM)**

`matchMovement()` (debit, line 373) calls `extractReferencia()` and uses it for Tier 3.
`matchCreditMovement()` (credit, line 590-591) only extracts CUIT, NOT referencia.

ORDEN DE PAGO DEL EXTERIOR entries are **credit** movements (incoming wire transfers). Their concepto contains the referencia pattern `NNNNNNN.NN.NNNN` which corresponds to the `referencia` field in Pagos Recibidos. Without referencia extraction on the credit side, these can only match at Tier 5 (amount+date) instead of Tier 3 (referencia), resulting in lower confidence.

### Root Cause

**Bug 1:** `prefetchExchangeRates()` was implemented but never wired into the matching orchestration flow. The matching code uses `getExchangeRateSync()` which is cache-only by design (for synchronous matching), but the async prefetch step that should populate the cache before matching was never added to `matchAllMovimientos()`.

**Bug 2:** When the tier-based matching was implemented (ADV-69), referencia extraction was added to `matchMovement()` (debits) but omitted from `matchCreditMovement()` (credits). ORDEN DE PAGO entries are credits, so this gap directly impacts them.

## Fix Plan

### Fix 1: Add exchange rate prefetch to matchAllMovimientos
**Linear Issue:** [ADV-77](https://linear.app/adva-administracion/issue/ADV-77/fix-add-exchange-rate-prefetch-to-matchallmovimientos-for-cross)

1. Write test in `src/bank/match-movimientos.test.ts`:
   - Test that `prefetchExchangeRates` is called with dates from USD Pagos Recibidos and USD Facturas Emitidas before matching starts
   - Test that USD Pagos Recibidos can be matched to ARS credit movements when exchange rates are prefetched
   - Test that USD Facturas Emitidas can be matched to ARS credit movements when exchange rates are prefetched
2. Run verifier (expect fail)
3. Implement in `src/bank/match-movimientos.ts`:
   - Import `prefetchExchangeRates` from `../utils/exchange-rate.js`
   - After loading `ingresosResult` and `egresosResult` (after line 935), add a helper function `collectUsdDates(ingresosData, egresosData)` that:
     - Collects `fechaPago` from Pagos Recibidos where `moneda === 'USD'`
     - Collects `fechaEmision` from Facturas Emitidas where `moneda === 'USD'`
     - Collects `fechaEmision` from Facturas Recibidas where `moneda === 'USD'`
     - Returns unique date array
   - Call `await prefetchExchangeRates(collectUsdDates(...))` before `new BankMovementMatcher()` (line 938)
4. Run verifier (expect pass)

### Fix 2: Add referencia extraction and Tier 3 to credit matching
**Linear Issue:** [ADV-78](https://linear.app/adva-administracion/issue/ADV-78/fix-add-referencia-extraction-and-tier-3-matching-to-credit-movements)

1. Write test in `src/bank/matcher.test.ts`:
   - Test: Credit movement with ORDEN DE PAGO pattern matches Pago Recibido with same referencia at Tier 3
   - Test: Credit movement with ORDEN DE PAGO pattern but no matching Pago referencia falls through to Tier 5
   - Test: Credit movement without referencia pattern does not produce Tier 3 candidates
2. Run verifier (expect fail)
3. Implement in `src/bank/matcher.ts` `matchCreditMovement()`:
   - Add `const extractedRef = extractReferencia(movement.concepto);` after line 591 (alongside extractedCuit)
   - In the Pagos Recibidos loop (line 601-668), when determining tier for pagos without linked facturas (line 653-667):
     - Add tier 3 case: `if (extractedRef && pago.referencia === extractedRef)` → tier = 3, add 'Referencia match' reason
     - Keep existing: CUIT match → tier 2, no identity → tier 5
4. Run verifier (expect pass)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Problem:** Cross-currency bank matching is completely broken — all USD document matching silently fails because exchange rate cache is never populated. Additionally, credit movements (like ORDEN DE PAGO DEL EXTERIOR) lack referencia extraction, preventing Tier 3 matching.

**Root Cause:** `prefetchExchangeRates()` was implemented but never called from `matchAllMovimientos()`. `extractReferencia()` was added to debit matching but omitted from credit matching.

**Linear Issues:** ADV-77 (Urgent), ADV-78 (Medium)

**Solution Approach:** Add `prefetchExchangeRates()` call in `matchAllMovimientos()` after loading Control data and before creating the matcher, collecting all unique dates from USD documents. Add `extractReferencia()` call and Tier 3 logic to `matchCreditMovement()`, mirroring the debit side pattern.

**Scope:**
- Files affected: 2 (`src/bank/match-movimientos.ts`, `src/bank/matcher.ts`)
- New tests: yes (cross-currency integration tests, credit referencia Tier 3 tests)
- Breaking changes: no

**Risks/Considerations:**
- Prefetching exchange rates adds API calls on startup. ArgentinaDatos API may rate-limit if many unique dates. Use `Promise.allSettled` (already in `prefetchExchangeRates`) to handle individual failures gracefully.
- After fix, re-running `/api/match-movimientos?force=true` will fill previously unmatched cross-currency movements.
