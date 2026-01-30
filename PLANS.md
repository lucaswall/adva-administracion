# Bug Fix Plan

**Created:** 2026-01-29
**Bug Report:** Marcial Fermin Gutierrez factura_emitida has empty CUIT in spreadsheet despite CUIT being present in PDF
**Category:** Extraction / Prompt Reliability

## Investigation

### Context Gathered
- **MCPs used:** Google Drive MCP (file retrieval), Gemini MCP (prompt testing)
- **Files examined:**
  - `2025-11-10 - Factura Emitida - 00005-00000035 - Marcial Fermin Gutierrez` (file ID: `1Noz78UoBQfIpfN2Twk-S-PrpzRt68CZ3`)
  - `src/gemini/prompts.ts` (FACTURA_PROMPT)
  - `src/gemini/parser.ts` (assignCuitsAndClassify, parseFacturaResponse)

### Evidence

**PDF Content Analysis:**
The invoice clearly shows:
- `Doc. Receptor: 20367086921` (client's CUIT)
- `Cliente: Marcial Fermin Gutierrez`
- `IVA Receptor: Consumidor Final`

**Gemini MCP Testing (2026-01-29):**
Tested the FACTURA_PROMPT against the PDF twice:
1. Custom prompt asking specifically for CUITs: Extracted `["30709076783", "20367086921"]` correctly
2. Actual FACTURA_PROMPT: Also extracted `["30709076783", "20367086921"]` correctly

**Spreadsheet State:**
Row 21 in Control de Ingresos > Facturas Emitidas shows empty `cuitReceptor` despite CUIT being present in PDF.

### Root Cause

**Non-deterministic Gemini extraction:**

The FACTURA_PROMPT instructs Gemini to extract "ALL CUITs found in the document", but:
1. The client's identification is labeled "Doc. Receptor" not "CUIT"
2. Gemini extraction is probabilistic - same prompt can produce different results
3. During actual processing, Gemini likely did not extract `20367086921` because it wasn't labeled as "CUIT"
4. The `allCuits` array only contained `["30709076783"]`, so `assignCuitsAndClassify` returned empty `cuitReceptor`

**Why testing passed now:**
- Gemini models have some variance in extraction
- The prompt improvements I tested happened to work, but the original processing may have had a different result
- This is a reliability issue, not a complete failure

### Impact Assessment

**Severity:** MEDIUM
- Missing CUIT affects matching with payments
- Doesn't prevent file processing (moved to correct folder)
- Affects data completeness for accounting

**Scope:**
- Only affects invoices where client ID is labeled differently (e.g., "Doc. Receptor", "DNI Receptor")
- Consumidor Final clients often have non-standard labeling
- Most B2B invoices have "CUIT" label and work correctly

## Fix Plan

### Task 1: Enhance FACTURA_PROMPT to explicitly handle Doc. Receptor and other ID labels

**Rationale:** The prompt currently only mentions "CUIT" for identification numbers. Argentine invoices for Consumidor Final clients use "Doc. Receptor" or "DNI" labels instead.

1. Write test in `src/gemini/parser.test.ts`:
   - Test that extraction handles `allCuits` with various ID formats
   - Test normalization of IDs with different lengths (CUIT=11 digits, DNI=7-8 digits)

2. Update `src/gemini/prompts.ts` FACTURA_PROMPT:
   - In section "3. ALL CUITs", explicitly mention alternative labels:
     - "Doc. Receptor" (common for Consumidor Final)
     - "DNI" (national ID, 7-8 digits)
     - "CUIL" (worker ID, 11 digits)
   - Add example showing these formats
   - Emphasize: "Even if labeled differently, include ALL 11-digit identification numbers"

3. Run test-runner to verify tests pass

### Task 2: Test updated prompt with Gemini MCP against sample files

**Rationale:** Before deploying prompt changes, verify they work correctly on multiple document types.

**Test files from `_samples/`:**

1. Test with Consumidor Final invoice (Doc. Receptor label):
   - Use file: `_samples/2025/CobrosFacturas/11-2025/30709076783_011_00005_00000034.pdf` (if available) or similar
   - Verify: `allCuits` contains both ADVA's CUIT and client's ID

2. Test with standard B2B invoice (CUIT label):
   - Use file: `_samples/2025/CobrosFacturas/11-2025/30709076783_011_00003_00002178.pdf`
   - Verify: No regression, both CUITs extracted

3. Test with factura_recibida (client is ADVA):
   - Use file: `_samples/2025/Pagos/11/2025-11-03 - Salamanca Distribuidora S.A. - EVA2025 - Vianda voluntarios - B00200-00064069.pdf`
   - Verify: Both CUITs extracted correctly

4. Document test results in this plan

### Task 3: Add validation warning for empty cuitReceptor in factura_emitida

**Rationale:** Even with improved prompt, extraction may occasionally fail. Add explicit logging when this happens.

1. Update `src/gemini/parser.ts` `parseFacturaResponse`:
   - After CUIT assignment for `factura_emitida`, if `cuitReceptor` is empty:
     - Log warning with file context
     - Set `needsReview = true` regardless of confidence
   - This ensures human review for edge cases

2. Run test-runner to verify tests pass

### Task 4: Update CLAUDE.md documentation

1. In `CLAUDE.md`, under DOCUMENT CLASSIFICATION or relevant section:
   - Note that Consumidor Final invoices may use "Doc. Receptor" instead of "CUIT"
   - Document that empty cuitReceptor triggers review flag

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

## Recovery for Current File

After deploying the fix:
1. The file is already processed and in the correct folder (2025/Ingresos/11 - Noviembre/)
2. Manually update row 21 in Control de Ingresos > Facturas Emitidas:
   - Set `cuitReceptor` to `20367086921`
3. This is a one-time manual fix; new processing will extract correctly
