---
name: plan-todo
description: Convert TODO.md items into implementation plans in PLANS.md
argument-hint: [item-selector]
allowed-tools: Read, Edit, Write
---

Convert TODO.md items into a structured implementation plan.

## Item Selection

By default, plan the **first item** in TODO.md. User can specify different items via $ARGUMENTS:
- `bug #2` - Specific bug by number
- `improvement #5` - Specific improvement by number
- `all bugs` - All bug items
- `all improvements` - All improvement items
- `all items` - Everything in TODO.md
- Natural language: `the improvement about better naming files`

## Workflow

1. **Read TODO.md** to get all items
2. **Identify items to plan** based on user request (default: first item)
3. **Read CLAUDE.md** to understand plan requirements
4. **Generate plan** following project rules:
   - Each task must start with writing tests (TDD)
   - Include test-runner steps after test creation
   - No manual verification steps
   - End with post-implementation checklist
5. **Write PLANS.md** - overwrite all content with new plan
6. **Update TODO.md** - remove the planned items

## Plan Format

```markdown
# Implementation Plan

**Created:** YYYY-MM-DD

## Overview
Brief description of what will be implemented.

## Tasks

### Task 1: [Name]
1. Write test in [file].test.ts for [function]
2. Run test-runner (expect fail)
3. Implement [function] in [file].ts
4. Run test-runner (expect pass)

### Task 2: ...

## Post-Implementation Checklist
1. Run `bug-hunter` - Review git changes for bugs
2. Run `test-runner` - Verify all tests pass
3. Run `builder` - Verify zero warnings
```

## Rules

- Always read CLAUDE.md before generating plans
- Every implementation task must include TDD steps (test first)
- **No manual steps:** Plans are executed entirely by agents. Never include manual human testing, manual verification, or any step requiring human action. All validation is automated through `test-runner`, `bug-hunter`, and `builder` agents.
- Always include post-implementation checklist at the end
- Overwrite PLANS.md completely (no history preserved)
- Remove only the items that were converted to plans from TODO.md
