# Implementation Plan

**Created:** 2026-01-30
**Updated:** 2026-01-30 (enhanced after thorough review)
**Source:** Inline request: Add Detalles column matching for Movimientos sheets

## Context Gathered

### Codebase Analysis

**Current Project (adva-administracion):**
- `src/bank/autofill.ts` - Already matches bank movements against Control de Ingresos/Egresos
- `src/bank/matcher.ts` - `BankMovementMatcher` class handles **debit** matching only (line 258 checks for debito)
- `src/processing/storage/movimientos-store.ts` - Stores bank movements to per-month sheets with 6 columns (A:F)
- `src/constants/spreadsheet-headers.ts` - Defines `MOVIMIENTOS_BANCARIO_SHEET` with 6 headers
- `src/routes/scan.ts` - Has `/api/autofill-bank` route, does NOT trigger autofill after scan
- `src/utils/concurrency.ts` - Existing `withLock()` pattern with 30s auto-expiration (use this!)
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
   - Related retenciones: same CUIT, date range (up to 90 days after factura), amounts that sum correctly
   - Supports multiple retenciones per factura (Ganancias + IVA + IIBB)
   - Example: Credit $95,000 + Retencion $5,000 = Factura $100,000 → match
   - Example: Credit $90,000 + Ret.Ganancias $7,000 + Ret.IVA $3,000 = Factura $100,000 → match
3. Pago Recibido without linked Factura → "REVISAR! Cobro de [Pagador]"

### Date Filtering

Only process movements from current year and previous year (e.g., 2025 and 2026 if today is 2026-01-30).
Month sheet names are YYYY-MM format.

**Known limitation:** Facturas from 2+ years ago that get paid late won't match automatically. This is acceptable as these are rare edge cases that require manual review anyway.

### API & Memory Optimization Strategy

**Minimize Sheets API Calls:**
1. **Read Control data ONCE at start** - Load Facturas, Pagos, Recibos, Retenciones from both Control de Ingresos and Control de Egresos once, reuse for all banks
2. **Use metadata for sheet discovery** - Call `getSheetMetadata()` once per bank spreadsheet to get sheet names, filter to YYYY-MM pattern matching current/previous year (avoid reading non-existent sheets)
3. **Batch updates** - Collect all detalles updates per spreadsheet, use single `batchUpdate()` call instead of individual cell updates

**Memory Management (Railway VM ~512MB):**
1. **Process banks sequentially** - Load movimientos for one bank at a time, process, write, then release memory before next bank
2. **Control data stays loaded** - Ingresos/Egresos data (~1000s of rows) stays in memory throughout (reasonable size)
3. **Stream updates** - Don't accumulate all updates across all banks; write after each bank completes

**Parallel reads for speed:**
- Read all month sheets for a bank in parallel using `Promise.all()`
- Before: 12 sheets × 300ms = 3.6s per bank (sequential)
- After: 12 sheets in parallel = ~500ms per bank
- Total time reduced from ~25s to ~10s

**Exchange rate pre-fetching:**
- Before matching begins, collect all unique dates from facturas and pagos
- Call `prefetchExchangeRates()` to load rates into cache
- Prevents `cacheMiss` during synchronous matching

**Trigger after every scan:**
- Any document type (factura, pago, recibo, retencion, resumen) could match existing movimientos
- New Factura Recibida → might match existing bank debit
- New Pago Recibido → might match existing bank credit
- New Retencion → might help match credit to factura (provides tolerance amount)
- Run async (fire and forget) so scan response isn't blocked
- **Always log result** (success OR failure) for observability

**Concurrency control (prevent overlapping runs):**
- Use existing `withLock()` from `src/utils/concurrency.ts` (NOT a simple boolean flag)
- Lock ID: `'movimientos-matching'`
- Lock timeout: 5 minutes (300,000ms) - matching can take time
- Benefits over simple flag:
  - 30-second auto-expiration prevents deadlocks if process crashes
  - Proper `finally` block ensures lock release
  - Correlation ID tracking for debugging
  - Existing battle-tested implementation

