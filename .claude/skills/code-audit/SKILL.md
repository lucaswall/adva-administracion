---
name: code-audit
description: Comprehensive codebase audit for bugs, security issues, CLAUDE.md violations, dead code, duplicate code, and test quality. Writes findings to TODO.md with priority ordering.
argument-hint: [optional: specific area to focus on]
allowed-tools: Read, Edit, Write, Glob, Grep, Task
disable-model-invocation: true
---

Perform a comprehensive code audit and write findings to TODO.md.

## Purpose

- Find bugs, edge cases, and logic errors
- Identify security vulnerabilities
- Detect CLAUDE.md rule violations
- Find duplicate and dead code
- Identify useless or duplicate tests
- Document all findings in TODO.md (analysis only, no fixes)

## Pre-flight Check

1. **Read CLAUDE.md** - Load all project rules and conventions to audit against
2. **Read TODO.md** - Preserve any existing items (they will be renumbered)

## Audit Scope

### Categories to Audit

| Category | Tag | Description |
|----------|-----|-------------|
| Bug | `[bug]` | Logic errors, off-by-one, null handling, race conditions |
| Security | `[security]` | Injection, exposed secrets, missing auth, OWASP top 10 |
| Edge Case | `[edge-case]` | Unhandled scenarios, boundary conditions |
| Convention | `[convention]` | CLAUDE.md rule violations |
| Dead Code | `[dead-code]` | Unused functions, unreachable code, obsolete exports |
| Duplicate | `[duplicate]` | Repeated logic that should be abstracted |
| Type Safety | `[type]` | Unsafe casts, missing type guards, any usage |
| Test Quality | `[test]` | Useless tests, duplicate tests, missing assertions |
| Best Practice | `[practice]` | Anti-patterns, over-engineering, poor error handling |

### Areas to Examine

1. **Source Code** (`src/**/*.ts`)
   - All service files
   - Route handlers
   - Processing logic
   - Utility functions
   - Type definitions

2. **Test Files** (`src/**/*.test.ts`)
   - Test coverage gaps
   - Tests that don't actually test behavior
   - Duplicate test scenarios
   - Tests with no assertions
   - Tests that always pass

3. **Configuration**
   - Environment variable handling
   - Security configurations
   - Build settings

4. **Project Structure**
   - CLAUDE.md accuracy
   - Missing documentation
   - Orphaned files

## Audit Workflow

### Step 1: Systematic Exploration

Use the Task tool with `subagent_type=Explore` to methodically examine:

1. **Core Services** - All files in `src/services/`
2. **Processing Pipeline** - All files in `src/processing/`
3. **API Routes** - All files in `src/routes/`
4. **Gemini Integration** - All files in `src/gemini/`
5. **Utilities** - All files in `src/utils/`
6. **Bank Logic** - All files in `src/bank/`
7. **Tests** - All `*.test.ts` files

For each area, look for:
- Code that doesn't match CLAUDE.md conventions
- Potential bugs and edge cases
- Security vulnerabilities
- Dead or duplicate code
- Test quality issues

### Step 2: CLAUDE.md Compliance Check

Read CLAUDE.md and verify compliance for:

- **ESM imports** - All imports use `.js` extensions
- **Logging** - No `console.log`, only Pino logger
- **Security** - All endpoints (except /health, /webhooks/drive) have auth middleware
- **Result pattern** - Error-prone operations use `Result<T,E>`
- **Naming** - Files kebab-case, types PascalCase, functions camelCase
- **Tests** - Fake CUITs and fictional names used

### Step 3: Collect Findings

For each issue found, document:
- The file and approximate location
- Clear description of the problem
- The category tag

**Important:** Document the problem only, NOT the solution. Do not waste time analyzing how to fix issues.

### Step 4: Prioritize Findings

Order all findings by importance:

1. **Critical** - Security vulnerabilities, data corruption bugs
2. **High** - Logic bugs causing incorrect behavior, missing auth
3. **Medium** - Edge cases, type safety, CLAUDE.md violations
4. **Low** - Dead code, duplicates, style issues, test quality

### Step 5: Write TODO.md

Format TODO.md with numbered items and category tags:

```markdown
# Code Audit Findings

## item #1 [security]
Description of the security issue without suggesting a fix.

## item #2 [bug]
Description of the bug without suggesting a fix.

## item #3 [convention]
Description of the CLAUDE.md violation without suggesting a fix.

## item #4 [dead-code]
Description of unused code without suggesting removal approach.

...
```

**Formatting Rules:**
- Each item is a heading: `## item #N [tag]`
- Content is a simple paragraph explaining the problem
- NO solution suggestions - just describe what's wrong
- Preserve all existing items but renumber them
- Existing items keep their relative order but get new numbers based on priority
- New items are inserted at appropriate priority positions

## CLAUDE.md Violations to Check

Specifically verify these rules from CLAUDE.md:

1. **TDD mandatory** - Check if tests exist for all functions
2. **Zero warnings** - Any code patterns that would cause build warnings
3. **No console.log** - Search for any console.log usage
4. **ESM imports** - All imports must have `.js` extensions
5. **Result<T,E> pattern** - Error-prone operations use Result type
6. **Auth middleware** - All non-exempt endpoints have authentication
7. **Pino logger** - All logging uses the Pino logger utility
8. **Naming conventions** - Files, types, functions follow conventions
9. **CellDate/CellNumber** - Spreadsheet data uses proper types
10. **Spreadsheet timezone** - Script-generated timestamps use correct timezone

## Rules

- **Analysis only** - Do NOT modify source code
- **No solutions** - Document problems, not fixes
- **Be thorough** - Check every file in scope
- **Be specific** - Include file paths for each issue
- **Preserve existing items** - Existing TODO.md items are renumbered and kept
- **Priority ordering** - Critical issues first, low priority last
- **No time wasting** - Don't analyze how to fix, just identify issues

## Termination

When you finish writing TODO.md, output this exact message and STOP:

```
✓ Code audit complete. Findings written to TODO.md.

Found N issues:
- X critical/high priority
- Y medium priority
- Z low priority

Next step: Review TODO.md and use `plan-todo` to create implementation plans.
```

Do not ask follow-up questions. Do not offer to fix issues. Just output the message and stop.
