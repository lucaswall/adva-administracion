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

1. **Check latest Iteration block** for "Tasks Remaining" section:
   - If found → Resume from first task in that list
2. **Look for `## Fix Plan`** (h2 level) that has no iteration after it:
   - Fix Plans are created by `plan-review-implementation` when bugs are found
   - Execute fixes starting from Fix 1
3. **Original Plan** with no "Iteration 1" → Execute the original plan starting from Task 1
4. **Nothing pending** → Inform user "No pending work in PLANS.md"

**Resuming from previous iteration:**
When an iteration has "Tasks Remaining", start from the first remaining task. The previous iteration already documented completed tasks - do NOT re-execute them.

**Fix Plan structure:**
Fix Plans created by review have the same structure as tasks:
- `### Fix 1: [Title]` with `**Linear Issue:** [ADVA-N](url)`
- TDD steps (write test, implement fix)
- Execute them like regular tasks, creating a new iteration when done

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

### Pre-Stop Checklist

Run this checklist when stopping (either context low OR all tasks done):

1. **Run `bug-hunter` agent** - Review changes for bugs
   - If bugs found → Fix immediately before writing iteration block
2. **Run `verifier` agent** - Verify all tests pass and zero warnings
   - If failures or warnings → Fix immediately before writing iteration block

**IMPORTANT:** Always run this checklist before documenting the iteration, even if stopping mid-plan due to context limits.

## Handling Failures

| Failure Type | Action |
|--------------|--------|
| Test won't fail (step 2) | Review test - ensure it tests new behavior |
| Test won't pass (step 4) | Debug implementation, do not skip |
| bug-hunter finds issues | Fix bugs, re-run checklist |
| verifier has failures or warnings | Fix issues, re-run checklist |

**Never mark tasks complete with failing tests or warnings.**

## Document Results

After completing tasks (either all tasks or stopping due to context), append a new "Iteration N" section to PLANS.md:

```markdown
---

## Iteration N

**Implemented:** YYYY-MM-DD

### Tasks Completed This Iteration
- Task 3: Fix CUIT DNI extraction - Removed leading zero stripping, updated tests
- Task 4: Tighten ADVA_NAME_PATTERN - Changed regex to require VIDEOJUEGO

### Tasks Remaining
- Task 5: Add extraction failure flagging
- Task 6: Validate header indices
- ... (list remaining tasks)

### Files Modified
- `src/utils/validation.ts` - Removed leading zero removal in extractDniFromCuit
- `src/gemini/parser.ts` - Updated ADVA_NAME_PATTERN regex

### Linear Updates
- ADV-9: Todo → In Progress → Review
- ADV-10: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: [Passed | Found N bugs, fixed before proceeding]
- verifier: All N tests pass, zero warnings

### Continuation Status
[Context running low (~35% remaining). Run `/plan-implement` to continue with Task 5.]
OR
[All tasks completed. Ready for review.]
```

**IMPORTANT:**
- Do NOT add "Review Findings" or "Notes" sections - reserved for `plan-review-implementation`
- Always list completed tasks in "Tasks Completed This Iteration"
- If stopping early due to context limits, also list remaining tasks in "Tasks Remaining"
- If ALL tasks are complete, OMIT the "Tasks Remaining" section entirely
- The "Continuation Status" clearly indicates whether more work remains:
  - Stopping early: "Context running low (~X% remaining). Run `/plan-implement` to continue with Task N."
  - All done: "All tasks completed. Ready for review."

**Note:** The presence of "Tasks Remaining" does NOT prevent review. `plan-review-implementation` will review the completed tasks in this iteration regardless. Remaining tasks will be implemented and reviewed in future iterations.

## Context Management & Task-by-Task Continuation

**Evaluate context AFTER EACH TASK, not after the whole plan.**

After completing each task's TDD cycle (steps 1-6), estimate remaining context:

**Rough estimation heuristics:**
- Each large file read (~500 lines): ~2-3% context
- Each file written/edited: ~1-2% context
- Each verifier/bug-hunter invocation: ~2-4% context
- Conversation messages accumulate over time

**Decision logic after each task:**
- If estimated remaining context **> 40%** → Continue to next task
- If estimated remaining context **≤ 40%** → STOP and write iteration block

**Why 40% threshold:** Leaves buffer for:
- Running bug-hunter and verifier before stopping
- Documenting the iteration
- User interactions in next session
- Unexpected issues

**When reaching the threshold or completing all tasks:**
1. Run `bug-hunter` agent on completed work
2. Run `verifier` agent to confirm all tests pass
3. Write the `## Iteration N` block documenting what was done
4. If more tasks remain, inform user to run `/plan-implement` again

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
5. **NEVER ask "should I continue?"** - Use context estimation to decide automatically

## Rules

- **Evaluate context after EACH task** - Stop when context ≤ 40%, don't wait until all tasks done
- **Continue if context allows** - If > 40% context remains after a task, proceed to next task
- **Follow TDD strictly** - Test before implementation, always
- **Fix failures immediately** - Do not proceed with failing tests or warnings
- **Never modify previous sections** - Only append new Iteration section
- **Do not commit or create PR** - Unless explicitly requested
- **Document completed AND remaining tasks** - So next iteration knows where to resume
- **Update Linear in real-time** - Move issues Todo→In Progress at task start, In Progress→Review at task end
- If nothing to execute, inform the user and stop