**Estimated API Calls per execution:**
- Control de Ingresos: 3 reads (Facturas Emitidas, Pagos Recibidos, Retenciones)
- Control de Egresos: 3 reads (Facturas Recibidas, Pagos Enviados, Recibos)
- Per bank spreadsheet: 1 metadata + N month sheet reads (parallel) + 1 batch update
- Total: 6 + (banks × (1 + months + 1)) ≈ 6 + (5 banks × 15 calls) = ~81 calls
- **Time: ~10 seconds** (with parallel reads)

### Edge Cases & Known Limitations

**Documented and accepted:**
1. **Year boundary**: Only processes current + previous year. Late payments from 2+ years ago won't match automatically.
2. **Multiple banks matching same document**: If Bank A and Bank B both have movements that match the same Factura, both will get the same detalles. This is acceptable (could be inter-account transfers or legitimate scenario).
3. **Partial payments**: If a Factura is paid in installments, only the first payment with matching retencion sum will match automatically. Subsequent payments may need manual review.

**Handled by implementation:**
1. **Schema migration**: Reader handles both 6-column (legacy) and 7-column (new) formats gracefully.
2. **SALDO INICIAL/FINAL rows**: Robustly filtered using `startsWith()` check on trimmed uppercase string.
3. **Cross-currency retenciones**: USD facturas with ARS retenciones are handled via exchange rate conversion.

### Re-match Capability

By default, rows with existing detalles are skipped. For re-evaluation:
- API route accepts optional `force: true` parameter
- When force=true, re-matches all rows (including those with existing detalles)
- Useful for: bug fixes, algorithm improvements, or clearing incorrect manual entries

---

## Integration Notes (Critical for Implementation)

### Key Interfaces & Types

**DO NOT confuse these two interfaces:**

1. **`BankMovement`** (existing, `src/types/index.ts:829`) - Used by autofill.ts for external bank spreadsheets
   - Columns: fecha, fechaValor, concepto, codigo, oficina, areaAdva, credito, debito, detalle
   - This is for a DIFFERENT spreadsheet format (legacy external banks)

2. **`MovimientoRow`** (NEW, to be created) - For internal Movimientos sheets in bank spreadsheets
   - Columns: fecha, origenConcepto, debito, credito, saldo, saldoCalculado, detalles
   - Matches `MOVIMIENTOS_BANCARIO_SHEET.headers` from `src/constants/spreadsheet-headers.ts:239`

**When matching, convert `MovimientoRow` to a compatible format for `BankMovementMatcher`.**

### Existing Utilities to Use

| Utility | Location | Usage |
|---------|----------|-------|
| `withLock()` | `src/utils/concurrency.ts:208` | Concurrency control with 30s auto-expiry |
| `prefetchExchangeRates()` | `src/utils/exchange-rate.ts:214` | Pre-load exchange rates before matching |
| `getSheetMetadata()` | `src/services/sheets.ts:286` | Returns `Array<{title, sheetId, index}>` |
| `batchUpdate()` | `src/services/sheets.ts:225` | Takes `Array<{range: string, values: CellValue[][]}>` |
| `getValues()` | `src/services/sheets.ts:138` | Read spreadsheet data |
| `parseNumber()` | `src/utils/numbers.ts:58` | Parse any number format |
| `getCachedFolderStructure()` | `src/services/folder-structure.ts:78` | Returns `FolderStructure` |

### FolderStructure Fields (src/types/index.ts:1004)

```typescript
interface FolderStructure {
  controlIngresosId: string;      // For reading Facturas Emitidas, Pagos Recibidos, Retenciones
  controlEgresosId: string;       // For reading Facturas Recibidas, Pagos Enviados, Recibos
  bankSpreadsheets: Map<string, string>;  // Map<bankName, spreadsheetId> - iterate this for all banks
  // ... other fields
}
```

