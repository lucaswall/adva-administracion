# Implementation Plans

---

## COMPLETED: Transaction Extraction from Resumen PDFs (2025-01)

### Summary

Extract individual transactions from bank/card/broker statements and store them in per-month sheets within a new "Movimientos" spreadsheet in each entity folder.

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Types (`src/types/index.ts`) | ✅ Done | `MovimientoBancario`, `MovimientoTarjeta`, `MovimientoBroker`, `*ConMovimientos` |
| Headers (`src/constants/spreadsheet-headers.ts`) | ✅ Done | `MOVIMIENTOS_BANCARIO_SHEET`, `MOVIMIENTOS_TARJETA_SHEET`, `MOVIMIENTOS_BROKER_SHEET` |
| Prompts (`src/gemini/prompts.ts`) | ❌ **NOT DONE** | Prompts never extended to extract `movimientos` array |
| Parser (`src/gemini/parser.ts`) | ✅ Done | Handles `movimientos` array IF present |
| Folder Structure (`src/services/folder-structure.ts`) | ✅ Done | `getOrCreateMovimientosSpreadsheet()` exists |
| Sheets (`src/services/sheets.ts`) | ✅ Done | `getOrCreateMonthSheet()`, `formatEmptyMonthSheet()` |
| Storage (`src/processing/storage/movimientos-store.ts`) | ✅ Done | All three store functions implemented |
| Integration (`src/processing/scanner.ts`) | ✅ Done | Calls movimientos storage IF `movimientos.length > 0` |
| Exports (`src/processing/storage/index.ts`) | ✅ Done | Functions exported |

### Why It's Not Working

The prompts in `src/gemini/prompts.ts` were never updated to request the `movimientos` array from Gemini. The downstream code is ready but receives no data.

---

## CURRENT: Bug Fixes and Improvements (2025-01-24)

### Issues Discovered

#### Issue 1: Movimientos Not Being Extracted (CRITICAL)
**Root Cause**: Prompts never updated to request `movimientos` array
**Fix**: Extend resumen prompts with movimientos extraction

#### Issue 2: Duplicate Bank Folders Due to Gemini Non-Determinism (BUG)
**Root Cause**: Gemini extraction is non-deterministic, no normalization of bank names
**Evidence**: Same file (ResumenBancario03.pdf) processed 3 times with different banco values:
- 19:38:21 `banco="BancoCiudad"` (no space)
- 19:39:17 `banco="Banco Ciudad"` (with space) - created empty folder
- 19:40:15 `banco="BancoCiudad"` (no space)
**Fix**: Add bank name normalization layer after Gemini extraction

#### Issue 2b: Resumen Files Processed Multiple Times (BUG)
**Root Cause**: `getProcessedFileIds()` only checks Control de Ingresos/Egresos, NOT resumen spreadsheets
**Flow that causes duplicate processing**:
1. Scan finds ResumenBancario03.pdf in Entrada
2. `getProcessedFileIds()` checks Ingresos/Egresos → file NOT found
3. File extracted → stored in bank folder
4. Quota error during file move → file stays in Entrada
5. Next scan → processed AGAIN with potentially different banco name
**Fix**: Add centralized file tracking in Dashboard

#### Issue 3: Google Sheets API Quota Exceeded (PERFORMANCE)
**Root Cause**: Current retry config insufficient for quota limits

**Current Config** (`src/utils/concurrency.ts`):
```typescript
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,  // ← Only 2 seconds max!
};
```

**Google Sheets Quota Limits**:
| Limit Type | Requests | Period |
|------------|----------|--------|
| Per-project | 300 | per minute |
| Per-user | 60 | per minute |

**Problem**: Quota resets every 60 seconds, but max wait is only 2 seconds.

**Fix**: Add quota-aware retry logic that:
1. Detects quota errors (HTTP 429 or "Quota exceeded" message)
2. Uses 60+ second delays specifically for quota errors
3. Falls back to standard retry for other errors

---

## Implementation Plan

### Task 0: Fix Duplicate Processing of Resumenes ✅ COMPLETED

