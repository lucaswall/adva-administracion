# Implementation Plan

**Created:** 2026-01-30
**Updated:** 2026-01-31 (scan deferral, rich comparison replacement, removed exchange rate pre-fetch, 8-column schema: G=matchedFileId, H=detalle)
**Source:** Inline request: Add Detalles column matching for Movimientos sheets

## Context Gathered

### Codebase Analysis

**Current Project (adva-administracion):**
- `src/bank/autofill.ts` - Already matches bank movements against Control de Ingresos/Egresos
- `src/bank/matcher.ts` - `BankMovementMatcher` class handles **debit** matching only (line 258 checks for debito)
- `src/processing/storage/movimientos-store.ts` - Stores bank movements to per-month sheets with 6 columns (A:F)
- `src/constants/spreadsheet-headers.ts` - Defines `MOVIMIENTOS_BANCARIO_SHEET` with 6 headers
- `src/routes/scan.ts` - Has `/api/autofill-bank` route, does NOT trigger autofill after scan
- `src/utils/concurrency.ts` - Existing `withLock()` pattern with 30s auto-expiration
- `apps-script/src/main.ts` - Dashboard menu with "Auto-fill Bank Data" option

**Current Movimientos Bancario Schema (6 columns A:F):**
- fecha, origenConcepto, debito, credito, saldo, saldoCalculado

**New schema (8 columns A:H):**
- fecha, origenConcepto, debito, credito, saldo, saldoCalculado, **matchedFileId** (new), **detalle** (new)

The `matchedFileId` column (G) stores the Google Drive fileId of the matched document. This enables rich comparison - when a new potential match appears, we can look up the existing match and compare on ALL factors (CUIT match, date proximity, amount precision, etc.).

The `detalle` column (H) is the human-readable description shown last for easy viewing.

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
3. **Batch updates with chunking** - Collect all detalles updates per spreadsheet, use `batchUpdate()` but **chunk to 500 operations max** per API call (Google Sheets limit)

**Memory Management (Railway VM ~512MB):**
1. **Process banks sequentially** - Load movimientos for one bank at a time, process, write, then release memory before next bank
2. **Control data stays loaded** - Ingresos/Egresos data (~1000s of rows) stays in memory throughout (reasonable size)
3. **Stream updates** - Don't accumulate all updates across all banks; write after each bank completes
4. **Allow GC between banks** - Use `setImmediate()` between bank processing to allow garbage collection

**Chunked parallel reads for speed (memory-safe):**
- Read month sheets in **chunks of 4** using `Promise.all()` (not all 12 at once)
- Prevents memory spike from loading all sheets simultaneously
- Before: 12 sheets × 300ms = 3.6s per bank (sequential)
- After: 3 chunks × 4 sheets = ~1s per bank (chunked parallel)
- Total time ~12-15 seconds (balance of speed and memory safety)

**Exchange rates (on-demand):**
- USD payments are rare - no pre-fetching needed
- Fetch exchange rates on-demand when cross-currency matching is needed
- Built-in caching handles repeated lookups for same date
- Prioritize minimizing Drive API calls over exchange rate API calls

**Trigger after every scan:**
- Any document type (factura, pago, recibo, retencion, resumen) could match existing movimientos
- New Factura Recibida → might match existing bank debit
- New Pago Recibido → might match existing bank credit
- New Retencion → might help match credit to factura (provides tolerance amount)
- Run async (fire and forget) so scan response isn't blocked
- **Always log result** (success OR failure) for observability

**Concurrency control (prevent overlapping scan AND match runs):**
- Use existing `withLock()` from `src/utils/concurrency.ts`
- **CRITICAL:** Current `LOCK_TIMEOUT_MS` is 30 seconds (auto-expiry). This is **too short** for processing.
- **Solution:** Add configurable lock timeout parameter to `withLock()` OR increase default for processing locks
- **Single unified lock** for both scan and match operations
- Lock ID: `'document-processing'` (defined in `src/config.ts`, shared by scanner.ts and match-movimientos.ts)
- Lock wait timeout: 5 minutes (300,000ms) - time to wait for lock acquisition
- Lock auto-expiry: **5 minutes** (300,000ms) - time before stale lock auto-releases
- At any time, only ONE of these can run:
  - Scan process (processing new documents)
  - Match process (filling detalles column)
- Benefits over simple flag:
  - Auto-expiration prevents deadlocks if process crashes
  - Proper `finally` block ensures lock release
  - Correlation ID tracking for debugging
  - Existing battle-tested implementation
- **Trigger sequencing:** Match is triggered AFTER scan releases lock, ensuring sequential execution

**Scan deferral (NOT skipping):**
- Scans should NEVER be skipped - files in Entrada must not linger
- When lock is held, scan WAITS for lock release instead of returning immediately
- **Pending scan flag** prevents queue buildup:
  - `pendingScan: boolean` flag in scanner module
  - If lock held AND no pending scan → set flag, wait for lock, then run
  - If lock held AND pending scan already exists → skip (the pending scan will handle all files)
  - Since scan reads Entrada at start, one deferred scan catches everything
