# Implementation Plan

**Created:** 2026-02-01
**Source:** TODO.md items #1, #2, #3, #4, #5, #6, #7

## Context Gathered

### Codebase Analysis

**Agent files:**
- `.claude/agents/commit-bot.md` - Uses `git add -A` at line 18 (item #1)
- `.claude/agents/pr-creator.md` - Uses `model: haiku` at line 5 (item #2)
- `.claude/agents/test-runner.md` - To be merged (item #3)
- `.claude/agents/builder.md` - To be merged (item #3)

**Skill files:**
- `.claude/skills/investigate/SKILL.md` - Missing MCP documentation (item #5), needs differentiation (item #7)
- `.claude/skills/plan-fix/SKILL.md` - Needs differentiation (item #7)
- `.claude/skills/plan-review-implementation/SKILL.md` - Missing context management (item #6)

**Files referencing test-runner/builder (need updates for item #3):**
- `CLAUDE.md` - SUBAGENTS table, TDD workflow, commands section
- `.claude/skills/plan-implement/SKILL.md` - TDD cycle, checklist, error handling
- `.claude/skills/plan-fix/SKILL.md` - Post-implementation checklist
- `.claude/skills/plan-inline/SKILL.md` - Examples and checklist
- `.claude/skills/plan-todo/SKILL.md` - Examples and checklist

### tools-improve Guidance

From `.claude/skills/tools-improve/SKILL.md`:
- **Max 3-4 custom subagents** - Currently 5 (commit-bot, pr-creator, bug-hunter, test-runner, builder)
- **Model selection:** haiku=fast/cheap, sonnet=balanced, opus=complex reasoning
- **Descriptions are critical** - Include trigger phrases ("Use when...", "Use proactively after...")

---

## Original Plan

### Task 1: Fix commit-bot to stage specific files instead of git add -A

**Problem:** `commit-bot` uses `git add -A` which can stage sensitive files (.env, credentials) or large binaries.

1. Edit `.claude/agents/commit-bot.md`:
   - Replace step 2 "Stage changes" workflow from:
     ```
     2. **Stage changes**
        - `git add -A`
     ```
   - To analyzing untracked/modified files and staging specific files:
     ```
     2. **Analyze and stage changes**
        - `git status --porcelain=v1` - Get list of changed files
        - Review each file - skip if matches: `.env*`, `*.key`, `*.pem`, `credentials*`, `secrets*`, `node_modules/`, `dist/`, `*.log`
        - Stage specific files: `git add <file1> <file2> ...`
        - If all files were skipped → report "No safe files to commit" and stop
     ```
   - Update the Rules section to add: "Never stage files matching sensitive patterns (.env*, credentials, secrets, *.key, *.pem)"

2. Verify: Read the updated file to confirm changes are correct

### Task 2: Change pr-creator model from haiku to sonnet

**Problem:** `pr-creator` performs complex analysis but uses `haiku` model.

1. Edit `.claude/agents/pr-creator.md` line 5:
   - Change `model: haiku` to `model: sonnet`

2. Verify: Read the updated file to confirm the model is now sonnet

### Task 3: Create verifier agent by merging test-runner and builder

**Problem:** Too many custom subagents (5) exceeds recommended 3-4 limit.

1. Create `.claude/agents/verifier.md` with combined functionality:
   - Runs tests first (`npm test`)
   - Then runs build (`npm run build`)
   - Reports combined results
   - Include trigger phrases for better auto-discovery

2. Delete `.claude/agents/test-runner.md`

3. Delete `.claude/agents/builder.md`

4. Update `CLAUDE.md`:
   - Replace `test-runner` and `builder` entries in SUBAGENTS table with single `verifier` entry
   - Update TDD workflow references
   - Update Post-Implementation Checklist
   - Update COMMANDS section comments

5. Update `.claude/skills/plan-implement/SKILL.md`:
   - Replace all `test-runner` references with `verifier`
   - Replace all `builder` references with `verifier`
   - Update TDD cycle to use single agent
   - Update error handling table

6. Update `.claude/skills/plan-fix/SKILL.md`:
   - Update Post-Implementation Checklist

7. Update `.claude/skills/plan-inline/SKILL.md`:
   - Update examples and checklist

8. Update `.claude/skills/plan-todo/SKILL.md`:
   - Update examples and checklist

9. Verify: Run `verifier` agent to confirm it works (tests pass, build succeeds)

### Task 4: Add trigger phrases to verifier agent

**Depends on:** Task 3

**Problem:** Merged agent needs trigger phrases for better auto-discovery.

1. This is handled in Task 3 when creating verifier.md - the description will include:
   - "Use proactively after writing tests or modifying code"
   - "Use when user says 'run tests', 'check tests', 'verify build', 'check warnings'"

2. Verify: Confirm description includes trigger phrases

### Task 5: Add MCP tools to investigate skill allowed-tools

**Problem:** `investigate` skill references MCPs but allowed-tools doesn't include them.

1. Edit `.claude/skills/investigate/SKILL.md` line 5:
   - Change from: `allowed-tools: Read, Glob, Grep, Task, Bash`
   - Change to: `allowed-tools: Read, Glob, Grep, Task, Bash, mcp__Railway__*, mcp__gdrive__*, mcp__gemini__*`
   - This allows the skill to use Railway, Google Drive, and Gemini MCP tools without permission prompts

2. Verify: Read the updated file to confirm MCP tools are in allowed-tools

### Task 6: Add context management to plan-review-implementation

**Problem:** Skill can run out of context on large reviews without graceful handling.

1. Edit `.claude/skills/plan-review-implementation/SKILL.md`:
   - Add "Context Management & Continuation" section after "Rules" section
   - Copy the pattern from plan-implement with adjusted heuristics:
     - Each file reviewed: ~1-2% context
     - Each iteration reviewed: ~3-5% context
     - Use same 60% threshold and decision logic
   - Add instruction to stop gracefully and tell user to run `/plan-review-implementation` again

2. Verify: Read the updated file to confirm context management is in place

### Task 7: Clarify investigate vs plan-fix differentiation and add skill chaining

**Problem:** Skills have overlapping evidence gathering but different purposes. Users may choose wrong skill.

1. Edit `.claude/skills/investigate/SKILL.md`:
   - Update description to be more explicit: "Read-only investigation that reports findings WITHOUT creating plans or modifying code"
   - Update Termination section to actively offer skill chaining:
     ```
     If bugs or issues were found that need fixing:
     > "Would you like me to create a fix plan? Say 'yes' or run `/plan-fix` with the context above."
     ```

2. Edit `.claude/skills/plan-fix/SKILL.md`:
   - Update description to be more explicit: "Investigates bugs AND creates actionable TDD fix plans. Use when you know you want to fix something."
   - Add note that this skill can be chained from investigate

3. Verify: Read both files to confirm differentiation is clear

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs (n/a for markdown changes)
2. Run `verifier` agent - Verify all tests pass and build succeeds (after Task 3)
3. Verify all modified files are syntactically correct markdown

---

## Plan Summary

**Objective:** Improve Claude Code agents and skills by fixing a security issue, upgrading model quality, reducing agent count, and improving skill documentation and workflow.

**Source Items:** #1, #2, #3, #4, #5, #6, #7

**Approach:** Fix commit-bot to stage specific files instead of using dangerous `git add -A`. Upgrade pr-creator to sonnet for better analysis quality. Merge test-runner and builder into a single verifier agent to reduce agent count from 5 to 4. Add context management to plan-review-implementation skill. Clarify skill differentiation and add chaining between investigate and plan-fix.

**Scope:**
- Tasks: 7 (with Task 4 handled within Task 3)
- Files affected: 12 (5 agents, 6 skills, CLAUDE.md)
- New tests: no (these are configuration files, not code)

**Key Decisions:**
- Merge test-runner + builder accepts sequential execution trade-off for simpler agent selection
- Add MCP tools to investigate's allowed-tools using wildcard patterns (mcp__Railway__*, mcp__gdrive__*, mcp__gemini__*)
- Skill chaining offers user choice rather than auto-invoking plan-fix

**Dependencies/Prerequisites:**
- Task 4 depends on Task 3 (verifier must exist before adding trigger phrases)
- All other tasks are independent

---

## Iteration 1

**Implemented:** 2026-02-01

### Completed
- Task 1: Updated commit-bot to stage specific files instead of git add -A, added sensitive file filtering
- Task 2: Changed pr-creator model from haiku to sonnet
- Task 3: Created verifier agent by merging test-runner and builder, deleted old agents, updated all references in CLAUDE.md and 5 skill files
- Task 4: Trigger phrases included in verifier agent description (handled within Task 3)
- Task 5: Added MCP wildcard tools (mcp__Railway__*, mcp__gdrive__*, mcp__gemini__*) to investigate skill allowed-tools
- Task 6: Added context management section to plan-review-implementation skill
- Task 7: Updated investigate skill description to emphasize read-only nature, added skill chaining offer when issues found, updated plan-fix description to note it can be chained from investigate

### Files Modified
- `.claude/agents/commit-bot.md` - Replaced git add -A with specific file staging, added sensitive file filtering rule
- `.claude/agents/pr-creator.md` - Changed model to sonnet, added sensitive file filtering for commit step
- `.claude/agents/verifier.md` - New file: merged test-runner and builder functionality
- `.claude/agents/test-runner.md` - Deleted
- `.claude/agents/builder.md` - Deleted
- `CLAUDE.md` - Updated SUBAGENTS table, TDD workflow, Post-Implementation Checklist, Plan Requirements, COMMANDS section, investigate skill description
- `.claude/skills/plan-implement/SKILL.md` - Replaced all test-runner/builder references with verifier
- `.claude/skills/plan-fix/SKILL.md` - Updated post-implementation checklist, updated description for skill chaining
- `.claude/skills/plan-inline/SKILL.md` - Replaced test-runner references with verifier in templates and examples
- `.claude/skills/plan-todo/SKILL.md` - Replaced test-runner references with verifier in templates and examples
- `.claude/skills/investigate/SKILL.md` - Added MCP wildcards to allowed-tools, updated description, added skill chaining termination message
- `.claude/skills/plan-review-implementation/SKILL.md` - Added context management section

### Pre-commit Verification
- bug-hunter: Found 4 issues (2 HIGH, 2 MEDIUM), all fixed before proceeding
- verifier: All 1365 tests pass, zero warnings

### Review Findings

Files reviewed: 12 (markdown configuration files for agents and skills)
Checks applied: Security, Logic, Conventions, Edge Cases

No issues found - all implementations are correct and follow project conventions.

**Summary of verified changes:**
- commit-bot.md: Secure file staging with sensitive file filtering ✓
- pr-creator.md: Model upgrade to sonnet, sensitive file filtering ✓
- verifier.md: Clean merge of test-runner and builder ✓
- investigate/SKILL.md: MCP wildcards and skill chaining ✓
- plan-fix/SKILL.md: Updated description for chaining ✓
- plan-implement/SKILL.md: verifier references updated ✓
- plan-inline/SKILL.md: verifier references updated ✓
- plan-todo/SKILL.md: verifier references updated ✓
- plan-review-implementation/SKILL.md: Context management added ✓
- CLAUDE.md: All references updated ✓

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
