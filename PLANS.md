# Bug Fix Plan

**Created:** 2026-01-27
**Status:** COMPLETE
**Bug Report:** Files misclassified into wrong years. User reset base folder, uploaded a new batch to Entrada. Salamanca Distribuidora factura dated 01/11/2025 was filed in 2024/Egresos/11 - Noviembre instead of 2025/Egresos/11 - Noviembre.
**Category:** Extraction / Date Validation

## Investigation

### Context Gathered
- **MCPs used:**
  - Google Drive MCP - Listed folders, downloaded PDFs, examined file structure
  - Railway MCP - Retrieved deployment logs to trace processing
  - Gemini MCP - Tested extraction prompts to verify current behavior
- **Files examined:**
  - `/src/services/document-sorter.ts` - Year extraction from document dates
  - `/src/processing/extractor.ts` - `hasValidDate()` validation
  - `/src/gemini/parser.ts` - Date format validation (exists but not used for date validity)
  - `/src/utils/date.ts` - `parseArgDate()` function that handles multiple date formats
  - `/src/gemini/prompts.ts` - Prompt requests YYYY-MM-DD format
  - Railway logs showing file movement to wrong year folder

### Misplaced Files Found

| File | Wrong Folder | Parsed Date | Actual Date | Year Error |
|------|--------------|-------------|-------------|------------|
| Salamanca Distribuidora factura | 2024/Egresos/11 - Noviembre | 2024-11-01 | 2025-11-01 | 2024 → 2025 |
| BBVA USD Resumen | 2020/Bancos/BBVA... | 2020-12-01 | 2025-12-01 | 2020 → 2025 |
| FEDERACION RED FEDERAL factura | 2022/Egresos/11 - Noviembre | 2022-11-04 | 2025-11-06 | 2022 → 2025 |
| AMICIBRO S.A factura | 2029/Egresos/11 - Noviembre | 2029-11-13 | 2025-11-13 | 2029 → 2025 |

### Evidence

1. **Railway logs confirm file misclassification:**
   ```
   [INFO] Moved to 2024/Egresos/11 - Noviembre ... fileName="2025-11-03 - Salamanca..."
   [INFO] Moved to 2029/Egresos/11 - Noviembre ... fileName="2025-11-13 - AMICIBRO..."
   ```
   Files with correct 2025 dates in filenames were moved to wrong year folders.

2. **Gemini extraction is correct when tested now:**
   All 4 misplaced documents now correctly extract to 2025 dates when tested with Gemini MCP.
   The bug is intermittent - Gemini occasionally returned dates in non-ISO formats.

3. **JavaScript Date parsing ambiguity with DD/MM/YYYY:**
   ```javascript
   new Date("01/11/2025")  → January 11, 2025 (US format - MM/DD/YYYY)
   new Date("11/01/2025")  → November 1, 2025 (interpreted as MM/DD/YYYY)
   new Date("2025-11-01")  → November 1, 2025 (ISO format - correct)
   ```
   If Gemini returns DD/MM/YYYY instead of YYYY-MM-DD, JavaScript misparsing causes wrong dates.

4. **JavaScript Date parsing ambiguity with 2-digit years:**
   ```javascript
   new Date("11/13/29")  → November 13, 2029  (YY interpreted as 20YY for values < 30)
   new Date("12/01/20")  → December 1, 2020
   new Date("11/04/22")  → November 4, 2022
   ```
   If Gemini returns MM/DD/YY format with 2-digit year, JavaScript interprets 00-29 as 2000-2029.
   This explains all 4 misplaced files: 20→2020, 22→2022, 24→2024, 29→2029 (all should be 2025).

5. **`hasValidDate()` only checks for non-empty strings (extractor.ts:71):**
   ```typescript
   case 'factura_emitida':
   case 'factura_recibida':
     return !!d.fechaEmision && d.fechaEmision !== '';
   ```
   This passes invalid date formats like "01/11/25" without validating they can be correctly parsed.

