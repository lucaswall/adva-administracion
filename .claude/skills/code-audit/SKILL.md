---
name: code-audit
description: Audits codebase for bugs, security issues, memory leaks, and CLAUDE.md violations. Creates Linear issues in Backlog state for findings. Use when user says "audit", "find bugs", "check security", or "review codebase". Analysis only.
argument-hint: [optional: specific area like "services" or "tests"]
allowed-tools: Read, Edit, Write, Glob, Grep, Task, Bash, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Perform a comprehensive code audit and create Linear issues in Backlog for findings.

## Pre-flight

1. **Read CLAUDE.md** - Load project-specific rules to audit against (if exists)
2. **Query Linear Backlog** - Get existing issues using `mcp__linear__list_issues` with:
   - `team`: "ADVA Administracion"
   - `state`: "Backlog"
   - For each issue, record: ID, title, labels, priority, description
   - **Audit issues** (labels: Bug, Security, Performance, Convention, Technical Debt) → mark as `pending_validation`
   - **Non-audit issues** (labels: Feature, Improvement) → mark as `preserve` (skip validation)
3. **Read project config** - `tsconfig.json`, `package.json`, `.gitignore` for structure discovery

## Audit Process

Copy this checklist and track progress:

```
Audit Progress:
- [ ] Step 1: Discover project structure
- [ ] Step 2: Validate existing Linear Backlog issues
- [ ] Step 3: Explore discovered areas systematically
- [ ] Step 4: Check CLAUDE.md compliance
- [ ] Step 5: Check dependency vulnerabilities
- [ ] Step 6: Merge, deduplicate, and reprioritize
- [ ] Step 7: Create Linear Issues
```

### Step 1: Discover Project Structure

Dynamically discover the project structure (do NOT hardcode paths):

1. **Read configuration files** (in parallel):
   - `tsconfig.json` - check `include`/`exclude` for source patterns
   - `package.json` - check `main`, `types`, `scripts` for entry points
   - `.gitignore` - identify directories to skip

2. **Identify source directories**:
   - Use Glob with patterns from tsconfig.json `include`
   - If no tsconfig, use conventions: `src/`, `lib/`, `app/`, `packages/`

3. **Map the codebase structure**:
   - Use Task tool with `subagent_type=Explore` to understand architecture
   - If `$ARGUMENTS` specifies a focus area, prioritize that

### Step 2: Validate Existing Linear Backlog Issues

For each existing issue marked `pending_validation`:

1. **Check if the issue still exists:**
   - Read the referenced file path and line numbers from issue description
   - Verify the problematic code is still present
   - Check git history if needed to see if it was fixed

2. **Classify as `fixed` or `pending`:**

   | Status | Criteria | Action |
   |--------|----------|--------|
   | `fixed` | Code corrected or file removed | Close issue with comment |
   | `pending` | Issue appears to still exist | Carry forward to Step 6 for final classification |

3. **Track validation results** - Log which issues were closed as fixed

Note: Final classification (`still_valid`, `needs_update`, `superseded`) happens in Step 6 after new findings are known.

### Step 3: Systematic Exploration

Use Task tool with `subagent_type=Explore` to examine each discovered area.

**Look for:**
- Logic errors, null handling, race conditions
- Security vulnerabilities (injection, missing auth, exposed secrets)
- Unhandled edge cases and boundary conditions
- Type safety issues (unsafe casts, unvalidated external data)
- Dead or duplicate code
- Memory leaks (unbounded collections, event listeners, unclosed streams)
- Resource leaks (connections, file handles, timers not cleared)
- Async issues (unhandled promises, missing try/catch)
- Timeout/hang scenarios (API calls without timeouts)
- Graceful shutdown issues (cleanup not performed)

**AI-Generated Code Risks:**
When code shows AI patterns (repetitive structure, unusual APIs), apply extra scrutiny for:
- Logic errors (75% more common in AI code)
- XSS vulnerabilities (2.74x higher frequency)
- Code duplication
- Hallucinated APIs (non-existent methods/libraries)
- Missing business context

See [references/compliance-checklist.md](references/compliance-checklist.md) for detailed checks.

### Step 4: CLAUDE.md Compliance

If CLAUDE.md exists, check project-specific rules defined there (imports, logging, patterns, TDD).

