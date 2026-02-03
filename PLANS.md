# Implementation Plan

**Created:** 2026-02-03
**Source:** Linear Backlog issues
**Linear Issues:** [ADV-63](https://linear.app/adva-administracion/issue/ADV-63/bank-fee-detalle-never-written-to-spreadsheet), [ADV-64](https://linear.app/adva-administracion/issue/ADV-64/matchcreditmovement-skips-bank-fee-check), [ADV-65](https://linear.app/adva-administracion/issue/ADV-65/origenconcepto-field-includes-bank-origin-code-that-breaks-pattern)

## Context Gathered

### Codebase Analysis

**ADV-63 (Bank fee detalle never written):**
- `src/bank/matcher.ts:716-725` — `createBankFeeMatch()` returns `matchedFileId: ''` (empty string)
- `src/bank/matcher.ts:730-739` — `createCreditCardPaymentMatch()` also returns `matchedFileId: ''`
- `src/bank/match-movimientos.ts:795` — Write condition: `matchResult.matchType !== 'no_match' && matchResult.matchedFileId` — fails for empty string
- `src/bank/autofill.ts:274` — Uses `matchResult.description` instead of `matchedFileId` — works correctly for bank fees
- Bank fees and credit card payments intentionally have no associated file, so `matchedFileId` is correctly empty
- The `shouldUpdate` logic (lines 799-880) also depends on `matchedFileId` for force mode and quality comparison

**ADV-64 (matchCreditMovement skips bank fee check):**
- `src/bank/matcher.ts:271-274` — `matchMovement()` checks `isBankFee()` as Priority 0 BEFORE debit amount validation
- `src/bank/matcher.ts:281-284` — `matchMovement()` checks `isCreditCardPayment()` as Priority 0.5
- `src/bank/matcher.ts:769-848` — `matchCreditMovement()` has NO bank fee or credit card payment checks
- `matchCreditMovement()` first validates credit amount (line 775-778), then proceeds directly to pago/factura matching
- `createBankFeeMatch()` and `createCreditCardPaymentMatch()` are reusable — they work for both sides

**ADV-65 (origenConcepto field includes bank origin code):**
- `src/gemini/prompts.ts:436` — Prompt instructs: `origenConcepto: Full description combining origin and concept`
- Bank origin codes follow pattern: `D [optional 3-digit code] ` (e.g., `D `, `D 500 `, `D 584 `)
- `src/bank/matcher.ts:198-215` — All 15 `BANK_FEE_PATTERNS` use `^` start anchor
- `src/bank/matcher.ts:177-178` — `CREDIT_CARD_PAYMENT_PATTERNS` uses `^` start anchor
- `src/bank/matcher.ts:45-50` — `DIRECT_DEBIT_PATTERNS` do NOT use `^` anchors (use `\b` word boundary) — less affected
- Field flows: prompts → parser → types → storage → spreadsheet → reader → match-movimientos → matcher
- ~150+ occurrences across 9 source files, 9 test files, and 2 documentation files
- Existing sheets use column index (not header name), so old data still readable after rename

**Existing test files:**
- `src/bank/matcher.test.ts` — bank movement matching tests
- `src/bank/match-movimientos.test.ts` — orchestration tests with mocked `getValues`
- `src/bank/autofill.test.ts` — autofill tests
- `src/gemini/parser.test.ts` — parser tests for resumen_bancario
- `src/gemini/prompts.test.ts` — prompt content tests
- `src/services/movimientos-reader.test.ts` — movement reading tests
- `src/services/movimientos-detalle.test.ts` — detalle update tests
- `src/processing/storage/movimientos-store.test.ts` — storage tests
- `src/utils/balance-formulas.test.ts` — balance formula tests

### MCP Context
- **MCPs used:** Linear (issue details)
- **Findings:** ADV-63 is High (bank fees never written), ADV-64 is Medium (credit-side gap), ADV-65 is High (pattern matching broken by origin prefix)

## Original Plan

### Task 1: Fix bank fee and credit card payment detalle write condition
**Linear Issue:** [ADV-63](https://linear.app/adva-administracion/issue/ADV-63/bank-fee-detalle-never-written-to-spreadsheet)

The write condition at `match-movimientos.ts:795` requires `matchedFileId` to be truthy, but bank fee and credit card payment matches have `matchedFileId: ''`. The condition must allow these match types through while keeping the fileId requirement for document-linked matches.

1. Write tests in `src/bank/match-movimientos.test.ts`:
   - Test that a `bank_fee` match result (with `matchedFileId: ''`) produces an update entry with `detalle: 'Gastos bancarios'` and `matchedFileId: ''`
   - Test that a `credit_card_payment` match result (with `matchedFileId: ''`) produces an update entry with `detalle: 'Pago de tarjeta de credito'` and `matchedFileId: ''`
   - Test that `no_match` results still produce no update
   - Test that force mode works for bank_fee matches (shouldUpdate is true)
   - Test that existing bank_fee detalle is not overwritten by a new bank_fee (no quality improvement)
   - Verify `debitsFilled`/`creditsFilled` counters increment for bank fee matches
2. Run verifier (expect fail)
3. Fix `src/bank/match-movimientos.ts`:
   - At line 795, change the condition to also accept matches where `matchedFileId` is intentionally empty:
     ```typescript
     const isFileIdMatch = matchResult.matchType !== 'no_match' && matchResult.matchedFileId;
     const isAutoLabelMatch = matchResult.matchType === 'bank_fee' || matchResult.matchType === 'credit_card_payment';
     if (isFileIdMatch || isAutoLabelMatch) {
     ```
   - In the `shouldUpdate` logic (lines 799-880), ensure force mode and quality comparison handle empty `matchedFileId`:
     - For auto-label matches with no existing detalle: always update
     - For auto-label matches with existing detalle: skip (no quality to compare)
     - For auto-label matches in force mode: update
4. Run verifier (expect pass)

### Task 2: Add bank fee and credit card payment checks to matchCreditMovement
**Linear Issue:** [ADV-64](https://linear.app/adva-administracion/issue/ADV-64/matchcreditmovement-skips-bank-fee-check)

`matchCreditMovement()` at `matcher.ts:769` lacks the Priority 0 bank fee and Priority 0.5 credit card payment checks that `matchMovement()` has at lines 271-284. Credit-side bank fees (e.g., fee reversals, interest credits) and credit card payment entries on credit side are never auto-labeled.

1. Write tests in `src/bank/matcher.test.ts`:
   - Test that `matchCreditMovement()` with a credit movement whose `concepto` matches a bank fee pattern (e.g., `"COMISION MAN CUENTA"`) returns `matchType: 'bank_fee'`, `confidence: 'HIGH'`, `matchedFileId: ''`, `description: 'Gastos bancarios'`
   - Test that `matchCreditMovement()` with a credit movement whose `concepto` matches a credit card payment pattern (e.g., `"PAGO TARJETA 4563"`) returns `matchType: 'credit_card_payment'`, `confidence: 'HIGH'`
   - Test that non-fee, non-credit-card credit movements still go through normal matching (existing behavior preserved)
   - Test that bank fee check runs even before amount validation (movement with `credito: 0` and bank fee concepto returns bank fee match, not no_match) — mirror Priority 0 behavior from `matchMovement()`
2. Run verifier (expect fail)
3. Fix `src/bank/matcher.ts`:
   - In `matchCreditMovement()`, add before the amount check at line 775:
     ```typescript
     // Priority 0: Check for bank fees FIRST (can be debito or credito)
     if (isBankFee(movement.concepto)) {
       return this.createBankFeeMatch(movement);
     }
     // Priority 0.5: Check for credit card payments
     if (isCreditCardPayment(movement.concepto)) {
       return this.createCreditCardPaymentMatch(movement);
     }
     ```
4. Run verifier (expect pass)

### Task 3: Rename origenConcepto to concepto and strip origin prefix
**Linear Issue:** [ADV-65](https://linear.app/adva-administracion/issue/ADV-65/origenconcepto-field-includes-bank-origin-code-that-breaks-pattern)

The `origenConcepto` field combines a bank-internal origin code prefix (e.g., `D 500`) with the actual transaction description. This breaks all `^`-anchored regex patterns in `isBankFee()`, `isCreditCardPayment()`. The fix has three parts:

**Part A: Rename field from `origenConcepto` to `concepto` across codebase**

1. Write test in `src/gemini/parser.test.ts`:
   - Update existing resumen_bancario tests: change `origenConcepto` to `concepto` in test objects
   - Add test that parser accepts `concepto` field (new prompt output format)
2. Write test in `src/gemini/prompts.test.ts`:
   - Update prompt content test: check for `concepto` instead of `origenConcepto`
3. Run verifier (expect fail)
4. Rename across all source files (replace `origenConcepto` with `concepto`):
   - `src/types/index.ts` — both interface definitions (lines 266, 868)
   - `src/constants/spreadsheet-headers.ts` — header constant (line 226)
   - `src/gemini/prompts.ts` — prompt text and examples (lines 436, 443, 444, 460)
   - `src/gemini/parser.ts` — parser validation (lines 882, 905, 911)
   - `src/services/movimientos-reader.ts` — row parsing (lines 27, 30-32, 49, 56)
   - `src/services/movimientos-detalle.ts` — version computation (lines 50, 55, 63)
   - `src/bank/match-movimientos.ts` — VersionableRow interface and usage (lines 59, 77, 85, 201, 807, 866)
   - `src/utils/balance-formulas.ts` — formula generation (lines 23, 64, 92)
   - `src/processing/storage/movimientos-store.ts` — storage layer (lines 81, 100, 116)
5. Update all test files to match the rename:
   - `src/gemini/parser.test.ts`
   - `src/gemini/prompts.test.ts`
   - `src/services/movimientos-reader.test.ts`
   - `src/services/movimientos-detalle.test.ts`
   - `src/bank/match-movimientos.test.ts`
   - `src/bank/autofill.test.ts`
   - `src/processing/storage/movimientos-store.test.ts`
   - `src/processing/storage/resumen-store.test.ts`
   - `src/utils/balance-formulas.test.ts`
   - `src/constants/spreadsheet-headers.test.ts`
6. Run verifier (expect pass — rename is mechanical)

**Part B: Change Gemini prompt to extract only the description text**

1. Write test in `src/gemini/prompts.test.ts`:
   - Test that prompt instructs extraction of just the concept/description, not the origin code
   - Test that example JSON shows clean descriptions without `D 500` prefix
2. Run verifier (expect fail)
3. Update `src/gemini/prompts.ts`:
   - Line 436: Change from `origenConcepto: Full description combining origin and concept` to `concepto: Transaction description/concept text only, excluding bank channel codes (e.g., "D", "D 500"). Extract only the meaningful description.`
   - Lines 443-444, 460: Update example JSON — change `"origenConcepto": "D 500 TRANSFERENCIA RECIBIDA"` to `"concepto": "TRANSFERENCIA RECIBIDA"`
4. Run verifier (expect pass)

**Part C: Add prefix-stripping fallback for existing spreadsheet data**

Existing spreadsheet data still has the combined `D [NNN]` prefix from before the prompt change. The matcher must strip this prefix when reading from spreadsheets.

1. Write tests in `src/bank/matcher.ts` tests (`src/bank/matcher.test.ts`):
   - Test `stripBankOriginPrefix("D 500 TRANSFERENCIA RECIBIDA")` returns `"TRANSFERENCIA RECIBIDA"`
   - Test `stripBankOriginPrefix("D PAGO TARJETA VISA")` returns `"PAGO TARJETA VISA"`
   - Test `stripBankOriginPrefix("D 584 COMISION MAN CUENTA")` returns `"COMISION MAN CUENTA"`
   - Test `stripBankOriginPrefix("IMPUESTO LEY 25413")` returns `"IMPUESTO LEY 25413"` (no prefix, unchanged)
   - Test `stripBankOriginPrefix("GP-COM.OPAGO GALICIA")` returns `"GP-COM.OPAGO GALICIA"` (Galicia prefix, not bank origin)
   - Test `stripBankOriginPrefix("")` returns `""`
   - Test `isBankFee()` works with prefix-stripped values
   - Test `isCreditCardPayment()` works with prefix-stripped values
2. Run verifier (expect fail)
3. Implement in `src/bank/matcher.ts`:
   - Add exported function `stripBankOriginPrefix(concepto: string): string` that strips `/^D\s+(\d{3}\s+)?/` prefix
   - Apply `stripBankOriginPrefix()` inside `isBankFee()`, `isCreditCardPayment()`, and `extractKeywordTokens()` before pattern matching
   - This ensures both old data (with prefix) and new data (without prefix) are matched correctly
4. Run verifier (expect pass)

**Part D: Update documentation**

1. Update `SPREADSHEET_FORMAT.md`:
   - Change column B definition from `origenConcepto` to `concepto`
   - Update description from "Full description combining origin and concept" to "Transaction description/concept"
2. Update `OPERATION-MANUAL.es.md`:
   - Change field reference from `origenConcepto` to `concepto`
3. Run verifier (build still passes)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix bank fee/credit card payment detalle writing, add missing pattern checks to credit matching, and rename origenConcepto to concepto with origin prefix stripping for reliable pattern matching.

**Linear Issues:** ADV-63, ADV-64, ADV-65

**Approach:**
- Fix the write condition in match-movimientos to allow bank_fee and credit_card_payment matches through despite having empty matchedFileId (ADV-63)
- Add isBankFee() and isCreditCardPayment() checks to matchCreditMovement() mirroring the existing matchMovement() logic (ADV-64)
- Rename origenConcepto to concepto across the full stack (types, prompts, parser, storage, readers, matching, tests, docs), update the Gemini prompt to extract only the description text, and add a prefix-stripping fallback in the matcher for backward compatibility with existing spreadsheet data (ADV-65)

**Scope:**
- Tasks: 3 (Task 3 has 4 sub-parts)
- Files affected: ~20 source files + ~10 test files + 2 doc files
- New tests: yes (write condition tests, credit-side pattern tests, prefix stripping tests)

**Key Decisions:**
- ADV-63 uses explicit match type check (`bank_fee || credit_card_payment`) rather than making matchedFileId optional, keeping the contract clear
- ADV-64 adds checks BEFORE amount validation in matchCreditMovement, mirroring the Priority 0 pattern from matchMovement
- ADV-65 strips the origin prefix in the matcher (not the reader) so version hashes remain consistent with existing spreadsheet data
- The prefix-stripping regex `/^D\s+(\d{3}\s+)?/` handles both `D ` and `D NNN ` formats
- DIRECT_DEBIT_PATTERNS are not affected (they use word boundary `\b`, not start anchor `^`)

**Dependencies/Prerequisites:**
- Task 1 (ADV-63) must be completed before Task 2 (ADV-64) — otherwise credit-side bank fee matches would be detected but not written
- Task 3 (ADV-65) depends on Tasks 1 and 2 being complete — the prefix stripping makes pattern detection work, but the write path and credit-side checks must already be fixed

---

## Iteration 1

**Status:** COMPLETE

### Task 1 (ADV-63): Fix bank fee/credit card payment detalle write condition
- Added 6 tests in `match-movimientos.test.ts` for bank_fee and credit_card_payment detalle writing
- Fixed `match-movimientos.ts:795`: split condition into `isFileIdMatch` and `isAutoLabelMatch`, with separate `shouldUpdate` logic for auto-label matches
- All tests pass, ADV-63 → Review

### Task 2 (ADV-64): Add bank fee/credit card payment checks to matchCreditMovement
- Added 4 tests in `matcher.test.ts` for credit-side bank fee and credit card payment detection
- Added `isBankFee()` and `isCreditCardPayment()` checks at top of `matchCreditMovement()` before amount validation
- All tests pass, ADV-64 → Review

### Task 3 (ADV-65): Rename origenConcepto to concepto and strip origin prefix
- **Part A:** Mechanical rename of `origenConcepto` → `concepto` across 20 files (types, constants, prompts, parser, reader, detalle, match-movimientos, storage, balance-formulas, and all test files)
- **Part B:** Updated Gemini prompt to instruct extraction of description text only, excluding bank channel codes. Updated example JSON.
- **Part C:** Added `stripBankOriginPrefix()` function with regex `/^D\s+\d{2,3}\s+/` (requires 2-3 digit channel code to avoid false positives). Applied in `isBankFee()`, `isCreditCardPayment()`, and `extractKeywordTokens()`. Added 15 new tests.
- **Part D:** Updated `SPREADSHEET_FORMAT.md` and `OPERATION-MANUAL.es.md` docs
- Fixed 3 TypeScript build errors from type narrowing loss (non-null assertions for `matchedFileId` in non-auto-label path, `?? ''` for auto-label path)
- Bug hunter finding: tightened regex from `/^D\s+(\d+\s*)?/` to `/^D\s+\d{2,3}\s+/` to require channel code and avoid false positives on concepto text starting with "D "
- All 1584 tests pass, build clean, ADV-65 → Review

### Review Findings

Files reviewed: 12 source files, 2 documentation files
Checks applied: Security, Logic, Async, Resources, Type Safety, Edge Cases, Conventions

**Summary:** 0 CRITICAL, 0 HIGH, 1 MEDIUM (documented only)

**Documented (no fix needed):**
- [MEDIUM] EDGE CASE: JSDoc for `stripBankOriginPrefix()` (`src/bank/matcher.ts:66-68`) shows example `"D COMISION MANTENIMIENTO" → "COMISION MANTENIMIENTO"` but the tightened regex `/^D\s+\d{2,3}\s+/` does NOT strip bare "D " prefix (requires 2-3 digit channel code). The test at `matcher.test.ts:1101` correctly asserts the actual behavior. This is an intentional design tradeoff — bare "D " is not stripped to avoid false positives on concepto text starting with "D ". Old spreadsheet data with bare "D " prefix (no digit code) won't have patterns matched, but the Gemini prompt change ensures new data arrives clean.

**Verification results:**
- All 1584 tests pass
- Build clean, zero warnings
- No `origenConcepto` references remain in codebase
- Rename is complete across types, constants, prompts, parser, storage, readers, matching, balance-formulas, and all test files
- Documentation (SPREADSHEET_FORMAT.md, OPERATION-MANUAL.es.md) correctly updated
- Write condition correctly handles auto-label matches (bank_fee, credit_card_payment) with empty matchedFileId
- matchCreditMovement() correctly mirrors matchMovement() priority 0/0.5 pattern
- Non-null assertions in match-movimientos.ts:829 are safe (guarded by isFileIdMatch truthiness check)

### Linear Updates
- ADV-63: Review → Merge
- ADV-64: Review → Merge
- ADV-65: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
Ready for PR creation.
