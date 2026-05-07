---
name: code-audit
description: Audits codebase using an agent team with 3 domain-specialized reviewers (security, reliability, quality). Triages open Sentry issues (creates Linear issues for real bugs, resolves/ignores noise). Creates Linear issues in Backlog state for findings. Use when user says "audit", "find bugs", "check security", "review codebase", or "team audit". Higher token cost, faster and deeper analysis. Falls back to single-agent mode if agent teams unavailable.
argument-hint: [optional: specific area like "services" or "gemini"]
allowed-tools: Read, Glob, Grep, Task, Bash, TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet, mcp__linear__list_teams, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__update_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses, mcp__sentry__find_organizations, mcp__sentry__find_projects, mcp__sentry__search_issues, mcp__sentry__get_issue_details, mcp__sentry__analyze_issue_with_seer, mcp__sentry__update_issue
disable-model-invocation: true
---

Perform a comprehensive code audit using an agent team with domain-specialized reviewers. You are the **team lead/coordinator**. You orchestrate 3 reviewer teammates who scan the codebase in parallel, then you merge findings and create Linear issues.

**If agent teams are unavailable** (TeamCreate fails), fall back to single-agent mode — see "Fallback: Single-Agent Mode" section.

## Pre-flight

1. **Verify Linear MCP** — Call `mcp__linear__list_teams`. If unavailable, STOP and tell the user: "Linear MCP is not connected. Run `/mcp` to reconnect, then re-run this skill."
2. **Read CLAUDE.md** — Load project-specific rules to audit against (if exists). **Discover team name:** Look for LINEAR INTEGRATION section in CLAUDE.md. If not found, use `mcp__linear__list_teams` to discover the team name dynamically.
3. **Query Linear Backlog** — Get existing issues using `mcp__linear__list_issues` with:
   - `team`: [discovered team name]
   - `state`: "Backlog"
   - `includeArchived`: false
   - For each issue, record: ID, title, labels, priority, description
   - **Audit issues** (labels: Bug, Security, Performance, Convention, Technical Debt) → mark as `pending_validation`
   - **Non-audit issues** (labels: Feature, Improvement) → mark as `preserve` (skip validation)
4. **Discover project structure** — Read `tsconfig.json`, `package.json`, `.gitignore` in parallel
   - Use Glob with patterns from tsconfig.json `include` to identify source directories
   - If no tsconfig, use conventions: `src/`, `lib/`, `app/`, `packages/`
5. **Run `npm audit`** — Capture critical/high dependency vulnerabilities for later
6. **Discover Sentry context** — Call `mcp__sentry__find_organizations` to discover org slug, then `mcp__sentry__find_projects` with org slug to find the project. If Sentry MCP unavailable, skip Sentry triage later (warn user).
7. **Fetch unresolved Sentry issues** — Call `mcp__sentry__search_issues` with org slug and project slug, query: "unresolved issues". Record each issue's ID, title, URL, event count, user count, last seen date. If none found, skip Sentry Triage phase later.

## Team Setup

### Create the team

Use `TeamCreate`:
- `team_name`: "code-audit"
- `description`: "Parallel code audit with domain-specialized reviewers"

**If TeamCreate fails**, switch to Fallback: Single-Agent Mode (see below).

### Create tasks

Use `TaskCreate` to create 3 review tasks (these track progress for each reviewer):

1. **"Security audit"** — Security & auth review of the codebase
2. **"Reliability audit"** — Bugs, async, resources, memory leaks, timeouts
3. **"Quality audit"** — Type safety, conventions, logging, tests, dead code

### Spawn 3 reviewer teammates

Use the `Task` tool with `team_name: "code-audit"`, `subagent_type: "general-purpose"`, and `model: "sonnet"` to spawn each reviewer. Give each a `name` and a detailed `prompt` (see Reviewer Prompts below).

Spawn all 3 reviewers in parallel (3 concurrent Task calls in one message).

**IMPORTANT:** Each reviewer prompt MUST include:
- Their specific domain checklist (copied from the Reviewer Prompts section)
- The focus area if `$ARGUMENTS` specifies one
- The list of existing `pending_validation` issues relevant to their domain (so they can validate them)
- Instructions to report findings as a structured message to the lead

### Assign tasks

After spawning, use `TaskUpdate` to assign each task to its reviewer by name.

## Reviewer Prompts

Each reviewer gets a tailored prompt. Include the full text below in each reviewer's spawn prompt, substituting the domain-specific section.

### Common Preamble (include in ALL reviewer prompts)

```
You are a code audit reviewer for this project. Your job is to scan the ENTIRE codebase and find issues in your assigned domain.

RULES:
- Analysis only — do NOT modify any source code
- Do NOT create Linear issues — report findings to the team lead
- No solutions — document problems only, not fixes
- Be specific — include file paths and approximate line numbers
- Be thorough — check every file in scope (full pass; do not skip files because nothing changed)
- Focus area: {$ARGUMENTS or "entire codebase"}

PROJECT CONTEXT:
- Language: TypeScript (strict mode, ESM with .js extensions)
- Framework: Fastify (REST API server)
- Build: tsc (TypeScript compiler)
- Test: Vitest
- Architecture: Routes → Services → Processing (queue, scanner, extractor, matching, storage)
- Source path: src/
- Test files: Colocated as *.test.ts (e.g., src/services/document-sorter.test.ts)
- Google APIs (Drive, Sheets) for document storage
- Gemini API for document extraction (LLM01 indirect prompt injection surface — document text reaches the LLM)
- Pino logger (never console.log)
- Result<T,E> pattern for error handling
- ADVA CUIT: 30709076783

SECURITY FRAMEWORKS TO APPLY:
- OWASP Top 10 2025 RC (note A03 is now Software Supply Chain Failures, A10 is new Mishandling of Exceptional Conditions / failing-open)
- OWASP LLM Top 10 2025 (LLM01 prompt injection, LLM02/07 prompt leakage, LLM10 unbounded consumption)
- CWE Top 25 (especially CWE-862 Missing Authorization, CWE-22 Path Traversal, CWE-1390 unscoped API keys)

WORKFLOW:
1. Read CLAUDE.md for project-specific rules
2. Read .claude/skills/code-audit/references/compliance-checklist.md for detailed audit checks in your domain
3. Discover all source files using Glob (check tsconfig.json include patterns)
4. Read each source file systematically
5. Use Grep to search for specific patterns (see your checklist AND the compliance checklist)
6. Validate any existing issues assigned to you (check if code still has the problem)
7. When done, send your findings to the lead using SendMessage

EXISTING ISSUES TO VALIDATE:
{list of pending_validation issues relevant to this reviewer's domain}
For each, check if the referenced code still has the problem. Report as:
- FIXED: [issue ID] - [reason]
- STILL EXISTS: [issue ID]

FINDINGS FORMAT - Send a message to the lead with this structure:
---
DOMAIN: {domain name}
VALIDATED EXISTING ISSUES:
- FIXED: ADVA-XX - [reason]
- STILL EXISTS: ADVA-YY

NEW FINDINGS:
1. [category-tag] [priority-tag] [file-path:line] - [description]
2. [category-tag] [priority-tag] [file-path:line] - [description]
...

Category tags: [security], [supply-chain], [prompt-injection], [failing-open], [bug], [async], [memory-leak], [resource-leak], [timeout], [shutdown], [edge-case], [type], [convention], [logging], [dependency], [rate-limit], [dead-code], [duplicate], [test], [practice], [docs], [chore]
Priority tags: [critical], [high], [medium], [low]

Multi-location findings: if the same issue appears in multiple files (e.g., a logging anti-pattern in 12 files), report it ONCE with all file:line locations listed; do not emit one finding per occurrence.
---
```

### Security Reviewer Prompt (name: "security-reviewer")

Append to the common preamble:

```
YOUR DOMAIN: Security, Authentication, Supply Chain, and LLM/AI Surface

Focus areas (full details in compliance-checklist.md, sections "Security (OWASP 2025 RC)" and "LLM / AI Security (OWASP LLM Top 10 2025)"):

WEB / SERVER POSTURE:
- A01:2025 Broken Access Control (auth middleware, IDOR, privilege escalation, SSRF folded in)
- A02:2025 Security Misconfiguration (debug modes off, default creds removed, verbose errors disabled)
- A03:2025 Software Supply Chain Failures — operationalize the slopsquatting check:
    * Every import resolves to a package declared in package.json
    * Lockfile present with integrity SHAs; no '*' or 'latest' for production deps
    * No suspicious postinstall/preinstall scripts
- A04:2025 Cryptographic Failures (HTTPS, no homemade crypto, constant-time compare for tokens)
- A05:2025 Injection (SQL, command, path traversal CWE-22, XSS CWE-79, header injection)
- A07:2025 Authentication Failures (Bearer token validation, webhook channel ID validation)
    * CWE-1390: GEMINI_API_KEY scoped to Generative Language API only
- A10:2025 Mishandling of Exceptional Conditions / failing-open — flag any path that continues unsafely on lock-fail / retry-exhausted / config-missing / sheet-renamed
- Security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Permissions-Policy, Referrer-Policy)
- Sensitive data hygiene: no secrets in logs / errors / responses

LLM / AI POSTURE (Gemini integration is the primary AI surface):
- LLM01 Prompt Injection (DIRECT and INDIRECT):
    * Search for any path where document text, file name, or webhook payload is concatenated into the system/instruction section of a Gemini prompt instead of a clearly delimited data section
    * Verify invisible-text stripping pre-prompt (white-on-white text, font-size 0, off-page text in PDFs — Snyk has documented this exploit class on invoice pipelines)
    * Verify output classifier — document type, ADVA role, CUITs, amounts validated regardless of LLM output
- LLM02 / LLM07 System Prompt / Sensitive Info Leakage:
    * Prompt templates from src/gemini/prompts.ts not echoed in error messages, log lines, or HTTP responses
    * Service account / API key strings cannot leak via stack traces or webhook responses
- LLM10 Unbounded Consumption — explicit ceilings:
    * Per-request token cap (maxOutputTokens, input-side guard)
    * Per-minute / per-day budget
    * Payload size cap before reaching Gemini
    * Concurrency cap on in-flight Gemini calls
- LLM05 Improper Output Handling — schema validation on every Gemini response field consumed downstream

Search patterns (use Grep):
- password|secret|api.?key|token (case insensitive) — potential hardcoded secrets
- eval\(|new Function\( — dangerous code execution
- exec\(|spawn\( with variable input — command injection
- fetch\(.*\$|fetch\(.*\+ — potential SSRF
- Log statements containing password|secret|token|key|auth|headers|req\.body
- Imports referencing packages not in package.json (slopsquatting)
- Gemini prompt assembly: search for prompts.ts callers; trace whether document content reaches the system role
- Empty catches `catch\s*\([^)]*\)\s*\{\s*\}` — failing-open candidates
```

### Reliability Reviewer Prompt (name: "reliability-reviewer")

Append to the common preamble:

