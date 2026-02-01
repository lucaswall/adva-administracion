---
name: plan-fix
description: Investigate bugs and create TDD fix plans. Use when user reports extraction errors, deployment failures, wrong data, missing matches, or prompt issues. Discovers MCPs from CLAUDE.md for debugging (logs, files, prompts).
argument-hint: <bug description>
allowed-tools: Read, Edit, Write, Glob, Grep, Task
disable-model-invocation: true
---

Investigate bugs and create TDD fix plans in PLANS.md.

## Purpose

- Investigate bugs found after processing files (extraction errors, wrong data, missing matches)
- Debug deployment failures using Railway MCP
- Test and iterate Gemini prompts when extraction issues are suspected
- Create investigation report documenting findings and root cause
- Generate TDD-based fix plan in PLANS.md
- Does NOT implement fixes (integrates with plan-implement)

## Pre-flight Check

**Before doing anything**, read PLANS.md and check if it contains incomplete work:
- If PLANS.md has content but NO "Status: COMPLETE" at the end → **STOP**
- Tell the user: "PLANS.md has incomplete work. Please review and clear it before planning new items."
- Do not proceed.

If PLANS.md is empty or has "Status: COMPLETE" → proceed with investigation.

## Arguments

$ARGUMENTS should contain the bug description with context:
- What happened vs what was expected
- File IDs if relevant (Google Drive file IDs)
- Error messages or unexpected values
- Deployment ID if it's a deployment issue
- Any other context that helps investigation

## Context Gathering

**IMPORTANT: Do NOT hardcode MCP names or folder paths.** Always read CLAUDE.md to discover:

1. **Available MCP servers** - Look for "MCP SERVERS" section to find:
   - File/storage MCPs for accessing documents and data
   - Deployment MCPs for logs and service status
   - AI/LLM MCPs for prompt testing

2. **Project structure** - Look for "STRUCTURE" or "FOLDER STRUCTURE" sections to understand:
   - Where source code and documents are stored
   - Naming conventions and organization

3. **Domain concepts** - Look for sections describing:
   - Document types and their processing
   - Data schemas and formats
   - Business rules and validation

## Investigation Workflow

### Step 1: Classify the Bug Type

Based on $ARGUMENTS, determine the bug category:

| Category | Indicators | Primary Tools |
|----------|-----------|---------------|
| **Extraction** | Wrong data extracted, missing fields | Google Drive MCP, Gemini MCP |
| **Deployment** | Service down, build failures, runtime errors | Railway MCP |
| **Matching** | Wrong matches, missing matches | Google Drive MCP, Codebase |
| **Storage** | Data not saved, wrong spreadsheet | Google Drive MCP, Codebase |
| **Prompt** | Consistent extraction errors on specific doc types | Gemini MCP |

### Step 2: Gather Evidence

**For Codebase Issues:**
- Use Grep/Glob for searching the codebase
- Use Task tool with subagent_type=Explore for broader exploration
- Read relevant source files and tests

**For Deployment Issues (if deployment MCPs available):**
1. Check MCP/CLI status
2. List services to find affected service
3. List recent deployments with statuses
4. Get deployment and build logs
5. Verify environment configuration

**For Document/File Issues (if file MCPs available):**
- Search for the problematic file
- Read file contents
- Check related data stores (spreadsheets, databases)

**For Prompt/AI Issues (when extraction is consistently wrong):**
1. Get the source document
2. Test alternative prompts using AI MCPs
3. Compare current vs expected output
4. Iterate until extraction improves
5. Document the improved prompt for implementation

### Step 3: Document Findings

Write PLANS.md with this structure:

```markdown
# Bug Fix Plan

**Created:** YYYY-MM-DD
**Bug Report:** [Summary from $ARGUMENTS]
**Category:** [Extraction | Deployment | Matching | Storage | Prompt]

## Investigation

### Context Gathered
- **MCPs used:** [list which MCPs were used and why]
- **Files examined:** [list files checked - Drive files, spreadsheets, code files, logs]

### Evidence
[Detailed findings from investigation with specific data points]

### Root Cause
[Clear explanation of why the bug occurs]

## Fix Plan

### Fix 1: [Title matching the issue]
1. Write test in [file].test.ts for [scenario that reproduces the bug]
2. Implement fix in [file].ts

### Fix 2: [Title]
...

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Plan Summary

**Problem:** [One sentence describing the bug/issue]

**Root Cause:** [One sentence explaining why it happens]

**Solution Approach:** [2-3 sentences describing the fix strategy at a high level]

**Scope:**
- Files affected: [count]
- New tests: [yes/no]
- Breaking changes: [yes/no]

**Risks/Considerations:**
- [Key risk or consideration 1]
- [Key risk or consideration 2, if any]
```

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

## Error Handling

| Situation | Action |
|-----------|--------|
| PLANS.md has incomplete work | Stop and tell user to review/clear PLANS.md first |
| $ARGUMENTS lacks bug description | Ask user to describe what happened vs expected |
| CLAUDE.md doesn't exist | Continue with codebase-only investigation |
| MCP not available | Skip that MCP, note in investigation what couldn't be checked |
| File/resource not found | Document as part of investigation (may be the bug) |
| Cannot reproduce issue | Document investigation steps taken, ask user for more context |
| Root cause unclear | Document possible causes ranked by likelihood |

## Rules

- **Refuse to proceed if PLANS.md has incomplete work**
- **Discover MCPs from CLAUDE.md** - don't hardcode MCP names or paths
- **Investigation only** - do not modify source code
- All fixes must follow TDD (test first)
- Include enough detail for another model to implement without context
- Always include post-implementation checklist
- For prompt issues, test multiple variations before recommending changes

## CRITICAL: Scope Boundaries

**This skill creates plans. It does NOT implement them.**

1. **NEVER ask to "exit plan mode"** - This skill doesn't use Claude Code's plan mode feature
2. **NEVER implement code** - Your job ends when PLANS.md is written
3. **NEVER ask ambiguous questions** like "should I proceed?" or "ready to continue?"
4. **NEVER start implementing** after writing the plan, even if user says "yes" to something

## Termination

When you finish writing PLANS.md, output the plan summary followed by the completion message:

```
✓ Plan created in PLANS.md

## Plan Summary

**Problem:** [Copy from PLANS.md summary]

**Root Cause:** [Copy from PLANS.md summary]

**Solution Approach:** [Copy from PLANS.md summary]

**Scope:**
- Files affected: [count]
- New tests: [yes/no]
- Breaking changes: [yes/no]

**Risks/Considerations:**
- [List from PLANS.md summary]

---

Next step: Run `plan-implement` to execute this plan.
```

Do not ask follow-up questions. Do not offer to implement. Output the summary and stop.