- This ensures files are processed promptly while avoiding duplicate work

**Estimated Drive API Calls per execution:**
- Control de Ingresos: 3 reads (Facturas Emitidas, Pagos Recibidos, Retenciones)
- Control de Egresos: 3 reads (Facturas Recibidas, Pagos Enviados, Recibos)
- Per bank spreadsheet: 1 metadata + N month sheet reads (chunked parallel) + 1-N batch updates (chunked by 500)
- Total: 6 + (banks × (1 + months + ceil(updates/500))) ≈ 6 + (5 banks × 15 calls) = ~81 calls
- Exchange rate API: on-demand only, cached, not counted (rare USD cases)
- **Time: ~12-15 seconds** (with chunked parallel reads)

### Edge Cases & Known Limitations

**Documented and accepted:**
1. **Year boundary**: Only processes current + previous year. Late payments from 2+ years ago won't match automatically.
2. **Multiple banks matching same document**: If Bank A and Bank B both have movements that match the same Factura, both will get the same detalles. This is acceptable (could be inter-account transfers or legitimate scenario).
3. **Partial payments**: If a Factura is paid in installments, only the first payment with matching retencion sum will match automatically. Subsequent payments need manual review. Document this in SPREADSHEET_FORMAT.md.
4. **Inter-bank transfers**: Transfers between ADVA's own accounts may match incorrectly. Pattern detection for "TRANSFERENCIA PROPIA" could be added in future.
5. **Credit card refunds**: Refunds appearing as credits are not currently detected. Add pattern in future if needed.

**Handled by implementation:**
1. **SALDO INICIAL/FINAL rows**: Robustly filtered using `startsWith()` check on trimmed uppercase string.
2. **Cross-currency retenciones**: USD facturas with ARS retenciones are handled via exchange rate conversion.
3. **Zero-amount movements**: Skip processing (no debit or credit).
4. **Negative amounts**: Notas de Crédito have negative importeTotal - handle in amount comparison.

### Replacement Logic (Better Match Wins)

Unlike cascade matching (where displaced matches seek new homes), this uses **simple replacement**:

**Scenario:**
1. Movimiento M matched to Factura A (amount matched, 15 days apart)
2. New Factura B is scanned - same amount but only 2 days apart
3. Factura B **replaces** Factura A as M's match
4. Factura A is simply unmatched (it's a document, doesn't need a "home")

**Implementation:**
- Column H (`matchedFileId`) stores the fileId of the currently matched document
- During matching, ALL movimientos are evaluated (including those with existing matches)
- For each movimiento with an existing match:
  1. Look up the existing matched document by fileId
  2. Compare new candidate vs existing on ALL factors
  3. Replace if new candidate is better

**Comparison factors (in priority order):**
1. **CUIT match**: exact match > partial/keyword > none
2. **Date proximity**: closer to movimiento date = better (absolute days difference)
3. **Amount precision**: exact match > within tolerance > with retencion adjustment
4. **Has linked pago**: Factura with linked Pago Recibido > Factura alone

**Example comparisons:**
- Same CUIT, Factura A is 15 days away, Factura B is 2 days away → B wins
- Factura A has no CUIT match, Factura B has exact CUIT → B wins (even if A is closer in date)
- Both exact CUIT, same date distance, A needs retencion tolerance, B is exact amount → B wins

**Why not full cascade?**
- Facturas/Pagos don't need to find movimientos - they're source documents
- Only movimientos need matches (bank statement explanation)
- Simpler logic, faster execution, same practical result

### Force Re-match

The `force: true` parameter clears existing matches before re-matching:
- Useful for: bug fixes, algorithm improvements, clearing incorrect manual entries
- Without force: only improves matches (replacement logic above)
- With force: treats all rows as unmatched, rebuilds from scratch

---

## Integration Notes (Critical for Implementation)

### Key Interfaces & Types

**DO NOT confuse these two interfaces:**

1. **`BankMovement`** (existing, `src/types/index.ts:829`) - Used by autofill.ts for external bank spreadsheets
   - Columns: fecha, fechaValor, concepto, codigo, oficina, areaAdva, credito, debito, detalle
   - This is for a DIFFERENT spreadsheet format (external banks imported separately)

2. **`MovimientoRow`** (NEW, to be created and **exported** from `src/types/index.ts`) - For internal Movimientos sheets in bank spreadsheets
   - Columns: fecha, origenConcepto, debito, credito, saldo, saldoCalculado, matchedFileId, detalle
   - 8 columns (A:H)
   - Matches `MOVIMIENTOS_BANCARIO_SHEET.headers` from `src/constants/spreadsheet-headers.ts:239`

**When matching, convert `MovimientoRow` to a compatible format for `BankMovementMatcher`.**

### Shared Constants (src/config.ts)

