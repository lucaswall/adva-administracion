# Implementation Plan

**Created:** 2026-01-30
**Source:** Inline request: Add Detalles column matching for Movimientos sheets

## Context Gathered

### Codebase Analysis

**Current Project (adva-administracion):**
- `src/bank/autofill.ts` - Already matches bank movements against Control de Ingresos/Egresos
- `src/bank/matcher.ts` - `BankMovementMatcher` class handles **debit** matching only (line 258 checks for debito)
- `src/processing/storage/movimientos-store.ts` - Stores bank movements to per-month sheets with 6 columns (A:F)
- `src/constants/spreadsheet-headers.ts` - Defines `MOVIMIENTOS_BANCARIO_SHEET` with 6 headers
- `src/routes/scan.ts` - Has `/api/autofill-bank` route, does NOT trigger autofill after scan
- `apps-script/src/main.ts` - Dashboard menu with "Auto-fill Bank Data" option

**Current Movimientos Bancario Schema (6 columns A:F):**
- fecha, origenConcepto, debito, credito, saldo, saldoCalculado

**New schema (7 columns A:G):**
- fecha, origenConcepto, debito, credito, saldo, saldoCalculado, **detalles** (new)

### Data Sources for Matching

**Control de Ingresos (for CREDIT movements - money IN to ADVA):**
- Facturas Emitidas - Invoices issued BY ADVA (client pays us)
- Pagos Recibidos - Payments received BY ADVA
- Retenciones Recibidas - Tax withholdings (client retains this amount for AFIP, NOT a bank movement)

**Important: Retenciones affect matching but are NOT bank credits**
When a client pays a Factura Emitida, they may withhold taxes:
- Factura Total: $100,000
- Bank Credit (Pago Recibido): $95,000
- Retencion (to AFIP): $5,000
- Formula: `Bank Credit = Factura Total - Retenciones`

Matching must account for this difference when comparing credit amounts to Factura Emitida totals.

**Control de Egresos (for DEBIT movements - money OUT from ADVA):**
- Facturas Recibidas - Invoices received BY ADVA (we pay supplier)
- Pagos Enviados - Payments sent BY ADVA
- Recibos - Salary receipts (we pay employees)

### Current Matcher Limitation

The existing `BankMovementMatcher` in `src/bank/matcher.ts` only handles **debits**:
```typescript
const amount = movement.debito;
if (amount === null || amount === 0) {
  return this.noMatch(movement, ['No debit amount']);
}
```

**This plan adds credit matching** using Control de Ingresos data.

### Matching Strategy

**For DEBIT movements (existing logic):**
1. Bank fees auto-detection (patterns like "IMPUESTO LEY", "COMISION")
2. Credit card payment auto-detection ("PAGO TARJETA")
3. Pago Enviado → linked Factura Recibida (best match)
4. Direct Factura Recibida match (amount + date + CUIT/keyword)
5. Recibo match (salary payments)
6. Pago Enviado without linked Factura (REVISAR)

**For CREDIT movements (new logic):**
1. Pago Recibido → linked Factura Emitida (best match) → "Cobro Factura de [Cliente]"
2. Direct Factura Emitida match with retencion tolerance:
   - If `Credit Amount + Related Retenciones ≈ Factura Total` → match
   - Related retenciones: same CUIT, date range, amounts that sum correctly
   - Example: Credit $95,000 + Retencion $5,000 = Factura $100,000 → match
3. Pago Recibido without linked Factura → "REVISAR! Cobro de [Pagador]"

### Date Filtering

Only process movements from current year and previous year (e.g., 2025 and 2026 if today is 2026-01-30).
Month sheet names are YYYY-MM format.

### API & Memory Optimization Strategy

**Minimize Sheets API Calls:**
1. **Read Control data ONCE at start** - Load Facturas, Pagos, Recibos, Retenciones from both Control de Ingresos and Control de Egresos once, reuse for all banks
2. **Use metadata for sheet discovery** - Call `getSheetMetadata()` once per bank spreadsheet to get sheet names, filter to YYYY-MM pattern matching current/previous year (avoid reading non-existent sheets)
3. **Batch updates** - Collect all detalles updates per spreadsheet, use single `batchUpdate()` call instead of individual cell updates

