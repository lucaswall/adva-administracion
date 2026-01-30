# Implementation Plan

**Created:** 2026-01-30
**Source:** Inline request: Add `periodo` column (YYYY-MM format) as first column in Control Resumenes, sort by periodo ascending, and rename files using periodo instead of fechaHasta

## Context Gathered

### Codebase Analysis

**Related files:**
- `src/constants/spreadsheet-headers.ts` - Defines sheet headers for Resumenes (CONTROL_RESUMENES_BANCARIO_SHEET, CONTROL_RESUMENES_TARJETA_SHEET, CONTROL_RESUMENES_BROKER_SHEET)
- `src/processing/storage/resumen-store.ts` - Stores resumen rows (storeResumenBancario, storeResumenTarjeta, storeResumenBroker)
- `src/processing/storage/resumen-store.test.ts` - Tests for resumen storage
- `src/utils/file-naming.ts` - Generates file names (generateResumenFileName, generateResumenTarjetaFileName, generateResumenBrokerFileName)
- `src/utils/file-naming.test.ts` - Tests for file naming
- `src/processing/storage/movimientos-store.ts` - Uses `targetMonth = period.fechaHasta.substring(0, 7)` format for YYYY-MM sheets
- `SPREADSHEET_FORMAT.md` - Documents spreadsheet schemas

**Existing patterns:**
- `periodo` is derived from `fechaHasta.substring(0, 7)` (e.g., "2024-01-31" → "2024-01")
- Movimientos sheets already use YYYY-MM format for sheet names
- Current file names use `fechaDesde` date (e.g., "2024-01-15 - Resumen - BBVA - 1234567890 ARS.pdf")
- Sheets currently sorted by `fechaDesde` (column 0) ascending

**Test conventions:**
- Tests use vi.mock for dependencies
- Tests verify row structure and column order
- Use createTestResumen() helper functions

### Key Changes Required

1. **Spreadsheet headers** - Add `periodo` as first column (index 0)
   - Shifts all column indices by +1
   - Requires updating numberFormats Map indices

2. **Resumen storage** - Build `periodo` from `fechaHasta.substring(0, 7)`
   - Add periodo as first element in row array
   - Update duplicate detection to skip new column
   - Update sort column index (still column 0, but now periodo instead of fechaDesde)

3. **File naming** - Use `fechaHasta.substring(0, 7)` instead of `fechaDesde`
   - Format: "2024-01 - Resumen - BBVA - 1234567890 ARS.pdf"
   - Use YYYY-MM (month only) instead of YYYY-MM-DD (full date)

4. **Documentation** - Update SPREADSHEET_FORMAT.md

## Original Plan

### Task 1: Update spreadsheet headers with periodo column

1. Write test in `src/constants/spreadsheet-headers.test.ts` (new file):
   - Test that CONTROL_RESUMENES_BANCARIO_SHEET has 'periodo' as first header
   - Test that CONTROL_RESUMENES_TARJETA_SHEET has 'periodo' as first header
   - Test that CONTROL_RESUMENES_BROKER_SHEET has 'periodo' as first header
   - Test that numberFormats indices are correctly shifted (+1)
2. Run test-runner (expect fail)
3. Update `src/constants/spreadsheet-headers.ts`:
   - Add 'periodo' as first element in headers arrays for all three resumen sheets
   - Update numberFormats Map indices (+1 for all existing entries)
   - Update column count comments if present
4. Run test-runner (expect pass)

### Task 2: Update file naming functions to use periodo format

1. Write test in `src/utils/file-naming.test.ts`:
   - Update existing tests to expect YYYY-MM format (from fechaHasta)
   - Test: generateResumenFileName returns "2024-01 - Resumen - BBVA - 1234567890 ARS.pdf" (month from fechaHasta)
   - Test: generateResumenTarjetaFileName returns "2024-01 - Resumen - BBVA - Visa 4563.pdf"
   - Test: generateResumenBrokerFileName returns "2024-01 - Resumen Broker - BALANZ - 123456.pdf"
2. Run test-runner (expect fail)
3. Update `src/utils/file-naming.ts`:
   - generateResumenFileName: Use `resumen.fechaHasta.substring(0, 7)` instead of `resumen.fechaDesde`
   - generateResumenTarjetaFileName: Use `resumen.fechaHasta.substring(0, 7)` instead of `resumen.fechaDesde`
   - generateResumenBrokerFileName: Use `resumen.fechaHasta.substring(0, 7)` instead of `resumen.fechaDesde`
   - Update JSDoc comments to reflect new format
4. Run test-runner (expect pass)

### Task 3: Update resumen storage to include periodo column

1. Write test in `src/processing/storage/resumen-store.test.ts`:
   - Test that storeResumenBancario includes periodo as first column
   - Test periodo value is derived from fechaHasta (e.g., "2024-01-31" → "2024-01")
   - Test that row has 10 columns (was 9)
   - Update existing tests for new column indices
