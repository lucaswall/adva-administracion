# Implementation Plan

**Created:** 2026-02-02
**Source:** Linear Backlog - All except ADV-42
**Linear Issues:** [ADV-45](https://linear.app/adva-administracion/issue/ADV-45), [ADV-43](https://linear.app/adva-administracion/issue/ADV-43), [ADV-44](https://linear.app/adva-administracion/issue/ADV-44), [ADV-31](https://linear.app/adva-administracion/issue/ADV-31), [ADV-30](https://linear.app/adva-administracion/issue/ADV-30), [ADV-16](https://linear.app/adva-administracion/issue/ADV-16)

## Context Gathered

### Codebase Analysis

**Skill Files to Modify (ADV-43, ADV-44, ADV-45):**
- `.claude/skills/plan-todo/SKILL.md` - Needs pre-flight git check + feature branch suggestion
- `.claude/skills/plan-fix/SKILL.md` - Needs pre-flight git check + feature branch suggestion
- `.claude/skills/plan-inline/SKILL.md` - Needs pre-flight git check + feature branch suggestion
- `.claude/skills/plan-implement/SKILL.md` - Iteration/review flow fix (ADV-45)
- `.claude/skills/plan-review-implementation/SKILL.md` - Review iteration detection fix (ADV-45)

**Source Files to Modify (ADV-31, ADV-30, ADV-16):**
- `src/config.ts` - Numeric env var validation (lines 153, 195-197, 200)
- `src/config.test.ts` - Tests for config validation
- `src/routes/scan.ts` - Schema validation for endpoints (lines 114-122, 142, 196)
- `src/routes/scan.test.ts` - Tests for route validation
- `src/utils/rate-limiter.ts` - Memory cleanup improvements (if needed)
- `src/utils/rate-limiter.test.ts` - Tests for cleanup edge cases

**Existing Patterns:**
- Skills use `disable-model-invocation: true` for side-effect operations
- Skills have "Pre-flight Check" sections for PLANS.md validation
- Fastify schema validation uses JSON Schema syntax
- Config uses `parseInt()`/`parseFloat()` with fallback defaults
- Rate limiter cleanup is already called via cron job every 10 minutes

**Test Conventions:**
- Vitest with describe/it/expect
- Tests colocated with source as `*.test.ts`
- Mock environment variables using `process.env` manipulation

### Investigation Notes

**ADV-16 (Rate limiter memory leak):**
Upon investigation, `cleanupRateLimiter()` IS being called every 10 minutes via the `cleanupJob` cron in `watch-manager.ts`. The issue description says "cleanup never called" but this appears to be outdated. However, the issue may still be valid in edge cases:
1. When watch-manager is not initialized (no webhook URL configured)
2. Keys with empty arrays stay in Map even after `check()` clears their requests

Will verify and add tests or close as already fixed.

**ADV-45 (Plan review iteration confusion):**
The issue is that `plan-review-implementation` may not correctly identify which iterations need review. Looking at the SKILL.md files:
- `plan-implement` writes `### Tasks Remaining` when stopping mid-plan
- `plan-review-implementation` checks for `<!-- REVIEW COMPLETE -->` marker
- The confusion may be in the detection logic for "partial iteration"

---

## Original Plan

### Task 1: Add git branch pre-flight check to plan-todo
**Linear Issue:** [ADV-44](https://linear.app/adva-administracion/issue/ADV-44)

Add a new "Git Pre-flight Check" section to plan-todo SKILL.md that runs before PLANS.md check:

1. Read `.claude/skills/plan-todo/SKILL.md`
2. Add "Git Pre-flight Check" section BEFORE "Pre-flight Check" with these rules:
   - Check if on main/master branch: `git branch --show-current`
   - Check if branch is up-to-date: `git status -uno` (no upstream changes)
   - If not on main → STOP with warning: "Not on main branch. Please switch to main before planning."
   - If main has unpushed commits → STOP with warning: "Main branch has uncommitted changes. Please commit or stash them first."
3. Update workflow list to include the git check as step 0

### Task 2: Add git branch pre-flight check to plan-fix
**Linear Issue:** [ADV-44](https://linear.app/adva-administracion/issue/ADV-44)

Add the same git pre-flight check to plan-fix SKILL.md:

1. Read `.claude/skills/plan-fix/SKILL.md`
2. Add "Git Pre-flight Check" section BEFORE "Pre-flight Check" with identical rules to Task 1
3. Update workflow list to include the git check as step 0

### Task 3: Add git branch pre-flight check to plan-inline
**Linear Issue:** [ADV-44](https://linear.app/adva-administracion/issue/ADV-44)

Add the same git pre-flight check to plan-inline SKILL.md:

1. Read `.claude/skills/plan-inline/SKILL.md`
2. Add "Git Pre-flight Check" section BEFORE "Pre-flight Check" with identical rules to Tasks 1-2
3. Update workflow list to include the git check as step 0

### Task 4: Add feature branch suggestion to plan-todo
**Linear Issue:** [ADV-43](https://linear.app/adva-administracion/issue/ADV-43)

Modify plan-todo termination section to suggest creating a feature branch:

1. Read `.claude/skills/plan-todo/SKILL.md`
2. Update the "Termination" section to add branch creation suggestion after the plan summary:
   ```
   ---

   **Suggested next step:** Create a feature branch before implementing:
   ```bash
   git checkout -b feat/<plan-description>
   ```
   Then run `plan-implement` to execute this plan.
   ```
3. The branch name should be derived from the plan objective (e.g., `feat/fix-backlog-bugs`, `feat/add-validation`)

### Task 5: Add feature branch suggestion to plan-fix
**Linear Issue:** [ADV-43](https://linear.app/adva-administracion/issue/ADV-43)

Add the same feature branch suggestion to plan-fix SKILL.md:

1. Read `.claude/skills/plan-fix/SKILL.md`
2. Update the "Termination" section with the same branch creation suggestion
3. Branch prefix should be `fix/` for bug fixes (aligns with conventional commits)

### Task 6: Add feature branch suggestion to plan-inline
**Linear Issue:** [ADV-43](https://linear.app/adva-administracion/issue/ADV-43)

Add the same feature branch suggestion to plan-inline SKILL.md:

1. Read `.claude/skills/plan-inline/SKILL.md`
2. Update the "Termination" section with the same branch creation suggestion
3. Branch prefix should be inferred from task type (feat/, fix/, refactor/, etc.)

### Task 7: Fix iteration completion detection in plan-review-implementation
**Linear Issue:** [ADV-45](https://linear.app/adva-administracion/issue/ADV-45)

Clarify the iteration detection logic in plan-review-implementation:

1. Read `.claude/skills/plan-review-implementation/SKILL.md`
2. Review and update "Identify What to Review" section:
   - An iteration is COMPLETE and ready for review when it has:
     - "Tasks Completed This Iteration" section
     - NO `### Tasks Remaining` section (meaning all tasks done OR this is a partial stop)
     - No `<!-- REVIEW COMPLETE -->` marker yet
   - An iteration is PARTIAL (not ready for review) when:
     - It has `### Tasks Remaining` with items still listed
     - OR `### Continuation Status` says "Context running low" with pending tasks
3. Clarify that when `### Tasks Remaining` exists, the iteration is NOT ready for review - user should run `plan-implement` first
4. Add explicit examples of complete vs partial iteration detection

### Task 8: Clarify iteration report format in plan-implement
**Linear Issue:** [ADV-45](https://linear.app/adva-administracion/issue/ADV-45)

Ensure plan-implement iteration reports are unambiguous:

1. Read `.claude/skills/plan-implement/SKILL.md`
2. Review the "Document Results" section
3. Ensure iteration block format clearly indicates status:
   - When ALL tasks complete: `### Continuation Status` says "All tasks completed. Ready for review."
   - When stopping early: `### Continuation Status` says "Context running low (~X% remaining). Run `/plan-implement` to continue with Task N."
4. The `### Tasks Remaining` section should ONLY appear when stopping early, not when complete
5. Add note: "If no tasks remain, omit the `### Tasks Remaining` section entirely"

### Task 9: Add numeric bounds validation to loadConfig
**Linear Issue:** [ADV-31](https://linear.app/adva-administracion/issue/ADV-31)

1. Write test in `src/config.test.ts` for numeric validation:
   - Test PORT validation: negative → throw, >65535 → throw, NaN → throw, valid → pass
   - Test MATCH_DAYS_BEFORE/AFTER: negative → throw, NaN → throw, valid → pass
   - Test GEMINI_RPM_LIMIT: negative → throw, zero → throw, NaN → throw, valid → pass
   - Test USD_ARS_TOLERANCE_PERCENT: negative → throw, NaN → throw, valid → pass
2. Run verifier with pattern `config` (expect fail)
3. Implement validation in `src/config.ts` loadConfig():
   - Add helper: `function validateNumericEnv(name: string, value: number, min?: number, max?: number): void`
   - Validate PORT: 1-65535, throw if invalid
   - Validate MATCH_DAYS_BEFORE/AFTER: ≥0, throw if negative or NaN
   - Validate GEMINI_RPM_LIMIT: ≥1, throw if invalid
   - Validate USD_ARS_TOLERANCE_PERCENT: ≥0, throw if negative or NaN
4. Run verifier with pattern `config` (expect pass)

### Task 10: Add Fastify schema validation to scan routes
**Linear Issue:** [ADV-30](https://linear.app/adva-administracion/issue/ADV-30)

1. Write test in `src/routes/scan.test.ts` for schema validation:
   - Test `/rematch` rejects invalid `documentType` values
   - Test `/autofill-bank` rejects non-string `bankName`
   - Test `/match-movimientos` validates `force` query parameter (must be "true" or omitted)
2. Run verifier with pattern `scan` (expect fail)
3. Fix in `src/routes/scan.ts`:
   - Add schema to `/rematch`: `documentType: { type: 'string', enum: ['factura', 'recibo', 'all'] }`
   - Add schema to `/autofill-bank`: `bankName: { type: 'string' }`
   - Add querystring schema to `/match-movimientos`: `force: { type: 'string', enum: ['true'] }`
4. Run verifier with pattern `scan` (expect pass)

### Task 11: Verify and document rate limiter cleanup mechanism
**Linear Issue:** [ADV-16](https://linear.app/adva-administracion/issue/ADV-16)

Investigation revealed cleanup IS called via cron. Verify edge cases and add tests:

1. Write test in `src/utils/rate-limiter.test.ts`:
   - Test cleanup removes keys with all-expired entries
   - Test cleanup is idempotent (calling twice doesn't break anything)
   - Test cleanup preserves keys with active requests
   - Test check() doesn't leave empty arrays in requestLog
2. Run verifier with pattern `rate-limiter` (expect pass - likely already working)
3. If any tests fail, fix the issue:
   - Ensure `check()` removes empty arrays after filtering (line 68-69)
   - Or update cleanup() to be called from check() when array becomes empty
4. Add JSDoc comment documenting that cleanup is called via watch-manager cron job
5. Run verifier with pattern `rate-limiter` (expect pass)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Improve skill workflow robustness (git checks, branch suggestions, iteration detection) and add defensive validation to configuration and route schemas.

**Linear Issues:** ADV-45, ADV-43, ADV-44, ADV-31, ADV-30, ADV-16

**Approach:**
- Update plan-* skills with git pre-flight checks to ensure clean main branch before planning
- Add feature branch suggestions to termination output for better git workflow
- Clarify iteration detection logic to prevent review confusion
- Add numeric bounds validation to config loading
- Add Fastify JSON schema validation to scan routes
- Verify and document rate limiter cleanup (already implemented via cron)

**Scope:**
- Tasks: 11
- Files affected: 8 (5 skills, 2 source files + tests)
- New tests: yes (config validation, route schema validation, rate limiter edge cases)

**Key Decisions:**
- Git pre-flight runs BEFORE PLANS.md check (can't plan if not on clean main)
- Branch suggestion is advisory (user can skip and implement directly)
- Iteration "ready for review" = has completed tasks AND no "Tasks Remaining" section
- Config validation throws on invalid values (fail fast vs silent defaults)
- Rate limiter cleanup already works via cron - just add edge case tests

**Dependencies/Prerequisites:**
- Tasks 1-3 (git pre-flight) are independent and can be done in parallel
- Tasks 4-6 (branch suggestion) are independent and can be done in parallel
- Tasks 7-8 (iteration fix) should be done together to ensure consistency
- Tasks 9-11 (source code) follow TDD and are independent
