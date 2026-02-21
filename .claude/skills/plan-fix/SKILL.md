---
name: plan-fix
description: Investigates bugs AND creates actionable TDD fix plans. Creates Linear issues in Todo state. Use when you know you want to fix something - user reports extraction errors, deployment failures, wrong data, missing matches, or prompt issues. Can be chained from investigate skill. Discovers MCPs from CLAUDE.md for debugging (logs, files, prompts).
argument-hint: <bug description>
allowed-tools: Read, Edit, Write, Glob, Grep, Task, Bash, mcp__linear__list_teams, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Investigate bugs and create TDD fix plans in PLANS.md. Creates Linear issues in Todo state.

## 1. Git Pre-flight Check

Before starting any investigation, verify git status:

```bash
git branch --show-current
git status --porcelain
```

- **STOP if NOT on `main` branch.** Tell the user: "Not on main branch. Please switch to main before planning: `git checkout main`"
- **STOP if there are uncommitted changes.** Tell the user to commit or stash first.
- **Check if behind remote:** `git fetch origin && git status -uno` — STOP if behind.

## 2. PLANS.md Pre-flight

Check if `PLANS.md` already exists at the project root:

- If it does not exist: OK, you will create it when documenting findings.
- If it exists with `Status: COMPLETE`: OK, overwrite with new fix plan.
- If it exists with active (non-COMPLETE) content: **STOP.** Tell the user there is an active plan that must be completed or removed first.
- In all cases, check for an existing section about this bug to avoid duplicates.

## 3. Verify Linear MCP

Call `mcp__linear__list_teams`. If unavailable, **STOP** and tell the user: "Linear MCP is not connected. Run `/mcp` to reconnect, then re-run this skill."

## 4. Read Project Context

Read `CLAUDE.md` at the project root (if it exists) to understand:
- Project structure and conventions
- Available MCPs (Linear, Railway, Google Drive, Gemini, etc.)
- Tech stack details
- Testing conventions
- Any project-specific debugging notes

## 5. Classify Bug Type

Categorize the reported issue into one of these types:

| Category | Description | Key Investigation Areas |
|----------|-------------|------------------------|
| **Extraction** | Wrong data extracted, missing fields, null values | Prompts, Google Drive MCP, Gemini MCP, Codebase |
| **Deployment** | Build errors, runtime crashes on Railway | Build logs, environment variables, dependency issues |
| **Matching** | Wrong matches, missing matches, unexpected links | Google Drive MCP, Codebase |
| **Storage** | Data not saved, wrong spreadsheet, missing records | Google Drive MCP, Codebase |
| **Prompt** | Consistent extraction errors on specific doc types | Gemini MCP, current prompts |
| **API Error** | Backend route failures, 500s, bad responses | Route handlers, middleware, error handling |
| **Data Issue** | Wrong data, missing data, data corruption | Database queries, API transformations, caching |
| **Frontend Bug** | UI rendering issues, broken interactions | React components, state management, data fetching |

## 6. Gather Evidence

### 6.1 Codebase Investigation

Search the codebase for relevant code:

Use Glob and Grep tools to:
- Find the files involved in the bug
- Trace the code path from entry point to the error
- Look for recent changes that might have introduced the bug
- Check test files for related test coverage

### 6.2 Deployment Logs (if MCP available)

If CLAUDE.md lists deployment MCPs (e.g., Railway MCP) and the bug involves deployment or runtime errors, use the MCP to check logs:

- Check recent deployment status
- Look for error logs around the time of the reported issue
- Check environment variable configuration (without exposing values)
- Review build logs for warnings or errors

### 6.3 Document/File Issues (if file MCPs available)

- Search for the problematic file using Google Drive MCP
- Read file contents
- Check related data stores (spreadsheets, databases)

### 6.4 Linear Context

Search Linear for related issues:

- Use `mcp__linear__list_issues` to find existing issues about this bug
- Check if there are related issues that provide context
- Look for previously attempted fixes

### 6.5 Reproduce the Issue

When possible, try to reproduce:

