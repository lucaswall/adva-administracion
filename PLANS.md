# Bug Fix Plan

**Created:** 2026-01-29
**Bug Report:** 100 test files ended up in Sin Procesar folder - REGRESSION
**Category:** Critical Bug / Architecture Fix

## Investigation

### Context Gathered
- **MCPs used:** Railway MCP (get-logs, list-deployments)
- **Files examined:**
  - Railway deployment logs from deployment `0e07f7e6-3873-4930-9ed9-df2c6db7eab4`
  - Git commit `71bbc73` (LP validation, fetch timeout, rate limit race)
  - `src/config.ts` (FETCH_TIMEOUT_MS = 30000)
  - `src/gemini/client.ts` (AbortController implementation)
  - `src/processing/extractor.ts` (circuit breaker usage)
  - `src/utils/circuit-breaker.ts` (failureThreshold = 5)

### Evidence

**Log Analysis - Failure Pattern:**

| Time | Error Type | Count | Files Affected |
|------|------------|-------|----------------|
| 12:52:00 - 12:54:13 | `Extraction failed: Gemini API request timeout after 30000ms` | ~12 | CC$ BBVA *.pdf (bank statements) |
| 12:54:25 onward | `Classification failed: Circuit breaker is open for gemini` | ~88 | All remaining files |

**Sample Error Messages from Logs:**
```
[INFO] Failed to process file error="Extraction failed: Gemini API request timeout after 30000ms" fileName="02 CC$ BBVA FEB 2025.pdf"
[INFO] Failed to process file error="Classification failed: Circuit breaker is open for gemini. Retry in 49s" fileName="2025-11-10 - Magarinos..."
```

### Root Cause

**Two architectural issues combined to cause total failure:**

1. **30-second timeout is too short** for large PDF extraction (bank statements need 60-120+ seconds)
2. **Circuit breaker pattern is misapplied** for this batch processing use case

**The cascade of failure:**
1. Large bank statement PDFs sent to Gemini for extraction
2. 30s timeout kills requests before Gemini responds → counted as "failure"
3. After 5 "failures", circuit breaker opens
4. ALL remaining ~88 files immediately rejected with "Circuit breaker is open"
5. 100% of files end up in Sin Procesar

### Architectural Analysis

**Why circuit breaker is wrong for this use case:**

| Circuit Breaker Design Intent | This Use Case Reality |
|-------------------------------|----------------------|
| Protect against failing services | Gemini is working, just slow |
| Prevent cascading failures in microservices | Batch processing - no cascade risk |
| Fast-fail on unavailable dependencies | Timeouts are normal for large PDFs |
| Service needs time to "recover" | Gemini doesn't need recovery |

**Research Sources:**
- [Martin Fowler - Circuit Breaker](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Microsoft Azure - Circuit Breaker Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [AKF Partners - Circuit Breaker Dos and Don'ts](https://akfpartners.com/growth-blog/the-circuit-breaker-pattern-dos-and-donts)
- [Google Gemini - Document Understanding](https://ai.google.dev/gemini-api/docs/document-processing) - notes that large PDFs (300+ pages) can take >3 minutes

### Affected Files
- `src/config.ts` - `FETCH_TIMEOUT_MS = 30000` (too short)
- `src/processing/extractor.ts` - circuit breaker wrapping Gemini calls (wrong pattern)
- `src/utils/circuit-breaker.ts` - entire module to be deleted (not used elsewhere)
- `CLAUDE.md` - lists circuit-breaker.ts in structure (needs update)
- `TODO.md` - item #58 about circuit breaker bug (needs removal)

## Fix Plan

### Task 1: Increase fetch timeout to 5 minutes

**Rationale:** Google's documentation notes large PDFs can take >3 minutes. 5 minutes provides safety margin.

1. Update `FETCH_TIMEOUT_MS` in `src/config.ts` from `30000` to `300000` (5 minutes)
2. Update JSDoc comment to reflect new value
3. Run test-runner to verify no tests break

### Task 2: Remove circuit breaker from document extraction

**Rationale:** Circuit breaker is designed for service unavailability, not slow processing. This is batch processing with no cascade risk.

1. In `src/processing/extractor.ts`:
   - Remove import: `import { getCircuitBreaker } from '../utils/circuit-breaker.js';`
   - Remove circuit breaker instantiation (lines 165-170)
   - Replace `circuitBreaker.execute(async () => { ... })` with direct calls:
     - Classification call: unwrap from `circuitBreaker.execute()`, keep inner logic
     - Extraction call: unwrap from `circuitBreaker.execute()`, keep inner logic
   - Keep the existing error handling (the `if (!result.ok)` checks)
2. Run test-runner to verify tests pass

### Task 3: Delete circuit breaker module entirely

**Rationale:** Circuit breaker is only used in extractor.ts - no other usages in codebase.

1. Delete file: `src/utils/circuit-breaker.ts`
2. Run builder to verify no import errors

### Task 4: Update documentation

1. In `CLAUDE.md`:
   - Remove `│   ├── circuit-breaker.ts` from the STRUCTURE section (line 206)
2. In `TODO.md`:
   - Remove item #58 (circuit breaker state transition bug) - no longer applicable

### Task 5: Add slow call logging for monitoring

**Rationale:** We still want visibility into slow calls without treating them as failures.

1. In `src/gemini/client.ts`, add logging after successful calls that took > 60 seconds:
   ```typescript
   if (duration > 60000) {
     warn('Slow Gemini API call', {
       module: 'gemini-client',
       phase: 'api-call',
       durationMs: duration,
       fileId,
       fileName,
     });
   }
   ```
2. Run test-runner to verify tests pass

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

## Recovery Steps

After deploying the fix:
1. Move all 100 files from Sin Procesar back to Entrada folder in Google Drive
2. System will automatically reprocess them on next scan (every 5 minutes)
3. Monitor Railway logs to verify successful processing
4. Watch for slow call warnings to understand actual processing times

## Future Considerations

1. **Gemini Files API**: For very large documents, consider pre-uploading via Files API to reduce per-request processing time
2. **Async processing**: If timeouts remain an issue, consider async job queue pattern
3. **Circuit breaker for actual outages**: If needed in future, implement one that ONLY triggers on 5xx errors or network failures, NOT timeouts

---

## Status: READY FOR IMPLEMENTATION