6. **`getDocumentDate()` uses raw `new Date()` (document-sorter.ts:39):**
   ```typescript
   return new Date(doc.fechaEmision);
   ```
   No validation before use. If parsing fails or is ambiguous, wrong year is used.

### Root Cause

The date validation in `hasValidDate()` only checks if a date string is present and non-empty, but doesn't verify:
1. The date is in YYYY-MM-DD format (as requested in prompts)
2. The date can be parsed into a valid Date object
3. The parsed year is reasonable (not NaN, not in distant past/future)

**Two parsing failures identified:**

1. **DD/MM/YYYY → MM/DD/YYYY confusion:** When Gemini returns "01/11/2025" (Nov 1), JavaScript parses as January 11, 2025.

2. **2-digit year expansion:** When Gemini returns dates with 2-digit years like "11/13/25", JavaScript's `new Date()` interprets years 00-29 as 2000-2029. This explains all 4 misplaced files:
   - "12/01/20" → December 1, **2020** (should be 2025)
   - "11/04/22" → November 4, **2022** (should be 2025)
   - "01/11/24" → January 11, **2024** (should be November 1, 2025)
   - "11/13/29" → November 13, **2029** (should be 2025)

The codebase already has `parseArgDate()` in `src/utils/date.ts` that correctly handles multiple date formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD) with 4-digit years, but it's not being used in the document sorting flow. Using this function would reject 2-digit year formats entirely.

## Fix Plan

### Fix 1: Add date format validation helper in date.ts

1. Write test in `src/utils/date.test.ts` for new `isValidISODate()` function:
   - Test valid YYYY-MM-DD dates return true
   - Test DD/MM/YYYY dates return false (wrong format)
   - Test invalid dates like "2025-13-45" return false
   - Test empty strings return false
   - Test dates with invalid years (NaN, < 2000, > 2100) return false

2. Implement `isValidISODate()` in `src/utils/date.ts`:
   - Check format matches /^\d{4}-\d{2}-\d{2}$/
   - Parse with Date and verify getFullYear() returns reasonable year (2000-2100)
   - Return boolean

### Fix 2: Strengthen hasValidDate() to validate date format

1. Write test in `src/processing/extractor.test.ts` for `hasValidDate()`:
   - Test factura with valid YYYY-MM-DD returns true
   - Test factura with DD/MM/YYYY returns false
   - Test factura with invalid date string returns false
   - Test resumen with valid date range returns true
   - Test resumen with invalid dates returns false

2. Update `hasValidDate()` in `src/processing/extractor.ts`:
   - Import `isValidISODate` from utils/date.js
   - For each document type, validate that the date field passes `isValidISODate()`
   - Documents with invalid date formats should return false → sent to Sin Procesar

### Fix 3: Use parseArgDate() in getDocumentDate() with validation

1. Write test in `src/services/document-sorter.test.ts` for `getDocumentDate()`:
   - Test factura with YYYY-MM-DD returns correct Date
   - Test factura with DD/MM/YYYY returns correct Date (parseArgDate handles it)
   - Test pago with valid fechaPago returns correct Date
   - Test resumen with valid fechaHasta returns correct Date
   - Test document with invalid date throws or returns fallback

2. Update `getDocumentDate()` in `src/services/document-sorter.ts`:
   - Import `parseArgDate` from utils/date.js
   - Replace `new Date(doc.fechaEmision)` with `parseArgDate(doc.fechaEmision)`
   - Add validation: if parseArgDate returns null, throw an error
   - Remove fallback to `new Date()` - invalid dates should fail loudly, not silently use today's date

### Fix 4: Add sanity check for year in folder creation

1. Write test in `src/services/folder-structure.test.ts`:
   - Test that invalid years (NaN, < 2000, > current+1) throw errors
   - Test valid years work normally

2. Update `getOrCreateMonthFolder()` and related functions in `src/services/folder-structure.ts`:
   - Add validation that year is a valid number between 2000 and current year + 1
   - If year is invalid, return error Result instead of creating "NaN" folder

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings
