---
name: plan-implement
description: Execute the implementation plan from PLANS.md
allowed-tools: Read, Edit, Write, Bash, Task, Glob, Grep
disable-model-invocation: true
---

Execute the current pending work in PLANS.md.

## Workflow

1. Read PLANS.md to understand the full context
2. Read CLAUDE.md for project rules and TDD workflow
3. Identify what to execute:
   - Look for the **latest "Fix Plan"** section that has no "Iteration" after it → execute that
   - If no pending Fix Plan → execute **Original Plan** (if no Iteration 1 exists)
   - If Original Plan already has Iteration 1 and no pending Fix Plan → nothing to do
4. Execute **ALL tasks completely** - no partial execution
5. Run post-implementation checklist:
   - `bug-hunter` agent - Review changes for bugs
   - `test-runner` agent - Verify all tests pass
   - `builder` agent - Verify zero warnings
6. Append a new "Iteration N" section to PLANS.md documenting results

## Iteration Format

Append this after executing work:

```markdown
---

## Iteration N

**Implemented:** YYYY-MM-DD

### Completed
- Task 1: Done
- Task 2: Done
- Checklist: Passed (or note any issues)
```

## Rules

- **Execute ALL pending tasks** - never leave work incomplete
- Follow TDD strictly: write test, run test-runner (fail), implement, run test-runner (pass)
- Fix test/build failures immediately before proceeding
- **Never modify previous sections** - only append new Iteration section
- Do not commit or create PR unless explicitly requested
- If nothing to execute (plan already complete), inform the user
