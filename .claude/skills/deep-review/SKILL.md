---
name: deep-review
description: Deep, focused analysis of a single feature or service area. Combines code correctness, security, data integrity, and performance in one unified high-effort pass with cross-domain reasoning. Finds bugs that broad audits miss by tracing full data flows and service interactions. Use when user says "deep review", "deeply analyse", "review this feature", "find all bugs in X", or wants thorough analysis of a specific area. Requires a target area argument.
argument-hint: <feature or service area, e.g. "scanner", "matching", "spreadsheet storage", "gemini extraction">
allowed-tools: Read, Glob, Grep, Bash, mcp__linear__list_teams, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__save_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
effort: xhigh
disable-model-invocation: true
---

Deep analysis of a focused area. You analyze directly — no delegation, no team. The value is YOUR cross-domain reasoning across all related files in one context.

ultrathink

## Pre-flight

1. **Validate argument** — `$ARGUMENTS` is REQUIRED. If empty, STOP: "Please specify a target area to review. Example: `/deep-review matching`"
2. **Verify Linear MCP** — Call `mcp__linear__list_teams`. If unavailable, STOP: "Linear MCP is not connected. Run `/mcp` to reconnect, then re-run."
3. **Read CLAUDE.md** — Load project rules, conventions, and the KNOWN ACCEPTED PATTERNS section (patterns that MUST NOT be filed as findings). **Discover team name:** Look for LINEAR INTEGRATION section in CLAUDE.md. If not found, use `mcp__linear__list_teams` to discover the team name dynamically.
4. **Query existing Backlog issues** — `mcp__linear__list_issues` with team [discovered team name], state "Backlog". Record titles and file paths to avoid creating duplicates.

## Scope Discovery

Trace the full dependency graph for `$ARGUMENTS`. Find EVERY file that participates in the target feature.

### Step 1: Find entry points

Read CLAUDE.md's STRUCTURE section to discover file patterns. Use Glob to locate primary files matching `$ARGUMENTS` based on the discovered patterns. Common patterns for this project include:
- Routes: `src/routes/*.ts`
- Services: `src/services/*.ts`
- Processing: `src/processing/**/*.ts`
- Matching: `src/matching/*.ts`, `src/processing/matching/*.ts`
- Storage: `src/processing/storage/*.ts`
- Gemini/AI: `src/gemini/*.ts`
- Utils: `src/utils/*.ts`
- Types: `src/types/*.ts`
- Config: `src/config.ts`

If the argument is ambiguous, use Grep to search for the feature name across the codebase.

### Step 2: Trace imports

Read each entry point. For every import:
- Service imports -> add the service file
- Processing imports -> add the processing module
- Utility imports -> add the util module
- Type imports -> add the type file
- External API imports (Google Drive, Sheets, Gemini) -> flag for API contract review

Follow imports recursively until the full dependency tree is mapped.

### Step 3: Map data flows

For any route handlers that invoke the target feature:
- Extract the route path and HTTP method
- Find the corresponding handler logic
- Add the handler AND its dependencies
- Trace middleware (auth, validation) applied to the route

### Step 4: Find related files

For each source file:
- Test file: check for colocated `*.test.ts` patterns
- Config references: check for constants used from `src/config.ts`
- Spreadsheet format: check `SPREADSHEET_FORMAT.md` if the feature touches sheets

### Step 5: Output file manifest

List all discovered files grouped by role:
- **Routes** — HTTP endpoint handlers
- **Services** — Business logic services (Drive, Sheets, etc.)
- **Processing** — Document processing pipeline
- **Matching** — Document-to-movement matching
- **Storage** — Spreadsheet storage modules
- **Gemini** — AI extraction and parsing
- **Utils** — Shared utilities
- **Types** — Type definitions
- **Tests** — Test files
- **Config** — Configuration and constants

Output the manifest before proceeding so the user can verify scope.

## Read All Files

Read EVERY file in the manifest. Cross-domain reasoning requires holding all related code in context simultaneously.

Read in dependency order: types -> config -> utils -> services -> processing -> routes -> tests.

## Deep Analysis

Read [references/deep-review-checklist.md](references/deep-review-checklist.md) for the comprehensive cross-domain checklist.

**Critical instruction:** Do NOT analyze each file in isolation. Reason about how files INTERACT. For each finding, trace the impact across the full stack.

### Analysis approach

