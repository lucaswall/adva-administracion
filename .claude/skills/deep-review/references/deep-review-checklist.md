# Deep Review Checklist

Cross-domain checklist organized around interaction patterns. Each section requires reasoning about how multiple files work together — not just individual file quality.

## 1. Data Flow Integrity

Trace data from source to storage and back.

### API Contract Alignment
- Response type from route handler matches what callers expect
- All fields accessed actually exist in the response object
- Optional/nullable fields handled properly (not bare `.field` access)
- Error response shape from routes is consistent across the API
- Request body shape from clients matches what the route validates/expects

### Type Safety Across Boundaries
- Shared types used by BOTH the route and the service layer
- No `as any` or `as Type` casts that paper over a contract mismatch
- Response transformations preserve type safety (no lossy conversions)
- Third-party API responses validated before use (Google Drive, Sheets, Gemini)
- Gemini AI responses validated before use (AI output boundary)

### Data Transformation
- Date/time values serialized and deserialized correctly (CellDate handling, normalizeSpreadsheetDate)
- Numeric values maintain precision through transformations (CellNumber for monetary values)
- Arrays/collections handled correctly when empty, single-element, or large
- Undefined vs null vs missing key handled consistently

## 2. State Lifecycle

### Concurrency
- Processing lock properly acquired and released in all code paths (including error paths)
- Scan state machine transitions are atomic (no TOCTOU races across await points)
- Queue processing handles concurrent webhook triggers correctly
- Lock timeout prevents deadlocks from crashed processing

### File Processing State
- Files tracked through processing lifecycle (pending -> processing -> success/failed)
- Stale processing files recovered on startup
- Failed files moved to correct destination (Sin Procesar folder)
- Duplicate detection prevents reprocessing

### Race Conditions
- Concurrent webhook notifications don't cause duplicate processing
- Lock acquisition prevents interleaved scan and match operations
- Auto-triggered matchAllMovimientos doesn't conflict with manual match requests

## 3. Error Path Completeness

### Route Handler Errors
- Every `await` in route handlers wrapped in try/catch or within a try block
- External API errors (Google Drive, Sheets, Gemini) return appropriate HTTP status
- Validation errors return 400 with useful error message
- Auth failures return 401 consistently
- Error responses don't leak internal details (stack traces, file paths, API keys)

### Service Layer Error Handling
- Google Drive API errors handled with appropriate retry/fallback
- Google Sheets API errors handled (rate limits, quota exceeded)
- Gemini API errors classified correctly (transient vs permanent)
- Result<T,E> pattern used consistently for fallible operations

### Error Recovery
- Transient errors trigger retry with exponential backoff (scanner retry mechanism)
- Failed files tracked in dashboard for visibility
- Processing lock released on error (no deadlock on failure)
- Partial success states handled (e.g., file extracted but storage failed)

## 4. Edge Cases

### Empty/Missing Data
- Processing handles empty Entrada folder gracefully
- Spreadsheet operations handle empty sheets (no rows)
- Matching handles no candidates found
- Gemini extraction handles documents with missing fields

### Boundary Values
- Very long text (document descriptions, company names) handled correctly
- Very large numbers (monetary amounts) maintain precision
- Zero values displayed correctly (0 is valid, not treated as "missing")
- Special characters in document content don't break parsing or storage
- Documents with unusual date formats handled

### Document Processing
- All document types classified correctly (factura, pago, recibo, retencion, resumen)
- ADVA CUIT direction detection works for all document types
- Missing or ambiguous CUIT handling
- Multi-page documents processed correctly
- Documents in unexpected formats handled gracefully

## 5. Security Surface

### Authentication & Authorization
- All routes except /health and /webhooks/drive require Bearer token
- Auth middleware applied consistently via `{ onRequest: authMiddleware }`
- Webhook endpoint validates channel ID
- API_SECRET not logged or exposed in responses

### Input Validation
- Request bodies validated before processing
- File uploads validated (Google Drive file types)
- No path traversal via user-controlled file paths
- Drive file IDs validated before API calls

### Sensitive Data
- API keys, service account keys not logged
- Gemini API key loaded from environment, never hardcoded
- Error responses don't leak internal details
- Google service account credentials protected

