# ADVA Administración Server

## STATUS: PRODUCTION
Two environments: **production** and **staging**. Changes to persistent data (spreadsheets, folder structure) must be backwards-compatible or include a migration path. Spreadsheet schema changes require startup migration logic. Folder structure changes require graceful handling of old and new formats. API changes are fine — the API is internal, consumed only by the co-deployed Apps Script. Delete unused code only when safe (no production data depends on it).

## DOCUMENTATION

| Document | Audience | Description |
|----------|----------|-------------|
| `CLAUDE.md` | Developers | Technical reference for development |
| `SPREADSHEET_FORMAT.md` | Developers | Complete schema for all spreadsheets |
| `OPERATION-MANUAL.es.md` | End users | Day-to-day operation guide (Spanish) |
| `README.md` | Developers | Project overview and setup |
| `DEVELOPMENT.md` | Developers | Development environment setup |

## CRITICAL RULES (ALWAYS FOLLOW)

1. **TDD is mandatory** - Write test BEFORE implementation code. No exceptions.
2. **Zero warnings** - Build must have zero warnings
3. **No console.log** - Use Pino logger from `utils/logger.ts`
4. **ESM imports** - Always use `.js` extensions in imports
5. **Result<T,E> pattern** - Use for all error-prone operations
6. **Update this file** - When architecture changes

## TDD WORKFLOW

Every new function/feature follows this sequence:

1. Write failing test that defines expected behavior
2. Run `verifier` agent - confirm test fails (red)
3. Write minimal implementation code
4. Run `verifier` agent - confirm test passes (green)
5. Refactor while keeping tests green

**Coverage requirement:** >=80%

### Post-Implementation Checklist

After completing work, run these agents in order:
1. `bug-hunter` - Review git changes for bugs - Fix any issues found
2. `verifier` - Verify all tests pass and zero warnings - Fix any issues

### TDD in Plans

Each implementation task MUST include writing tests as its first step. Example:
```
Task: Add parseResumenBroker function
1. Write test in parser.test.ts for parseResumenBrokerResponse
2. Run verifier (expect fail)
3. Implement parseResumenBrokerResponse in parser.ts
4. Run verifier (expect pass)
```

### Plan Requirements

**No manual steps:** Plans must NEVER include manual verification steps for humans. All verification must be automated through agents:
- Testing and build validation: Use `verifier` agent
- Bug detection: Use `bug-hunter` agent

**Every plan must end with the post-implementation checklist** (see below).

## SUBAGENTS

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `bug-hunter` (sonnet) | Find bugs in git changes | After implementation, before commit |
| `verifier` (haiku) | Run tests, lint, and build | TDD mode: `verifier "pattern"` (filtered tests via `npx vitest run`, no lint/build). Full mode: `verifier` (all tests + lint + build). Use TDD mode during development, Full mode for final verification. |
| `pr-creator` (sonnet) | Branch + commit + push + PR | Only when user requests PR |

**Git agents rule:** Never commit or create PRs unless the user explicitly requests it. When requested, use `pr-creator` agent (handles branch, commit, push, and PR).

**Skills/Agents modification rule:** ALWAYS load the `tools-improve` skill BEFORE creating, editing, or reviewing any `.claude/skills/` or `.claude/agents/` file. This skill contains critical best practices that must be followed.

## SKILLS

Skills are specialized workflows in `.claude/skills/`. Most are `disable-model-invocation: true` (side effects — only the user can launch them via `/name`); this table is what routes requests to them, so suggest the matching `/skill` when a request fits. `investigate` (read-only) and `tools-improve` are model-invocable — invoke them directly when triggered.

| Skill | When to Invoke |
|-------|----------------|
| `add-to-backlog` | Add issues to Linear Backlog from free-form input. Use when user says "add to backlog", "create backlog issues", "track this", or describes tasks/improvements/bugs to add. |
| `backlog-refine` | Refine vague Backlog issues into well-specified, actionable items. Use when user says "refine backlog", "refine ADV-123", "improve backlog items". |
| `investigate` | Read-only investigation that reports findings without creating plans. Use when user says "investigate", "check why", "look into", "diagnose". Accesses Railway logs, Drive files, Gemini prompts. |
| `plan-backlog` | Convert Linear Backlog issues into TDD implementation plans. Use when user says "plan ADV-123", "plan all bugs", or wants to work on backlog items. Moves planned issues to Todo state. |
| `plan-inline` | Create TDD plans from direct feature requests. Use when user provides a task description like "add X feature" or "create Y function". Creates Linear issues in Todo state. |
| `plan-fix` | Investigate bugs and create fix plans. Use when user reports extraction errors, deployment failures, wrong data, or prompt issues. Creates Linear issues in Todo state. |
| `plan-implement` | Execute the pending plan in PLANS.md using an agent team for parallel implementation. Spawns workers in isolated git worktrees. Updates Linear issues: Todo→In Progress→Review. Falls back to single-agent mode if teams unavailable. |
| `plan-review-implementation` | QA review using an agent team with 3 domain-specialized reviewers (security, reliability, quality). Moves issues Review→Merge. Small bugs (≤3 S-size) are fixed inline (issues created in Merge); bigger ones get a Fix Plan with issues in Todo. On plan completion creates the PR and launches a self-terminating Codex-review/CI monitor cron that squash-merges when clean. Falls back to single-agent mode if teams unavailable. |
| `code-audit` | Audit codebase using an agent team with 3 domain-specialized reviewers. Creates Linear issues in Backlog. Falls back to single-agent mode if teams unavailable. |
| `data-ops` | Data operations operator. Fix extraction errors, match/unmatch documents and bank movements, correct parsed data, review flagged items, suggest matches, move/rename/copy/upload files. Use when user says "data ops", "fix data", "correct", "manual match", "fix match", "unmatch", "show unmatched", "review matches", "fix extraction", "match movimiento", "move file", "rename file", "copy file", "upload file", "ingest file", "suggest matches". |
| `deep-review` | Deep, focused analysis of a single feature or service area. Combines code correctness, security, data integrity, and performance in one unified high-effort pass. Use when user says "deep review X". |
| `roadmap` | Deep research and discussion of a roadmap feature or new idea. Gathers context, presents analysis, discusses, then handles the outcome — write to roadmap, pull to backlog, plan, modify, or drop. Use when user says "roadmap", "pull from roadmap", "push to roadmap", "add to roadmap", "analyze this feature". |
| `push-to-production` | Release to production: version bump, changelog, push to main + release, verify Railway production deploy, GitHub Release, Linear state transitions. Use when user says "push to production", "release", or "ship it". |
| `tools-improve` | **REQUIRED before modifying skills/agents.** Contains best practices for `.claude/skills/` and `.claude/agents/`. ALWAYS load this skill FIRST when: creating, editing, or reviewing any SKILL.md or agent .md file. |