2. Run test-runner (expect fail)
3. Update `src/processing/storage/resumen-store.ts`:
   - storeResumenBancario: Add `const periodo = resumen.fechaHasta.substring(0, 7);` and add as first element
   - storeResumenTarjeta: Add periodo as first element
   - storeResumenBroker: Add periodo as first element
   - Update appendRowsWithLinks range from 'Resumenes!A:I' to 'Resumenes!A:J' (bancario/tarjeta) and 'A:H' to 'A:I' (broker)
   - Update isDuplicateResumenBancario column indices (+1)
   - Update isDuplicateResumenTarjeta column indices (+1)
   - Update isDuplicateResumenBroker column indices (+1)
4. Run test-runner (expect pass)

### Task 4: Update documentation

1. Update `SPREADSHEET_FORMAT.md`:
   - Add `periodo` as column A for all three Resumen types
   - Shift all existing columns (fechaDesde becomes B, etc.)
   - Update column counts (bancario: 10 cols A:J, tarjeta: 10 cols A:J, broker: 9 cols A:I)
   - Note that rows are sorted by periodo (column A) ascending

2. Update `CLAUDE.md`:
   - Update SPREADSHEETS section if Resumen schemas are mentioned
   - Note the periodo format matches Movimientos sheet names (YYYY-MM)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Iteration 1

**Implemented:** 2026-01-30

### Completed
- Task 1: Updated spreadsheet headers with periodo column
  - Added `periodo` as first column in CONTROL_RESUMENES_BANCARIO_SHEET (10 cols: A:J)
  - Added `periodo` as first column in CONTROL_RESUMENES_TARJETA_SHEET (10 cols: A:J)
  - Added `periodo` as first column in CONTROL_RESUMENES_BROKER_SHEET (9 cols: A:I)
  - Updated numberFormats indices (+1 for all existing date/currency columns)
  - Created comprehensive test suite in `src/constants/spreadsheet-headers.test.ts`

- Task 2: Updated file naming functions to use periodo format
  - Modified `generateResumenFileName()` to use `fechaHasta.substring(0, 7)` (YYYY-MM format)
  - Modified `generateResumenTarjetaFileName()` to use `fechaHasta.substring(0, 7)`
  - Modified `generateResumenBrokerFileName()` to use `fechaHasta.substring(0, 7)`
  - Updated JSDoc comments to reflect YYYY-MM format instead of YYYY-MM-DD
  - Updated all test expectations to match new YYYY-MM format

- Task 3: Updated resumen storage to include periodo column
  - Modified `isDuplicateResumenBancario()` to handle 10-column structure with periodo
  - Modified `isDuplicateResumenTarjeta()` to handle 10-column structure with periodo
  - Modified `isDuplicateResumenBroker()` to handle 9-column structure with periodo
  - Updated `storeResumenBancario()` to derive periodo from fechaHasta and insert as first column
  - Updated `storeResumenTarjeta()` to derive periodo from fechaHasta and insert as first column
  - Updated `storeResumenBroker()` to derive periodo from fechaHasta and insert as first column
  - Changed range from 'Resumenes!A:I' to 'Resumenes!A:J' (bancario/tarjeta)
  - Changed range from 'Resumenes!A:H' to 'Resumenes!A:I' (broker)
  - Updated all sorting to use column 0 (now periodo instead of fechaDesde)
  - Updated all test expectations for new column structure

- Task 4: Updated documentation
  - Updated SPREADSHEET_FORMAT.md with periodo column details for all three Resumen types
  - Added sorting notes indicating rows sorted by periodo ascending
  - Updated column counts (bancario: 10 cols A:J, tarjeta: 10 cols A:J, broker: 9 cols A:I)
  - Updated CLAUDE.md SPREADSHEETS section with periodo information
  - Added note that periodo format matches Movimientos sheet names (YYYY-MM)

### Checklist Results
- bug-hunter: Found 2 bugs, fixed both
  - Fixed test mock to use fechaHasta instead of fechaDesde
  - Updated test description from "fechaDesde" to "periodo"
- test-runner: All 1,078 tests passed (53 test files, 7.34s)
- builder: Passed with zero warnings

### Notes
- All changes follow strict TDD workflow (red-green-refactor)
- Periodo column is derived from fechaHasta (YYYY-MM format) for consistency with Movimientos sheets
- File names now use periodo format (e.g., "2024-01 - Resumen - BBVA - 1234567890 ARS.pdf")
- Sorting by periodo provides chronological ordering that aligns with monthly statements
- Duplicate detection logic remains unchanged (skips periodo column, matches on business keys)
- No breaking changes to external APIs or folder structure
