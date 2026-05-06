# Document Findings — Templates

## If Issues Found and Fixed Inline

When the inline fix assessment determined bugs could be fixed directly:

```markdown
### Review Findings

Summary: N issue(s) found, fixed inline ([single-agent review | Team: security, reliability, quality reviewers])
- FIXED INLINE: X issue(s) — verified via TDD + bug-hunter

**Issues fixed inline:**
- [MEDIUM] BUG: Missing try/catch in API handler (`src/services/broker.ts:142`) — added error handling + test
- [LOW] CONVENTION: Missing structured action field on log (`src/utils/logger.ts:55`) — added { action: "operation" }

**Discarded findings (not bugs):**
- [DISCARDED] ... (if any)

### Linear Updates
- ADVA-123: Review → Merge (original task)
- ADVA-130: Created in Merge (Fix: missing try/catch — fixed inline)
- ADVA-131: Created in Merge (Fix: missing log action — fixed inline)

### Inline Fix Verification
- Unit tests: all pass
- Bug-hunter: no new issues

<!-- REVIEW COMPLETE -->
```

No `## Fix Plan` is created — the bugs are already resolved. The iteration proceeds directly to the completion check.

## If Issues Found (creating Fix Plan)

Add Review Findings to the current Iteration section, then add Fix Plan at h2 level AFTER the iteration:

```markdown
### Review Findings

Summary: N issue(s) found (Team: security, reliability, quality reviewers)
- FIX: X issue(s) — Linear issues created
- DISCARDED: Y finding(s) — false positives / not applicable

**Issues requiring fix:**
- [CRITICAL] SECURITY: Missing input validation in CUIT parser (`src/utils/validation.ts:45`)
- [HIGH] BUG: Race condition in spreadsheet processing (`src/services/spreadsheet.ts:120`)
- [MEDIUM] TEST: Parallel test interference in parser assertions (`src/gemini/parser.test.ts:97`)

**Discarded findings (not bugs):**
- [DISCARDED] EDGE CASE: Unicode in CUIT field (`src/utils/validation.ts:30`) — CUIT fields only contain digits and hyphens by AFIP specification

### Linear Updates
- ADVA-123: Review → Merge (original task completed)
- ADVA-125: Created in Todo (Fix: Missing input validation)
- ADVA-126: Created in Todo (Fix: Race condition)
- ADVA-127: Created in Todo (Fix: Parallel test interference)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration N
**Linear Issues:** [ADVA-125](...), [ADVA-126](...), [ADVA-127](...)

### Fix 1: Missing input validation in CUIT parser
**Linear Issue:** [ADVA-125](...)

1. Write test in `src/utils/validation.test.ts` for malicious input handling
2. Add input sanitization in `src/utils/validation.ts:45`

### Fix 2: Race condition in spreadsheet processing
**Linear Issue:** [ADVA-126](...)

1. Write test in `src/services/spreadsheet.test.ts` for concurrent processing
2. Add mutex/lock in `src/services/spreadsheet.ts:120`

### Fix 3: Parallel test interference
**Linear Issue:** [ADVA-127](...)

1. Remove fragile assertion after cleanup
2. Verify state without assuming empty state
```

**Note:** `<!-- REVIEW COMPLETE -->` is added even when issues are found — the review itself is complete. Fix Plan is at h2 level so `plan-implement` can find it.

## If No Issues Found (or all findings discarded)

```markdown
### Review Findings

Files reviewed: N
Reviewers: security, reliability, quality (agent team)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

**Discarded findings (not bugs):**
- [DISCARDED] ... (if any findings were raised but classified as not-bugs)

### Linear Updates
- ADVA-123: Review → Merge
- ADVA-124: Review → Merge

<!-- REVIEW COMPLETE -->
```

**Then continue to the next iteration needing review.**