**Skill workflow:** `add-to-backlog` or `code-audit` → (`backlog-refine`) → `plan-backlog` → `plan-implement` → `plan-review-implementation` (repeat until COMPLETE) → `push-to-production`

## MCP SERVERS

### Railway MCP (READ-ONLY)

**Environments and branches:**
- **Staging** → auto-deploys from `main` branch
- **Production** → auto-deploys from `release` branch

The Railway CLI / MCP is linked to **staging**. Always specify `environment_id: "production"` when querying production deployments or logs.

Allowed (read-only): `get_logs`, `list_deployments`, `list_services`, `list_variables`, `environment_status`, `get_service_config`, `service_metrics`, `http_requests`, `http_error_rate`, `http_response_time`

**FORBIDDEN - NEVER USE** (all write/mutating tools; enforced via deny rules in `.claude/settings.json`):
- `deploy_template`, `create_environment`, `create_project`
- `create_service`, `remove_service`, `update_service`, `scale_service`
- `set_variables`, `add_reference_variable`
- `create_volume`, `remove_volume`, `update_volume`, `create_bucket`, `remove_bucket`
- `link_environment`, `link_service`, `generate_domain`

### Google Drive MCP
Read tools: `gdrive_search`, `gdrive_read_file`, `gdrive_list_folder`, `gdrive_get_pdf`, `gdrive_get_image`, `gdrive_get_file_info`, `gdrive_list_revisions`, `gsheets_read`, `gsheets_query`, `gsheets_metadata`

**Write tools** (`gsheets_update`, `gdrive_move_file`, `gdrive_rename_file`, `gdrive_copy_file`, `gdrive_upload_file`) are reserved for the `data-ops` skill: only that skill pre-approves them via `allowed-tools`, and they are deliberately NOT in the global allow list in `.claude/settings.json`, so any use outside `data-ops` triggers a permission prompt. Do not use them outside that skill. `gsheets_append_rows`, `gsheets_delete_rows`, `gdrive_trash_file`, and `gdrive_create_folder` exist on the server but are not granted anywhere — rows are never deleted or hand-appended, and files are never trashed.

### Gemini MCP (PROMPT TESTING ONLY)
`gemini_analyze_pdf` - **NOT for document analysis.** The agent can read PDFs directly using the Read tool.

**Purpose:** Test and iterate on prompts before updating `src/gemini/prompts.ts`.

**Use cases:**
- Test alternative prompt wording to improve extraction accuracy
- Verify prompt changes don't introduce regressions
- Compare outputs between prompt variations
- Debug unexpected parsing results

**NOT for:** Actual document analysis. If the agent needs to analyze a PDF, it should read the file directly with the Read tool.

### Linear MCP (ISSUE TRACKING)
Allowed: `list_issues`, `get_issue`, `save_issue`, `save_comment`, `list_issue_labels`, `list_issue_statuses`, `list_teams`

**Note:** the Linear MCP uses upsert-style tools — `save_issue` creates an issue when called without `id` and updates when `id` is passed (there is no separate `create_issue`/`update_issue`). Same pattern for `save_comment`.

**Team:** ADVA Administracion | **Issue prefix:** ADV-

**Purpose:** Issue tracking and workflow management integrated with skills.

**Use cases:**
- `code-audit` creates issues in Backlog
- `plan-backlog` reads Backlog, moves to Todo
- `plan-inline`/`plan-fix` creates issues in Todo
- `plan-implement` moves Todo→In Progress→Review
- `plan-review-implementation` moves Review→Merge, creates bugs in Todo (Fix Plan) or Merge (inline fixes)
- `pr-creator` includes Linear issue IDs in PR body for Merge→Done automation

## LINEAR INTEGRATION

### State Flow

```
Backlog → Todo → In Progress → Review → Merge → Done → Released
                                          ↑        ↑         ↑
                                    (review OK)  (PR merged) (production deploy)
```

| State | Type | Usage |
|-------|------|-------|
| Backlog | backlog | New issues from code-audit, manual creation |
| Todo | unstarted | Issues ready for implementation (moved by plan-* skills) |
| In Progress | started | Being implemented (moved by plan-implement at task start) |
| Review | started | Implementation complete, awaiting review |
| Merge | started | Code review passed, awaiting PR merge |
| Done | completed | PR merged (via Linear GitHub automation) |
| Released | completed | Live in production (moved by push-to-production) |

**Same-type state transitions may need UUIDs:** passing a state by *name* to `save_issue` can silently no-op when moving between two states of the same `type` (verified for Done → Released, both `type: completed`; In Progress/Review/Merge are all `type: started`). For Done → Released always pass the state UUID from `list_issue_statuses`; for other transitions, if a name-based update doesn't take effect, retry with the UUID.

### State Transition Triggers

| Transition | Triggered By | When |
|------------|--------------|------|
| → Backlog | code-audit, deep-review, add-to-backlog, manual | Issue discovered or created |
| Backlog → Todo | plan-backlog | Issue selected for planning |
| → Todo | plan-inline, plan-fix, plan-review (bugs needing a Fix Plan) | Task enters PLANS.md |
| → Merge (created) | plan-review-implementation | Small bug fixed inline during review (audit trail only) |
| Todo → In Progress | plan-implement | Task work **starts** (real-time) |
| In Progress → Review | plan-implement | Task work **completes** (real-time) |
| Review → Merge | plan-review-implementation | Task passes review |
| Merge → Done | Linear GitHub automation | PR is merged (via `Closes ADV-XXX` in PR body) |
| Done/Merge → Released | push-to-production | Release deployed to production |

### Linear GitHub Integration

PRs created by `pr-creator` include Linear magic keywords in the body:

```markdown
## Linear Issues
Closes ADV-123, ADV-124
```

When the PR is merged, Linear's GitHub integration automatically moves the linked issues from Merge to Done. This enables automated issue lifecycle completion without manual intervention.

### Label Mapping (code-audit tags → Linear labels)

| Linear Label | code-audit Tags |
|--------------|-----------------|
| Security | `[security]`, `[dependency]`, `[supply-chain]`, `[prompt-injection]` |
| Bug | `[bug]`, `[async]`, `[shutdown]`, `[edge-case]`, `[type]`, `[logging]`, `[failing-open]` |
| Performance | `[memory-leak]`, `[resource-leak]`, `[timeout]`, `[rate-limit]` |
| Convention | `[convention]` |
| Technical Debt | `[dead-code]`, `[duplicate]`, `[test]`, `[practice]`, `[docs]`, `[chore]` |
| Feature | `[feature]` |
| Improvement | `[improvement]`, `[enhancement]`, `[refactor]` |

### Priority Mapping

| code-audit Priority | Linear Priority |
|---------------------|-----------------|
| `[critical]` | 1 (Urgent) |
| `[high]` | 2 (High) |
| `[medium]` | 3 (Medium) |
| `[low]` | 4 (Low) |

### PLANS.md Format with Linear Links

Each task in PLANS.md includes a Linear issue link:

```markdown
### Task 1: Add parseResumenBroker function
**Linear Issue:** [ADV-123](https://linear.app/...)

1. Write test in src/gemini/parser.test.ts
2. Run verifier (expect fail)
3. Implement in src/gemini/parser.ts
4. Run verifier (expect pass)
```

**Manual Issue Creation:** Create issues directly in Linear's Backlog state (equivalent to the former TODO.md editing).

## STYLE GUIDE

**TypeScript:**
- Strict mode enabled
- Use `interface` over `type` for object shapes
- Use `Result<T,E>` pattern for fallible operations
- JSDoc comments on all exported functions

**Naming:**
- Files: `kebab-case.ts`
- Types/Interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

**Imports:**
- ESM with `.js` extensions: `import { foo } from './bar.js'`

## LOGGING

Use Pino logger from `utils/logger.ts`. NEVER use `console.log`.

```typescript
import { debug, info, warn, error as logError } from '../utils/logger.js';
info('Message', { module: 'scanner', phase: 'process', fileId: 'abc' });
```

**Levels:**
- `debug()` - Dev details
- `info()` - State changes
- `warn()` - Handled issues
- `error()` - Failures

Routes use Fastify logger: `server.log.info({ data }, 'message')`

## STRUCTURE