### Step 5: Dependency Vulnerabilities

Run the appropriate audit command:
- **Node.js**: `npm audit` or `yarn audit`
- **Rust**: `cargo audit`
- **Python**: `pip-audit` or `safety check`
- **Go**: `govulncheck`

Include critical/high vulnerabilities in findings.

### Step 6: Merge, Deduplicate, and Reprioritize

Now that you have both `pending` existing issues and new findings, perform final classification:

1. **Classify pending existing issues:**

   | Status | Criteria | Action |
   |--------|----------|--------|
   | `superseded` | New finding covers same issue | Close issue (new finding wins) |
   | `needs_update` | Issue exists but line numbers or severity changed | Update issue description/priority |
   | `still_valid` | Issue unchanged, no overlapping new finding | Keep as-is |

2. **Merge sources:**
   - `still_valid` and `needs_update` existing issues
   - New findings from Steps 3-5

3. **Deduplicate:**
   - Same code location → merge into the one with higher priority

4. **Reassess priorities** for the entire combined list:
   - See [references/priority-assessment.md](references/priority-assessment.md) for impact×likelihood matrix
   - Document priority changes with reason

**For category tags and label mapping, see [references/category-tags.md](references/category-tags.md).**

**For each new finding, prepare:**
- File path and approximate location
- Clear problem description
- Linear label (mapped from category tag)
- Linear priority (1=Urgent, 2=High, 3=Medium, 4=Low)

**Do NOT document solutions.** Identify problems only.

### Step 7: Create Linear Issues

For each new finding, use `mcp__linear__create_issue`:

```
team: "ADVA Administracion"
state: "Backlog"
title: "[Brief description of the issue]"
description: "[File path]\n\n[Problem description]"
priority: [1|2|3|4] (mapped from critical/high/medium/low)
labels: [Mapped label(s)]
```

**Label Mapping (from category tags):**

| Category Tags | Linear Label |
|---------------|--------------|
| `[security]`, `[dependency]` | Security |
| `[bug]`, `[async]`, `[shutdown]`, `[edge-case]`, `[type]` | Bug |
| `[memory-leak]`, `[resource-leak]`, `[timeout]`, `[rate-limit]` | Performance |
| `[convention]` | Convention |
| `[dead-code]`, `[duplicate]`, `[test]`, `[practice]`, `[docs]`, `[chore]` | Technical Debt |
| `[feature]` | Feature |
| `[improvement]`, `[enhancement]`, `[refactor]` | Improvement |

**Priority Mapping:**
- `[critical]` → 1 (Urgent)
- `[high]` → 2 (High)
- `[medium]` → 3 (Medium)
- `[low]` → 4 (Low)

**Rules:**
- NO solutions in issue descriptions - identify problems only
- Include file paths in description
- One issue per distinct finding

## Error Handling

| Situation | Action |
|-----------|--------|
| No tsconfig.json or package.json | Use conventions: `src/`, `lib/`, `app/` |
| npm audit fails | Note skip, continue with code audit |
| CLAUDE.md doesn't exist | Skip project-specific checks |
| Linear Backlog query fails | Continue with fresh audit (no existing issues to validate) |
| No existing Backlog issues | Start fresh (skip validation step) |
| Referenced file no longer exists | Mark issue as `fixed`, close in Linear |
| Cannot determine if issue is fixed | Keep as `still_valid` |
| Explore agent times out | Continue with Glob/Grep |
| Large codebase (>1000 files) | Focus on `$ARGUMENTS` area or entry points |

## Rules

- **Analysis only** - Do NOT modify source code
- **No solutions** - Document problems, not fixes
- **Be thorough** - Check every file in scope
- **Be specific** - Include file paths

## Termination

Output this message and STOP:

```
✓ Code audit complete. Findings created as Linear issues in Backlog.

Preserved: P non-audit issues (features, improvements)

Existing Backlog issues:
- A kept (still valid)
- B closed (fixed or superseded)
- C updated (description/priority changed)

New issues created: D

Linear Backlog summary:
- X Urgent/High priority issues
- Y Medium priority issues
- Z Low priority issues

Issue IDs: ADVA-N1, ADVA-N2, ...

Next step: Review Backlog in Linear and use `plan-todo` to create implementation plans.
```

Do not ask follow-up questions. Do not offer to fix issues.
