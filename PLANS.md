# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/ADV-115-bank-matching-improvements
**Issues:** ADV-115, ADV-116, ADV-117, ADV-118, ADV-119
**Created:** 2026-02-22
**Last Updated:** 2026-02-22

## Summary

Improve bank movement matching by loading missing spreadsheet columns (tipoDeCambio, importeEnPesos), enriching detalle descriptions with factura numbers and exchange rates, and using importeEnPesos for precise cross-currency matching instead of API-rate tolerance.

## Issues

### ADV-116: tipoDeCambio/importeEnPesos not loaded during bank matching

**Priority:** High
**Labels:** Bug
**Description:** The bank matching pipeline reads truncated column ranges from Control spreadsheets, causing tipoDeCambio and importeEnPesos fields to be silently dropped. The parser functions also don't include these columns in their header lookups.

**Acceptance Criteria:**
- [ ] `loadControlIngresos` reads `Facturas Emitidas!A:S` and `Pagos Recibidos!A:Q`
- [ ] `loadControlEgresos` reads `Facturas Recibidas!A:T` and `Pagos Enviados!A:Q`
- [ ] `parseFacturasEmitidas` includes `tipodecambio` in colIndex (optional header)
- [ ] `parseFacturasRecibidas` includes `tipodecambio` in colIndex (optional header)
- [ ] `parsePagos` includes `tipodecambio` and `importeenpesos` in colIndex (optional headers)
- [ ] Parsed objects have `tipoDeCambio` and `importeEnPesos` populated when present in sheet

### ADV-119: factura-pago-matcher reads truncated pago column range

**Priority:** Medium
**Labels:** Bug
**Description:** The factura-pago matcher reads Pagos sheets as `A:O`, which excludes columns P (tipoDeCambio) and Q (importeEnPesos). While matching correctness isn't affected (uses API rates), the parsed Pago objects are incomplete.

**Acceptance Criteria:**
- [ ] Change pagosRange to `A:Q` in `factura-pago-matcher.ts`
- [ ] Verify hardcoded column index parsing handles additional columns without breaking

### ADV-115: Movimiento detalle missing nroFactura and tipoComprobante

**Priority:** High
**Labels:** Bug
**Description:** Movimiento detalle descriptions omit the factura number and comprobante type. User expects "Factura E 00003-00001957 - Empresa - concepto" but gets "Cobro Factura de Empresa - concepto".

**Acceptance Criteria:**
- [ ] `formatDebitFacturaDescription` includes tipoComprobante and nroFactura
- [ ] Credit Tier 1 description includes tipoComprobante and nroFactura from linked factura
- [ ] Credit direct factura match description includes tipoComprobante and nroFactura
- [ ] Pago-only descriptions remain unchanged (no factura info available)

### ADV-117: Movimiento detalle missing tipoDeCambio for COMEX operations

**Priority:** High
**Labels:** Bug
**Description:** For COMEX operations (USD invoices with bank USD→ARS conversion), the detalle description does not include the exchange rate. User expects "Factura E 00003-00001957 - Empresa - concepto - tipo de cambio 1234.56". The tipoDeCambio should come from the Pago (bank conversion rate), not the Factura (AFIP rate).

**Acceptance Criteria:**
- [ ] When a COMEX match is found, include tipoDeCambio in detalle description
- [ ] Format: "... - tipo de cambio NNNN.NN" appended when tipoDeCambio is available
- [ ] Use the pago's tipoDeCambio (bank conversion rate), not the factura's
- [ ] Only append when tipoDeCambio is present (graceful degradation)

### ADV-118: Use importeEnPesos for precise cross-currency bank matching

**Priority:** Medium
**Labels:** Improvement
**Description:** Cross-currency bank matching uses ArgentinaDatos API official rate with ±5% tolerance. However, Pago already has `importeEnPesos` — the exact ARS amount the bank deposited. Using this enables exact ARS matching instead of tolerance-based.

