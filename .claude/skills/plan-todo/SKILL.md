---
name: plan-todo
description: Convert TODO.md items into TDD implementation plans in PLANS.md. Use when starting work on backlog items, planning features, or organizing implementation tasks.
argument-hint: [item-selector] e.g., "bug #2", "all improvements", "the file naming issue"
allowed-tools: Read, Edit, Write
disable-model-invocation: true
---

Convert TODO.md items into a structured TDD implementation plan in PLANS.md.

## Pre-flight Check

**Before doing anything**, read PLANS.md and check for incomplete work:
- If PLANS.md has content but NO "Status: COMPLETE" at the end → **STOP**
- Tell the user: "PLANS.md has incomplete work. Please review and clear it before planning new items."
- Do not proceed.

If PLANS.md is empty or has "Status: COMPLETE" → proceed with planning.

## Arguments

Default: plan the **first item** in TODO.md. Override with $ARGUMENTS:

| Selector | Example | Result |
|----------|---------|--------|
| Item number | `bug #2`, `improvement #5` | Specific item |
| Category | `all bugs`, `all improvements` | All items in category |
| Natural language | `the file naming issue` | Fuzzy match |

## Workflow

1. **Read PLANS.md** - Pre-flight check
2. **Read TODO.md** - Identify items to plan
3. **Read CLAUDE.md** - Understand TDD workflow, agents, project rules
4. **Generate plan** - Create TDD tasks with test-first approach
5. **Write PLANS.md** - Overwrite with new plan
6. **Update TODO.md** - Remove planned items

## PLANS.md Structure

```markdown
# Implementation Plan

**Created:** YYYY-MM-DD
**Source:** [Which items from TODO.md]

## Original Plan

### Task 1: [Name]
1. Write test in [file].test.ts for [function/scenario]
2. Run test-runner (expect fail)
3. Implement [function] in [file].ts
4. Run test-runner (expect pass)

### Task 2: [Name]
1. Write test...
2. Run test-runner...
3. Implement...
4. Run test-runner...

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings
```

## Task Writing Guidelines

Each task must be:
- **Self-contained** - Full file paths, clear descriptions
- **TDD-compliant** - Test before implementation
- **Specific** - What to test, what to implement
- **Ordered** - Dependencies resolved by task order

Good task example:
```markdown
### Task 1: Add parseResumenBroker function
1. Write test in src/gemini/parser.test.ts for parseResumenBrokerResponse
   - Test extracts comitente number
   - Test handles multi-currency (ARS + USD)
   - Test returns error for invalid input
2. Run test-runner (expect fail)
3. Implement parseResumenBrokerResponse in src/gemini/parser.ts
4. Run test-runner (expect pass)
```

Bad task example:
```markdown
### Task 1: Add broker parsing
1. Add parser function
2. Test it
```

## Rules

- **Refuse to proceed if PLANS.md has incomplete work**
- Every task must follow TDD (test first, then implement)
- No manual verification steps - use agents only
- Tasks must be implementable without additional context
- Always include post-implementation checklist
- Remove planned items from TODO.md after writing PLANS.md
