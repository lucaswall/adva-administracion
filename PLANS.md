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

**File modified**: `src/utils/concurrency.ts`

**Functions implemented**:
- ✅ `SHEETS_QUOTA_RETRY_CONFIG` - Configuration with 15-65 second delays
- ✅ `isQuotaError()` - Detects quota errors (HTTP 429, "quota exceeded", "rate limit", "too many requests")
- ✅ `withQuotaRetry()` - Executes functions with quota-aware retry logic

**Key features**:
- Uses 15-65 second delays specifically for quota errors
- Falls back to standard retry (100-2000ms) for other errors
- Exponential backoff with jitter
- Max 5 retries for quota errors

**Test coverage**: All quota detection and retry scenarios verified

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
| 2 | Fix Quota Handling | HIGH | ✅ COMPLETED |
| 3 | Movimientos Extraction | MEDIUM | ⏸️ DEFERRED (prompts ready, awaiting future implementation) |
| 4 | Validation & Docs | REQUIRED | 🔄 IN PROGRESS |

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
