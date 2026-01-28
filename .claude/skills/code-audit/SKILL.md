---
name: code-audit
description: Audit codebase for bugs, security issues, memory leaks, resource leaks, async errors, and CLAUDE.md violations. Use when user says "audit", "find bugs", "check security", "review codebase", "find memory leaks", or "find dead code". Discovers project structure dynamically from tsconfig/package.json. Writes prioritized findings to TODO.md with impact×likelihood assessment. Analysis only - does not fix issues.
argument-hint: [optional: specific area like "services" or "tests"]
allowed-tools: Read, Edit, Write, Glob, Grep, Task, Bash
disable-model-invocation: true
---

Perform a comprehensive code audit and write findings to TODO.md.

## Pre-flight

1. **Read CLAUDE.md** - Load project-specific rules to audit against (if exists)
2. **Read TODO.md** - Preserve existing items (will be renumbered, if exists)
3. **Read project config** - `tsconfig.json`, `package.json`, `.gitignore` for structure discovery

## Audit Process

Copy this checklist and track progress:

```
Audit Progress:
- [ ] Step 1: Discover project structure (tsconfig, package.json, gitignore)
- [ ] Step 2: Explore discovered areas systematically
- [ ] Step 3: Check CLAUDE.md compliance (if exists)
- [ ] Step 4: Check dependency vulnerabilities (npm audit / cargo audit / etc.)
- [ ] Step 5: Categorize and prioritize findings
- [ ] Step 6: Write TODO.md with priority ordering
```

### Step 1: Discover Project Structure

Do NOT hardcode paths. Dynamically discover the project structure:

1. **Read configuration files** (in parallel):
   - `tsconfig.json` - check `include`/`exclude` for source patterns
   - `package.json` - check `main`, `types`, `scripts` for entry points
   - `.gitignore` - identify directories to skip (node_modules, dist, build, etc.)

2. **Identify source directories** using discovered patterns:
   - Use Glob with patterns from tsconfig.json `include` (e.g., `src/**/*.ts`)
   - If no tsconfig, use common conventions: `src/`, `lib/`, `app/`, `packages/`
   - Group discovered files by top-level directory

3. **Map the codebase structure**:
   - Use Task tool with `subagent_type=Explore` to understand architecture
   - Identify: entry points, routes/controllers, services, utilities, tests
   - If `$ARGUMENTS` specifies a focus area, prioritize that

**For each discovered area, look for:**
- Logic errors, null handling, race conditions
- Security vulnerabilities (injection, missing auth, exposed secrets)
- Unhandled edge cases and boundary conditions
- Dead or duplicate code
- Test quality issues (no assertions, always-pass, duplicates)
- Memory leaks (unbounded collections, event listeners, unclosed streams)
- Resource leaks (connections, file handles, timers not cleared)
- Async issues (unhandled promises, missing try/catch in async functions)
- Timeout/hang scenarios (API calls without timeouts, blocking operations)
- Graceful shutdown issues (connections not drained, cleanup not performed)

### Step 2: Systematic Exploration

Use Task tool with `subagent_type=Explore` to examine each discovered area thoroughly.

### Step 3: CLAUDE.md Compliance

If CLAUDE.md exists, check project-specific rules. See [references/compliance-checklist.md](references/compliance-checklist.md) for common checks.

### Step 4: Dependency Vulnerabilities

Run the appropriate audit command based on project type:
- **Node.js**: `npm audit` or `yarn audit`
- **Rust**: `cargo audit`
- **Python**: `pip-audit` or `safety check`
- **Go**: `govulncheck`

Include any critical/high vulnerabilities in findings.

### Step 5: Categorize and Prioritize Findings

**Category tags:**

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

**Assess priority independently for each issue:**

Priority is NOT determined by tag alone. Evaluate each issue on two dimensions:

| | High Likelihood | Medium Likelihood | Low Likelihood |
|---|---|---|---|
| **High Impact** | Critical | Critical | High |
| **Medium Impact** | High | Medium | Medium |
| **Low Impact** | Medium | Low | Low |

**Impact factors:**
- Data loss or corruption → High
- Security breach potential → High
- Service outage/crash → High
- User-facing errors → Medium
- Performance degradation → Medium
- Developer inconvenience → Low
- Code maintainability → Low

**Likelihood factors:**
- Happens on every request → High
- Happens under normal load → High
- Happens on specific inputs → Medium
- Happens only under edge conditions → Low
- Requires attacker/malicious input → Varies (High if exposed, Low if internal)

**Examples:**
- `[security]` missing auth on public endpoint → Critical (high impact + high likelihood)
- `[security]` missing auth on admin-only internal endpoint → Medium (high impact + low likelihood)
- `[memory-leak]` on every request → Critical
- `[memory-leak]` only on error path → High or Medium
- `[bug]` wrong date format in logs → Low (low impact)
- `[bug]` wrong amount in financial calculation → Critical (high impact)

**For each issue, document:**
- File path and approximate location
- Clear problem description
- Category tag
- Priority level (critical/high/medium/low)

**Do NOT document solutions.** Identify problems only.

### Step 6: Write TODO.md

Format with numbered items ordered by priority (critical → high → medium → low):

```markdown
# Code Audit Findings

## item #1 [security] [critical]
Description of the security issue.

## item #2 [memory-leak] [high]
Description of the memory leak.

## item #3 [convention] [medium]
Description of the CLAUDE.md violation.

## item #4 [dead-code] [low]
Description of the dead code.
```

**Rules:**
- Each item: `## item #N [tag] [priority]`
- Priority: `[critical]`, `[high]`, `[medium]`, or `[low]`
- Content: Simple paragraph explaining the problem
- NO solutions
- Order: All critical items first, then high, then medium, then low
- Existing items are renumbered but preserved in relative order within their priority tier
- New items inserted at appropriate priority positions

## Error Handling

| Situation | Action |
|-----------|--------|
| No tsconfig.json or package.json | Use common conventions: `src/`, `lib/`, `app/`, find `*.ts`/`*.js` files |
| npm audit fails | Note in findings that dependency check was skipped, continue with code audit |
| CLAUDE.md doesn't exist | Skip project-specific compliance checks, use only universal checklist |
| TODO.md doesn't exist | Create new TODO.md with findings |
| Explore agent times out | Continue with direct Glob/Grep searches for remaining areas |
| Large codebase (>1000 files) | Focus on `$ARGUMENTS` area if provided, or prioritize entry points and public APIs |

## Rules

- **Analysis only** - Do NOT modify source code
- **No solutions** - Document problems, not fixes
- **Be thorough** - Check every file in scope
- **Be specific** - Include file paths
- **No time wasting** - Don't analyze how to fix

## Termination

Output this message and STOP:

```
✓ Code audit complete. Findings written to TODO.md.

Found N issues:
- X critical/high priority
- Y medium priority
- Z low priority

Next step: Review TODO.md and use `plan-todo` to create implementation plans.
```

Do not ask follow-up questions. Do not offer to fix issues.