**Add these to `src/config.ts` to avoid duplication:**
```typescript
// Unified lock for document processing (scan and match)
export const PROCESSING_LOCK_ID = 'document-processing';
export const PROCESSING_LOCK_TIMEOUT_MS = 300000;  // 5 minutes

// Batch update limits
export const SHEETS_BATCH_UPDATE_LIMIT = 500;  // Google Sheets API limit

// Parallel processing limits
export const PARALLEL_SHEET_READ_CHUNK_SIZE = 4;  // Read 4 sheets at a time
```

### Existing Utilities to Use

| Utility | Location | Usage |
|---------|----------|-------|
| `withLock()` | `src/utils/concurrency.ts:208` | Concurrency control with configurable timeout |
| `getExchangeRate()` | `src/utils/exchange-rate.ts` | On-demand exchange rate (cached) |
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
// Parse Retenciones from Control de Ingresos using header-based column lookup
function parseRetenciones(data: CellValue[][]): Array<Retencion & { row: number }> {
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h || '').toLowerCase());
  const retenciones: Array<Retencion & { row: number }> = [];

  // Build column index map from headers (robust against schema changes)
  const colIndex = {
    fechaEmision: headers.indexOf('fechaemision'),
    fileId: headers.indexOf('fileid'),
    fileName: headers.indexOf('filename'),
    nroCertificado: headers.indexOf('nrocertificado'),
    cuitAgenteRetencion: headers.indexOf('cuitagenteretencion'),
    razonSocialAgenteRetencion: headers.indexOf('razonsocialagenteretencion'),
    impuesto: headers.indexOf('impuesto'),
    regimen: headers.indexOf('regimen'),
    montoComprobante: headers.indexOf('montocomprobante'),
    montoRetencion: headers.indexOf('montoretencion'),
    processedAt: headers.indexOf('processedat'),
    confidence: headers.indexOf('confidence'),
    needsReview: headers.indexOf('needsreview'),
    matchedFacturaFileId: headers.indexOf('matchedfacturafileid'),
    matchConfidence: headers.indexOf('matchconfidence'),
  };

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colIndex.fechaEmision]) continue;

    retenciones.push({
      row: i + 1,
      fechaEmision: String(row[colIndex.fechaEmision] || ''),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      nroCertificado: String(row[colIndex.nroCertificado] || ''),
      cuitAgenteRetencion: String(row[colIndex.cuitAgenteRetencion] || ''),
      razonSocialAgenteRetencion: String(row[colIndex.razonSocialAgenteRetencion] || ''),
      impuesto: String(row[colIndex.impuesto] || ''),
      regimen: String(row[colIndex.regimen] || ''),
      montoComprobante: parseNumber(row[colIndex.montoComprobante]) || 0,
      montoRetencion: parseNumber(row[colIndex.montoRetencion]) || 0,
      cuitSujetoRetenido: '30709076783',  // Always ADVA
      processedAt: String(row[colIndex.processedAt] || ''),
      confidence: Number(row[colIndex.confidence]) || 0,
      needsReview: row[colIndex.needsReview] === 'YES',
      matchedFacturaFileId: row[colIndex.matchedFacturaFileId] ? String(row[colIndex.matchedFacturaFileId]) : undefined,
      matchConfidence: row[colIndex.matchConfidence] ? (String(row[colIndex.matchConfidence]) as MatchConfidence) : undefined,
    });
  }

  return retenciones;
}
```

### Movimientos Sheet Reading

Read using range `'YYYY-MM!A:H'` (8 columns: fecha, origenConcepto, debito, credito, saldo, saldoCalculado, matchedFileId, detalle).

### batchUpdate Format for Detalle Updates

```typescript
import { SHEETS_BATCH_UPDATE_LIMIT } from '../config.js';

// Build updates for batchUpdate() - update both matchedFileId (G) and detalle (H)
const updates: Array<{ range: string; values: CellValue[][] }> = [];

for (const update of detalleUpdates) {
  updates.push({
    range: `'${update.sheetName}'!G${update.rowNumber}:H${update.rowNumber}`,  // Columns G:H
    values: [[update.matchedFileId, update.detalle]],  // G=matchedFileId, H=detalle
  });
}

// Chunk updates to respect API limit (500 operations max per call)
for (let i = 0; i < updates.length; i += SHEETS_BATCH_UPDATE_LIMIT) {
  const chunk = updates.slice(i, i + SHEETS_BATCH_UPDATE_LIMIT);
  await batchUpdate(spreadsheetId, chunk);
}
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
    detalle: mov.detalle,
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

### Task 0: Add shared constants to config.ts (PREREQUISITE)

1. Update `src/config.ts`:
   ```typescript
   // Unified lock for document processing (scan and match)
   export const PROCESSING_LOCK_ID = 'document-processing';
   export const PROCESSING_LOCK_TIMEOUT_MS = 300000;  // 5 minutes

   // Batch update limits
   export const SHEETS_BATCH_UPDATE_LIMIT = 500;  // Google Sheets API limit

   // Parallel processing limits
   export const PARALLEL_SHEET_READ_CHUNK_SIZE = 4;  // Read 4 sheets at a time
   ```

2. **No test needed** - these are just constants

### Task 0.5: Update withLock to support custom auto-expiry timeout

**CRITICAL:** Current `LOCK_TIMEOUT_MS = 30000` (30s) in `concurrency.ts:60` is too short for processing.

1. Write test in `src/utils/concurrency.test.ts`:
   - Test that custom `autoExpiryMs` parameter overrides default 30s
   - Test that lock auto-expires after custom timeout
   - Test backward compatibility (omitting parameter uses default 30s)

2. Run test-runner (expect fail)

3. Update `src/utils/concurrency.ts`:
   - Add optional `autoExpiryMs` parameter to `withLock()`:
     ```typescript
     export async function withLock<T>(
       resourceId: string,
       fn: () => Promise<T>,
       waitTimeoutMs: number = 5000,
       autoExpiryMs: number = LOCK_TIMEOUT_MS  // NEW: defaults to 30s for backward compat
     ): Promise<Result<T, Error>>
     ```
   - Pass `autoExpiryMs` to `LockManager.acquire()` for per-lock expiry

4. Run test-runner (expect pass)

### Task 1: Add matchedFileId and detalle columns to Movimientos Bancario schema

1. Write test in `src/constants/spreadsheet-headers.test.ts`:
   - Test that `MOVIMIENTOS_BANCARIO_SHEET.headers` has 8 columns
   - Test that column index 6 is 'matchedFileId'
   - Test that column index 7 is 'detalle'

2. Run test-runner (expect fail)

3. Update `src/constants/spreadsheet-headers.ts`:
   - Add 'matchedFileId' and 'detalle' to `MOVIMIENTOS_BANCARIO_SHEET.headers` array

4. Run test-runner (expect pass)

### Task 2: Update movimientos-store to include empty matchedFileId and detalle columns

1. Write test in `src/processing/storage/movimientos-store.test.ts`:
   - Test that stored rows have 8 columns (not 6)
   - Test that column G (index 6) is empty string for new movimientos (matchedFileId)
   - Test that column H (index 7) is empty string for new movimientos (detalle)

2. Run test-runner (expect fail)

3. Update `src/processing/storage/movimientos-store.ts`:
   - Update `storeMovimientosBancario` to append empty strings for matchedFileId and detalle columns
   - Update range from `A:F` to `A:H`
   - Add empty matchedFileId and detalle to SALDO INICIAL, transaction, and SALDO FINAL rows

4. Run test-runner (expect pass)

### Task 3: Add MovimientoRow type to types/index.ts

1. Add to `src/types/index.ts`:
   ```typescript
   /**
    * Row from Movimientos Bancario per-month sheets
    * Used for matching against Control de Ingresos/Egresos
    */
   export interface MovimientoRow {
     sheetName: string;       // e.g., "2025-01"
     rowNumber: number;       // Row in sheet (1-indexed, after header)
     fecha: string;
     origenConcepto: string;
     debito: number | null;
     credito: number | null;
     saldo: number | null;
     saldoCalculado: number | null;
     matchedFileId: string;   // fileId of matched document (for comparison lookup)
     detalle: string;         // human-readable match description
   }
   ```

2. **No test needed** - just a type definition

### Task 4: Extend BankMovementMatcher to handle credit movements

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
   - **Additional edge cases:**
     - Test credit exactly equals Factura total (no retencion) → HIGH confidence
     - Test credit matches two different Facturas → match highest confidence first
     - Test credit with CUIT in concepto but no matching Factura → REVISAR! with extracted CUIT
     - Test zero-amount movement → skip processing
     - Test negative amounts (Notas de Crédito) → handle correctly
   - **Replacement logic tests:**
     - Test `compareMatches(existing, candidate, movimientoDate)` returns which is better
     - Test CUIT match beats no CUIT match (even if further in date)
     - Test closer date wins when CUIT match is equal
     - Test exact amount beats amount with retencion tolerance
     - Test Factura with linked Pago beats Factura alone
     - Test equal quality: keep existing (no unnecessary churn)

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
   - **Note:** Uses existing `BankMovement` interface. The orchestrator (Task 7) will convert `MovimientoRow` to `BankMovement` using:
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
         detalle: mov.detalle,
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

### Task 5: Create movimientos-reader service to read from per-month sheets

1. Write test in `src/services/movimientos-reader.test.ts`:
   - Test `getRecentMovimientoSheets` returns sheets for current + previous year only
   - Test `readMovimientosForPeriod` reads and parses data correctly
   - Test filtering of sheets by year (e.g., "2025-01" included, "2023-12" excluded)
   - Test parsing of matchedFileId column (fileId string or empty)
   - Test parsing of empty detalle column
   - Test skipping SALDO INICIAL and SALDO FINAL rows
   - **Test robust SALDO row detection:**
     - "SALDO INICIAL" → skipped
     - "SALDO INICIAL AJUSTADO" → skipped
     - "  SALDO INICIAL  " (whitespace) → skipped
     - "SALDO FINAL" → skipped
   - **Test chunked parallel reading:**
     - Verify sheets are read in chunks of PARALLEL_SHEET_READ_CHUNK_SIZE
     - Verify memory is released between chunks

