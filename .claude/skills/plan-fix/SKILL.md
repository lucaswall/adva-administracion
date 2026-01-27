---
name: plan-fix
description: Investigate bugs and create fix plans
argument-hint: <bug description with context>
allowed-tools: Read, Edit, Write, Glob, Grep, Task, gdrive_search, gdrive_read_file, gdrive_list_folder, gdrive_get_pdf, gsheets_read
disable-model-invocation: true
---

Investigate bugs discovered after file processing and create TDD fix plans in PLANS.md.

## Purpose

- Investigate bugs found after processing files (extraction errors, wrong data, missing matches, etc.)
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
- Any other context that helps investigation

## Context Gathering

**IMPORTANT: Do NOT hardcode MCP names or folder paths.** Always read CLAUDE.md to discover:

1. **Available MCP servers** - Look for the "MCP SERVERS" section to find tools like:
   - Google Drive MCPs for file access
   - Gemini MCP for prompt testing
   - Railway MCP for deployment info

2. **Folder structure** - Look for "FOLDER STRUCTURE" section to understand:
   - Where documents are stored
   - Naming conventions for bank folders, card folders, broker folders

3. **Document types** - Look for "DOCUMENT CLASSIFICATION" section to understand:
   - Document type → destination mapping
   - ADVA role in each document type

4. **Spreadsheet schemas** - Look for "SPREADSHEETS" section or read SPREADSHEET_FORMAT.md

## Investigation Workflow

1. Read PLANS.md - check for incomplete work (Pre-flight Check)
2. Read CLAUDE.md - discover MCPs, folder structure, document types
3. Parse $ARGUMENTS for bug description and context
4. Investigate using available tools:
   - Use MCP tools (gdrive_search, gdrive_read_file, gsheets_read, etc.) to access Google Drive files and spreadsheets
   - Use Grep/Glob for searching the codebase
   - Use Task tool with subagent_type=Explore for broader codebase exploration
5. Document findings in PLANS.md
6. Create TDD fix plan for identified issues

## PLANS.md Structure

Write PLANS.md with this structure:

```markdown
# Bug Fix Plan

**Created:** YYYY-MM-DD
**Bug Report:** [Summary from $ARGUMENTS]

## Investigation

### Context Gathered
- Relevant MCPs used: [list which MCPs were used]
- Files examined: [list files checked - Drive files, spreadsheets, code files]
- Findings: [detailed findings from investigation]

### Root Cause
[Explain the root cause of the bug]

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
```

## Rules

- **Refuse to proceed if PLANS.md has incomplete work**
- **Do NOT hardcode MCP names or folder paths** - always read from CLAUDE.md
- **Investigation only** - do not modify source code
- All fixes must follow TDD (test first)
- Include enough detail for another model to implement without context
- Always include post-implementation checklist
