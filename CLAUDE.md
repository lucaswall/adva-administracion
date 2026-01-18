# ADVA Administración Server

## RULES
- SYNC: update this file if architecture/build/structure/features change
- TDD: write tests before implementation; >=80% coverage; happy+edge+error paths
- VERIFY: after code changes → build → test (via subagents); fix before proceeding
- BUILD: zero-warning policy

## SUBAGENTS
- Build: `builder` (haiku) - report warnings/errors only
- Tests: `test-runner` (haiku) - report failures only

## REPO
- Node.js + Fastify server for Railway.app deployment
- Output: `dist/` (compiled TypeScript)
- Entry: `src/server.ts` → Fastify server

## STRUCTURE
```
src/
├── server.ts              # Fastify entry point
├── config.ts              # Environment-based config
├── routes/
│   ├── status.ts          # GET /api/status, GET /health
│   ├── scan.ts            # POST /api/scan, /rematch, /autofill-bank
│   └── webhooks.ts        # POST /webhooks/drive
├── services/
│   ├── google-auth.ts     # Service account auth
│   ├── drive.ts           # googleapis Drive wrapper
│   └── sheets.ts          # googleapis Sheets wrapper
├── processing/
│   └── queue.ts           # p-queue processing
├── types/index.ts         # TypeScript interfaces
├── matching/matcher.ts    # Pure matching algorithms
├── gemini/
│   ├── client.ts          # Gemini API (native fetch)
│   ├── prompts.ts         # Extraction prompts
│   ├── parser.ts          # Response parsing
│   └── errors.ts          # Error classification
├── utils/                 # Pure utilities
└── bank/                  # Bank matching logic
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

# Drive
DRIVE_WATCH_FOLDER_ID=<folder id>

# Sheets
COBROS_SPREADSHEET_ID=<id>
GASTOS_SPREADSHEET_ID=<id>
BANK_SPREADSHEET_IDS=<comma-separated ids>

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
types/:interfaces | gemini/:PDF→parse | services/:Google APIs | matching/:match+score | bank/:movements+autofill | utils/:date,cuit,currency | routes/:HTTP endpoints | processing/:queue
