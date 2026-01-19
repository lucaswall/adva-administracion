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

# Test the server
curl http://localhost:3000/health
curl http://localhost:3000/api/status
curl -X POST http://localhost:3000/api/scan
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
├── routes/
│   ├── status.ts          # GET /health, /api/status
│   ├── scan.ts            # POST /api/scan, /rematch, /autofill-bank
│   └── webhooks.ts        # POST /webhooks/drive
├── services/
│   ├── google-auth.ts     # Service account authentication
│   ├── drive.ts           # Drive API wrapper
│   ├── sheets.ts          # Sheets API wrapper
│   ├── folder-structure.ts # Folder discovery/caching
│   └── document-sorter.ts  # Document file movement
├── processing/
│   └── queue.ts           # p-queue processing
├── types/
│   └── index.ts           # TypeScript interfaces
├── matching/
│   └── matcher.ts         # Invoice-payment matching algorithms
├── gemini/
│   ├── client.ts          # Gemini API client (native fetch)
│   ├── prompts.ts         # Extraction prompts
│   ├── parser.ts          # Response parsing
│   └── errors.ts          # Error classification
├── utils/                 # Pure utilities (date, currency, validation)
└── bank/
    ├── matcher.ts         # Bank movement matching
    └── subdiario-matcher.ts # Subdiario matching

tests/
└── unit/                  # Unit tests mirroring src/ structure
```

### Module Responsibilities

- **types/**: TypeScript interfaces
- **gemini/**: PDF to structured data extraction
- **services/**: Google APIs integration
- **matching/**: Invoice-payment matching and scoring
- **bank/**: Bank movements and auto-fill
- **utils/**: Date, CUIT, currency utilities
- **routes/**: HTTP endpoint handlers
- **processing/**: Queue management

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