2. Run test-runner (expect fail)

3. Implement `src/services/movimientos-reader.ts`:
   ```typescript
   import { PARALLEL_SHEET_READ_CHUNK_SIZE } from '../config.js';
   import type { MovimientoRow } from '../types/index.js';

   // Labels to skip (special rows, not transactions)
   const SKIP_LABELS = ['SALDO INICIAL', 'SALDO FINAL'];

   function isSpecialRow(origenConcepto: string): boolean {
     const normalized = origenConcepto.trim().toUpperCase();
     return SKIP_LABELS.some(label => normalized.startsWith(label));
   }

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
       matchedFileId: String(row[6] || ''),
       detalle: String(row[7] || ''),
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

   // Get all recent movimientos (excludes SALDO INICIAL/FINAL)
   // Calls getRecentMovimientoSheets, then reads sheets in CHUNKED PARALLEL
   // Returns ALL movimientos (with or without detalles) for replacement logic
   async function getMovimientosToFill(
     spreadsheetId: string
   ): Promise<Result<MovimientoRow[], Error>> {
     // ... get sheet names ...

     // Read in chunks to manage memory
     const allMovimientos: MovimientoRow[] = [];
     for (let i = 0; i < sheetNames.length; i += PARALLEL_SHEET_READ_CHUNK_SIZE) {
       const chunk = sheetNames.slice(i, i + PARALLEL_SHEET_READ_CHUNK_SIZE);
       const results = await Promise.all(chunk.map(readMovimientosForPeriod));
       // Process results...
       allMovimientos.push(...results.flatMap(r => r.ok ? r.value : []));
     }

     return { ok: true, value: allMovimientos };
   }
   ```

   **API optimization:**
   - Use `getSheetMetadata()` once to get all sheet titles
   - Filter by regex `/^\d{4}-\d{2}$/` for YYYY-MM pattern, then filter by year
   - Read sheets in **chunks of 4** (not all at once) for memory safety

4. Run test-runner (expect pass)

### Task 6: Create movimientos-detalle service for batch updates

1. Write test in `src/services/movimientos-detalle.test.ts`:
   - Test `updateDetalle` correctly updates columns G and H for specified rows
   - Test batch update across multiple sheets works correctly
   - Test empty updates array returns success with 0 count
   - **Test chunking when updates > 500:**
     - 600 updates should result in 2 batchUpdate API calls
     - 1500 updates should result in 3 batchUpdate API calls

2. Run test-runner (expect fail)

3. Implement `src/services/movimientos-detalle.ts`:
   ```typescript
   import { SHEETS_BATCH_UPDATE_LIMIT } from '../config.js';

   interface DetalleUpdate {
     sheetName: string;      // e.g., "2025-01"
     rowNumber: number;      // Row number in sheet
     matchedFileId: string;  // fileId of matched document (column G)
     detalle: string;        // Description to write (column H)
   }

   // Update matchedFileId and detalle columns for specified rows using batchUpdate
   // Automatically chunks to respect 500 operations limit
   async function updateDetalle(
     spreadsheetId: string,
     updates: DetalleUpdate[]
   ): Promise<Result<number, Error>> {
     if (updates.length === 0) {
       return { ok: true, value: 0 };
     }

     const allUpdates = updates.map(u => ({
       range: `'${u.sheetName}'!G${u.rowNumber}:H${u.rowNumber}`,  // Both G and H
       values: [[u.matchedFileId, u.detalle]],  // G=matchedFileId, H=detalle
     }));

     // Chunk to respect API limit
     let totalUpdated = 0;
     for (let i = 0; i < allUpdates.length; i += SHEETS_BATCH_UPDATE_LIMIT) {
       const chunk = allUpdates.slice(i, i + SHEETS_BATCH_UPDATE_LIMIT);
       const result = await batchUpdate(spreadsheetId, chunk);
       if (!result.ok) return result;
       totalUpdated += chunk.length;
     }

     return { ok: true, value: totalUpdated };
   }
   ```

4. Run test-runner (expect pass)

### Task 7: Create matchMovimientos service to orchestrate matching

1. Write test in `src/bank/match-movimientos.test.ts`:
   - Test matching a debit movement against facturas recibidas/pagos enviados/recibos
   - Test matching a credit movement against facturas emitidas/pagos recibidos
   - Test credit matching with retencion tolerance (credit + retenciones ≈ factura)
   - Test auto-detection from concepto (bank fees, credit card payments)
   - Test movements without match get empty detalles (no update)
   - Test date filtering (only current + previous year)
   - **Test mutex using withLock: concurrent calls return `skipped: true` instead of running twice**
   - **Test unified lock blocks both scan and match from running concurrently**
   - **Test force option clears matchedFileId and detalle before re-matching**
   - **Test replacement logic: looks up existing match by fileId, compares quality**
   - **Test replacement stores matchedFileId in column G, detalle in column H**
   - **Test comparison: closer date wins, CUIT match wins, etc.**
   - **Test error logging when matching fails**
   - **Test chunked batchUpdate when updates > 500**
   - **Test memory cleanup between bank processing (setImmediate)**