```
YOUR DOMAIN: Bugs, Async, Resources, Reliability, Failing-Open Paths

Focus areas (full details in compliance-checklist.md):
- Logic errors — off-by-one, empty collections, wrong comparisons, floating-point monetary tolerance
- Null/undefined handling — nullable types, missing null checks
- Race conditions — shared state, concurrent access. Specifically:
    * Processing lock (PROCESSING_LOCK_ID) acquired/released in ALL paths including errors
    * Lock state set atomically (Map.set with all fields, no await between check and set)
    * Scan state machine (idle/pending/running) check-and-set is synchronous (no await inside the transition)
- Async issues — unhandled promises, missing try/catch, Promise.all error handling (Promise.allSettled where partial success is OK)
- Memory leaks — unbounded collections, event listeners, timers, closures (Gemini responses, file buffers held by closures)
- Resource leaks — connections, file handles, streams not cleaned up
- Timeout/hang — HTTP requests without timeout; Gemini, Drive, Sheets, Railway, ArgentinaDatos all need explicit timeouts
- Graceful shutdown — SIGTERM/SIGINT handlers, cleanup, request draining, lock release
- Boundary conditions — empty inputs, max-size, negative/zero, Spanish-language characters

A10:2025 FAILING-OPEN (high priority — biggest 2025 OWASP addition):
For each external call / lock acquire / config check / parse, ask "what state is the system in if this fails?":
- Lock acquisition fails → does scan run unprotected? Must skip.
- 3rd Gemini retry fails → does processing continue with partial / null extraction? File must move to Sin Procesar.
- API_BASE_URL unset → must explicitly disable webhooks / Apps Script sync, not silently no-op.
- ENVIRONMENT unset in production → flag (verify intended fail-closed behavior).
- Sheet tab renamed / missing → must fail loudly, not write to tab index 0.
- Folder structure changed (old vs new format) → every path handles both or refuses; no silent fallback.
- Empty catches and swallowed errors anywhere on critical paths.
- Partial-success states left dangling: file extracted but storage failed; row written but match update failed; bank movement matched but pagada-sync failed.

ERROR CLASSIFICATION CORRECTNESS:
- Transient errors (Gemini JSON parse, network 5xx, 429): retried with 10s/30s/60s backoff
- Permanent errors (4xx auth/validation, malformed PDF, unknown doc type): NOT retried; file moves to Sin Procesar immediately
- Verify the classification logic doesn't silently retry permanent errors or treat permanent as transient

WEBHOOK IDEMPOTENCY:
- Drive can replay webhooks. Handler must be safe under replay.
- No duplicate processing, duplicate row writes, or duplicate Linear issues.

Search patterns (use Grep):
- \.then\( without .catch — unhandled promise
- async functions — verify try/catch coverage in critical paths
- Promise\.all — verify error handling
- \.on\( — event listeners (check cleanup)
- setInterval — timers (check clearInterval)
- setTimeout in loops — potential accumulation
- new Map\(|new Set\(|\[\] at module level — potential unbounded growth
- catch\s*\([^)]*\)\s*\{\s*\} — empty catches (failing-open)
- Critical await inside try blocks — verify error path doesn't continue to dependent code
```

### Quality Reviewer Prompt (name: "quality-reviewer")

Append to the common preamble:

```
YOUR DOMAIN: Type Safety, Project Conventions, Logging, Test Quality, Spreadsheet Schema Integrity

Focus areas (full details in compliance-checklist.md):

TYPE SAFETY:
- Unsafe `any` casts, incorrect type assertions, missing exhaustive handling
- External data used without validation (Drive responses, Sheets responses, Gemini outputs, webhook payloads)
- Missing runtime validation for API inputs (zod, io-ts, or manual)
- Schema validation at the AI boundary: every Gemini response field consumed downstream must be validated (numeric / enum / length / presence)

CLAUDE.md COMPLIANCE (read CLAUDE.md first — these are hard rules):
- ESM `.js` extensions on every relative import: `from './x.js'` (search for `from '\.\/[^']+'$` without `.js`)
- `interface` for object shapes, no `any` / `as any` / `as unknown as` without justification
- No `@ts-ignore` / `@ts-expect-error` without comment
- Result<T,E> pattern for fallible operations
- Pino logger from utils/logger.ts; no `console.log/warn/error` in production code
- Naming: kebab-case files, PascalCase types, camelCase functions/vars, UPPER_SNAKE_CASE constants

SPREADSHEET SCHEMA (CRITICAL — production data integrity):
- CellDate type for every date field written
- CellNumber type for every monetary field
- Script-generated timestamps (processedAt, API usage) use spreadsheet timezone via getSpreadsheetTimezone()
- Parsed timestamps from documents (fechaEmision, fechaPago) DO NOT use spreadsheet timezone
- Reading dates: ALWAYS normalizeSpreadsheetDate(cellValue), NEVER String(row[i]) for CellDate cells
- Column counts and order match SPREADSHEET_FORMAT.md
- Hardcoded column indices should reference constants/spreadsheet-headers.ts

MATCHING SEMANTICS (verify the system invariants):
- MANUAL match locking: facturas/recibos/pagos/movimientos with MANUAL excluded from auto-rematch
- MANUAL beats `?force=true`
- Tier-based ranking with hard CUIT identity filter (no fall-through to lower tiers when CUIT found)
- Cross-currency tolerance ±5%, tier 1-3 → MEDIUM, tier 4-5 → LOW
- ADVA CUIT 30709076783 direction detection drives Ingresos/Egresos routing
- Movimientos → Pagada sync runs after every matchAllMovimientos

LOGGING:
- Wrong logger (console.* vs Pino), wrong log levels
- Missing logs in error paths, lib modules with zero logging
- Double-logging (same error at multiple layers — service AND route)
- Missing structured fields { action, module?, phase? }, missing durationMs on external API calls (Gemini, Drive, Sheets, Railway, ArgentinaDatos)
- Log overflow risks (logging in loops, JSON.stringify of large objects)
- Sensitive data in logs (password, token, API key, auth, headers, req.body)
- Pino redaction config (if present) bypassed by raw object logging
- LLM02 system prompt leakage: prompts.ts content echoed in error messages or response bodies

TEST QUALITY:
- Tests with no meaningful assertions or that always pass
- Mocks that hide real bugs — particularly extractor / Gemini mocks that mask contract drift
- Missing edge case coverage (empty inputs, error paths, MANUAL locks, cross-currency)
- Test data uses fictional CUITs (20123456786, 27234567891, 20111111119); ADVA CUIT 30709076783 is OK
- No real customer data, no production credentials

Search patterns (use Grep):
- `as any` — unsafe type cast
- `as unknown as` — double cast (check CLAUDE.md accepted patterns first)
- `@ts-ignore|@ts-expect-error` — suppressed type errors
- `console\.log|console\.warn|console\.error` — should use Pino logger
- `catch\s*\([^)]*\)\s*\{[^}]*\}` — empty catch blocks
- `from '\./` and `from '\.\./` without `.js` extension — ESM violation
- `String\(row\[` in spreadsheet read paths — should be `normalizeSpreadsheetDate`
- `logger\.(info|warn|error)\("[^"]+"\)` without object first arg — string-only logs
```

## Coordination (while reviewers work)

While waiting for reviewer messages:
1. Reviewer messages are **automatically delivered** to you — do NOT poll or manually check inbox
2. Teammates go idle after each turn — this is normal. An idle notification does NOT mean they are done. They are done when they send their findings message.
3. Track progress via `TaskList` — check which tasks are in progress vs completed
4. As each reviewer sends findings, acknowledge receipt
5. Wait until ALL 3 reviewers have reported before proceeding to merge

**If a reviewer gets stuck or stops without reporting:** Send them a message asking for their findings. If they don't respond, note that domain as "incomplete" in the final report.

## Merge & Deduplicate

Once all reviewer findings are collected:

### Validate existing issues

Combine validation results from all 3 reviewers:
- Issues reported as FIXED by any reviewer → close in Linear with comment
- Issues reported as STILL EXISTS → carry forward

### Classify pending existing issues

| Status | Criteria | Action |
|--------|----------|--------|
| `superseded` | New finding covers same issue | Close issue (new finding wins) |
| `needs_update` | Issue exists but line numbers or severity changed | Update issue description/priority |
| `still_valid` | Issue unchanged, no overlapping new finding | Keep as-is |

### Deduplicate new findings

- **Same code location, multiple reviewers** → merge into the one with higher priority. **Consensus boost:** if 2+ reviewers independently flag the same location/category, raise priority one tier (medium → high, high → critical). Independent corroboration is meaningful signal.
- **Same root cause, multiple locations** → emit ONE parent issue with the full file:line list in the Context section, not one issue per occurrence. A logging anti-pattern in 12 files is one issue, not twelve.
- **Multi-domain finding** (e.g., a missing validation that's both a security issue and a reliability issue) → keep the most actionable framing; reference the secondary domain in the description.

### Reassess priorities

Severity × Likelihood:

| | High Likelihood | Medium Likelihood | Low Likelihood |
|---|---|---|---|
| **High Impact** | Critical | Critical | High |
| **Medium Impact** | High | Medium | Medium |
| **Low Impact** | Medium | Low | Low |

Then, for each finding, **emit an SSVC Action** (Act / Attend / Track) based on:
1. **Exploitation status** — None / PoC / Active
2. **Mission impact** — Negligible / Degraded / Crippled (does it affect ADVA's ability to process invoices and matches correctly?)
3. **Technical impact** — Partial / Total

Mapping:
- **Act** → Linear priority 1 (Urgent). Active exploitation, OR Crippled mission, OR security with Total technical impact.
- **Attend** → Linear priority 2 (High) or 3 (Medium). Real bug with Degraded mission, OR PoC exploitation, OR Total technical impact without exploitation.
- **Track** → Linear priority 4 (Low). Negligible mission, no exploitation, Partial technical (style, dead code, low-value docs).

The SSVC Action gets written into every Linear issue body — see Issue Description Format.

## Verification

Before creating Linear issues, the lead **verifies every candidate finding** by re-reading the cited file:line. This step exists because reviewer agents — even careful ones — produce a measurable false-positive rate (stale references, wrong line numbers, hallucinated patterns). Anthropic's own multi-agent code review reports ~87% FP reduction from a verification step; the cost is real but the backlog cost of noise is higher.

For each candidate finding:

1. **Read the cited file** at the cited line range (read ±10 lines for context).
2. **Confirm the issue exists today.** Look at the actual code, not the reviewer's description. Ask: would I file this issue if I were seeing it for the first time?
3. **Decide:**
   - **Confirmed** — the issue is real → keep
   - **Stale reference** — the file or function moved, but the issue may still exist elsewhere → search for it; if found, update the location and keep; if not, drop
   - **Hallucinated** — the cited code doesn't match the description → drop
   - **Out of scope** — the file is third-party / generated / explicitly excluded → drop
   - **Already fixed** — code has changed since the reviewer read it → drop, note in report
4. **Track verification stats** for the termination report: confirmed / stale-fixed / dropped counts.

**Do not skip this step**, even when the lead is confident in the reviewers. It's the single highest-leverage step for backlog quality.

In **single-agent fallback mode**, the verification pass is the same — re-read the cited locations from your own merged finding list before creating issues.

## Create Linear Issues

For each new finding, use `mcp__linear__create_issue`:

```
team: [discovered team name]
state: "Backlog"
title: "[Brief description of the issue]"
description: (see Issue Description Format below)
priority: [1|2|3|4] (mapped from critical/high/medium/low)
labels: [Mapped label(s)]
```

**Issue Description Format:**

```
**Problem:**
[Clear, specific problem statement — 1-2 sentences]

**Context:**
[Affected file paths with line numbers, e.g. `src/services/broker.ts:120-135`. For multi-location findings, list every site.]

**Impact:**
[Why this matters — user-facing impact, data integrity, security risk, etc.]

**Action:** Act | Attend | Track
[SSVC outcome — see references/category-tags.md for the decision rules. Tells planning skills "what to do" alongside the priority number.]

**Acceptance Criteria:**
- [ ] [Specific, verifiable criterion — e.g. "CUIT validation returns error for invalid check digits"]
- [ ] [Another criterion]
```

**Label Mapping:**

| Category Tags | Linear Label |
|---------------|--------------|
| `[security]`, `[dependency]`, `[supply-chain]`, `[prompt-injection]` | Security |
| `[bug]`, `[async]`, `[shutdown]`, `[edge-case]`, `[type]`, `[logging]`, `[failing-open]` | Bug |
| `[memory-leak]`, `[resource-leak]`, `[timeout]`, `[rate-limit]` | Performance |
| `[convention]` | Convention |
| `[dead-code]`, `[duplicate]`, `[test]`, `[practice]`, `[docs]`, `[chore]` | Technical Debt |

**Priority Mapping:**
- `[critical]` → 1 (Urgent)
- `[high]` → 2 (High)
- `[medium]` → 3 (Medium)
- `[low]` → 4 (Low)

**Rules:**
- NO solutions in issue descriptions — acceptance criteria define "done", not how to get there
- Include file paths with line numbers in Context
- One issue per distinct finding

## Sentry Triage

After creating Linear issues from audit findings, triage all unresolved Sentry issues discovered in pre-flight. The lead handles this directly (not reviewers).

**Skip this section if:** Sentry MCP was unavailable during pre-flight, or no unresolved Sentry issues were found.

### For each unresolved Sentry issue:

1. **Get details** — Call `mcp__sentry__get_issue_details` to get the full stacktrace and context
2. **Locate in codebase** — Read the referenced files/lines from the stacktrace
3. **Cross-reference** — Check if:
   - An audit finding already covers this issue (from the reviewer phase)
   - A Linear issue already exists for this (from pre-flight backlog query)
4. **Decide disposition:**

| Disposition | When | Action |
|---|---|---|
| **Fix needed** | Real bug in current code, not yet tracked | Create Linear issue with Sentry link (see format below) |
| **Already tracked** | Linear issue already exists for this | Skip — note in report |
| **Already covered** | Audit finding already captures this | Skip — audit finding handles it |
| **Already fixed** | Code has been changed, or a completed plan already addresses it | `mcp__sentry__update_issue` with `status: "resolved"` |
| **Noise/transient** | One-off error, expected behavior, test data, transient network issue | `mcp__sentry__update_issue` with `status: "ignored"` |

### Linear Issue Format (for fix-needed Sentry issues)

Use `mcp__linear__create_issue` following the add-to-backlog pattern:

```
team: [discovered team name]
state: "Backlog"
title: "[Brief description from Sentry issue]"
priority: [1|2|3|4] based on event count, user impact, severity
labels: [Bug]
```

**Description format:**

```
**Problem:**
[What is happening — from Sentry stacktrace and context]

**Sentry Issue:**
[Sentry issue URL] — [event count] events, [user count] users, last seen [date]

**Context:**
[Affected file paths with line numbers from stacktrace]

**Impact:**
[User-facing impact based on event frequency and severity]

**Action:** Act | Attend | Track
[SSVC outcome based on user count, event count, and operational impact]

**Acceptance Criteria:**
- [ ] [Specific fix criterion]
- [ ] Error no longer appears in Sentry after fix deployed
```

## Shutdown Team

After all Linear issues are created and Sentry triage is complete:
1. Send shutdown requests to all 3 reviewers using `SendMessage` with `type: "shutdown_request"`
2. Wait for shutdown confirmations
3. Use `TeamDelete` to remove team resources

## Fallback: Single-Agent Mode

If `TeamCreate` fails (agent teams unavailable), perform the audit sequentially as a single agent:

1. **Inform user:** "Agent teams unavailable. Running audit in single-agent mode."
2. **Validate existing issues** — For each `pending_validation` issue, check if the referenced code still has the problem. Close fixed issues, carry forward valid ones.
3. **Systematic exploration** — Use Task tool with `subagent_type=Explore` to examine each discovered area. Apply the full compliance checklist:
   - **Security** — OWASP Top 10 2025 (especially A03 Supply Chain Failures, A10 Failing-Open) and OWASP LLM Top 10 2025 (LLM01 prompt injection, LLM02/07 leakage, LLM10 unbounded consumption)
   - **Reliability** — Logic errors, null handling, race conditions, async issues, memory/resource leaks, timeout/hang, graceful shutdown, error classification correctness, webhook idempotency
   - **Quality** — Type safety, project conventions (Result<T,E>, ESM .js, Pino logger, spreadsheet schema integrity), logging, test quality
   - Always do a full pass — never skip files because they look unchanged.
   See [references/compliance-checklist.md](references/compliance-checklist.md) for detailed checks.
4. **CLAUDE.md compliance** — Check project-specific rules
5. **Merge, deduplicate, reprioritize** — Same process as team mode (multi-issue rollup; consensus boost from corroboration; SSVC Action assignment).
6. **Verification** — Same process as team mode. Re-read every candidate finding's file:line before creating the Linear issue. Do not skip this in fallback mode — it's where most of the FP reduction comes from.
7. **Create Linear issues** — Same process as team mode (see Create Linear Issues section)
8. **Sentry triage** — Same process as team mode (see Sentry Triage section)

## Error Handling

| Situation | Action |
|-----------|--------|
| Linear MCP not connected | STOP — tell user to run `/mcp` |
| No tsconfig.json or package.json | Use conventions: `src/`, `lib/`, `app/` |
| npm audit fails | Note skip, continue |
| CLAUDE.md doesn't exist | Skip project-specific checks (tell quality-reviewer) |
| Linear Backlog query fails | Continue with fresh audit (no existing issues) |
| No existing Backlog issues | Start fresh (skip validation in reviewer prompts) |
| TeamCreate fails | Switch to single-agent fallback mode |
| Reviewer stops without reporting | Send follow-up message, note domain as incomplete |
| Referenced file no longer exists | Mark issue as `fixed`, close in Linear |
| Cannot determine if issue is fixed | Keep as `still_valid` |
| Large codebase (>1000 files) | Tell reviewers to focus on `$ARGUMENTS` area or entry points |
| Sentry MCP not connected | Skip Sentry triage, warn user |
| No unresolved Sentry issues | Skip Sentry triage phase |
| Sentry issue references deleted file | Mark as `resolved` |
| Cannot determine if Sentry issue is fixed | Create Linear issue to investigate |

## Rules

- **Analysis only** — Do NOT modify source code
- **No solutions** — Document problems, not fixes
- **Lead handles all Linear writes** — Reviewers NEVER create issues directly
- **Deduplicate before creating** — No duplicate issues in Linear
- **Be thorough** — Every file in scope must be checked
- **Sentry triage is lead-only** — Reviewers never interact with Sentry; the lead triages all Sentry issues after merging audit findings
- **Sentry issues that need fixes get Linear issues** — Always include the Sentry issue URL in the description so downstream planning skills can track it

## Termination

Output this report and STOP:

```
## Code Audit Report

**Team:** 3 reviewers (security, reliability, quality) + lead verification
[OR: **Mode:** single-agent (team unavailable)]
**Preserved:** P non-audit issues (features, improvements)

### Existing Backlog Issues

- A kept (still valid)
- B closed (fixed or superseded)
- C updated (description/priority changed)

### Verification Stats

- Candidate findings reported by reviewers: T
- Confirmed: C
- Stale-but-fixed in new location: S
- Dropped (hallucinated / out of scope / already fixed): D

### New Issues (ordered by SSVC Action, then priority)

| # | ID | Action | Priority | Label | Title |
|---|-----|--------|----------|-------|-------|
| 1 | ADVA-N1 | Act | Urgent | Security | Brief title |
| 2 | ADVA-N2 | Attend | High | Bug | Brief title |
| ... | ... | ... | ... | ... | ... |

X issues total | Multi-location rollups: R | Consensus-boosted: B | Duplicates merged: M

### Sentry Triage

| # | Sentry Issue | Disposition | Action |
|---|---|---|---|
| 1 | ADVA-SENTRY-N | Fix needed | Created ADVA-XX in Backlog |
| 2 | ADVA-SENTRY-N | Already fixed | Resolved in Sentry |
| 3 | ADVA-SENTRY-N | Noise | Ignored in Sentry |
| ... | ... | ... | ... |

[OR: No unresolved Sentry issues found.]
[OR: Sentry MCP unavailable — triage skipped.]

Next step: Review Backlog in Linear and use `plan-backlog` to create implementation plans.
```

Do not ask follow-up questions. Do not offer to fix issues.
