# Code Audit Compliance Checklist

Detailed checks for code audit reviewers. Read CLAUDE.md for project-specific rules and accepted patterns.

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
- User/API input sanitized before use
- SQL/NoSQL injection prevention (parameterized queries, ORM) - if using databases
- Command injection prevention (avoid shell execution with user input)
- Path traversal prevention (`../` sequences blocked)
- SSRF prevention — server-side requests use allowlisted URLs/domains, no user-controlled URLs passed directly to fetch/HTTP clients
- External API response validation (don't trust third-party data)
- File path/name validation when processing external files

### Authentication (OWASP A07:2021)
- Bearer/API tokens validated on every request
- Token secrets loaded from environment (not hardcoded)
- Auth middleware applied consistently to protected routes
- Service account credentials properly scoped
- JWT validation complete (signature, expiry, issuer) - if using JWTs
- Constant-time comparison for sensitive values (tokens, API keys, session IDs) — use `crypto.timingSafeEqual()` or equivalent, not `===`

### HTTPS & Transport
- External API calls use HTTPS
- Certificate validation not disabled

### Security Headers
- Content-Security-Policy (CSP) configured — prevents XSS and data injection
- X-Content-Type-Options: nosniff — prevents MIME sniffing
- X-Frame-Options or CSP frame-ancestors — prevents clickjacking
- Strict-Transport-Security (HSTS) — enforces HTTPS
- Referrer-Policy — limits referrer information leakage
- Permissions-Policy — restricts browser features (camera, geolocation, etc.)

## Type Safety

### Unsafe Casts
- No unsafe `any` casts without justification
- Type assertions (`as Type`) verified correct
- Generic constraints appropriate

### Type Guards
- Union types have exhaustive handling
- Nullable types explicitly handled (null, undefined)
- External data validated before use (API responses, Gemini outputs, Google Drive files, spreadsheet parsing)
- Parsed data matches expected schema (dates, numbers, enums)

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
- Third-party API calls that could hang indefinitely (Gemini, Railway, Google Drive)
- No circuit breaker for unreliable dependencies
- Missing retry logic for transient failures (network errors, 5xx)

### Blocking Operations
- Synchronous file/network operations in async code
- CPU-intensive loops without yielding
- Database queries without timeout

## Graceful Shutdown

### Server Shutdown
- SIGTERM/SIGINT handlers registered
- New requests rejected during shutdown
- Existing requests allowed to complete (drain)

### Resource Cleanup
- API connections closed
- File handles released
- Timers cleared
- Pending API requests aborted

## Dependency Vulnerabilities

### Package Audits
- Run `npm audit`
- Check for critical/high severity issues

### Supply Chain
- Dependencies from trusted sources
- No typosquatting package names
- **Hallucinated packages** — verify all imports resolve to real packages (AI frequently invents non-existent package names that may be claimed by attackers)
- Lock files committed and up to date
- Dependencies pinned to specific versions or known-safe ranges

## Logging

### Log Level Correctness

Verify each log statement uses the appropriate level:

| Level | Correct Usage | Anti-patterns |
|-------|---------------|---------------|
| **FATAL** | Critical failures preventing app from continuing (missing required config, DB unavailable at startup, security breaches) | Using for recoverable errors |
| **ERROR** | Operations that fail but app continues (API failures after retries exhausted, resource creation failures, unexpected exceptions) | Logging expected exceptions, errors with auto-recovery |
| **WARN** | Unexpected but recoverable conditions (resource thresholds approaching limits, deprecated config, excessive failed logins, slow API responses) | Normal operational events |
| **INFO** | Significant business events (state changes, successful completions, service startup/shutdown, milestones) | Excessive details, sensitive data |
| **DEBUG** | Implementation details for troubleshooting (DB queries, API calls/responses, config values, timing) | Enabled in production continuously |

### Log Coverage

Ensure sufficient logging for operational visibility:

- **Error paths**: All catch blocks log the error with context (operation, inputs, stack trace)
- **API boundaries**: Incoming requests and outgoing responses logged at INFO or DEBUG
- **State transitions**: Key business state changes logged at INFO
- **External calls**: Third-party API calls (Gemini, Railway, Google Drive) logged at DEBUG with timing
- **Authentication events**: Login success/failure, token refresh, session creation logged at INFO
- **Startup/shutdown**: Service initialization and graceful shutdown logged at INFO
- **Scheduled jobs**: Job start, completion, and failures logged at INFO

### Debug Coverage for Investigation

Verify DEBUG logs exist for troubleshooting all potential errors:

- **Every external API call**: Request parameters, response status, timing
- **Database operations**: Queries, parameters (sanitized), row counts
- **Business logic decisions**: Key conditional branches, computed values
- **Data transformations**: Input/output shapes, validation results
- **Configuration**: Loaded config values at startup (not secrets)
- **Queue/async operations**: Job enqueue, dequeue, processing steps

### Log Overflow Prevention

Check for patterns that could saturate the logging backend:

- **No logging in tight loops**: Avoid `logger.debug()` inside `for`/`while` processing many items
- **Batch logging for bulk operations**: Log summary (e.g., "Processed 1000 items") not individual items
- **No redundant logs**: Same information not logged multiple times per request
- **Conditional verbose logging**: High-volume debug logs should be behind feature flags or log level checks
- **Request/response body limits**: Large payloads truncated or summarized, not logged in full
- **Error log deduplication**: Repeated identical errors sampled or aggregated (e.g., "Error X occurred 50 times in last minute")
- **No stack traces at INFO/WARN**: Stack traces only at ERROR/DEBUG
- **Streaming/SSE logs**: Don't log every chunk/event in streaming operations

### Structured Logging

- **JSON format**: Logs should be structured (JSON) not plain text for machine parsing
- **Consistent fields**: Request ID, user ID, operation name included consistently
- **Proper logger used**: No `console.log`/`console.error` in production code - use Pino logger
- **Action field on every log**: Every log statement should use `{ action: "operation_name" }` structured format, not string-only messages — enables log search/filtering
- **No mixed formats**: Don't mix `logger.info("string only")` with `logger.info({ action }, "msg")` in the same module

### Request-Scoped Logging

- **Child loggers per request**: Route handlers should create child loggers with request context (method, path, request ID) rather than using the global logger directly
- **Correlation IDs**: Requests should carry an ID that propagates through all downstream log calls so logs from one request can be traced together
- **Context propagation**: When a route handler calls lib modules, request context (user ID, request ID) should flow into the logs without each module needing to manually attach it

### Double-Logging Prevention

- **No duplicate log events**: The same error/event should not be logged at multiple layers (e.g., lib module logs error AND route handler logs the same error again)
- **Error response auto-logging**: If a centralized error response helper auto-logs, callers should not also log the same error — or the helper should not auto-log
- **Catch-and-rethrow**: If a catch block logs an error and then rethrows, the upstream catcher should not log it again

### Operation Timing

- **External API call duration**: All calls to external APIs (Gemini, Railway, Google Drive) should log `durationMs` so slow calls are visible in logs
- **Database query timing**: Long-running or critical DB operations should include timing at DEBUG level
- **End-to-end request duration**: Route handlers should log total request duration for performance monitoring

### Info vs Debug Level Strategy

- **Routine reads are DEBUG, not INFO**: Successful GET requests returning cached or standard data should be DEBUG — INFO is for state changes and significant events
- **State changes are INFO**: Creating, updating, or deleting records; auth flows; significant domain operations
- **Only log at INFO what operators need to see**: If the log would be noise in production at steady state, it should be DEBUG

### Log Security

- **No sensitive data**: Passwords, tokens, API keys, session secrets never logged
- **No PII without consent**: Email, phone, address not logged or properly redacted
- **No request bodies with secrets**: Auth headers, cookie values not logged
- **Error messages sanitized**: Stack traces don't expose internal paths in production
- **Image/binary data**: Never log raw binary data or base64-encoded images

### Search Patterns for Logging Issues

Use Grep tool to find potential logging issues:

**Wrong level usage:**
- `logger\.info.*error|logger\.info.*fail|logger\.info.*exception` - errors logged at INFO
- `logger\.debug.*critical|logger\.debug.*fatal` - critical issues at DEBUG
- `logger\.error` in catch blocks for expected/recoverable errors

**Missing logs:**
- `catch\s*\([^)]*\)\s*\{[^}]*\}` - empty or log-less catch blocks
- API route handlers without any logger calls
- Lib modules with zero `logger` imports (data layer blind spots)

**Structural issues:**
- `logger\.(info|warn|error)\("[^"]+"\)` without object first arg - missing structured `{ action }` format
- Same error string appearing in both a lib module and its calling route handler - double logging
- Error response helpers preceded by `logger.error` or `logger.warn` in same function - double logging with auto-log helper
- Route handlers or lib modules using global `logger` directly instead of child/request-scoped logger

**Timing gaps:**
- External API calls (`fetch\(`, Gemini/Railway calls) without `durationMs` in their completion log
- `Date\.now\(\)` or `performance\.now\(\)` captured but never logged

**Log overflow risks:**
- `for.*\{[^}]*logger\.|while.*\{[^}]*logger\.` - logging inside loops
- `\.map\([^)]*logger\.|\.forEach\([^)]*logger\.` - logging in array iterations
- `logger\.(debug|info).*JSON\.stringify` - potentially large objects logged

**Security issues:**
- `logger\..*(password|secret|token|key|auth)` - potential secrets in logs
- `logger\..*req\.body|logger\..*request\.body` - request bodies might contain secrets
- `logger\..*headers` - headers might contain auth tokens

## Rate Limiting

### External API Quotas
- Rate limit handling for third-party APIs (Gemini, Railway, Google Drive)
- Backoff/retry logic for 429 responses
- Quota monitoring
- Token/request budgeting for AI APIs

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

Use Grep tool (not bash grep) to find potential issues:

**Security:**
- `password|secret|api.?key|token` (case insensitive) - potential hardcoded secrets
- `eval\(|new Function\(` - dangerous code execution
- `exec\(|spawn\(` with variable input - command injection risk
- `fetch\(.*\$|fetch\(.*\+|fetch\(.*\`|axios.*\$|axios.*\+` - potential SSRF (user-controlled URLs in server-side fetch)

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
- `console\.log|console\.warn|console\.error` - should use Pino logger

## AI-Generated Code Risks

All code in this project is AI-assisted. Apply extra scrutiny for patterns AI models commonly introduce:

### Common AI Code Vulnerabilities
- **XSS vulnerabilities** (2.74x higher frequency in AI code) — check all dynamic content rendering
- **Logic errors** (75% more common) — verify branching, loop bounds, comparisons
- **Missing input validation** — AI often skips server-side validation
- **Hardcoded secrets** — AI trains on public repos full of exposed credentials
- **Code duplication** — AI frequently generates similar code instead of reusing existing abstractions
- **~45% of AI code contains security flaws** — treat all AI output as untrusted until reviewed

### AI-Specific Anti-patterns
- **Hallucinated APIs** — methods, functions, or library features that don't exist. Verify imports resolve to real exports.
- **Hallucinated packages** — non-existent npm packages that may be claimed by attackers (supply chain risk). Verify every `import` references a real, trusted package.
- **Outdated patterns** — AI may use deprecated APIs or old security practices from training data
- **Over-engineering** — unnecessary abstractions, extra error handling for impossible scenarios
- **Missing business context** — AI may not understand domain constraints (CUIT validation rules, AFIP specifications, spreadsheet formats), leading to incorrect logic

### Search Patterns for AI Code Issues
- Check `import.*from` for packages that don't exist in `package.json`
- Check `require\(` for the same
- Look for API method calls that don't match the library's actual interface
- Look for copied patterns (similar code blocks in multiple files that should be shared)
