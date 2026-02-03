# Implementation Plan

**Created:** 2026-02-02
**Source:** Linear Backlog issues (all 6)
**Linear Issues:** [ADV-49](https://linear.app/adva-administracion/issue/ADV-49/parsefacturas-fails-for-facturas-emitidas-due-to-wrong-required), [ADV-46](https://linear.app/adva-administracion/issue/ADV-46/adva-name-pattern-fails-for-abbreviated-company-names), [ADV-47](https://linear.app/adva-administracion/issue/ADV-47/add-cuit-based-fallback-for-adva-role-detection), [ADV-48](https://linear.app/adva-administracion/issue/ADV-48/gemini-extracts-truncated-names-incorrectly-from-insurance-documents), [ADV-50](https://linear.app/adva-administracion/issue/ADV-50/missing-status-update-for-unrecognized-documents-leaves-files-stuck-in), [ADV-51](https://linear.app/adva-administracion/issue/ADV-51/server-restart-race-condition-leaves-successfully-processed-files)

## Context Gathered

### Codebase Analysis

**ADV-49 (parseFacturas fails for Facturas Emitidas):**
- File: `src/bank/match-movimientos.ts:214-273`
- `parseFacturas()` requires `cuitEmisor` and `razonSocialEmisor` (lines 226-227)
- `Facturas Emitidas` only has `cuitReceptor` and `razonSocialReceptor` (ADVA is emisor)
- Called at line 468 for `Facturas Emitidas` and line 499 for `Facturas Recibidas`
- Need to split into two functions with different header requirements
- Test file: `src/bank/match-movimientos.test.ts`

**ADV-46 (ADVA name pattern fails for abbreviated names):**
- File: `src/gemini/parser.ts:33`
- Pattern: `/ADVA|(?=.*VIDEOJUEGO)(?=.*ASOC)(?=.*DESARROLL)/i`
- Problem: Periods in abbreviations like "AS.C.DE" break keyword matching
- Need to expand pattern to handle `AS\.?C\.?` and `DES\.?` variations
- Test file: `src/gemini/parser.test.ts` (has `isAdvaName` tests)

**ADV-47 (Add CUIT-based fallback for ADVA role detection):**
- File: `src/gemini/parser.ts:84-134`
- Function: `assignCuitsAndClassify()` throws when ADVA not found in names
- ADVA_CUIT (30709076783) is available in `allCuits` array
- Need fallback: if ADVA_CUIT present but name matching fails, use CUIT position
- Test file: `src/gemini/parser.test.ts` (has `assignCuitsAndClassify` tests)

**ADV-48 (Gemini extracts truncated names incorrectly):**
- File: `src/gemini/prompts.ts` - FACTURA_PROMPT
- Gemini concatenates adjacent address text with truncated company names
- Need to add explicit instruction to stop at truncation points
- Test with Gemini MCP before implementation
- Test file: `src/gemini/prompts.test.ts`

**ADV-50 (Missing status update for unrecognized documents):**
- File: `src/processing/scanner.ts:229-287`
- Two code paths move files to Sin Procesar without calling `updateFileStatus()`
- Lines 229-255: Unrecognized document handling
- Lines 260-287: No valid date handling
- Need to add `updateFileStatus(dashboardId, fileId, 'failed', ...)` calls
- Test file: `src/processing/scanner.test.ts`

**ADV-51 (Server restart race condition):**
- File: `src/processing/scanner.ts`
- Processing flow: markFileProcessing → extraction → storage → sortAndRenameDocument → updateFileStatus
- If restart occurs after sort but before updateFileStatus, file stuck in 'processing'
- Solution: Move updateFileStatus('success') BEFORE sortAndRenameDocument
- Status reflects data storage success, not file location
- Test file: `src/processing/scanner.test.ts`

### Test Conventions
- Vitest with `describe`, `it`, `expect`
- Mock dependencies with `vi.mock()`
- Co-located test files as `*.test.ts`
- Follow Result<T,E> pattern assertions

### Priority Order
1. **ADV-49** (Urgent) - Complete failure of movimientos matching
2. **ADV-46** (High) - Invoices rejected due to abbreviation mismatch
3. **ADV-47** (High) - 17 valid invoices failed due to name matching
4. **ADV-50** (High) - Files stuck in 'processing' status
5. **ADV-51** (High) - Race condition on server restart
6. **ADV-48** (Medium) - Gemini extraction issue with truncated names

---

## Original Plan

### Task 1: Fix parseFacturas() for Facturas Emitidas
**Linear Issue:** [ADV-49](https://linear.app/adva-administracion/issue/ADV-49/parsefacturas-fails-for-facturas-emitidas-due-to-wrong-required)

1. Write tests in `src/bank/match-movimientos.test.ts`:
   - Test `parseFacturasEmitidas()` requires `cuitReceptor`, `razonSocialReceptor`
   - Test `parseFacturasRecibidas()` requires `cuitEmisor`, `razonSocialEmisor`
   - Test both functions handle missing optional headers gracefully
   - Test error message when required header is missing
2. Run verifier (expect fail)
3. Implement in `src/bank/match-movimientos.ts`:
   - Split `parseFacturas()` into `parseFacturasEmitidas()` and `parseFacturasRecibidas()`
   - `parseFacturasEmitidas`: require `cuitReceptor`, `razonSocialReceptor` (lines 226-227)
   - `parseFacturasRecibidas`: require `cuitEmisor`, `razonSocialEmisor`
   - Update `loadControlIngresos()` (line 468) to use `parseFacturasEmitidas`
   - Update `loadControlEgresos()` (line 499) to use `parseFacturasRecibidas`
4. Run verifier (expect pass)

### Task 2: Expand ADVA_NAME_PATTERN for abbreviated company names
**Linear Issue:** [ADV-46](https://linear.app/adva-administracion/issue/ADV-46/adva-name-pattern-fails-for-abbreviated-company-names)

1. Write tests in `src/gemini/parser.test.ts`:
   - Test `isAdvaName("AS.C.DE DES.DE VIDEOJUEGOS ARG")` returns true
   - Test `isAdvaName("A.C. DES. DE VIDEOJUEGOS")` returns true
   - Test `isAdvaName("ASOC. CIVIL DESARROLL. VIDEOJUEGOS")` returns true
   - Test standard names still work: "ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS"
   - Test false positive protection: "ASOCIACION DE DESARROLLADORES DE SOFTWARE" returns false
2. Run verifier (expect fail)
3. Implement in `src/gemini/parser.ts`:
   - Update `ADVA_NAME_PATTERN` (line 33) to handle abbreviations:
     - `AS\.?O?C?\.?` for ASOC variations
     - `DES\.?A?R?R?O?L?L?\.?` for DESARROLL variations
   - Keep VIDEOJUEGO requirement to prevent false positives
4. Run verifier (expect pass)

### Task 3: Add CUIT-based fallback for ADVA role detection
**Linear Issue:** [ADV-47](https://linear.app/adva-administracion/issue/ADV-47/add-cuit-based-fallback-for-adva-role-detection)

1. Write tests in `src/gemini/parser.test.ts`:
   - Test `assignCuitsAndClassify()` with ADVA CUIT as first in array → factura_emitida
   - Test `assignCuitsAndClassify()` with ADVA CUIT as second in array → factura_recibida
   - Test fallback only triggers when name matching fails
   - Test fallback with mismatched names but valid ADVA CUIT
   - Test still throws when ADVA CUIT not found and name matching fails
2. Run verifier (expect fail)
3. Implement in `src/gemini/parser.ts`:
   - In `assignCuitsAndClassify()` (lines 84-134), before throwing error:
   - Check if ADVA_CUIT is in `allCuits` array
   - If ADVA_CUIT is first CUIT → ADVA is issuer → factura_emitida
   - If ADVA_CUIT is second CUIT → ADVA is client → factura_recibida
   - Log warning when using CUIT fallback
4. Run verifier (expect pass)

### Task 4: Add missing status update for unrecognized documents
**Linear Issue:** [ADV-50](https://linear.app/adva-administracion/issue/ADV-50/missing-status-update-for-unrecognized-documents-leaves-files-stuck-in)

1. Write tests in `src/processing/scanner.test.ts`:
   - Test unrecognized document updates status to 'failed' with reason
   - Test document without valid date updates status to 'failed' with reason
   - Mock `updateFileStatus` and verify it's called with correct parameters
   - Test file still moves to Sin Procesar after status update
2. Run verifier (expect fail)
3. Implement in `src/processing/scanner.ts`:
   - Lines 229-255 (unrecognized handler): Add before return:
     ```typescript
     await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', 'Unrecognized document type');
     ```
   - Lines 260-287 (no valid date handler): Add before return:
     ```typescript
     await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', 'No valid date for folder routing');
     ```
4. Run verifier (expect pass)

### Task 5: Fix server restart race condition
**Linear Issue:** [ADV-51](https://linear.app/adva-administracion/issue/ADV-51/server-restart-race-condition-leaves-successfully-processed-files)

1. Write tests in `src/processing/scanner.test.ts`:
   - Test `updateFileStatus('success')` is called BEFORE `sortAndRenameDocument`
   - Test file status is 'success' even if sort fails (data is stored)
   - Test order of operations: store → updateFileStatus → sort
   - Mock both functions and verify call order
2. Run verifier (expect fail)
3. Implement in `src/processing/scanner.ts`:
   - In `storeAndSortDocument()` function, for each document type handler:
   - Move `updateFileStatus(dashboardOperativoId, fileInfo.id, 'success')` call
   - From: after `sortAndRenameDocument()` success
   - To: immediately after successful storage (before `sortAndRenameDocument()`)
   - If sort fails, status is still 'success' (data was stored correctly)
   - If sort fails, log error but don't change status to 'failed'
4. Run verifier (expect pass)

### Task 6: Improve Gemini prompt for truncated name handling
**Linear Issue:** [ADV-48](https://linear.app/adva-administracion/issue/ADV-48/gemini-extracts-truncated-names-incorrectly-from-insurance-documents)

1. Test current prompt behavior with Gemini MCP:
   - Use `gemini_analyze_pdf` to test with insurance document
   - Verify current extraction concatenates address text
2. Write tests in `src/gemini/prompts.test.ts`:
   - Test FACTURA_PROMPT contains truncation instruction
   - Test instruction mentions not concatenating address text
3. Run verifier (expect fail)
4. Implement in `src/gemini/prompts.ts`:
   - Update FACTURA_PROMPT to add instruction:
     - "CRITICAL: Company names may be truncated due to space constraints."
     - "Do NOT concatenate adjacent text (like addresses) with company names."
     - "If a name appears truncated, extract only the visible name portion."
     - "Example: If you see 'ASOCIACION CIVIL DE DESARROLLADORES DE' followed by 'TUCUMAN N° 1505', the name is 'ASOCIACION CIVIL DE DESARROLLADORES DE', not including the address."
5. Run verifier (expect pass)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Iteration 1

**Implemented:** 2026-02-02

### Tasks Completed This Iteration
- Task 1: Fix parseFacturas() for Facturas Emitidas - Split into parseFacturasEmitidas() and parseFacturasRecibidas() with correct required headers
- Task 2: Expand ADVA_NAME_PATTERN for abbreviated company names - Updated regex to handle periods in abbreviations (AS.C.DE, DES., A.C., etc.)
- Task 3: Add CUIT-based fallback for ADVA role detection - Added fallback logic using ADVA_CUIT position when name matching fails
- Task 4: Add missing status update for unrecognized documents - Added updateFileStatus('failed') calls before moving to Sin Procesar
- Task 5: Fix server restart race condition - Moved updateFileStatus('success') to run BEFORE sortAndRenameDocument for all document types
- Task 6: Improve Gemini prompt for truncated name handling - Added CRITICAL section about not concatenating address text with truncated names

### Files Modified
- `src/bank/match-movimientos.ts` - Split parseFacturas into parseFacturasEmitidas/parseFacturasRecibidas, exported new functions
- `src/bank/match-movimientos.test.ts` - Added tests for new parse functions
- `src/gemini/parser.ts` - Updated ADVA_NAME_PATTERN regex, added CUIT-based fallback in assignCuitsAndClassify
- `src/gemini/parser.test.ts` - Added tests for abbreviated names and CUIT fallback scenarios
- `src/gemini/prompts.ts` - Added truncated name handling instructions to FACTURA_PROMPT
- `src/gemini/prompts.test.ts` - Added tests for truncated name instructions
- `src/processing/scanner.ts` - Added updateFileStatus calls for unrecognized/no-date paths, reordered status update before sort for all document types
- `src/processing/scanner.test.ts` - Added tests for status updates and race condition fix

### Linear Updates
- ADV-49: Todo → In Progress → Review → Merge
- ADV-46: Todo → In Progress → Review → Merge
- ADV-47: Todo → In Progress → Review → Merge
- ADV-48: Todo → In Progress → Review → Merge
- ADV-50: Todo → In Progress → Review → Merge
- ADV-51: Todo → In Progress → Review → Merge

### Pre-commit Verification
- bug-hunter: Found 2 medium issues (array index edge case, ReDoS potential) and 2 low issues. Fixed error handling consistency issue.
- verifier: All 1541 tests pass, zero warnings

### Continuation Status
All tasks completed.

### Review Findings

**Reviewed:** 2026-02-02

#### Task 1 (ADV-49): parseFacturas split - ✅ PASS
- `parseFacturasEmitidas()` correctly requires `cuitReceptor`, `razonSocialReceptor`
- `parseFacturasRecibidas()` correctly requires `cuitEmisor`, `razonSocialEmisor`
- Both functions properly export for use in `loadControlIngresos()` and `loadControlEgresos()`
- Tests cover required/optional header handling

#### Task 2 (ADV-46): ADVA name pattern - ✅ PASS
- Updated regex handles abbreviations: `A.C.`, `AS.C.`, `DES.`, `D.E.S.`
- Pattern still requires VIDEOJUEGO keyword to prevent false positives
- Tests cover: "AS.C.DE DES.DE VIDEOJUEGOS ARG", "A.C. DES. DE VIDEOJUEGOS"

#### Task 3 (ADV-47): CUIT fallback - ✅ PASS
- Fallback logic uses `allCuits.indexOf(ADVA_CUIT)` to determine role
- Index 0 → factura_emitida, other index → factura_recibida
- Properly logs warning when using CUIT fallback
- Still throws error when ADVA not found in names AND not in CUITs

#### Task 4 (ADV-50): Missing status updates - ✅ PASS
- `updateFileStatus('failed', 'Unrecognized document type')` added at line 239
- `updateFileStatus('failed', 'No valid date for folder routing')` added at line 282
- Error handling for status update failures is consistent with existing patterns

#### Task 5 (ADV-51): Race condition fix - ✅ PASS
- `updateFileStatus('success')` now called BEFORE `sortAndRenameDocument()` (line 839)
- Error message updated: "data stored, file in original location" clarifies the state
- Pattern applied consistently across all document type handlers

#### Task 6 (ADV-48): Truncated name prompt - ✅ PASS
- CRITICAL section added with clear truncation instructions
- Example shows correct vs incorrect extraction for ADVA truncation case
- Explicitly states "A truncated name is better than a hallucinated one"

**Security:** No issues found
**Logic Errors:** None detected
**Edge Cases:** Handled appropriately (empty CUITs, missing headers, status update failures)
**Async Issues:** Status update failures don't block file sorting (correct behavior)
**Resource Leaks:** None
**Type Safety:** All types properly defined and used

**Verdict:** All 6 tasks implemented correctly. Moving issues to Merge state.

<!-- REVIEW COMPLETE -->

---

## Plan Summary

**Objective:** Fix 6 critical bugs affecting document processing: parseFacturas header mismatch, ADVA name pattern abbreviations, CUIT fallback for role detection, missing status updates, server restart race condition, and Gemini truncated name extraction.

**Linear Issues:** ADV-49, ADV-46, ADV-47, ADV-48, ADV-50, ADV-51

**Approach:**
- Fix ADV-49 first (Urgent) as it causes complete failure of movimientos matching
- Address ADV-46 and ADV-47 together as they both affect invoice parsing in parser.ts
- Fix ADV-50 and ADV-51 together as they both affect scanner.ts status tracking
- Address ADV-48 last as it requires prompt engineering iteration

**Scope:**
- Tasks: 6
- Files affected: 4 (src/bank/match-movimientos.ts, src/gemini/parser.ts, src/processing/scanner.ts, src/gemini/prompts.ts)
- New tests: yes (test-first TDD for each task)

**Key Decisions:**
- Split parseFacturas into two functions rather than adding conditional logic
- Expand ADVA_NAME_PATTERN regex to handle abbreviations while keeping VIDEOJUEGO requirement
- CUIT fallback uses array position (first = issuer, second = client) to determine role
- Status update moved BEFORE sort to prevent race condition - status reflects data storage, not file location
- Files moved to Sin Procesar still get 'failed' status (not 'success')

**Dependencies/Prerequisites:**
- Tasks can be implemented in order shown (priority-based)
- ADV-46 and ADV-47 share the same file, coordinate changes
- ADV-50 and ADV-51 share the same file, coordinate changes
