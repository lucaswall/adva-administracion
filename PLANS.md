# Implementation Plan: Sheets API Reliability & Quota Optimization

**Status:** COMPLETE ✅
**Priority:** CRITICAL
**Created:** 2026-01-25
**Last Updated:** 2026-01-25
**Verified:** 2026-01-25

---

## Summary

This plan addressed four critical issues with the Sheets API integration:

| Issue | Problem | Status |
|-------|---------|--------|
| Nested Retry Wrappers | Multi-step functions could fail silently | ✅ FIXED |
| TOCTOU Race Condition | Concurrent stores could create duplicates | ✅ FIXED |
| Quota Exhaustion | 3.6x over quota limit | ✅ FIXED |
| Tracking Failures | Files could be reprocessed unnecessarily | ✅ FIXED |

---

## What Was Completed

### 1. Single Retry Wrapper Pattern ✅

**Files modified:** `src/services/sheets.ts`

- Created `getSheetMetadataInternal()` without retry wrapper
- Refactored `appendRowsWithLinks`, `appendRowsWithFormatting`, `sortSheet`, `moveSheetToFirst` to use single `withQuotaRetry` wrapper around entire operation
- These functions now accept optional `metadataCache` parameter to use cached metadata
- Eliminates nested retry issue where metadata retry exhaustion prevented append

### 2. TOCTOU Locking ✅

**Files modified:** All store files in `src/processing/storage/`

- Added `withLock()` wrapper to all store functions using business key
- Lock key format: `store:{type}:{business-key-fields}`
- 10 second timeout for locks
- Prevents concurrent identical stores from both passing duplicate check

### 3. Retry for markFileProcessing ✅

**File modified:** `src/processing/storage/index.ts`

- Wrapped `markFileProcessing` body in `withQuotaRetry`
- Ensures tracking always succeeds or fails loudly

### 4. SortBatch Integration ✅

**Files created:** `src/processing/caches/sort-batch.ts`, `src/processing/caches/index.ts`
**Files modified:** `src/processing/scanner.ts`, all store files

- `SortBatch` class collects pending sorts during scan
- Store functions add to batch via `context.sortBatch.addPendingSort()`
- Scanner flushes all sorts at end via `context.sortBatch.flushSorts()`
- Reduces N sorts to ~5 sorts (one per unique sheet)
- **Tests created:** `src/processing/caches/sort-batch.test.ts` ✅

### 5. DuplicateCache Integration ✅

**File created:** `src/processing/caches/duplicate-cache.ts`
**Files modified:** `src/processing/scanner.ts`, all store files

- `DuplicateCache` class pre-loads sheet data at scan start
- Store functions check cache via `context.duplicateCache.isDuplicate*()`
- Store functions update cache via `context.duplicateCache.addEntry()`
- Scanner pre-loads Control de Ingresos and Control de Egresos sheets
- Reduces N duplicate checks to ~6 initial loads
- Uses promise-caching to prevent thundering herd
- **Tests created:** `src/processing/caches/duplicate-cache.test.ts` ✅

**Note:** Resumen spreadsheets (bancario/tarjeta/broker) are dynamically created per-account and cannot be pre-loaded. These fall back to API calls, which is acceptable behavior.

### 6. MetadataCache Integration ✅

**File created:** `src/processing/caches/metadata-cache.ts`
**Files modified:** `src/services/sheets.ts`, all store files

- `MetadataCache` class caches spreadsheet metadata
- Uses promise-caching to prevent thundering herd (concurrent requests share single API call)
- Added to `ScanContext` interface
- Sheets functions (`appendRowsWithLinks`, `sortSheet`, `moveSheetToFirst`, `appendRowsWithFormatting`) accept optional `metadataCache` parameter
- Store functions pass `context.metadataCache` to sheets functions
- Scanner clears cache in finally block
- **Tests created:** `src/processing/caches/metadata-cache.test.ts` ✅

### 7. TokenUsageBatch Integration ✅

**File created:** `src/services/token-usage-batch.ts`
**Files modified:** `src/processing/scanner.ts`, `src/processing/extractor.ts`

