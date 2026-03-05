---
name: plan-inline
description: Create TDD implementation plans from direct feature requests. Use when user provides a task description like "add X feature", "create Y function", or "implement Z". Creates Linear issues in Todo state. Faster than plan-backlog for ad-hoc requests that don't need backlog tracking.
argument-hint: <task description>
allowed-tools: Read, Edit, Write, Glob, Grep, Task, Bash, mcp__linear__list_teams, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Create a TDD implementation plan directly from inline instructions in $ARGUMENTS. Creates Linear issues in Todo state.

## Git Pre-flight Check

**Before doing anything else**, verify git state:

1. Check current branch: `git branch --show-current`
2. If NOT on `main` or `master`:
   - **STOP** with message: "Not on main branch. Please switch to main before planning: `git checkout main`"
3. Check for uncommitted changes: `git status --porcelain`
4. If there are uncommitted changes:
   - **STOP** with message: "Main branch has uncommitted changes. Please commit or stash them first."
5. Check if branch is up-to-date with remote: `git fetch origin && git status -uno`
6. If behind remote:
   - **STOP** with message: "Main branch is behind remote. Please pull latest: `git pull origin main`"

Only proceed to PLANS.md check if git state is clean.

## Purpose

- Convert inline task descriptions into actionable TDD implementation plans
- Create Linear issues in Todo state for each task (bypasses Backlog)
- Explore codebase to understand existing patterns and find relevant files
- Use MCPs to gather additional context (Drive files, spreadsheets, deployments)
- Generate detailed, implementable plans with full file paths and Linear issue links

## When to Use

Use `plan-inline` instead of `plan-backlog` when:
- The user provides a clear feature request or task description directly
- The task doesn't need to go through Linear Backlog first
- Quick planning without backlog management overhead

Use `plan-backlog` instead when:
- Working from existing backlog items
- Managing multiple items that should be tracked

## Pre-flight Check

**Before doing anything**, read PLANS.md and check for incomplete work:
- If PLANS.md has content but NO "Status: COMPLETE" at the end → **STOP**
- Tell the user: "PLANS.md has incomplete work. Please review and clear it before planning new items."
- Do not proceed.

If PLANS.md is empty or has "Status: COMPLETE" → proceed with planning.

**Verify Linear MCP:** Call `mcp__linear__list_teams`. If unavailable, **STOP** and tell the user: "Linear MCP is not connected. Run `/mcp` to reconnect, then re-run this skill."

## Arguments

$ARGUMENTS should contain the task description with context:
- What to implement or change
- Expected behavior
- Any constraints or requirements
- Related files if known

Example arguments:
- `Add a function to validate CUIT numbers with modulo 11 algorithm`
- `Create a new route /api/retry that retries failed documents`
- `Update resumen_tarjeta extraction to handle Naranja card format`

## Context Gathering

**IMPORTANT: Do NOT hardcode MCP names or folder paths.** Always read CLAUDE.md to discover:

1. **Available MCP servers** - Look for the "MCP SERVERS" section to find:
   - Google Drive MCP for file access (`gdrive_search`, `gdrive_read_file`, `gsheets_read`, etc.)
   - Railway MCP for deployment context (`get-logs`, `list-deployments`, `list-services`, `list-variables`)
   - Gemini MCP for prompt testing (`gemini_analyze_pdf`)
   - Linear MCP for issue tracking (`list_issues`, `get_issue`, `create_issue`, etc.)

2. **Project structure** - Look for "STRUCTURE" section to understand:
   - Source code organization
   - Test file locations
   - Where to add new files

3. **Folder structure** - Look for "FOLDER STRUCTURE" section to understand:
   - Where documents are stored
   - Naming conventions for folders

4. **Spreadsheet schemas** - Look for "SPREADSHEETS" section or read SPREADSHEET_FORMAT.md

## Workflow

