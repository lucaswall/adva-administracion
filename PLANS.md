# Implementation Plan

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
