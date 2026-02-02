---
name: plan-inline
description: Create TDD implementation plans from direct feature requests. Use when user provides a task description like "add X feature", "create Y function", or "implement Z". Creates Linear issues in Todo state. Faster than plan-todo for ad-hoc requests that don't need backlog tracking.
argument-hint: <task description>
allowed-tools: Read, Edit, Write, Glob, Grep, Task, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
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

Use `plan-inline` instead of `plan-todo` when:
- The user provides a clear feature request or task description directly
- The task doesn't need to go through Linear Backlog first
- Quick planning without backlog management overhead

Use `plan-todo` instead when:
- Working from existing backlog items
- Managing multiple items that should be tracked

## Pre-flight Check

**Before doing anything**, read PLANS.md and check for incomplete work:
- If PLANS.md has content but NO "Status: COMPLETE" at the end → **STOP**
- Tell the user: "PLANS.md has incomplete work. Please review and clear it before planning new items."
- Do not proceed.

If PLANS.md is empty or has "Status: COMPLETE" → proceed with planning.

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

2. **Folder structure** - Look for "FOLDER STRUCTURE" section to understand:
   - Where documents are stored
   - Naming conventions for folders

3. **Project structure** - Look for "STRUCTURE" section to understand:
   - Source code organization
   - Test file locations
   - Where to add new files

4. **Spreadsheet schemas** - Look for "SPREADSHEETS" section or read SPREADSHEET_FORMAT.md

## Workflow

0. **Git pre-flight check** - Ensure on clean main branch (see Git Pre-flight Check section)
1. **Read PLANS.md** - Pre-flight check
2. **Read CLAUDE.md** - Understand TDD workflow, agents, project rules, available MCPs
3. **Parse $ARGUMENTS** - Understand what needs to be implemented
4. **Explore codebase** - Use Glob/Grep/Task to find relevant files and understand patterns
5. **Gather MCP context** - If the task relates to:
   - Document processing → Check Drive files, spreadsheet schemas
   - Deployment → Check service status, recent logs
   - Extraction issues → Check current prompts, test with Gemini MCP
6. **Generate plan** - Create TDD tasks with test-first approach
7. **Write PLANS.md** - Overwrite with new plan
8. **Create Linear issues** - Create issues in Todo state for each task

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

```markdown
# Implementation Plan

**Created:** YYYY-MM-DD
**Source:** Inline request: [Summary of $ARGUMENTS]
**Linear Issues:** [ADVA-123](https://linear.app/...), [ADVA-124](https://linear.app/...)

## Context Gathered

### Codebase Analysis
- **Related files:** [files found through exploration]
- **Existing patterns:** [patterns to follow]
- **Test conventions:** [how tests are structured in this area]

### MCP Context (if applicable)
- **MCPs used:** [which MCPs were consulted]
- **Findings:** [relevant information discovered]

## Original Plan

### Task 1: [Name]
**Linear Issue:** [ADVA-123](https://linear.app/...)

1. Write test in [file].test.ts for [function/scenario]
2. Run verifier (expect fail)
3. Implement [function] in [file].ts
4. Run verifier (expect pass)

### Task 2: [Name]
**Linear Issue:** [ADVA-124](https://linear.app/...)

1. Write test...
2. Run verifier...
3. Implement...
4. Run verifier...

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** [One sentence describing what this plan accomplishes]

**Request:** [Brief paraphrase of the original $ARGUMENTS]

**Linear Issues:** [ADVA-123, ADVA-124, ...]

**Approach:** [2-3 sentences describing the implementation strategy at a high level]

**Scope:**
- Tasks: [count]
- Files affected: [estimated count]
- New tests: [yes/no]

**Key Decisions:**
- [Important architectural or design decision 1]
- [Important decision 2, if any]

**Risks/Considerations:**
- [Any risks or things to watch out for]
```

## Linear Issue Creation

After writing PLANS.md, create a Linear issue for each task:

1. Use `mcp__linear__create_issue` with:
   - `team`: "ADVA Administracion"
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

**Deployment MCPs** - Use when task involves:
- Deployment configuration
- Environment variables
- Service logs for debugging context

**AI/LLM MCPs** - Use when task involves:
- Prompt improvements
- Extraction accuracy
- Testing variations before implementation

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

## CRITICAL: Scope Boundaries

**This skill creates plans. It does NOT implement them.**

1. **NEVER ask to "exit plan mode"** - This skill doesn't use Claude Code's plan mode feature
2. **NEVER implement code** - Your job ends when PLANS.md is written
3. **NEVER ask ambiguous questions** like "should I proceed?" or "ready to continue?"
4. **NEVER start implementing** after writing the plan, even if user says "yes" to something

## Termination

When you finish writing PLANS.md (and creating Linear issues), output the plan summary followed by the completion message:

```
✓ Plan created in PLANS.md
✓ Linear issues created in Todo: ADVA-123, ADVA-124, ...

## Plan Summary

**Objective:** [Copy from PLANS.md summary]

**Request:** [Copy from PLANS.md summary]

**Linear Issues:** [Copy from PLANS.md summary]

**Approach:** [Copy from PLANS.md summary]

**Scope:**
- Tasks: [count]
- Files affected: [estimated count]
- New tests: [yes/no]

**Key Decisions:**
- [List from PLANS.md summary]

**Risks/Considerations:**
- [List from PLANS.md summary]

---

**Suggested next step:** Create a feature branch before implementing:
```bash
git checkout -b <type>/<task-description>
```
Where `<type>` is `feat/`, `fix/`, `refactor/`, etc. based on the task type.

Then run `/plan-implement` to execute this plan.
```

Do not ask follow-up questions. Do not offer to implement. Output the summary and stop.