```bash
# Check if tests exist and if they catch the issue
npm test 2>&1 | tail -50

# Check for TypeScript errors
npx tsc --noEmit 2>&1 | tail -50

# Check for lint errors
npm run lint 2>&1 | tail -50
```

## 7. Document Findings in PLANS.md

Write or append to `PLANS.md` at the project root with this structure:

```markdown
# Bug Fix Plan

**Created:** YYYY-MM-DD
**Bug Report:** [Summary from $ARGUMENTS]
**Category:** [Extraction | Deployment | Matching | Storage | Prompt | API Error | Data Issue | Frontend Bug]
**Linear Issues:** [ADVA-123](https://linear.app/...), [ADVA-124](https://linear.app/...)

## Investigation

### Context Gathered
- **MCPs used:** [list which MCPs were used and why]
- **Files examined:** [list files checked - Drive files, spreadsheets, code files, logs]

### Evidence
[Detailed findings from investigation with specific data points]

### Root Cause
[Clear explanation of why the bug occurs]

#### Related Code
- `path/to/file.ts:lineNumber` — [describe what this code does and why it's problematic]
- `path/to/other-file.ts:lineNumber` — [describe the related code]
(Reference files and line numbers. Do NOT paste code blocks — the implementer will read the files.)

### Impact
- [What breaks because of this bug]
- [Who is affected]
- [Any data implications]

## Fix Plan

### Fix 1: [Title matching the issue]
**Linear Issue:** [ADVA-123](https://linear.app/...)

1. Write test in [file].test.ts for [scenario that reproduces the bug]
2. Implement fix in [file].ts

### Fix 2: [Title]
**Linear Issue:** [ADVA-124](https://linear.app/...)
...

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Problem:** [One sentence describing the bug/issue]

**Root Cause:** [One sentence explaining why it happens]

**Linear Issues:** [ADVA-123, ADVA-124, ...]

**Solution Approach:** [2-3 sentences describing the fix strategy at a high level]

**Scope:**
- Files affected: [count]
- New tests: [yes/no]
- Breaking changes: [yes/no]

**Risks/Considerations:**
- [Key risk or consideration 1]
- [Key risk or consideration 2, if any]
```

## 8. Create Linear Issue

Create a Linear issue for each fix:

1. Use `mcp__linear__create_issue` with:
   - `team`: "ADVA Administracion"
   - `title`: Fix description
   - `description`: Root cause and fix details
   - `state`: "Todo"
   - `labels`: Bug (or Security if security-related)

2. Update PLANS.md to add `**Linear Issue:** [ADVA-N](url)` to each fix task

## Prompt/AI Testing Guidelines

When investigating AI/LLM extraction issues:

1. **Get the problematic input** using file/document MCPs
2. **Read current prompt** from the project's prompts file (find via codebase exploration)
3. **Test variations** using AI MCPs if available
4. **Document what works** - Include the improved prompt in the fix plan
5. **Note:** Testing MCPs are for debugging, not production use

Example prompt testing workflow:
```
1. Current prompt extracts field X as null
2. Test prompt variation A: More explicit field description
3. Test prompt variation B: Add context about document layout
4. Variation B correctly extracts the field
5. Add to fix plan: Update prompts file with variation B
```

## Deployment Debugging Guidelines

When investigating deployment issues (if deployment MCPs available):

1. **Check status first** - Verify MCP/CLI access
2. **List recent deployments** - Get deployment IDs and statuses
3. **Get targeted logs** - Search for errors using filters:
   - Error-level logs
   - Specific error types or messages
4. **Check environment** - Verify configuration variables

## 9. Error Handling

| Situation | Action |
|-----------|--------|
| PLANS.md has incomplete work | Stop and tell user to review/clear PLANS.md first |
| $ARGUMENTS lacks bug description | Ask user to describe what happened vs expected |
| CLAUDE.md doesn't exist | Continue with codebase-only investigation |
| MCP not available | Skip that MCP, note in investigation what couldn't be checked |
| File/resource not found | Document as part of investigation (may be the bug) |
| Cannot reproduce issue | Document investigation steps taken, ask user for more context |
| Root cause unclear | Document possible causes ranked by likelihood |
| Existing fix in progress | Check the existing Linear issue and PLANS.md entry, update rather than duplicate |
| Bug is actually a feature request | Reclassify and suggest using add-to-backlog skill instead |

