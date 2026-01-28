---
name: plan-implement
description: Execute the pending plan in PLANS.md following TDD workflow. Use when user says "implement the plan", "execute the plan", or after any plan-* skill creates a plan. Runs tests, writes code, documents results.
allowed-tools: Read, Edit, Write, Bash, Task, Glob, Grep
disable-model-invocation: true
---

Execute the current pending work in PLANS.md following strict TDD workflow.

## Pre-flight Check

1. **Read PLANS.md** - Understand the full context and history
2. **Read CLAUDE.md** - Understand TDD workflow and project rules

## Identify What to Execute

Look in PLANS.md for pending work in this priority order:

1. **Latest "Fix Plan"** with no "Iteration" after it → Execute that fix plan
2. **Original Plan** with no "Iteration 1" → Execute the original plan
3. **Nothing pending** → Inform user "No pending work in PLANS.md"

## Execution Workflow

For each task in the plan:

### TDD Cycle (MANDATORY)

```
1. WRITE TEST
   └─ Add test cases in [file].test.ts

2. RUN TEST (expect fail)
   └─ Use test-runner agent
   └─ If test passes: warning - test may not be testing the right thing

3. IMPLEMENT
   └─ Write minimal code to make test pass

4. RUN TEST (expect pass)
   └─ Use test-runner agent
   └─ If fail: fix implementation, repeat step 4
```

### Task Completion Checklist

After completing ALL tasks:

1. **Run `bug-hunter` agent** - Review changes for bugs
   - If bugs found → Fix immediately before proceeding
2. **Run `test-runner` agent** - Verify all tests pass
   - If failures → Fix immediately before proceeding
3. **Run `builder` agent** - Verify zero warnings
   - If warnings → Fix immediately before proceeding

## Handling Failures

| Failure Type | Action |
|--------------|--------|
| Test won't fail (step 2) | Review test - ensure it tests new behavior |
| Test won't pass (step 4) | Debug implementation, do not skip |
| bug-hunter finds issues | Fix bugs, re-run checklist |
| test-runner fails | Fix tests, re-run checklist |
| builder has warnings | Fix warnings, re-run checklist |

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

### Checklist Results
- bug-hunter: [Passed | Found N bugs, fixed]
- test-runner: [Passed | Failed, fixed]
- builder: [Passed | Had warnings, fixed]

### Notes
[Any important observations, edge cases discovered, or deviations from plan]
```

## Error Handling

| Situation | Action |
|-----------|--------|
| PLANS.md doesn't exist or is empty | Stop and tell user "No plan found. Run plan-todo or plan-inline first." |
| PLANS.md already has "Status: COMPLETE" | Stop and tell user "Plan already complete. Create a new plan first." |
| Test won't fail in step 2 | Review test logic - ensure it tests new behavior, not existing |
| Test won't pass in step 4 | Debug implementation, do not skip or delete test |
| bug-hunter finds issues | Fix all bugs before marking tasks complete |
| test-runner has failures | Fix all failures before proceeding |
| builder has warnings | Fix all warnings before proceeding |
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
- **Follow TDD strictly** - Test before implementation, always
- **Fix failures immediately** - Do not proceed with failing tests or warnings
- **Never modify previous sections** - Only append new Iteration section
- **Do not commit or create PR** - Unless explicitly requested
- **Document everything** - Include all checklist results in iteration
- If nothing to execute, inform the user and stop
