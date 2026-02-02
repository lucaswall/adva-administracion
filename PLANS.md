# Implementation Plan

**Created:** 2026-02-02
**Source:** Linear Backlog - All Bug Issues
**Linear Issues:** [ADV-18](https://linear.app/adva-administracion/issue/ADV-18), [ADV-23](https://linear.app/adva-administracion/issue/ADV-23), [ADV-24](https://linear.app/adva-administracion/issue/ADV-24), [ADV-25](https://linear.app/adva-administracion/issue/ADV-25), [ADV-27](https://linear.app/adva-administracion/issue/ADV-27), [ADV-28](https://linear.app/adva-administracion/issue/ADV-28), [ADV-29](https://linear.app/adva-administracion/issue/ADV-29), [ADV-33](https://linear.app/adva-administracion/issue/ADV-33), [ADV-34](https://linear.app/adva-administracion/issue/ADV-34), [ADV-35](https://linear.app/adva-administracion/issue/ADV-35), [ADV-36](https://linear.app/adva-administracion/issue/ADV-36), [ADV-37](https://linear.app/adva-administracion/issue/ADV-37)

## Context Gathered

### Codebase Analysis

**Files with Bugs:**
- `src/utils/correlation.ts` - AsyncLocalStorage context mutation (ADV-37)
- `src/bank/autofill.ts` - Array bounds checking (ADV-36)
- `src/gemini/parser.ts` - Numeric range validation (ADV-35)
- `src/bank/match-movimientos.ts` - Confidence level comparison (ADV-34)
- `src/utils/concurrency.ts` - Hash collision in computeVersion (ADV-33)
- `src/utils/date.ts` - Year range validation (ADV-29)
- `src/utils/file-naming.ts` - Date substring safety (ADV-28)
- `src/utils/numbers.ts` - Accounting notation parsing (ADV-27)
- `src/services/drive.ts` - Rate limit retry (ADV-25)
- `src/gemini/client.ts` - Rate limit queue race (ADV-24)
- `src/utils/exchange-rate.ts` - API response type safety (ADV-23)
- `src/services/watch-manager.ts` - Infinite retry loop (ADV-18)

**Existing Test Files:**
- `src/utils/correlation.test.ts` - Context isolation tests
- `src/bank/autofill.test.ts` - Bank autofill tests
- `src/gemini/parser.test.ts` - Parser validation tests
- `src/bank/match-movimientos.test.ts` - Match quality tests
- `src/utils/concurrency.test.ts` - Retry and lock tests
- `src/utils/date.test.ts` - Date parsing tests
- `src/utils/file-naming.test.ts` - File naming tests
- `src/utils/numbers.test.ts` - Number parsing tests
- `src/services/drive.test.ts` - Drive API tests
- `src/gemini/client.test.ts` - Gemini client tests
- `src/utils/exchange-rate.test.ts` - Exchange rate tests
- `src/services/watch-manager.test.ts` - Watch manager tests

**Existing Patterns:**
- `Result<T,E>` pattern for error-prone operations
- `isQuotaError()` + `withQuotaRetry()` for rate limit handling
- `getRequiredColumnIndex()` for safe header lookup in match-movimientos.ts
- Vitest with describe/it/expect for testing
- `createHash('md5')` for reliable hashing in match-movimientos.ts

---

## Original Plan

### Task 1: Fix accounting notation parsing in numbers.ts
**Linear Issue:** [ADV-27](https://linear.app/adva-administracion/issue/ADV-27)

**Problem:** Parsing `($1,234.56)` fails - parentheses not stripped correctly when combined with currency symbol.

1. Write test in `src/utils/numbers.test.ts`:
   - Test `parseNumber('($1,234.56)')` returns `-1234.56`
   - Test `parseNumber('(1,234.56)')` returns `-1234.56` (existing case)
   - Test `parseNumber('(-$1,234.56)')` edge case
2. Run verifier with pattern `numbers` (expect fail)
3. Fix in `src/utils/numbers.ts` lines 78-84:
   - Move currency symbol removal before parentheses detection
   - Or update regex to handle currency inside parens: `/^\(?\$?-?|[-$()]/g`
4. Run verifier with pattern `numbers` (expect pass)

### Task 2: Fix date substring safety in file-naming.ts
**Linear Issue:** [ADV-28](https://linear.app/adva-administracion/issue/ADV-28)

**Problem:** `substring(0, 7)` assumes date is at least 7 chars. Malformed dates produce wrong output.

1. Write test in `src/utils/file-naming.test.ts`:
   - Test `generateReciboFileName()` with short fechaPago like `"2024"` returns safe fallback
   - Test `generateResumenFileName()` with empty fechaHasta handles gracefully
   - Test `generateResumenTarjetaFileName()` with undefined-like input
   - Test `generateResumenBrokerFileName()` with malformed date
2. Run verifier with pattern `file-naming` (expect fail)
3. Fix in `src/utils/file-naming.ts`:
   - Add helper function `extractPeriodo(dateStr: string): string` that validates format before substring
   - Use `isValidISODate()` from date.ts as guard, return `'unknown'` for invalid
   - Apply to lines 165, 190, 212, 234
4. Run verifier with pattern `file-naming` (expect pass)

### Task 3: Fix year range validation in date.ts
**Linear Issue:** [ADV-29](https://linear.app/adva-administracion/issue/ADV-29)

**Problem:** `isValidISODate` rejects dates older than 10 years (2016 and earlier). Argentina allows 10+ year old invoices.

1. Write test in `src/utils/date.test.ts`:
   - Test `isValidISODate('2015-01-15')` returns true (currently fails)
   - Test `isValidISODate('2010-06-30')` returns true
   - Test `isValidISODate('1999-12-31')` returns false (too old)
   - Test `isValidISODate('2030-01-01')` returns false (too far future)
2. Run verifier with pattern `date` (expect fail)
3. Fix in `src/utils/date.ts` line 27:
   - Change from `currentYear - 10` to `currentYear - 15` (allows 15 years back)
   - Or make configurable via parameter with default
4. Run verifier with pattern `date` (expect pass)

### Task 4: Fix hash collision in computeVersion
**Linear Issue:** [ADV-33](https://linear.app/adva-administracion/issue/ADV-33)

**Problem:** DJB2 32-bit hash has collision risk. Should use MD5 like `computeRowVersion()`.

1. Write test in `src/utils/concurrency.test.ts`:
   - Test `computeVersion()` produces consistent 16-char hex output
   - Test different inputs produce different hashes (collision resistance)
   - Test large objects hash correctly
   - Test BigInt and circular references still handled
2. Run verifier with pattern `concurrency` (expect fail for format change)
3. Fix in `src/utils/concurrency.ts` lines 369-399:
   - Import `createHash` from crypto
   - Replace DJB2 with: `createHash('md5').update(str).digest('hex').slice(0, 16)`
   - Keep existing BigInt/circular reference handling for stringify
4. Run verifier with pattern `concurrency` (expect pass)

### Task 5: Fix isBetterMatch to consider confidence levels
**Linear Issue:** [ADV-34](https://linear.app/adva-administracion/issue/ADV-34)

**Problem:** `isBetterMatch()` doesn't compare confidence levels. HIGH confidence match can be replaced by LOW.

1. Write test in `src/bank/match-movimientos.test.ts`:
   - Test HIGH confidence match beats MEDIUM with same metrics
   - Test MEDIUM confidence match beats LOW with same metrics
   - Test confidence comparison happens before date distance
2. Run verifier with pattern `match-movimientos` (expect fail)
3. Fix in `src/bank/match-movimientos.ts`:
   - Add `confidence: MatchConfidence` to `MatchQuality` interface
   - Add confidence comparison at the start of `isBetterMatch()` (before CUIT check)
   - Map: HIGH > MEDIUM > LOW numerically
4. Run verifier with pattern `match-movimientos` (expect pass)

### Task 6: Add numeric range validation to movimientos parser
**Linear Issue:** [ADV-35](https://linear.app/adva-administracion/issue/ADV-35)

**Problem:** Movimientos validation doesn't check numeric ranges - negative saldo or NaN could be accepted.

1. Write test in `src/gemini/parser.test.ts`:
   - Test `validateMovimientosBancario` rejects negative saldo with warning
   - Test `validateMovimientosTarjeta` rejects NaN precio
   - Test `validateMovimientosBroker` rejects extremely large values (> 1e15)
   - Test valid movimientos still pass
2. Run verifier with pattern `parser` (expect fail)
3. Fix in `src/gemini/parser.ts` lines 789-904:
   - Add range validation: `if (mov.saldo < 0 || !Number.isFinite(mov.saldo)) { warn(...); hasIssues = true; }`
   - Add maximum value check: `if (Math.abs(mov.debito) > 1e15) { warn(...) }`
   - Apply to all three validation functions
4. Run verifier with pattern `parser` (expect pass)

### Task 7: Add array bounds checking to autofill.ts
**Linear Issue:** [ADV-36](https://linear.app/adva-administracion/issue/ADV-36)

**Problem:** `parseMovementRow` accesses row[6], row[7], row[8] without verifying row.length >= 9.

1. Write test in `src/bank/autofill.test.ts`:
   - Test `parseMovementRow` with short array (length < 9) returns null
   - Test `parseMovementRow` with exactly 9 elements works
   - Test edge case: empty row returns null
2. Run verifier with pattern `autofill` (expect fail)
3. Fix in `src/bank/autofill.ts` line 27:
   - Add bounds check: `if (row.length < 9) return null;`
   - Or use optional chaining: `row[6] ?? null`, `row[7] ?? null`, etc.
4. Run verifier with pattern `autofill` (expect pass)

### Task 8: Fix context mutation thread-safety in correlation.ts
**Linear Issue:** [ADV-37](https://linear.app/adva-administracion/issue/ADV-37)

**Problem:** `updateCorrelationContext` mutates stored object directly. Concurrent updates can race.

1. Write test in `src/utils/correlation.test.ts`:
   - Test concurrent `updateCorrelationContext` calls with different fileIds preserve both updates
   - Test that original context is not mutated (immutability check)
   - Simulate race condition with interleaved async operations
2. Run verifier with pattern `correlation` (expect fail)
3. Fix in `src/utils/correlation.ts` lines 98-104:
   - Option A: Create new context object on each update using spread operator
   - Option B: Use `correlationStorage.run()` with new context object to replace existing
   - Preferred: Return new object reference to caller
4. Run verifier with pattern `correlation` (expect pass)

### Task 9: Fix exchange rate API response type vulnerability
**Linear Issue:** [ADV-23](https://linear.app/adva-administracion/issue/ADV-23)

**Problem:** Type assertion `as { compra?: number; ... }` applied before validation. Array response crashes.

1. Write test in `src/utils/exchange-rate.test.ts`:
   - Test API returning array `[]` returns error result
   - Test API returning `null` returns error result
   - Test API returning `{ unexpected: 'structure' }` returns error result
   - Test valid response still works
2. Run verifier with pattern `exchange-rate` (expect fail)
3. Fix in `src/utils/exchange-rate.ts` line 158:
   - Move type assertion after object validation
   - Add check: `if (Array.isArray(data))` before object validation
   - Pattern: `const rawData = await response.json(); if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return error;`
4. Run verifier with pattern `exchange-rate` (expect pass)

### Task 10: Fix Gemini client rate limit queue race condition
**Linear Issue:** [ADV-24](https://linear.app/adva-administracion/issue/ADV-24)

**Problem:** Resolver initialized as no-op, reassigned in Promise. Exception between can block queue forever.

1. Write test in `src/gemini/client.test.ts`:
   - Test concurrent rate limit enforcement doesn't deadlock
   - Test queue continues processing after one request fails
   - Test rapid sequential requests are all processed
2. Run verifier with pattern `client` (expect fail)
3. Fix in `src/gemini/client.ts` lines 503-541:
   - Use Promise.withResolvers() pattern (Node 22+) or create resolver atomically
   - Alternative: Use deferred promise pattern with immediate assignment
   - Wrap entire queue operation in try/finally to ensure resolver is always called
4. Run verifier with pattern `client` (expect pass)

### Task 11: Add rate limit retry to Drive API calls
**Linear Issue:** [ADV-25](https://linear.app/adva-administracion/issue/ADV-25)

**Problem:** Drive API methods don't detect 429 errors or retry with backoff.

1. Write test in `src/services/drive.test.ts`:
   - Test `listFilesInFolder` retries on 429 response
   - Test `moveFile` retries on rate limit error
   - Test retry succeeds after transient 429
   - Test max retries exhausted returns error
2. Run verifier with pattern `drive` (expect fail)
3. Fix in `src/services/drive.ts`:
   - Import `isQuotaError` and `withQuotaRetry` from `utils/concurrency.js`
   - Wrap API calls in `withQuotaRetry()`: `return withQuotaRetry(() => drive.files.list(...))`
   - Apply to: `listFilesInFolder`, `findByName`, `getFile`, `moveFile`, `renameFile`, `getFileMetadata`
4. Run verifier with pattern `drive` (expect pass)

### Task 12: Fix infinite retry loop in watch-manager
**Linear Issue:** [ADV-18](https://linear.app/adva-administracion/issue/ADV-18)

**Problem:** Scan failure triggers retry in finally block. Permanent errors cause infinite loop.

1. Write test in `src/services/watch-manager.test.ts`:
   - Test scan failure doesn't trigger immediate retry
   - Test after N consecutive failures, scanning is paused
   - Test successful scan resets failure counter
   - Test auth failures stop retries immediately
2. Run verifier with pattern `watch-manager` (expect fail)
3. Fix in `src/services/watch-manager.ts` lines 398-423:
   - Add failure counter: `let consecutiveFailures = 0;`
   - In catch block: `consecutiveFailures++;`
   - In success block: `consecutiveFailures = 0;`
   - In finally: only trigger next scan if `consecutiveFailures < MAX_CONSECUTIVE_FAILURES`
   - Detect permanent errors (auth failure) and skip all retries
4. Run verifier with pattern `watch-manager` (expect pass)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix 12 bugs across utilities, services, and API clients to improve robustness, prevent data corruption, and eliminate edge case failures.

**Linear Issues:** ADV-18, ADV-23, ADV-24, ADV-25, ADV-27, ADV-28, ADV-29, ADV-33, ADV-34, ADV-35, ADV-36, ADV-37

**Approach:**
- Group related fixes by domain (utils, services, bank, gemini)
- Apply defensive coding patterns: bounds checking, type validation, retry with backoff
- Use existing patterns from codebase (Result<T,E>, isQuotaError, MD5 hashing)
- Follow TDD: write failing test first, then implement fix

**Scope:**
- Tasks: 12
- Files affected: 12 source files + 12 test files
- New tests: yes (new test cases for each bug)

**Key Decisions:**
- Extend year range to 15 years (vs configurable) for simplicity
- Use MD5 for hashing (matches existing computeRowVersion pattern)
- Add failure counter to watch-manager (vs circuit breaker) for simplicity
- Rate limit retry uses existing withQuotaRetry infrastructure

**Dependencies/Prerequisites:**
- Tasks are independent and can be implemented in any order
- Each task is self-contained with its own test + implementation cycle