**Memory Management (Railway VM ~512MB):**
1. **Process banks sequentially** - Load movimientos for one bank at a time, process, write, then release memory before next bank
2. **Control data stays loaded** - Ingresos/Egresos data (~1000s of rows) stays in memory throughout (reasonable size)
3. **Stream updates** - Don't accumulate all updates across all banks; write after each bank completes

**Estimated API Calls per execution:**
- Control de Ingresos: 3 reads (Facturas Emitidas, Pagos Recibidos, Retenciones)
- Control de Egresos: 3 reads (Facturas Recibidas, Pagos Enviados, Recibos)
- Per bank spreadsheet: 1 metadata + N month sheet reads + 1 batch update
- Total: 6 + (banks × (1 + months + 1)) ≈ 6 + (5 banks × 15 calls) = ~81 calls

## Original Plan

### Task 1: Add detalles column to Movimientos Bancario schema

1. Write test in `src/constants/spreadsheet-headers.test.ts`:
   - Test that `MOVIMIENTOS_BANCARIO_SHEET.headers` has 7 columns
   - Test that column index 6 is 'detalles'

2. Run test-runner (expect fail)

3. Update `src/constants/spreadsheet-headers.ts`:
   - Add 'detalles' to `MOVIMIENTOS_BANCARIO_SHEET.headers` array

4. Run test-runner (expect pass)

### Task 2: Update movimientos-store to include empty detalles column

1. Write test in `src/processing/storage/movimientos-store.test.ts`:
   - Test that stored rows have 7 columns (not 6)
   - Test that column G (index 6) is empty string for new movimientos

2. Run test-runner (expect fail)

3. Update `src/processing/storage/movimientos-store.ts`:
   - Update `storeMovimientosBancario` to append empty string for detalles column (7th column)
   - Update range from `A:F` to `A:G`
   - Add empty detalles to SALDO INICIAL, transaction, and SALDO FINAL rows

4. Run test-runner (expect pass)

### Task 3: Extend BankMovementMatcher to handle credit movements

1. Write test in `src/bank/matcher.test.ts`:
   - Test `matchCreditMovement` matches against Pago Recibido with linked Factura Emitida
   - Test `matchCreditMovement` matches direct Factura Emitida with exact amount
   - Test `matchCreditMovement` matches Factura Emitida with retencion tolerance:
     - Credit $95,000 + Retencion $5,000 (same CUIT) = Factura $100,000 → match
   - Test `matchCreditMovement` matches Pago Recibido without linked Factura
   - Test credit movement with no match returns no_match
   - Test CUIT extraction from concepto works for credits

2. Run test-runner (expect fail)

3. Update `src/bank/matcher.ts`:
   - Add `Retencion` to imports from types
   - Add `matchCreditMovement` method to `BankMovementMatcher` class:
     ```typescript
     matchCreditMovement(
       movement: BankMovement,
       facturasEmitidas: Array<Factura & { row: number }>,
       pagosRecibidos: Array<Pago & { row: number }>,
       retenciones: Array<Retencion & { row: number }>
     ): BankMovementMatchResult
     ```
   - Priority order for credits:
     1. Pago Recibido with linked Factura Emitida → "Cobro Factura de [Cliente] - [Concepto]"
     2. Direct Factura Emitida match (with retencion tolerance):
        - Find retenciones with same CUIT (cuitAgenteRetencion) and date range
        - Check if `Credit + sum(retenciones.montoRetencion) ≈ Factura.importeTotal`
        - → "Cobro Factura de [Cliente] - [Concepto]"
     3. Pago Recibido without linked Factura → "REVISAR! Cobro de [Pagador]"
   - Add helper methods:
     - `findMatchingPagosRecibidos` - match by amount, date, CUIT
     - `findMatchingFacturasEmitidas` - match by amount (with retencion tolerance), date, CUIT
     - `findRelatedRetenciones` - find retenciones for same CUIT within date range