2. Run test-runner (expect fail)

3. Implement `src/bank/match-movimientos.ts`:

   **Required imports:**
   ```typescript
   import type { Result, Factura, Pago, Recibo, Retencion, MovimientoRow } from '../types/index.js';
   import { PROCESSING_LOCK_ID, PROCESSING_LOCK_TIMEOUT_MS } from '../config.js';
   import { withLock } from '../utils/concurrency.js';
   import { info, error as logError } from '../utils/logger.js';
   import { getCachedFolderStructure } from '../services/folder-structure.js';
   import { getValues, type CellValue } from '../services/sheets.js';
   import { parseNumber } from '../utils/numbers.js';
   import { BankMovementMatcher } from './matcher.js';
   import { getMovimientosToFill } from '../services/movimientos-reader.js';
   import { updateDetalle } from '../services/movimientos-detalle.js';
   ```

   **Match comparison helper:**
   ```typescript
   interface MatchQuality {
     fileId: string;
     hasCuitMatch: boolean;
     dateDistance: number;      // absolute days from movimiento
     isExactAmount: boolean;    // vs needs retencion tolerance
     hasLinkedPago: boolean;    // Factura with Pago vs Factura alone
   }

   // Returns true if candidate is strictly better than existing
   function isBetterMatch(existing: MatchQuality, candidate: MatchQuality): boolean {
     // 1. CUIT match beats no CUIT match
     if (candidate.hasCuitMatch && !existing.hasCuitMatch) return true;
     if (!candidate.hasCuitMatch && existing.hasCuitMatch) return false;

     // 2. Closer date wins (when CUIT match is equal)
     if (candidate.dateDistance < existing.dateDistance) return true;
     if (candidate.dateDistance > existing.dateDistance) return false;

     // 3. Exact amount beats tolerance match
     if (candidate.isExactAmount && !existing.isExactAmount) return true;
     if (!candidate.isExactAmount && existing.isExactAmount) return false;

     // 4. Has linked pago beats no linked pago
     if (candidate.hasLinkedPago && !existing.hasLinkedPago) return true;

     // Equal quality - keep existing (no churn)
     return false;
   }
   ```

   **Parsing functions:** Use header-based column lookup (see Integration Notes)

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

   // Match all movimientos across all banks
   async function matchAllMovimientos(
     options?: MatchOptions
   ): Promise<Result<MatchAllResult, Error>> {
     // Use existing withLock for concurrency control (shared with scanner)
     // Pass custom auto-expiry timeout (5 minutes instead of default 30s)
     const lockResult = await withLock(
       PROCESSING_LOCK_ID,
       async () => {
         const startTime = Date.now();

         // 1. Load Control data ONCE (6 API calls total)
         const ingresosData = await loadControlIngresos();  // 3 calls
         if (!ingresosData.ok) return ingresosData;

         const egresosData = await loadControlEgresos();    // 3 calls
         if (!egresosData.ok) return egresosData;

         // 2. Process banks SEQUENTIALLY (memory efficient)
         const results: MatchMovimientosResult[] = [];
         const bankSpreadsheets = getCachedFolderStructure()?.bankSpreadsheets;

         for (const [bankName, spreadsheetId] of bankSpreadsheets) {
           // Allow GC between banks
           await new Promise(resolve => setImmediate(resolve));

           // Load this bank's movimientos (1 metadata + N chunked sheet reads)
           // Always loads ALL movimientos - replacement logic decides what to update
           const movimientos = await getMovimientosToFill(spreadsheetId);
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

           // Match in memory with replacement logic
           const updates = matchAllWithReplacement(
             movimientos.value,
             ingresosData.value,
             egresosData.value,
             options?.force ?? false  // force clears existing matches
           );
           // Each update includes: { sheetName, rowNumber, matchedFileId, detalle }
           // Only includes rows where:
           //   - No existing match (matchedFileId was empty), OR
           //   - New match is better (isBetterMatch returned true), OR
           //   - force=true (clear and rematch all)
           //
           // For rows with existing match:
           //   1. Look up existing document by matchedFileId from loaded Control data
           //   2. Build MatchQuality for existing and candidate
           //   3. Call isBetterMatch() to compare
           //   4. Only update if candidate wins

           // Write batch update (chunked if > 500)
           await updateDetalle(spreadsheetId, updates);

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
       PROCESSING_LOCK_TIMEOUT_MS,  // Wait timeout: 5 minutes
       PROCESSING_LOCK_TIMEOUT_MS   // Auto-expiry: 5 minutes (custom, not default 30s)
     );

     // Handle lock acquisition failure (scan or match already running)
     if (!lockResult.ok) {
       info('Match movimientos skipped - scan or match already running', { module: 'match-movimientos' });
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

### Task 8: Add API route for match-movimientos

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

### Task 9: Add Dashboard menu option for match-movimientos

1. Update `apps-script/src/main.ts`:
   - Add "📝 Completar Detalles Movimientos" menu item after "Auto-fill Bank Data"
   - Add `triggerMatchMovimientos` function calling `/api/match-movimientos`

2. Build and test:
   - Run `npm run build:script`
   - Verify menu item appears and works

### Task 10: Add unified lock to scan with deferral (NOT skipping) and trigger match-movimientos after

1. Write test in `src/processing/scanner.test.ts`:
   - **Test that scan process is wrapped in unified lock (`PROCESSING_LOCK_ID` from config)**
   - **Test scan deferral with pending flag:**
     - First scan acquires lock and runs
     - Second scan while lock held → sets pending flag, waits for lock, then runs
     - Third scan while pending exists → returns `skipped: true` (pending scan will handle it)
   - **Test that scan cannot run while match is running (waits for match to finish)**
   - Test that scan triggers matchAllMovimientos after processing any document type
   - Test that matchAllMovimientos runs async (doesn't block scan response)
   - Test that matchAllMovimientos is called only when scan succeeds
   - **Test that match is triggered AFTER scan releases lock (not inside lock)**
   - **Test that errors are logged (not silently discarded)**
   - **Test that retriedFileIds is cleared in finally block (not just on success)**

2. Run test-runner (expect fail)

3. Update `src/processing/scanner.ts`:
   - Import `matchAllMovimientos` from `../bank/match-movimientos.js`
   - Import `withLock` from `../utils/concurrency.js`
   - Import `PROCESSING_LOCK_ID, PROCESSING_LOCK_TIMEOUT_MS` from `../config.js`
   - Import `error as logError` from `../utils/logger.js`
   - **Add pending scan flag:**
     ```typescript
     // Module-level state for scan deferral
     let pendingScan = false;
     ```
   - **Move `retriedFileIds.clear()` to `finally` block** (not just on success)
   - **Wrap scan processing logic with deferral:**
     ```typescript
     async function processScan(): Promise<Result<ScanResult, Error>> {
       // Check if a scan is already waiting - if so, skip (it will handle our files)
       if (pendingScan) {
         info('Scan skipped - another scan already pending', { module: 'scanner' });
         return {
           ok: true,
           value: { skipped: true, reason: 'scan_pending', filesProcessed: 0 }
         };
       }

       // Set pending flag before waiting for lock
       pendingScan = true;

       try {
         // This WAITS for lock (up to 5 min) instead of returning immediately
         const lockResult = await withLock(
           PROCESSING_LOCK_ID,
           async () => {
             // ... existing scan processing logic ...
             return scanResult;
           },
           PROCESSING_LOCK_TIMEOUT_MS,  // Wait timeout (5 min)
           PROCESSING_LOCK_TIMEOUT_MS   // Auto-expiry (5 min)
         );

         // Handle lock timeout (extremely rare - 5 min wait exceeded)
         if (!lockResult.ok) {
           logError('Scan failed to acquire lock after timeout', {
             module: 'scanner',
             error: lockResult.error.message
           });
           return lockResult;
         }

         // Lock released - NOW trigger match async (outside lock!)
         if (lockResult.value.filesProcessed > 0) {
           void triggerMatchAsync();
         }

         return lockResult;
       } finally {
         // Always clear pending flag when done
         pendingScan = false;
       }
     }
     ```
   - **Match trigger function (called AFTER lock is released):**
     ```typescript
     function triggerMatchAsync(): void {
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
     }
     ```
   - Any document type triggers this (factura, pago, recibo, retencion, resumen)

4. Run test-runner (expect pass)

### Task 11: Update documentation

1. Update `SPREADSHEET_FORMAT.md`:
   - Add 'matchedFileId' column to Movimientos Bancario schema (column G)
   - Add 'detalle' column to Movimientos Bancario schema (column H)
   - Document the matching behavior and sources for both debits and credits
   - Document retencion tolerance matching for credits
   - Document the 90-day retencion date range
   - Document replacement logic with comparison factors:
     - CUIT match > no CUIT match
     - Closer date > further date
     - Exact amount > tolerance match
     - Has linked pago > no linked pago
   - Document known limitations:
     - Partial payments need manual review
     - Year boundary (only current + previous year)
     - Inter-bank transfers may not be detected

2. Update `CLAUDE.md`:
   - Update Movimientos Bancario schema from 6 cols to 8 cols (A:H)
   - Add `/api/match-movimientos` to API ENDPOINTS table
   - Document optional `force` query parameter
   - Document auto-trigger after scan
   - Add note about unified concurrency control:
     - Both scan and match use same lock ID `PROCESSING_LOCK_ID` from config.ts
     - Scans WAIT for lock (with pending flag) instead of skipping
     - At any time, only one scan OR match process can run
     - Lock auto-expires after 5 minutes (configurable via `PROCESSING_LOCK_TIMEOUT_MS`)
     - Prevents race conditions and overlapping processing
   - Document new config constants in ENV VARS or COMMANDS section

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Iteration 1

**Implemented:** 2026-01-31

### Completed Tasks

**Task 0: Add shared constants to config.ts**
- ✅ Added `PROCESSING_LOCK_ID = 'document-processing'`
- ✅ Added `PROCESSING_LOCK_TIMEOUT_MS = 300000` (5 minutes)
- ✅ Added `SHEETS_BATCH_UPDATE_LIMIT = 500`
- ✅ Added `PARALLEL_SHEET_READ_CHUNK_SIZE = 4`
- No test needed (constants only)

**Task 0.5: Update withLock to support custom auto-expiry timeout**
- ✅ Added optional `autoExpiryMs` parameter to `withLock()` function
- ✅ Updated `LockManager.acquire()` to accept and use custom timeout
- ✅ Added `autoExpiryMs` field to `LockState` interface
- ✅ Updated `isLocked()` to check per-lock expiry timeout
- ✅ Tests added: custom timeout, default 30s backward compatibility, auto-expiry behavior
- ✅ All 17 concurrency tests passing

**Task 1: Add matchedFileId and detalle columns to Movimientos Bancario schema**
- ✅ Updated `MOVIMIENTOS_BANCARIO_SHEET.headers` from 6 to 8 columns
- ✅ New columns: `matchedFileId` (index 6), `detalle` (index 7)
- ✅ Updated schema comment from "6 cols (A:F)" to "8 cols (A:H)"
- ✅ Tests added: header count, header order, column positions
- ✅ All 31 spreadsheet-headers tests passing

**Task 2: Update movimientos-store to include empty matchedFileId and detalle columns**
- ✅ Updated `storeMovimientosBancario()` to append 8 columns instead of 6
- ✅ Added empty string `''` for matchedFileId (column G) on all rows
- ✅ Added empty string `''` for detalle (column H) on all rows
- ✅ Updated range from `A:F` to `A:H`
- ✅ Updated empty sheet column count from 6 to 8
- ✅ Applied to: SALDO INICIAL, transaction rows, SALDO FINAL
- ✅ Tests added: 8-column validation, empty matchedFileId/detalle checks
- ✅ All 24 movimientos-store tests passing

**Task 3: Add MovimientoRow type to types/index.ts**
- ✅ Added `MovimientoRow` interface with 10 fields:
  - `sheetName`, `rowNumber`, `fecha`, `origenConcepto`
  - `debito`, `credito`, `saldo`, `saldoCalculado`
  - `matchedFileId`, `detalle`
- ✅ Exported from types/index.ts
- ✅ JSDoc documentation added
- No test needed (type definition only)

### Checklist Results

✅ **bug-hunter:** PASSED - 0 bugs found (reviewed 8 files)
✅ **test-runner:** PASSED - All 1122 tests passing across 54 test files (7.34s)
✅ **builder:** PASSED - Zero warnings, clean build

### Notes

**Foundation work completed:**
- Configuration constants established for lock management, batch processing, and parallel operations
- Lock mechanism enhanced to support long-running operations (5 min vs default 30s)
- Spreadsheet schema updated with columns needed for match tracking and replacement logic
- Storage layer properly initializes new columns as empty strings
- Type definitions created for type-safe movimientos processing

**Remaining work:**
- Task 4: Credit matching logic (complex - requires extensive testing)
- Task 5-10: Services, orchestration, API routes, scanner integration
- Task 11: Documentation updates

**Architecture decisions:**
- Used empty strings (`''`) instead of `null` for matchedFileId/detalle to simplify comparison logic
- 8-column schema maintains backward compatibility (formulas reference unchanged columns A-F)
- Lock timeout increased to 5 minutes to accommodate bank processing across multiple spreadsheets

**No breaking changes** - Existing movimientos sheets will read correctly (columns G-H will be undefined, treated as empty)

### Review Findings

Files reviewed: 8
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions, Test Quality

No issues found - all implementations are correct and follow project conventions.

**Verification points:**
- ✅ SECURITY: Constants are safe values, no user input or external data validation needed
- ✅ LOGIC: Lock expiry correctly uses per-lock `autoExpiryMs`; column indices correct (6=matchedFileId, 7=detalle)
- ✅ ASYNC: Lock acquisition/release properly handled in try/finally pattern
- ✅ TYPE SAFETY: `MovimientoRow` interface correctly mirrors 8-column schema; backward-compatible defaults
- ✅ CONVENTIONS: Pino logger, ESM .js imports, Result<T,E> pattern all followed
- ✅ TEST QUALITY: Meaningful assertions, fictional test data, edge cases covered

**Documented (no fix needed):**
- [MEDIUM] `LockState.autoExpiryMs` is always set on new locks; in-memory locks are transient so no persistence concern
