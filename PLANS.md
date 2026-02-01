# Bug Fix Plan

**Created:** 2026-02-01
**Bug Report:** Multiple Visa folders created in 2025 due to inconsistent credit card account number extraction
**Category:** Prompt / Extraction

## Investigation

### Context Gathered
- **MCPs used:** Google Drive MCP (to search folders and files, download PDFs), Gemini MCP (not needed - issue is in prompt)
- **Files examined:**
  - Google Drive: 4 folders found with inconsistent names for same card
  - PDFs: `1d0C-4vM3RHKnngRPRbPmhTjYkXUXAVYd`, `1D-pJkLUu5c7H-zADT3MZtsIBA2ADWqo0`
  - Code: `src/gemini/prompts.ts`, `src/gemini/parser.ts`, `src/services/folder-structure.ts`

### Evidence

**4 different folders exist for the same BBVA Visa card:**
1. `BBVA Visa ` (empty account number)
2. `BBVA Visa 41198918`
3. `BBVA Visa 1198918`
4. `BBVA Visa 0941198918`

**PDF Analysis confirmed all statements show the same account number:**
- "Visa Business cuenta **0941198918** CONSOLIDADO" appears in all documents
- The account number is always 10 digits: `0941198918`

**Extracted values varied:**
- `0941198918` (correct - full 10 digits)
- `41198918` (missing leading `09`)
- `1198918` (missing leading `094`)
- Empty string (complete extraction failure)

### Root Cause

The Gemini prompt in `src/gemini/prompts.ts` line 465 says:
```
- numeroCuenta: Last 4-8 digits of card number (e.g., "65656454")
```

This causes two problems:

1. **Incorrect instruction**: BBVA card account numbers are 10 digits (`0941198918`), not 4-8 digits. The prompt's "4-8 digits" instruction causes Gemini to try to truncate/guess which subset to extract.

2. **Inconsistent extraction**: Since the actual number doesn't match the expected format, Gemini makes different decisions each time:
   - Sometimes extracts full 10 digits
   - Sometimes truncates leading zeros/digits
   - Sometimes fails entirely

The prompt should ask for the **full account number as shown** rather than specifying a digit count that doesn't match reality.

## Fix Plan

### Fix 1: Update credit card prompt to extract full account number

1. Write test in `src/gemini/prompts.test.ts`:
   - Test that `getResumenTarjetaPrompt()` output contains instruction for full account number
   - Test that prompt does NOT contain "4-8 digits" restriction
   - Test that prompt includes example with 10-digit number

2. Run test-runner (expect fail)

3. Update `src/gemini/prompts.ts` line 465:
   - Change from: `- numeroCuenta: Last 4-8 digits of card number (e.g., "65656454")`
   - Change to: `- numeroCuenta: Full card account number as shown on statement (e.g., "0941198918", "65656454"). Extract the complete number including any leading zeros - this is typically 4-10 digits.`
   - Update the example JSON to show a realistic 10-digit account number

4. Run test-runner (expect pass)

### Fix 2: Add parser validation for numeroCuenta in resumen_tarjeta

1. Write test in `src/gemini/parser.test.ts`:
   - Test parseResumenTarjetaResponse with empty numeroCuenta marks needsReview
   - Test parseResumenTarjetaResponse with valid numeroCuenta passes
   - Test parseResumenTarjetaResponse logs warning for short account numbers (< 4 digits)

2. Run test-runner (expect fail)

3. Update `src/gemini/parser.ts` in `parseResumenTarjetaResponse()`:
   - Add validation after JSON parse to check numeroCuenta
   - If empty or < 4 digits, set `needsReview = true` and log warning
   - This catches extraction failures before they create broken folder names

4. Run test-runner (expect pass)

### Fix 3: (Manual cleanup - document for user)

After the code fix is deployed:
1. Identify all documents in the 4 duplicate folders
2. Move all documents to the canonical folder `BBVA Visa 0941198918`
3. Delete the 3 incorrect folders: `BBVA Visa `, `BBVA Visa 41198918`, `BBVA Visa 1198918`
4. Re-run the scanner on any documents that were in incorrect folders to update spreadsheet references

**Note:** This manual cleanup step is documented here for user awareness but is outside the scope of code changes.

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Notes

**Why this wasn't caught earlier:**
- The first few statements may have been processed correctly with `0941198918`
- Subsequent statements with different extraction results created new folders
- No validation existed to flag suspiciously short/empty account numbers

**Prevention:**
- The parser validation (Fix 2) will catch future extraction failures before they create broken folder structures
- Consider adding a folder reconciliation check in future to detect duplicate folders for same card

**Testing the prompt change:**
- After deploying, manually upload a BBVA Visa statement and verify extraction produces `0941198918`
- The Gemini MCP can be used to test prompt variations before code deployment if needed

---

## Iteration 1

**Implemented:** 2026-02-01

### Completed
- Fix 1: Updated credit card prompt to extract full account number
  - Changed instruction from "Last 4-8 digits" to "Full card account number as shown on statement"
  - Updated example from "65656454" (8 digits) to "0941198918" (10 digits)
  - Added instruction to include leading zeros
  - Tests verify prompt contains correct wording and 10-digit example
- Fix 2: Added parser validation for numeroCuenta in resumen_tarjeta
  - Validates numeroCuenta is not empty or < 4 digits
  - Sets needsReview flag when validation fails
  - Logs warning for debugging
  - Tests cover empty, short (< 4), valid 4-digit, and valid 10-digit cases
- Bug fix: Added null check to numeroCuenta validation to prevent String(null) edge case
- Bug fix: Propagated data.needsReview to returned needsReview value
  - Fixed issue where tipoTarjeta and numeroCuenta validation flags were being silently ignored

### Files Modified
- `src/gemini/prompts.ts` - Updated numeroCuenta instruction and examples (lines 460, 465, 517)
- `src/gemini/prompts.test.ts` - Added 4 tests for prompt numeroCuenta validation (lines 173-199)
- `src/gemini/parser.ts` - Added numeroCuenta validation logic and needsReview propagation (lines 1117-1129, 1201-1204)
- `src/gemini/parser.test.ts` - Added 5 tests for parser numeroCuenta validation (lines 204-306)

### Pre-commit Verification
- bug-hunter: Found 2 bugs during implementation, fixed before proceeding. Final run: Passed (0 bugs found)
- test-runner: All 1350 tests pass
- builder: Zero warnings

### Review Findings

Files reviewed: 4
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Conventions

**Fix 1: Updated credit card prompt (prompts.ts)**
- Lines 460, 465, 517 correctly updated
- Prompt now instructs to extract full account number with leading zeros
- Example updated to show 10-digit number ("0941198918")

**Fix 2: Parser validation for numeroCuenta (parser.ts)**
- Lines 1117-1129: Validation handles null/undefined safely
- Lines 1201-1204: Properly propagates data.needsReview to returned value
- Uses project logger (not console.log)

**Tests (prompts.test.ts, parser.test.ts)**
- All 9 new tests have meaningful assertions
- Edge cases covered: empty, null, short (< 4), valid 4-digit, valid 10-digit
- No real customer data used

No issues found - all implementations are correct and follow project conventions.

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