**Problem**: `getProcessedFileIds()` doesn't check resumen spreadsheets.

**Solution**: Add centralized file tracking in Dashboard's "Archivos Procesados" sheet.

**New sheet schema** (in Dashboard Operativo Contable):
| Column | Name | Description |
|--------|------|-------------|
| A | fileId | Google Drive file ID |
| B | fileName | Original file name |
| C | processedAt | ISO timestamp |
| D | documentType | Type after classification |
| E | status | "processing", "success", "failed" |

**Files modified**:
- ✅ `src/constants/spreadsheet-headers.ts` - Added `ARCHIVOS_PROCESADOS_SHEET` config
- ✅ `src/services/folder-structure.ts` - Dashboard initialization includes new sheet
- ✅ `src/processing/storage/index.ts` - Added `markFileProcessing()`, `updateFileStatus()`, rewrote `getProcessedFileIds()`
- ✅ `src/processing/scanner.ts` - Mark files BEFORE processing, update status on ALL code paths

**Additional work completed**:
- ✅ Added business-level duplicate detection to Recibos (key: cuilEmpleado + periodoAbonado + totalNeto)
- ✅ Added business-level duplicate detection to Retenciones (key: nroCertificado + cuitAgenteRetencion + fechaEmision + montoRetencion)
- ✅ Updated all storage functions to return `{ stored: boolean; existingFileId?: string }`
- ✅ Scanner now moves duplicates to "Duplicado" folder and calls `updateFileStatus('success')`
- ✅ All document types (factura_emitida, factura_recibida, pago_recibido, pago_enviado, recibo, certificado_retencion, resumen_bancario, resumen_tarjeta, resumen_broker) now have complete updateFileStatus coverage

**Test coverage**: 67 test files, 1474 tests passed

### Task 1: Add Bank Name Normalization ✅ COMPLETED

**Files created**:
- ✅ `src/utils/bank-names.ts` - Normalization function with alias mapping
- ✅ `src/utils/bank-names.test.ts` - Comprehensive test coverage

**Files modified**:
- ✅ `src/gemini/parser.ts` - Applied normalization in `parseResumenBancarioResponse()` and `parseResumenTarjetaResponse()`

**Aliases implemented**:
```typescript
const BANK_NAME_ALIASES: Record<string, string> = {
  'BancoCiudad': 'Banco Ciudad',
  'Banco de la Ciudad': 'Banco Ciudad',
  'Ciudad': 'Banco Ciudad',
  'Banco Credicoop': 'Credicoop',
  'Banco Credicoop Cooperativo Limitado': 'Credicoop',
  'Credicoop Cooperativo Limitado': 'Credicoop',
  'BBVA Frances': 'BBVA',
  'BBVA Francés': 'BBVA',
  'Banco BBVA': 'BBVA',
};
```

**Test coverage**: All normalization cases verified

### Task 2: Fix Quota Handling ✅ COMPLETED

**Problem Analysis**:
- System hitting Google Sheets API quota limits causing 100% processing failures
- Processing 10 files generated ~178 API calls in 46 seconds
- Google Sheets quota: 60 reads/minute per user
- Result: **3.8x over quota** → all files stuck in Entrada folder

**Root Causes Identified**:
1. `withQuotaRetry()` existed but was never used - no retry on quota errors
2. Excessive API calls: ~20 per resumen file, ~9 per factura/pago
3. No timezone caching - fetched multiple times per file
4. Inefficient status updates - reads entire column per file

**Solution: Three-Phase Implementation**

#### Phase 1: Enable Quota Retry (CRITICAL) ✅ COMPLETED
**Impact**: Reduces failures from 100% to ~0%

**Files Modified**:
- ✅ `src/services/sheets.ts` - Wrapped all 17 Google Sheets API calls with `withQuotaRetry()`
- ✅ `src/services/sheets.test.ts` - Added comprehensive quota retry tests (51 tests)

