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

---

## Iteration 1

**Implemented:** 2026-01-29

### Completed

- **Task 1: Add 'LP' to validateTipoComprobante validation**
  - Added test in `src/utils/validation.test.ts` for 'LP' validation
  - Confirmed test fails (red phase)
  - Added 'LP' to validTypes array in `src/utils/validation.ts:345`
  - Confirmed test passes (green phase)
  - Updated JSDoc comment in `src/types/index.ts:94` to include LP

- **Task 2: Add fetch timeout with AbortController**
  - Added FETCH_TIMEOUT_MS constant to `src/config.ts` (30000ms)
  - Added import for FETCH_TIMEOUT_MS in `src/gemini/client.ts`
  - Added 3 tests in `src/gemini/client.test.ts` for timeout behavior:
    - Test fetch aborts after timeout
    - Test fetch completes successfully before timeout
    - Test distinguishes timeout error from network error
  - Confirmed tests fail (red phase)
  - Implemented AbortController in `analyzeDocument()` method:
    - Created AbortController before fetch
    - Set timeout using setTimeout to call controller.abort()
    - Passed signal to fetch options
    - Clear timeout on success
    - Handle AbortError in catch block with specific "timeout" message
  - Confirmed tests pass (green phase)

- **Task 3: Fix rate limiter race condition with atomic increment**
  - Added 3 tests in `src/gemini/client.test.ts` for concurrent rate limiting:
    - Test multiple concurrent calls don't exceed rate limit
    - Test concurrent calls at limit all wait properly
    - Test correct number of requests made within time window
  - Confirmed tests fail (red phase)
  - Implemented promise queue for serialized rate limiting in `src/gemini/client.ts`:
    - Added `rateLimitQueue: Promise<void>` property
    - Updated `enforceRateLimit()` to use queue pattern for atomic operations
    - Changed from check-then-increment to always-increment approach
    - Moved increment inside the locked section to prevent race conditions
  - Removed duplicate `requestCount++` from success path
  - Confirmed tests pass (green phase)

### Checklist Results

- **bug-hunter**: Found 2 bugs, fixed both:
  - HIGH: Request not counted when window resets - Fixed by restructuring if/else to always increment
  - LOW: Missing 'LP' in JSDoc comment - Fixed by updating comment to include LP
- **test-runner**: Passed (1048 tests, 53 files)
- **builder**: Passed (zero warnings)

### Notes

- All three critical audit findings have been resolved
- TipoComprobante 'LP' is now fully validated across the codebase
- Fetch timeout prevents hanging requests to Gemini API
- Rate limiter race condition fixed with promise queue serialization pattern
- All tests passing with full coverage of edge cases
- No warnings in build output

### Review Findings

Files reviewed: 6
- `src/utils/validation.ts` (lines 342-347)
- `src/utils/validation.test.ts` (lines 565-567)
- `src/config.ts` (lines 38-42)
- `src/gemini/client.ts` (full file)
- `src/gemini/client.test.ts` (full file)
- `src/types/index.ts` (line 94)

Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Timeout, Conventions

No issues found - all implementations are correct and follow project conventions.

**Verification details:**
- Task 1: 'LP' correctly added to validTypes array and tested
- Task 2: AbortController properly manages timeout; clearTimeout called in both success and error paths (no resource leak); timeout errors correctly distinguished from network errors
- Task 3: Promise queue pattern correctly serializes rate limit checks; increment happens atomically within locked section; finally block ensures queue always progresses

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
