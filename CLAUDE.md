# ADVA Administración Server

## STATUS: DEVELOPMENT
Breaking changes OK. Delete unused code immediately. Update refs when changing APIs/configs.

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
| `bug-hunter` (opus) | Find bugs in git changes | After implementation, before commit |
| `verifier` (haiku) | Run tests and build | TDD mode: `verifier "pattern"` (filtered tests, no build). Full mode: `verifier` (all tests + build). Use TDD mode during development, Full mode for final verification. |
| `commit-bot` (sonnet) | Commit to current branch | Only when user requests commit |
| `pr-creator` (sonnet) | Branch + commit + push + PR | Only when user requests PR |

**Git agents rule:** Never commit or create PRs unless the user explicitly requests it. When requested:
- **Commit requested** → Use `commit-bot` agent (don't commit manually)
- **PR requested** → Use `pr-creator` agent (handles branch, commit, push, and PR)

**Skills/Agents modification rule:** ALWAYS load the `tools-improve` skill BEFORE creating, editing, or reviewing any `.claude/skills/` or `.claude/agents/` file. This skill contains critical best practices that must be followed.

## SKILLS

Skills are specialized workflows in `.claude/skills/`. Descriptions drive automatic invocation - include action verbs and explicit triggers.

| Skill | When to Invoke |
|-------|----------------|
| `investigate` | Read-only investigation that reports findings without creating plans. Use when user says "investigate", "check why", "look into", "diagnose", or wants to understand a problem before deciding action. Accesses Railway logs, Drive files, Gemini prompts. Offers to chain to plan-fix if issues are found. |
| `plan-todo` | Convert Linear Backlog issues into TDD implementation plans. Use when user says "plan ADVA-123", "plan all bugs", or wants to work on backlog items. Moves planned issues to Todo state. |
| `plan-inline` | Create TDD plans from direct feature requests. Use when user provides a task description directly like "add X feature" or "create Y function". Creates Linear issues in Todo state. |
| `plan-fix` | Investigate bugs and create fix plans. Use when user reports extraction errors, deployment failures, wrong data, or prompt issues. Creates Linear issues in Todo state. |
| `plan-implement` | Execute the pending plan in PLANS.md following TDD. Use after any plan-* skill creates a plan, or when user says "implement the plan". Updates Linear issues: Todo→In Progress→Review. |
| `plan-review-implementation` | QA review of completed implementation. Use after plan-implement finishes to verify correctness. Moves issues Review→Done or creates new issues in Todo for bugs found. |
| `code-audit` | Audit codebase for bugs, security issues, memory leaks, and violations. Use when user says "audit", "find bugs", "check security", or "review codebase". Creates Linear issues in Backlog. Analysis only. |
| `tools-improve` | **REQUIRED before modifying skills/agents.** Contains best practices for `.claude/skills/` and `.claude/agents/`. ALWAYS load this skill FIRST when: creating, editing, or reviewing any SKILL.md or agent .md file. |

**Skill workflow:** `investigate` (optional) → `code-audit` → `plan-todo` → `plan-implement` → `plan-review-implementation` (repeat until COMPLETE)

## MCP SERVERS

### Railway MCP (READ-ONLY)
Allowed: `get-logs`, `list-deployments`, `list-services`, `list-variables`, `check-railway-status`

**FORBIDDEN - NEVER USE:**
- `deploy`
- `create-environment`
- `set-variables`
- `create-project-and-link`
- `deploy-template`
- `link-environment`
- `link-service`
- `generate-domain`

### Google Drive MCP
`gdrive_search`, `gdrive_read_file`, `gdrive_list_folder`, `gdrive_get_pdf`, `gsheets_read`

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
Allowed: `list_issues`, `get_issue`, `create_issue`, `update_issue`, `list_issue_labels`, `list_issue_statuses`

**Team:** ADVA Administracion

**Purpose:** Issue tracking and workflow management integrated with skills.

**Use cases:**
- `code-audit` creates issues in Backlog
- `plan-todo` reads Backlog, moves to Todo
- `plan-inline`/`plan-fix` creates issues in Todo
- `plan-implement` moves Todo→In Progress→Review
- `plan-review-implementation` moves Review→Done, creates bugs in Todo

## LINEAR INTEGRATION

### State Flow

```
Backlog → Todo → In Progress → Review → Done
```

| State | Type | Usage |
|-------|------|-------|
| Backlog | backlog | New issues from code-audit, manual creation |
| Todo | unstarted | Issues ready for implementation (moved by plan-* skills) |
| In Progress | started | Being implemented (moved by plan-implement at task start) |
| Review | started | Implementation complete, awaiting review |
| Done | completed | Reviewed and approved |

### State Transition Triggers

| Transition | Triggered By | When |
|------------|--------------|------|
| → Backlog | code-audit, manual | Issue discovered or created |
| Backlog → Todo | plan-todo | Issue selected for planning |
| → Todo | plan-inline, plan-fix, plan-review (bugs) | Task enters PLANS.md |
| Todo → In Progress | plan-implement | Task work **starts** (real-time) |
| In Progress → Review | plan-implement | Task work **completes** (real-time) |
| Review → Done | plan-review-implementation | Task passes review |

### Label Mapping (code-audit tags → Linear labels)

| Linear Label | code-audit Tags |
|--------------|-----------------|
| Security | `[security]`, `[dependency]` |
| Bug | `[bug]`, `[async]`, `[shutdown]`, `[edge-case]`, `[type]` |
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
**Linear Issue:** [ADVA-123](https://linear.app/...)

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
    ├── autofill.ts
    └── match-movimientos.ts

apps-script/              # Dashboard ADVA menu (bound script)
├── src/
│   ├── main.ts
│   └── config.template.ts
├── build.js              # Injects API_BASE_URL + API_SECRET from .env
└── dist/                 # Compiled output (clasp pushes from here)
```

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
- Column E: `status` (`processing` | `success` | `failed: <error message>`)

## SECURITY

All endpoints except `/health` and `/webhooks/drive` require Bearer token: `Authorization: Bearer <API_SECRET>`

**Adding endpoints:** Always use `{ onRequest: authMiddleware }`:
```typescript
server.post('/api/new', { onRequest: authMiddleware }, handler);
```

**Webhook endpoint:** `/webhooks/drive` is public (no auth) - Google Drive cannot send custom headers. Security via channel ID validation.

**Secret rotation:** Update `.env`, run `npm run deploy:script`, restart server.

## COMMANDS

```bash
npm run dev           # Dev with watch
npm test              # Vitest (use verifier agent)
npm run build         # Compile (use verifier agent)
npm run build:script  # Build Apps Script (requires API_BASE_URL, API_SECRET)
npm run deploy:script # Build + deploy to Dashboard
```

## ENV VARS

| Var | Required | Default |
|-----|----------|---------|
| GOOGLE_SERVICE_ACCOUNT_KEY | Yes | - |
| GEMINI_API_KEY | Yes | - |
| DRIVE_ROOT_FOLDER_ID | Yes | - |
| API_SECRET | Yes | - |
| API_BASE_URL | No | - |
| PORT | No | 3000 |
| LOG_LEVEL | No | INFO |
| MATCH_DAYS_BEFORE | No | 10 |
| MATCH_DAYS_AFTER | No | 60 |
| USD_ARS_TOLERANCE_PERCENT | No | 5 |

**Note:** `API_BASE_URL` enables webhooks (URL + `/webhooks/drive`) and Apps Script (domain extracted at build)

## API ENDPOINTS

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /health | No | Health check |
| GET | /api/status | Yes | Status + queue info |
| POST | /api/scan | Yes | Manual scan |
| POST | /api/rematch | Yes | Rematch unmatched |
| POST | /api/autofill-bank | Yes | Auto-fill bank |
| POST | /api/match-movimientos | Yes | Match movimientos detalles (supports `?force=true` to re-match all rows) |
| POST | /webhooks/drive | No | Drive notifications |

**Concurrency Control:**

Both `/api/scan` and `/api/match-movimientos` use a unified lock (`PROCESSING_LOCK_ID` from `src/config.ts`):
- **Scan deferral**: Scans WAIT for lock (up to 5 minutes) instead of skipping. A state machine (`'idle' | 'pending' | 'running'`) prevents queue buildup - if a scan is already waiting or running, subsequent scan requests skip (the pending scan will handle all files since it reads Entrada at start).
- **Lock timeout**: 5 minutes auto-expiry (configurable via `PROCESSING_LOCK_TIMEOUT_MS` in `src/config.ts`)
- **Sequential execution**: At any time, only ONE of these can run: scan OR match
- **Auto-trigger**: After every successful scan (any document type), `matchAllMovimientos` is triggered asynchronously to fill detalles column

**Race Condition Prevention:**
- **Lock acquisition**: Uses atomic state initialization - all lock state (including `waitPromise`) is set in a single `Map.set()` call with no yields between, preventing TOCTOU races
- **Scan state machine**: Uses atomic check-and-set pattern - `scanState` check and update happen in synchronous block (no await between), preventing concurrent scans from both passing the check
- **JavaScript async caveat**: While JavaScript is single-threaded, `await` yields to the event loop, allowing multiple async operations to interleave. Explicit synchronization (atomic operations, locks) is required for mutual exclusion

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
        └── {Broker} {Comitente}/            # resumen_broker
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

## SPREADSHEETS

See `SPREADSHEET_FORMAT.md` for complete schema.

- **Control de Ingresos**: Facturas Emitidas (18 cols), Pagos Recibidos (15 cols), Retenciones Recibidas (15 cols)
- **Control de Egresos**: Facturas Recibidas (19 cols), Pagos Enviados (15 cols), Recibos (18 cols)
- **Control de Resumenes**: 3 distinct schemas based on document type:
  - `resumen_bancario`: 12 cols (A:L) with `periodo` (YYYY-MM) as first column, `moneda` (ARS/USD), includes `balanceOk` and `balanceDiff` columns for validation
  - `resumen_tarjeta`: 10 cols (A:J) with `periodo` (YYYY-MM) as first column, `tipoTarjeta` (Visa/Mastercard/etc)
  - `resumen_broker`: 9 cols (A:I) with `periodo` (YYYY-MM) as first column, `saldoARS` + `saldoUSD` (multi-currency)
  - `periodo` format matches Movimientos sheet names (YYYY-MM derived from fechaHasta)
  - Rows sorted by `periodo` ascending (oldest first)
- **Movimientos Bancario**: 8 cols (A:H) with running balance formulas - `saldo` (parsed from PDF), `saldoCalculado` (computed formula), `matchedFileId` (fileId of matched document), `detalle` (human-readable match description)
- **Dashboard**: Pagos Pendientes (10 cols), API Mensual (7 cols), Uso de API (12 cols)

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

## MATCHING

### Confidence Levels
- **HIGH**: amount + date in range + CUIT/name match
- **MEDIUM**: amount + date in range, no CUIT
- **LOW**: amount + date in extended range only

### Cascading Displacement
Better matches replace existing ones. Quality comparison: confidence → CUIT match → date proximity.

**Termination:** max depth (10), cycle detection, timeout (30s), no better candidates.

Config: `MAX_CASCADE_DEPTH = 10`, `CASCADE_TIMEOUT_MS = 30000` in `src/config.ts`

### Cross-Currency (USD→ARS)
Exchange rates from ArgentinaDatos API, ±5% tolerance. With CUIT → MEDIUM max; without → LOW.