**Acceptance Criteria:**
- [ ] When `importeEnPesos` is available on pago, use it for direct ARS-to-ARS matching against bank credit amount
- [ ] Fall back to `amountsMatchCrossCurrency()` when `importeEnPesos` is not available
- [ ] Prefer importeEnPesos match (exact) over API-rate match (tolerance) in tier scoring
- [ ] Add tests for both paths

## Prerequisites

- [ ] No spreadsheet schema changes required — columns already exist, just not being read
- [ ] No migration needed — changes are read-only improvements to matching quality

## Implementation Tasks

### Task 1: Extend column ranges and parsers in match-movimientos.ts

**Issue:** ADV-116
**Files:**
- `src/bank/match-movimientos.test.ts` (modify)
- `src/bank/match-movimientos.ts` (modify)

**TDD Steps:**

1. **RED** - Write tests in `match-movimientos.test.ts`:
   - Test `parseFacturasEmitidas` with tipoDeCambio in column S (index 18) — verify parsed object has `tipoDeCambio` populated
   - Test `parseFacturasEmitidas` without tipoDeCambio column — verify `tipoDeCambio` is undefined (graceful)
   - Test `parseFacturasRecibidas` with tipoDeCambio in column T (index 19) — verify parsed object has `tipoDeCambio` populated
   - Test `parsePagos` with tipoDeCambio (index 15) and importeEnPesos (index 16) — verify both fields populated
   - Test `parsePagos` without those columns — verify fields are undefined
   - Use existing `parseFacturasEmitidas` and `parseFacturasRecibidas` test patterns in the file
   - Note: `parsePagos` is a private function not exported. Tests should go through the exported parsers or the function should be exported for testing (follow existing pattern — `parseFacturasEmitidas` and `parseFacturasRecibidas` are already exported)
   - Run `verifier "match-movimientos"` — expect fail

2. **GREEN** - Modify `match-movimientos.ts`:
   - In `parseFacturasEmitidas` (line 222-242): add `tipodecambio` to optional headers using `headers.indexOf('tipodecambio')`. In the push block, add `tipoDeCambio: parseNumber(row[colIndex.tipoDeCambio]) || undefined`
   - In `parseFacturasRecibidas` (line 288-311): same pattern — add `tipodecambio` optional header and parse it
   - In `parsePagos` (line 354-373): add `tipodecambio` and `importeenpesos` to optional headers. In the push block, add both fields using `parseNumber()` with `|| undefined` for optional semantics
   - In `loadControlIngresos` (line 524-527): change `Facturas Emitidas!A:R` → `A:S`, change `Pagos Recibidos!A:O` → `A:Q`
   - In `loadControlEgresos` (line 555-558): change `Facturas Recibidas!A:S` → `A:T`, change `Pagos Enviados!A:O` → `A:Q`
   - Export `parsePagos` if needed for testing (or test through integration)
   - Run `verifier "match-movimientos"` — expect pass

**Notes:**
- The header-based lookup (`headers.indexOf`) returns -1 if column is missing, which is safe — `row[-1]` returns undefined in JS
- Use `parseNumber(val) || undefined` pattern so 0 doesn't become a falsy tipoDeCambio (exchange rates are never 0)
- Follow existing optional header pattern established by `fileName`, `concepto`, etc.

### Task 2: Extend factura-pago-matcher column range

**Issue:** ADV-119
**Files:**
- `src/processing/matching/factura-pago-matcher.ts` (modify)

**TDD Steps:**

1. **RED** - No separate test needed. The factura-pago-matcher uses hardcoded indices (0-14) for existing columns. Extending the range from `A:O` to `A:Q` just provides more data in the row array without breaking existing parsing. The parser reads up to index 14 (column O), so columns P and Q are simply available but unused by this parser.