4. Run test-runner (expect pass)

### Task 4: Create movimientos-reader service to read from per-month sheets

1. Write test in `src/services/movimientos-reader.test.ts`:
   - Test `getRecentMovimientoSheets` returns sheets for current + previous year only
   - Test `readMovimientosForPeriod` reads and parses data correctly
   - Test filtering of sheets by year (e.g., "2025-01" included, "2023-12" excluded)
   - Test parsing of empty detalles column
   - Test skipping SALDO INICIAL and SALDO FINAL rows

2. Run test-runner (expect fail)

3. Implement `src/services/movimientos-reader.ts`:
   ```typescript
   interface MovimientoRow {
     sheetName: string;   // e.g., "2025-01"
     rowNumber: number;   // Row in sheet (1-indexed, after header)
     fecha: string;
     origenConcepto: string;
     debito: number | null;
     credito: number | null;
     saldo: number | null;
     saldoCalculado: number | null;
     detalles: string;
   }

   // Get sheet names matching YYYY-MM pattern for current + previous year
   // Uses getSheetMetadata() - 1 API call to discover all sheets
   async function getRecentMovimientoSheets(
     spreadsheetId: string,
     currentYear: number
   ): Promise<Result<string[], Error>>

   // Read movimientos from a specific month sheet
   async function readMovimientosForPeriod(
     spreadsheetId: string,
     sheetName: string
   ): Promise<Result<MovimientoRow[], Error>>

   // Get all recent movimientos with empty detalles (excludes SALDO INICIAL/FINAL)
   // Calls getRecentMovimientoSheets, then reads each sheet
   async function getMovimientosToFill(
     spreadsheetId: string
   ): Promise<Result<MovimientoRow[], Error>>
   ```

   **API optimization:** Use `getSheetMetadata()` once to get all sheet titles, filter by regex `/^\d{4}-\d{2}$/` for YYYY-MM pattern, then filter by year.

4. Run test-runner (expect pass)

### Task 5: Create movimientos-detalles service for batch updates

1. Write test in `src/services/movimientos-detalles.test.ts`:
   - Test `updateDetalles` correctly updates column G for specified rows
   - Test batch update across multiple sheets works correctly
   - Test update skips rows that already have detalles

2. Run test-runner (expect fail)

3. Implement `src/services/movimientos-detalles.ts`:
   ```typescript
   interface DetallesUpdate {
     sheetName: string;     // e.g., "2025-01"
     rowNumber: number;     // Row number in sheet
     detalles: string;      // Description to write
   }

   // Update detalles column for specified rows using batchUpdate (1 API call)
   async function updateDetalles(
     spreadsheetId: string,
     updates: DetallesUpdate[]
   ): Promise<Result<number, Error>>  // Returns count of updated rows
   ```

   **API optimization:** Use existing `batchUpdate()` from `src/services/sheets.ts` to update all cells in a single API call. Group updates by sheet to build proper ranges (e.g., `"2025-01!G3"`, `"2025-01!G5"`).

4. Run test-runner (expect pass)

### Task 6: Create matchMovimientos service to orchestrate matching

1. Write test in `src/bank/match-movimientos.test.ts`:
   - Test matching a debit movement against facturas recibidas/pagos enviados/recibos
   - Test matching a credit movement against facturas emitidas/pagos recibidos
   - Test credit matching with retencion tolerance (credit + retenciones ≈ factura)
   - Test auto-detection from concepto (bank fees, credit card payments)
   - Test movements without match get empty detalles (no update)
   - Test date filtering (only current + previous year)

2. Run test-runner (expect fail)

