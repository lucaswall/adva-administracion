---
name: plan-todo
description: Convert TODO.md items into implementation plans in PLANS.md
argument-hint: [item-selector]
allowed-tools: Read, Edit, Write
disable-model-invocation: true
---

Convert TODO.md items into a structured implementation plan in PLANS.md.

## Pre-flight Check

**Before doing anything**, read PLANS.md and check if it contains incomplete work:
- If PLANS.md has content but NO "Status: COMPLETE" at the end → **STOP**
- Tell the user: "PLANS.md has incomplete work. Please review and clear it before planning new items."
- Do not proceed.

If PLANS.md is empty or has "Status: COMPLETE" → proceed with planning.

## Arguments

Default: plan the **first item** in TODO.md. Override with $ARGUMENTS:
- `bug #2` or `improvement #5` - Specific item by number
- `all bugs`, `all improvements`, `all items` - Multiple items
- Natural language: `the improvement about file naming`

## Workflow

1. Read PLANS.md - check for incomplete work (see Pre-flight Check)
2. Read TODO.md and identify items to plan
3. Read CLAUDE.md for project rules (TDD, agents, plan format)
4. Generate plan following TDD workflow
5. Write PLANS.md with the structure below (overwrites existing)
6. Remove planned items from TODO.md

## PLANS.md Structure

```markdown
# Implementation Plan

**Created:** YYYY-MM-DD
**Source:** [Which items from TODO.md]

## Original Plan

### Task 1: [Name]
1. Write test in [file].test.ts for [function/scenario]
2. Implement [function] in [file].ts

### Task 2: [Name]
...

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings
```

## Rules

- **Refuse to proceed if PLANS.md has incomplete work**
- Every task must follow TDD (test first)
- No manual steps - all validation through agents
- Tasks must be self-contained (full file paths, clear descriptions)
- Include enough detail that another model can implement without context
- Always include post-implementation checklist
