# ADVA Administración Server

## STATUS: DEVELOPMENT
- Active dev - NOT production ready
- Breaking changes OK, no backward compat needed
- Delete unused code immediately
- Update all refs when changing APIs/configs

## RULES
- **SYNC**: Update this file when architecture changes
- **TDD**: Write tests FIRST (red→green→refactor)
- **VERIFY**: code→test-runner→builder→fix before commit
- **BUILD**: Zero warnings required

## TDD (MANDATORY)
1. **WRITE TEST** - Failing test first (red). Cover happy/edge/error paths
2. **IMPLEMENT** - Minimum code to pass. No extras
3. **VERIFY** - Run test-runner, fix impl (not test) if fails
4. **REFACTOR** - Keep tests green

**Coverage: >=80%** | **NEVER**: impl before test, skip "simple" tests, tests after impl

## SUBAGENTS
Use subagents instead of direct commands:

| Agent | Model | Use For | Never |
|-------|-------|---------|-------|
| `test-runner` | haiku | After code changes | `npm test` |
| `builder` | haiku | After code changes | `npm run build` |
| `commit-bot` | haiku | After tests+build pass | `git commit` |
| `pr-creator` | haiku | Creating PRs | `gh pr create` |

**Workflow:** code → test-runner → builder → commit-bot → push → PR

## RAILWAY MCP (READ-ONLY)
**Allowed:** `get-logs`, `list-deployments`, `list-services`, `list-variables`, `check-railway-status`

**NEVER:** `deploy`, `create-environment`, `set-variables`, `create-project-and-link`, `deploy-template`, `link-environment`, `link-service`, `generate-domain`

## STRUCTURE
```
src/
├── server.ts             # Entry: Fastify server
├── config.ts             # Environment config
├── constants/spreadsheet-headers.ts
├── routes/{status,scan,webhooks}.ts
├── services/{google-auth,drive,sheets,folder-structure,document-sorter,watch-manager}.ts
├── processing/{queue,scanner}.ts
├── types/index.ts
├── matching/matcher.ts
├── gemini/{client,prompts,parser,errors}.ts
├── utils/{date,numbers,currency,validation,file-naming,spanish-date,exchange-rate,drive-parser,logger}.ts
└── bank/{matcher,autofill,subdiario-matcher}.ts
```

## COMMANDS
```bash
npm run build    # Compile to dist/
npm start        # Run server
npm run dev      # Dev with watch
npm test         # Vitest tests
npm run lint     # Type check
```

## ENV VARS
| Var | Required | Default |
|-----|----------|---------|
| GOOGLE_SERVICE_ACCOUNT_KEY | Yes | - |
| GEMINI_API_KEY | Yes | - |
| DRIVE_ROOT_FOLDER_ID | Yes | - |
| PORT | No | 3000 |
| NODE_ENV | No | - |
| LOG_LEVEL | No | INFO |
| WEBHOOK_URL | No | - |
| MATCH_DAYS_BEFORE | No | 10 |
| MATCH_DAYS_AFTER | No | 60 |
| USD_ARS_TOLERANCE_PERCENT | No | 5 |

## API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Health check |
| GET | /api/status | Status + queue info |
| POST | /api/scan | Manual scan |
| POST | /api/rematch | Rematch unmatched |
| POST | /api/autofill-bank | Auto-fill bank |
| POST | /webhooks/drive | Drive notifications |

## STYLE
- TS strict mode, `interface`, JSDoc, `Result<T,E>`
- Names: kebab-files, PascalTypes, camelFuncs, UPPER_CONSTS
- ESM imports with `.js` extensions

## LOGGING

**Infrastructure**: Pino logger (`src/utils/logger.ts`) - structured JSON logging with context.

### Log Levels

| Level | Use When | Examples |
|-------|----------|----------|
| `debug()` | Development details, low-level operations | Finding folders, processing items, cache hits |
| `info()` | Important operations, state changes | Server started, folder created, scan complete |
| `warn()` | Unexpected but handled situations | Duplicate files, missing optional data, degraded mode |
| `error()` | Errors, failures, exceptions | API failures, file processing errors, validation failures |

### Rules

1. **ALWAYS use structured logging**:
   ```typescript
   // ✅ GOOD
   info('Server started', { module: 'server', phase: 'startup', port: 3000 });

   // ❌ BAD
   console.log('Server started on port 3000');
   ```

2. **NEVER use `console.log`, `console.error`, etc.** - Always import from `utils/logger.ts`:
   ```typescript
   import { debug, info, warn, error as logError } from '../utils/logger.js';
   ```

3. **Include context** with `module` and `phase`:
   ```typescript
   error('Failed to process file', {
     module: 'scanner',
     phase: 'process-file',
     fileId: 'abc123',
     error: err.message
   });
   ```

4. **Common patterns**:
   - **Start of operation**: `info()` with operation details
   - **Success**: `info()` or `debug()` with results
   - **Error**: `error()` with error message and context
   - **Unexpected but OK**: `warn()` with reason

5. **Routes use Fastify logger**:
   ```typescript
   server.log.info({ folderId }, 'Starting manual scan');
   server.log.error({ error: err.message }, 'Scan failed');
   ```

6. **Error context**: Always include `error: err.message` in context, never log error objects directly.

### Configuration

Set log level via `LOG_LEVEL` env var (default: `INFO`):
- `DEBUG`: All logs (verbose)
- `INFO`: Info, warn, error
- `WARN`: Warn and error only
- `ERROR`: Errors only

## TESTING
- Framework: Vitest
- **DATA POLICY**: No real non-ADVA data
  - Fake CUITs: `20123456786`, `27234567891`, `20111111119`
  - ADVA CUIT `30709076783` OK
  - Use: "TEST SA", "EMPRESA UNO SA", "Juan Perez"

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

## FOLDER STRUCTURE (Year-Based)
```
ROOT/
├── Control de Creditos.gsheet
├── Control de Debitos.gsheet
├── Entrada/        # Scan source
├── Sin Procesar/   # Failed docs
└── {YYYY}/         # Created on-demand
    ├── Creditos/{MM - Mes}/
    ├── Debitos/{MM - Mes}/
    └── Bancos/     # No month subfolders
```

## SPREADSHEETS
- **Control de Creditos**: Facturas Emitidas (A:R, 18 cols), Pagos Recibidos (A:O, 15 cols)
- **Control de Debitos**: Facturas Recibidas (A:R, 18 cols), Pagos Enviados (A:O, 15 cols), Recibos (A:R, 18 cols)

**IMPORTANT**: Spreadsheets only store counterparty information, NOT ADVA's information:
- **Facturas Emitidas**: Only receptor fields (cuitReceptor, razonSocialReceptor), ADVA as emisor is implicit
- **Facturas Recibidas**: Only emisor fields (cuitEmisor, razonSocialEmisor), ADVA as receptor is implicit
- **Pagos Enviados**: Only beneficiario fields (cuitBeneficiario, nombreBeneficiario), ADVA as pagador is implicit
- **Pagos Recibidos**: Only pagador fields (cuitPagador, nombrePagador), ADVA as beneficiario is implicit
- **Recibos**: Only employee info (nombreEmpleado, cuilEmpleado), ADVA as empleador is implicit
