# Implementation Plan

**Created:** 2026-01-27
**Source:** TODO.md items #1-4 [security]

## Context Gathered

### Codebase Analysis
- **Webhook endpoint:** `src/routes/webhooks.ts` - public endpoint receiving Google Drive notifications
- **Watch manager:** `src/services/watch-manager.ts` - manages active channels with `channelId` and `resourceId`
- **Config:** `src/config.ts:92-96` - API_SECRET validation allows empty in non-production
- **Auth middleware:** `src/middleware/auth.ts` - constant-time comparison for token validation
- **Store files:** `src/processing/storage/factura-store.ts` and siblings - user data written to spreadsheets
- **Concurrency utils:** `src/utils/concurrency.ts` - has locking and rate limiting infrastructure
- **Test patterns:** Vitest with vi.mock, colocated `*.test.ts` files, Result<T,E> assertions

### Existing Patterns
- `withLock` and `withRetry` in `src/utils/concurrency.ts` for rate limiting
- `constantTimeCompare` in `src/middleware/auth.ts` for secure comparison
- Google Sheets formula escaping in `src/utils/spreadsheet.ts:21` (only escapes quotes in display text)
- No existing `webhooks.test.ts` file - tests need to be created

## Original Plan

### Task 1: Add resourceId validation to webhook endpoint

Addresses item #1: Missing resourceId validation allows forged notifications with arbitrary resourceId.

1. Write test in `src/routes/webhooks.test.ts` for resourceId validation
   - Test rejects notification when resourceId is missing
   - Test rejects notification when resourceId doesn't match channel's resourceId
   - Test accepts notification when channelId and resourceId both match
   - Follow existing Fastify route testing patterns
2. Run test-runner (expect fail)
3. Update webhook handler in `src/routes/webhooks.ts:50-79`
   - After finding channel by channelId, verify resourceId matches `channel.resourceId`
   - Return 200 with `{ status: 'ignored', reason: 'resource_mismatch' }` on mismatch
   - Log warning with both expected and received resourceId
4. Run test-runner (expect pass)

### Task 2: Add rate limiting to webhook endpoint

Addresses item #2: Public endpoint lacks rate limiting, enabling DoS via notification flooding.

1. Write test in `src/routes/webhooks.test.ts` for rate limiting
   - Test allows requests under rate limit
   - Test rejects requests over rate limit with 429 status
   - Test rate limit resets after window expires
   - Test rate limiting is per-channelId (not global)
2. Run test-runner (expect fail)
3. Create rate limiter utility in `src/utils/rate-limiter.ts`
   - Implement sliding window rate limiter
   - Export `createRateLimiter(windowMs, maxRequests)` factory
   - Export `RateLimiter` interface with `check(key): { allowed: boolean, remaining: number, resetMs: number }`
   - Use Result<T,E> pattern for operations
4. Write test in `src/utils/rate-limiter.test.ts` for rate limiter utility
   - Test window boundary behavior
   - Test cleanup of expired entries
5. Run test-runner (expect fail for new tests)
6. Implement rate limiter in `src/utils/rate-limiter.ts`
7. Run test-runner (expect pass for rate-limiter tests)
8. Integrate rate limiter in `src/routes/webhooks.ts`
   - Add rate limiter with configurable limits (default: 60 requests/minute per channelId)
   - Return 429 with `{ error: 'Too Many Requests', retryAfter: resetMs }` when exceeded
   - Add `Retry-After` header
9. Run test-runner (expect all pass)

### Task 3: Require API_SECRET in all environments

Addresses item #3: Empty API_SECRET allowed in development/test, risking accidental exposure if deployed with wrong NODE_ENV.

1. Write test in `src/config.test.ts` for API_SECRET enforcement
   - Test throws when API_SECRET is empty in production
   - Test throws when API_SECRET is empty in development
   - Test throws when API_SECRET is empty in test
   - Test accepts non-empty API_SECRET in all environments
2. Run test-runner (expect fail)
3. Update `src/config.ts:92-96` to require API_SECRET in all environments
   - Remove the `nodeEnv === 'production'` condition
   - Throw `Error('API_SECRET is required')` if empty regardless of environment
4. Update test environment setup to provide API_SECRET
   - Check `vitest.config.ts` or test setup files for env configuration
   - Ensure `API_SECRET` is set in test environment
5. Run test-runner (expect pass)
6. Verify existing tests still pass (may need API_SECRET in test env)

### Task 4: Add spreadsheet formula injection sanitization

Addresses item #4: User-controlled data written to spreadsheets without sanitization could inject formulas.

