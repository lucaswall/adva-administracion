# Implementation Plan

**Created:** 2026-02-01
**Source:** Linear Backlog - Urgent Priority Issues
**Linear Issues:** [ADV-38](https://linear.app/adva-administracion/issue/ADV-38), [ADV-39](https://linear.app/adva-administracion/issue/ADV-39), [ADV-40](https://linear.app/adva-administracion/issue/ADV-40), [ADV-41](https://linear.app/adva-administracion/issue/ADV-41)

## Context Gathered

### Codebase Analysis

**Agent Files:**
- `.claude/agents/verifier.md` - Currently uses haiku model, runs `npm test` then `npm run build`
- `.claude/agents/commit-bot.md` - Currently uses haiku model, creates git commits

**Skill Files:**
- `.claude/skills/plan-implement/SKILL.md` - Evaluates context after each task with 40% threshold, runs bug-hunter and verifier before stopping
- `.claude/skills/plan-review-implementation/SKILL.md` - Reviews iterations with 60% threshold, suggests PR after complete

**Reference Files:**
- `.claude/skills/tools-improve/SKILL.md` - Best practices for modifying agents/skills
- `.claude/skills/tools-improve/subagents-reference.md` - Model selection: haiku (fast, cheap), sonnet (balanced), opus (complex)

### Key Patterns Observed

1. **Subagent frontmatter fields:** `name`, `description`, `tools`, `model`, `permissionMode`
2. **Skill context management:** Uses rough heuristics to estimate remaining context (% based)
3. **Model selection:** haiku for fast tasks, sonnet for balanced, opus for complex
4. **Skill termination:** Skills output completion message and suggest next action

---

## Original Plan

### Task 1: Add TDD mode to verifier agent
**Linear Issue:** [ADV-38](https://linear.app/adva-administracion/issue/ADV-38)

**Problem:** Verifier agent always runs full test suite + build, wasting time during TDD cycles when only one test needs to run.

**Solution:** Add prompt parameter support to verifier agent to allow specifying:
- Single test: `verifier "src/utils/validation.test.ts"`
- Pattern match: `verifier "parser"` (runs tests matching pattern)
- Full run: `verifier` (default, runs all + build)

1. Read current verifier agent: `.claude/agents/verifier.md`
2. Modify verifier agent prompt to accept optional test specifier argument
3. Update workflow to conditionally run:
   - If argument provided → `npm test -- --testPathPattern=<arg>` (skip build)
   - If no argument → `npm test` then `npm run build` (current behavior)
4. Update output format to indicate mode (TDD vs Full)
5. Update CLAUDE.md to document the new verifier modes

### Task 2: Change commit-bot to use Sonnet model
**Linear Issue:** [ADV-39](https://linear.app/adva-administracion/issue/ADV-39)

**Problem:** commit-bot uses haiku which may produce lower quality commit messages.

**Solution:** Change model field from haiku to sonnet for better commit message quality.

1. Read current commit-bot agent: `.claude/agents/commit-bot.md`
2. Change `model: haiku` to `model: sonnet` in frontmatter
3. Verify no other changes needed

### Task 3: Add context check to plan-review-implementation skill
**Linear Issue:** [ADV-40](https://linear.app/adva-administracion/issue/ADV-40)

**Problem:** plan-review-implementation skill checks context but should stop at iteration boundaries (not mid-iteration) using same criteria as plan-implement.

**Solution:** Update the "Context Management & Continuation" section to:
- Check context at END of each iteration review (not mid-iteration)
- Use same decision logic as plan-implement (currently 60%, matches the skill)
- Add explicit instruction to complete current iteration before stopping

1. Read current skill: `.claude/skills/plan-review-implementation/SKILL.md`
2. Update "Context Management & Continuation" section to clarify:
   - Context check happens AFTER completing each iteration's review
   - Must complete current iteration review before stopping (no partial reviews)
   - Same heuristics already in place (60% threshold is appropriate for read-heavy work)
3. Add explicit note about not stopping mid-iteration

### Task 4: Add commit/PR suggestion to plan-review-implementation skill
**Linear Issue:** [ADV-41](https://linear.app/adva-administracion/issue/ADV-41)

**Problem:** After completing iteration review, the skill should suggest next action:
- If iteration review done but more iterations remain → suggest commit
- If full plan review complete → suggest create PR

**Solution:** Update termination section to add appropriate suggestions.

1. Read current skill: `.claude/skills/plan-review-implementation/SKILL.md`
2. Update "After ALL Iterations Reviewed" section to:
   - If stopping due to context limits with more iterations remaining → suggest commit
   - If all iterations reviewed and all passed → suggest PR (already exists)
   - If all iterations reviewed but fix plan created → inform user to run plan-implement (no commit yet)
3. Add new "When Stopping Mid-Plan" section for partial review completion

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Improve Claude Code subagents and skills for better TDD workflow efficiency, commit quality, and clearer continuation guidance.

**Linear Issues:** ADV-38, ADV-39, ADV-40, ADV-41

**Approach:**
- Tasks 1-2: Modify subagent markdown files (verifier, commit-bot)
- Tasks 3-4: Modify plan-review-implementation skill for better context management and user guidance
- No code changes to src/ - all changes in .claude/ directory

**Scope:**
- Tasks: 4
- Files affected: 3 (verifier.md, commit-bot.md, plan-review-implementation/SKILL.md) + CLAUDE.md update
- New tests: No (these are configuration/prompt files, not code)

**Key Decisions:**
- Verifier TDD mode uses Vitest's `--testPathPattern` flag for filtering
- 60% context threshold for plan-review-implementation is kept (appropriate for read-heavy work)
- Commit suggestion added for partial review completion (helps preserve work)
- PR suggestion only when all reviews pass (existing behavior enhanced)

**Dependencies/Prerequisites:**
- None - these are independent configuration changes

---

## Iteration 1

**Implemented:** 2026-02-01

### Tasks Completed This Iteration
- Task 1: Add TDD mode to verifier agent - Added prompt parameter support for filtered test runs (TDD mode) vs full run (all tests + build)
- Task 2: Change commit-bot to use Sonnet model - Updated model field from haiku to sonnet
- Task 3: Add context check to plan-review-implementation skill - Clarified context checking at iteration boundaries, never mid-review
- Task 4: Add commit/PR suggestion to plan-review-implementation skill - Added "When Stopping Due to Context Limits" section with commit suggestion

### Tasks Remaining
None - all tasks completed.

### Files Modified
- `.claude/agents/verifier.md` - Added TDD mode with `--testPathPattern` support, restructured output format by mode
- `.claude/agents/commit-bot.md` - Changed model from haiku to sonnet
- `.claude/skills/plan-review-implementation/SKILL.md` - Added context check clarity and commit suggestion sections
- `CLAUDE.md` - Updated verifier usage docs and commit-bot model reference

### Linear Updates
- ADV-38: Todo → In Progress → Review
- ADV-39: Todo → In Progress → Review
- ADV-40: Todo → In Progress → Review
- ADV-41: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed - no bugs found
- verifier: All tests pass, zero warnings

### Continuation Status
All tasks completed. Ready for review.

### Review Findings

Files reviewed: 4
- `.claude/agents/verifier.md` - TDD mode implementation
- `.claude/agents/commit-bot.md` - Model change
- `.claude/skills/plan-review-implementation/SKILL.md` - Context management updates
- `CLAUDE.md` - Documentation updates

Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

**Review Summary:**
- Verifier TDD mode correctly uses Vitest's `--testPathPattern` flag
- commit-bot model correctly updated from haiku to sonnet
- Context boundary checking is clear and well-documented
- 60% threshold appropriate for read-heavy review work
- Commit suggestion for partial completion properly added
- CLAUDE.md documentation consistent with all implementations

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- ADV-38: Review → Done
- ADV-39: Review → Done
- ADV-40: Review → Done
- ADV-41: Review → Done

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Done.
Ready for human review.