- `TokenUsageBatch` class accumulates token usage entries
- Added to `ScanContext` interface
- `extractor.ts` checks for `context?.tokenBatch` and adds entries to batch
- When no context, falls back to immediate `logTokenUsage()` call
- Scanner flushes at end: `context.tokenBatch.flush(dashboardOperativoId)`
- **Tests created:** `src/services/token-usage-batch.test.ts` ✅

### 8. Store Functions with Context Support ✅

**Files modified:** All store files in `src/processing/storage/`

- All store functions accept optional `ScanContext` parameter
- When context provided: use caches, defer sorts
- When no context: fall back to API calls, sort immediately
- Backwards compatible

---

## API Call Reduction Summary

| Optimization | Planned Savings | Status |
|--------------|-----------------|--------|
| Single retry wrapper | 0 (reliability) | ✅ Done |
| TOCTOU locking | 0 (correctness) | ✅ Done |
| Deferred sorting | 124 | ✅ Done |
| Duplicate caching | 62 | ✅ Done |
| Metadata caching | 196 | ✅ Done |
| Token batching | 264 | ✅ Done |

**Total estimated savings:** 646 calls (74% reduction from baseline)

---

## Files Summary

### Created Files

| File | Status |
|------|--------|
| `src/processing/caches/metadata-cache.ts` | ✅ Created |
| `src/processing/caches/sort-batch.ts` | ✅ Created |
| `src/processing/caches/duplicate-cache.ts` | ✅ Created |
| `src/processing/caches/index.ts` | ✅ Created |
| `src/services/token-usage-batch.ts` | ✅ Created |
| `src/processing/caches/metadata-cache.test.ts` | ✅ Created |
| `src/processing/caches/sort-batch.test.ts` | ✅ Created |
| `src/processing/caches/duplicate-cache.test.ts` | ✅ Created |
| `src/services/token-usage-batch.test.ts` | ✅ Created |

### Modified Files

| File | Status |
|------|--------|
| `src/services/sheets.ts` | ✅ Done |
| `src/processing/storage/factura-store.ts` | ✅ Done |
| `src/processing/storage/pago-store.ts` | ✅ Done |
| `src/processing/storage/recibo-store.ts` | ✅ Done |
| `src/processing/storage/retencion-store.ts` | ✅ Done |
| `src/processing/storage/resumen-store.ts` | ✅ Done |
| `src/processing/storage/index.ts` | ✅ Done |
| `src/processing/scanner.ts` | ✅ Done |
| `src/processing/extractor.ts` | ✅ Done |

---

## Architecture Notes

### ScanContext Interface

```typescript
export interface ScanContext {
  sortBatch: SortBatch;
  duplicateCache: DuplicateCache;
  metadataCache: MetadataCache;
  tokenBatch: TokenUsageBatch;
}
```

All four components are:
- Instantiated at start of `scanFolder()`
- Passed to `processFile()` and store functions
- Flushed/cleared at end of scan

### Pre-loaded Sheets

The scanner pre-loads these sheets into DuplicateCache:
- `Control de Ingresos`: Facturas Emitidas, Pagos Recibidos, Retenciones Recibidas
- `Control de Egresos`: Facturas Recibidas, Pagos Enviados, Recibos

Resumen spreadsheets (bancario/tarjeta/broker) are created dynamically per-account and fall back to API calls for duplicate detection.

---

## Known Limitations

1. **Resumen spreadsheet duplicate detection** - Per-account spreadsheets cannot be pre-loaded since we don't know which accounts will be processed. Falls back to API calls, which is acceptable.

2. **SortBatch key parsing** - Uses `:` as delimiter. Sheet names with `:` could theoretically cause issues, but this is unlikely in practice.

---

## Post-Implementation Verification

Completed verification on 2026-01-25:
- [x] All cache classes implemented with tests
- [x] ScanContext includes all 4 components
- [x] Store functions use context when available
- [x] Scanner flushes all batched operations
- [x] Extractor uses tokenBatch when available
- [x] Sheets functions accept metadataCache parameter
