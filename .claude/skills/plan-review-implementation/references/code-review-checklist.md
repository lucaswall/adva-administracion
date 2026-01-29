# Comprehensive Code Review Checklist

Reference for plan-review-implementation skill.

## Priority Tiers

| Tier | Severity | Examples |
|------|----------|----------|
| **CRITICAL** | Immediate fix required | Security vulnerabilities, data corruption, crashes |
| **HIGH** | Fix before merge | Logic errors, race conditions, auth issues |
| **MEDIUM** | Should fix | Edge cases, type safety, error handling gaps |
| **LOW** | Nice to have | Code style, documentation, minor improvements |

## Security Checks (OWASP-Based)

### Input Validation
- [ ] All user inputs validated server-side (never trust client)
- [ ] Allowlist validation preferred over blocklist
- [ ] SQL injection prevention (parameterized queries, ORM)
- [ ] NoSQL injection prevention (sanitize operators like `$gt`, `$ne`)
- [ ] Command injection prevention (avoid shell execution with user input)
- [ ] Path traversal prevention (`../` sequences blocked)
- [ ] XSS prevention (context-appropriate encoding: HTML, JS, CSS, URL)
- [ ] File upload validation (content type, size, extension)
- [ ] Input length limits enforced
- [ ] Special characters handled appropriately

### Authentication & Session
- [ ] Strong password hashing (bcrypt, argon2, scrypt)
- [ ] Salt unique per password
- [ ] Account lockout after failed attempts
- [ ] Session tokens cryptographically random (>=128 bits)
- [ ] Session invalidation on logout
- [ ] Session timeout for inactivity
- [ ] Re-authentication for sensitive operations
- [ ] Cookie flags set (HttpOnly, Secure, SameSite)
- [ ] JWT validation complete (signature, expiry, issuer, audience)
- [ ] Refresh tokens rotated on use

### Authorization
- [ ] Access controls enforced server-side
- [ ] Default deny policy
- [ ] IDOR prevention (validate user owns resource)
- [ ] Horizontal privilege escalation blocked (user A accessing user B data)
- [ ] Vertical privilege escalation blocked (user becoming admin)
- [ ] Admin functions protected
- [ ] Centralized authorization logic (not scattered)
- [ ] API endpoints match expected access level

### Secrets & Credentials
- [ ] No hardcoded secrets, API keys, passwords
- [ ] Secrets loaded from env vars or secret manager
- [ ] No secrets in git history
- [ ] Sensitive data not logged
- [ ] Debug/verbose modes don't expose secrets
- [ ] Error messages don't leak internal info

### Cryptography
- [ ] Modern algorithms (AES-256, RSA-2048+, SHA-256+)
- [ ] Proper key management (generation, storage, rotation)
- [ ] Certificate validation enabled (no skip-verify)
- [ ] HTTPS for all external calls
- [ ] Encryption at rest for sensitive data
- [ ] Cryptographically secure random (not Math.random)

## Logic & Correctness