**API calls wrapped**:
1. `getValues()` - spreadsheets.values.get
2. `setValues()` - spreadsheets.values.update
3. `appendRows()` - spreadsheets.values.append
4. `batchUpdate()` - spreadsheets.values.batchUpdate
5. `getSheetMetadata()` - spreadsheets.get (metadata)
6. `getSpreadsheetTimezone()` - spreadsheets.get (timezone)
7. `createSheet()` - spreadsheets.batchUpdate (addSheet)
8. `formatSheet()` - spreadsheets.batchUpdate (formatting)
9. `formatStatusSheet()` - spreadsheets.batchUpdate (formatting)
10. `applyConditionalFormat()` - spreadsheets.batchUpdate (conditional)
11. `deleteSheet()` - spreadsheets.batchUpdate (deleteSheet)
12. `clearSheetData()` - spreadsheets.values.clear
13. `appendRowsWithLinks()` - spreadsheets.batchUpdate (appendCells)
14. `sortSheet()` - spreadsheets.batchUpdate (sortRange)
15. `moveSheetToFirst()` - spreadsheets.batchUpdate (updateSheetProperties)
16. `appendRowsWithFormatting()` - spreadsheets.batchUpdate (appendCells)
17. `formatEmptyMonthSheet()` - spreadsheets.batchUpdate (updateCells)

**Retry Behavior**:
- Quota errors: 15-65 second delays, max 5 retries
- Other errors: 100-2000ms delays, max 3 retries
- Exponential backoff with jitter

#### Phase 2: Add Timezone Caching (HIGH VALUE) ✅ COMPLETED
**Impact**: Saves ~3-5 API calls per scan

**Files Modified**:
- ✅ `src/services/sheets.ts` - Added timezone cache with 24h TTL
- ✅ `src/services/sheets.test.ts` - Added timezone caching tests (5 tests)
- ✅ `tests/unit/services/sheets.test.ts` - Updated to clear cache in beforeEach

**Implementation**:
- Cache structure: `Map<spreadsheetId, { timezone: string, timestamp: number }>`
- TTL: 24 hours (86,400,000 milliseconds)
- Auto-expiration on read
- `clearTimezoneCache()` export for testing

**Pattern**: Follows exchange-rate.ts 24h TTL pattern

#### Phase 3: Optimize File Status Updates (MEDIUM VALUE) ✅ COMPLETED
**Impact**: Saves ~1 API call per file

**Files Modified**:
- ✅ `src/processing/storage/index.ts` - Added row index cache
- ✅ `src/processing/storage/index.test.ts` - Added cache tests (4 tests)

**Implementation**:
- Cache structure: `Map<'${spreadsheetId}:${fileId}', rowIndex>`
- Caching strategy:
  - `markFileProcessing()` caches row index after append
  - `updateFileStatus()` checks cache before reading column
- Per-process cache (cleared between test runs)
- `clearFileStatusCache()` export for testing

**Results**:
- **Total API call reduction**: ~50% (178 → ~90 for 10 files)
- **Quota error handling**: Retries with 15-65s delays (vs total failure)
- **System reliability**: Failures reduced from 100% to ~0%

**Test Coverage**:
- sheets.test.ts: 51 new tests for quota retry
- sheets.test.ts: 5 new tests for timezone caching
- storage/index.test.ts: 4 new tests for row index caching
- All existing tests pass (1605 tests total across 71 test files)

### Task 3: Extend Prompts with Movimientos Extraction

**File**: `src/gemini/prompts.ts`

**Bancario Prompt Extension**:
```
TRANSACTION EXTRACTION:
Extract ALL individual transactions from the table. Return as array:
"movimientos": [
  {
    "fecha": "2024-01-02",
    "origenConcepto": "D 500 TRANSFERENCIA RECIBIDA",
    "debito": null,
    "credito": 50000.00,
    "saldo": 200000.00
  }
]

DATE FORMAT: Convert DD/MM to YYYY-MM-DD using the statement year.
If "SIN MOVIMIENTOS" appears: return "movimientos": []
```

**Tarjeta Prompt Extension**:
```
"movimientos": [
  {
    "fecha": "2024-10-11",
    "descripcion": "ZOOM.COM 888-799 P38264908USD 16,99",
    "nroCupon": "12345678",
    "pesos": 1500.00,
    "dolares": null
  }
]
```