```
src/
├── server.ts              # Fastify server setup
├── config.ts              # Configuration constants
├── types/index.ts         # Shared types (includes TipoTarjeta)
├── constants/
│   └── spreadsheet-headers.ts
├── routes/
│   ├── status.ts
│   ├── scan.ts
│   ├── mp-sync.ts         # POST /api/mp-sync (manual MP sync trigger)
│   └── webhooks.ts
├── middleware/
│   └── auth.ts            # Bearer token authentication
├── services/
│   ├── google-auth.ts
│   ├── drive.ts
│   ├── sheets.ts
│   ├── folder-structure.ts
│   ├── document-sorter.ts
│   ├── watch-manager.ts
│   ├── token-usage-logger.ts
│   ├── pagos-pendientes.ts
│   ├── movimientos-reader.ts
│   └── movimientos-detalle.ts
├── processing/
│   ├── queue.ts
│   ├── scanner.ts
│   ├── extractor.ts
│   ├── matching/
│   │   ├── index.ts
│   │   ├── factura-pago-matcher.ts
│   │   ├── recibo-pago-matcher.ts
│   │   └── nc-factura-matcher.ts
│   └── storage/
│       ├── index.ts
│       ├── factura-store.ts
│       ├── pago-store.ts
│       ├── recibo-store.ts
│       ├── retencion-store.ts
│       └── resumen-store.ts
├── matching/
│   ├── matcher.ts
│   └── cascade-matcher.ts
├── mercadopago/
│   ├── client.ts          # MP payments API client (pagination, timeout, 429 backoff)
│   ├── transform.ts       # MP payments → MovimientoBancario rows (gross credit + per-charge debits)
│   ├── movimientos-writer.ts  # Idempotent incremental month-tab appends (MP {id} dedupe key)
│   ├── resumen-writer.ts  # Resumen row for closed periods (synthetic running balance)
│   ├── sync.ts            # Orchestrator (PROCESSING_LOCK + match auto-trigger)
│   └── scheduler.ts       # Monthly cron (1st, 06:00) + boot-time catch-up
├── gemini/
│   ├── client.ts
│   ├── prompts.ts
│   ├── parser.ts          # TipoTarjeta validation here
│   └── errors.ts
├── utils/
│   ├── date.ts
│   ├── numbers.ts
│   ├── currency.ts
│   ├── validation.ts
│   ├── bank-names.ts
│   ├── file-naming.ts
│   ├── spanish-date.ts
│   ├── exchange-rate.ts
│   ├── drive-parser.ts
│   ├── logger.ts          # Pino logger - use this, not console.log
│   ├── spreadsheet.ts
│   ├── concurrency.ts
│   └── correlation.ts
└── bank/
    ├── matcher.ts
    └── match-movimientos.ts

apps-script/              # Dashboard ADVA menu (bound script)
├── src/
│   ├── main.ts
│   └── config.template.ts
└── build.js              # Bundles + injects API_BASE_URL/API_SECRET into dist/apps-script/Code.js + appsscript.json
```

The bundle is pushed to the target Apps Script project at server boot by `src/bootstrap/apps-script-sync.ts` (Railway-only, fail-closed). No manual deploy.

**Test files:** Colocated with source as `*.test.ts`:
- `src/services/document-sorter.test.ts`
- `src/processing/queue.test.ts`
- `src/processing/matching/nc-factura-matcher.test.ts`
- `src/processing/storage/factura-store.test.ts`
- `src/processing/storage/pago-store.test.ts`
- `src/processing/storage/resumen-store.test.ts`

## PROCESSING & RETRY BEHAVIOR

### Resilient Retry Mechanism

The scanner implements exponential backoff retry for transient errors:

**Transient Errors (JSON parse errors from Gemini API):**
- Automatically retried up to 3 times with exponential backoff delays
- Retry delays: 10s → 30s → 60s (total ~100 seconds before giving up)
- After 3 failed attempts, file moves to Sin Procesar folder
- Configuration: `MAX_TRANSIENT_RETRIES = 3`, `RETRY_DELAYS_MS = [10000, 30000, 60000]` in `src/config.ts`

**Why:** JSON parse errors often indicate temporary Gemini API instability (rate limiting, overload) rather than document issues. Exponential backoff gives the API time to stabilize.

**Example log flow:**
```
Processing file: invoice.pdf
JSON parse error, will retry (attempt 1/3)
[10s delay]
Retrying file: invoice.pdf (attempt 1)
JSON parse error, will retry (attempt 2/3)
[30s delay]
Retrying file: invoice.pdf (attempt 2)
JSON parse error, will retry (attempt 3/3)
[60s delay]
Retrying file: invoice.pdf (attempt 3)
Success on retry
```

### Startup Recovery

Files with stale 'processing' status are automatically recovered on server startup:

**What qualifies as stale:**
- Files with 'processing' status older than 5 minutes (configurable: `getStaleProcessingFileIds(dashboardId, 5 * 60 * 1000)`)
- Still present in the Entrada folder

**Recovery flow:**
1. On scanner startup, query `getStaleProcessingFileIds()` from Dashboard tracking sheet
2. Cross-reference with files currently in Entrada folder
3. Add stale files to processing queue alongside new files
4. Process with normal retry logic

**Why:** Deployment restarts, container terminations, or crashes can interrupt file processing. Without recovery, these files would remain in 'processing' state indefinitely.

**Tracking Sheet Schema (Dashboard Operativo - Archivos Procesados):**
- Column A: `fileId` (Google Drive file ID)
- Column B: `fileName`
- Column C: `processedAt` (ISO timestamp when processing started)
- Column D: `documentType`
- Column E: `status` (`processing` | `success` | `failed: <error message>` | `duplicate`)
- Column F: `originalFileId` (Drive file ID of original document, populated for duplicates only)

## GRACEFUL SHUTDOWN

### Timeout Policy

`SHUTDOWN_TIMEOUT_MS = 30 000 ms` (30 seconds, defined in `src/server.ts`).

**Why 30 s:** The startup recovery mechanism (`getStaleProcessingFileIds`) already handles files that are left in `processing` status when the server is terminated mid-scan. Abrupt termination is therefore safe — any interrupted files will be re-queued on the next boot. A 30-second window gives in-flight HTTP requests and active watch-channel teardown time to complete without needing a larger window.

### Signal Handler Pattern

SIGTERM and SIGINT handlers use `void shutdown(signal).catch(err => logError(...))`:

