# ADVA Administración - Development Guide

## Local Development Setup

### Prerequisites

- Node.js v20+
- Google Cloud Service Account with Drive and Sheets API access
- Gemini API Key from https://aistudio.google.com/apikey

### Initial Setup

```bash
git clone <repository-url>
cd adva-administracion
npm install
```

### Environment Configuration

Create a `.env` file in the project root:

```env
PORT=3000
NODE_ENV=development
LOG_LEVEL=DEBUG

GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded-json>
GEMINI_API_KEY=your_gemini_api_key
DRIVE_ROOT_FOLDER_ID=your_folder_id
API_SECRET=dev-secret-token

# Optional: for Apps Script build and webhooks (use http:// for localhost)
API_BASE_URL=http://localhost:3000

# Optional: matching parameters
MATCH_DAYS_BEFORE=10
MATCH_DAYS_AFTER=60
USD_ARS_TOLERANCE_PERCENT=5
```

To encode your service account:
```bash
cat service-account.json | base64
```

### Running Locally

```bash
# Development mode with watch
npm run dev

# Test the server (note: all endpoints except /health and /webhooks/drive require auth)
curl http://localhost:3000/health
curl -H "Authorization: Bearer dev-secret-token" http://localhost:3000/api/status
curl -X POST -H "Authorization: Bearer dev-secret-token" http://localhost:3000/api/scan
```

---

## Testing

### Test Commands

```bash
npm test               # Run all tests
npm run test:watch     # Watch mode for TDD
npm run test:coverage  # Generate coverage report
npm run lint           # Type checking
```

### TDD Workflow

**Every feature or bug fix must follow this sequence:**

1. **Write failing test first**
   - Create/update test file before implementation
   - Test should fail (red) - verifies it's testing something
   - Cover happy path, edge cases, and error conditions

2. **Implement minimum code**
   - Write only enough code to make the test pass
   - No extra features or "while I'm here" changes

3. **Verify test passes**
   - Run tests to confirm green
   - If fails, fix implementation (not the test, unless test was wrong)

4. **Refactor if needed**
   - Clean up code while keeping tests green
   - Run tests again after refactoring

**Coverage requirement:** ≥80% for happy paths, edge cases, and error paths

### Test Data Policy

**NEVER use real-world non-ADVA private information in tests**

- Use fabricated CUITs (valid checksum but fake): `20123456786`, `27234567891`, `20111111119`
- ADVA CUIT `30709076783` is allowed (company's own)
- Use fictional names: "TEST SA", "EMPRESA UNO SA", "Juan Pérez"

---

## Build Process

```bash
npm run build  # Compile TypeScript to dist/
npm start      # Run production build
```

**Zero-warning policy:** Build must complete without warnings.

---

## Project Structure

```
src/
├── server.ts              # Fastify entry point
├── config.ts              # Environment-based configuration
├── constants/
│   └── spreadsheet-headers.ts # Spreadsheet header definitions
├── routes/
│   ├── status.ts          # GET /health, /api/status
│   ├── scan.ts            # POST /api/scan, /rematch, /autofill-bank
│   └── webhooks.ts        # POST /webhooks/drive
├── middleware/
│   └── auth.ts            # Bearer token authentication
├── services/
│   ├── google-auth.ts     # Service account authentication
│   ├── drive.ts           # Drive API wrapper
│   ├── sheets.ts          # Sheets API wrapper
│   ├── folder-structure.ts # Folder discovery/caching
│   ├── document-sorter.ts # Document file movement
│   ├── watch-manager.ts   # Real-time monitoring
│   └── token-usage-logger.ts # Gemini API cost tracking
├── processing/
│   ├── queue.ts           # p-queue processing
│   └── scanner.ts         # Document scanning and classification
├── types/
│   └── index.ts           # TypeScript interfaces
├── matching/
│   ├── matcher.ts         # Invoice-payment matching
│   └── cascade-matcher.ts # Cascading displacement system
├── gemini/
│   ├── client.ts          # Gemini API client
│   ├── prompts.ts         # Extraction prompts
│   ├── parser.ts          # Response parsing
│   └── errors.ts          # Error classification
├── utils/                 # Pure utilities
│   ├── date.ts, numbers.ts, currency.ts
│   ├── validation.ts, file-naming.ts
│   ├── spanish-date.ts, exchange-rate.ts
│   ├── drive-parser.ts, spreadsheet.ts
│   └── logger.ts          # Pino structured logging
└── bank/
    ├── matcher.ts         # Bank movement matching
    ├── autofill.ts        # Bank auto-fill functionality
    └── subdiario-matcher.ts # Subdiario matching

tests/unit/                # Unit tests mirroring src/ structure
```

### Module Responsibilities

- **types/**: TypeScript interfaces (DocumentType with direction awareness)
- **constants/**: Spreadsheet header definitions (Ingresos/Egresos split)
- **gemini/**: PDF to structured data extraction (direction-aware classification)
- **services/**: Google APIs integration (dual spreadsheet support)
- **matching/**: Invoice-payment matching and scoring
- **bank/**: Bank movements and auto-fill
- **utils/**: Date, CUIT, currency, file-naming utilities
- **routes/**: HTTP endpoint handlers
- **processing/**: Queue management and document scanning

---

## Code Style

### TypeScript

- Strict mode enabled
- Use `interface` for type definitions
- JSDoc comments for public APIs
- Result<T,E> pattern for error handling

### Naming Conventions

- **Files**: kebab-case (e.g., `folder-structure.ts`)
- **Types**: PascalCase (e.g., `ProcessResult`)
- **Functions**: camelCase (e.g., `parseInvoice`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`)

### Imports

- Use ESM imports with `.js` extensions:
  ```typescript
  import { config } from './config.js';
  ```

---

## Development Status

**This project is in active development:**

- NOT production ready
- No backward compatibility required - breaking changes are OK
- No deprecation warnings or migration paths needed
- Delete unused code immediately - do not keep "for compatibility"
- When changing APIs/configs: update all references, remove old ones

---

## Contributing

### Before Committing

1. Run tests: `npm test`
2. Run build: `npm run build`
3. Run lint: `npm run lint`
4. All must pass with zero warnings/errors

### Commit Messages

Follow conventional commits format:
- `feat: add new feature`
- `fix: resolve bug`
- `chore: maintenance task`
- `docs: documentation update`
- `test: add/update tests`

---

## Troubleshooting Development Issues

| Issue | Solution |
|-------|----------|
| Server won't start | Check `.env` file exists with required variables |
| Import errors | Ensure `.js` extensions in import statements |
| Type errors | Run `npm run lint` for detailed type checking |
| Tests failing | Run `npm run test:watch` to debug in TDD mode |
| Google API errors | Verify service account key is base64-encoded correctly |
| "Permission denied" | Share Drive folder with service account email |

---

## Linear Integration

This project uses Linear for issue tracking via MCP (Model Context Protocol).

### Authentication

1. Run `/mcp` in Claude Code to authenticate with Linear
2. Follow the OAuth flow in your browser
3. Authentication tokens are stored in `~/.mcp-auth`

### Workflow

- **Create issues:** Use Linear UI or `code-audit` skill
- **Plan work:** Use `plan-todo` to convert Backlog issues to plans
- **Track progress:** Issues move through states automatically:
  - Backlog → Todo → In Progress → Review → Done

### Required Linear Setup

Team "ADVA Administracion" must have:
- **States:** Backlog, Todo, In Progress, Review, Done
- **Labels:** Security, Bug, Performance, Convention, Technical Debt, Feature, Improvement
