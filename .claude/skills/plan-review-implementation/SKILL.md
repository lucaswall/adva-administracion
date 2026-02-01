---
name: plan-review-implementation
description: QA review of completed implementation. Use after plan-implement finishes, or when user says "review the implementation". Identifies bugs, edge cases, security issues (OWASP-based), type safety, resource leaks, and async issues. Creates fix plans for issues found or marks COMPLETE.
allowed-tools: Read, Edit, Glob, Grep
disable-model-invocation: true
---

Review **ALL** implementation iterations that need review, then mark complete or create fix plans.

**Reference:** See [references/code-review-checklist.md](references/code-review-checklist.md) for comprehensive checklist.

## Pre-flight Check

1. **Read PLANS.md** - Understand the full plan and iteration history
2. **Read CLAUDE.md** - Understand project standards and conventions
3. **Assess AI-generated code risk** - If implementation is large or shows AI patterns, apply extra scrutiny

## Identify What to Review

**Detection logic:**

1. Search PLANS.md for `## Iteration N` sections
2. **If iterations exist:** Build list of iterations needing review:
   - Has "Completed" or "### Completed" subsection
   - Does NOT contain `<!-- REVIEW COMPLETE -->` marker
   - Process in order (Iteration 1 first, then 2, etc.)
3. **If NO iterations exist:** Treat entire plan as single iteration:
   - Look for "Completed" or "### Completed" section at plan level
   - Check if plan already has `<!-- REVIEW COMPLETE -->` marker
   - If completed but not reviewed → review as "Iteration 1"

**Iteration detection:** A plan has iterations if it contains `## Iteration` (with or without number).

If no iteration/plan needs review → Inform user and stop.

**Important:** Review ALL pending iterations in a single session, not just one.

## Review Process

**For EACH iteration needing review (in order):**

### Step 1: Identify Implemented Code

From the iteration's "Completed" section, list all files that were:
- Created
- Modified
- Added tests to

### Step 2: Thorough Code Review

Read each implemented file and apply checks from [references/code-review-checklist.md](references/code-review-checklist.md).

**Core Categories:**

| Category | What to Look For |
|----------|------------------|
| **SECURITY** | Input validation (SQL/XSS/command injection), auth bypass, IDOR, secrets exposure, missing auth middleware |
| **BUG** | Logic errors, off-by-one, null handling, race conditions, boundary conditions |
| **EDGE CASE** | Empty inputs, zero values, unicode, max sizes, deeply nested objects |
| **ASYNC** | Unhandled promises, missing .catch, fire-and-forget, race conditions in shared state |
| **RESOURCE** | Memory leaks (listeners, intervals, caches), resource leaks (connections, handles), missing cleanup |
| **TYPE** | Unsafe casts, unvalidated external data, missing type guards, exhaustive checks |
| **ERROR** | Missing error handling, swallowed exceptions, no error propagation |
| **TIMEOUT** | External calls without timeout, potential hangs, missing circuit breakers |
| **CONVENTION** | CLAUDE.md violations (imports, logging, patterns, TDD workflow) |

**AI-Generated Code Risks (apply extra scrutiny):**
- Logic errors (75% more common)
- XSS vulnerabilities (2.74x higher)
- Code duplication
- Hallucinated APIs (non-existent methods)
- Missing business context

### Step 3: Evaluate Severity

Use the Priority Tiers from code-review-checklist.md:

| Severity | Criteria | Action |
|----------|----------|--------|
| **CRITICAL** | Security vulnerabilities, data corruption, crashes | Must fix before merge |
| **HIGH** | Logic errors, race conditions, auth issues, resource leaks | Must fix before merge |
| **MEDIUM** | Edge cases, type safety, error handling gaps | Should fix |
| **LOW** | Convention violations, style (only if egregious) | Document only |

**Fix Required (CRITICAL/HIGH):**
- Would cause runtime errors or crashes
- Could corrupt or lose data
- Security vulnerability (OWASP categories)
- Resource leak affecting production
- Test doesn't actually test the behavior
- Violates CLAUDE.md critical rules

**Document Only (MEDIUM/LOW):**
- Edge cases that are unlikely to occur
- Style preferences not in CLAUDE.md
- "Nice to have" improvements
- Future enhancements

## Document Findings

### If Issues Found (CRITICAL/HIGH)

Add to the current Iteration section:

```markdown
### Review Findings

Summary: N issue(s) found
- CRITICAL: X
- HIGH: Y
- MEDIUM: Z (documented only)

**Issues requiring fix:**
- [CRITICAL] SECURITY: SQL injection in query builder (`src/db.ts:45`) - OWASP A03:2021
- [HIGH] BUG: Race condition in cache invalidation (`src/cache.ts:120`)
- [HIGH] ASYNC: Unhandled promise rejection (`src/api.ts:78`)

**Documented (no fix needed):**
- [MEDIUM] EDGE CASE: Unicode filenames not tested (`src/upload.ts:30`)

### Fix Plan

#### Fix 1: SQL injection in query builder
1. Write test in `src/db.test.ts` for malicious input escaping
2. Use parameterized query in `src/db.ts:45`

#### Fix 2: Race condition in cache invalidation
1. Write test in `src/cache.test.ts` for concurrent invalidation
2. Add mutex/lock in `src/cache.ts:120`

#### Fix 3: Unhandled promise rejection
1. Write test in `src/api.test.ts` for error handling
2. Add try/catch in `src/api.ts:78`

<!-- REVIEW COMPLETE -->
```

**Note:** The `<!-- REVIEW COMPLETE -->` marker is added even when issues are found, because the review itself is complete. The Fix Plan will create a new iteration when implemented.

### If No Issues Found

Add to the current Iteration section:

```markdown
### Review Findings

Files reviewed: N
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

<!-- REVIEW COMPLETE -->
```

**Then continue to the next iteration needing review.**

### After ALL Iterations Reviewed

When all pending iterations have been reviewed:

- **If any iteration has a Fix Plan** → Do NOT mark complete. Fix plans must be implemented first.
- **If all iterations passed with no issues** → Append final status and suggest PR:

```markdown
---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
```

**Then suggest to the user:**
> "Plan complete! Would you like me to create a PR for these changes?"

This prompts the user to invoke the `pr-creator` agent if they want to submit the work.

## Issue Categories Reference

| Tag | Description | Default Severity |
|-----|-------------|------------------|
| `SECURITY` | Injection, auth bypass, secrets exposure, IDOR | CRITICAL/HIGH |
| `BUG` | Logic errors, off-by-one, null handling | HIGH |
| `ASYNC` | Unhandled promises, race conditions | HIGH |
| `RESOURCE` | Memory/resource leaks, missing cleanup | HIGH |
| `TIMEOUT` | Missing timeouts, potential hangs | HIGH/MEDIUM |
| `EDGE CASE` | Unhandled scenarios, boundary conditions | MEDIUM |
| `TYPE` | Unsafe casts, missing type guards | MEDIUM |
| `ERROR` | Missing or incorrect error handling | MEDIUM |
| `CONVENTION` | CLAUDE.md violations | LOW-MEDIUM |

**Note:** Severity depends on context. A convention violation like missing auth middleware is CRITICAL.

## Error Handling

| Situation | Action |
|-----------|--------|
| PLANS.md doesn't exist | Stop and tell user "No plan found." |
| No iteration needs review | Stop and tell user "No iteration to review. Run plan-implement first." |
| Plan has no iterations | Treat entire plan as single iteration (Iteration 1) |
| Files in iteration don't exist | Note as issue - implementation may have failed |
| CLAUDE.md doesn't exist | Use general coding best practices for review |
| Unsure if issue is a bug | Document as "POTENTIAL" and explain uncertainty |
| Too many issues found | Prioritize by severity, create fix plan for critical/high only |
| Multiple iterations pending | Review ALL of them in order, don't stop after one |

## Rules

- **Review ALL pending iterations** - Don't stop after one; process every iteration lacking `<!-- REVIEW COMPLETE -->`
- **Do not modify source code** - Review only, document findings
- **Be specific** - Include file paths and line numbers for every issue
- **One fix per issue** - Each Review Finding must have a matching Fix task
- **Fix Plan follows TDD** - Test first for each fix
- **Never modify previous sections** - Only add to current iteration or append status
- **Mark COMPLETE only when ALL iterations pass** - No fix plans pending, all reviewed
- If no iteration needs review, inform the user and stop

## Context Management & Continuation

After completing review of each iteration, estimate remaining context:

**Rough estimation heuristics:**
- Each file reviewed: ~1-2% context
- Each iteration reviewed: ~3-5% context
- Conversation messages accumulate over time

**Decision logic:**
- If estimated remaining context **> 60%** → Automatically continue to next pending iteration
- If estimated remaining context **≤ 60%** → Stop and inform user:
  > "Iteration N review complete. Context is running low (~X% estimated remaining). Run `/plan-review-implementation` again to continue."

**Why 60% threshold:** Leaves buffer for:
- Documenting review findings
- Creating fix plans
- User interactions
- Unexpected issues

**When to continue automatically:**
1. Current iteration review completed
2. There are more pending iterations to review
3. Estimated remaining context > 60%