3. Implement `src/bank/match-movimientos.ts`:
   ```typescript
   interface MatchMovimientosResult {
     spreadsheetName: string;     // Bank account name
     sheetsProcessed: number;
     movimientosProcessed: number;
     movimientosFilled: number;
     debitsFilled: number;        // Debits matched (egresos)
     creditsFilled: number;       // Credits matched (ingresos)
     noMatches: number;
     errors: number;
     duration: number;
   }

   // Match all movimientos for a bank spreadsheet
   async function matchMovimientosForBank(
     spreadsheetId: string,
     spreadsheetName: string,
     // Egresos data (for debits)
     facturasRecibidas: Array<Factura & { row: number }>,
     pagosEnviados: Array<Pago & { row: number }>,
     recibos: Array<Recibo & { row: number }>,
     // Ingresos data (for credits)
     facturasEmitidas: Array<Factura & { row: number }>,
     pagosRecibidos: Array<Pago & { row: number }>,
     retenciones: Array<Retencion & { row: number }>  // Used for amount tolerance, not direct matching
   ): Promise<Result<MatchMovimientosResult, Error>>

   // Match all movimientos across all banks
   async function matchAllMovimientos(): Promise<Result<{
     results: MatchMovimientosResult[];
     totalProcessed: number;
     totalFilled: number;
     totalDebitsFilled: number;
     totalCreditsFilled: number;
     duration: number;
   }, Error>>
   ```

   **Implementation with API/Memory optimization:**
   ```typescript
   async function matchAllMovimientos() {
     // 1. Load Control data ONCE (6 API calls total)
     const ingresosData = await loadControlIngresos();  // 3 calls
     const egresosData = await loadControlEgresos();    // 3 calls

     // 2. Process banks SEQUENTIALLY (memory efficient)
     const results: MatchMovimientosResult[] = [];
     for (const [bankName, spreadsheetId] of bankSpreadsheets) {
       // Load this bank's movimientos (1 metadata + N sheet reads)
       const movimientos = await getMovimientosToFill(spreadsheetId);

       // Match in memory
       const updates = matchAll(movimientos, ingresosData, egresosData);

       // Write batch update (1 API call)
       await updateDetalles(spreadsheetId, updates);

       results.push(...);
       // movimientos released from memory before next bank
     }

     return results;
   }
   ```

   - For each movement:
     - If `debito` has value → use `matchMovement()` (existing debit logic)
     - If `credito` has value → use `matchCreditMovement()` (new credit logic)
   - Convert `MovimientoRow` to `BankMovement` interface for matching

4. Run test-runner (expect pass)

### Task 7: Add API route for match-movimientos

1. Write test in `src/routes/scan.test.ts`:
   - Test POST `/api/match-movimientos` returns expected result structure
   - Test route requires authentication

2. Run test-runner (expect fail)

3. Update `src/routes/scan.ts`:
   - Add `matchAllMovimientos` import
   - Add `/match-movimientos` POST route with `authMiddleware`
   - Return result with statistics

4. Run test-runner (expect pass)

### Task 8: Add Dashboard menu option for match-movimientos

1. Update `apps-script/src/main.ts`:
   - Add "📝 Completar Detalles Movimientos" menu item after "Auto-fill Bank Data"
   - Add `triggerMatchMovimientos` function calling `/api/match-movimientos`

2. Build and test:
   - Run `npm run build:script`
   - Verify menu item appears and works

### Task 9: Trigger match-movimientos at end of scan

1. Write test in `src/processing/scanner.test.ts`:
   - Test that scan triggers matchAllMovimientos after processing
   - Test that matchAllMovimientos is called only when scan succeeds

2. Run test-runner (expect fail)

3. Update `src/processing/scanner.ts`:
   - Import `matchAllMovimientos` from `../bank/match-movimientos.js`
   - Call `matchAllMovimientos()` at end of successful scan (after folder structure update)
   - Log results

4. Run test-runner (expect pass)

### Task 10: Update documentation

1. Update `SPREADSHEET_FORMAT.md`:
   - Add 'detalles' column to Movimientos Bancario schema (column G)
   - Document the matching behavior and sources for both debits and credits

2. Update `CLAUDE.md`:
   - Add `/api/match-movimientos` to API ENDPOINTS table
   - Document auto-trigger after scan

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings
