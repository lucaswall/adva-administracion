# CLAUDE.md Compliance Checklist

Project-specific rules to verify during code audit.

## Critical Rules

### 1. TDD Mandatory
- Every function should have corresponding tests
- Tests should be written before implementation (check git history if unclear)
- Coverage requirement: >=80%

### 2. Zero Warnings
- Build must produce zero TypeScript warnings
- No unused variables, imports, or parameters
- No implicit `any` types

### 3. No console.log
- Search: `console.log`, `console.warn`, `console.error`
- All logging must use Pino logger from `utils/logger.ts`
- Routes use Fastify logger: `server.log.info()`

### 4. ESM Imports
- All imports must include `.js` extension
- Check: `import { x } from './file.js'` not `import { x } from './file'`

### 5. Result<T,E> Pattern
- Error-prone operations must use Result type
- No throwing exceptions for expected error cases

## Style Guide

### TypeScript
- Strict mode enabled
- Use `interface` over `type` for object shapes
- JSDoc comments on all exported functions

### Naming Conventions
- Files: `kebab-case.ts`
- Types/Interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

## Security

### Authentication
- All endpoints (except `/health`, `/webhooks/drive`) require auth middleware
- Check: `{ onRequest: authMiddleware }` on route definitions
- Webhook endpoint is public but validates channel ID

### Secrets
- No hardcoded secrets in code
- Environment variables for all credentials

## Spreadsheet Rules

### Data Types
- Use `CellDate` for date values
- Use `CellNumber` for monetary values (displays as #,##0.00)

### Timezone Handling
- Script-generated timestamps (e.g., `processedAt`) MUST use spreadsheet timezone
- Fetch timezone: `getSpreadsheetTimezone(spreadsheetId)`
- Pass as 4th parameter to `appendRowsWithLinks()` or `appendRowsWithFormatting()`
- Parsed timestamps from documents should NOT apply timezone conversion

## Test Data

### Allowed Values
- Fake CUITs: `20123456786`, `27234567891`, `20111111119`
- ADVA CUIT `30709076783` is OK
- Fictional names: "TEST SA", "EMPRESA UNO SA", "Juan Perez"

### Forbidden in Tests
- Real customer data
- Production credentials
- Actual file IDs from production

## Grep Commands for Quick Checks

```bash
# Find console.log usage
grep -r "console\." src/ --include="*.ts"

# Find imports without .js extension
grep -rP "from ['\"]\..*(?<!\.js)['\"]" src/ --include="*.ts"

# Find routes without auth
grep -rP "server\.(get|post|put|delete)\s*\([^,]+,[^{]*handler" src/routes/
```
