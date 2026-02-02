# Implementation Plan

**Created:** 2026-02-01
**Source:** Linear Backlog - Urgent and High Priority Issues
**Linear Issues:** [ADV-6](https://linear.app/adva-administracion/issue/ADV-6), [ADV-7](https://linear.app/adva-administracion/issue/ADV-7), [ADV-8](https://linear.app/adva-administracion/issue/ADV-8), [ADV-9](https://linear.app/adva-administracion/issue/ADV-9), [ADV-10](https://linear.app/adva-administracion/issue/ADV-10), [ADV-11](https://linear.app/adva-administracion/issue/ADV-11), [ADV-12](https://linear.app/adva-administracion/issue/ADV-12), [ADV-13](https://linear.app/adva-administracion/issue/ADV-13), [ADV-14](https://linear.app/adva-administracion/issue/ADV-14), [ADV-15](https://linear.app/adva-administracion/issue/ADV-15), [ADV-17](https://linear.app/adva-administracion/issue/ADV-17), [ADV-19](https://linear.app/adva-administracion/issue/ADV-19), [ADV-20](https://linear.app/adva-administracion/issue/ADV-20), [ADV-21](https://linear.app/adva-administracion/issue/ADV-21), [ADV-22](https://linear.app/adva-administracion/issue/ADV-22), [ADV-26](https://linear.app/adva-administracion/issue/ADV-26)

## Context Gathered

### Codebase Analysis

**Group 1 - Data Validation & Extraction:**
- `src/gemini/parser.ts` - ADVA_NAME_PATTERN (line 28), CUIT assignment (line 89), confidence floor (lines 488-489, 613, 719, 969, 1132, 1263, 1502)
- `src/utils/validation.ts` - extractDniFromCuit strips leading zeros (line 157)
- Existing test patterns: `src/gemini/parser.test.ts`, `src/utils/validation.test.ts`

**Group 2 - Date Handling & Timezone:**
- `src/utils/date.ts` - Consistently uses UTC (getUTCMonth, getUTCFullYear, getUTCDate)
- `src/utils/spanish-date.ts` - Uses local time (getMonth at line 35) - INCONSISTENT
- `src/services/sheets.ts` - Timezone cache (lines 51, 85-114), getOrCreateMonthSheet race (lines 1434-1437)
- Existing test patterns: `src/utils/date.test.ts`

**Group 3 - Concurrency & Lock Management:**
- `src/utils/concurrency.ts` - Lock auto-expiry check (lines 86-98), withLock function
- `src/processing/scanner.ts` - State machine (lines 386-402)
- `src/processing/storage/index.ts` - markFileProcessing no timeout (line 57)
- `src/bank/match-movimientos.ts` - TOCTOU race (lines 636-716), header lookup (lines 140-160)
- Existing test patterns: `src/utils/concurrency.test.ts`

**Group 4 - Service Layer & Error Handling:**
- `src/server.ts` - Shutdown handlers (lines 227-228), startup scan (lines 130-164)
- `src/services/pagos-pendientes.ts` - Clear before write (lines 156-187)
- `src/middleware/auth.ts` - Timing leak (lines 17-34)

---

## Original Plan

### Group 1: Data Validation & Extraction (5 issues)

Focus: CUIT/DNI validation, name pattern matching, confidence scoring, and header validation.

#### Task 1: Fix CUIT DNI extraction to preserve leading zeros
**Linear Issue:** [ADV-9](https://linear.app/adva-administracion/issue/ADV-9)

**Problem:** `extractDniFromCuit()` strips leading zeros, causing DNI "00123456" to become "123456", breaking CUIT-DNI matching.

1. Write test in `src/utils/validation.test.ts`:
   - Test extractDniFromCuit preserves leading zeros for DNI with leading zeros
   - Test cuitContainsDni works with zero-padded DNIs (e.g., CUIT "20-00123456-X" contains DNI "00123456")
   - Test edge cases: DNI "01234567", "00000001"
2. Run verifier (expect fail)
3. Implement fix in `src/utils/validation.ts`:
   - Remove the `replace(/^0+/, '')` call at line 157
   - Keep full 8-character DNI portion
   - Update cuitContainsDni to compare with proper zero-padding
4. Run verifier (expect pass)

#### Task 2: Tighten ADVA_NAME_PATTERN regex
**Linear Issue:** [ADV-10](https://linear.app/adva-administracion/issue/ADV-10)

**Problem:** Pattern `/ADVA|ASOC.*DESARROLL|VIDEOJUEGO/i` matches unrelated companies like "ASOCIACION DE DESARROLLADORES DE SOFTWARE".

1. Write test in `src/gemini/parser.test.ts`:
   - Test `isAdvaName` rejects "ASOCIACION DE DESARROLLADORES DE SOFTWARE"
   - Test `isAdvaName` rejects "ASOCIACION DESARROLLADORES DE APPS"
   - Test `isAdvaName` accepts "ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS"
   - Test `isAdvaName` accepts "ASOC CIVIL DESARROLLADORES VIDEOJUEGOS"
   - Test `isAdvaName` accepts "ADVA"
2. Run verifier (expect fail)
3. Implement fix in `src/gemini/parser.ts`:
   - Change regex to require VIDEOJUEGO in the ASOC.*DESARROLL branch: `/ADVA|(?:ASOC.*DESARROLL.*VIDEOJUEGO|VIDEOJUEGO.*DESARROLL)/i`
   - Ensure both orderings work (DESARROLLADORES VIDEOJUEGOS and VIDEOJUEGOS ARGENTINOS)
4. Run verifier (expect pass)

#### Task 3: Add extraction failure flagging for empty CUIT
**Linear Issue:** [ADV-11](https://linear.app/adva-administracion/issue/ADV-11)

**Problem:** Empty CUIT silently accepted instead of being flagged for review.

1. Write test in `src/gemini/parser.test.ts`:
   - Test assignCuitsAndClassify flags when no counterparty CUIT found
   - Test parseFacturaResponse sets a review flag or low confidence when cuitReceptor is empty for factura_emitida
   - Test the ParseResult includes a warning or review flag
2. Run verifier (expect fail)
3. Implement fix in `src/gemini/parser.ts`:
   - Add `reviewRequired` field to ParseResult when CUIT is missing
   - Lower confidence significantly (0.3) when counterparty CUIT is empty
   - Log a warning when returning empty CUIT
4. Run verifier (expect pass)

#### Task 4: Validate header indices in match-movimientos
**Linear Issue:** [ADV-12](https://linear.app/adva-administracion/issue/ADV-12)

**Problem:** `indexOf` returns -1 for missing headers, causing `row[-1]` to access undefined data silently.

1. Write test in `src/bank/match-movimientos.test.ts`:
   - Test parsing throws/fails when required header is missing
   - Test parsing fails when header has case mismatch
   - Test parsing succeeds with correct headers
2. Run verifier (expect fail)
3. Implement fix in `src/bank/match-movimientos.ts`:
   - Create helper function `getRequiredColumnIndex(headers, name)` that throws if not found
   - Update all `headers.indexOf()` calls to use the helper
   - Add explicit validation after building colIndex object
4. Run verifier (expect pass)

#### Task 5: Remove artificial confidence floor of 0.5
**Linear Issue:** [ADV-21](https://linear.app/adva-administracion/issue/ADV-21)

**Problem:** `Math.max(0.5, completeness)` floors confidence at 50% even when data quality is poor.

1. Write test in `src/gemini/parser.test.ts`:
   - Test parseFacturaResponse returns confidence < 0.5 when only 30% of fields present
   - Test that extracting only `tipoComprobante` yields confidence around 0.1
   - Test that full extraction yields confidence near 1.0
2. Run verifier (expect fail)
3. Implement fix in `src/gemini/parser.ts`:
   - Remove `Math.max(0.5, ...)` calls at lines 488-489, 613, 719, 969, 1132, 1263, 1502
   - Add minimum floor of 0.1 only when at least one critical field is present
   - Update comments to explain confidence calculation
4. Run verifier (expect pass)

---

### Group 2: Date Handling & Timezone (4 issues)

Focus: UTC consistency, timezone cache management, and race conditions in sheet operations.

#### Task 6: Fix timezone inconsistency in spanish-date.ts
**Linear Issue:** [ADV-14](https://linear.app/adva-administracion/issue/ADV-14)

**Problem:** `spanish-date.ts` uses `getMonth()` (local time) while `date.ts` uses `getUTCMonth()`, causing folder name mismatches.

1. Write test in `src/utils/spanish-date.test.ts` (create if needed):
   - Test formatMonthFolder with UTC date at midnight (edge case for timezone boundary)
   - Test formatMonthFolder with date created from parseArgDate (which uses UTC noon)
   - Test that UTC 2025-01-01 12:00 produces "01 - Enero" not "12 - Diciembre"
2. Run verifier (expect fail)
3. Implement fix in `src/utils/spanish-date.ts`:
   - Change `date.getMonth()` to `date.getUTCMonth()` at line 35
   - Update JSDoc to clarify UTC behavior
4. Run verifier (expect pass)

#### Task 7: Add bounds and LRU eviction to timezone cache
**Linear Issue:** [ADV-17](https://linear.app/adva-administracion/issue/ADV-17)

**Problem:** Timezone cache accumulates entries without proper eviction, causing memory growth.

1. Write test in `src/services/sheets.test.ts`:
   - Test cache evicts oldest entries when MAX_TIMEZONE_CACHE_SIZE exceeded
   - Test cache TTL works correctly (entries expire after timeout)
   - Test LRU behavior - recently accessed entries stay in cache
2. Run verifier (expect fail)
3. Implement fix in `src/services/sheets.ts`:
   - Add LRU tracking to timezone cache
   - Evict least-recently-used entry when cache is full
   - Ensure empty/cleared entries are removed, not just aged out
4. Run verifier (expect pass)

#### Task 8: Fix race condition in getOrCreateMonthSheet
**Linear Issue:** [ADV-20](https://linear.app/adva-administracion/issue/ADV-20)

**Problem:** TOCTOU race between checking if sheet exists and creating it can cause data loss.

1. Write test in `src/services/sheets.test.ts`:
   - Test concurrent calls to getOrCreateMonthSheet with same month don't create duplicates
   - Test existing data is preserved when sheet already exists
   - Test headers are only written to new sheets
2. Run verifier (expect fail)
3. Implement fix in `src/services/sheets.ts`:
   - Use lock mechanism around getOrCreateMonthSheet
   - Or use atomic create-if-not-exists pattern with Google Sheets API
   - Re-check sheet existence after acquiring lock before creating
4. Run verifier (expect pass)

#### Task 9: Add TOCTOU protection in match-movimientos replacement
**Linear Issue:** [ADV-19](https://linear.app/adva-administracion/issue/ADV-19)

**Problem:** Reading existing match, comparing, then updating creates race condition where concurrent updates are lost.

1. Write test in `src/bank/match-movimientos.test.ts`:
   - Test updateDetalle preserves concurrent modifications
   - Test version conflict detection when row changed between read and write
   - Mock scenarios where row data changes during processing
2. Run verifier (expect fail)
3. Implement fix in `src/bank/match-movimientos.ts`:
   - Use optimistic locking with version check from `computeVersion`
   - Re-read row before final update and verify version
   - Retry on version conflict (limited attempts)
4. Run verifier (expect pass)

---

### Group 3: Concurrency & Lock Management (4 issues)

Focus: Lock expiry atomicity, scanner state machine, storage locks, and state transition safety.

#### Task 10: Fix lock auto-expiry race condition
**Linear Issue:** [ADV-8](https://linear.app/adva-administracion/issue/ADV-8)

**Problem:** Lock expiry check is not atomic with state updates - race between checking expiry and acquiring lock.

1. Write test in `src/utils/concurrency.test.ts`:
   - Test that two concurrent operations cannot both acquire an expired lock
   - Test lock holder validation during release
   - Test atomic compare-and-set for lock acquisition
2. Run verifier (expect fail)
3. Implement fix in `src/utils/concurrency.ts`:
   - Make expiry check and acquisition atomic using single state update
   - Add lock holder ID validation before release
   - Use atomic compare-and-swap pattern for lock state transitions
4. Run verifier (expect pass)

#### Task 11: Fix scanner state machine race condition
**Linear Issue:** [ADV-15](https://linear.app/adva-administracion/issue/ADV-15)

**Problem:** Check-and-set pattern in scanner state machine vulnerable to interleaving between check and lock acquisition.

1. Write test in `src/processing/scanner.test.ts`:
   - Test concurrent scan requests don't both enter running state
   - Test pending state correctly defers second request
   - Simulate interleaving at await boundaries
2. Run verifier (expect fail)
3. Implement fix in `src/processing/scanner.ts`:
   - Move state check inside the lock acquisition
   - Or use atomic state transition that includes check
   - Ensure no await between state check and state set
4. Run verifier (expect pass)

#### Task 12: Add lock timeout to markFileProcessing
**Linear Issue:** [ADV-22](https://linear.app/adva-administracion/issue/ADV-22)

**Problem:** `markFileProcessing()` doesn't specify lock timeout, potentially causing infinite waits.

1. Write test in `src/processing/storage/index.test.ts`:
   - Test markFileProcessing times out after expected duration
   - Test updateFileStatus doesn't wait indefinitely if markFileProcessing lock held
   - Test lock acquisition with timeout parameter
2. Run verifier (expect fail)
3. Implement fix in `src/processing/storage/index.ts`:
   - Add 10-second timeout to withLock call in markFileProcessing (consistent with other operations)
   - Add explicit timeout parameter documentation
4. Run verifier (expect pass)

#### Task 13: Fix startup scan silent failure
**Linear Issue:** [ADV-26](https://linear.app/adva-administracion/issue/ADV-26)

**Problem:** `performStartupScan()` never throws - server continues even if scan fails completely.

1. Write test in `src/server.test.ts` (create if needed):
   - Test startup fails if initial scan encounters critical error
   - Test server still starts if scan completes but finds no files
   - Test error is properly propagated during startup
2. Run verifier (expect fail)
3. Implement fix in `src/server.ts`:
   - Make performStartupScan return Result<void, Error>
   - Add critical error detection (auth failures, missing folder)
   - Throw/exit on critical errors, log and continue on transient errors
4. Run verifier (expect pass)

---

### Group 4: Service Layer & Error Handling (4 issues)

Focus: Shutdown handling, data loss prevention, and security.

#### Task 14: Fix shutdown handlers not awaited
**Linear Issue:** [ADV-7](https://linear.app/adva-administracion/issue/ADV-7)

**Problem:** SIGTERM/SIGINT handlers call async `shutdown()` without awaiting, causing unclean shutdown.

1. Write test in `src/server.test.ts`:
   - Test shutdown sequence awaits watch manager cleanup
   - Test server.close() completes before process exit
   - Test pending operations are allowed to finish
2. Run verifier (expect fail)
3. Implement fix in `src/server.ts`:
   - Create shutdown promise that signal handlers wait on
   - Use proper async/await or .then() chain for cleanup
   - Add timeout to prevent infinite hanging (30s max shutdown time)
   - Set exit code after shutdown completes
4. Run verifier (expect pass)

#### Task 15: Fix data loss in pagos-pendientes after sheet clear
**Linear Issue:** [ADV-13](https://linear.app/adva-administracion/issue/ADV-13)

**Problem:** Sheet cleared before new data written - if setValues() fails, data is lost.

1. Write test in `src/services/pagos-pendientes.test.ts`:
   - Test that original data is recoverable if setValues fails
   - Test atomic update pattern (write new data, then clear old)
   - Mock setValues failure and verify data preserved
2. Run verifier (expect fail)
3. Implement fix in `src/services/pagos-pendientes.ts`:
   - Write new data first (to a temporary range or backup sheet)
   - Clear old data only after new data successfully written
   - Or use batch update that's atomic at API level
4. Run verifier (expect pass)

#### Task 16: Fix timing leak in auth middleware
**Linear Issue:** [ADV-6](https://linear.app/adva-administracion/issue/ADV-6)

**Problem:** `constantTimeCompare` leaks timing information through buffer padding differences.

1. Write test in `src/middleware/auth.test.ts`:
   - Test comparison works correctly for matching tokens
   - Test comparison works correctly for non-matching tokens
   - Test both strings padded to same length before comparison
2. Run verifier (expect fail)
3. Implement fix in `src/middleware/auth.ts`:
   - Hash both strings first (e.g., SHA-256) to normalize length
   - Then compare hashes with timingSafeEqual
   - Alternative: Pad shorter string with deterministic bytes to max length
4. Run verifier (expect pass)

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix all 9 High-priority and 7 related Medium-priority bugs in the ADVA Administracion codebase, grouped by code proximity and fix approach similarity.

**Linear Issues:** ADV-6, ADV-7, ADV-8, ADV-9, ADV-10, ADV-11, ADV-12, ADV-13, ADV-14, ADV-15, ADV-17, ADV-19, ADV-20, ADV-21, ADV-22, ADV-26

**Approach:**
- Group issues by functional area to minimize context switching and leverage shared patterns
- All groups have 4+ issues for efficient implementation
- TDD workflow: test first, verify failure, implement, verify success
- High-priority issues distributed across groups for balanced priority handling

**Scope:**
- Tasks: 16
- Files affected: ~15 source files + ~10 test files
- New tests: Yes (all tasks require test-first)

**Key Decisions:**
- Group 1 focuses on validation/extraction - shared patterns in parser.ts and validation.ts
- Group 2 focuses on date/timezone - UTC consistency across the codebase
- Group 3 focuses on concurrency - atomic operations and lock management
- Group 4 focuses on service resilience - shutdown, data safety, security
- Each group can be implemented independently (no cross-group dependencies)

**Dependencies/Prerequisites:**
- Tasks within each group are independent and can be parallelized
- Groups can be implemented in any order
- No external dependencies required