### Control Sheet Ranges (from autofill.ts pattern)

**Control de Ingresos (`controlIngresosId`):**
- `'Facturas Emitidas!A:R'` - 18 columns per `FACTURA_EMITIDA_HEADERS`
- `'Pagos Recibidos!A:O'` - 15 columns per `PAGO_RECIBIDO_HEADERS`
- `'Retenciones Recibidas!A:O'` - 15 columns per `RETENCIONES_RECIBIDAS_HEADERS`

**Control de Egresos (`controlEgresosId`):**
- `'Facturas Recibidas!A:S'` - 19 columns per `FACTURA_RECIBIDA_HEADERS`
- `'Pagos Enviados!A:O'` - 15 columns per `PAGO_ENVIADO_HEADERS`
- `'Recibos!A:R'` - 18 columns per `RECIBO_HEADERS`

### Parsing Functions Needed

**Existing (in `src/bank/autofill.ts`):**
- `parseFacturas()` - Parses Facturas Emitidas/Recibidas (same format)
- `parsePagos()` - Parses Pagos Recibidos/Enviados (same format)
- `parseRecibos()` - Parses Recibos

**NEW (add to `src/bank/match-movimientos.ts`):**
```typescript
// Parse Retenciones from Control de Ingresos
function parseRetenciones(data: CellValue[][]): Array<Retencion & { row: number }> {
  const retenciones: Array<Retencion & { row: number }> = [];

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    retenciones.push({
      row: i + 1,
      fechaEmision: String(row[0] || ''),           // Column A (index 0)
      fileId: String(row[1] || ''),                 // Column B (index 1)
      fileName: String(row[2] || ''),               // Column C (index 2)
      nroCertificado: String(row[3] || ''),         // Column D (index 3)
      cuitAgenteRetencion: String(row[4] || ''),    // Column E (index 4) - CRITICAL for CUIT matching
      razonSocialAgenteRetencion: String(row[5] || ''), // Column F (index 5)
      impuesto: String(row[6] || ''),               // Column G (index 6)
      regimen: String(row[7] || ''),                // Column H (index 7)
      montoComprobante: parseNumber(row[8]) || 0,   // Column I (index 8)
      montoRetencion: parseNumber(row[9]) || 0,     // Column J (index 9) - CRITICAL for amount tolerance
      cuitSujetoRetenido: '30709076783',            // Always ADVA (not stored in sheet)
      processedAt: String(row[10] || ''),           // Column K (index 10)
      confidence: Number(row[11]) || 0,             // Column L (index 11)
      needsReview: row[12] === 'YES',               // Column M (index 12)
      matchedFacturaFileId: row[13] ? String(row[13]) : undefined, // Column N (index 13)
      matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined, // Column O (index 14)
    });
  }

  return retenciones;
}
```

### Movimientos Sheet Reading

Read using range `'YYYY-MM!A:G'` for new sheets, `'YYYY-MM!A:F'` works for legacy.
The reader should request `A:G` and handle 6 vs 7 columns gracefully.

### batchUpdate Format for Detalles Updates

```typescript
// Build updates for batchUpdate()
const updates: Array<{ range: string; values: CellValue[][] }> = [];

for (const update of detallesUpdates) {
  updates.push({
    range: `'${update.sheetName}'!G${update.rowNumber}`,  // Column G for detalles
    values: [[update.detalles]],
  });
}

// Single API call
await batchUpdate(spreadsheetId, updates);
```

**Note:** Sheet names with special characters need single quotes in A1 notation (e.g., `'2025-01'`).

### MovimientoRow to BankMovement Conversion

For using existing `BankMovementMatcher.matchMovement()`:

