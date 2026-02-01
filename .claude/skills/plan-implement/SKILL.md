---
name: plan-implement
description: Execute the pending plan in PLANS.md following TDD workflow. Use when user says "implement the plan", "execute the plan", or after any plan-* skill creates a plan. Updates Linear issues in real-time: Todo→In Progress→Review. Runs tests, writes code, documents results.
allowed-tools: Read, Edit, Write, Bash, Task, Glob, Grep, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__update_issue, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Execute the current pending work in PLANS.md following strict TDD workflow. Updates Linear issues in real-time.

## Pre-flight Check

1. **Read PLANS.md** - Understand the full context and history
2. **Read CLAUDE.md** - Understand TDD workflow and project rules

## Identify What to Execute

Look in PLANS.md for pending work in this priority order:

1. **Latest "Fix Plan"** with no "Iteration" after it → Execute that fix plan
2. **Original Plan** with no "Iteration 1" → Execute the original plan
3. **Nothing pending** → Inform user "No pending work in PLANS.md"

## Linear State Management

State transitions happen **in real-time, task by task** (not batched at the end).

**When STARTING a task:**
1. Extract Linear issue ID from task's `**Linear Issue:** [ADVA-N](url)` line
2. IMMEDIATELY move issue to "In Progress" using `mcp__linear__update_issue`
3. Then begin the TDD cycle

**When COMPLETING a task:**
1. After verifier passes, IMMEDIATELY move issue to "Review" using `mcp__linear__update_issue`
2. Then proceed to the next task

If task has no Linear issue link, skip state updates (legacy plan).

## Execution Workflow

For each task in the plan:

### TDD Cycle (MANDATORY)

```
1. MOVE LINEAR ISSUE: Todo → In Progress
   └─ Use mcp__linear__update_issue (skip if no issue link)

2. WRITE TEST
   └─ Add test cases in [file].test.ts

3. RUN TEST (expect fail)
   └─ Use verifier agent
   └─ If test passes: warning - test may not be testing the right thing

4. IMPLEMENT
   └─ Write minimal code to make test pass

5. RUN TEST (expect pass)
   └─ Use verifier agent
   └─ If fail: fix implementation, repeat step 5

6. MOVE LINEAR ISSUE: In Progress → Review
   └─ Use mcp__linear__update_issue (skip if no issue link)
```

### Task Completion Checklist

After completing ALL tasks:

1. **Run `bug-hunter` agent** - Review changes for bugs
   - If bugs found → Fix immediately before proceeding
2. **Run `verifier` agent** - Verify all tests pass and zero warnings
   - If failures or warnings → Fix immediately before proceeding

## Handling Failures

| Failure Type | Action |
|--------------|--------|
| Test won't fail (step 2) | Review test - ensure it tests new behavior |
| Test won't pass (step 4) | Debug implementation, do not skip |
| bug-hunter finds issues | Fix bugs, re-run checklist |
| verifier has failures or warnings | Fix issues, re-run checklist |

**Never mark tasks complete with failing tests or warnings.**

## Document Results

After execution, append a new "Iteration N" section to PLANS.md:

```markdown
---

## Iteration N

**Implemented:** YYYY-MM-DD

### Completed
- Task 1: [Brief description of what was done]
- Task 2: [Brief description of what was done]

### Files Modified
- `path/to/file.ts` - Description of changes

### Linear Updates
- ADVA-123: Todo → In Progress → Review
- ADVA-124: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: [Passed | Found N bugs, fixed before proceeding]
- verifier: All N tests pass, zero warnings
```

**IMPORTANT:** Do NOT add "Review Findings" or "Notes" sections. Those are reserved for `plan-review-implementation`. The iteration section should end after "Pre-commit Verification".

## Context Management & Continuation

After completing each iteration, estimate remaining context:

**Rough estimation heuristics:**
- Each large file read (~500 lines): ~2-3% context
- Each file written/edited: ~1-2% context
- Each verifier/bug-hunter invocation: ~2-4% context
- Conversation messages accumulate over time

**Decision logic:**
- If estimated remaining context **> 60%** → Automatically continue to next pending work (Fix Plan or next iteration)
- If estimated remaining context **≤ 60%** → Stop and inform user:
  > "Iteration N complete. Context is running low (~X% estimated remaining). Run `/plan-implement` again to continue."

**Why 60% threshold:** Leaves buffer for:
- Potential bug fixes
- verifier verification
- User interactions
- Unexpected issues

**When to continue automatically:**
1. Current iteration completed successfully
2. There is more pending work in PLANS.md (another Fix Plan or the plan isn't fully implemented)
3. Estimated remaining context > 60%

## Error Handling

| Situation | Action |
|-----------|--------|
| PLANS.md doesn't exist or is empty | Stop and tell user "No plan found. Run plan-todo or plan-inline first." |
| PLANS.md already has "Status: COMPLETE" | Stop and tell user "Plan already complete. Create a new plan first." |
| Test won't fail in step 2 | Review test logic - ensure it tests new behavior, not existing |
| Test won't pass in step 4 | Debug implementation, do not skip or delete test |
| bug-hunter finds issues | Fix all bugs before marking tasks complete |
| verifier has failures or warnings | Fix all issues before proceeding |
| Task references file that doesn't exist | Create the file as part of implementation |
| Task is ambiguous | Re-read PLANS.md context section, infer from codebase patterns |

## Scope Boundaries

**This skill implements plans. It does NOT:**
1. **NEVER create commits or PRs** - Unless user explicitly requests
2. **NEVER skip failing tests** - Fix them or ask for help
3. **NEVER modify PLANS.md sections above current iteration** - Append only
4. **NEVER proceed with warnings** - Fix all warnings first
5. **NEVER ask "should I continue?"** - Execute the full plan

## Rules

- **Execute ALL pending tasks** - Never leave work incomplete
- **Continue automatically if context allows** - If > 60% context remains, proceed to next iteration
- **Follow TDD strictly** - Test before implementation, always
- **Fix failures immediately** - Do not proceed with failing tests or warnings
- **Never modify previous sections** - Only append new Iteration section
- **Do not commit or create PR** - Unless explicitly requested
- **Document everything** - Include all checklist results in iteration
- **Update Linear in real-time** - Move issues Todo→In Progress at task start, In Progress→Review at task end
- If nothing to execute, inform the user and stop
