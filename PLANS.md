# Implementation Plan

**Created:** 2026-02-02
**Source:** Linear Backlog issue ADV-42
**Linear Issues:** [ADV-42](https://linear.app/adva-administracion/issue/ADV-42/move-reviewed-issues-to-merge-status)

## Context Gathered

### Linear Integration Research

**Merge status exists:** Confirmed via `list_issue_statuses` - status ID: `2832dda6-3442-47c8-aa36-76422fb08cd8`, type: `started`

**Linear GitHub Integration - Magic Keywords:**
Per [Linear's GitHub integration docs](https://linear.app/docs/github-integration), including magic keywords in PR descriptions automatically links issues and transitions them:
- **Closing keywords:** `closes`, `fixes`, `resolves`, `completes` + issue ID (e.g., `Closes ADV-123`)
- When PR is merged, Linear automatically moves the issue to Done
- Multiple issues: `Closes ADV-123, ADV-124, ADV-125`

**New State Flow:**
```
Backlog → Todo → In Progress → Review → Merge → Done
                                          ↑        ↑
                                    (review OK)  (PR merged)
```

### Files to Modify

**Skills (state transitions):**
- `.claude/skills/plan-review-implementation/SKILL.md` - Change Review→Done to Review→Merge
- `.claude/skills/plan-todo/SKILL.md` - Update state flow documentation

**Subagent (PR creation):**
- `.claude/agents/pr-creator.md` - Add Linear magic keywords to PR body template

**Project Documentation:**
- `CLAUDE.md` - Update LINEAR INTEGRATION section with new state flow

### Codebase Analysis

**plan-review-implementation changes needed:**
- Line 3 description: Update "Review→Done" to "Review→Merge"
- Line 8: Update description
- Line 20: Update "Review → Done" to "Review → Merge"
- Lines 23, 26, 178, 213, 228-229: Update all Done references to Merge
- Line 261: Update final status message
- Line 270: Update note about Done state
- Line 310: Update rule about Review→Done

**pr-creator changes needed:**
- Add "## Linear Issues" section to PR body template
- Include `Closes ADV-XXX` pattern for each issue in the plan
- Issues must be extracted from PLANS.md Linear Issues line
- Format: `Closes ADV-123, ADV-124, ADV-125` (comma-separated)

---

## Original Plan

### Task 1: Update plan-review-implementation to use Merge status
**Linear Issue:** [ADV-42](https://linear.app/adva-administracion/issue/ADV-42/move-reviewed-issues-to-merge-status)

1. Read `.claude/skills/plan-review-implementation/SKILL.md`
2. Update all "Review → Done" transitions to "Review → Merge":
   - Line 3: description
   - Line 8: summary line
   - Line 20: "This skill moves issues from **Review → Merge**"
   - Line 23: update_issue example
   - Line 26: issues found case
   - Line 178: Linear Updates example
   - Lines 213, 228-229, 261, 270, 310: various references
3. Update the final status message (line 261) to reflect Merge state
4. Update the completion note (line 270)

### Task 2: Update pr-creator to include Linear magic keywords
**Linear Issue:** [ADV-42](https://linear.app/adva-administracion/issue/ADV-42/move-reviewed-issues-to-merge-status)

1. Read `.claude/agents/pr-creator.md`
2. Add new step to Phase 1 to extract Linear issue IDs:
   - Read PLANS.md if exists
   - Extract issue IDs from "Linear Issues:" line (pattern: ADV-XXX)
   - Store for use in PR body
3. Update PR Body Structure (lines 109-132):
   - Add "## Linear Issues" section with `Closes ADV-XXX, ADV-YYY` format
   - This triggers Linear's automation when PR is merged → issues move to Done
4. Document the Linear integration in a new section explaining the magic keywords

### Task 3: Update plan-todo state flow documentation
**Linear Issue:** [ADV-42](https://linear.app/adva-administracion/issue/ADV-42/move-reviewed-issues-to-merge-status)

1. Read `.claude/skills/plan-todo/SKILL.md`
2. Update line 234 state flow to include Merge:
   - From: `Backlog → Todo → In Progress → Review → Done`
   - To: `Backlog → Todo → In Progress → Review → Merge → Done`

### Task 4: Update CLAUDE.md Linear Integration section
**Linear Issue:** [ADV-42](https://linear.app/adva-administracion/issue/ADV-42/move-reviewed-issues-to-merge-status)

1. Read `CLAUDE.md`
2. Update "State Flow" diagram to include Merge state
3. Add Merge to the states table with description
4. Update "State Transition Triggers" table:
   - Add `Review → Merge` triggered by plan-review-implementation
   - Add `Merge → Done` triggered by PR merge (via Linear GitHub automation)
5. Add note explaining the Linear GitHub integration magic keywords

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Iteration 1

**Implemented:** 2026-02-02

### Tasks Completed This Iteration
- Task 1: Update plan-review-implementation to use Merge status - Changed all "Review → Done" to "Review → Merge" throughout the skill
- Task 2: Update pr-creator to include Linear magic keywords - Added step to extract issue IDs from PLANS.md, added "Linear Issues" section with `Closes ADV-XXX` format
- Task 3: Update plan-todo state flow documentation - Added Merge to state flow comment
- Task 4: Update CLAUDE.md Linear Integration section - Added Merge state to diagram, table, and transitions; added Linear GitHub Integration section

### Files Modified
- `.claude/skills/plan-review-implementation/SKILL.md` - Updated all Done references to Merge
- `.claude/agents/pr-creator.md` - Added Linear issue extraction and magic keywords in PR body
- `.claude/skills/plan-todo/SKILL.md` - Updated state flow to include Merge
- `CLAUDE.md` - Updated LINEAR INTEGRATION section with Merge state and GitHub automation docs

### Linear Updates
- ADV-42: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed - no bugs found
- verifier: All 1506 tests pass, zero warnings

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 4
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

**Files reviewed:**
- `.claude/skills/plan-review-implementation/SKILL.md` - All "Review → Done" correctly changed to "Review → Merge"
- `.claude/agents/pr-creator.md` - Added Linear issue extraction and magic keywords in PR body
- `.claude/skills/plan-todo/SKILL.md` - State flow correctly updated to include Merge
- `CLAUDE.md` - Linear Integration section updated with Merge state and GitHub automation docs

### Linear Updates
- ADV-42: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Plan Summary

**Objective:** Implement Merge status in skill workflow so issues move to Merge after review, then automatically to Done when PR is merged via Linear's GitHub integration.

**Linear Issues:** ADV-42

**Approach:**
- Add Merge as intermediate state between Review and Done
- Update plan-review-implementation to move issues Review→Merge instead of Review→Done
- Update pr-creator to include `Closes ADV-XXX` magic keywords in PR body
- When PR merges, Linear's GitHub automation moves issues Merge→Done automatically

**Scope:**
- Tasks: 4
- Files affected: 4 (2 skills, 1 subagent, 1 project doc)
- New tests: no (documentation/skill changes only)

**Key Decisions:**
- Merge is type `started` (not `completed`) so Linear treats it as "in progress" until PR merges
- PR body uses `Closes` keyword (not `Fixes`) as these are features/improvements, not bugs
- Multiple issues in one PR are comma-separated: `Closes ADV-123, ADV-124`
- pr-creator extracts issue IDs from PLANS.md automatically

**Dependencies/Prerequisites:**
- Linear GitHub integration must be configured (assumed already set up)
- Tasks can be done in any order, but Task 4 (CLAUDE.md) should be last to reflect final state

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. ADV-42 moved to Merge.
Ready for PR creation.