```typescript
function movimientoRowToBankMovement(mov: MovimientoRow): BankMovement {
  return {
    row: mov.rowNumber,
    fecha: mov.fecha,
    fechaValor: mov.fecha,  // Use same date (movimientos don't have fechaValor)
    concepto: mov.origenConcepto,
    codigo: '',
    oficina: '',
    areaAdva: '',
    credito: mov.credito,
    debito: mov.debito,
    detalle: mov.detalles,
  };
}
```

### Credit Matching - Key Fields

For `matchCreditMovement()`, match credit bank movements against:

1. **Factura Emitida** (`cuitReceptor` is the client who pays us)
   - Compare `cuitReceptor` with CUIT in bank concepto

2. **Pago Recibido** (`cuitPagador` is who paid us)
   - Compare `cuitPagador` with CUIT in bank concepto
   - Check `matchedFacturaFileId` for linked Factura

3. **Retencion** (`cuitAgenteRetencion` is the client who withheld tax)
   - Use `cuitAgenteRetencion` to find retenciones for same client
   - Sum `montoRetencion` for all matching retenciones

---

## Implementation Tasks

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
   - Test `matchCreditMovement` matches Factura Emitida with single retencion tolerance:
     - Credit $95,000 + Retencion $5,000 (same CUIT) = Factura $100,000 → match
   - **Test multiple retenciones for one factura:**
     - Credit $90,000 + Retencion Ganancias $7,000 + Retencion IVA $3,000 = Factura $100,000 → match
   - **Test cross-currency retencion:**
     - USD Factura $1,000 → ARS Credit + ARS Retenciones ≈ USD amount × exchange rate
   - **Test retencion date range:**
     - Retencion dated up to 90 days after factura date still matches
     - Retencion dated 91+ days after factura does NOT match
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
   - **Note:** Uses existing `BankMovement` interface. The orchestrator (Task 6) will convert `MovimientoRow` to `BankMovement` using:
     ```typescript
     // In match-movimientos.ts
     function movimientoRowToBankMovement(mov: MovimientoRow): BankMovement {
       return {
         row: mov.rowNumber,
         fecha: mov.fecha,
         fechaValor: mov.fecha,  // Same date (movimientos don't have separate fechaValor)
         concepto: mov.origenConcepto,
         codigo: '', oficina: '', areaAdva: '',  // Not used by credit matcher
         credito: mov.credito,
         debito: mov.debito,
         detalle: mov.detalles,
       };
     }
     ```
   - Priority order for credits:
     1. Pago Recibido with linked Factura Emitida → "Cobro Factura de [Cliente] - [Concepto]"
     2. Direct Factura Emitida match (with retencion tolerance):
        - Find retenciones with same CUIT (`cuitAgenteRetencion` matches `factura.cuitReceptor`)
        - Date range: retencion within 90 days AFTER factura date
        - **Sum ALL matching retenciones** (not just first one)
        - Check if `Credit + sum(retenciones.montoRetencion) ≈ Factura.importeTotal` (within 1% tolerance)
        - → "Cobro Factura de [Cliente] - [Concepto]"
     3. Pago Recibido without linked Factura → "REVISAR! Cobro de [Pagador]"
   - Add helper methods:
     - `findMatchingPagosRecibidos` - match by amount, date, CUIT (`pago.cuitPagador`)
     - `findMatchingFacturasEmitidas` - match by amount (with retencion tolerance), date, CUIT (`factura.cuitReceptor`)
     - `findRelatedRetenciones` - find retenciones where `cuitAgenteRetencion === factura.cuitReceptor` within date range
     - `sumRetenciones` - sum `montoRetencion` for array of retenciones
   - Add constant: `RETENCION_DATE_RANGE_DAYS = 90`

4. Run test-runner (expect pass)

### Task 4: Create movimientos-reader service to read from per-month sheets

