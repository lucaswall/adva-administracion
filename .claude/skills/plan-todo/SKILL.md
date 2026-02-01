---
name: plan-todo
description: Convert TODO.md backlog items into TDD implementation plans. Use when user says "plan item #N", "plan all bugs", "work on backlog", or wants to implement items from TODO.md. Explores codebase for patterns and discovers available MCPs from CLAUDE.md.
argument-hint: [item-selector] e.g., "item #2", "all bugs", "the file naming issue"
allowed-tools: Read, Edit, Write, Glob, Grep, Task
disable-model-invocation: true
---

Convert TODO.md items into a structured TDD implementation plan in PLANS.md.

## Purpose

- Convert backlog items from TODO.md into actionable TDD implementation plans
- Explore codebase to understand existing patterns and find relevant files
- Use MCPs to gather additional context (Drive files, spreadsheets, deployments)
- Generate detailed, implementable plans with full file paths

## Pre-flight Check

**Before doing anything**, read PLANS.md and check for incomplete work:
- If PLANS.md has content but NO "Status: COMPLETE" at the end → **STOP**
- Tell the user: "PLANS.md has incomplete work. Please review and clear it before planning new items."
- Do not proceed.

If PLANS.md is empty or has "Status: COMPLETE" → proceed with planning.

## Arguments

Default: plan the **first item** in TODO.md. Override with $ARGUMENTS:

| Selector | Example | Result |
|----------|---------|--------|
| Item number | `bug #2`, `improvement #5` | Specific item |
| Category | `all bugs`, `all improvements` | All items in category |
| Natural language | `the file naming issue` | Fuzzy match |

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

1. **Read PLANS.md** - Pre-flight check
2. **Read TODO.md** - Identify items to plan
3. **Read CLAUDE.md** - Understand TDD workflow, agents, project rules, available MCPs
4. **Explore codebase** - Use Glob/Grep/Task to find relevant files and understand patterns
5. **Gather MCP context** - If the TODO item relates to:
   - Document processing → Check Drive files, spreadsheet schemas
   - Deployment → Check service status, recent logs
   - Extraction issues → Check current prompts, test with Gemini MCP
6. **Generate plan** - Create TDD tasks with test-first approach
7. **Write PLANS.md** - Overwrite with new plan
8. **Update TODO.md** - Remove planned items and reformat remaining items

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
**Source:** [Which items from TODO.md]

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
1. Write test in [file].test.ts for [function/scenario]
2. Run test-runner (expect fail)
3. Implement [function] in [file].ts
4. Run test-runner (expect pass)

### Task 2: [Name]
1. Write test...
2. Run test-runner...
3. Implement...
4. Run test-runner...

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Plan Summary

**Objective:** [One sentence describing what this plan accomplishes]

**Source Items:** [List the TODO.md items being planned, e.g., "#1, #3, #5"]

**Approach:** [2-3 sentences describing the implementation strategy at a high level]

**Scope:**
- Tasks: [count]
- Files affected: [estimated count]
- New tests: [yes/no]

**Key Decisions:**
- [Important architectural or design decision 1]
- [Important decision 2, if any]

**Dependencies/Prerequisites:**
- [Any prerequisites or dependencies]
```

## Task Writing Guidelines

Each task must be:
- **Self-contained** - Full file paths, clear descriptions
- **TDD-compliant** - Test before implementation
- **Specific** - What to test, what to implement
- **Ordered** - Dependencies resolved by task order
- **Context-aware** - Reference patterns and files discovered during exploration

Good task example:
```markdown
### Task 1: Add parseResumenBroker function
1. Write test in src/gemini/parser.test.ts for parseResumenBrokerResponse
   - Test extracts comitente number (similar to existing parseResumenBancario tests)
   - Test handles multi-currency (ARS + USD)
   - Test returns error for invalid input
   - Follow existing Result<T,E> pattern from parser.ts
2. Run test-runner (expect fail)
3. Implement parseResumenBrokerResponse in src/gemini/parser.ts
   - Use existing ResumenBroker type from src/types/index.ts
   - Follow parseResumenBancarioResponse as template
4. Run test-runner (expect pass)
```

Bad task example:
```markdown
### Task 1: Add broker parsing
1. Add parser function
2. Test it
```

## MCP Usage Guidelines

Discover available MCPs from CLAUDE.md's "MCP SERVERS" section. Common patterns:

**File/Document MCPs** - Use when TODO item involves:
- Document processing or extraction
- Spreadsheet or database changes
- File organization or storage

**Deployment MCPs** - Use when TODO item involves:
- Deployment configuration
- Environment variables
- Service logs for debugging context

**AI/LLM MCPs** - Use when TODO item involves:
- Prompt improvements
- Extraction accuracy
- Testing variations before implementation

If CLAUDE.md doesn't list MCPs, skip MCP context gathering.

## TODO.md Reformatting

After removing planned items, **always reformat TODO.md** using the standard item format:

```markdown
## item #1 [tag]
Description of first issue.

## item #2 [tag]
Description of second issue.
```

**Reformatting rules:**
- Preserve the existing top-level heading (if any)
- Renumber all remaining items sequentially starting from #1
- Preserve relative order (priority ordering)
- Keep original tags in brackets: `[security]`, `[bug]`, `[convention]`, etc.
- Each item is a `## item #N [tag]` heading followed by a description paragraph
- If original items had different formats, normalize them to this structure
- If the item had no tag, infer one from context or use `[task]`

This ensures TODO.md stays consistent regardless of how items were originally added.

## Error Handling

| Situation | Action |
|-----------|--------|
| PLANS.md has incomplete work | Stop and tell user to review/clear PLANS.md first |
| TODO.md doesn't exist or is empty | Stop and tell user "No items in TODO.md to plan" |
| CLAUDE.md doesn't exist | Continue without project-specific rules, use general TDD practices |
| Item selector matches nothing | List available items and ask user to clarify |
| Codebase exploration times out | Continue with partial context, note limitation in plan |
| MCP not available | Skip MCP context gathering, note in plan what was skipped |

## Rules

- **Refuse to proceed if PLANS.md has incomplete work**
- **Explore codebase before planning** - Find patterns to follow
- **Use MCPs when relevant** - Gather context from external systems (discover from CLAUDE.md)
- Every task must follow TDD (test first, then implement)
- No manual verification steps - use agents only
- Tasks must be implementable without additional context
- Always include post-implementation checklist
- Remove planned items from TODO.md and reformat remaining items

## CRITICAL: Scope Boundaries

**This skill creates plans. It does NOT implement them.**

1. **NEVER ask to "exit plan mode"** - This skill doesn't use Claude Code's plan mode feature
2. **NEVER implement code** - Your job ends when PLANS.md is written
3. **NEVER ask ambiguous questions** like "should I proceed?" or "ready to continue?"
4. **NEVER start implementing** after writing the plan, even if user says "yes" to something

## Termination

When you finish writing PLANS.md (and updating TODO.md), output the plan summary followed by the completion message:

```
✓ Plan created in PLANS.md
✓ TODO.md updated (planned items removed, remaining items renumbered)

## Plan Summary

**Objective:** [Copy from PLANS.md summary]

**Source Items:** [Copy from PLANS.md summary]

**Approach:** [Copy from PLANS.md summary]

**Scope:**
- Tasks: [count]
- Files affected: [estimated count]
- New tests: [yes/no]

**Key Decisions:**
- [List from PLANS.md summary]

**Dependencies/Prerequisites:**
- [List from PLANS.md summary]

---

Next step: Run `plan-implement` to execute this plan.
```

Do not ask follow-up questions. Do not offer to implement. Output the summary and stop.