```typescript
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').catch((err: Error) => {
    logError('Shutdown rejection', { module: 'server', error: err.message });
  });
});
```

**Why `void` + `.catch()`:** `shutdown()` (from `createShutdownHandler`) already has an internal try/catch that handles all cleanup errors and calls `process.exit(1)` on failure. The outer `.catch()` is a defensive safety net for any unexpected rejection that escapes the internal handler, ensuring it is logged rather than silently becoming an unhandled promise rejection (ADV-211).

## SECURITY

All endpoints except `/health` and `/webhooks/drive` require Bearer token: `Authorization: Bearer <API_SECRET>`

**Adding endpoints:** Always use `{ onRequest: authMiddleware }`:
```typescript
server.post('/api/new', { onRequest: authMiddleware }, handler);
```

**Webhook endpoint:** `/webhooks/drive` is public (no auth) - Google Drive cannot send custom headers. Security via channel ID validation.

**Secret rotation:** Update `API_SECRET` in Railway, redeploy. The boot sync rebuilds and re-pushes the Apps Script bundle automatically.

**Google Drive scope:** The service account uses the full `https://www.googleapis.com/auth/drive` scope (not `drive.file`). The app must read pre-existing folders it did not create — Entrada, yearly archives, and banking subfolders — so `drive.file` (which only grants access to files the app itself created) is unworkable. The SA is domain-delegated to a Workspace user who owns **only** the ADVA folder hierarchy, limiting blast radius to that folder tree.

**GEMINI_API_KEY GCP restriction (CWE-1390 mitigation):** The `GEMINI_API_KEY` MUST be restricted in the GCP console to the *Generative Language API* (`generativelanguage.googleapis.com`) targets only. An unrestricted key can be used against any GCP API if it is ever leaked. To verify the restriction is in place:
```bash
gcloud alpha services api-keys describe <key-id> --project=<project-id> | grep targets
```
The output must list `generativelanguage.googleapis.com`. If `targets` is empty, the key is unrestricted and must be updated immediately.

## KNOWN ACCEPTED PATTERNS

Reviewers (bug-hunter, code-audit, deep-review, plan-review, Codex-finding triage) MUST NOT flag these — they are accepted by design. Full rationale in `.claude/skills/code-audit/references/compliance-checklist.md` ("Project-Specific Exemptions").

1. **API_SECRET embedded in the Apps Script bundle** (`apps-script/build.js`, `dist/apps-script/Code.js`) — same trust principal as the Railway env; threat-model accepted.
2. **Gemini raw response (first 1000 chars) logged at ERROR on parse failure** (`src/processing/extractor.ts`) — required for production debugging; do not propose redaction, removal, or level-downgrade.
3. **Gemini prompt/response previews logged at DEBUG** (`src/gemini/client.ts`) — wanted for diagnosis.
4. **Gemini prompts contain ADVA business identifiers** (CUIT, role rules, document-type enums) — not secrets; not "system prompt leakage".
5. **Logs may contain CUITs, monetary values, file IDs, document metadata** — internal operator-only Railway logs; not PII exposure.
6. **No PDF invisible-text sanitization** — a heuristic scanner (white-on-white, font-size-0, off-page/CTM, render-mode-3) was trialed (ADV-192/ADV-284) and removed; it false-flagged legitimate compressed PDFs (Mercado Pago receipts, BBVA statements) and routed them to *Sin Procesar*. Indirect prompt injection is mitigated instead by structural data/instruction delimiting and the output classifier. Do not flag the absence or propose re-adding it.

## COMMANDS

```bash
npm run dev    # Dev with watch
npm test       # Vitest (use verifier agent)
npm run build  # Compile server (tsc) + bundle Apps Script (use verifier agent)
```

The Apps Script bundle is produced into `dist/apps-script/{Code.js,appsscript.json}` and pushed to the target script project at server boot on Railway (`src/bootstrap/apps-script-sync.ts`). Required Railway env vars: `APPS_SCRIPT_SA_KEY`, `APPS_SCRIPT_TARGET_ID`, `APPS_SCRIPT_IMPERSONATE_SUBJECT`. The push is gated on `RAILWAY_ENVIRONMENT_ID` so local boots never push.

## ENV VARS

| Var | Required | Default |
|-----|----------|---------|
| GOOGLE_SERVICE_ACCOUNT_KEY | Yes | - |
| GEMINI_API_KEY | Yes — must be GCP-restricted (see SECURITY) | - |
| DRIVE_ROOT_FOLDER_ID | Yes | - |
| API_SECRET | Yes | - |
| ENVIRONMENT | No (production: required; local/test: defaults to `staging`) | staging |
| API_BASE_URL | No | - |
| PORT | No | 3000 |
| LOG_LEVEL | No | INFO |
| MATCH_DAYS_BEFORE | No | 10 |
| MATCH_DAYS_AFTER | No | 60 |
| USD_ARS_TOLERANCE_PERCENT | No | 5 |
| MATCH_DAYS_AFTER_USD | No | 90 |
| DRIVE_ROOT_FOLDER_ID_PRODUCTION | No | - |
| DRIVE_ROOT_FOLDER_ID_STAGING | No | - |
| FACTURADOR_SPREADSHEET_ID | No | - |
| MP_ACCESS_TOKEN | No | - |

**Note:** `API_BASE_URL` enables webhooks (URL + `/webhooks/drive`) and Apps Script (domain extracted at build)

**Note:** `ENVIRONMENT` is the server's own identity (`staging` | `production`). Required in production to prevent cross-environment data writes; if unset, defaults to `staging` (fail-closed — runs the full marker check even on local dev boots). Railway sets this explicitly in both envs, so production is unaffected.

**Note:** `NODE_ENV` must be one of `development`, `production`, or `test`. Unknown values (including miscased values like `Production`) throw at boot.

**Note:** `DRIVE_ROOT_FOLDER_ID_PRODUCTION` and `DRIVE_ROOT_FOLDER_ID_STAGING` are used by Claude Code skills only (e.g., `investigate`), not loaded by the server at runtime.

**Note:** `FACTURADOR_SPREADSHEET_ID` is required for the Subdiario de Ventas rebuild to enrich socio rows with membership category. If unset, the Subdiario builds but with `categoria=''` (blank) for all rows.

**Note:** `MP_ACCESS_TOKEN` is the Mercado Pago API access token (optional). When unset, the entire MP sync feature is disabled: the scheduler registers no cron and `syncMercadopago` returns `{ skipped: true, reason: 'mp_disabled' }`. The token must NEVER appear in logs (asserted in client tests).

## API ENDPOINTS

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /health | No | Health check |
| GET | /api/status | Yes | Status + queue info |
| POST | /api/scan | Yes | Manual scan |
| POST | /api/rematch | Yes | Rematch unmatched |
| POST | /api/match-movimientos | Yes | Match movimientos detalles (supports `?force=true` to re-match all rows) |
| POST | /api/mp-sync | Yes | Manual Mercado Pago sync (optional `?period=YYYY-MM`; defaults to previous + current month) |
| POST | /webhooks/drive | No | Drive notifications |
| POST | /api/delivery/plan | Yes | Enumerate delivery scope (read-only, no Drive writes) |
| POST | /api/delivery/copy-pdfs | Yes | Prepare delivery folder and copy resumen PDFs |
| POST | /api/delivery/build-movimientos | Yes | Build per-account movimientos spreadsheets in delivery folder |
| POST | /api/delivery/build-subdiario | Yes | Build formatted Subdiario de Ventas deliverable in delivery folder |

**Concurrency Control:**

`/api/scan`, `/api/match-movimientos`, and `/api/mp-sync` (plus the MP cron/boot sync) use a unified lock (`PROCESSING_LOCK_ID` from `src/config.ts`):
- **Scan deferral**: Scans WAIT for lock (up to 5 minutes) instead of skipping. A state machine (`'idle' | 'pending' | 'running'`) prevents queue buildup - if a scan is already waiting or running, subsequent scan requests skip (the pending scan will handle all files since it reads Entrada at start).
- **Lock timeout**: 5 minutes auto-expiry (configurable via `PROCESSING_LOCK_TIMEOUT_MS` in `src/config.ts`)
- **Sequential execution**: At any time, only ONE of these can run: scan OR match OR mp-sync
- **Auto-trigger**: After every successful scan (any document type), `matchAllMovimientos` is triggered asynchronously to fill detalles column. MP sync does the same when it appended rows — always AFTER releasing the lock (match acquires the same lock; triggering under it would deadlock).

**Race Condition Prevention:**
- **Lock acquisition**: Uses atomic state initialization - all lock state (including `waitPromise`) is set in a single `Map.set()` call with no yields between, preventing TOCTOU races
- **Scan state machine**: Uses atomic check-and-set pattern - `scanState` check and update happen in synchronous block (no await between), preventing concurrent scans from both passing the check
- **JavaScript async caveat**: While JavaScript is single-threaded, `await` yields to the event loop, allowing multiple async operations to interleave. Explicit synchronization (atomic operations, locks) is required for mutual exclusion

## SHEETS API CONCURRENCY

Google Sheets' `appendCells` request is NOT safe under concurrent execution against the same sheet — overlapping requests race on the API's "current end of data" detection and can silently overwrite each other (ADV-242: 9 production facturas lost over ~3 weeks before this fix).

**Enforcement:** `appendRowsWithLinks` in `src/services/sheets.ts` serializes per-`(spreadsheetId, sheetName)` via an in-memory `withLock` keyed by `sheet-append:${spreadsheetId}:${sheetName}`. The lock wraps the entire `withQuotaRetry → metadata fetch → batchUpdate` chain, so even a stale metadata cache read serializes with appends. Writes to *different* sheets — even within the same workbook — still run in parallel.

**Response validation:** Even with the lock, the function inspects `batchUpdate`'s response. A successful `appendCells` request returns `replies[0]` as an empty `{}` (the response schema has no structured `appendCells` payload). A missing or falsy `replies[0]` is thrown so `withQuotaRetry` retries; this is defence-in-depth against future API variants where the lock might fail open.

**Rules for callers and maintainers:**
- All sheet mutations that could race MUST flow through `appendRowsWithLinks` (or a similarly locked primitive). Do not call `spreadsheets.batchUpdate({requests:[{appendCells:...}]})` directly.
- The per-sheet lock has 60 s wait timeout and 900 s (15 min) auto-expiry. The expiry is intentionally generous: `appendCells` is NOT idempotent w.r.t. server-side "end-of-data" detection, so an overlapping post-expiry waiter could reproduce the original ADV-242 silent-overwrite race. The expiry exists only to recover from a crashed holder, not to bound normal slow paths.
- Never "optimize" the lock away. The plain `withQuotaRetry`-only path is what caused ADV-242.

**Test hygiene note:** Older test suites use `vi.useFakeTimers()` while exercising quota-retry paths that call `quotaThrottle.reportQuotaError()`. The throttle is a module-level singleton, so its `lastErrorTime` (captured under fake time) can land in the future relative to real `Date.now()`. New top-level `describe` blocks that use real timers must call `quotaThrottle.reset()` in `beforeEach`, otherwise every API call will block for 5 s.

## TESTING

**Framework:** Vitest

**Test Data:**
- Fake CUITs: `20123456786`, `27234567891`, `20111111119`
- ADVA CUIT `30709076783` is OK to use
- Fictional names: "TEST SA", "EMPRESA UNO SA", "Juan Perez"

## DOCUMENT CLASSIFICATION

ADVA CUIT: 30709076783 | Direction determines routing:

| Type | ADVA Role | Destination |
|------|-----------|-------------|
| factura_emitida | emisor | Ingresos |
| factura_recibida | receptor | Egresos |
| pago_enviado | pagador | Egresos |
| pago_recibido | beneficiario | Ingresos |
| certificado_retencion | sujeto retenido | Ingresos |
| resumen_bancario | account holder | Bancos |
| resumen_tarjeta | card holder | Bancos |
| resumen_broker | investor | Bancos |
| recibo | empleador | Egresos |

**Three Resumen Types:**
- `resumen_bancario`: Bank account statements (DÉBITO/CRÉDITO columns, 10+ digit account numbers)
- `resumen_tarjeta`: Credit card statements (CIERRE, PAGO MÍNIMO, card type visible)
- `resumen_broker`: Broker/investment statements (Comitente number, instruments list, multi-currency)

**Invoice ID Handling:**
- Standard B2B invoices: Client CUIT labeled "CUIT:" in receptor section
- Consumidor Final invoices: Client ID may be labeled "Doc. Receptor:", "DNI:", or "CUIL:" instead of "CUIT:"
- System extracts ALL identification numbers (7-11 digits) regardless of label
- Empty `cuitReceptor` in `factura_emitida` triggers automatic review flag for human verification

## FOLDER STRUCTURE

```
ROOT/
├── .production              # or .staging — environment marker file (one per root folder)
├── Control de Ingresos.gsheet
├── Control de Egresos.gsheet
├── Dashboard Operativo Contable.gsheet
├── Entrada/
├── Sin Procesar/
├── Duplicado/
└── {YYYY}/
    ├── Ingresos/{MM - Mes}/
    ├── Egresos/{MM - Mes}/
    └── Bancos/
        ├── {Bank} {Account} {Currency}/     # resumen_bancario
        ├── {Bank} {CardType} {LastDigits}/  # resumen_tarjeta
        ├── {Broker} {Comitente}/            # resumen_broker
        └── Mercado Pago {CollectorId} ARS/  # MP sync (API-ingested, no PDFs)
```

**Bank account folder naming (resumen_bancario):**
- Format: `{Bank} {Account Number} {Currency}`
- Example: `BBVA 1234567890 ARS`

**Credit card folder naming (resumen_tarjeta):**
- Format: `{Bank} {Card Type} {Last Digits}`
- Example: `BBVA Visa 4563`
- No currency suffix (cards can process both ARS and USD)
- Valid card types: Visa, Mastercard, Amex, Naranja, Cabal

**Broker folder naming (resumen_broker):**
- Format: `{Broker} {Comitente}`
- Example: `BALANZ CAPITAL VALORES SAU 123456`

**Mercado Pago folder naming (MP sync):**
- Format: `Mercado Pago {CollectorId} ARS` (standard bank-account convention; collector id acts as the account number)
- Created by `syncMercadopago`, not by document processing — no PDFs exist for this account. The Entrega flow skips its spreadsheet-backed resumen fileIds (`skippedNonPdf`); the data reaches the accountants via the per-account-month movimientos files.

## SPREADSHEETS

**Note:** authoritative column counts live in `src/constants/spreadsheet-headers.ts` and `SPREADSHEET_FORMAT.md`. The summaries below are illustrative.

See `SPREADSHEET_FORMAT.md` for complete schema.

- **Control de Ingresos**: Facturas Emitidas (20 cols, A:T), Pagos Recibidos (17 cols), Retenciones Recibidas (15 cols)
- **Control de Egresos**: Facturas Recibidas (20 cols), Pagos Enviados (17 cols), Recibos (19 cols)
- **Control de Resumenes**: 3 distinct schemas based on document type:
  - `resumen_bancario`: 12 cols (A:L) with `periodo` (YYYY-MM) as first column, `moneda` (ARS/USD), includes `balanceOk` and `balanceDiff` columns for validation
  - `resumen_tarjeta`: 10 cols (A:J) with `periodo` (YYYY-MM) as first column, `tipoTarjeta` (Visa/Mastercard/etc)
  - `resumen_broker`: 9 cols (A:I) with `periodo` (YYYY-MM) as first column, `saldoARS` + `saldoUSD` (multi-currency)
  - `periodo` format matches Movimientos sheet names (YYYY-MM derived from fechaHasta)
  - Rows sorted by `periodo` ascending (oldest first)
- **Movimientos Bancario**: 9 cols (A:I) with running balance formulas - `saldo` (parsed from PDF), `saldoCalculado` (computed formula), `matchedFileId` (fileId of matched document), `matchedType` (AUTO/MANUAL/empty), `detalle` (human-readable match description)
- **Dashboard**: Pagos Pendientes (10 cols), Cobros Pendientes (10 cols), API Mensual (8 cols), Uso de API (15 cols)

**Principles:**
- Store counterparty info only, ADVA's role is implicit
- Use `CellDate` type for proper date formatting in spreadsheets
- Use `CellNumber` type for proper monetary formatting in spreadsheets (displays as #,##0.00)
- **Spreadsheet timezone usage:**
  - **Script-generated timestamps** (e.g., `processedAt`, API usage timestamp) MUST use spreadsheet timezone
    - Fetch timezone: `getSpreadsheetTimezone(spreadsheetId)`
    - Pass as 4th parameter to `appendRowsWithLinks()` or `appendRowsWithFormatting()`
    - Ensures timestamps display in correct local time (typically `America/Argentina/Buenos_Aires`)
  - **Parsed timestamps** (e.g., `fechaEmision`, `fechaPago` from documents) should NOT use spreadsheet timezone
    - These are already in correct timezone from source document
    - Pass them as-is using `CellDate` type
- **Reading dates from spreadsheets:**
  - `getValues()` uses `UNFORMATTED_VALUE` + `SERIAL_NUMBER` render options, so `CellDate` fields return as numbers (e.g., `45993` instead of `"2025-12-02"`)
  - **Always** use `normalizeSpreadsheetDate(cellValue)` from `utils/date.ts` for date fields, **never** `String()`
  - Correct: `fechaEmision: normalizeSpreadsheetDate(row[colIndex.fechaEmision])`
  - Wrong: `fechaEmision: String(row[colIndex.fechaEmision] || '')`
  - `processedAt` fields written with the spreadsheet timezone come back as DATE_TIME serials encoding **local wall-clock time** — decode them with `decodeSerialInTimezone(serial, timezone)` from `utils/date.ts` (timezone via `getSpreadsheetTimezone`), never with the raw Excel-epoch-as-UTC formula (ADV-306)

## MATCHING

### Tier-Based Ranking
Bank movements are matched against documents using a tier-based algorithm (lower tier = better match):

| Tier | Criteria | Confidence |
|------|----------|------------|
| 1 | Pago with linked Factura | HIGH |
| 2 | CUIT match from concepto | HIGH |
| 3 | Referencia match | HIGH |
| 4 | Name token score ≥ 2 | MEDIUM |
| 5 | Amount + date only | LOW |

**Hard identity filter:** If CUIT is found in concepto, only documents with matching CUIT are considered — no fallthrough to lower tiers.

**CUIT↔DNI equivalence:** All identity comparisons (hard filter and tier 2, credit and debit paths) use `cuitOrDniMatch` from `src/utils/validation.ts`, not strict equality. An 8-digit DNI stored on a consumidor-final factura matches an 11-digit CUIT/CUIL that embeds it (digits 3–10); two full 11-digit CUITs still compare exactly. Required because facturas emitidas store consumidor-final receptor IDs as DNI while bank/MP conceptos carry full CUIT/CUIL.

### Match Replacement
Better matches replace existing ones. Quality comparison: tier → date proximity → exact amount.

### MANUAL Confidence Lock
`matchConfidence='MANUAL'` is a special value that permanently locks a match against automatic re-matching:

- **Facturas/Recibos with MANUAL**: invisible to `FacturaPagoMatcher.findMatches()` and `ReciboPagoMatcher.findMatches()` — no pago can ever displace their existing match
- **Pagos with MANUAL**: excluded from the unmatched pool — treated as already matched
- **NC-Factura matching**: MANUAL NCs are skipped (not matched to facturas); MANUAL facturas are excluded from match targets
- MANUAL always wins over force mode — even `?force=true` respects MANUAL locks
- **Movimientos bancarios:** MANUAL locking supported via `matchedType` column (H). Set to `MANUAL` with a `matchedFileId` — system auto-generates `detalle` and excludes the document from the matching pool

### Date Windows
- Pago: ±15 days from bank date
- Factura: -5/+30 days from bank date
- **Mercado Pago accounts:** the forward factura bound is extended to `MP_FACTURA_DATE_RANGE_AFTER_DAYS = 25` days (facturas up to 25 days *after* the movement, vs 5 standard). MP subscriptions charge on the ~25th but the factura is emitted ~the 11th of the following month (~17 days later, verified against production data). Accounts are detected by folder name: `folderName.startsWith(MERCADO_PAGO_BANK_NAME)` in `match-movimientos.ts`. Backward window and tier/confidence semantics unchanged; non-MP accounts have zero behavior change.

### Cross-Currency (USD→ARS)
Exchange rates from ArgentinaDatos API, ±5% tolerance. Cross-currency caps: Tier 1-3 → MEDIUM, Tier 4 → LOW, Tier 5 → LOW.

### Movimientos → Pagada Sync
After matching bank movements, facturas (both emitidas and recibidas) matched from movimientos data are marked `pagada='SI'` in their Control sheets:
- **Facturas Emitidas** matched via movimientos → `pagada = "SI"` in Control de Ingresos
- **Facturas Recibidas** matched via movimientos → `pagada = "SI"` in Control de Egresos

This sync runs as part of `matchAllMovimientos`. Cobros Pendientes and Pagos Pendientes are re-synced immediately after the update.
