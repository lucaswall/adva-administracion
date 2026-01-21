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

## MCP SERVERS

### Railway MCP (READ-ONLY)
**Allowed:** `get-logs`, `list-deployments`, `list-services`, `list-variables`, `check-railway-status`

**NEVER:** `deploy`, `create-environment`, `set-variables`, `create-project-and-link`, `deploy-template`, `link-environment`, `link-service`, `generate-domain`

### Google Drive MCP (`gdrive`)
Read-only access to Google Drive with service account authentication.

**Available Tools:**
- `gdrive_search` - Search for files by name (supports pagination)
- `gdrive_read_file` - Read file contents (Google Docs→Markdown, Sheets→CSV, binary files→base64)
- `gdrive_list_folder` - List files and folders in a folder (supports pagination)
- `gdrive_get_pdf` - Download PDFs or export Google Docs/Sheets/Slides to PDF, saves to disk
- `gsheets_read` - Read spreadsheet data (entire sheet, specific ranges, or by sheet ID)

**Use Cases:**
- Search for documents in Drive
- Read spreadsheet data for analysis
- Download files for processing
- List folder contents to understand structure

### Gemini MCP (`gemini`)
Gemini API integration for PDF document analysis and prompt testing.

**Available Tools:**
- `gemini_analyze_pdf` - Analyze PDF files using Gemini models (2.5-flash, 1.5-flash, 1.5-pro)

**Use Cases:**
- Test and optimize document parsing prompts
- Experiment with different Gemini models for PDF extraction
- Validate document parsing strategies before implementing in production code

**Important:** This is for testing/development only. Production PDF parsing uses `src/gemini/` services.

## STRUCTURE
```
src/
├── server.ts             # Entry: Fastify server
├── config.ts             # Environment config (includes MAX_CASCADE_DEPTH, CASCADE_TIMEOUT_MS)
├── constants/spreadsheet-headers.ts
├── routes/{status,scan,webhooks}.ts
├── services/{google-auth,drive,sheets,folder-structure,document-sorter,watch-manager,token-usage-logger}.ts
├── processing/{queue,scanner}.ts  # Includes cascading displacement logic
├── types/index.ts
├── matching/
│   ├── matcher.ts        # FacturaPagoMatcher, ReciboPagoMatcher
│   └── cascade-matcher.ts # Cascading displacement system
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
├── Dashboard Operativo Contable.gsheet
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
- **Dashboard Operativo Contable**: Resumen Mensual (A:H, 8 cols), Uso de API (A:L, 12 cols) - Tracks Gemini API token usage and costs

**IMPORTANT**: Spreadsheets only store counterparty information, NOT ADVA's information:
- **Facturas Emitidas**: Only receptor fields (cuitReceptor, razonSocialReceptor), ADVA as emisor is implicit
- **Facturas Recibidas**: Only emisor fields (cuitEmisor, razonSocialEmisor), ADVA as receptor is implicit
- **Pagos Enviados**: Only beneficiario fields (cuitBeneficiario, nombreBeneficiario), ADVA as pagador is implicit
- **Pagos Recibidos**: Only pagador fields (cuitPagador, nombrePagador), ADVA as beneficiario is implicit
- **Recibos**: Only employee info (nombreEmpleado, cuilEmpleado), ADVA as empleador is implicit

## CASCADING MATCH DISPLACEMENT

Automatic re-matching system that allows better-quality matches to replace existing matches.

### How It Works

When documents are matched (new files OR re-match operations):
1. Try to match against ALL documents (including already-matched ones)
2. If a better match is found, displace the current match
3. Re-match the displaced document against remaining candidates
4. Continue cascading until no better matches are found or termination conditions met
5. Apply all updates atomically to spreadsheets

### Match Quality Hierarchy

Three-tier comparison system (implemented in `compareMatchQuality()`):
1. **Confidence level**: `HIGH` (3) > `MEDIUM` (2) > `LOW` (1)
2. **CUIT/CUIL match**: Has match > No match
3. **Date proximity**: Closer date > Farther date

**Displacement rule**: New match must be **strictly better** (no equal swaps allowed).

### Examples

- ✅ **HIGH displaces MEDIUM**: New pago with HIGH confidence can displace existing MEDIUM match
- ✅ **Same-tier by date**: MEDIUM with 5-day gap can displace MEDIUM with 20-day gap
- ✅ **CUIT priority**: MEDIUM with CUIT match can displace MEDIUM without CUIT
- ❌ **Equal quality**: Two MEDIUM matches with same CUIT status and date proximity don't displace
- ❌ **Worse quality**: MEDIUM cannot displace HIGH

### Termination Conditions

1. **Max cascade depth**: 10 iterations (`MAX_CASCADE_DEPTH`)
2. **Cycle detection**: Stops if cycle detected (A→B→C→A)
3. **Quality improvement**: Only displaces if strictly better
4. **No available candidates**: Displaced document has no remaining matches
5. **Timeout**: 30 seconds maximum (`CASCADE_TIMEOUT_MS`)

### Configuration

Constants in `src/config.ts`:
- `MAX_CASCADE_DEPTH = 10` - Maximum iterations
- `CASCADE_TIMEOUT_MS = 30000` - 30-second timeout

### Logging

All cascade operations logged with structured logging:
```typescript
info('Starting cascading match displacement', {
  module: 'scanner',
  phase: 'cascade',
  unmatchedPagos: count
});

debug('Match displaced', {
  module: 'scanner',
  phase: 'cascade',
  fromPago: oldPagoId,
  toPago: newPagoId,
  factura: facturaId,
  reason: 'Higher confidence'
});

info('Cascade complete', {
  module: 'scanner',
  phase: 'cascade',
  displacedCount: state.displacedCount,
  maxDepth: state.maxDepthReached,
  cycleDetected: state.cycleDetected,
  duration: Date.now() - state.startTime
});
```

### Testing

Comprehensive test coverage in:
- `tests/unit/matching/cascade-matcher.test.ts` - Core data structures and helpers (28 tests)
- `tests/unit/processing/scanner.test.ts` - Integration tests for full cascade flow (4 tests)

Test scenarios:
- Basic displacement (HIGH > MEDIUM > LOW)
- Same-tier displacement by date proximity
- No displacement for equal/worse quality
- Cycle detection
- Max depth termination
- Recibo cascading displacement