**Broker Prompt Extension**:
```
"movimientos": [
  {
    "descripcion": "Boleto / 5863936 / VENTA / 1 / ZZC1O / $",
    "cantidadVN": 1000,
    "saldo": 50000.00,
    "precio": 100.00,
    "bruto": 100000.00,
    "arancel": 500.00,
    "iva": 105.00,
    "neto": 99395.00,
    "fechaConcertacion": "2024-07-07",
    "fechaLiquidacion": "2024-07-09"
  }
]
```

**Implementation Steps**:
1. Write tests for extended prompts
2. Run test-runner (expect fail)
3. Extend `getResumenBancarioPrompt()`
4. Extend `getResumenTarjetaPrompt()`
5. Extend `getResumenBrokerPrompt()`
6. Run test-runner (expect pass)
7. Test with actual PDFs using Gemini MCP

### Task 4: Validation and Documentation

1. Run bug-hunter agent
2. Run test-runner agent
3. Run builder agent
4. Update PLANS.md to document completed work
5. Create PR using pr-creator

---

## Implementation Order

| Phase | Task | Priority | Status |
|-------|------|----------|--------|
| 0 | Fix Duplicate Processing | CRITICAL | ✅ COMPLETED |
| 1 | Bank Name Normalization | HIGH | ✅ COMPLETED |
| 2 | Fix Quota Handling (3-phase implementation) | HIGH | ✅ COMPLETED |
| 3 | Movimientos Extraction | MEDIUM | ⏸️ DEFERRED (prompts ready, awaiting future implementation) |
| 4 | Validation & Docs | REQUIRED | ✅ COMPLETED |

---

## Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `src/constants/spreadsheet-headers.ts` | MODIFY | Add ARCHIVOS_PROCESADOS_SHEET config |
| `src/services/folder-structure.ts` | MODIFY | Initialize Archivos Procesados sheet |
| `src/processing/storage/index.ts` | MODIFY | Add file tracking functions |
| `src/processing/scanner.ts` | MODIFY | Mark files before processing |
| `src/utils/bank-names.ts` | CREATE | Bank name normalization |
| `src/utils/bank-names.test.ts` | CREATE | Tests for normalization |
| `src/gemini/parser.ts` | MODIFY | Apply bank name normalization |
| `src/utils/concurrency.ts` | MODIFY | Add quota-aware retry |
| `src/utils/concurrency.test.ts` | MODIFY | Tests for quota retry |
| `src/services/sheets.ts` | MODIFY | Use quota-aware retries |
| `src/gemini/prompts.ts` | MODIFY | Add movimientos extraction |
| `src/gemini/prompts.test.ts` | MODIFY | Add prompt tests |

---

## Test Files for Prompt Validation

| File | Type | Banco | Movimientos | Test Case |
|------|------|-------|-------------|-----------|
| ResumenBancarioBBVA12.pdf | Bancario | BBVA | ~112 | Max capacity |
| ResumenBancarioBBVA09.pdf | Bancario | BBVA | ~91 | Large file |
| ResumenBancarioBBVA04.pdf | Bancario | BBVA | ~65 | Multi-page |
| ResumenBancarioBBVA02.pdf | Bancario | BBVA | ~74 | Multi-page |
| ResumenBancario04.pdf | Bancario | Credicoop* | ~3 | Name normalization |
| ResumenBancario03.pdf | Bancario | Banco Ciudad** | ~3 | Name normalization |
| ResumenBancario02.pdf | Bancario | (any) | 0 | SIN MOVIMIENTOS |
| ResumenTarjeta01.pdf | Tarjeta | BBVA | ~14 | Multiple cardholders |
| ResumenBroker01.pdf | Broker | BALANZ | ~13 | Multi-instrument |
| ResumenBroker02.pdf | Broker | (any) | 0 | Empty case |

\* Normalize "Banco Credicoop Cooperativo Limitado" → "Credicoop"
\** Normalize "BancoCiudad" → "Banco Ciudad"