2. **GREEN** - Modify `factura-pago-matcher.ts`:
   - Line 302: change `const pagosRange = '${pagosSheetName}!A:O'` → `'${pagosSheetName}!A:Q'`
   - Run `verifier "factura-pago"` — expect pass

**Notes:**
- This is a one-line fix. The hardcoded index parsing (lines 362-385) reads up to index 14, so extending to A:Q provides tipoDeCambio (index 15) and importeEnPesos (index 16) in the raw row data, but the existing parsing code simply ignores them.
- If the factura-pago-matcher ever needs these fields in the future, they'll be available in the row data.

### Task 3: Add nroFactura and tipoComprobante to detalle descriptions

**Issue:** ADV-115
**Files:**
- `src/bank/matcher.test.ts` (modify)
- `src/bank/matcher.ts` (modify)

**TDD Steps:**

1. **RED** - Write tests in `matcher.test.ts`:
   - Test `formatDebitFacturaDescription` returns format "Pago Factura {tipo} {nro} a {razonSocial} - {concepto}" (e.g., "Pago Factura E 00003-00001957 a TEST SA - servicios")
   - Test `formatDebitFacturaDescription` with missing concepto: "Pago Factura E 00003-00001957 a TEST SA"
   - Test credit Tier 1 (pago+factura) description includes factura number: "Cobro Factura {tipo} {nro} de {cliente} - {concepto}"
   - Test credit direct factura description includes factura number
   - Test pago-only descriptions remain unchanged (no factura info to include)
   - Note: `formatDebitFacturaDescription` is private. Test indirectly through `matchMovement`/`matchCreditMovement` by setting up scenarios that produce Tier 1 and direct factura matches, then asserting on the `description` field of the returned result
   - Follow existing test patterns in matcher.test.ts (use `makeMovimiento` helper, set up exchange rate cache)
   - Run `verifier "matcher"` — expect fail

2. **GREEN** - Modify `matcher.ts`:
   - `formatDebitFacturaDescription` (line 856-863): prepend tipoComprobante and nroFactura to the description. Change format from "Pago Factura a {razonSocial}" to "Pago Factura {tipo} {nro} a {razonSocial}". Only include tipo/nro when they are non-empty.
   - Credit Tier 1 (line 631-633): change "Cobro Factura de {cliente}" to "Cobro Factura {tipo} {nro} de {cliente}" using `linkedFactura.tipoComprobante` and `linkedFactura.nroFactura`
   - Credit direct factura (line 762-764): same pattern — change "Cobro Factura de {cliente}" to "Cobro Factura {tipo} {nro} de {cliente}"
   - Run `verifier "matcher"` — expect pass

**Notes:**
- The `Factura` objects already have `tipoComprobante` and `nroFactura` fields populated (confirmed at match-movimientos.ts:253-254)
- Debit uses `razonSocialEmisor` (proveedor), credit uses `razonSocialReceptor` (cliente) — don't mix these up
- Only include tipo/nro prefix when both are available (graceful for edge cases with missing data)

### Task 4: Add tipoDeCambio to COMEX detalle descriptions

**Issue:** ADV-117
**Files:**
- `src/bank/matcher.test.ts` (modify)
- `src/bank/matcher.ts` (modify)

**TDD Steps:**

1. **RED** - Write tests in `matcher.test.ts`:
   - Test credit Tier 1 COMEX match: when pago has `tipoDeCambio`, description ends with " - tipo de cambio 1234.56"
   - Test credit Tier 1 non-COMEX match: when pago has no `tipoDeCambio`, description has no tipo de cambio suffix
   - Test debit Tier 1 COMEX match: when linked pago (Pago Enviado) has `tipoDeCambio`, description includes it
   - Test debit direct factura COMEX match: no tipoDeCambio appended (no pago available, only factura tipoDeCambio which is AFIP rate, not bank rate)
   - Pago objects in tests need `tipoDeCambio` field set (will work because Task 1 makes parsers load it)
   - Run `verifier "matcher"` — expect fail

