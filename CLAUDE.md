# ADVA Administración Server

## STATUS: DEVELOPMENT
- Breaking changes OK, delete unused code immediately
- Update all refs when changing APIs/configs

## RULES
- **BUILD**: Zero warnings required
- **SYNC**: Update this file when architecture changes
- **PLANS**: Fully executable by Claude - no manual human steps

## TDD WORKFLOW (MANDATORY)

**For every new function/feature, follow this sequence:**

1. **Write test first** - Create failing test that defines expected behavior
2. **Run test-runner** - Confirm test fails (red)
3. **Write implementation** - Minimal code to pass the test
4. **Run test-runner** - Confirm test passes (green)
5. **Refactor** - Clean up while keeping tests green

**NEVER write implementation code before its test exists.**

Coverage requirement: >=80%

**Post-implementation verification:**
`bug-hunter` → `test-runner` → `builder` → fix any issues

## SUBAGENTS

| Agent | Purpose | Replaces |
|-------|---------|----------|
| `bug-hunter` (opus) | Find bugs in git changes | - |
| `test-runner` (haiku) | Run tests | `npm test` |
| `builder` (haiku) | Build project | `npm run build` |
| `commit-bot` (haiku) | Commit to current branch | `git commit` |
| `pr-creator` (haiku) | Branch + commit + push + PR | `gh pr create` |

**Git agents**: Only use if explicitly requested. If PR requested, use `pr-creator` only (it includes commit). Never use both.

## MCP SERVERS

**Railway MCP** (READ-ONLY): `get-logs`, `list-deployments`, `list-services`, `list-variables`, `check-railway-status`
- NEVER: `deploy`, `create-environment`, `set-variables`, `create-project-and-link`, `deploy-template`, `link-environment`, `link-service`, `generate-domain`

**Google Drive MCP** (`gdrive`): `gdrive_search`, `gdrive_read_file`, `gdrive_list_folder`, `gdrive_get_pdf`, `gsheets_read`

**Gemini MCP** (`gemini`): `gemini_analyze_pdf` - For testing prompts only; production uses `src/gemini/`

## STRUCTURE
```
src/
├── server.ts, config.ts, types/index.ts  # TipoTarjeta type in types/
├── constants/spreadsheet-headers.ts
├── routes/{status,scan,webhooks}.ts
├── middleware/auth.ts          # Bearer token auth
├── services/{google-auth,drive,sheets,folder-structure,document-sorter,watch-manager,token-usage-logger,pagos-pendientes}.ts
├── processing/{queue,scanner,extractor}.ts
├── processing/matching/{index,factura-pago-matcher,recibo-pago-matcher,nc-factura-matcher}.ts
├── processing/storage/{index,factura-store,pago-store,recibo-store,retencion-store,resumen-store}.ts
├── matching/{matcher,cascade-matcher}.ts
├── gemini/{client,prompts,parser,errors}.ts  # TipoTarjeta validation
├── utils/{date,numbers,currency,validation,file-naming,spanish-date,exchange-rate,drive-parser,logger,spreadsheet,circuit-breaker,concurrency,correlation}.ts
└── bank/{matcher,autofill,subdiario-matcher}.ts

apps-script/   # Dashboard ADVA menu (bound script)
├── src/{main.ts,config.template.ts}
├── build.js   # Injects API_BASE_URL + API_SECRET from .env
└── dist/      # Compiled output (clasp pushes from here)
```

## SECURITY

All endpoints except `/health` and `/webhooks/drive` require Bearer token: `Authorization: Bearer <API_SECRET>`

**Adding endpoints**: Always use `{ onRequest: authMiddleware }`:
```typescript
server.post('/api/new', { onRequest: authMiddleware }, handler);
```

**Webhook endpoint**: `/webhooks/drive` is public (no auth) - Google Drive cannot send custom headers. Security via channel ID validation.

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
| POST | /webhooks/drive | No | Drive notifications |

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

**In plans:** Each implementation task MUST include writing tests as its first step. Example:
```
Task: Add parseResumenBroker function
1. Write test in parser.test.ts for parseResumenBrokerResponse
2. Run test-runner (expect fail)
3. Implement parseResumenBrokerResponse in parser.ts
4. Run test-runner (expect pass)
```

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

## FOLDER STRUCTURE
```
ROOT/
├── Control de Ingresos.gsheet, Control de Egresos.gsheet
├── Dashboard Operativo Contable.gsheet
├── Entrada/, Sin Procesar/, Duplicado/
└── {YYYY}/
    ├── Ingresos/{MM - Mes}/, Egresos/{MM - Mes}/
    └── Bancos/
        ├── {Bank} {Account} {Currency}/     # Bank accounts (resumen_bancario)
        ├── {Bank} {CardType} {LastDigits}/  # Credit cards (resumen_tarjeta)
        └── {Broker} {Comitente}/            # Brokers (resumen_broker)
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
  - `resumen_bancario`: 9 cols with `moneda` (ARS/USD)
  - `resumen_tarjeta`: 9 cols with `tipoTarjeta` (Visa/Mastercard/etc)
  - `resumen_broker`: 8 cols with `saldoARS` + `saldoUSD` (multi-currency)
- **Dashboard**: Pagos Pendientes (10 cols), Resumen Mensual (7 cols), Uso de API (12 cols)

**Principles:**
- Store counterparty info only, ADVA's role is implicit
- Use `CellDate` type for proper date formatting in spreadsheets

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
