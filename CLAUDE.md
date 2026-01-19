# ADVA Administración Server

## STATUS: DEVELOPMENT MODE
- This project is in active development - NOT production ready
- No backward compatibility required - breaking changes are OK
- No deprecation warnings or migration paths needed
- Delete unused code immediately - do not keep "for compatibility"
- When changing APIs/configs: update all references, remove old ones

## RULES
- SYNC: update this file if architecture/build/structure/features change
- **TDD: ALWAYS write tests FIRST, before any implementation code** (see TDD section below)
- VERIFY: after code changes → build → test (via subagents); fix before proceeding
- BUILD: zero-warning policy

## TDD WORKFLOW (MANDATORY)
**Every feature or bug fix MUST follow this sequence:**

1. **WRITE FAILING TEST FIRST**
   - Create/update test file before touching implementation
   - Test should fail (red) - verifies test is actually testing something
   - Cover happy path, edge cases, and error conditions

2. **IMPLEMENT MINIMUM CODE**
   - Write only enough code to make the test pass
   - No extra features, no "while I'm here" changes

3. **VERIFY TEST PASSES**
   - Run `test-runner` subagent to confirm green
   - If test fails, fix implementation (not the test, unless test was wrong)

4. **REFACTOR IF NEEDED**
   - Clean up code while keeping tests green
   - Run tests again after refactoring

**Coverage requirement: >=80%** for happy paths, edge cases, and error paths

**NEVER:**
- Write implementation code before its test exists
- Skip tests for "simple" changes
- Write tests after implementation is complete

## SUBAGENTS

**IMPORTANT:** ALWAYS use these subagents instead of running commands directly.

### Available Subagents

1. **`test-runner`** (haiku) - Run tests and report failures only
   - **When to use:** After any code change, before committing
   - **Never use:** `npm test` directly

2. **`builder`** (haiku) - Build and report warnings/errors only
   - **When to use:** After code changes, before committing
   - **Never use:** `npm run build` directly

3. **`commit-bot`** (haiku) - Stage changes, analyze diff, create commit
   - **When to use:** After tests and build pass, ready to commit
   - **Never use:** `git add`, `git commit` directly
   - **Note:** Creates commit with proper message and co-author

### Creating Pull Requests

**CRITICAL:** When user asks to create a PR, follow this workflow:

1. **Create branch:** `git checkout -b <type>/<description>`
   - Types: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`

2. **Commit changes:** Use `commit-bot` subagent
   - NEVER use `git commit` directly

3. **Push branch:** `git push -u origin <branch-name>`

4. **Create PR:** Use `gh pr create`
   - Include summary, changes, test plan
   - Add "🤖 Generated with [Claude Code](https://claude.com/claude-code)" footer

### Usage Workflow

```
Code changes → test-runner → builder → commit-bot → push → gh pr create
```

**Example:**
```
User: "Fix the webhook bug and create a PR"
Assistant:
  1. Fix code (write tests first per TDD)
  2. Use test-runner subagent
  3. Use builder subagent
  4. git checkout -b fix/webhook-resource-states
  5. Use commit-bot subagent
  6. git push -u origin fix/webhook-resource-states
  7. gh pr create with detailed description
```

## REPO
- Node.js + Fastify server for Railway.app deployment
- Output: `dist/` (compiled TypeScript)
- Entry: `src/server.ts` → Fastify server

## STRUCTURE
```
src/
├── server.ts              # Fastify entry point
├── config.ts              # Environment-based config
├── constants/
│   └── spreadsheet-headers.ts # Spreadsheet header definitions
├── routes/
│   ├── status.ts          # GET /api/status, GET /health
│   ├── scan.ts            # POST /api/scan, /rematch, /autofill-bank
│   └── webhooks.ts        # POST /webhooks/drive
├── services/
│   ├── google-auth.ts     # Service account auth
│   ├── drive.ts           # googleapis Drive wrapper
│   ├── sheets.ts          # googleapis Sheets wrapper
│   ├── folder-structure.ts # Drive folder discovery/caching
│   ├── document-sorter.ts # Document file movement
│   └── watch-manager.ts   # Real-time monitoring
├── processing/
│   └── queue.ts           # p-queue processing
├── types/index.ts         # TypeScript interfaces
├── matching/matcher.ts    # Pure matching algorithms
├── gemini/
│   ├── client.ts          # Gemini API (native fetch)
│   ├── prompts.ts         # Extraction prompts
│   ├── parser.ts          # Response parsing
│   └── errors.ts          # Error classification
├── utils/                 # Pure utilities (date, currency, validation, etc.)
└── bank/
    ├── matcher.ts         # Bank movement matching
    └── subdiario-matcher.ts # Subdiario matching
```

## COMMANDS
```bash
npm run build         # TypeScript compile to dist/
npm start             # Start server
npm run dev           # Dev mode with watch
npm test              # Run Vitest tests
npm run test:coverage # Coverage report
npm run lint          # Type check
```

## ENVIRONMENT VARIABLES
```env
# Server
PORT=3000
NODE_ENV=production
LOG_LEVEL=INFO

# Google Auth (required)
GOOGLE_SERVICE_ACCOUNT_KEY=<base64 encoded JSON>

# Gemini (required)
GEMINI_API_KEY=<key>

# Drive (required) - root folder containing the folder structure
DRIVE_ROOT_FOLDER_ID=<folder id>

# Webhooks (optional) - for real-time Drive notifications
WEBHOOK_URL=<webhook url>

# Matching
MATCH_DAYS_BEFORE=10
MATCH_DAYS_AFTER=60
USD_ARS_TOLERANCE_PERCENT=5
```

## REST API
```
GET  /health             - Simple health check
GET  /api/status         - Health check, queue status, version
POST /api/scan           - Trigger manual scan
POST /api/rematch        - Rematch unmatched documents
POST /api/autofill-bank  - Auto-fill bank descriptions
POST /webhooks/drive     - Drive push notifications
```

## STYLE
- TS strict; `interface`; JSDoc; Result<T,E>
- Naming: kebab-files, PascalTypes, camelFuncs, UPPER_CONSTS
- ESM imports with .js extensions

## TESTING
- Framework: Vitest
- **DATA POLICY**: NEVER use real-world non-ADVA private information in tests
  - Use fabricated CUITs (valid checksum but fake): `20123456786`, `27234567891`, `20111111119`
  - ADVA CUIT `30709076783` is allowed (company's own)
  - Use fictional names: "TEST SA", "EMPRESA UNO SA", "Juan Pérez"

## MODULES
types/:interfaces | constants/:spreadsheet headers | gemini/:PDF→parse | services/:Google APIs | matching/:match+score | bank/:movements+autofill | utils/:date,cuit,currency | routes/:HTTP endpoints | processing/:queue
