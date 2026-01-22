# ADVA Administración Server

## STATUS: DEVELOPMENT
- Breaking changes OK, delete unused code immediately
- Update all refs when changing APIs/configs

## RULES
- **TDD**: Write tests FIRST (red→green→refactor), coverage >=80%
- **VERIFY**: code → test-runner → builder → fix before commit
- **BUILD**: Zero warnings required
- **SYNC**: Update this file when architecture changes

## SUBAGENTS
| Agent | Use For | Never |
|-------|---------|-------|
| `test-runner` (haiku) | After code changes | `npm test` |
| `builder` (haiku) | After code changes | `npm run build` |
| `commit-bot` (haiku) | After tests+build pass | `git commit` |
| `pr-creator` (haiku) | Creating PRs | `gh pr create` |

## MCP SERVERS

**Railway MCP** (READ-ONLY): `get-logs`, `list-deployments`, `list-services`, `list-variables`, `check-railway-status`
- NEVER: `deploy`, `create-environment`, `set-variables`, `create-project-and-link`, `deploy-template`, `link-environment`, `link-service`, `generate-domain`

**Google Drive MCP** (`gdrive`): `gdrive_search`, `gdrive_read_file`, `gdrive_list_folder`, `gdrive_get_pdf`, `gsheets_read`

**Gemini MCP** (`gemini`): `gemini_analyze_pdf` - For testing prompts only; production uses `src/gemini/`

## STRUCTURE
```
src/
├── server.ts, config.ts, types/index.ts
├── constants/spreadsheet-headers.ts
├── routes/{status,scan,webhooks}.ts
├── middleware/auth.ts          # Bearer token authentication
├── services/{google-auth,drive,sheets,folder-structure,document-sorter,watch-manager,token-usage-logger}.ts
├── processing/{queue,scanner}.ts
├── matching/{matcher,cascade-matcher}.ts
├── gemini/{client,prompts,parser,errors}.ts
├── utils/{date,numbers,currency,validation,file-naming,spanish-date,exchange-rate,drive-parser,logger,spreadsheet}.ts
└── bank/{matcher,autofill,subdiario-matcher}.ts

apps-script/   # Dashboard ADVA menu (bound script)
├── src/{main.ts,config.template.ts}
├── build.js   # Injects API_BASE_URL + API_SECRET from .env
└── dist/      # Compiled output (clasp pushes from here)
```

## SECURITY

All endpoints except `/health` require Bearer token: `Authorization: Bearer <API_SECRET>`

**Adding endpoints**: Always use `{ onRequest: authMiddleware }`:
```typescript
server.post('/api/new', { onRequest: authMiddleware }, handler);
```

**Secret rotation**: Update `.env`, run `npm run deploy:script`, restart server.

## COMMANDS
```bash
npm run dev           # Dev with watch
npm test              # Vitest (use test-runner agent)
npm run build         # Compile (use builder agent)
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
| POST | /webhooks/drive | Yes | Drive notifications |

## STYLE
- TS strict mode, `interface`, JSDoc, `Result<T,E>`
- Names: kebab-files, PascalTypes, camelFuncs, UPPER_CONSTS
- ESM imports with `.js` extensions

## LOGGING
Use Pino logger from `utils/logger.ts`. NEVER use `console.log`.

```typescript
import { debug, info, warn, error as logError } from '../utils/logger.js';
info('Message', { module: 'scanner', phase: 'process', fileId: 'abc' });
```

Levels: `debug()` dev details, `info()` state changes, `warn()` handled issues, `error()` failures.
Routes use Fastify logger: `server.log.info({ data }, 'message')`

## TESTING
- Framework: Vitest
- Fake CUITs: `20123456786`, `27234567891`, `20111111119`
- ADVA CUIT `30709076783` OK
- Fictional names: "TEST SA", "EMPRESA UNO SA", "Juan Perez"

## DOCUMENT CLASSIFICATION
ADVA CUIT: 30709076783 | Direction determines routing:

| Type | ADVA Role | Destination |
|------|-----------|-------------|
| factura_emitida | emisor | Creditos |
| factura_recibida | receptor | Debitos |
| pago_enviado | pagador | Debitos |
| pago_recibido | beneficiario | Creditos |
| resumen_bancario | - | Bancos |
| recibo | empleador | Debitos |

## FOLDER STRUCTURE
```
ROOT/
├── Control de Creditos.gsheet, Control de Debitos.gsheet
├── Dashboard Operativo Contable.gsheet
├── Entrada/, Sin Procesar/
└── {YYYY}/
    ├── Creditos/{MM - Mes}/, Debitos/{MM - Mes}/
    └── Bancos/  # No month subfolders
```

## SPREADSHEETS
See `SPREADSHEET_FORMAT.md` for complete schema.

- **Control de Creditos**: Facturas Emitidas (18 cols), Pagos Recibidos (15 cols)
- **Control de Debitos**: Facturas Recibidas (18 cols), Pagos Enviados (15 cols), Recibos (18 cols)
- **Dashboard**: Resumen Mensual (8 cols), Uso de API (12 cols)

**Key principle**: Store counterparty info only, ADVA's role is implicit.

## MATCHING

### Confidence Levels
- **HIGH**: amount + date in range + CUIT/name match
- **MEDIUM**: amount + date in range, no CUIT
- **LOW**: amount + date in extended range only

### Cascading Displacement
Better matches replace existing ones. Quality comparison: confidence → CUIT match → date proximity.

**Termination**: max depth (10), cycle detection, timeout (30s), no better candidates.

Config: `MAX_CASCADE_DEPTH = 10`, `CASCADE_TIMEOUT_MS = 30000` in `src/config.ts`

### Cross-Currency (USD→ARS)
Exchange rates from ArgentinaDatos API, ±5% tolerance. With CUIT → MEDIUM max; without → LOW.
