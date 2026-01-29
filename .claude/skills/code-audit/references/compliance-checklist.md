# Code Audit Compliance Checklist

Universal checks that apply to any project. Project-specific rules should be defined in CLAUDE.md.

## Security (OWASP-Based)

### Authorization (OWASP A01:2021)
- Public endpoints are intentional and documented
- Auth middleware applied to protected routes
- Role/permission checks where needed
- IDOR prevention (validate user owns resource)
- Horizontal/vertical privilege escalation blocked

### Secrets & Credentials (OWASP A02:2021)
- No hardcoded secrets, API keys, or passwords in code
- Secrets loaded from environment variables or secret managers
- No secrets in git history (check for accidental commits)
- Sensitive data not logged (passwords, tokens, PII)
- Debug/verbose modes don't expose secrets
- Error messages don't leak internal paths or stack traces

### Input Validation (OWASP A03:2021)
- User input sanitized before use
- SQL/NoSQL injection prevention (parameterized queries, ORM)
- Command injection prevention (avoid shell execution with user input)
- Path traversal prevention (`../` sequences blocked)
- XSS prevention (context-appropriate encoding: HTML, JS, CSS, URL)
- File upload validation (content type, size, extension)

### Authentication (OWASP A07:2021)
- Strong password hashing (bcrypt, argon2, scrypt with salt)
- Session tokens cryptographically random (>=128 bits)
- Session invalidation on logout
- Re-authentication for sensitive operations
- JWT validation complete (signature, expiry, issuer)

### HTTPS & Transport
- External API calls use HTTPS
- Certificate validation not disabled

## Type Safety

### Unsafe Casts
- No unsafe `any` casts without justification
- Type assertions (`as Type`) verified correct
- Generic constraints appropriate

### Type Guards
- Union types have exhaustive handling
- Nullable types explicitly handled (null, undefined)
- External data validated before use (API responses, file parsing)

### Runtime Validation
- API inputs validated (zod, io-ts, or manual)
- Config values validated at startup
- Type mismatches detected early (fail fast)

## Logic & Correctness

### Common Bug Patterns
- Off-by-one errors in loops/indices
- Empty array/object edge cases not handled
- Integer overflow/underflow (rare in JS but possible)
- Floating point comparison issues (use epsilon)
- Assignment vs comparison (= vs ==)

### Boundary Conditions
- Empty inputs handled (null, undefined, "", [], {})
- Single-element collections work correctly
- Maximum size inputs don't break logic
- Negative numbers where only positive expected
- Zero values handled appropriately
- Unicode edge cases (emojis, RTL, combining chars)

### State Management
- Race conditions in shared state
- State mutations in wrong order
- Missing state cleanup after operations
- Stale state references in closures

## Memory Leaks

### Unbounded Collections
- Arrays/Maps/Sets that grow without bounds
- Caches without eviction policy or size limits
- Queues that accumulate faster than they drain

### Event Listeners
- `.on()` without corresponding `.off()` or `.removeListener()`
- Event emitters in loops creating multiple listeners
- Missing `once()` for one-time events

### Streams and Handles
- Streams not `.destroy()`ed on error
- File handles not closed in finally blocks
- Response streams not properly ended

### Timers
- `setInterval()` without `clearInterval()`
- `setTimeout()` in loops without cleanup
- Timers not cleared on component/service shutdown

### Closures
- Closures capturing large objects unnecessarily
- Callbacks holding references to parent scopes

## Resource Leaks

### Connections
- Database connections not returned to pool
- HTTP connections not closed on error paths
- Connection pools not properly configured

### File Handles
- Files opened without corresponding close
- Streams created but not consumed or destroyed

## Async Error Handling

### Unhandled Promises
- Promises without `.catch()`
- `async` functions called without `await` or `.catch()`
- Promise chains missing error handlers

### Missing Try/Catch
- `async` functions without try/catch around await calls
- Errors not propagated to caller

### Error Swallowing
- Empty catch blocks
- Catch blocks that log but don't rethrow or handle appropriately

## Timeout and Hang Scenarios

### External API Calls
- HTTP requests without timeout option
- Third-party API calls that could hang indefinitely
- No circuit breaker for unreliable dependencies

### Blocking Operations
- Synchronous file/network operations in async code
- CPU-intensive loops without yielding
- Database queries without timeout

### Queue Processing
- Workers that could stall on bad items
- No dead letter queue for failed items
- Missing circuit breaker for downstream failures

## Graceful Shutdown

### Server Shutdown
- SIGTERM/SIGINT handlers registered
- New requests rejected during shutdown
- Existing requests allowed to complete (drain)

### Background Jobs
- Queue processing stopped gracefully
- In-flight work completed or checkpointed
- Scheduled tasks cancelled

### Resource Cleanup
- Database connections closed
- File handles released
- Timers cleared
- External subscriptions/watches cancelled

## Dependency Vulnerabilities

### Package Audits
- Run language-specific audit tool:
  - Node.js: `npm audit` / `yarn audit`
  - Python: `pip-audit` / `safety check`
  - Rust: `cargo audit`
  - Go: `govulncheck`
  - Ruby: `bundle audit`
- Check for critical/high severity issues

### Supply Chain
- Dependencies from trusted sources
- No typosquatting package names
- Lock files committed and up to date

## Rate Limiting

### External API Quotas
- Rate limit handling for third-party APIs
- Backoff/retry logic for 429 responses
- Quota monitoring and alerting

### Internal Rate Limiting
- Prevent self-DDoS on downstream services
- Queue depth limits
- Concurrent request limits

## Test Quality (if tests exist)

### Test Coverage
- Critical paths have test coverage
- Edge cases tested
- Error paths tested

### Test Validity
- Tests have meaningful assertions (not just "doesn't throw")
- No tests that always pass
- No duplicate tests
- Mocks don't hide real bugs

### Test Data
- No real customer/user data in tests
- No production credentials in test files
- Test data clearly fictional

## Search Patterns

Use Grep tool (not bash grep) to find potential issues. Replace `{src}` with discovered source directory:

**Security:**
- `password|secret|api.?key|token` (case insensitive) - potential hardcoded secrets
- `eval\(|new Function\(` - dangerous code execution
- `exec\(|spawn\(` with variable input - command injection risk

**Type Safety:**
- `as any` - unsafe type cast
- `as unknown as` - double cast (often hiding type issues)
- `@ts-ignore|@ts-expect-error` - suppressed type errors

**Memory/Resource:**
- `\.on\(` - event listeners (check for cleanup)
- `setInterval` - timers (check for clearInterval)
- `setTimeout` in loops - potential accumulation
- `new Map\(|new Set\(|\[\]` at module level - potential unbounded growth

**Async:**
- `\.then\(` without `.catch` nearby - unhandled promise
- `async ` functions - verify try/catch coverage
- `Promise\.all` - verify error handling

**Logging:**
- `console\.log|console\.warn|console\.error` - should use proper logger
