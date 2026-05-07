# Implementation Plan

**Status:** COMPLETE
**Created:** 2026-05-07
**Source:** Backlog: ADV-191, ADV-192, ADV-193, ADV-194, ADV-195, ADV-196, ADV-197, ADV-200, ADV-201, ADV-202, ADV-203, ADV-204, ADV-206, ADV-207, ADV-208, ADV-210, ADV-211, ADV-212, ADV-213, ADV-214, ADV-216, ADV-217, ADV-218
**Linear Issues:** [ADV-191](https://linear.app/lw-claude/issue/ADV-191), [ADV-192](https://linear.app/lw-claude/issue/ADV-192), [ADV-193](https://linear.app/lw-claude/issue/ADV-193), [ADV-194](https://linear.app/lw-claude/issue/ADV-194), [ADV-195](https://linear.app/lw-claude/issue/ADV-195), [ADV-196](https://linear.app/lw-claude/issue/ADV-196), [ADV-197](https://linear.app/lw-claude/issue/ADV-197), [ADV-200](https://linear.app/lw-claude/issue/ADV-200), [ADV-201](https://linear.app/lw-claude/issue/ADV-201), [ADV-202](https://linear.app/lw-claude/issue/ADV-202), [ADV-203](https://linear.app/lw-claude/issue/ADV-203), [ADV-204](https://linear.app/lw-claude/issue/ADV-204), [ADV-206](https://linear.app/lw-claude/issue/ADV-206), [ADV-207](https://linear.app/lw-claude/issue/ADV-207), [ADV-208](https://linear.app/lw-claude/issue/ADV-208), [ADV-210](https://linear.app/lw-claude/issue/ADV-210), [ADV-211](https://linear.app/lw-claude/issue/ADV-211), [ADV-212](https://linear.app/lw-claude/issue/ADV-212), [ADV-213](https://linear.app/lw-claude/issue/ADV-213), [ADV-214](https://linear.app/lw-claude/issue/ADV-214), [ADV-216](https://linear.app/lw-claude/issue/ADV-216), [ADV-217](https://linear.app/lw-claude/issue/ADV-217), [ADV-218](https://linear.app/lw-claude/issue/ADV-218)
**Branch:** fix/audit-2026-05

## Context Gathered

### Codebase Analysis

- **Concurrency primitives:** `src/utils/concurrency.ts` — `LockManager` with `withLock()` wrapper, `acquire()` uses CAS on `lockInstanceId`, `release()` does NOT (the gap fixed by ADV-195). `PROCESSING_LOCK_ID` is the single named lock for scan + match.
- **Processing entry points:**
  - `src/processing/scanner.ts` — `scanFolder()` (lock-protected via state machine), `rematch()` (NOT lock-protected — ADV-191), `processFileWithRetry()`
  - `src/bank/match-movimientos.ts` — `matchAllMovimientos()` (lock-protected), `matchBankMovimientos()` (the per-bank inner; pagada partial-failure pattern at lines 1130-1161 — ADV-202)
  - `src/processing/queue.ts` — `ProcessingQueue` wraps p-queue; `add()` is async and rethrows
- **Gemini boundary:** `src/gemini/client.ts` (per-call rate limit, 60s slow-call WARN, AbortController timeout via `FETCH_TIMEOUT_MS`), `src/gemini/parser.ts` (`validateAdvaRole` accepts `data: any` — ADV-203), `src/gemini/prompts.ts`
- **Result<T,E> pattern:** every fallible function returns `Result<T, Error>` from `src/types/index.ts`; helpers `ok()` / `err()` not present, callers construct objects directly (see scanner.ts patterns)
- **Logging:** Pino via `src/utils/logger.ts` (`info`, `warn`, `error`, `debug` exports); structured fields are `{ module, phase, ...rest }` — production convention. Logs are an internal debugging surface — full information is preserved by design.
- **Routes:** `src/routes/scan.ts` (POST `/api/scan`, `/api/rematch`, `/api/match-movimientos`), all gated by `authMiddleware`
- **Test conventions:** Vitest, colocated `*.test.ts`. Examples: `src/processing/queue.test.ts`, `src/processing/matching/nc-factura-matcher.test.ts`, `src/gemini/parser.test.ts`. Fictional CUITs: `20123456786`, `27234567891`, `20111111119`. ADVA CUIT `30709076783`.

### MCP Context

- **Linear:** team `ADVA Administracion`. Statuses include Backlog, Todo, In Progress, Review, Merge, Done, Canceled. Status UUID for Todo: `215a529c-632b-4ef3-ab3a-e82bd4b55578`.
- **Sentry:** MCP unavailable at audit time. No Sentry references in any planned issue.

### Triage Results

**Planned (23):** ADV-191, ADV-192, ADV-193, ADV-194, ADV-195, ADV-196, ADV-197, ADV-200, ADV-201, ADV-202, ADV-203, ADV-204, ADV-206, ADV-207, ADV-208, ADV-210, ADV-211, ADV-212, ADV-213, ADV-214, ADV-216, ADV-217, ADV-218

**Canceled (5):**

| Issue | Title | Reason |
|-------|-------|--------|
| ADV-205 | Fastify server registers no security headers | Internal Bearer-auth JSON API — CSP/HSTS/X-Frame-Options are browser-content protections with no realistic browser-rendered surface. Revisit only if a browser UI is added. |
| ADV-215 | `action:` field convention | Checklist/doc disagreement — codebase uses `{ module, phase }` consistently; right fix is updating the audit checklist, not refactoring 80 files. |
| ADV-198 | API_SECRET in Apps Script bundle | Accepted by design. The bound spreadsheet's script project shares the same trust principal as the Railway env. Audit checklist updated to no longer flag this. |
| ADV-199 | Raw Gemini response logged at ERROR | Full information preserved by design for production debugging. Audit checklist updated to no longer flag log content. |
| ADV-209 | Prompt/response previews at DEBUG | Same principle as ADV-199 — internal debugging surface, full info wanted. Audit checklist updated. |

## Tasks

### Task 1: Acquire processing lock in /api/rematch path
**Linear Issue:** [ADV-191](https://linear.app/lw-claude/issue/ADV-191) — Urgent

**Files:**
- `src/processing/scanner.test.ts` (modify)
- `src/processing/scanner.ts` (modify)

**Steps:**
1. Write test in `src/processing/scanner.test.ts` for `rematch()`:
   - Test asserts `withLock(PROCESSING_LOCK_ID, ...)` is invoked (mock `withLock` from `utils/concurrency.ts` and verify call args).
   - Test asserts that when `withLock` returns `{ ok: false, error }` (lock held), `rematch()` returns the same error and never invokes `runMatching`.
   - Test asserts the lock is released even if `runMatching` rejects (use a mock that throws).
2. Run `verifier "scanner"` (expect fail).
3. Wrap the existing `runMatching(folderStructure, config)` body of `rematch()` in `withLock(PROCESSING_LOCK_ID, async () => { ... }, PROCESSING_LOCK_TIMEOUT_MS)`. Preserve correlation context. Return `Result<RematchResult, Error>` consistent with current shape.
4. Run `verifier "scanner"` (expect pass).

**Notes:**
- Pattern source: `matchAllMovimientos` in `src/bank/match-movimientos.ts` already uses `withLock` correctly — copy the wrapping shape.
- Preserve the existing `info('Rematch complete', ...)` log; it should run inside the locked block, not outside.

---

### Task 2: LockManager.release CAS on lockInstanceId
**Linear Issue:** [ADV-195](https://linear.app/lw-claude/issue/ADV-195) — High

**Files:**
- `src/utils/concurrency.test.ts` (create or modify)
- `src/utils/concurrency.ts` (modify)

**Steps:**
1. Write test in `src/utils/concurrency.test.ts`:
   - Test the auto-expiry race: acquire lock A with `autoExpiryMs = 50`, sleep 100 ms, acquire lock B (which overwrites because A is expired), then call A's release path. Assert the map still contains B's `lockInstanceId` after A releases.
   - Test the happy path: acquire then release deletes the entry.
   - Test that `withLock` continues to release correctly after the change.
2. Run `verifier "concurrency"` (expect fail).
3. Modify `LockManager.release()` to accept the caller's `lockInstanceId`. The method only deletes the entry if the current state's `lockInstanceId` matches. Update the `withLock` wrapper to capture and pass through `lockInstanceId` returned from `acquire()` (this requires `acquire()` to return the instance ID, or `withLock` to track it via a closure).
4. Run `verifier "concurrency"` (expect pass).

**Notes:**
- Read the comment block at `concurrency.ts:81-97` — the CAS pattern is already documented for `acquire()`; `release()` should mirror it.
- Backwards-compat: if no `lockInstanceId` is passed (legacy callers), keep current behavior to avoid breaking unrelated tests; once `withLock` is updated, this becomes the only caller.

---

### Task 3: Catch unhandled rejections from queue.add() in scanner
**Linear Issue:** [ADV-196](https://linear.app/lw-claude/issue/ADV-196) — High

**Files:**
- `src/processing/scanner.test.ts` (modify)
- `src/processing/scanner.ts` (modify, around line 670)

**Steps:**
1. Write test in `src/processing/scanner.test.ts`:
   - Mock `processFileWithRetry` (or its dependency) to reject with a synthetic error for one file.
   - Run a scan with that file. Assert (a) `result.errors` is incremented, (b) an `error()` log is emitted with the filename and error message, (c) no `unhandledRejection` event fires on `process` during the scan.
2. Run `verifier "scanner"` (expect fail).
3. Modify the `for (const fileInfo of newFiles) { queue.add(...) }` loop so each `queue.add(...)` Promise has a `.catch(err => { result.errors++; logError('Queued file failed', { module: 'scanner', phase: 'queue-task', fileId: fileInfo.id, fileName: fileInfo.name, error: err.message, correlationId }); })`. Do not await per-file — `queue.onIdle()` continues to gate the loop.
4. Run `verifier "scanner"` (expect pass).

**Notes:**
- Do not change `ProcessingQueue.add()` — keeping the rethrow at the queue layer preserves error visibility for any other caller.

---

### Task 4: Single shared GeminiClient enforces RPM cap across queue
**Linear Issue:** [ADV-194](https://linear.app/lw-claude/issue/ADV-194) — High

**Files:**
- `src/gemini/client.test.ts` (create or modify)
- `src/processing/extractor.ts` (modify, around line 173)
- `src/gemini/client.ts` (modify if singleton/factory needs to be added)

**Steps:**
1. Write test in `src/gemini/client.test.ts`:
   - Create a single `GeminiClient` (or call the factory) and submit 24 concurrent `analyzeDocument` calls (mocked transport that returns immediately) with `rpmLimit = 12`. Assert that within the first 1 second (using fake timers), no more than 12 transport calls are made; the 13th onward are queued.
2. Run `verifier "gemini"` (expect fail).
3. Replace per-call `new GeminiClient(...)` in `extractor.ts:173` with a module-scoped getter (e.g., `getGeminiClient()` that lazily constructs once from `getConfig()`). The instance lives for the process lifetime and is shared across all `processFile` invocations. Ensure `usageCallback` works for any caller — pass it as an arg to `analyzeDocument` if it varies per file, or move it onto a per-call object.
4. Run `verifier "gemini"` (expect pass).

**Notes:**
- The `usageCallback` currently captures correlation context and `fileId`/`fileName`. To preserve that, pass per-call context as parameters to `analyzeDocument` (already partially the case — `fileId`, `fileName` are positional args), and have the client invoke a single static callback registered at construction.
- Keep `GEMINI_RPM_LIMIT` env var; the singleton uses the configured value.

---

### Task 5: MAX_DOCUMENT_BYTES guard before Gemini
**Linear Issue:** [ADV-193](https://linear.app/lw-claude/issue/ADV-193) — High

**Files:**
- `src/config.ts` (modify — add new env var)
- `src/processing/extractor.test.ts` (modify)
- `src/processing/extractor.ts` (modify)

**Steps:**
1. Write test in `src/processing/extractor.test.ts`:
   - Mock `downloadFile` to return a buffer larger than `MAX_DOCUMENT_BYTES` (default 25 MB; use a smaller test value via dependency injection or by reading config).
   - Assert `extractDocument` returns `{ ok: false, error }` with a message indicating size limit, BEFORE any Gemini call is invoked (assert mock not called).
   - Test the boundary: a buffer exactly at the limit succeeds.
2. Run `verifier "extractor"` (expect fail).
3. Add `MAX_DOCUMENT_BYTES` (default `25 * 1024 * 1024`) to `src/config.ts`, env-overridable via `MAX_DOCUMENT_BYTES`. Validate it's a positive integer at startup.
4. In `extractor.ts` after `downloadFile` returns, check `content.byteLength > config.maxDocumentBytes`. If exceeded, return an error that the caller (`processFile`) treats as permanent (route to Sin Procesar). Log `warn('Document exceeds size limit', { module: 'extractor', phase: 'size-check', fileId, fileName, sizeBytes: content.byteLength, limitBytes: config.maxDocumentBytes })`.
5. Run `verifier "extractor"` (expect pass).

**Notes:**
- `processFile` already routes permanent errors to Sin Procesar — return an error class that `classifyError` recognizes as permanent (or add a new `DocumentTooLargeError`).

---

### Task 6: Invisible-text detection on PDFs before Gemini
**Linear Issue:** [ADV-192](https://linear.app/lw-claude/issue/ADV-192) — High

**Files:**
- `src/processing/pdf-sanitize.ts` (create)
- `src/processing/pdf-sanitize.test.ts` (create)
- `src/processing/extractor.ts` (modify)

**Steps:**
1. Write test in `src/processing/pdf-sanitize.test.ts`:
   - `detectInvisibleText(buffer)` returns `{ hasInvisible: true, reason }` for fixtures with white-on-white text, font-size 0, or text positioned outside MediaBox.
   - Returns `{ hasInvisible: false }` for clean fixtures.
   - Returns `{ hasInvisible: false }` (skip) for non-PDF MIME types — not the function's job to validate the file type.
   - Performance: completes in <500 ms on a 10 MB PDF (use a synthetic buffer; not strict but bound).
2. Run `verifier "pdf-sanitize"` (expect fail).
3. Implement `detectInvisibleText` using a lightweight pure-JS PDF text scanner (no new heavy deps if possible — examine font/color state in the content stream). Decision: if a workable pure-JS scan is too complex, scope reduces to detecting the text-position-outside-MediaBox vector only and document the gap in the function's JSDoc.
4. Wire into `extractor.ts` BEFORE the classification call: if `detectInvisibleText(content)` returns `hasInvisible: true`, return `{ ok: false, error: new Error('Invisible text detected: <reason>') }` (treated as permanent → Sin Procesar) and log `warn('Invisible text detected, routing to Sin Procesar', { module: 'extractor', phase: 'sanitize', fileId, reason })`.
5. Run `verifier "extractor"` (expect pass).

**Notes:**
- This task may surface a research question: pure-JS detection of all three patterns is non-trivial. The acceptance bar is "covers at least one well-known vector"; ship with at least position-outside-MediaBox detection if font/color is impractical.
- Avoid pulling `pdfjs-dist` (heavyweight). Inspect alternatives like `pdf-parse` or a hand-rolled content-stream parser. Document the choice in the file header.

---

### Task 7: Daily Gemini request budget ceiling
**Linear Issue:** [ADV-197](https://linear.app/lw-claude/issue/ADV-197) — Medium

**Files:**
- `src/config.ts` (modify)
- `src/gemini/budget.ts` (create)
- `src/gemini/budget.test.ts` (create)
- `src/gemini/client.ts` (modify — wire budget check into `enforceRateLimit`)

**Steps:**
1. Write test in `src/gemini/budget.test.ts`:
   - `DailyBudget` increments per call; `consume()` returns `{ ok: true }` when under cap, `{ ok: false, error }` when over.
   - Resets at UTC midnight (use injected clock for deterministic test).
   - Threshold-warning behavior: at 80% consumption, emits one `warn` log; subsequent calls in same window do not re-warn.
2. Run `verifier "budget"` (expect fail).
3. Implement `DailyBudget` class in `src/gemini/budget.ts`. Counter resets at UTC midnight. Configured via `GEMINI_DAILY_BUDGET` env var (default unlimited, e.g., `0` means disabled).
4. Add `geminiDailyBudget` to `src/config.ts`.
5. Wire budget into `GeminiClient.analyzeDocument` BEFORE `enforceRateLimit`: if budget exhausted, return `{ ok: false, error: new GeminiError('Daily budget exhausted', 429) }` immediately (no API call). The error is classified as retryable so the file remains in Entrada for next-day retry.
6. Run `verifier "gemini"` (expect pass).

**Notes:**
- "Disabled when 0" keeps the feature opt-in; production/staging set it via Railway env vars after observing baseline usage.
- Daily counter is in-memory only — process restart resets it. Acceptable trade-off (Railway restarts daily anyway); document in CLAUDE.md.

---

### Task 8: Fail-closed credential gate independent of NODE_ENV
**Linear Issue:** [ADV-200](https://linear.app/lw-claude/issue/ADV-200) — Medium

**Files:**
- `src/config.test.ts` (modify or create)
- `src/config.ts` (modify, lines 226-240)

**Steps:**
1. Write test in `src/config.test.ts`:
   - With `NODE_ENV=staging` (or any non-test value) and `GOOGLE_SERVICE_ACCOUNT_KEY` unset, `getConfig()` throws.
   - With `NODE_ENV=test`, missing credentials are allowed (existing behavior).
   - Same for `GEMINI_API_KEY` and `DRIVE_ROOT_FOLDER_ID`.
2. Run `verifier "config"` (expect fail).
3. Replace `nodeEnv === 'production'` with `nodeEnv !== 'test'` in the three credential checks (lines 226, 232, 238). The test environment retains its bypass; everything else (development, staging, production) requires real credentials.
4. Run `verifier "config"` (expect pass).

**Notes:**
- **Migration note:** Local development workflows that previously ran without `GEMINI_API_KEY` will now fail — document `NODE_ENV=test` for offline development in DEVELOPMENT.md or use a `.env` with placeholder values.

---

### Task 9: Try/catch wrapper around watch-manager cron callbacks
**Linear Issue:** [ADV-201](https://linear.app/lw-claude/issue/ADV-201) — Medium

**Files:**
- `src/services/watch-manager.test.ts` (create or modify)
- `src/services/watch-manager.ts` (modify, lines 155-179)

**Steps:**
1. Write test in `src/services/watch-manager.test.ts`:
   - Mock the inner functions (`renewChannels`, `cleanupExpiredNotifications`, `updateStatusSheet`, `checkAndTriggerFallbackScan`) to throw on first call, succeed on second.
   - Drive cron callbacks manually (extract them as named functions or invoke via the cron's `.now()` if supported) and assert no `unhandledRejection` event fires AND an `error` log is emitted.
2. Run `verifier "watch-manager"` (expect fail).
3. Refactor each cron callback to wrap its body in `try { await ... } catch (err) { logError('Cron task failed', { module: 'watch-manager', phase: '<renewal|polling|status-update|cleanup>', error: err instanceof Error ? err.message : String(err) }); }`.
4. Run `verifier "watch-manager"` (expect pass).

**Notes:**
- Pattern: extract a tiny `runCronTask(phase, fn)` helper to keep the wrapping uniform.

---

### Task 10: Track pagada update failures separately from detalle failures
**Linear Issue:** [ADV-202](https://linear.app/lw-claude/issue/ADV-202) — Medium

**Files:**
- `src/bank/match-movimientos.test.ts` (create or modify)
- `src/bank/match-movimientos.ts` (modify, lines 1130-1175)

**Steps:**
1. Write test in `src/bank/match-movimientos.test.ts`:
   - Mock `updateDetalle` to succeed and `batchUpdate` (for pagada) to fail. Assert the returned result has a non-zero `pagadaErrors` field, the function still returns success-shape (not error), and a separate `error` log indicates the pagada partial failure.
   - Reverse: detalle fails, pagada is correctly skipped. `errors` reflects detalle failure only.
2. Run `verifier "match-movimientos"` (expect fail).
3. Add `pagadaErrors: number` to `MatchBankResult`. After the `batchUpdate` for pagada at lines 1151-1160, increment `pagadaErrors` on `!pagadaResult.ok` and log at `error()` not `warn()`. Surface `pagadaErrors` in the outer `MatchAllResult`.
4. Run `verifier "match-movimientos"` (expect pass).

**Notes:**
- The new `pagadaErrors` field is additive; `MatchAllResult` API consumers (route handlers, tests) need to acknowledge it but can default to ignoring it. No spreadsheet schema change.

---

### Task 11: Type-safe validateAdvaRole boundary
**Linear Issue:** [ADV-203](https://linear.app/lw-claude/issue/ADV-203) — Medium

**Files:**
- `src/gemini/parser.test.ts` (modify)
- `src/gemini/parser.ts` (modify, line 286)

**Steps:**
1. Write test in `src/gemini/parser.test.ts`:
   - The function accepts a discriminated union and the existing test cases continue to pass. Add a new test that verifies a missing required field produces a typed error message in `errors[]`.
2. Run `verifier "parser"` (expect fail or unchanged).
3. Replace `data: any` with `data: Partial<Factura> & Partial<Pago> & Partial<Recibo>` (or build a discriminated union keyed by `expectedRole`). Tighten field accesses; remove the `any`.
4. Run `verifier "parser"` (expect pass).

**Notes:**
- The function already takes `expectedRole` — leverage that to narrow the type by switch.

---

### Task 12: Orchestration unit tests for extractDocument and processFile
**Linear Issue:** [ADV-204](https://linear.app/lw-claude/issue/ADV-204) — Medium

**Files:**
- `src/processing/extractor.test.ts` (modify — major expansion)
- `src/processing/extractor.ts` (refactor only if testability requires it; ideally no change)

**Steps:**
1. Write tests in `src/processing/extractor.test.ts`:
   - For each `documentType` branch (factura_emitida, factura_recibida, pago_enviado, pago_recibido, recibo, resumen_bancario, resumen_tarjeta, resumen_broker, certificado_retencion, unrecognized, unknown), test that `extractDocument` calls the correct parser and returns the expected shape. Mock `GeminiClient.analyzeDocument` to return a canned response per branch.
   - Test retry-exhaustion: mock GeminiClient to reject 3 times with a transient error → assert final error is returned.
   - Test role-validation failure → returns `{ ok: false, error }` and routes to Sin Procesar (asserted by integration with `processFile`).
   - For `processFile`, test the "unrecognized" → Sin Procesar path and the "no valid date" → Sin Procesar path (already covered by hasValidDate but missing at the orchestration layer).
2. Run `verifier "extractor"` (expect fail on first run since orchestration tests are new).
3. If GeminiClient is currently constructed inline, refactor to accept it via parameter or pull from a singleton getter (overlaps with Task 4 — sequence Task 4 BEFORE Task 12 if possible).
4. Run `verifier "extractor"` (expect pass).

**Notes:**
- Sequencing: complete Task 4 (shared GeminiClient) first; this task plugs into the singleton boundary.
- This is the largest test-only task; allow more time.

---

### Task 13: Document Drive scope requirement
**Linear Issue:** [ADV-206](https://linear.app/lw-claude/issue/ADV-206) — Low

**Files:**
- `CLAUDE.md` (modify — add Drive scope rationale near the SECURITY section)
- `src/services/google-auth.ts` (modify — JSDoc on `getDefaultScopes`)

**Steps:**
1. (Docs-only — no test.)
2. Add a paragraph to CLAUDE.md SECURITY section: explain that the SA uses full `drive` scope because the app reads pre-existing folders (Entrada, yearly archives, banking subfolders); `drive.file` is not workable. Note the SA is scoped to a Workspace user that owns ONLY the ADVA folder hierarchy.
3. Update the JSDoc on `getDefaultScopes()` in `google-auth.ts` with the same rationale.
4. Run `verifier` (lint pass on docs).

**Notes:**
- No code or tests beyond ensuring no warnings.

---

### Task 14: Document GEMINI_API_KEY GCP-side restriction
**Linear Issue:** [ADV-207](https://linear.app/lw-claude/issue/ADV-207) — Low

**Files:**
- `CLAUDE.md` (modify)

**Steps:**
1. Add a section under SECURITY in CLAUDE.md: state that `GEMINI_API_KEY` MUST be restricted in the GCP console to *Generative Language API* targets only (CWE-1390 mitigation). Document the verification step ("gcloud alpha services api-keys describe <key> --project=<id> | grep targets") for runbook use.
2. Update env-var table to mark `GEMINI_API_KEY` as "must be GCP-restricted (see SECURITY)".
3. Run `verifier` (no code change).

**Notes:**
- Pure docs.

---

### Task 15: Constrain /api/scan folderId to root descendants
**Linear Issue:** [ADV-208](https://linear.app/lw-claude/issue/ADV-208) — Low

**Files:**
- `src/routes/scan.test.ts` (create or modify)
- `src/routes/scan.ts` (modify, lines 59-76)
- `src/services/drive.ts` (possibly modify — add `isDescendantOf(folderId, ancestorId)` helper)

**Steps:**
1. Write test in `src/routes/scan.test.ts`:
   - POST `/api/scan` with a `folderId` outside the configured root → 403 (or 400) with a clear error message.
   - POST with a valid descendant `folderId` → succeeds.
   - POST with no `folderId` → defaults to root (existing behavior).
2. Run `verifier "scan"` (expect fail).
3. Add `isDescendantOf(childId: string, ancestorId: string): Promise<boolean>` in `src/services/drive.ts` — uses `files.get(fileId, fields='parents')` recursively up to a max depth (e.g., 8 levels). Cache parent lookups for the request lifetime.
4. In `src/routes/scan.ts`, after `extractDriveFolderId` validates format, also call `await isDescendantOf(folderId, config.driveRootFolderId)`. If false, reply 403.
5. Run `verifier "scan"` (expect pass).

**Notes:**
- **Timeout:** the descendant check makes 1–8 Drive API calls. Each must use the existing `withRetry`/`withQuotaRetry` pattern. Total budget should be under 10 seconds; if exceeded, return 503.

---

### Task 16: Sanitize 500 error responses
**Linear Issue:** [ADV-210](https://linear.app/lw-claude/issue/ADV-210) — Low

**Files:**
- `src/routes/scan.test.ts` (modify)
- `src/routes/scan.ts` (modify all 500 handlers)
- `src/utils/error-response.ts` (create — small helper)

**Steps:**
1. Write test in `src/routes/scan.test.ts`:
   - Trigger a scan that returns `{ ok: false, error: new Error('Spreadsheet 1abc..xyz: row 5 conflict') }` (use an internal error string with file IDs / sheet names).
   - Assert HTTP 500 body is `{ error: 'Internal server error', correlationId: '...' }` (NOT the raw message).
   - Assert a server-side `error()` log has been emitted with the original error and the same correlationId — the full information stays in the logs (operator surface), only the HTTP body is generic.
2. Run `verifier "scan"` (expect fail).
3. Add `respond500(reply, err, correlationId)` helper in `src/utils/error-response.ts` that logs and returns the generic body.
4. Replace the three `return { error: result.error.message }` sites in `src/routes/scan.ts` with the helper.
5. Run `verifier "scan"` (expect pass).

**Notes:**
- This change does NOT remove information from logs — it only stops echoing internal details over HTTP. Logs retain the full error.

---

### Task 17: Fix shutdown handlers (void + timeout policy)
**Linear Issue:** [ADV-211](https://linear.app/lw-claude/issue/ADV-211), [ADV-212](https://linear.app/lw-claude/issue/ADV-212) — Low

**Files:**
- `src/server.test.ts` (modify or create)
- `src/server.ts` (modify, lines 24, 381-382)
- `CLAUDE.md` (modify — note shutdown policy)

**Steps:**
1. Write test in `src/server.test.ts`:
   - Inject a mock `shutdown` that throws. Trigger SIGTERM via `process.emit`. Assert `processExit(1)` is called and the error is logged (no unhandled rejection).
2. Run `verifier "server"` (expect fail).
3. Change handlers to `process.on('SIGTERM', () => { void shutdown('SIGTERM').catch(err => logError('Shutdown rejection', { module: 'server', error: err.message })); });`. Same for SIGINT.
4. Decide on `SHUTDOWN_TIMEOUT_MS`: keep 30 s (rely on startup recovery for in-flight files) and document this choice in CLAUDE.md under "Graceful Shutdown". Reference: stale 'processing' file recovery already handles abrupt termination.
5. Run `verifier "server"` (expect pass).

---

### Task 18: Remove unnecessary 'unknown' as any cast
**Linear Issue:** [ADV-213](https://linear.app/lw-claude/issue/ADV-213) — Low

**Files:**
- `src/processing/scanner.ts` (modify, line 85)

**Steps:**
1. Write test (or rely on existing scanner tests) — no behavior change, only type safety.
2. Run `verifier "scanner"` (baseline pass).
3. Remove the `as any` cast: change `'unknown' as any` to just `'unknown'`. Verify `markFileProcessing`'s parameter type accepts `DocumentType`, which includes `'unknown'`. If it does NOT, narrow the parameter type rather than casting.
4. Run `verifier "scanner"` (expect pass).

---

### Task 19: Replace double cast in apps-script-client with explicit construction
**Linear Issue:** [ADV-214](https://linear.app/lw-claude/issue/ADV-214) — Low

**Files:**
- `src/services/apps-script-client.ts` (modify, lines 48-63)
- `src/services/apps-script-client.test.ts` (modify or create)

**Steps:**
1. Write test in `src/services/apps-script-client.test.ts`:
   - `parseServiceAccountKey('{ "client_email": "x", "private_key": "y", "extra": 1 }')` returns an object with exactly `client_email` and `private_key` (no `extra`).
   - Throws on missing fields (existing behavior).
2. Run `verifier "apps-script-client"` (expect fail or unchanged).
3. Replace `return obj as unknown as ServiceAccountKey` with `return { client_email: obj.client_email as string, private_key: obj.private_key as string }`. The validation immediately above guarantees these are strings.
4. Run `verifier "apps-script-client"` (expect pass).

---

### Task 20: Log durationMs on Drive and Sheets API calls
**Linear Issue:** [ADV-216](https://linear.app/lw-claude/issue/ADV-216) — Low

**Files:**
- `src/services/drive.ts` (modify call sites — likely 6-10)
- `src/services/sheets.ts` (modify call sites)
- `src/services/drive.test.ts` (modify if it exists)
- `src/services/sheets.test.ts` (modify if it exists)

**Steps:**
1. Write test in the relevant service test (or add a logging assertion to existing tests):
   - For one representative Drive call (`downloadFile`) and one Sheets call (`appendRowsWithLinks`), capture log output and assert a `debug` record with `durationMs: <number>` is emitted.
2. Run `verifier "drive\|sheets"` (expect fail).
3. Add `const start = Date.now()` at the top of each public Drive/Sheets API wrapper function, log `debug('<API name>', { module: '<drive|sheets>', phase: 'api-call', durationMs: Date.now() - start, ... })` on completion (both success and error paths). Slow-call WARN at 5 seconds (consistent with Gemini's 60s threshold but lower since these calls should be fast).
4. Run `verifier "drive\|sheets"` (expect pass).

**Notes:**
- This is bulky but mechanical. Use a small helper `withTiming(name, phase, fn)` to keep boilerplate contained.

---

### Task 21: Fix CLAUDE.md spreadsheet column counts
**Linear Issue:** [ADV-217](https://linear.app/lw-claude/issue/ADV-217) — Low

**Files:**
- `CLAUDE.md` (modify SPREADSHEETS section)

**Steps:**
1. Verify against `src/constants/spreadsheet-headers.ts` and SPREADSHEET_FORMAT.md:
   - Update "API Mensual (7 cols)" → "API Mensual (8 cols)"
   - Update "Uso de API (12 cols)" → "Uso de API (15 cols)"
   - Update "Recibos (18 cols)" → "Recibos (19 cols)"
2. Add a one-line note at the top of the section: "**Note:** authoritative column counts live in `src/constants/spreadsheet-headers.ts` and `SPREADSHEET_FORMAT.md`. The summaries below are illustrative."
3. Run `verifier` (no code change, ensures build still passes).

**Notes:**
- Pure docs.

---

### Task 22: Update rate-limiter.ts JSDoc example to use Pino
**Linear Issue:** [ADV-218](https://linear.app/lw-claude/issue/ADV-218) — Low

**Files:**
- `src/utils/rate-limiter.ts` (modify, lines 47-54)

**Steps:**
1. Replace the JSDoc `@example` block: change `console.log(...)` to `warn('Rate limited', { module: 'rate-limiter', resetMs: result.resetMs })`.
2. Run `verifier` (no functional change).

**Notes:**
- One-line edit.

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review all changes for bugs across the 22 tasks.
2. Run `verifier` agent (full mode) — Verify all tests pass and zero warnings.

---

## Plan Summary

**Objective:** Address the 23 valid findings from the 2026-05-07 code audit — close the urgent rematch-lock data-corruption window, harden the Gemini surface (size cap, shared rate limiter, daily budget, invisible-text detection), fix the LockManager release race, prevent unhandled rejections in scanner and cron callbacks, and clean up smaller correctness/documentation gaps.

**Linear Issues:** ADV-191, ADV-192, ADV-193, ADV-194, ADV-195, ADV-196, ADV-197, ADV-200, ADV-201, ADV-202, ADV-203, ADV-204, ADV-206, ADV-207, ADV-208, ADV-210, ADV-211, ADV-212, ADV-213, ADV-214, ADV-216, ADV-217, ADV-218

**Approach:** TDD across 22 tasks, ordered by priority (Urgent → High → Medium → Low) with explicit dependencies noted (Task 12 depends on Task 4 for shared GeminiClient testability). Each task wraps test-first, defensive-spec, then implementation. Tasks touching shared infrastructure (LockManager, GeminiClient, watch-manager crons, config gate) ship early to reduce conflicts. Documentation-only tasks ship at the end as low-risk closers.

**Scope:** 22 tasks, ~25 source files modified, ~13 new/expanded test files. Combines ADV-211 + ADV-212 into Task 17 (shared shutdown handler context).

**Key Decisions:**
- Cancel ADV-205 (security headers) — internal Bearer-auth JSON API has no realistic browser-rendered surface.
- Cancel ADV-215 (`action:` field) — checklist disagreement; update audit checklist instead.
- Cancel ADV-198 (Apps Script secret rotation), ADV-199 (raw-response redaction), ADV-209 (prompt preview removal) — accepted-by-design patterns. Audit compliance-checklist updated with "Project-Specific Exemptions" section so future audits do not re-flag these.
- Combine ADV-211 + ADV-212 — both server-shutdown changes share the same test surface.
- Daily Gemini budget (Task 7) is in-memory only (no Redis) — Railway daily restart pattern makes per-process counter sufficient; documented.

**Risks:**
- Task 6 (invisible PDF text) has uncertain implementation cost — pure-JS detection of all three vectors (white-on-white, font-size 0, off-MediaBox) is non-trivial. Acceptance bar: at least one well-known vector handled, with the others documented as gaps.
- Task 8 (credential gate) will break local development workflows that ran without `GEMINI_API_KEY`. Document `NODE_ENV=test` bypass.
- Task 15 (folder ancestry check) adds 1–8 Drive API calls per scan request. Cache parent lookups; budget under 10s with explicit timeout.

---

## Iteration 1

**Implemented:** 2026-05-07
**Method:** Agent team (4 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1 (ADV-191): Acquire processing lock in /api/rematch path (worker-1)
- Task 2 (ADV-195): LockManager.release CAS on lockInstanceId (worker-1)
- Task 3 (ADV-196): Catch unhandled rejections from queue.add() in scanner (worker-1)
- Task 4 (ADV-194): Single shared GeminiClient enforces RPM cap (worker-2)
- Task 5 (ADV-193): MAX_DOCUMENT_BYTES guard before Gemini (worker-2)
- Task 6 (ADV-192): Invisible-text detection on PDFs (worker-2)
- Task 7 (ADV-197): Daily Gemini request budget ceiling (worker-2)
- Task 8 (ADV-200): Fail-closed credential gate independent of NODE_ENV (worker-3)
- Task 9 (ADV-201): Try/catch wrapper around watch-manager cron callbacks (worker-3)
- Task 10 (ADV-202): Track pagada update failures separately (worker-4)
- Task 11 (ADV-203): Type-safe validateAdvaRole boundary (worker-2)
- Task 12 (ADV-204): Orchestration unit tests for extractDocument and processFile (worker-2)
- Task 13 (ADV-206): Document Drive scope requirement (worker-4)
- Task 14 (ADV-207): Document GEMINI_API_KEY GCP-side restriction (worker-4)
- Task 15 (ADV-208): Constrain /api/scan folderId to root descendants (worker-3)
- Task 16 (ADV-210): Sanitize 500 error responses (worker-3)
- Task 17 (ADV-211/212): Fix shutdown handlers (void + timeout policy) (worker-3)
- Task 18 (ADV-213): Remove unnecessary 'unknown' as any cast (worker-1)
- Task 19 (ADV-214): Replace double cast in apps-script-client (worker-4)
- Task 20 (ADV-216): Log durationMs on Drive and Sheets API calls (worker-4)
- Task 21 (ADV-217): Fix CLAUDE.md spreadsheet column counts (worker-4)
- Task 22 (ADV-218): Update rate-limiter.ts JSDoc example to use Pino (worker-4)

### Files Modified
- `CLAUDE.md` — Drive scope, GEMINI_API_KEY restriction, column counts, Graceful Shutdown subsection
- `src/config.ts` — `maxDocumentBytes`, `geminiDailyBudget` config; fail-closed credential gate
- `src/config.test.ts` — credential gate tests (new)
- `src/server.ts` — `void shutdown().catch()` in SIGTERM/SIGINT handlers
- `src/server.test.ts` — shutdown handler tests
- `src/bank/match-movimientos.ts` — `pagadaErrors` field, error-level logging
- `src/bank/match-movimientos.test.ts` — pagada/detalle separation tests
- `src/gemini/budget.ts`, `budget.test.ts` (new) — `DailyBudget` class
- `src/gemini/client.ts`, `client.test.ts` — singleton factory, per-call usageCallback, budget integration
- `src/gemini/parser.ts`, `parser.test.ts` — typed `validateAdvaRole`
- `src/processing/extractor.ts`, `extractor.test.ts` — singleton, size guard, sanitize check, orchestration tests
- `src/processing/pdf-sanitize.ts`, `pdf-sanitize.test.ts` (new) — invisible-text detector
- `src/processing/scanner.ts`, `scanner.test.ts` — rematch lock, queue.add().catch(), `as any` removed
- `src/utils/concurrency.ts`, `concurrency.test.ts` — CAS release on `lockInstanceId`
- `src/utils/error-response.ts` (new) — `respond500` helper
- `src/utils/rate-limiter.ts` — JSDoc example updated to Pino
- `src/routes/scan.ts`, `scan.test.ts` — folder ancestry check, sanitized 500 responses
- `src/routes/status.test.ts` — Config mocks updated
- `src/middleware/auth.test.ts` — Config mocks updated
- `src/services/apps-script-client.ts`, `apps-script-client.test.ts` (new) — explicit `ServiceAccountKey` construction
- `src/services/drive.ts`, `drive.test.ts` — `isDescendantOf`, `withTiming` durationMs
- `src/services/google-auth.ts` — JSDoc on `getDefaultScopes`
- `src/services/sheets.ts`, `sheets.test.ts` — `withTiming` durationMs
- `src/services/watch-manager.ts`, `watch-manager.test.ts` — `runCronTask` helper, try/catch on all 4 crons

### Linear Updates
- ADV-191, ADV-192, ADV-193, ADV-194, ADV-195, ADV-196, ADV-197: Todo → In Progress → Review
- ADV-200, ADV-201, ADV-202, ADV-203, ADV-204: Todo → In Progress → Review
- ADV-206, ADV-207, ADV-208, ADV-210, ADV-211, ADV-212, ADV-213, ADV-214: Todo → In Progress → Review
- ADV-216, ADV-217, ADV-218: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 7 bugs (2 HIGH, 4 MEDIUM, 1 LOW); 5 real bugs fixed (Bug 6 not-a-regression and Bug 7 style debt skipped)
- verifier: 2092 tests pass, zero TypeScript errors, build clean (TypeScript + Apps Script bundle)

### Work Partition
- Worker 1: concurrency primitives + scanner (Tasks 1, 2, 3, 18) — 5 effort points
- Worker 2: Gemini & extractor pipeline (Tasks 4, 5, 6, 7, 11, 12) — 15 effort points
- Worker 3: API/server/config (Tasks 8, 9, 15, 16, 17) — 6 effort points
- Worker 4: services & docs (Tasks 10, 13, 14, 19, 20, 21, 22) — 4 effort points

### Merge Summary
- Worker 1: fast-forward, no conflicts (concurrency.ts, scanner.ts)
- Worker 2: merged after worker-1, no conflicts
- Worker 3: auto-merged 3 files (config.ts, scan.test.ts, server.test.ts) — Config-mock test additions integrated cleanly
- Worker 4: auto-merged 3 files (CLAUDE.md, scanner.test.ts, drive.ts) — drive.ts withTiming + isDescendantOf both preserved
- Typecheck clean after each merge
- Post-merge bug-hunter follow-ups: budget retry classification, isDescendantOf failing-open, singleton afterEach, isDescendantOf test coverage, "detaille" typo

### Continuation Status
All tasks completed.

### Review Findings

**Method:** 3-reviewer agent team (security, reliability, quality) — Sonnet, parallel.

**Summary:** 9 findings raised across 36 changed files. 5 classified as FIX (creating Fix Plan), 4 DISCARDED with documented reasoning.

#### FIX (5 — all S-size, but count > 3 → Fix Plan path)

| # | Severity | Category | File | Finding | New Issue |
|---|---|---|---|---|---|
| 1 | medium | timeout | `src/services/drive.ts:955-993` | `isDescendantOf` has no overall timeout — worst-case 8 × 5 × 65s = 43min holding scan handler open. Plan said "under 10s; 503 on exceed" — never implemented. | [ADV-219](https://linear.app/lw-claude/issue/ADV-219) |
| 2 | medium | edge-case | `src/services/drive.ts:991-993` | Depth-exhaustion path silently returns `value: false` with no log; user gets confusing 403 indistinguishable from genuine unauthorised folder. | [ADV-220](https://linear.app/lw-claude/issue/ADV-220) |
| 3 | low | bug | `src/processing/scanner.ts:683-694` | `queue.add().catch()` logs but does NOT increment `result.errors++`. Plan explicitly required the increment. | [ADV-221](https://linear.app/lw-claude/issue/ADV-221) |
| 4 | medium | test | `src/gemini/client.test.ts` (4 describe blocks) | Inline `vi.useFakeTimers()` without `afterEach` guard — failing assertion can leak fake timers to subsequent tests. | [ADV-222](https://linear.app/lw-claude/issue/ADV-222) |
| 5 | low | test | `src/gemini/client.test.ts:1317-1337` | `truncates oversized error responses` test only asserts `result.ok === false`; would pass even if truncation logic was broken. | [ADV-223](https://linear.app/lw-claude/issue/ADV-223) |

#### DISCARDED (4)

| Severity | Category | File | Finding | Reasoning |
|---|---|---|---|---|
| medium | security | `src/processing/pdf-sanitize.ts` | FlateDecode-compressed content streams bypass invisible-text detection. | **Accepted scope reduction.** PLANS.md Task 6 acceptance bar was "covers at least one well-known vector"; implementation delivered three (font-size 0, off-MediaBox, white-on-white) plus documented the compression gap in the file's JSDoc (lines 13-22). Adding zlib decompression is out of scope for this iteration; track separately if escalated. |
| low | test | `src/utils/concurrency.test.ts` | No `clearAllLocks()` in afterEach. | Reviewer admits "since every test uses a distinct resource ID the cross-test impact is minimal in practice" — defensive hygiene only, no current bug. |
| low | type | `src/bank/match-movimientos.test.ts` (40+ sites) | `vi.mocked(getCachedFolderStructure).mockReturnValue(mockFolderStructure as any)` pattern. | Style preference, not a correctness issue. The cast pattern is intentional and consistent for partial mocks. Refactoring 40+ sites to a typed factory would be M-size for zero current correctness impact. |
| low | type | `src/processing/scanner.test.ts:158-164` | Six mock variables typed as `: any`. | Same as above — style preference for test mocks, no correctness impact. |

#### Verified ADV Fixes (no findings)

- ADV-191 (rematch withLock), ADV-195 (LockManager CAS release), ADV-194 (singleton GeminiClient), ADV-193 (MAX_DOCUMENT_BYTES guard), ADV-197 (DailyBudget), ADV-200 (fail-closed credentials), ADV-201 (cron try/catch), ADV-202 (pagadaErrors), ADV-203 (validateAdvaRole typed), ADV-211/212 (void+catch shutdown), ADV-213 (`'unknown' as any` removed), ADV-214 (apps-script-client double-cast removed), ADV-216 (durationMs logging) — all confirmed correct by reviewers.

### Linear Updates

- All 23 original issues: Review → Merge (ADV-191, 192, 193, 194, 195, 196, 197, 200, 201, 202, 203, 204, 206, 207, 208, 210, 211, 212, 213, 214, 216, 217, 218)
- 5 new Fix-Plan issues created in Todo: ADV-219, ADV-220, ADV-221, ADV-222, ADV-223

<!-- REVIEW COMPLETE -->

---

## Fix Plan

5 follow-up tasks for the issues found in Iteration 1 review. All S-size; combined under one Fix Plan because count > 3 inline-fix threshold.

### Fix 1: Add overall 10s deadline to isDescendantOf
**Linear Issue:** [ADV-219](https://linear.app/lw-claude/issue/ADV-219) — Medium

**Files:**
- `src/services/drive.ts` (modify `isDescendantOf`)
- `src/services/drive.test.ts` (modify)
- `src/routes/scan.ts` (verify caller maps deadline-error to 503)

**Steps:**
1. Write test in `src/services/drive.test.ts`:
   - Mock `getParents` to return a never-resolving promise. Call `isDescendantOf(...)`. Assert it resolves with `{ ok: false, error }` within ~10.5 s (allow buffer over 10 s deadline).
   - Existing happy-path tests must continue to pass.
2. Run `verifier "drive"` (expect fail on the new test).
3. Wrap the body of `isDescendantOf` in a `Promise.race` against a 10 s timeout that resolves with `{ ok: false, error: new Error('isDescendantOf deadline exceeded') }`. Use `setTimeout` (cleared on success path).
4. In `src/routes/scan.ts`, verify the existing branch where `isDescendantOf` returns `ok: false` already returns 503 (or 500). Add a 503 mapping if it currently returns 500.
5. Run `verifier "drive\|scan"` (expect pass).

**Notes:**
- The 10 s budget is from PLANS.md Task 15 acceptance criteria.
- Do NOT use AbortController — `withQuotaRetry` does not currently support cancellation, and we want a clean drop-out without a deeper refactor.

---

### Fix 2: Log warn on isDescendantOf depth exhaustion
**Linear Issue:** [ADV-220](https://linear.app/lw-claude/issue/ADV-220) — Low

**Files:**
- `src/services/drive.ts` (modify, line 991-993)
- `src/services/drive.test.ts` (modify)

**Steps:**
1. Write test in `src/services/drive.test.ts`:
   - Mock `getParents` to return distinct parent IDs that never include the ancestor (force depth exhaustion). Run `isDescendantOf` and assert a `warn` log was emitted with `{ module: 'drive', phase: 'descendant-check', folderId, ancestorId, depth: 8 }` AND the result is `{ ok: true, value: false }`.
2. Run `verifier "drive"` (expect fail).
3. Before the final `return { ok: true, value: false }` at line 992, add `warn('Descendant check exhausted depth limit', { module: 'drive', phase: 'descendant-check', folderId, ancestorId, depth: MAX_ANCESTOR_DEPTH });`.
4. Run `verifier "drive"` (expect pass).

**Notes:**
- Keep the return shape unchanged for now — discussion on whether to switch to `ok: false` is deferred (noted in issue).

---

### Fix 3: Increment result.errors in queue.add() catch
**Linear Issue:** [ADV-221](https://linear.app/lw-claude/issue/ADV-221) — Low

**Files:**
- `src/processing/scanner.ts` (modify, line 683-694)
- `src/processing/scanner.test.ts` (modify)

**Steps:**
1. Write test in `src/processing/scanner.test.ts`:
   - Mock `withCorrelationAsync` (or whatever lives at the queue-task boundary) to throw on first call. Run a scan. Assert `result.errors` is incremented by 1.
   - The existing test that exercises the `processFileWithRetry` error path stays as-is (it already asserts errors++ via the inner path).
2. Run `verifier "scanner"` (expect fail).
3. In the `.catch()` handler at scanner.ts:683, add `result.errors++;` as the first line of the handler body, before the `logError(...)` call.
4. Run `verifier "scanner"` (expect pass).

---

### Fix 4: Add afterEach timer cleanup to gemini client.test.ts describe blocks
**Linear Issue:** [ADV-222](https://linear.app/lw-claude/issue/ADV-222) — Low

**Files:**
- `src/gemini/client.test.ts` (modify)

**Steps:**
1. Test for this fix is the existing test suite — the requirement is that timer cleanup is structurally enforced. No new assertion needed.
2. In each affected describe block (`analyzeDocument` ~line 221, `rate limiting` ~line 548, `rate limit queue robustness` ~line 1226, `singleton factory` ~line 1397), add `afterEach(() => vi.useRealTimers());` immediately after the existing `beforeEach` (or as the first `afterEach` if none exists). Optionally remove the per-test inline `vi.useRealTimers()` calls now that the cleanup is automatic.
3. Run `verifier "gemini"` (expect pass — all 2092 tests still passing).

**Notes:**
- Match the pattern already used by the `retry logic` describe block in the same file.

---

### Fix 5: Verify truncation-test assertion matches what the test claims
**Linear Issue:** [ADV-223](https://linear.app/lw-claude/issue/ADV-223) — Low

**Files:**
- `src/gemini/client.test.ts` (modify, lines 1317-1337)

**Steps:**
1. Modify the existing test `'truncates oversized error responses'`:
   - Add a `warnSpy` (`vi.spyOn(loggerModule, 'warn')`) before the call.
   - After the call, assert `warnSpy` was called with a message indicating the response was truncated AND with a structured payload showing the size cap.
   - If the source code captures the truncated body length somewhere observable (callback, log payload), assert it ≤ `MAX_RESPONSE_SIZE`.
2. Run `verifier "gemini"` (expect pass — the truncation code already works; this just makes the test verify it).

**Notes:**
- Reference: `warnSpy` pattern is already used elsewhere in the same file — copy the shape.
- If the test exposes a code path where the truncation is unobservable, the fix is to add an observable hook (e.g., the warn log payload should include the original size and the truncated size).

---

## Post-Fix-Plan Checklist

1. Run `bug-hunter` agent — Review fixes for new bugs.
2. Run `verifier` agent (full mode) — All tests pass, zero warnings.

---

## Iteration 2

**Implemented:** 2026-05-07
**Method:** Single-agent (5 S-size fixes across 3 independent units, effort score 5 — below worker threshold)

### Tasks Completed This Iteration

- Fix 1 (ADV-219): isDescendantOf 10s overall deadline via Promise.race; scan route returns 503 on ancestry-check failure (downstream service issue)
- Fix 2 (ADV-220): warn log on depth-exhaustion path with `folderId`, `currentId` (deepest reached), `ancestorId`, `depthLimit`
- Fix 3 (ADV-221): `result.errors++` added to scanner's `queue.add().catch()` defensive handler
- Fix 4 (ADV-222): `afterEach(() => vi.useRealTimers())` added to four describe blocks in client.test.ts (`analyzeDocument`, `rate limiting`, `rate limit queue robustness`, `singleton factory`)
- Fix 5 (ADV-223): `'truncates oversized error responses'` test now spies on warn and asserts payload (module, phase, originalSize, status, maxSize) with `maxSize < originalSize`

### Files Modified

- `src/services/drive.ts` — Promise.race deadline (`ISDESCENDANT_DEADLINE_MS = 10_000`), depth-exhaustion warn log
- `src/services/drive.test.ts` — new tests for ADV-219 (timeout) and ADV-220 (warn payload)
- `src/utils/error-response.ts` — added `respond503` helper, factored shared `respondError` internal, kept `respond500` and `Error500Response` as thin alias for backward compat
- `src/routes/scan.ts` — switched ancestry-check failure response from `respond500` to `respond503`
- `src/routes/scan.test.ts` — updated existing test from 500/'Internal server error' to 503/'Service unavailable' + correlationId regex
- `src/processing/scanner.ts` — `result.errors++` in `queue.add().catch()` before logging
- `src/processing/scanner.test.ts` — new test asserts `result.errors === 2` when both queue.add() promises reject
- `src/gemini/client.test.ts` — `afterEach` timer cleanup in 4 describe blocks; strengthened truncation test with `warnSpy` and payload assertion

### Linear Updates

- ADV-219, ADV-220, ADV-221, ADV-222, ADV-223: Todo → In Progress → Review

### Pre-commit Verification

- bug-hunter: Found 2 LOW findings — Bug 1 (missing `currentId` in depth-exhaustion warn payload) fixed; Bug 2 (timeout test settlement reliability) skipped, bug-hunter explicitly classified it as "false positive candidate" since the test passes and `traverse()` always resolves rather than rejects.
- verifier (full mode): 2095 tests pass, TypeScript compile clean, build clean (zero warnings), Apps Script bundle clean.

### Continuation Status

All Fix Plan tasks completed. No pending work.

<!-- FIX PLAN COMPLETE -->

### Review Findings

Summary: 1 consolidated issue found (Team: security, reliability, quality reviewers)
- FIX: 1 issue (M-size, multi-file → Fix Plan path) — Linear issue created
- DISCARDED: 0

**Method:** 3-reviewer agent team (security, reliability, quality) — Sonnet, parallel. 8 changed files reviewed.

**Issues requiring fix:**

- [MEDIUM] ASYNC: `isDescendantOf` deadline does not cancel in-flight `traverse()` (`src/services/drive.ts:1018-1032`) — abandoned coroutine continues calling `getParents` → `withQuotaRetry`, which (a) wastes Drive quota, (b) mutates the **module-singleton** `quotaThrottle` via `reportQuotaError()` and inflates global Drive backoff, (c) leaks `setTimeout` retry handles up to ~325s and can prevent graceful shutdown within the 30s `SHUTDOWN_TIMEOUT_MS`. Three findings (1 medium reliability, 1 low reliability, 1 low security) consolidated into one Fix because they share a single root cause.

**Verified ADV fixes (no findings):**

- ADV-219 (10s deadline via Promise.race + `clearTimeout` in finally) — correct ✓
- ADV-220 (depth-exhaustion warn payload `module/phase/folderId/currentId/ancestorId/depthLimit`) — correct ✓
- ADV-221 (`result.errors++` placed before `logError` in `queue.add().catch()`, test exercises `getProcessingQueue` mock to reject twice → assert `result.errors === 2`) — correct ✓
- ADV-222 (`afterEach(() => vi.useRealTimers())` added to `analyzeDocument`, `rate limiting`, `rate limit queue robustness`, `singleton factory` describe blocks) — correct ✓
- ADV-223 (warnSpy captures truncation log, asserts `module/phase/originalSize/status/maxSize` payload + `maxSize < originalSize`) — correct ✓
- error-response.ts refactor (`respondError` internal, `respond500`/`respond503`, backward-compatible `Error500Response` alias) — correct ✓
- 503 wiring in scan.ts ancestry-check failure path — correct ✓

### Linear Updates

- ADV-219, ADV-220, ADV-221, ADV-222, ADV-223: Review → Merge (all Iteration 2 originals completed)
- ADV-224: Created in Todo (Fix: cancel in-flight `traverse()` on `isDescendantOf` deadline)

<!-- REVIEW COMPLETE -->

---

## Fix Plan 2

**Source:** Iteration 2 review findings
**Linear Issues:** [ADV-224](https://linear.app/lw-claude/issue/ADV-224)

### Fix 1: Cancel in-flight traverse() when isDescendantOf deadline fires
**Linear Issue:** [ADV-224](https://linear.app/lw-claude/issue/ADV-224) — Medium

**Files:**
- `src/utils/concurrency.ts` (modify `withQuotaRetry`)
- `src/utils/concurrency.test.ts` (modify)
- `src/services/drive.ts` (modify `getParents`, `isDescendantOf`)
- `src/services/drive.test.ts` (modify)

**Steps:**

1. Write tests in `src/utils/concurrency.test.ts`:
   - **Test A (early abort):** Call `withQuotaRetry(fn, ..., signal)` with an `AbortController` whose signal is aborted before invocation. Assert `fn` is never called and the result is `{ ok: false, error: ... aborted }`. Spy on `quotaThrottle.reportQuotaError` and assert it is NOT called.
   - **Test B (mid-retry abort):** Mock `fn` to throw a quota error on first attempt. Schedule `controller.abort()` during the retry-backoff `setTimeout`. Assert (1) the function returns the abort error, (2) the retry-backoff `setTimeout` does NOT keep the test process alive (use `vi.runOnlyPendingTimers()` cleanup check or assert `setTimeout.mock.calls`/`clearTimeout` symmetry).
   - **Test C (no signal — backwards compat):** Existing tests without signal continue to pass.
2. Run `verifier "concurrency"` (expect fail on new tests).
3. Modify `withQuotaRetry(fn, standardConfig?, quotaConfig?, signal?)`:
   - Accept optional `signal: AbortSignal`.
   - At the top of each loop iteration (before `throttle.waitForClearance()`): if `signal?.aborted`, return `{ ok: false, error: new Error('Aborted: ' + (signal.reason ?? 'unknown')) }` immediately. Do NOT call `reportQuotaError`.
   - Wrap the retry-backoff `setTimeout` in an abortable promise: `await new Promise((resolve) => { const t = setTimeout(resolve, delay); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(undefined); }, { once: true }); })`. After the delay, re-check `signal?.aborted` and exit if true.
4. Write tests in `src/services/drive.test.ts`:
   - Add a test for `isDescendantOf` deadline that asserts the AbortSignal is propagated: mock `getParents` to capture and store the signal, fire the 10s deadline, assert `signal.aborted === true` after the deadline.
   - Existing happy-path and timeout tests continue to pass.
5. Modify `src/services/drive.ts`:
   - `getParents(fileId: string, signal?: AbortSignal): Promise<Result<string[], Error>>` — pass `signal` to `withQuotaRetry`.
   - `isDescendantOf`: create `const controller = new AbortController()`. Call `controller.abort(...)` inside the timeout-promise's `setTimeout` callback BEFORE `resolve(...)`. Pass `controller.signal` to every `getParents(currentId, controller.signal)` call inside `traverse()`. Add `controller.abort('completed')` in the success branch (after `Promise.race` resolves with `traverse()` value) so an already-completed traverse cleanly closes the abort listener — also fine if abort fires after completion (no-op).
6. Run `verifier "concurrency\|drive"` (expect pass).

**Notes:**
- The signal does NOT need to interrupt an in-flight `drive.files.get`. gaxios accepts `signal` natively (forward via `request.signal` if you want; out of scope for this fix). The win is that abandoned `withQuotaRetry` exits cleanly between retry attempts and never inflates the global throttle.
- Backwards-compatible: every existing `withQuotaRetry`/`getParents` call site keeps working without changes (signal is optional).
- All other `withQuotaRetry` callers in `drive.ts`/`sheets.ts` continue to operate without the signal; they are not part of this fix.

---

## Post-Fix-Plan-2 Checklist

1. Run `bug-hunter` agent — Review fixes for new bugs.
2. Run `verifier` agent (full mode) — All tests pass, zero warnings.

---

## Iteration 3

**Implemented:** 2026-05-07
**Method:** Single-agent (1 fix, multi-file AbortSignal threading — effort score 4)

### Tasks Completed This Iteration

- Fix 1 (ADV-224): AbortSignal threading through `withQuotaRetry` → `getParents` → `isDescendantOf` so the 10s deadline cancels the abandoned `traverse()` cleanly. Eliminates the three downstream effects flagged in Iteration 2 review (wasted Drive quota, global throttle inflation, leaked retry timers delaying graceful shutdown).

### Files Modified

- `src/utils/concurrency.ts` — `withQuotaRetry(fn, standardConfig?, quotaConfig?, signal?)`: signal-check at top of each retry attempt, skip `quotaThrottle.reportQuotaError()` if pre-aborted, abortable retry-backoff `setTimeout` with explicit `removeEventListener` on natural completion (avoids listener accumulation if signal outlives the call).
- `src/utils/concurrency.test.ts` — new describe block "withQuotaRetry abort signal (ADV-224)" with 4 tests: (a) pre-aborted signal returns aborted error and `fn` never called, (b) pre-aborted signal does not inflate `quotaThrottle`, (c) mid-retry abort exits without further attempts, (d) backwards-compatible without signal.
- `src/services/drive.ts` — `getParents(fileId, signal?)` forwards signal to `withQuotaRetry`. `isDescendantOf` creates an `AbortController`; the deadline timeout calls `controller.abort('isDescendantOf deadline exceeded')` BEFORE `resolve(...)` so the abandoned `traverse()` sees `signal.aborted` at its next checkpoint.
- `src/services/drive.test.ts` — `withQuotaRetry` mock now honours `signal`; new test "aborts the AbortSignal passed to withQuotaRetry when deadline fires (ADV-224)" captures the signal arriving at the mocked withQuotaRetry, advances past the 10s deadline, asserts the captured signal is aborted.

### Linear Updates

- ADV-224: Todo → In Progress → Review → Merge

### Pre-commit Verification

- bug-hunter (round 1): 3 S-size findings (1 medium comment-accuracy, 2 low: listener accumulation hygiene, redundant config pass). All 3 fixed inline.
- bug-hunter (round 2): no new findings — all three follow-ups verified resolving the previous findings without introducing regressions; ordering of `controller.abort()` before `resolve()` confirmed correct.
- verifier (full mode): 2100 tests pass, TypeScript compile clean (`tsc --noEmit`), build clean (zero warnings), Apps Script bundle clean.

### Continuation Status

All Fix Plan 2 tasks completed. No pending work.

<!-- FIX PLAN 2 COMPLETE -->

---

## Status: COMPLETE

All 24 Linear issues from the 2026-05-07 audit (ADV-191..218 in Iteration 1, ADV-219..223 fix-plan items in Iteration 2, ADV-224 fix-plan item in Iteration 3) implemented and reviewed successfully. All issues moved to Merge. PR pending.