1. Write test in `src/services/movimientos-reader.test.ts`:
   - Test `getRecentMovimientoSheets` returns sheets for current + previous year only
   - Test `readMovimientosForPeriod` reads and parses data correctly
   - Test filtering of sheets by year (e.g., "2025-01" included, "2023-12" excluded)
   - Test parsing of empty detalles column
   - **Test backward compatibility: 6-column sheets (legacy) parsed correctly with empty detalles**
   - Test skipping SALDO INICIAL and SALDO FINAL rows
   - **Test robust SALDO row detection:**
     - "SALDO INICIAL" → skipped
     - "SALDO INICIAL AJUSTADO" → skipped
     - "  SALDO INICIAL  " (whitespace) → skipped
     - "SALDO FINAL" → skipped

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

   // Labels to skip (special rows, not transactions)
   const SKIP_LABELS = ['SALDO INICIAL', 'SALDO FINAL'];

   function isSpecialRow(origenConcepto: string): boolean {
     const normalized = origenConcepto.trim().toUpperCase();
     return SKIP_LABELS.some(label => normalized.startsWith(label));
   }

   // Parse row with backward compatibility (6 or 7 columns)
   function parseMovimientoRow(
     row: CellValue[],
     sheetName: string,
     rowNumber: number
   ): MovimientoRow | null {
     const origenConcepto = String(row[1] || '');
     if (isSpecialRow(origenConcepto)) return null;

     return {
       sheetName,
       rowNumber,
       fecha: String(row[0] || ''),
       origenConcepto,
       debito: parseNumber(row[2]),
       credito: parseNumber(row[3]),
       saldo: parseNumber(row[4]),
       saldoCalculado: parseNumber(row[5]),
       // Handle both 6-column (legacy) and 7-column (new) formats
       detalles: row.length > 6 ? String(row[6] || '') : '',
     };
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
   // Calls getRecentMovimientoSheets, then reads sheets IN PARALLEL
   async function getMovimientosToFill(
     spreadsheetId: string,
     options?: { includeWithDetalles?: boolean }  // For force re-match
   ): Promise<Result<MovimientoRow[], Error>>
   ```

   **API optimization:**
   - Use `getSheetMetadata()` once to get all sheet titles
   - Filter by regex `/^\d{4}-\d{2}$/` for YYYY-MM pattern, then filter by year
   - Read all matching sheets in parallel with `Promise.all()` for speed

4. Run test-runner (expect pass)

### Task 5: Create movimientos-detalles service for batch updates

1. Write test in `src/services/movimientos-detalles.test.ts`:
   - Test `updateDetalles` correctly updates column G for specified rows
   - Test batch update across multiple sheets works correctly
   - Test update skips rows that already have detalles (when force=false)
   - **Test update overwrites existing detalles (when force=true)**
   - Test empty updates array returns success with 0 count

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
   - **Test mutex using withLock: concurrent calls return `skipped: true` instead of running twice**
   - **Test force option re-matches rows with existing detalles**
   - **Test exchange rate pre-fetching is called before matching**
   - **Test error logging when matching fails**

2. Run test-runner (expect fail)

3. Implement `src/bank/match-movimientos.ts`:

   **Required imports:**
   ```typescript
   import type { Result, Factura, Pago, Recibo, Retencion, MatchConfidence } from '../types/index.js';
   import { withLock } from '../utils/concurrency.js';
   import { prefetchExchangeRates } from '../utils/exchange-rate.js';
   import { info, error as logError } from '../utils/logger.js';
   import { getCachedFolderStructure } from '../services/folder-structure.js';
   import { getValues, batchUpdate, type CellValue } from '../services/sheets.js';
   import { parseNumber } from '../utils/numbers.js';
   import { BankMovementMatcher } from './matcher.js';
   import { getMovimientosToFill, type MovimientoRow } from '../services/movimientos-reader.js';
   import { updateDetalles } from '../services/movimientos-detalles.js';
   ```

   **Parsing functions (similar to autofill.ts patterns):**
   - Copy `parseFacturas()`, `parsePagos()`, `parseRecibos()` from `src/bank/autofill.ts` or import if refactored
   - Add new `parseRetenciones()` function (see Integration Notes above for implementation)

   **Getting bank spreadsheets:**
   ```typescript
   const folderStructure = getCachedFolderStructure();
   if (!folderStructure) {
     return { ok: false, error: new Error('Folder structure not initialized') };
   }
   const bankSpreadsheets = folderStructure.bankSpreadsheets;  // Map<string, string>
   ```

   **Interface definitions:**
   ```typescript

   interface MatchMovimientosResult {
     skipped: boolean;
     reason?: string;           // 'already_running' if skipped
     spreadsheetName?: string;  // Bank account name (if not skipped)
     sheetsProcessed: number;
     movimientosProcessed: number;
     movimientosFilled: number;
     debitsFilled: number;      // Debits matched (egresos)
     creditsFilled: number;     // Credits matched (ingresos)
     noMatches: number;
     errors: number;
     duration: number;
   }

   interface MatchAllResult {
     skipped: boolean;
     reason?: string;
     results: MatchMovimientosResult[];
     totalProcessed: number;
     totalFilled: number;
     totalDebitsFilled: number;
     totalCreditsFilled: number;
     duration: number;
   }

   interface MatchOptions {
     force?: boolean;  // Re-match rows that already have detalles
   }

   const MATCHING_LOCK_ID = 'movimientos-matching';
   const MATCHING_LOCK_TIMEOUT = 300000;  // 5 minutes

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
     retenciones: Array<Retencion & { row: number }>,
     options?: MatchOptions
   ): Promise<Result<MatchMovimientosResult, Error>>

   // Match all movimientos across all banks
   async function matchAllMovimientos(
     options?: MatchOptions
   ): Promise<Result<MatchAllResult, Error>> {
     // Use existing withLock for concurrency control
     const lockResult = await withLock(
       MATCHING_LOCK_ID,
       async () => {
         const startTime = Date.now();

         // 1. Load Control data ONCE (6 API calls total)
         const ingresosData = await loadControlIngresos();  // 3 calls
         if (!ingresosData.ok) return ingresosData;

         const egresosData = await loadControlEgresos();    // 3 calls
         if (!egresosData.ok) return egresosData;

         // 2. Pre-fetch exchange rates for cross-currency matching
         const allDates = [
           ...ingresosData.value.facturasEmitidas.map(f => f.fechaEmision),
           ...ingresosData.value.pagosRecibidos.map(p => p.fechaPago),
           ...egresosData.value.facturasRecibidas.map(f => f.fechaEmision),
         ];
         await prefetchExchangeRates([...new Set(allDates)]);

         // 3. Process banks SEQUENTIALLY (memory efficient)
         const results: MatchMovimientosResult[] = [];
         for (const [bankName, spreadsheetId] of bankSpreadsheets) {
           // Load this bank's movimientos (1 metadata + N parallel sheet reads)
           const movimientos = await getMovimientosToFill(spreadsheetId, {
             includeWithDetalles: options?.force ?? false
           });
           if (!movimientos.ok) {
             results.push({
               skipped: false,
               spreadsheetName: bankName,
               sheetsProcessed: 0,
               movimientosProcessed: 0,
               movimientosFilled: 0,
               debitsFilled: 0,
               creditsFilled: 0,
               noMatches: 0,
               errors: 1,
               duration: 0,
             });
             continue;
           }

           // Match in memory
           const updates = matchAll(movimientos.value, ingresosData.value, egresosData.value);

           // Write batch update (1 API call)
           await updateDetalles(spreadsheetId, updates);

           results.push({ /* ... */ });
           // movimientos released from memory before next bank
         }

         return {
           ok: true,
           value: {
             skipped: false,
             results,
             totalProcessed: results.reduce((sum, r) => sum + r.movimientosProcessed, 0),
             totalFilled: results.reduce((sum, r) => sum + r.movimientosFilled, 0),
             totalDebitsFilled: results.reduce((sum, r) => sum + r.debitsFilled, 0),
             totalCreditsFilled: results.reduce((sum, r) => sum + r.creditsFilled, 0),
             duration: Date.now() - startTime,
           }
         };
       },
       MATCHING_LOCK_TIMEOUT
     );

     // Handle lock acquisition failure (already running)
     if (!lockResult.ok) {
       info('Match movimientos skipped - already running', { module: 'match-movimientos' });
       return {
         ok: true,
         value: {
           skipped: true,
           reason: 'already_running',
           results: [],
           totalProcessed: 0,
           totalFilled: 0,
           totalDebitsFilled: 0,
           totalCreditsFilled: 0,
           duration: 0,
         }
       };
     }

     return lockResult;
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
   - **Test optional `force` query parameter**

2. Run test-runner (expect fail)

3. Update `src/routes/scan.ts`:
   - Add `matchAllMovimientos` import
   - Add `/api/match-movimientos` POST route with `authMiddleware`:
     ```typescript
     server.post<{ Querystring: { force?: string } }>(
       '/api/match-movimientos',
       { onRequest: authMiddleware },
       async (request, reply) => {
         const force = request.query.force === 'true';
         const result = await matchAllMovimientos({ force });
         if (!result.ok) {
           return reply.status(500).send({ error: result.error.message });
         }
         return reply.send(result.value);
       }
     );
     ```
   - Return result with statistics

4. Run test-runner (expect pass)

### Task 8: Add Dashboard menu option for match-movimientos

1. Update `apps-script/src/main.ts`:
   - Add "📝 Completar Detalles Movimientos" menu item after "Auto-fill Bank Data"
   - Add `triggerMatchMovimientos` function calling `/api/match-movimientos`

2. Build and test:
   - Run `npm run build:script`
   - Verify menu item appears and works

### Task 9: Trigger match-movimientos at end of scan (async)

1. Write test in `src/processing/scanner.test.ts`:
   - Test that scan triggers matchAllMovimientos after processing any document type
   - Test that matchAllMovimientos runs async (doesn't block scan response)
   - Test that matchAllMovimientos is called only when scan succeeds
   - **Test that errors are logged (not silently discarded)**

2. Run test-runner (expect fail)

3. Update `src/processing/scanner.ts`:
   - Import `matchAllMovimientos` from `../bank/match-movimientos.js`
   - Import `error as logError` from `../utils/logger.js`
   - At end of successful scan, call async with proper error handling:
     ```typescript
     // Don't await - run in background so scan response isn't delayed
     void matchAllMovimientos()
       .then(result => {
         if (result.ok) {
           if (result.value.skipped) {
             info('Match movimientos skipped', {
               module: 'scanner',
               reason: result.value.reason
             });
           } else {
             info('Match movimientos completed', {
               module: 'scanner',
               filled: result.value.totalFilled,
               debitsFilled: result.value.totalDebitsFilled,
               creditsFilled: result.value.totalCreditsFilled,
               duration: result.value.duration
             });
           }
         } else {
           // Log errors - don't silently discard!
           logError('Match movimientos failed', {
             module: 'scanner',
             error: result.error.message
           });
         }
       })
       .catch(err => {
         // Catch unexpected exceptions
         logError('Match movimientos crashed', {
           module: 'scanner',
           error: err instanceof Error ? err.message : String(err)
         });
       });
     ```
   - Any document type triggers this (factura, pago, recibo, retencion, resumen)

4. Run test-runner (expect pass)

### Task 10: Update documentation

1. Update `SPREADSHEET_FORMAT.md`:
   - Add 'detalles' column to Movimientos Bancario schema (column G)
   - Document the matching behavior and sources for both debits and credits
   - Document retencion tolerance matching for credits

2. Update `CLAUDE.md`:
   - Add `/api/match-movimientos` to API ENDPOINTS table
   - Document optional `force` query parameter
   - Document auto-trigger after scan
   - Add note about concurrency control using withLock

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings
