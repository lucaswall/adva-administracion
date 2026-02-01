# Implementation Plan

**Created:** 2026-01-31
**Source:** TODO.md - Critical bug #1, High priority bugs #2-5, plus related Medium items #6-9

## Overview

This plan tackles 1 CRITICAL and 4 HIGH priority bugs, plus 4 related MEDIUM items that share code locality. Consolidated into 2 phases to maximize session efficiency.

**Phase Summary:**
1. **Matching & Cache Reliability** - Bugs #1, #9 (CUIT/matching), #2, #8 (cache failures)
2. **Concurrency & Data Safety** - Bugs #3, #6, #7 (scanner/state), #4, #5 (data safety)

---

## Phase 1: Matching & Cache Reliability

**Bugs:** #1 (critical - wrong CUIT), #9 (medium - cascading displacement), #2 (high - DuplicateCache), #8 (medium - MetadataCache)

### Context Gathered

**Files:**
- `src/processing/matching/recibo-pago-matcher.ts:295-298` - CUIT bug location
- `src/processing/matching/factura-pago-matcher.ts:93` - cascading displacement edge case
- `src/processing/caches/duplicate-cache.ts:37-38` - Silent return on failure
- `src/processing/caches/metadata-cache.ts:18-25` - Promise caching without error handling

**Bug #1 Analysis:**
At lines 295-298, both `cuitPagador` and `cuitBeneficiario` are assigned from `row[7]`:
```typescript
cuitPagador: row[7] ? String(row[7]) : undefined,
nombrePagador: row[8] ? String(row[8]) : undefined,
cuitBeneficiario: String(row[7] || ''), // BUG: Should be different column
nombreBeneficiario: String(row[8] || ''),
```

This means when matching Pagos Enviados against Recibos, the wrong CUIT is used for comparison, causing incorrect matches or missed matches.

**Spreadsheet Schema (from SPREADSHEET_FORMAT.md):**
- Control de Egresos - Pagos Enviados columns:
  - A: fechaPago, B: fileId, C: fileName, D: banco, E: importePagado
  - F: moneda, G: referencia, H: cuitPagador, I: nombrePagador
  - J: concepto, K: processedAt, L: confidence, M: needsReview
  - N: matchedFacturaFileId, O: matchConfidence

For Pagos Enviados, ADVA is the pagador. The beneficiary info should come from a different source (the matched recibo).

**Bug #9 Analysis:**
In factura-pago-matcher.ts, when all facturas are already claimed, a displaced pago with a previous match doesn't get cleared. This leaves stale matchedFacturaFileId values.

**Bug #2 Analysis:**
At line 38:
```typescript
if (!rowsResult.ok) return;
```
If sheet load fails, the function returns without setting cache data, but loadPromise is marked complete. Subsequent calls check `this.cache.has(key)` which returns false, but `this.loadPromises.has(key)` returns true, so they await the completed promise and continue with empty cache. This makes duplicate detection unreliable.

**Bug #8 Analysis:**
MetadataCache stores promises directly:
```typescript
this.cache.set(spreadsheetId, getSheetMetadataInternal(spreadsheetId));
```
If the promise rejects, subsequent calls await the same rejected promise, creating a permanent negative cache entry for transient API failures.

### Task 1.1: Fix CUIT field assignment (bug #1)

1. Write test in `src/processing/matching/recibo-pago-matcher.test.ts`:
   - Test that pagos parsed from sheet have correct cuitPagador from column H
   - Test that cuitBeneficiario is NOT assigned from pago sheet (it comes from matched recibo)
   - Test that matching uses correct CUIT values

2. Run test-runner (expect fail)

3. Update `src/processing/matching/recibo-pago-matcher.ts:295-298`:
   - Remove `cuitBeneficiario` and `nombreBeneficiario` from pago parsing
   - These fields should come from the matched recibo, not from the pago sheet
   - The pago sheet only has the pagador (ADVA) info in columns H:I

4. Run test-runner (expect pass)

### Task 1.2: Fix cascading displacement edge case (bug #9)

1. Write test in `src/processing/matching/factura-pago-matcher.test.ts`:
   - Test that when all facturas are claimed and a pago is displaced, its old match is cleared
   - Test that displaced pago with no available matches has matchedFacturaFileId set to undefined

2. Run test-runner (expect fail)

3. Update `src/processing/matching/factura-pago-matcher.ts`:
   - When a displaced pago finds no available facturas, explicitly clear its match
   - Add update to set `matchedFacturaFileId = undefined` for displaced pagos with no matches

4. Run test-runner (expect pass)

### Task 1.3: Fix DuplicateCache silent failure (bug #2)

1. Write test in `src/processing/caches/duplicate-cache.test.ts`:
   - Mock getValues to return error
   - Call loadSheet, verify it completes without throwing
   - Call loadSheet again, verify it retries (new API call made)
   - Test that failed loads don't prevent retry

2. Run test-runner (expect fail)

3. Update `src/processing/caches/duplicate-cache.ts:31-49`:
   - On failure, delete the loadPromise so subsequent calls will retry
   - Throw error or return a marker to indicate failure
   - Option A: Delete loadPromise on failure and throw (caller can retry)
   - Option B: Track failure separately and allow retry after timeout

4. Run test-runner (expect pass)

### Task 1.4: Fix MetadataCache negative cache entries (bug #8)

1. Write test in `src/processing/caches/metadata-cache.test.ts`:
   - Mock getSheetMetadataInternal to reject first call, succeed second
   - Call get(), verify rejection
   - Call get() again, verify retry (not cached rejection)
   - Test transient failures don't create permanent negative entries

2. Run test-runner (expect fail)

3. Update `src/processing/caches/metadata-cache.ts:18-25`:
   - Don't cache the promise directly
   - Add error handling: if promise rejects, delete from cache
   - Use pattern: cache promise, on rejection delete entry
   ```typescript
   const promise = getSheetMetadataInternal(spreadsheetId)
     .catch((error) => {
       this.cache.delete(spreadsheetId);
       throw error;
     });
   this.cache.set(spreadsheetId, promise);
   ```

4. Run test-runner (expect pass)

---

## Phase 2: Concurrency & Data Safety

**Bugs:** #3 (high - module-level retry Map), #6 (medium - async unhandled promises), #7 (medium - dual-status gap), #4 (high - pagos-pendientes data loss), #5 (high - folder-structure cache race)

### Context Gathered

**Files:**
- `src/processing/scanner.ts:51` - Module-level `retriedFileIds` Map
- `src/processing/extractor.ts:146` - Fire-and-forget promise
- `src/processing/scanner.ts:88-103` - Dual markFileProcessing calls
- `src/services/pagos-pendientes.ts:145-176` - Clear before write pattern
- `src/services/folder-structure.ts:642-645` - Cache cleared during locked operation

**Bug #3 Analysis:**
```typescript
const retriedFileIds = new Map<string, number>();
```
This Map is at module level, shared across all scan invocations. It's only cleared in the `finally` block of `scanFolder`. If concurrent scans occur, or if a scan is interrupted, this Map can:
1. Grow unbounded (memory leak)
2. Carry stale retry counts between scans
3. Cause incorrect retry behavior

**Bug #6 Analysis:**
At extractor.ts:146:
```typescript
void logTokenUsage(dashboardOperativoId, entry).then(result => { ... });
```
If the promise rejects before `.then()` attaches, the rejection is unhandled.

**Bug #7 Analysis:**
At scanner.ts:88-103, markFileProcessing is called at the start. If extraction fails between the mark and completion update, the file remains in 'processing' status for 5 minutes (stale recovery timeout). This creates a gap where the file is neither processing nor failed.

**Bug #4 Analysis:**
The current pattern (from previous plan phase 3):
1. Clear existing data (line 145)
2. Write new data (line 162)

If write fails after clear, data is lost. The warning is logged but there's no recovery. While the data can be regenerated from source (Control de Egresos), this causes temporary data loss that's confusing for users.

**Note:** This was partially addressed in the previous plan (Phase 3, Task 3.1), but the implementation used clear+setValues which still has the same issue. Need to verify if this is still a bug or if it was mitigated.

**Bug #5 Analysis:**
At lines 642-645:
```typescript
if (!cachedStructure) {
  throw new Error('Folder structure cache was cleared during operation');
}
```
While the lock prevents concurrent calls to the same folder creation, it doesn't prevent `clearFolderStructureCache()` from being called by a different code path. The current implementation throws an error, which is better than silently failing, but could be more graceful.

### Task 2.1: Fix module-level retry Map (bug #3)

1. Write test in `src/processing/scanner.test.ts`:
   - Test that retry state is isolated per scan invocation
   - Test that concurrent scan calls don't share retry counts
   - Test that Map is cleared after scan completes (success or failure)

2. Run test-runner (expect fail)

3. Update `src/processing/scanner.ts`:
   - Move `retriedFileIds` inside `scanFolder` function scope
   - Pass it to `processFile` as a parameter
   - Or create a ScanContext class that holds scan-specific state
   - Ensure cleanup happens in finally block

4. Run test-runner (expect pass)

### Task 2.2: Fix unhandled promise rejection (bug #6)

1. Write test in `src/processing/extractor.test.ts`:
   - Mock logTokenUsage to reject
   - Verify no unhandled promise rejection
   - Verify warning is logged for failed token logging

2. Run test-runner (expect fail)

3. Update `src/processing/extractor.ts:146`:
   - Add `.catch()` to handle rejection:
   ```typescript
   void logTokenUsage(dashboardOperativoId, entry)
     .then(result => {
       if (!result.ok) { warn(...); }
     })
     .catch(error => {
       warn('Token usage logging failed', { error: error.message, ... });
     });
   ```

4. Run test-runner (expect pass)

### Task 2.3: Fix dual-status processing gap (bug #7)

1. Write test in `src/processing/scanner.test.ts`:
   - Test that extraction failure immediately updates status to 'failed'
   - Test that status is never left as 'processing' on error
   - Test stale recovery correctly identifies files stuck > 5 minutes

2. Run test-runner (expect fail)

3. Update `src/processing/scanner.ts:88-103`:
   - In catch block, immediately update status to 'failed:<error>'
   - Use try-finally pattern to ensure status always updated
   - Add explicit failure marking in all error paths

4. Run test-runner (expect pass)

### Task 2.4: Verify pagos-pendientes data loss fix (bug #4)

1. Read current implementation of `src/services/pagos-pendientes.ts`
2. Write test in `src/services/pagos-pendientes.test.ts`:
   - Test that if setValues fails, an error is returned
   - Test that the pattern is: clear old data, write new data
   - Verify this is the expected behavior (view can be regenerated from source)

3. If already fixed (clear+setValues pattern), document in this plan
4. If not fixed, implement atomic write pattern

### Task 2.5: Improve folder-structure cache race handling (bug #5)

1. Write test in `src/services/folder-structure.test.ts`:
   - Test that cache cleared during operation throws clear error
   - Test that error message includes operation context
   - Test recovery path: caller can re-discover structure

2. Run test-runner (expect fail or pass - depends on current state)

3. Verify current implementation is acceptable:
   - Error is thrown (not silent failure)
   - Error message is descriptive
   - Caller can recover by re-calling discoverFolderStructure

4. If improvement needed, add more context to error message

---

## Post-Implementation Checklist (Run After EACH Phase)

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Notes

**Phase Independence:** Each phase can be implemented independently. Complete Phase 1 before starting Phase 2.

**Context Management:** Each phase has 4-5 tasks which is manageable in a single session.

**Related Items:** The following MEDIUM items are included because they share code locality:
- #6 (async unhandled promises) - Same files as #3 (scanner.ts, extractor.ts)
- #7 (dual-status gap) - Same file as #3 (scanner.ts)
- #8 (MetadataCache) - Same pattern as #2 (cache reliability)
- #9 (cascading displacement) - Same domain as #1 (matching logic)

**Remaining TODO.md Items:** After this plan completes, update TODO.md to remove items #1-9 and renumber remaining items.

---

## Iteration 1

**Implemented:** 2026-02-01

### Phase 1: Matching & Cache Reliability - Completed

#### Task 1.1: Fix CUIT field assignment (bug #1)
- Created test in `src/processing/matching/recibo-pago-matcher.test.ts`
- Test confirmed pago parsing incorrectly assigned `cuitBeneficiario` and `nombreBeneficiario` from columns H:I
- Fixed by removing these fields from pago parsing in `recibo-pago-matcher.ts:297-298`
- Pagos Enviados sheet only contains pagador info (ADVA); beneficiary comes from matched recibo
- Test passes ✓

#### Task 1.2: Fix cascading displacement edge case (bug #9)
- Created test in `src/processing/matching/factura-pago-matcher.test.ts`
- Test confirmed displaced pagos with no matches retained old `matchedFacturaFileId`
- Fixed by adding unmatch update with `pago:` prefix key when no matches found
- Updated `MatchUpdate` interface to include `pagoRow` field
- Modified update application logic to handle pago unmatch updates
- Files modified: `factura-pago-matcher.ts`, `cascade-matcher.ts`
- Test passes ✓

#### Task 1.3: Fix DuplicateCache silent failure (bug #2)
- Created test in `src/processing/caches/duplicate-cache.test.ts`
- Test confirmed failed promises were cached, preventing retry
- Fixed by deleting `loadPromise` from cache on failure in `doLoadSheet()`
- Added try-catch to handle both Result errors and thrown exceptions
- Test passes ✓

#### Task 1.4: Fix MetadataCache negative cache entries (bug #8)
- Created test in `src/processing/caches/metadata-cache.test.ts`
- Test confirmed rejected promises were permanently cached
- Fixed by chaining `.then()` and `.catch()` to delete cache entry on failure
- Allows retry for transient API failures
- Test passes ✓

### Files Modified
- `src/processing/matching/recibo-pago-matcher.ts` - Removed incorrect CUIT field assignments
- `src/processing/matching/recibo-pago-matcher.test.ts` - Added test for bug #1
- `src/processing/matching/factura-pago-matcher.ts` - Added pago unmatch updates, updated application logic
- `src/processing/matching/factura-pago-matcher.test.ts` - Added test for bug #9
- `src/matching/cascade-matcher.ts` - Added `pagoRow` field to `MatchUpdate` interface
- `src/processing/caches/duplicate-cache.ts` - Added retry logic with loadPromise cleanup
- `src/processing/caches/duplicate-cache.test.ts` - Added test for bug #2
- `src/processing/caches/metadata-cache.ts` - Added promise rejection cleanup
- `src/processing/caches/metadata-cache.test.ts` - Added test for bug #8

### Pre-commit Verification
- bug-hunter: Passed - No bugs found
- test-runner: All 1289 tests pass
- builder: Zero warnings

### Review Findings

Files reviewed: 9
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions, Edge Cases

**Summary:** 0 CRITICAL, 0 HIGH, 2 MEDIUM (documented only)

**Documented (no fix needed):**
- [MEDIUM] EDGE CASE: `factura-pago-matcher.ts:553` - When handling pago unmatch, `pagosMap.get(update.pagoFileId)` may return undefined if pago not in map. However, this is defensive - the pago was just processed and should always exist. Silent skip is acceptable.
- [MEDIUM] TYPE: `cascade-matcher.ts:86-88` - `pagoFileId` is required but set to empty string for unmatch updates. Acceptable since interface documents empty string means unmatch.

No issues found - all implementations are correct and follow project conventions.

<!-- REVIEW COMPLETE -->

---

## Iteration 2

**Implemented:** 2026-02-01

### Phase 2: Concurrency & Data Safety - In Progress

#### Task 2.1: Fix module-level retry Map (bug #3) - COMPLETED
- Created test in `src/processing/scanner.test.ts`
- Test documented that retry state should be isolated per scan invocation
- Fixed by moving `retriedFileIds` from module level into `scanFolder` function scope
- Added `retriedFileIds` parameter to `processFileWithRetry` function
- Updated recursive retry call to pass `retriedFileIds`
- Removed `retriedFileIds.clear()` from finally block (no longer needed)
- Benefits:
  - Concurrent scans no longer share retry counts
  - No memory leak (Map is garbage collected with function scope)
  - No stale retry state between scans
- Test passes ✓

### Files Modified (Phase 2 so far)
- `src/processing/scanner.ts` - Moved retriedFileIds to function scope, added parameter
- `src/processing/scanner.test.ts` - Added test for bug #3

### Pre-commit Verification (Phase 2 in progress)
- test-runner: All 1290 tests pass
- Remaining tasks: 2.2, 2.3, 2.4, 2.5
- Post-phase checklist pending completion

---

## Status: IN PROGRESS

Phase 1 complete (4/4 tasks). Phase 2 in progress (1/5 tasks complete).

**Summary:**
- ✅ Bug #1 (CRITICAL): CUIT field assignment fixed
- ✅ Bug #9 (MEDIUM): Cascading displacement edge case fixed
- ✅ Bug #2 (HIGH): DuplicateCache silent failure fixed
- ✅ Bug #8 (MEDIUM): MetadataCache negative cache entries fixed
- ✅ Bug #3 (HIGH): Module-level retry Map fixed
- ⏳ Bug #6 (MEDIUM): Async unhandled promises - pending
- ⏳ Bug #7 (MEDIUM): Dual-status processing gap - pending
- ⏳ Bug #4 (HIGH): Pagos-pendientes data loss - pending
- ⏳ Bug #5 (HIGH): Folder-structure cache race - pending

**Remaining Work:**
Continue with Task 2.2 through 2.5 to complete Phase 2, then run post-implementation checklist.
