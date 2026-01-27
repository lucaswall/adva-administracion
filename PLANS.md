# Implementation Plan

**Created:** 2026-01-26
**Source:** Improvement #1 from TODO.md - Create plan-fix skill for bug investigation

## Original Plan

### Task 1: Create plan-fix skill directory and SKILL.md

Create a new skill at `.claude/skills/plan-fix/SKILL.md` that enables investigation of bugs found after file processing. The skill should:

1. Create directory `.claude/skills/plan-fix/`

2. Write SKILL.md with frontmatter:
   - name: `plan-fix`
   - description: `Investigate bugs and create fix plans`
   - argument-hint: `<bug description with context>`
   - allowed-tools: `Read, Edit, Write, Glob, Grep, Task, WebFetch` (needs exploration capabilities + MCPs)
   - disable-model-invocation: `true`

3. Write skill body with these sections:

   **Purpose section:**
   - For investigating bugs discovered after file processing
   - Creates investigation report + fix plan in PLANS.md
   - Does NOT implement fixes (integrates with plan-implement)

   **Pre-flight Check section:**
   - Same as plan-todo: refuse if PLANS.md has incomplete work

   **Arguments section:**
   - Required: Bug description with full context from $ARGUMENTS
   - User provides: what happened, what was expected, file IDs if relevant, error messages

   **Context Gathering section (KEY DIFFERENTIATOR):**
   - Read CLAUDE.md to understand: project structure, available MCP servers, folder hierarchy, document types
   - Dynamically discover MCPs from CLAUDE.md (no hardcoding)
   - Use MCPs to investigate: gdrive_search, gdrive_read_file, gsheets_read, etc.
   - Use Explore agent to understand relevant code paths

   **Investigation Workflow:**
   1. Read PLANS.md - check for incomplete work
   2. Read CLAUDE.md - get MCP list, folder structure, document types
   3. Parse $ARGUMENTS for bug description and context
   4. Investigate using available MCPs and code exploration
   5. Document findings in PLANS.md
   6. Create TDD fix plan for identified issues

   **PLANS.md Structure for bugs:**
   ```markdown
   # Bug Fix Plan

   **Created:** YYYY-MM-DD
   **Bug Report:** [Summary from $ARGUMENTS]

   ## Investigation

   ### Context Gathered
   - Relevant MCPs used: [list]
   - Files examined: [list]
   - Findings: [detailed findings]

   ### Root Cause
   [Explain the root cause]

   ## Fix Plan

   ### Fix 1: [Title]
   1. Write test in [file].test.ts for [scenario that reproduces bug]
   2. Implement fix in [file].ts

   ## Post-Implementation Checklist
   1. Run `bug-hunter` agent - Review changes for bugs
   2. Run `test-runner` agent - Verify all tests pass
   3. Run `builder` agent - Verify zero warnings
   ```

   **Rules section:**
   - Refuse to proceed if PLANS.md has incomplete work
   - Do NOT hardcode MCP names or folder paths - read from CLAUDE.md
   - Investigation only - no code modifications
   - All fixes must follow TDD
   - Include enough detail for another model to implement without context

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Iteration 1

**Implemented:** 2026-01-27

### Completed
- Task 1: Created `.claude/skills/plan-fix/` directory and `SKILL.md`
  - Frontmatter with name, description, argument-hint, allowed-tools (including MCP tools)
  - Pre-flight check section (refuse if PLANS.md has incomplete work)
  - Arguments section (bug description with context)
  - Context Gathering section (read CLAUDE.md for MCPs, folder structure, document types)
  - Investigation Workflow (6 steps)
  - PLANS.md Structure for bug fix plans
  - Rules section

### Bug-hunter Findings (First Run)
- MCP tools not in allowed-tools → Fixed: added gdrive_search, gdrive_read_file, gdrive_list_folder, gdrive_get_pdf, gsheets_read
- Invalid Explore subagent syntax → Fixed: clarified to use Task tool with subagent_type=Explore
- WebFetch included but not documented → Fixed: removed from allowed-tools

### Bug-hunter Findings (Second Run)
- No bugs found

### Checklist Results
- bug-hunter: Passed (after fixes)
- test-runner: Passed (389 tests, 0 failures)
- builder: Passed (zero warnings)

### Review Findings
None - all implementations correct.

---

## Status: COMPLETE

All tasks and fixes implemented successfully. Ready for human review.
