---
name: code-audit
description: Audits codebase for bugs, security issues, memory leaks, and CLAUDE.md violations. Validates existing TODO.md items, merges with new findings, and writes reprioritized TODO.md. Use when user says "audit", "find bugs", "check security", or "review codebase". Analysis only.
argument-hint: [optional: specific area like "services" or "tests"]
allowed-tools: Read, Edit, Write, Glob, Grep, Task, Bash
disable-model-invocation: true
---

Perform a comprehensive code audit and write findings to TODO.md.

## Pre-flight

1. **Read CLAUDE.md** - Load project-specific rules to audit against (if exists)
2. **Parse TODO.md** - Extract existing items into a tracking list (if exists):
   - For each `## item #N [tag] [priority]` entry, record: number, tag, priority, description, file path
   - **Audit items** (tags like `[bug]`, `[security]`, `[memory-leak]`, etc.) → mark as `pending_validation`
   - **Non-audit items** (tags like `[feature]`, `[improvement]`, `[enhancement]`, `[refactor]`) → mark as `preserve` (skip validation, keep at top)
3. **Read project config** - `tsconfig.json`, `package.json`, `.gitignore` for structure discovery

## Audit Process

Copy this checklist and track progress:

```
Audit Progress:
- [ ] Step 1: Discover project structure
- [ ] Step 2: Validate existing TODO.md items
- [ ] Step 3: Explore discovered areas systematically
- [ ] Step 4: Check CLAUDE.md compliance
- [ ] Step 5: Check dependency vulnerabilities
- [ ] Step 6: Merge, deduplicate, and reprioritize
- [ ] Step 7: Write TODO.md
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

### Step 2: Validate Existing TODO.md Items

For each existing item marked `pending_validation`:

1. **Check if the issue still exists:**
   - Read the referenced file path and line numbers
   - Verify the problematic code is still present
   - Check git history if needed to see if it was fixed

2. **Classify as `fixed` or `pending`:**

   | Status | Criteria | Action |
   |--------|----------|--------|
   | `fixed` | Code corrected or file removed | Remove from TODO.md |
   | `pending` | Issue appears to still exist | Carry forward to Step 6 for final classification |

3. **Track validation results** - Log which items were removed as fixed

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

If CLAUDE.md exists, check project-specific rules. See [references/compliance-checklist.md](references/compliance-checklist.md) for common checks.

### Step 5: Dependency Vulnerabilities

Run the appropriate audit command:
- **Node.js**: `npm audit` or `yarn audit`
- **Rust**: `cargo audit`
- **Python**: `pip-audit` or `safety check`
- **Go**: `govulncheck`

Include critical/high vulnerabilities in findings.

### Step 6: Merge, Deduplicate, and Reprioritize

Now that you have both `pending` existing items and new findings, perform final classification:

1. **Classify pending existing items:**

   | Status | Criteria | Action |
   |--------|----------|--------|
   | `superseded` | New finding covers same issue | Remove (new finding wins) |
   | `needs_update` | Issue exists but line numbers or severity changed | Update description/priority |
   | `still_valid` | Issue unchanged, no overlapping new finding | Keep as-is |

2. **Merge sources:**
   - `still_valid` and `needs_update` existing items
   - New findings from Steps 3-5

3. **Deduplicate:**
   - Same code location → merge into the one with higher priority

4. **Reassess priorities** for the entire combined list:
   - See [references/priority-assessment.md](references/priority-assessment.md) for impact×likelihood matrix
   - Document priority changes with reason

**For category tags, see [references/category-tags.md](references/category-tags.md).**

**For each issue, document:**
- File path and approximate location
- Clear problem description
- Category tag
- Priority level (critical/high/medium/low)

**Do NOT document solutions.** Identify problems only.

### Step 7: Write TODO.md

Format example:

```markdown
# TODO

## item #1 [feature] [high]
Add user authentication endpoint.

## item #2 [improvement] [medium]
Refactor date parsing to use shared utility.

## item #3 [security] [critical]
SQL injection vulnerability in query builder at src/db.ts:45.

## item #4 [bug] [high]
Race condition in cache invalidation at src/cache.ts:120.
```

**Rules:**
- Each item: `## item #N [tag] [priority]`
- Priority: `[critical]`, `[high]`, `[medium]`, or `[low]`
- Content: Simple paragraph explaining the problem
- NO solutions for audit items
- All items renumbered sequentially starting from #1
- **Order:**
  1. Preserved non-audit items (features, improvements) - keep original order
  2. Audit findings by priority: critical → high → medium → low
  3. Within same priority tier: new items first, then validated existing items

## Error Handling

| Situation | Action |
|-----------|--------|
| No tsconfig.json or package.json | Use conventions: `src/`, `lib/`, `app/` |
| npm audit fails | Note skip, continue with code audit |
| CLAUDE.md doesn't exist | Skip project-specific checks |
| TODO.md doesn't exist | Create new (skip validation step) |
| TODO.md empty or malformed | Treat as no existing items |
| Referenced file no longer exists | Mark item as `fixed` |
| Cannot determine if item is fixed | Keep as `still_valid` |
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
✓ Code audit complete. Findings written to TODO.md.

Preserved: P non-audit items (features, improvements)

Existing audit items:
- A kept (still valid)
- B removed (fixed or superseded)
- C updated (description/priority changed)

New findings: D issues

Final TODO.md: N total items
- P non-audit (top)
- X critical/high priority
- Y medium priority
- Z low priority

Next step: Review TODO.md and use `plan-todo` to create implementation plans.
```

Do not ask follow-up questions. Do not offer to fix issues.
