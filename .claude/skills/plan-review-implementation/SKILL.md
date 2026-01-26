---
name: plan-review-implementation
description: Review implementation, create fix plan if needed
allowed-tools: Read, Edit, Glob, Grep
disable-model-invocation: true
---

Review the latest implementation and either create a fix plan or mark complete.

## Workflow

1. Read PLANS.md to understand the full plan and history
2. Read CLAUDE.md for project standards
3. Find the **latest "Iteration N"** section that has "Completed" but no "Review Findings"
4. Identify all code that was implemented in that iteration
5. Review that code thoroughly:
   - Bugs and logic errors
   - Missing edge cases
   - Incorrect implementations vs plan intent
   - Security vulnerabilities
   - Error handling gaps
   - Type safety issues
   - Deviations from project conventions
6. Update PLANS.md:
   - Add "Review Findings" subsection to the current iteration
   - If issues found → Add "Fix Plan" subsection with TDD tasks
   - If no issues → Append "Status: COMPLETE" at the end of the file

## Update Format - Issues Found

Add to the current Iteration section:

```markdown
### Review Findings
- BUG: [description] ([file]:[line])
- EDGE CASE: [description] ([file]:[line])
- SECURITY: [description] ([file]:[line])

### Fix Plan

#### Fix 1: [Title matching the issue]
1. Write test in [file].test.ts for [scenario]
2. Implement fix in [file].ts

#### Fix 2: [Title]
...
```

## Update Format - No Issues

Add to the current Iteration section, then append status:

```markdown
### Review Findings
None - all implementations correct.

---

## Status: COMPLETE

All tasks and fixes implemented successfully. Ready for human review.
```

## Issue Categories

- **BUG**: Logic errors, incorrect behavior
- **EDGE CASE**: Unhandled scenarios
- **SECURITY**: Vulnerabilities (injection, validation gaps)
- **TYPE**: Type safety issues
- **CONVENTION**: Deviations from CLAUDE.md rules
- **ERROR HANDLING**: Missing or incorrect error handling

## Rules

- **Do not modify source code** - review only
- Read and analyze all implemented code thoroughly
- Be specific: include file paths and line numbers
- Each issue in Review Findings must have a corresponding Fix task
- Fix Plan must follow TDD (test first for each fix)
- **Never modify previous sections** - only add to current iteration or append status
- If no iteration needs review, inform the user
