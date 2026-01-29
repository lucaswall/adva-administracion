# Category Tags Reference

## Audit Tags (validated during code audit)

| Tag | Description | OWASP |
|-----|-------------|-------|
| `[security]` | Injection, exposed secrets, missing auth | A01-A03, A07 |
| `[memory-leak]` | Unbounded growth, unclosed resources, retained refs | - |
| `[bug]` | Logic errors, data corruption, off-by-one | - |
| `[resource-leak]` | Connections, file handles, timers not cleaned up | - |
| `[async]` | Unhandled promises, race conditions, missing error propagation | - |
| `[timeout]` | Missing timeouts, potential hangs, no circuit breaker | - |
| `[shutdown]` | Graceful shutdown issues | - |
| `[edge-case]` | Unhandled scenarios, boundary conditions | - |
| `[convention]` | CLAUDE.md violations | - |
| `[type]` | Unsafe casts, missing guards, unvalidated external data | - |
| `[dependency]` | Vulnerable or outdated packages | A06 |
| `[rate-limit]` | API quota exhaustion risks | - |
| `[dead-code]` | Unused functions, unreachable code | - |
| `[duplicate]` | Repeated logic | - |
| `[test]` | Useless/duplicate tests, no assertions | - |
| `[practice]` | Anti-patterns | - |

**OWASP Top 10 (2021) Reference:**
- A01: Broken Access Control (auth bypass, IDOR, privilege escalation)
- A02: Cryptographic Failures (secrets exposure, weak crypto)
- A03: Injection (SQL, NoSQL, command, XSS)
- A06: Vulnerable Components (outdated dependencies)
- A07: Authentication Failures (weak sessions, missing auth)

## Non-Audit Tags (preserved without validation)

| Tag | Description |
|-----|-------------|
| `[feature]` | New functionality to add |
| `[improvement]` | Enhancement to existing functionality |
| `[enhancement]` | Similar to improvement |
| `[refactor]` | Code restructuring without behavior change |
| `[docs]` | Documentation updates |
| `[chore]` | Maintenance tasks |

Non-audit items are preserved at the top of TODO.md in their original order.
