# Implementation Plan

**Created:** 2026-01-29
**Source:** TODO.md items #1-3 [critical]

## Context Gathered

### Codebase Analysis

**Item #1 - TipoComprobante 'LP' not validated:**
- **File:** `src/types/index.ts:71` defines `TipoComprobante = 'A' | 'B' | 'C' | 'E' | 'NC' | 'ND' | 'LP'`
- **File:** `src/utils/validation.ts:345` defines `validTypes = ['A', 'B', 'C', 'E', 'NC', 'ND']` (missing 'LP')
- **Existing tests:** `src/utils/validation.test.ts:540-592` has tests for `validateTipoComprobante` but no test for 'LP'
- **Fix pattern:** Add 'LP' to validTypes array in validateTipoComprobante()

**Item #2 - Missing fetch timeout abort signal:**
- **File:** `src/gemini/client.ts:217-224` - fetch() call has no AbortController
- **Issue:** Pipeline timeout (60s) at src/processing/extractor.ts checks elapsed time but doesn't abort hanging fetch
- **Existing tests:** `src/gemini/client.test.ts` - tests retry logic and errors but not timeout abort
- **Fix pattern:** Add AbortController with signal to fetch(), abort on timeout

**Item #3 - Rate limiter race condition:**
- **File:** `src/gemini/client.ts:430-450` - enforceRateLimit() has check-then-increment pattern
- **Issue:** Concurrent requests can pass limit check before any increment occurs
- **Existing tests:** `src/gemini/client.test.ts:368-411` - has rate limiting tests but not concurrent race
- **Fix pattern:** Use atomic increment or lock pattern to serialize limit checks

### Test Conventions

- Tests use Vitest (`describe`, `it`, `expect`, `vi`)
- Tests colocated with source as `*.test.ts`
- Mock `global.fetch` for API tests
- Use `vi.useFakeTimers()` for timing-sensitive tests
- Use `vi.fn()` for mock functions

## Original Plan

### Task 1: Add 'LP' to validateTipoComprobante validation

Addresses item #1: TipoComprobante type includes 'LP' but validation rejects it.

1. Write test in `src/utils/validation.test.ts` for 'LP' validation
   - Test `validateTipoComprobante('LP')` returns 'LP'
   - Follow existing test pattern from lines 541-592
2. Run test-runner (expect fail)
3. Update `validateTipoComprobante()` in `src/utils/validation.ts:345`
   - Add 'LP' to validTypes array: `['A', 'B', 'C', 'E', 'NC', 'ND', 'LP']`
4. Run test-runner (expect pass)

### Task 2: Add fetch timeout with AbortController

Addresses item #2: Missing fetch timeout abort signal at src/gemini/client.ts:217-224.

1. Write tests in `src/gemini/client.test.ts` for fetch timeout
   - Test that fetch is aborted after timeout (using vi.useFakeTimers)
   - Test that aborted fetch returns appropriate error
   - Test that successful fetch within timeout works normally
   - Test error message indicates timeout vs network error
2. Run test-runner (expect fail)
3. Update `analyzeDocument()` in `src/gemini/client.ts`
   - Create AbortController before fetch
   - Set timeout using setTimeout to call controller.abort()
   - Pass signal to fetch options: `signal: controller.signal`
   - Clear timeout on success
   - Handle AbortError in catch block with specific message
   - Use FETCH_TIMEOUT_MS constant (e.g., 30000ms for 30s timeout)
4. Run test-runner (expect pass)
5. Add FETCH_TIMEOUT_MS to `src/config.ts` if not exists

### Task 3: Fix rate limiter race condition with atomic increment

Addresses item #3: Race condition in rate limiter with concurrent requests.

1. Write tests in `src/gemini/client.test.ts` for concurrent rate limiting
   - Test multiple concurrent calls don't exceed rate limit
   - Test that concurrent calls at limit all wait properly
   - Use Promise.all to simulate concurrent requests
   - Verify correct number of requests made within time window
2. Run test-runner (expect fail)
3. Update `enforceRateLimit()` in `src/gemini/client.ts`
   - Change from check-then-increment to pre-increment approach
   - Increment requestCount BEFORE checking limit (optimistic increment)
   - If over limit after increment, decrement and wait, then retry
   - Or use a serialized queue for limit enforcement
   - Option B: Add a Promise-based mutex/lock for rate limiting
4. Run test-runner (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings
