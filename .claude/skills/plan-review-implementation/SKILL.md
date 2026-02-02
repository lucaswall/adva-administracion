---
name: plan-review-implementation
description: QA review of completed implementation. Use after plan-implement finishes, or when user says "review the implementation". Moves Linear issues Review→Done. Creates new issues in Todo for bugs found. Identifies bugs, edge cases, security issues (OWASP-based), type safety, resource leaks, and async issues. Creates fix plans for issues found or marks COMPLETE.
allowed-tools: Read, Edit, Glob, Grep, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Review **ALL** implementation iterations that need review, then mark complete or create fix plans. Moves Linear issues Review→Done.

**Reference:** See [references/code-review-checklist.md](references/code-review-checklist.md) for comprehensive checklist.

## Pre-flight Check

1. **Read PLANS.md** - Understand the full plan and iteration history
2. **Read CLAUDE.md** - Understand project standards and conventions
3. **Assess AI-generated code risk** - If implementation is large or shows AI patterns, apply extra scrutiny

## Linear State Management

This skill moves issues from **Review → Done** (the final transition).

**If task passes review (no issues):**
- Move issue from "Review" to "Done" using `mcp__linear__update_issue`

**If task needs fixes (issues found):**
- Move original issue from "Review" to "Done" (the original task was completed)
- Create NEW Linear issue(s) in "Todo" for each bug/fix using `mcp__linear__create_issue`:
  - `team`: "ADVA Administracion"
  - `state`: "Todo" (will enter PLANS.md via Fix Plan)
  - `labels`: Bug
- Add new issue links to the Fix Plan section in PLANS.md
- These new issues will go through the full cycle when plan-implement runs the Fix Plan

## Identify What to Review

**Detection logic:**

1. Search PLANS.md for `## Iteration N` sections
2. **If iterations exist:** Build list of iterations needing review:
   - Has "Tasks Completed This Iteration" or "### Completed" subsection
   - Does NOT contain `<!-- REVIEW COMPLETE -->` marker
   - Process in order (Iteration 1 first, then 2, etc.)
3. **If NO iterations exist:** Treat entire plan as single iteration:
   - Look for "Completed" or "### Completed" section at plan level
   - Check if plan already has `<!-- REVIEW COMPLETE -->` marker
   - If completed but not reviewed → review as "Iteration 1"

**Iteration detection:** A plan has iterations if it contains `## Iteration` (with or without number).

**Ready for review vs partial iteration:**

An iteration is **READY FOR REVIEW** when:
- It has "Tasks Completed This Iteration" (or legacy "### Completed") section
- It does NOT have `<!-- REVIEW COMPLETE -->` marker yet
- The presence of `### Tasks Remaining` does NOT affect review readiness

An iteration should be reviewed even if it has `### Tasks Remaining`. The review covers only the **completed tasks** in that iteration. Remaining tasks will be implemented in a future iteration.

**Example - iteration ready for review:**
```markdown
## Iteration 1

### Tasks Completed This Iteration
- Task 1: Added validation
- Task 2: Fixed parser

### Tasks Remaining
- Task 3: Add error handling
- Task 4: Update tests

### Continuation Status
Context running low (~35% remaining). More tasks remain.
```
→ This iteration IS ready for review. Review Tasks 1 and 2. Tasks 3-4 will be in a future iteration.

**Example - iteration already reviewed:**
```markdown
## Iteration 1

### Tasks Completed This Iteration
- Task 1: Added validation

### Review Findings
No issues found...

<!-- REVIEW COMPLETE -->
```
→ This iteration is NOT ready for review (already reviewed).

If no iteration/plan needs review → Inform user and stop.

**Important:** Review ALL pending iterations in a single session, not just one.

## Review Process

**For EACH iteration needing review (in order):**

### Step 1: Identify Implemented Code

From the iteration's "Tasks Completed This Iteration" (or legacy "Completed") section, list all files that were:
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

Add Review Findings to the current Iteration section, then add Fix Plan at h2 level AFTER the iteration:

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

### Linear Updates
- ADVA-123: Review → Done (original task completed)
- ADVA-125: Created in Todo (Fix: SQL injection)
- ADVA-126: Created in Todo (Fix: Race condition)
- ADVA-127: Created in Todo (Fix: Unhandled promise)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration N
**Linear Issues:** [ADVA-125](https://linear.app/...), [ADVA-126](https://linear.app/...), [ADVA-127](https://linear.app/...)

### Fix 1: SQL injection in query builder
**Linear Issue:** [ADVA-125](https://linear.app/...)

1. Write test in `src/db.test.ts` for malicious input escaping
2. Use parameterized query in `src/db.ts:45`

### Fix 2: Race condition in cache invalidation
**Linear Issue:** [ADVA-126](https://linear.app/...)

1. Write test in `src/cache.test.ts` for concurrent invalidation
2. Add mutex/lock in `src/cache.ts:120`

### Fix 3: Unhandled promise rejection
**Linear Issue:** [ADVA-127](https://linear.app/...)

1. Write test in `src/api.test.ts` for error handling
2. Add try/catch in `src/api.ts:78`
```

**Note:** The `<!-- REVIEW COMPLETE -->` marker is added to the iteration even when issues are found, because the review itself is complete. The Fix Plan is at h2 level so `plan-implement` can find and execute it.

**Linear workflow:** Original issues move to Done (the original task was completed). Bug issues are created in Todo state for the fix plan.

### If No Issues Found

Add to the current Iteration section:

```markdown
### Review Findings

Files reviewed: N
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- ADVA-123: Review → Done
- ADVA-124: Review → Done

<!-- REVIEW COMPLETE -->
```

**Then continue to the next iteration needing review.**

### When Stopping Due to Context Limits

If context is low (≤60%) after completing an iteration review but MORE iterations remain:

1. Document the completed iteration's findings (as normal)
2. Inform user about remaining iterations
3. **Suggest commit to preserve progress:**
   > "Iteration N review complete. Context is running low (~X% estimated remaining). Would you like me to commit these changes before continuing? Run `/plan-review-implementation` again to review the remaining iterations."

This ensures work is preserved even if the session ends.

### After ALL Iterations Reviewed

When all pending iterations have been reviewed:

- **If Fix Plan exists OR tasks remain unfinished** → Do NOT mark complete. More implementation needed.
  > "Review complete. Run `/plan-implement` to continue implementation."

- **If all tasks complete and no issues** → Append final status and create PR:

```markdown
---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Done.
Ready for human review.
```

**Then tell the user:**
> "Plan complete! Create a PR for these changes."

This triggers the `pr-creator` subagent to handle branch creation, commit, push, and PR.

**Note:** When marking COMPLETE, all issues from the plan should be in Done state.

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
- **One fix per issue** - Each Review Finding must have a matching Fix task with Linear issue
- **Fix Plan follows TDD** - Test first for each fix
- **Never modify previous sections** - Only add to current iteration or append status
- **Mark COMPLETE only when ALL iterations pass** - No fix plans pending, all reviewed
- **Move issues to Done** - All reviewed issues that pass go Review→Done
- **Create bug issues in Todo** - All bugs found create new issues in Todo state
- If no iteration needs review, inform the user and stop

## Context Management & Continuation

**CRITICAL:** Context is checked ONLY at iteration boundaries. Never stop mid-iteration review.

**When to check context:**
- AFTER completing each iteration's full review (Step 1-3 + documenting findings)
- BEFORE starting the next iteration's review

**After completing each iteration review**, estimate remaining context:

**Rough estimation heuristics:**
- Each file reviewed: ~1-2% context
- Each iteration reviewed: ~3-5% context
- Conversation messages accumulate over time

**Decision logic:**
- If estimated remaining context **> 60%** → Automatically continue to next pending iteration
- If estimated remaining context **≤ 60%** → Stop and inform user:
  > "Iteration N review complete. Context is running low (~X% estimated remaining). Run `/plan-review-implementation` again to continue."

**Why 60% threshold (vs 40% for plan-implement):**
- Review is read-heavy (less context than writing code)
- Documenting findings is lighter than writing tests + implementation
- Fix plans (if created) are structured summaries
- 60% leaves sufficient buffer for documenting and creating Linear issues

**When to continue automatically:**
1. Current iteration review FULLY completed (all files reviewed, findings documented)
2. There are more pending iterations to review
3. Estimated remaining context > 60%

**Never stop mid-iteration:**
- Once you start reviewing an iteration, you MUST complete it before stopping
- This ensures each iteration has complete review findings documented
- Partial reviews leave the plan in an inconsistent state