0. **Git pre-flight check** - Ensure on clean main branch (see Git Pre-flight Check section)
1. **Read PLANS.md** - Pre-flight check
2. **Read CLAUDE.md** - Understand TDD workflow, agents, project rules, available MCPs, discover team name
3. **Parse $ARGUMENTS** - Understand what needs to be implemented
4. **Explore codebase** - Use Glob/Grep/Task to find relevant files and understand patterns
5. **Gather MCP context** - If the task relates to:
   - Document processing → Check Drive files, spreadsheet schemas
   - Deployment → Check service status, recent logs
   - Extraction issues → Check current prompts, test with Gemini MCP
   - Existing issues → Check Linear for related issues or context
6. **Generate plan** - Create TDD tasks with test-first approach
7. **Write PLANS.md** - Overwrite with new plan
8. **Validate plan against CLAUDE.md** - Re-read CLAUDE.md and cross-check each task for missing defensive specs: error handling on external calls, timeout values for Gemini and Google API calls, rate limit handling, edge cases (empty input, null values, partial results). Verify Result<T,E> pattern is used for all fallible operations. Fix any gaps before proceeding.
9. **Cross-cutting requirements sweep** - Scan the entire plan for the patterns below. If a pattern appears in any task, verify the corresponding specification exists in that task's steps. If missing, add it before finalizing the plan.

   | Pattern Detected in Plan | Required Specification |
   |--------------------------|----------------------|
   | Gemini API calls or external HTTP requests | Timeout value and error handling behavior (including JSON parse errors and transient failures) |
   | Google API calls (Drive, Sheets) | Timeout value and rate limit handling |
   | Error messages exposed in API responses | Sanitization — generic message in response body, raw error logged with Pino only |
   | Async operations triggered by HTTP requests | Concurrency guard — lock acquisition or queue check before starting |
   | Write operations to spreadsheets or Drive | Atomicity semantics — what happens if the write fails mid-way |
   | Repeated scan or match triggers | Idempotency check or deduplication guard |
10. **Create Linear issues** - Create issues in Todo state for each task

## Codebase Exploration Guidelines

**When to explore:**
- Always explore to find existing patterns before creating new code
- Find related tests to understand testing conventions
- Locate where similar functionality already exists

**How to explore:**
- Use Glob for finding files by pattern: `src/**/*.ts`, `**/*.test.ts`
- Use Grep for finding code: function names, type definitions, error messages
- Use Task with `subagent_type=Explore` for broader questions about the codebase

**What to discover:**
- Existing functions that could be reused or extended
- Test file conventions and patterns
- Type definitions to reuse
- Similar implementations to follow as templates

## PLANS.md Structure

Read `references/plans-template.md` for the complete template.

**Source field:** `Inline request: [Summary of $ARGUMENTS]`

Include: Context Gathered (Codebase Analysis + MCP Context), Tasks, Post-Implementation Checklist, Plan Summary.
Omit: Investigation subsection, Triage Results subsection.

## Discovering Team Context

Read CLAUDE.md to find the LINEAR INTEGRATION section. Look for:
- **Team name** (e.g., "Team: 'ProjectName'")
- **Issue prefix** (e.g., "Prefix: PROJ-xxx")
- **State workflow** (e.g., "States: Backlog → Todo → In Progress → Review → Done")
- **Project-specific URLs** (Linear workspace URL, etc.)

If CLAUDE.md doesn't have a LINEAR INTEGRATION section, call `mcp__linear__list_teams` to discover the team name dynamically.

Store the discovered team name in a variable for use throughout the skill.

## Linear Issue Creation

After writing PLANS.md, create a Linear issue for each task:

1. Use `mcp__linear__create_issue` with:
   - `team`: [Discovered team name from CLAUDE.md or `mcp__linear__list_teams`]
   - `title`: Task name
   - `description`: Task details from PLANS.md
   - `state`: "Todo"
   - `labels`: Infer from task type (Feature, Improvement, Bug)

2. Update PLANS.md to add `**Linear Issue:** [ADVA-N](url)` to each task

## Task Writing Guidelines