## 10. Rules

- **NEVER modify application code.** This skill only investigates and plans.
- **NEVER run destructive commands** (no `rm`, no `git reset --hard`, no database mutations).
- **ALWAYS use TDD approach** in fix plans - tests first, then implementation.
- **ALWAYS check for existing Linear issues** before creating new ones to avoid duplicates.
- **ALWAYS include file paths and line numbers** in evidence and fix plans.
- **ALWAYS propose a branch name** following the pattern `fix/ADVA-xxx-brief-description`.
- **Discover MCPs from CLAUDE.md** - don't hardcode MCP names or paths
- **Keep fix plans actionable** - another developer (or AI agent) should be able to follow the plan without additional context.
- **Severity guidelines:**
  - **Critical:** Production down, data loss, security vulnerability
  - **High:** Feature broken for all users, significant data issues
  - **Medium:** Feature partially broken, workaround exists
  - **Low:** Minor UI issue, edge case, cosmetic problem
- **DO NOT expose secrets, API keys, or sensitive environment variable values** in PLANS.md or Linear issues.
- **DO NOT hallucinate code** - only reference code that actually exists in the codebase.
- **Plans describe WHAT and WHY, not HOW at the code level.** Include: file paths, function names, behavioral specs, test assertions, patterns to follow (reference existing files by path), state transitions. Do NOT include: implementation code blocks, ready-to-paste TypeScript/TSX, full function bodies. The implementer (plan-implement workers) writes all code — your job is architecture and specification. Exception: short one-liners for surgical changes (e.g., "add `if (!session.x)` check after the existing `!session.y` check") are fine.
- **Flag migration-relevant fixes** — If the fix changes DB schema, renames columns, changes identity models, renames env vars, or changes session/token formats, add a note in the fix plan: "**Migration note:** [what production data is affected]". The implementer will log this in `MIGRATIONS.md`.
- For prompt issues, test multiple variations before recommending changes
- Create Linear issues in Todo state for each fix task
- Include Linear issue links in PLANS.md

## 11. Scope Boundaries

This skill is specifically for:
- Investigating reported bugs and errors
- Creating structured fix plans with TDD approach
- Creating Linear issues for tracking

This skill is NOT for:
- Actually implementing fixes (use plan-implement for that)
- Adding new features (use plan-backlog or add-to-backlog)
- Code reviews (use code-audit)
- General investigation without a fix intent (use investigate)
- Refactoring (create a separate task)

## 12. Termination and Git Workflow

When investigation and planning are complete:

1. **Output the plan summary:**

```
✓ Plan created in PLANS.md
✓ Linear issues created in Todo: ADVA-123, ADVA-124, ...

## Plan Summary

**Problem:** [Copy from PLANS.md summary]

**Root Cause:** [Copy from PLANS.md summary]

**Linear Issues:** [Copy from PLANS.md summary]

**Solution Approach:** [Copy from PLANS.md summary]

**Scope:**
- Files affected: [count]
- New tests: [yes/no]
- Breaking changes: [yes/no]

**Risks/Considerations:**
- [List from PLANS.md summary]

---

Create a feature branch and commit the plan.
```

2. **Create branch, commit (no `Co-Authored-By` tags), and push:**
   ```bash
   git checkout -b fix/<bug-description> && git add PLANS.md && git commit -m "plan: <bug-description>" && git push -u origin fix/<bug-description>
   ```

3. **Suggest next steps:**
   - "Run `/plan-implement` to implement the fix plan"
   - If critical: "This is a critical issue - recommend implementing immediately"

4. **If chained from investigate skill:**
   - Reference the investigation findings
   - Note any additional evidence found during the fix planning phase

Do not ask follow-up questions. Do not offer to implement. Output the summary and stop.