2. **GREEN** - Modify `matcher.ts`:
   - Credit Tier 1 (around line 631-633): after building the description with factura info, check if `pago.tipoDeCambio` exists. If so, append ` - tipo de cambio ${pago.tipoDeCambio.toFixed(2)}`
   - Debit Tier 1 (around line 403): the `pago` object is available. After calling `formatDebitFacturaDescription(linkedFactura)`, check if `pago.tipoDeCambio` exists and append the same suffix
   - Do NOT add tipoDeCambio to debit direct factura matches (line 494) — there's no pago, only factura.tipoDeCambio which is the AFIP rate
   - Do NOT add tipoDeCambio to pago-only matches — they already have no factura context
   - Run `verifier "matcher"` — expect pass

**Notes:**
- The key insight is: tipoDeCambio comes from the Pago (bank conversion rate), NOT from the Factura (AFIP official rate). They are different numbers.
- Only append when `pago.tipoDeCambio` is defined and > 0
- Use `.toFixed(2)` for consistent formatting
- This task depends on Task 1 (ADV-116) because tipoDeCambio must be loaded into Pago objects first

### Task 5: Use importeEnPesos for precise cross-currency bank matching

**Issue:** ADV-118
**Files:**
- `src/bank/matcher.test.ts` (modify)
- `src/bank/matcher.ts` (modify)

**TDD Steps:**

1. **RED** - Write tests in `matcher.test.ts`:
   - Test credit pago matching: when pago has `importeEnPesos` and pago is USD, match against bank credit using `importeEnPesos` (ARS-to-ARS exact match with standard ±1 tolerance) instead of `amountsMatchCrossCurrency`
   - Test credit pago matching: when pago has NO `importeEnPesos`, fall back to `amountsMatchCrossCurrency()` as before
   - Test credit pago matching: when importeEnPesos matches exactly, the match is treated as exact amount (not cross-currency), improving confidence
   - Test debit pago matching: when pago has `importeEnPesos`, match using importeEnPesos against bank debit amount
   - Run `verifier "matcher"` — expect fail

2. **GREEN** - Modify `matcher.ts`:
   - Credit pago matching (around line 608-613): before calling `amountsMatchCrossCurrency`, check if `pago.importeEnPesos` is available and `pago.moneda === 'USD'`. If so, use `amountsMatch(pago.importeEnPesos, amount)` for direct ARS comparison. Set `isExactAmount: true` and don't flag as cross-currency.
   - If `importeEnPesos` is not available, fall back to existing `amountsMatchCrossCurrency()` logic
   - The confidence should be treated as same-currency (HIGH for tier 1-3) when importeEnPesos is used, since it's an exact ARS match
   - Debit pago matching: similar logic — check `pago.importeEnPesos` before `amountsMatch(pago.importePagado, amount)` which currently only checks same-currency
   - Run `verifier "matcher"` — expect pass

**Notes:**
- `importeEnPesos` is the exact ARS amount the bank deposited/debited after its own USD→ARS conversion
- Using it avoids the ±5% tolerance window that can cause false matches/misses
- The existing `amountsMatch()` function uses ±1 tolerance which is appropriate for same-currency exact matching
- This task depends on Task 1 (ADV-116) for importeEnPesos to be loaded into Pago objects
- Debit pagos currently use `amountsMatch(pago.importePagado, amount)` at line 388. For USD pagos with importeEnPesos, the bank movement is in ARS, so we need to match against importeEnPesos, not importePagado

### Task 6: Final verification

**Issue:** ADV-115, ADV-116, ADV-117, ADV-118, ADV-119

**Steps:**
1. Run `verifier` (full mode — all tests + build)
2. Run `bug-hunter` to review all changes

## Dependencies Between Tasks