Walk through the data flow for this feature:
1. **Trigger** — How does the feature get invoked? (API call, webhook, startup, timer). What can fail at the entry point?
2. **External data** — What external APIs are called? (Google Drive, Sheets, Gemini). What can fail? How are errors handled?
3. **Processing** — What transforms the data? What validation happens? What edge cases exist in parsing, matching, or storage?
4. **AI integration** — If the feature involves Gemini API: trace prompt construction -> API call -> response parsing -> validation. Check prompt quality, response validation, error handling (see checklist section 9). **Then run the indirect-prompt-injection trace from checklist section 11** — document → extraction → prompt assembly → response → parse → routing/storage. This is where AI-pipeline features need the most cross-domain reasoning.
5. **Storage** — How does data get written to Google Sheets? Are column mappings correct? Are data types (CellDate, CellNumber) used correctly? Is the spreadsheet timezone handled? Is `normalizeSpreadsheetDate` used on reads?
6. **Edge cases** — Empty data, malformed documents, concurrent processing, retry scenarios, large payloads, missing folders
7. **Failing-open paths (A10:2025)** — Apply checklist section 12 across the feature: for every await / external call / lock / config check, what state is the system in if it fails?
8. **Cost & quota (LLM10:2025)** — Apply checklist section 13 if the feature calls Gemini: compute worst-case token spend, verify ceilings exist.

### Findings format

For each finding, record:
- **Severity:** [critical] | [high] | [medium] | [low]
- **Domain:** code | security | data-integrity | performance | prompt-injection | failing-open | supply-chain
- **Location:** file:line (and related files if cross-cutting)
- **Description:** What's wrong
- **Impact:** Who is affected and how
- **Cross-domain note:** How this interacts with other parts of the system (if applicable)

## Verification

Before creating any Linear issues, **re-read every candidate finding's file:line** and confirm the issue exists today. Even a careful deep pass produces stale references and the occasional hallucinated pattern; the verification step is the single highest-leverage filter for backlog noise.

For each candidate:

1. **Read the cited file** at the cited line range (±10 lines for context).
2. **Confirm the issue exists.** Look at the actual code, not your earlier description. Ask: would I file this issue if I were seeing it for the first time?
3. **Decide:**
   - **Confirmed** — keep
   - **Stale reference** — code moved but the issue may still exist elsewhere; search and update location, or drop if the issue is gone
   - **Hallucinated** — drop
   - **Out of scope** — third-party / generated / explicitly excluded — drop
4. Track verification stats for the termination report.

Multi-issue rollup: if the same issue appears in multiple files (e.g., a missing validator pattern in 5 storage modules), emit ONE Linear issue with all file:line locations in the Context section, not five issues.

## Create Linear Issues

For each verified finding, check against existing Backlog issues. Skip if a matching issue already exists.

Use `mcp__linear__save_issue` (omit `id` to create):

```
team: [discovered team name]
state: "Backlog"
title: "[Brief description]"
priority: [1-4] (critical=1, high=2, medium=3, low=4)
labels: [mapped label]
description: (format below)
```

**Issue description format:**

```
**Problem:**
[1-2 sentence problem statement]

**Context:**
[File paths with line numbers — include ALL related files, not just the primary location]

**Impact:**
[Who is affected and how — trace the operational consequence]

**Action:** Act | Attend | Track
[SSVC outcome — see the SSVC Action Mapping section in references/deep-review-checklist.md for the decision rules. Tells planning skills "what to do" alongside the priority number.]

**Acceptance Criteria:**
- [ ] [Verifiable criterion]
- [ ] [Another criterion]
```

**Label mapping:**

| Finding domain | Linear label |
|---------------|-------------|
| code (bugs, logic, async, edge cases) | Bug |
| security (auth, validation, injection, secrets) | Security |
| prompt-injection (LLM01 — indirect injection from documents) | Security |
| supply-chain (slopsquatting, hallucinated packages, lockfile gaps) | Security |
| failing-open (A10:2025 — exceptional-condition mishandling) | Bug |
| data-integrity (spreadsheet, matching, parsing) | Bug |
| performance (memory, throughput, API calls, cost) | Performance |
| convention (CLAUDE.md violation) | Convention |

## Termination

Output this report and STOP:

```
## Deep Review: $ARGUMENTS

**Files analyzed:** N
**Scope:** [list of file groups with counts]

### Verification Stats

- Candidate findings: T
- Confirmed: C
- Dropped (stale / hallucinated / out of scope): D

### Findings (ordered by SSVC Action, then severity)

| # | ID | Action | Severity | Domain | Title |
|---|-----|--------|----------|--------|-------|
| 1 | ADV-XX | Act | Critical | code | Brief title |
| 2 | ADV-XX | Attend | High | data-integrity | Brief title |
| ... | ... | ... | ... | ... | ... |

X issues created | Multi-location rollups: R | Duplicates skipped: N

### Cross-cutting Observations

[Systemic patterns observed across the feature — e.g., "error handling is inconsistent between the service and route layers", "spreadsheet date handling uses String() instead of normalizeSpreadsheetDate() in some paths", "the Gemini prompt assembly puts file metadata in the instruction section rather than the data section in 2 of 4 callers — LLM01 surface"]
```

Do not ask follow-up questions. Do not offer to fix issues.
