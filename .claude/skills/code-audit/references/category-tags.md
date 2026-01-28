# Category Tags Reference

## Audit Tags (validated during code audit)

| Tag | Description |
|-----|-------------|
| `[security]` | Injection, exposed secrets, missing auth |
| `[memory-leak]` | Unbounded growth, unclosed resources, retained refs |
| `[bug]` | Logic errors, data corruption |
| `[resource-leak]` | Connections, file handles, timers not cleaned up |
| `[async]` | Unhandled promises, missing error propagation |
| `[timeout]` | Missing timeouts, potential hangs |
| `[shutdown]` | Graceful shutdown issues |
| `[edge-case]` | Unhandled scenarios |
| `[convention]` | CLAUDE.md violations |
| `[type]` | Unsafe casts, missing guards |
| `[dependency]` | Vulnerable or outdated packages |
| `[rate-limit]` | API quota exhaustion risks |
| `[dead-code]` | Unused functions, unreachable code |
| `[duplicate]` | Repeated logic |
| `[test]` | Useless/duplicate tests |
| `[practice]` | Anti-patterns |

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