```
Task 1 (ADV-116: load fields) ──┬──→ Task 4 (ADV-117: tipoDeCambio in detalle)
                                └──→ Task 5 (ADV-118: importeEnPesos matching)
Task 2 (ADV-119: factura-pago range) — independent
Task 3 (ADV-115: nroFactura in detalle) — independent
Task 6 (final verification) — depends on all others
```

Tasks 1, 2, 3 can be done in parallel. Tasks 4 and 5 depend on Task 1. Task 6 is last.

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Review" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| tipoDeCambio column missing from sheet | Field is undefined on parsed object, no error | Unit test (Task 1) |
| importeEnPesos column missing from sheet | Field is undefined, falls back to API-rate matching | Unit test (Task 5) |
| tipoDeCambio is 0 or NaN | Treated as absent, graceful degradation | Unit test (Task 4) |
| nroFactura or tipoComprobante empty | Description omits the factura number prefix | Unit test (Task 3) |

## Risks & Open Questions

- None identified. All changes are backward-compatible read-only improvements to matching quality. No spreadsheet schema changes, no folder structure changes, no migration needed.

## Scope Boundaries

**In Scope:**
- Loading tipoDeCambio and importeEnPesos from existing spreadsheet columns during bank matching
- Enriching detalle descriptions with factura numbers, comprobante types, and exchange rates
- Using importeEnPesos for precise cross-currency matching
- Extending factura-pago-matcher column range

**Out of Scope:**
- Changes to how tipoDeCambio/importeEnPesos are written to spreadsheets (already working)
- Changes to Gemini extraction or parser logic
- Changes to spreadsheet schema or column layout
- UI/Apps Script changes

---

## Iteration 1

**Implemented:** 2026-02-22
**Method:** Single-agent (2 work units, 9 effort points)

### Tasks Completed This Iteration
- Task 1 (ADV-116): Extend column ranges and parsers — added tipoDeCambio to parseFacturasEmitidas/parseFacturasRecibidas, added tipoDeCambio+importeEnPesos to parsePagos, updated loadControlIngresos/loadControlEgresos ranges
- Task 2 (ADV-119): Extend factura-pago-matcher column range — pagos A:O→A:Q, facturas ranges updated, pago parser extended
- Task 3 (ADV-115): Add nroFactura and tipoComprobante to detalle descriptions — formatDebitFacturaDescription, credit Tier 1, credit direct factura all now include "Factura {tipo} {nro}"
- Task 4 (ADV-117): Add tipoDeCambio to COMEX detalle descriptions — credit Tier 1 and debit Tier 1 append " - tipo de cambio NNNN.NN" when pago.tipoDeCambio is available
- Task 5 (ADV-118): Use importeEnPesos for precise cross-currency bank matching — credit and debit pago matching use importeEnPesos for exact ARS match when available, falling back to amountsMatchCrossCurrency
- Task 6: Final verification — bug-hunter and full verifier passed

### Files Modified
- `src/bank/match-movimientos.ts` — Extended column ranges, added tipoDeCambio/importeEnPesos parsing, exported parsePagos
- `src/bank/match-movimientos.test.ts` — Added tests for new field parsing, updated mock ranges
- `src/bank/matcher.ts` — nroFactura/tipoComprobante in descriptions, tipoDeCambio suffix, importeEnPesos matching
- `src/bank/matcher.test.ts` — Added tests for descriptions, tipoDeCambio, importeEnPesos matching, updated pre-existing expectations
- `src/processing/matching/factura-pago-matcher.ts` — Extended pagos range A:O→A:Q, facturas ranges A:R→A:S / A:S→A:T, added pago tipoDeCambio/importeEnPesos parsing

### Linear Updates
- ADV-116: Todo → In Progress → Review
- ADV-119: Todo → In Progress → Review
- ADV-115: Todo → In Progress → Review
- ADV-117: Todo → In Progress → Review
- ADV-118: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 HIGH issues (factura-pago-matcher ranges and pago parser), fixed before commit
- verifier: All 1,728 tests pass, zero warnings

### Continuation Status
All tasks completed.