Each task must be:
- **Self-contained** - Full file paths, clear descriptions
- **TDD-compliant** - Test before implementation
- **Specific** - What to test, what to implement
- **Ordered** - Dependencies resolved by task order
- **Context-aware** - Reference patterns and files discovered during exploration

Good task example:
```markdown
### Task 1: Add validateCuit function
1. Write test in src/utils/validation.test.ts for validateCuit
   - Test valid CUIT returns true (use existing test fixtures)
   - Test invalid checksum returns false
   - Test invalid format returns false
   - Follow existing validation function patterns
2. Run verifier (expect fail)
3. Implement validateCuit in src/utils/validation.ts
   - Use modulo 11 algorithm
   - Follow existing function signature patterns
4. Run verifier (expect pass)
```

Bad task example:
```markdown
### Task 1: Add CUIT validation
1. Add function
2. Test it
```

## MCP Usage Guidelines

Discover available MCPs from CLAUDE.md's "MCP SERVERS" section. Common patterns:

**File/Document MCPs** - Use when task involves:
- Document processing or extraction
- Spreadsheet or database changes
- File organization or storage

**Deployment MCPs (Railway)** - Use when task involves:
- Deployment configuration
- Environment variables
- Service logs for debugging context

**AI/LLM MCPs (Gemini)** - Use when task involves:
- Prompt improvements
- Extraction accuracy
- Testing variations before implementation

**Issue Tracking MCPs (Linear)** - Use when task involves:
- Checking existing issues for context
- Understanding related work
- Finding duplicate or related feature requests

If CLAUDE.md doesn't list MCPs, skip MCP context gathering.

## Error Handling

| Situation | Action |
|-----------|--------|
| PLANS.md has incomplete work | Stop and tell user to review/clear PLANS.md first |
| $ARGUMENTS is empty or unclear | Ask user to provide a clearer task description |
| CLAUDE.md doesn't exist | Continue without project-specific rules, use general TDD practices |
| Codebase exploration times out | Continue with partial context, note limitation in plan |
| MCP not available | Skip MCP context gathering, note in plan what was skipped |
| Task too vague to plan | Ask user for specific requirements before proceeding |

## Rules

- **Refuse to proceed if PLANS.md has incomplete work**
- **Explore codebase before planning** - Find patterns to follow
- **Use MCPs when relevant** - Gather context from external systems (discover from CLAUDE.md)
- Every task must follow TDD (test first, then implement)
- No manual verification steps - use agents only
- Tasks must be implementable without additional context
- Always include post-implementation checklist
- Create Linear issues in Todo state (bypasses Backlog)
- Include Linear issue links in PLANS.md tasks
- **Flag migration-relevant tasks** — If a task changes spreadsheet schema, renames columns, changes folder structure, or renames env vars, add a note in the task: "**Migration note:** [what production data is affected and how to migrate]". The plan MUST include a migration strategy (e.g., startup detection of old format + automatic migration). The implementer will log this in `MIGRATIONS.md`.
- **Plans describe WHAT and WHY, not HOW at the code level.** Include: file paths, function names, behavioral specs, test assertions, patterns to follow (reference existing files by path), state transitions. Do NOT include: implementation code blocks, ready-to-paste TypeScript/TSX, full function bodies. The implementer (plan-implement workers) writes all code — your job is architecture and specification. Exception: short one-liners for surgical changes (e.g., "add `if (!session.x)` check after the existing `!session.y` check") are fine.

## CRITICAL: Scope Boundaries

**This skill creates plans. It does NOT implement them.**

1. **NEVER ask to "exit plan mode"** - This skill doesn't use Claude Code's plan mode feature
2. **NEVER implement code** - Your job ends when PLANS.md is written
3. **NEVER ask ambiguous questions** like "should I proceed?" or "ready to continue?"
4. **NEVER start implementing** after writing the plan, even if user says "yes" to something

## Termination

Follow the termination procedure in `references/plans-template.md`: output the Plan Summary, then create branch, commit (no `Co-Authored-By` tags), and push.

Do not ask follow-up questions. Do not offer to implement. Output the summary and stop.