### Common Bug Patterns
- [ ] Off-by-one errors in loops/indices
- [ ] Null/undefined handling (especially from external data)
- [ ] Empty array/object edge cases
- [ ] Integer overflow/underflow
- [ ] Floating point comparison issues
- [ ] String encoding issues (UTF-8)
- [ ] Timezone handling in dates
- [ ] Boolean logic errors (De Morgan's law violations)
- [ ] Negation confusion (!=, !==, not)
- [ ] Assignment vs comparison (= vs ==)

### Boundary Conditions
- [ ] Empty inputs handled
- [ ] Single-element collections
- [ ] Maximum size inputs
- [ ] Negative numbers where unexpected
- [ ] Zero values
- [ ] Unicode edge cases (emojis, RTL, combining chars)
- [ ] Very long strings
- [ ] Deeply nested objects

### State Management
- [ ] Race conditions in shared state
- [ ] State mutations in wrong order
- [ ] Missing state cleanup
- [ ] Stale state references (closures)
- [ ] Concurrent modification issues

## Async & Concurrency

### Promise/Async Handling
- [ ] All promises have error handlers (.catch or try/catch)
- [ ] Async functions called with await or .then/.catch
- [ ] Promise.all failures handled appropriately
- [ ] No fire-and-forget async (unless intentional)
- [ ] Errors propagated correctly up the chain

### Race Conditions
- [ ] Shared mutable state protected
- [ ] Check-then-act patterns atomicized
- [ ] Concurrent writes to same resource
- [ ] Event ordering assumptions valid
- [ ] Initialization races avoided

### Deadlocks & Hangs
- [ ] External API calls have timeouts
- [ ] Database queries have timeouts
- [ ] Circuit breakers for unreliable services
- [ ] No await in infinite loops without yield
- [ ] Mutex/lock acquisition has timeout

## Resource Management

### Memory Leaks
- [ ] Event listeners removed when done (.off, removeListener)
- [ ] Intervals cleared (clearInterval)
- [ ] Timeouts managed appropriately
- [ ] Caches have eviction/size limits
- [ ] Streams destroyed on error/completion
- [ ] Large objects not held unnecessarily in closures
- [ ] Collections don't grow unbounded

### Resource Leaks
- [ ] Database connections returned to pool
- [ ] File handles closed (finally blocks)
- [ ] HTTP connections closed on error
- [ ] External subscriptions cancelled
- [ ] Temporary files cleaned up

### Graceful Shutdown
- [ ] SIGTERM/SIGINT handlers registered
- [ ] In-flight requests completed before exit
- [ ] Background jobs stopped gracefully
- [ ] Database connections closed
- [ ] File handles released
- [ ] Timers cleared
- [ ] External watches cancelled

## Error Handling

### Error Propagation
- [ ] Errors not swallowed silently
- [ ] Empty catch blocks justified
- [ ] Errors logged with context
- [ ] Original error preserved when wrapping
- [ ] Appropriate error types used

### Error Recovery
- [ ] Retry logic for transient failures
- [ ] Backoff strategies prevent thundering herd
- [ ] Circuit breakers prevent cascade failures
- [ ] Fallback behavior for non-critical features
- [ ] Partial failures handled gracefully

### Error Information
- [ ] Error messages are actionable
- [ ] No sensitive data in error messages
- [ ] Stack traces not exposed to users
- [ ] Errors logged for debugging
- [ ] Correlation IDs for request tracing

## Type Safety

### TypeScript/Type Checks
- [ ] No unsafe `any` casts
- [ ] Type guards for narrowing
- [ ] Nullable types handled (null, undefined)
- [ ] Union types exhaustively matched
- [ ] Generic constraints appropriate
- [ ] External data validated/parsed (zod, io-ts)
- [ ] Type assertions justified and correct

### Runtime Validation
- [ ] API inputs validated
- [ ] External responses validated
- [ ] Config values validated at startup
- [ ] Type mismatches detected early

## Test Quality (When Tests Are Changed)

### Test Validity
- [ ] Tests have meaningful assertions
- [ ] Not just "doesn't throw" tests
- [ ] Assertions match test description
- [ ] Mocks don't hide real bugs
- [ ] Edge cases covered
- [ ] Error paths tested
- [ ] No always-passing tests

### Test Independence
- [ ] Tests don't depend on execution order
- [ ] Shared state cleaned up
- [ ] No flaky timing dependencies
- [ ] External dependencies mocked appropriately

### Test Data
- [ ] No real customer/user data
- [ ] No production credentials
- [ ] Test data clearly fictional
- [ ] Sensitive patterns avoided

## Project-Specific (CLAUDE.md)

Always check CLAUDE.md for project-specific rules including:
- Import conventions (ESM .js extensions)
- Logging requirements (Pino vs console.log)
- Error handling patterns (Result<T,E>)
- Testing requirements (TDD workflow)
- Naming conventions
- Security requirements (auth middleware)
- Any other project-specific standards

## AI-Generated Code Risks

When reviewing AI-generated or AI-assisted code, pay extra attention to:
- **Logic errors** (75% more common in AI code)
- **XSS vulnerabilities** (2.74x higher frequency)
- **Code duplication** (frequent AI pattern)
- **Security flaws** (~45% of AI code contains them)
- **Missing context** (AI may not understand business logic)
- **Hallucinated APIs** (non-existent methods/libraries)
