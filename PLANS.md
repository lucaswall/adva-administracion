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

5. **No manual lock:** No mechanism exists to prevent automatic matching from overwriting user-confirmed matches.

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

**Fix 5 (matchManual column):**
- `src/constants/spreadsheet-headers.ts:7-134` — all 6 header arrays need new `matchManual` column appended
- `src/processing/matching/factura-pago-matcher.ts:299-302` — read ranges need extending (+1 column)
- `src/processing/matching/factura-pago-matcher.ts:390` — `unmatchedPagos` filter needs to exclude locked rows
- `src/processing/matching/factura-pago-matcher.ts:448-520` — displacement logic must skip locked facturas
- `src/processing/matching/factura-pago-matcher.ts:553-616` — update writes must include matchManual='NO'
- `src/processing/matching/recibo-pago-matcher.ts` — same patterns as factura-pago
- `src/processing/matching/nc-factura-matcher.ts` — same patterns
- `src/services/folder-structure.ts` — startup migration: check header row length, append missing headers

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

### Fix 5: Add matchManual column to all matching sheets
**Linear Issue:** [ADV-131](https://linear.app/lw-claude/issue/ADV-131/add-matchmanual-column-to-all-matching-sheets-for-manual-match-locking)

**Migration note:** This changes spreadsheet schema by adding a new column to 6 sheets across 2 spreadsheets (Control de Ingresos, Control de Egresos). Existing rows with empty matchManual = not locked (correct default). Startup migration must add headers to existing sheets.

1. Write tests for matchManual behavior in `src/processing/matching/factura-pago-matcher.test.ts`:
   - Test: pago with matchManual='SI' is excluded from unmatched pool
   - Test: factura with matchManual='SI' is not displaced even if better match exists
   - Test: new automatic match writes matchManual='NO' to both factura and pago rows
   - Test: displacement clears matchManual on both sides
   - Run `verifier` filtered — expect fail

2. Update header arrays in `src/constants/spreadsheet-headers.ts`:
   - `FACTURA_EMITIDA_HEADERS`: append `'matchManual'` (new column T, index 19)
   - `FACTURA_RECIBIDA_HEADERS`: append `'matchManual'` (new column U, index 20)
   - `PAGO_RECIBIDO_HEADERS`: append `'matchManual'` (new column R, index 17)
   - `PAGO_ENVIADO_HEADERS`: append `'matchManual'` (new column R, index 17)
   - `RECIBO_HEADERS`: append `'matchManual'` (new column S, index 18)
   - `RETENCIONES_RECIBIDAS_HEADERS`: append `'matchManual'` (new column P, index 15)

3. Add startup migration in `src/services/folder-structure.ts`:
   - After validating sheet existence, check if the header row has fewer columns than the expected header array
   - If so, append missing headers to the header row using `batchUpdate`
   - This handles existing spreadsheets that don't have the new column yet

4. Update `src/processing/matching/factura-pago-matcher.ts`:
   - Extend read ranges: Facturas Emitidas `A:T` (was `A:S`), Facturas Recibidas `A:U` (was `A:T`), Pagos `A:R` (was `A:Q`)
   - Parse `matchManual` from new column index during data loading (for both facturas and pagos)
   - Add `matchManual?: string` field to the parsed factura and pago objects
   - In unmatched filter (line 390): add `&& p.matchManual !== 'SI'`
   - In displacement check: skip facturas with `matchManual === 'SI'` (don't consider them for displacement)
   - In update writes: include matchManual='NO' in both factura and pago update ranges
   - When clearing a match (displacement unmatch): write empty matchManual

5. Update `src/processing/matching/recibo-pago-matcher.ts`:
   - Same pattern: extend read ranges, parse matchManual, skip locked rows, write 'NO' on match

6. Update `src/processing/matching/nc-factura-matcher.ts`:
   - Same pattern: extend read ranges, parse matchManual, skip locked rows, write 'NO' on match

7. Update `src/processing/matching/retencion-factura-matcher.ts` (from Fix 4):
   - Build with matchManual support from the start

8. Update `SPREADSHEET_FORMAT.md` and `CLAUDE.md` with new column documentation
   - Run `verifier` — expect pass

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Problem:** Pagos Recibidos and Retenciones don't match in staging due to strict USD amount tolerance ($1), short date range (60 days), punctuation-sensitive name matching, missing retencion matching logic, and no manual match locking.

**Root Cause:** Five independent issues: (1) same-currency USD tolerance too tight for wire transfer fees, (2) LOW date range too short for international payments, (3) punctuation not stripped in name normalization, (4) retencion→factura matching never implemented, (5) no mechanism to lock manual matches.

**Linear Issues:** ADV-127, ADV-128, ADV-129, ADV-130, ADV-131

**Solution Approach:** Add $30 USD same-currency tolerance and 90-day LOW range for USD facturas. Strip punctuation in normalizeString for better name matching. Create new retencion-factura-matcher following the NC matcher pattern. Add matchManual column (SI/NO/empty) to all 6 matching sheets with startup migration for existing spreadsheets.

**Scope:**
- Files affected: ~15 (matchers, config, headers, types, folder-structure, exchange-rate, SPREADSHEET_FORMAT.md, CLAUDE.md)
- New tests: yes (all 5 fixes)
- New file: `src/processing/matching/retencion-factura-matcher.ts` + test
- Breaking changes: no — new columns are appended, existing data unaffected

**Risks/Considerations:**
- matchManual column migration must handle both existing (empty) and new spreadsheets
- Retencion matching for multi-factura cases (montoComprobante = sum of multiple facturas) is deferred — first implementation matches 1:1 only
- USD tolerance of $30 could theoretically match wrong documents if two USD facturas have amounts within $30 of each other for the same client — mitigated by CUIT/name matching tiers