## 6. Google Sheets Data Integrity

### Spreadsheet Operations
- Column mappings match SPREADSHEET_FORMAT.md definitions
- CellDate type used for all date fields (not plain strings)
- CellNumber type used for all monetary fields
- Spreadsheet timezone used for script-generated timestamps
- Parsed timestamps from documents NOT converted with spreadsheet timezone
- normalizeSpreadsheetDate() used when reading dates back from sheets (not String())

### Data Consistency
- Row data matches expected column count and order
- Duplicate detection prevents writing same document twice
- Matching updates don't corrupt existing row data
- Sheet name discovery handles missing or renamed sheets

## 7. Performance

### API Call Efficiency
- No redundant Google Drive/Sheets API calls
- Batch operations used where available (appendRows vs individual inserts)
- Rate limiting respected for Google APIs
- Gemini API calls have appropriate timeout and retry

### Memory
- Large document processing doesn't accumulate unbounded data
- Queue processing doesn't load all files into memory at once
- Streaming used for large file operations where possible

### Network
- No waterfall API calls that could be parallel
- Retry delays don't block the event loop
- Connection timeouts configured for external APIs

## 8. Logging Coverage

### Across the Feature
- Error paths log with context (action, inputs, error details)
- External API calls log duration and outcome
- Key state changes logged at INFO level (file processed, match found, storage complete)
- Debug coverage exists for troubleshooting each layer

### Common Issues
- Same error logged at both service and route handler (double-logging)
- Missing structured { module, phase, action } fields — string-only messages can't be filtered
- Sensitive data in logs (API keys, service account details)
- No logging in catch blocks (silent failures invisible in production)
- console.log/warn/error instead of Pino logger

## 9. AI Integration (Gemini API)

When the reviewed feature involves Gemini API integration, trace the full AI data flow.

### Prompt Quality
- Prompts in src/gemini/prompts.ts are detailed and specific
- Document type-specific prompts handle edge cases
- Prompts specify expected output format clearly
- Prompts handle ambiguous inputs gracefully

### Response Validation
- Gemini JSON responses validated before use
- Numeric fields validated as non-negative where appropriate
- String fields checked for non-empty where required
- Document type classification validated against known types
- CUIT format validated (11 digits)

### AI Data Flow Tracing

Follow data through the full AI pipeline:

1. **Input preparation** — PDF content prepared for Gemini, file metadata gathered
   - Are files validated (size, type) before sending?
   - Is the correct prompt selected for the document type?

2. **Gemini API call** — Prompt construction, API invocation
   - Is the prompt appropriate for the document?
   - Are API errors handled (rate limit, timeout, invalid response)?
   - Is retry logic correct for transient errors (JSON parse failures)?

3. **Response processing** — JSON parsing, field extraction
   - Is the JSON response parsed safely (try/catch)?
   - Are all expected fields validated?
   - Are optional fields handled correctly?

4. **Data classification** — Document type determination, direction detection
   - Is ADVA CUIT detection correct for all document types?
   - Is direction (emitida/recibida, enviado/recibido) determined correctly?
   - Are edge cases handled (missing CUIT, ambiguous direction)?

### Error Handling
- Gemini API rate limits handled with retry/backoff
- JSON parse errors classified as transient (retried) vs permanent
- Timeouts configured on Gemini API client
- Token usage tracked for cost monitoring

## 10. AI-Generated Code Risks

All code in this project is AI-assisted. When tracing data flows and interactions, watch for these AI-specific patterns:

### Cross-Domain AI Issues
- **Hallucinated APIs** — API calls to methods/endpoints that don't exist or have wrong signatures. Verify against actual library docs.
- **Contract mismatches introduced by AI** — service assumes response fields that the API doesn't return, or vice versa
- **Copy-paste patterns** — similar handler logic duplicated across storage modules instead of shared
- **Missing validation at boundaries** — AI often generates the "happy path" and skips validation of external data (Google API responses, Gemini outputs, webhook payloads)
- **Inconsistent error handling** — some error paths return proper responses while others silently fail or return generic errors
- **Over-abstraction** — unnecessary wrappers, helpers, or config for one-time operations