1. Write test in `src/utils/spreadsheet.test.ts` for sanitization function
   - Test sanitizes strings starting with `=` (formulas)
   - Test sanitizes strings starting with `+` (formulas)
   - Test sanitizes strings starting with `-` (formulas)
   - Test sanitizes strings starting with `@` (formulas)
   - Test sanitizes strings starting with tab/newline followed by formula chars
   - Test preserves normal strings
   - Test handles empty strings and null/undefined
2. Run test-runner (expect fail)
3. Implement `sanitizeForSpreadsheet(value: string): string` in `src/utils/spreadsheet.ts`
   - Prefix dangerous strings with single quote (`'`) to prevent formula interpretation
   - Handle leading whitespace + formula characters
   - Document OWASP CSV injection prevention guidelines in JSDoc
4. Run test-runner (expect pass for new tests)
5. Update `appendRowsWithLinks` in `src/services/sheets.ts` to sanitize string values
   - Apply `sanitizeForSpreadsheet` to all string cell values before writing
   - Skip sanitization for CellLink (intentional formulas) and CellDate types
   - Add tests for the integration
6. Run test-runner (expect all pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Iteration 1

**Implemented:** 2026-01-27

### Completed

- **Task 1: Add resourceId validation to webhook endpoint**
  - Created `src/routes/webhooks.test.ts` with tests for resourceId validation
  - Implemented resourceId validation in `src/routes/webhooks.ts:85-92`
  - Webhook now rejects notifications when resourceId is missing or doesn't match channel.resourceId
  - Returns 200 with `{ status: 'ignored', reason: 'resource_mismatch' }` on mismatch

- **Task 2: Add rate limiting to webhook endpoint**
  - Created `src/utils/rate-limiter.ts` with sliding window rate limiter
  - Created `src/utils/rate-limiter.test.ts` with 7 tests covering rate limiter behavior
  - Integrated rate limiter into `src/routes/webhooks.ts` (60 requests/minute per channelId)
  - Returns 429 with `Retry-After` header when rate limit exceeded
  - Rate limiting is per-channelId, not global
  - Added tests in `src/routes/webhooks.test.ts` for rate limiting integration

- **Task 3: Require API_SECRET in all environments**
  - Updated `src/config.ts:92-95` to require API_SECRET in all environments (removed production-only check)
  - Created `src/config.test.ts` with 6 tests verifying API_SECRET enforcement
  - Updated `vitest.config.ts` to provide test environment variables (API_SECRET, GOOGLE_SERVICE_ACCOUNT_KEY, GEMINI_API_KEY, DRIVE_ROOT_FOLDER_ID)
  - All environments now throw `Error('API_SECRET is required')` if API_SECRET is empty

- **Task 4: Add spreadsheet formula injection sanitization**
  - Implemented `sanitizeForSpreadsheet()` in `src/utils/spreadsheet.ts`
  - Created `src/utils/spreadsheet.test.ts` with 12 tests covering formula injection prevention
  - Integrated sanitization into `src/services/sheets.ts:924` (convertToSheetsCellData function)
  - Sanitizes strings starting with `=`, `+`, `-`, `@` or leading whitespace + formula chars
  - Prefixes dangerous strings with single quote `'` to prevent formula execution
  - Added 4 integration tests in `src/services/sheets.test.ts` for sanitization in appendRowsWithLinks
  - CellLink and CellDate types are not sanitized (intentional formulas and numbers respectively)

### Checklist Results

- **bug-hunter:** Found 4 bugs, all fixed
  1. Removed module-level `API_SECRET` export that caused initialization issues
  2. Fixed rate limiter memory leak by ensuring map cleanup
  3. Added missing `vi` import in `src/config.test.ts`
  4. Moved rate limit check after channel/resource validation to prevent DoS attacks on legitimate channels
- **test-runner:** Passed - All 462 tests passing across 29 test files
- **builder:** Passed - Zero warnings or errors

### Notes

- Rate limiter uses sliding window algorithm for accurate request counting
- Rate limit is enforced AFTER channel and resourceId validation to prevent attackers from exhausting rate limits of legitimate channels with forged requests
- Formula injection sanitization follows OWASP recommendations for CSV injection prevention
- Sanitization is applied to all string cell values except CellLink (intentional formulas) and CellDate (numeric values)
- API_SECRET requirement in all environments prevents accidental deployment with wrong NODE_ENV
- All security items from TODO.md items #1-4 [security] have been successfully implemented and tested

### Review Findings
None - all implementations are correct and follow project conventions.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
