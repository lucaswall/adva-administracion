# Implementation Plan

**Status:** IN_PROGRESS
**Created:** 2026-06-11
**Source:** Backlog: ADV-284, ADV-285, ADV-286, ADV-287, ADV-288, ADV-289, ADV-290, ADV-291, ADV-294, ADV-296, ADV-297, ADV-298, ADV-299, ADV-300, ADV-301, ADV-302, ADV-303, ADV-304, ADV-305, ADV-306, ADV-307, ADV-308, ADV-309, ADV-310, ADV-311, ADV-312, ADV-313, ADV-314, ADV-315, ADV-316, ADV-317, ADV-318, ADV-319, ADV-320, ADV-321, ADV-322, ADV-323, ADV-324, ADV-326, ADV-327, ADV-328, ADV-329, ADV-330, ADV-331, ADV-332, ADV-333, ADV-334, ADV-335, ADV-336, ADV-337, ADV-338, ADV-339, ADV-340, ADV-341, ADV-342, ADV-343, ADV-344, ADV-345, ADV-346, ADV-347, ADV-348, ADV-349, ADV-350, ADV-351, ADV-352, ADV-353, ADV-354, ADV-355, ADV-356, ADV-357
**Linear Issues:** 70 issues — links are in each task below
**Branch:** fix/backlog-sweep-2026-06

## Context Gathered

### Codebase Analysis

- **Related files:** spans the full server — `src/processing/` (scanner, extractor, storage stores, matching), `src/bank/` (matcher, match-movimientos), `src/gemini/` (parser, prompts), `src/services/` (sheets, drive, watch-manager, subdiario-writer/builder/diff, facturador-reader, pagos-pendientes, movimientos-detalle, folder-structure, delivery-package, google-auth, document-sorter), `src/utils/` (concurrency, numbers, date, validation, file-naming), `src/routes/`, `src/config.ts`, `apps-script/build.js`.
- **Existing patterns:** `Result<T,E>` for fallible ops; Pino structured logging; per-sheet append lock `sheet-append:${spreadsheetId}:${sheetName}` with 60 s wait / 900 s expiry (ADV-242 rationale); `withQuotaRetry` for Sheets quota backoff; header-driven row parsing in `src/bank/match-movimientos.ts:288-315` (the model for ADV-332); `tierToConfidence` in `src/bank/matcher.ts`; `normalizeSpreadsheetDate` for date cells; `CellDate`/`CellNumber` for typed cells.
- **Test conventions:** Vitest, colocated `*.test.ts`; fake CUITs `20123456786`, `27234567891`, `20111111119` only (plus ADVA `30709076783`); fictional names "TEST SA", "EMPRESA UNO SA", "Juan Perez"; new top-level `describe` blocks using real timers must call `quotaThrottle.reset()` in `beforeEach` (CLAUDE.md test-hygiene note).

### MCP Context

- **MCPs used:** Linear (issue descriptions, statuses; team "ADVA Administracion"); codebase verified directly by 8 parallel triage agents reading every cited file.
- **Findings:** All 74 Backlog issues fetched and verified against current code. `npm audit` re-run confirmed ADV-285's advisories are still open with `fixAvailable: true`. ADV-322/ADV-325 are byte-identical audit duplicates. Recent commits (2ebf502, 8e75b47) already handle NC E/ND E in `utils/validation.ts` — parser-boundary tasks must not regress that.

### Triage Results

**Planned (70):** ADV-284, ADV-285, ADV-286, ADV-287, ADV-288, ADV-289, ADV-290, ADV-291, ADV-294, ADV-296, ADV-297, ADV-298, ADV-299, ADV-300, ADV-301, ADV-302, ADV-303, ADV-304, ADV-305, ADV-306, ADV-307, ADV-308, ADV-309, ADV-310, ADV-311, ADV-312, ADV-313, ADV-314, ADV-315, ADV-316, ADV-317, ADV-318, ADV-319, ADV-320, ADV-321, ADV-322, ADV-323, ADV-324, ADV-326, ADV-327, ADV-328, ADV-329, ADV-330, ADV-331, ADV-332, ADV-333, ADV-334, ADV-335, ADV-336, ADV-337, ADV-338, ADV-339, ADV-340, ADV-341, ADV-342, ADV-343, ADV-344, ADV-345, ADV-346, ADV-347, ADV-348, ADV-349, ADV-350, ADV-351, ADV-352, ADV-353, ADV-354, ADV-355, ADV-356, ADV-357

**Canceled (3):**
- ADV-292 (No HTTP security headers) — only client is the co-deployed Apps Script via UrlFetchApp; no browser renders these JSON responses, so nosniff/X-Frame-Options/CSP/HSTS are inert. Theoretical hardening for this deployment.
- ADV-293 (GEMINI_DAILY_BUDGET defaults to 0) — enforcement exists and is deliberately opt-in (`src/gemini/budget.ts`); consumption already bounded by size guard, bounded retries, RPM limiter, queue concurrency, operator-controlled input folder. A non-zero default would block legitimate backfills.
- ADV-295 (caches without eviction) — growth is practically bounded (one ~100-byte entry per unique document date; file-row-index corrected on next boot per the issue's own text). No operational risk.

**Duplicate (1):**
- ADV-325 → duplicate of ADV-322 (byte-identical description, created one minute later in the same audit run).

### Scope Boundaries

**Out of scope:** ADV-292, ADV-293, ADV-295 (canceled, reasons above); repairing historical data corruption already present in production sheets (orphaned `pagada='SI'`, wiped match columns, drifted Subdiario formulas) — these are data-ops follow-ups noted per task, not code migrations.

---

## Tasks

Phases group tasks that touch the same files; within a phase, tasks MUST run in the listed order. Phases are independent of each other except where a task's Notes say otherwise.

### Phase A — Locks & concurrency

### Task 1: Decouple PROCESSING_LOCK auto-expiry from waiter timeout (ADV-302)
**Linear Issue:** [ADV-302](https://linear.app/lw-claude/issue/ADV-302/processing-lock-5-min-auto-expiry-is-below-realistic-scanmatch)
**Files:**
- `src/config.ts` (modify)
- `src/processing/scanner.ts` (modify)
- `src/bank/match-movimientos.ts` (modify)
- `src/routes/subdiario.ts` (modify)
- `src/processing/scanner.test.ts`, `src/routes/subdiario.test.ts`, `src/utils/concurrency.test.ts` (modify)

**Steps:**
1. Write tests: a lock holder still running past 5 minutes is NOT displaced by a waiter (waiter times out with `ok:false` instead of force-acquiring); force-acquire still works for a holder older than the new expiry (crash recovery); existing constant assertions in subdiario.test.ts updated to the new expiry constant.
2. Run verifier (expect fail)
3. Add a new constant (e.g. `PROCESSING_LOCK_EXPIRY_MS` ≥ 900 000) in `src/config.ts`, keep waiter wait at 5 min (`PROCESSING_LOCK_TIMEOUT_MS`), and pass wait + expiry separately at all four call sites (`scanner.ts:821`, `match-movimientos.ts:1370`, `subdiario.ts:86`, and the rematch path). Document in config.ts comments that waiter timeout must be strictly less than expiry, and that expiry exists only to recover a crashed holder (ADV-242 rationale).
4. Run verifier (expect pass)

**Notes:**
- Mirrors the existing `sheet-append` lock design in `src/services/sheets.ts:1127-1143`.
- Concurrency guard semantics unchanged: scan/match/subdiario remain mutually exclusive; only the expiry rises.

### Task 2: Align subdiario sync outer-lock budget with its inner Comprobantes lock (ADV-351)
**Linear Issue:** [ADV-351](https://linear.app/lw-claude/issue/ADV-351/subdiario-sync-runs-under-the-5-minute-processing-lock-while-its-own)
**Files:**
- `src/routes/subdiario.ts` (modify)
- `src/bank/match-movimientos.ts` (modify)
- `src/services/subdiario-writer.ts` (comment only)
- `src/routes/subdiario.test.ts`, `src/bank/match-movimientos.test.ts` (modify)

**Steps:**
1. Write test asserting the expiry passed by `matchAllMovimientos` and the subdiario route is ≥ the writer's inner Comprobantes lock budget (900 000 ms); error path: a second scan request during a long-running sync is rejected/deferred, not force-acquired.
2. Run verifier (expect fail)
3. Ensure both call sites use the Task 1 expiry constant (≥ the inner 900 s budget); update the writer's lock-budget comment to reference the outer constant so they cannot silently drift.
4. Run verifier (expect pass)

**Notes:**
- Depends on Task 1 (same constant). Largely verification + comment alignment once Task 1 lands; keep as its own issue for audit trail.

### Task 3: Raise business-key store lock auto-expiry above quota-retry worst case (ADV-344)
**Linear Issue:** [ADV-344](https://linear.app/lw-claude/issue/ADV-344/business-key-store-locks-use-the-default-30s-auto-expiry-while-their)
**Files:**
- `src/config.ts` (modify)
- `src/processing/storage/factura-store.ts`, `pago-store.ts`, `recibo-store.ts`, `retencion-store.ts`, `resumen-store.ts`, `index.ts` (modify)
- colocated `*.test.ts` for each store (modify)

**Steps:**
1. Write tests: each store function invokes `withLock` with the new auto-expiry constant (spy on withLock args); with a lock held by a slow body past 30 s (fake timers), a second same-key store does NOT force-acquire and instead fails its 10 s wait — no double append.
2. Run verifier (expect fail)
3. Add `STORE_LOCK_AUTO_EXPIRY_MS` to `src/config.ts` sized to cover worst-case `withQuotaRetry` chains (align with the 900 s sheet-append rationale); pass it as the 4th `withLock` argument at all business-key store call sites and the file-status locks in `storage/index.ts`. Keep the short wait timeouts. Comment why expiry must exceed the append quota-retry worst case.
4. Run verifier (expect pass)

**Notes:**
- Tests touching quota-retry paths with real timers must call `quotaThrottle.reset()` in `beforeEach` (CLAUDE.md test-hygiene note).
- Sequence within Phase A after Task 1 (both edit `src/config.ts`).

### Phase B — Scanner, recovery & watch channels

### Task 4: Decode processedAt DATE_TIME serials in spreadsheet timezone (ADV-306)
**Linear Issue:** [ADV-306](https://linear.app/lw-claude/issue/ADV-306/timezone-shifted-date-time-serials-read-back-as-utc-processedat-age)
**Files:**
- `src/processing/storage/index.ts` (modify)
- `src/services/migrations.ts` (modify)
- `src/processing/storage/index.test.ts` (or storage tests), `src/services/migrations.test.ts` (modify)

**Steps:**
1. Write tests: a row marked 'processing' 1 minute ago with an America/Argentina/Buenos_Aires serial is NOT stale; a row genuinely >5 min old IS stale; running the migration twice over the same serial leaves the stored instant unchanged (idempotency); legacy string-ISO `processedAt` still works.
2. Run verifier (expect fail)
3. Implement a shared serial-decode helper (inverse of `dateToSerialInTimezone` in `src/services/sheets.ts:1083-1099`) that decodes numeric serials in the spreadsheet's timezone (fetch via `getSpreadsheetTimezone`; fall back to UTC only if the timezone fetch fails, logging a warn). Use it in `getStaleProcessingFileIds` (`storage/index.ts:352-355`) and `migrateDashboardProcessedAt` (`migrations.ts:290-292`).
4. Run verifier (expect pass)

**Notes:**
- **Migration note:** existing `processedAt` values have drifted ~3 h per past startup, but only transient 'processing' rows feed the stale guard — no data migration; the fix makes the startup migration truly idempotent going forward.
- CLAUDE.md's "processedAt stored as plain text" note is outdated — update CLAUDE.md in this task.
- Must land BEFORE Task 5 (the stale gate must be correct before it becomes live).

### Task 5: Make stale/failed recovery gates actually filter the scan queue (ADV-311)
**Linear Issue:** [ADV-311](https://linear.app/lw-claude/issue/ADV-311/stale-processing-threshold-and-max-failed-file-retries-cap-are)
**Files:**
- `src/processing/scanner.ts` (modify)
- `src/processing/storage/index.ts` (modify if status-set accessor needed)
- `src/processing/scanner.test.ts` (modify)

**Steps:**
1. Write tests: file with 'processing' status 1 minute old in Entrada is NOT queued; same file >5 min old IS queued; file with `failed(3): Quota exceeded` is NOT queued (cap reached) while `failed(1): Quota exceeded` IS; file with a non-transient `failed:` message is NOT queued; brand-new file still queued; stuck-success recovery behavior unchanged.
2. Run verifier (expect fail)
3. Change the `newFiles` filter (`scanner.ts:593`) to exclude files with any tracking-sheet entry whose status is 'processing' or 'failed'; those re-enter only via `getStaleProcessingFileIds` (age > threshold) and `getRetryableFailedFileIds` (transient pattern + retry cap) respectively.
4. Run verifier (expect pass)

**Notes:**
- Depends on Task 4 (stale-age math). Restores the documented startup-recovery behavior in CLAUDE.md PROCESSING & RETRY BEHAVIOR.

### Task 6: Fail duplicate detection closed when a cache preload fails (ADV-297)
**Linear Issue:** [ADV-297](https://linear.app/lw-claude/issue/ADV-297/failed-duplicate-cache-sheet-preload-silently-disables-duplicate)
**Files:**
- `src/processing/caches/duplicate-cache.ts` (modify)
- `src/processing/storage/factura-store.ts`, `pago-store.ts`, `recibo-store.ts`, `retencion-store.ts` (modify)
- `duplicate-cache.test.ts` + the four store test files (modify)

**Steps:**
1. Write tests: when preload fails (`getValues` returns `ok:false`), a known duplicate factura is still detected via the API fallback and not appended; failed preload emits a warn/error log with sheet name; a legitimately empty sheet still returns not-duplicate without API fallback; cache-hit path unchanged when preload succeeds.
2. Run verifier (expect fail)
3. Implement: `doLoadSheet` logs on failure and records the key in a failed-loads set (distinct from empty-but-loaded); `isDuplicate*` (or a new `isLoaded(key)` accessor) reports "unknown" for failed-load sheets; stores fall back to their existing direct-API duplicate checks when the cache reports a failed load; `addEntry` on a failed-load sheet must not flip it to a false "loaded" state.
4. Run verifier (expect pass)

**Notes:**
- Failing-open dedup is what this fixes — keep the API fallback mandatory, never default to "not duplicate" on unknown.
- Same store files as Task 7: run before Task 7.

### Task 7: Preserve match columns, pagada, and MANUAL locks on reprocess/replacement (ADV-307)
**Linear Issue:** [ADV-307](https://linear.app/lw-claude/issue/ADV-307/reprocessingquality-replacement-paths-rewrite-full-rows-wiping-match)
**Files:**
- `src/processing/storage/factura-store.ts`, `pago-store.ts`, `recibo-store.ts`, `retencion-store.ts` (modify)
- the four colocated store test files (modify)

**Steps:**
1. Write tests: reprocessing a factura whose row has `matchedPagoFileId` set, `matchConfidence='MANUAL'`, `pagada='SI'` → all three survive while importe/fecha are refreshed; same preservation for pago/recibo/retencion; pago quality-replacement preserves the existing row's match columns; reprocess of an unmatched row still writes empty match columns (no stale garbage).
2. Run verifier (expect fail)
3. On the reprocess-existing-fileId path (and pago-store's quality-replacement path), read the existing row first and carry forward match-state columns (`matchedPagoFileId`/`matchedFacturaFileId`, `matchConfidence`, `hasCuitMatch`) and `pagada` into the rewritten row; extraction data is refreshed, match state is extraction-independent. A `matchConfidence='MANUAL'` row retains lock and match in all four stores.
4. Run verifier (expect pass)

**Notes:**
- Enforces the documented MANUAL permanent-lock invariant (CLAUDE.md MATCHING).
- If the read-existing-row step fails, the store must return `ok:false` rather than rewriting blind (state-consistency requirement).
- Already-wiped production rows are not recoverable — forward-looking fix only.

### Task 8: Movimientos persistence failures must not mark resumen 'success' (ADV-308)
**Linear Issue:** [ADV-308](https://linear.app/lw-claude/issue/ADV-308/movimientos-persistence-is-best-effort-failed-movimientos-write-still)
**Files:**
- `src/processing/scanner.ts` (modify)
- `src/processing/storage/resumen-store.ts` (modify)
- `src/processing/scanner.test.ts`, `src/processing/storage/resumen-store.test.ts` (modify)

**Steps:**
1. Write tests (all three resumen types): movimientos store failure → file status 'failed', not 'success', and the file is NOT moved out of Entrada; re-queued file with an existing resumen row but missing movimientos sheet → movimientos are written and the file is not routed to Duplicado; true duplicate (resumen row + populated movimientos sheet) still routes to Duplicado.
2. Run verifier (expect fail)
3. Implement: a movimientos spreadsheet-get or store failure marks the file 'failed' with the movimientos error, leaving it in Entrada for retry. The duplicate path verifies the corresponding Movimientos period sheet exists and is populated before treating the file as a true duplicate; if missing, re-store movimientos first (recovers the crash window). Identical behavior across bancario (`scanner.ts:1641`), tarjeta (`:1864`), broker (`:2075`).
4. Run verifier (expect pass)

**Notes:**
- **Migration note:** production may already contain resumen rows with missing Movimientos sheets; recovery is re-uploading the affected PDF once this lands (no schema migration).
- Atomicity: retry path must be idempotent w.r.t. the already-written resumen row (the period-sheet check provides this).
- Same scanner.ts as Tasks 5 and 11 — run in phase order.

### Task 9: Watch-channel renewal failure must not kill polling permanently (ADV-303)
**Linear Issue:** [ADV-303](https://linear.app/lw-claude/issue/ADV-303/single-failed-channel-renewal-permanently-disables-both-push)
**Files:**
- `src/services/watch-manager.ts` (modify)
- `src/server.ts` (boot message accuracy, modify)
- `src/services/watch-manager.test.ts` (modify)

**Steps:**
1. Write tests: a renewal whose `startWatching` fails once → folder is retried on the next renewal tick and ingestion recovers without restart; with zero active channels and a stale `lastNotificationTime`, the fallback scan still triggers; successful renewal path unchanged.
2. Run verifier (expect fail)
3. Implement: on renewal `startWatching` failure keep the folder eligible for retry (retry set or tombstone entry the renewal loop revisits) so `activeChannels` cannot silently drain; `checkAndTriggerFallbackScan` no longer early-returns when `activeChannels.size === 0` while watching was intended — fallback polling survives zero channels and attempts channel re-establishment; `server.ts` boot message only claims "fallback polling active" when true.
4. Run verifier (expect pass)

**Notes:**
- Same file as Task 10 (different functions) — run before Task 10.

### Task 10: Re-queue scans for notifications consumed during an external scan (ADV-312)
**Linear Issue:** [ADV-312](https://linear.app/lw-claude/issue/ADV-312/drive-notification-consumed-but-scan-skipped-when-a-non-watch-manager)
**Files:**
- `src/services/watch-manager.ts` (modify)
- `src/services/watch-manager.test.ts` (modify)

**Steps:**
1. Write tests: webhook during an externally-started scan (`scanFolder` mocked to return `skipped:true` / reason `scan_running`) → a follow-up scan is eventually triggered, and `lastScanTime`/`consecutiveFailures` are untouched; `skipped` with reason `scan_pending` → no duplicate queueing; non-skipped success path bookkeeping unchanged.
2. Run verifier (expect fail)
3. Implement: `triggerScan`'s success handler distinguishes `result.value.skipped === true` — no `consecutiveFailures` reset, no `lastScanTime` update, no 'Scan complete' log; on `scan_running`, queue the folderId into `pendingScanFolderIds` (or retry after a short delay); `scan_pending` may no-op (the pending scan lists Entrada at start, per the documented invariant).
4. Run verifier (expect pass)

**Notes:**
- Deduplication guard: queueing must not multiply scans for repeated notifications during one external scan (idempotent pending set).

### Task 11: Distinguish rename-only failure from move failure in document sorting (ADV-348)
**Linear Issue:** [ADV-348](https://linear.app/lw-claude/issue/ADV-348/sortandrenamedocument-reports-failure-after-a-successful-move-when)
**Files:**
- `src/services/document-sorter.ts` (modify)
- `src/processing/scanner.ts` (modify)
- `src/services/document-sorter.test.ts`, `src/processing/scanner.test.ts` (modify)

**Steps:**
1. Write tests: document-sorter with `moveFile` ok + `renameFile` error → result reports moved-but-not-renamed (not plain failure) and includes the target folder; scanner records status 'success' with a warn log and the errors counter unchanged; true move failure still yields `success:false` with `failed:` status (next-scan recovery preserved).
2. Run verifier (expect fail)
3. Extend `SortResult` so rename-only failure is distinguishable (e.g. `renamed: false` + rename error + completed targetFolderId/targetPath); update all document-type branches in scanner.ts (`:911, :1037, :1192, :1344, :1463, :1683, :1904, :2115`) to treat rename-only failure as success-with-warning.
4. Run verifier (expect pass)

**Notes:**
- Existing stale `failed` rows in Archivos Procesados are historical records; no backfill.

### Phase C — AI boundary, parser & PDF defense

### Task 12: Close PDF invisible-text scanner gaps (FlateDecode, /Tr 3, q/Q state) (ADV-284)
**Linear Issue:** [ADV-284](https://linear.app/lw-claude/issue/ADV-284/pdf-invisible-text-scanner-bypassed-by-compressed-streams-and-tr-3)
**Files:**
- `src/processing/pdf-sanitize.ts` (modify)
- `src/processing/pdf-sanitize.test.ts` (modify)

**Steps:**
1. Write tests: a PDF fixture whose content stream is zlib-deflated and contains a white-fill + Tj sequence is detected; a raw stream with `3 Tr (payload) Tj` is detected; `q 1 g Q (visible) Tj` does NOT flag but `q 0 g Q 1 g (hidden) Tj` and `1 g q 0 g Q (hidden) Tj` DO flag; error path: a stream declaring `/FlateDecode` with corrupt deflate bytes returns `hasInvisible: false` without throwing; a clean compressed PDF with dark text passes.
2. Run verifier (expect fail)
3. Implement: decode FlateDecode content streams with `node:zlib` `inflateSync` in try/catch (skip streams that fail to inflate) before running the existing operator regexes; detect filter type from the stream dictionary (non-Flate filters remain a documented gap); add `/Tr 3` render-mode detection (a `3 Tr` followed by a text-show operator in the same stream flags invisible-render-mode); make `hasWhiteFillBeforeText` track the `q`/`Q` save/restore stack; cap decompressed stream size (a few MB) so a zip-bomb cannot blow memory — oversized inflation is treated as suspicious or skipped with a warn; update the KNOWN GAPS header comment.
4. Run verifier (expect pass)

**Notes:**
- This is the project's LLM01 (indirect prompt injection) blocking control — detected files route to Sin Procesar (`extractor.ts:211`). Preserves the no-pdfjs-dist design decision (zlib is stdlib).

### Task 13: Fix dependency vulnerabilities fast-uri + qs (ADV-285)
**Linear Issue:** [ADV-285](https://linear.app/lw-claude/issue/ADV-285/dependency-vulnerabilities-fast-uri-cwe-22-high-and-qs-dos-moderate)
**Files:**
- `package.json`, `package-lock.json` (modify — dependency-only)

**Steps:**
1. Run `npm audit --json` and record current findings (red baseline: fast-uri ≤3.1.1 high ×2, qs moderate).
2. Run `npm audit fix` (both fixes are semver-compatible per `fixAvailable: true`); if it under-fixes, bump the lockfile entries directly (fast-uri ≥3.1.2, patched qs).
3. Confirm `npm audit` reports zero high/moderate findings.
4. Run verifier full mode (all tests + lint + build) as the regression gate.

**Notes:**
- No new unit tests — transitive bump. fast-uri sits in Fastify's routing path serving the unauthenticated `/webhooks/drive` endpoint, so this is real exposure.

### Task 14: Validate Gemini enum fields at the AI boundary (ADV-286)
**Linear Issue:** [ADV-286](https://linear.app/lw-claude/issue/ADV-286/gemini-enum-fields-tipocomprobante-moneda-cast-without-runtime)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: factura with `tipoComprobante: "Tipo X"` → field undefined (joins missingFields), `needsReview=true`; pago with `moneda: "U$S"` → flagged, value not stored as-is; resumen_bancario with `moneda: "Dolares"` → flagged; valid "NC E" still accepted (regression guard for commit 2ebf502).
2. Run verifier (expect fail)
3. Validate factura `tipoComprobante` against the canonical TipoComprobante list in `parseFacturaResponse` (out-of-enum → undefined + needsReview); validate `moneda` against ARS/USD in factura, pago, and resumen_bancario parsers (invalid → undefined + needsReview — never silently default at this boundary; the extractor's `|| 'ARS'` default remains acceptable only for genuinely-missing values once the review flag fires). Share enum lists with `utils/validation.ts` rather than duplicating, without adopting its silent-default behavior.
4. Run verifier (expect pass)

**Notes:**
- Same parser functions as Tasks 15-17 — Phase C order is mandatory here.

### Task 15: Allow legitimate negative values in resumen numeric validation (ADV-287)
**Linear Issue:** [ADV-287](https://linear.app/lw-claude/issue/ADV-287/isinvalidnumericvalue-rejects-all-negatives-overdraft-saldos-card)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: overdraft bancario movimiento (saldo −5000) → no needsReview; tarjeta payment line (pesos −15000) → no needsReview; broker sale (neto −1000) → no needsReview; negative `debito` still flags (error path retained).
2. Run verifier (expect fail)
3. Add an `allowNegative` option (or per-field sign rule) to `isInvalidNumericValue` (`parser.ts:925-933`); accept negatives for bancario `saldo`, tarjeta `pesos`/`dolares`, broker `saldo`/`neto`/`bruto`/`cantidadVN` (decide `precio`/`arancel`/`iva` explicitly in the implementation and assert the choice); keep the non-negative check for bancario `debito`/`credito`; keep finiteness and MAX_FINANCIAL_VALUE checks everywhere.
4. Run verifier (expect pass)

### Task 16: Runtime-validate monetary fields across all seven parsers (ADV-317)
**Linear Issue:** [ADV-317](https://linear.app/lw-claude/issue/ADV-317/monetary-fields-at-the-ai-boundary-lack-runtime-typesignfiniteness)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: factura with `importeTotal: "1.234,56"` (string) → treated as missing, needsReview=true; pago with non-finite `importePagado` → flagged; bancario with negative `saldoFinal` → accepted; retencion with string `montoRetencion` → flagged.
2. Run verifier (expect fail)
3. Add a shared header-level numeric validator (finite-number check, per-field sign rule) applied in all seven parsers: factura importes, pago importePagado, recibo subtotals/totalNeto, bancario saldoInicial/saldoFinal (negatives allowed), tarjeta pagoMinimo/saldoActual, broker saldoARS/saldoUSD, retencion montoComprobante/montoRetencion, plus cantidadMovimientos (non-negative integer). Invalid values become undefined and join the missingFields/needsReview path — never silent storage of strings/NaN.
4. Run verifier (expect pass)

**Notes:**
- Sign rules must align with Task 15's per-field decisions (shared helper). Depends on Tasks 14-15 (same functions).

### Task 17: Make hasSuspiciousEmptyFields an independent needsReview trigger (ADV-336)
**Linear Issue:** [ADV-336](https://linear.app/lw-claude/issue/ADV-336/hassuspiciousemptyfields-can-never-trigger-needsreview-dead-condition)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: factura with all required fields present but an empty-string optional field (e.g. `concepto: ''`) → needsReview=true with confidence 1.0; same per pago/recibo/retencion; fully-complete doc with no empty strings → needsReview=false (regression).
2. Run verifier (expect fail)
3. Change the needsReview expression in all four document parsers (`parser.ts:579/729/835/1712`) so `hasSuspiciousEmptyFields` triggers independently of the confidence threshold; keep the empty-string → undefined normalization.
4. Run verifier (expect pass)

**Notes:**
- Depends on Tasks 14-16 (same needsReview lines).

### Task 18: Flag count mismatch when cantidadMovimientos is 0 but movimientos exist (ADV-338)
**Linear Issue:** [ADV-338](https://linear.app/lw-claude/issue/ADV-338/movimientos-count-mismatch-check-skipped-when-cantidadmovimientos-is-0)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: bancario with `cantidadMovimientos: 0` and 5 movimientos → needsReview=true (same per tarjeta/broker); `cantidadMovimientos: 0` with an empty array → needsReview=false (SIN MOVIMIENTOS statements stay valid).
2. Run verifier (expect fail)
3. In all three resumen parsers (`parser.ts:1177/:1367/:1498`), when `expectedCount === 0 && movimientos.length > 0`, set needsReview and log the mismatch.
4. Run verifier (expect pass)

### Task 19: Word-boundary ADVA name matching (ADV-313)
**Linear Issue:** [ADV-313](https://linear.app/lw-claude/issue/ADV-313/adva-name-matching-is-a-bare-substring-counterparties-containing-adva)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: `isAdvaName('ADVANCED GAMES SA')` → false; `isAdvaName('ADVA')` and the full-name form → true (regressions); a factura from issuer "ADVANTAGE SRL" to client ADVA classifies as factura_recibida; a genuinely ambiguous both-names-match-ADVA case yields needsReview=true.
2. Run verifier (expect fail)
3. Add word-boundary semantics to the ADVA acronym match (handle punctuation like "ADVA.") keeping the full-name alternative; apply the same boundary fix to the `.includes('ADVA')` checks in `validateAdvaRole` (`parser.ts:334/:351`); in the both-match branch (`:119-135`), surface an ambiguity signal from `assignCuitsAndClassify` so the caller sets needsReview instead of silently defaulting to factura_emitida.
4. Run verifier (expect pass)

**Notes:**
- Same function as Tasks 20-21 — order mandatory.

### Task 20: Validate counterparty CUIT/DNI candidates from allCuits (ADV-314)
**Linear Issue:** [ADV-314](https://linear.app/lw-claude/issue/ADV-314/counterparty-cuit-taken-from-allcuits-with-no-digit-only-or-check)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: allCuits `['ABC12345', <valid CUIT>]`-shaped input picks the checksum-valid CUIT (use approved fake CUITs in fixtures); dotted CUIT normalizes and is selected; invalid-checksum 11-digit candidate is skipped → otherCuit `''` (existing empty-receptor review path fires); existing 8-digit DNI behavior preserved.
2. Run verifier (expect fail)
3. Extend `normalizeCuit` to strip dots; in the `otherCuit` selection (`parser.ts:99`), require digits-only, `isValidCuit` for 11-digit candidates, `isValidDni` for 7-8 digit candidates; skip 9-10 digit/non-conforming; prefer a checksum-valid CUIT over a DNI when both present; only invalid candidates → `''`.
4. Run verifier (expect pass)

**Notes:**
- Depends on Task 19 (same function). Reuses `isValidCuit`/`isValidDni` from `src/utils/validation.ts`.

### Task 21: Flag CUIT-position fallback classifications for review (ADV-337)
**Linear Issue:** [ADV-337](https://linear.app/lw-claude/issue/ADV-337/cuit-position-fallback-assumes-an-allcuits-ordering-the-prompt)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: factura where neither name matches ADVA and allCuits has ADVA non-first → parses ok, classified factura_recibida, needsReview=true; ADVA first → factura_emitida, needsReview=true; ADVA absent from names AND allCuits → existing ParseError path preserved; normal name-match path → needsReview unchanged.
2. Run verifier (expect fail)
3. Add an ambiguity flag to the `assignCuitsAndClassify` result set whenever the CUIT-position fallback (`parser.ts:139-167`) is used; `parseFacturaResponse` forces needsReview and caps confidence when set (mirror the empty-cuitReceptor path at `:583-592`). Keep the fallback's direction heuristic as the provisional classification; do NOT change the prompt's "do not assign to parties" strategy.
4. Run verifier (expect pass)

**Notes:**
- Depends on Tasks 19-20 (same function/result shape).

### Task 22: String-aware JSON brace counting in extractJSON/isTruncated (ADV-315)
**Linear Issue:** [ADV-315](https://linear.app/lw-claude/issue/ADV-315/extractjsonistruncated-brace-counting-is-string-literal-unaware-braces)
**Files:**
- `src/gemini/parser.ts` (modify)
- `src/gemini/parser.test.ts` (modify)

**Steps:**
1. Write tests: response `{"concepto":"Plan {Premium}","importeTotal":100}` extracts and parses; a `}` inside a string value followed by trailing prose still extracts the full object; a genuinely truncated response (unterminated object) still returns 'truncated'.
2. Run verifier (expect fail)
3. Make brace counting string-aware (track in-string state and backslash escapes) in both `isTruncated` (`parser.ts:180-206`) and the extraction loop (`:256-273`) — or restructure to JSON.parse-first with the scanner as fallback. Preserve markdown-fence handling and genuine truncation detection.
4. Run verifier (expect pass)

**Notes:**
- Failure mode today is deterministic across all 3 retries → file lands in Sin Procesar; this directly reduces operator workload.

### Task 23: Normalize tipoTarjeta case; stop fabricating 'Visa' (ADV-316)
**Linear Issue:** [ADV-316](https://linear.app/lw-claude/issue/ADV-316/invalid-tipotarjeta-is-nulled-by-the-parser-for-review-then-the)
**Files:**
- `src/gemini/parser.ts`, `src/processing/extractor.ts` (modify)
- `src/gemini/parser.test.ts`, `src/processing/extractor.test.ts` (modify)

**Steps:**
1. Write tests: parser maps 'MASTERCARD' → 'Mastercard' with no review flag; unknown type 'Diners' → undefined + needsReview; extractor with undefined tipoTarjeta does NOT produce a 'Visa' record — assert the explicit review/error path.
2. Run verifier (expect fail)
3. Normalize card type case-insensitively in the parser before the `VALID_CARD_TYPES` check (`parser.ts:1291-1301`); remove the `|| 'Visa'` fabrication at `extractor.ts:566` — genuinely missing/invalid tipoTarjeta is a missing required field (parse-error → Sin Procesar route is the defined behavior).
4. Run verifier (expect pass)

**Notes:**
- tipoTarjeta feeds folder name, file name, dedupe key, and the Resumenes row — fabrication corrupts all four. Existing misfiled rows are data-ops corrections, not migrations.

### Task 24: Parse multi-dot Argentine numbers correctly (ADV-339)
**Linear Issue:** [ADV-339](https://linear.app/lw-claude/issue/ADV-339/parsenumber-misparses-dot-thousands-argentine-numbers-without-a-comma)
**Files:**
- `src/utils/numbers.ts` (modify)
- `src/utils/numbers.test.ts` (modify)

**Steps:**
1. Write tests: `parseNumber('1.234.567')` → 1 234 567; `parseNumber('1.234.567,89')` → 1 234 567.89 (regression); `parseNumber('1,234.56')` → 1234.56 (regression); the chosen single-dot rule ('12.500', '1.000') asserted explicitly; `parseNumber('1.2.3.abc')` → null (error path).
2. Run verifier (expect fail)
3. In `detectNumberFormat` (`numbers.ts:28-42`), classify dot-only strings with ≥2 dots as 'argentine'; pick and document a rule for single-dot ambiguous cases (the mandatory part is that multi-dot strings are never truncated).
4. Run verifier (expect pass)

### Phase D — Matching pipeline

### Task 25: Fix Pagos Enviados column mapping in recibo-pago matching (ADV-304)
**Linear Issue:** [ADV-304](https://linear.app/lw-claude/issue/ADV-304/recibo-pago-matching-parses-pagos-enviados-beneficiario-columns-into)
**Files:**
- `src/processing/matching/recibo-pago-matcher.ts` (modify)
- `src/processing/matching/recibo-pago-matcher.test.ts` (modify)

**Steps:**
1. Write tests: a pago whose column-H CUIL equals `recibo.cuilEmpleado` produces a HIGH-confidence match with `hasCuitMatch='YES'`; two recibos with equal `totalNeto` resolve correctly via CUIL; a pago with no CUIL and two equal-net candidates still produces no match (ambiguity preserved).
2. Run verifier (expect fail)
3. In `doMatchRecibosWithPagos` (`recibo-pago-matcher.ts:335-336`), map columns H/I into `cuitBeneficiario`/`nombreBeneficiario` (per `PAGO_ENVIADO_HEADERS`) instead of pagador fields; leave pagador fields unset (ADVA is the implicit pagador).
4. Run verifier (expect pass)

**Notes:**
- Existing `hasCuitMatch=NO` rows self-correct on the next match run.

### Task 26: Exclude NC/ND rows from the factura-pago matching pool (ADV-305)
**Linear Issue:** [ADV-305](https://linear.app/lw-claude/issue/ADV-305/factura-pago-matching-pool-includes-ncnd-rows-a-pago-can-claim-a)
**Files:**
- `src/processing/matching/factura-pago-matcher.ts` (modify)
- `src/processing/matching/factura-pago-matcher.test.ts` (modify)

**Steps:**
1. Write tests: pool excludes rows with `tipoComprobante` 'NC', 'NC A', 'ND', 'ND E'; scenario factura + cancelling NC (same CUIT/amount) + pago of equal amount → pago matches the factura, NC row receives no `matchedPagoFileId`/`pagada` write; regular A/B/C/E rows still match.
2. Run verifier (expect fail)
3. Skip NC/ND rows when building the facturas pool in `doMatchFacturasWithPagos` (`factura-pago-matcher.ts:321-353`), mirroring the `isNC`/`isND` prefix logic in `nc-factura-matcher.ts` and the parsing exclusions in `match-movimientos.ts:326-330/412-413`.
4. Run verifier (expect pass)

**Notes:**
- NC rows already corrupted with pago-set `pagada='SI'` in production are a data-ops cleanup, not a code migration.

### Task 27: Let recibos match when the extracted CUIL is the employee's (ADV-321)
**Linear Issue:** [ADV-321](https://linear.app/lw-claude/issue/ADV-321/hard-cuit-filter-excludes-all-recibos-even-when-the-extracted-cuil)
**Files:**
- `src/bank/matcher.ts` (modify)
- `src/bank/matcher.test.ts` (modify)

**Steps:**
1. Write tests: salary movement with the employee CUIL in concepto matches the recibo at tier 2 / HIGH; movement with a supplier CUIT in concepto (no `cuilEmpleado` match) still excludes all recibos (hard filter preserved); with two recibos, only the CUIL-matching one is eligible.
2. Run verifier (expect fail)
3. In the recibos loop of `matchMovement` (`matcher.ts:515-516`), replace the unconditional drop: when a CUIT/CUIL is extracted, keep recibos whose `cuilEmpleado` equals it (tier 2 identity match) and exclude the rest; no extracted match against any recibo → recibos stay excluded.
4. Run verifier (expect pass)

**Notes:**
- Same file as Tasks 28-29 — order mandatory.

### Task 28: Exclude ADVA's own CUIT from concepto identity extraction (ADV-340)
**Linear Issue:** [ADV-340](https://linear.app/lw-claude/issue/ADV-340/identity-extraction-does-not-exclude-advas-own-cuit-concepto)
**Files:**
- `src/bank/matcher.ts` (modify; optionally `src/utils/validation.ts` if exclusion lands at extraction level)
- `src/bank/matcher.test.ts` (+ `validation.test.ts` if touched)

**Steps:**
1. Write tests: concepto containing only ADVA's CUIT applies no hard filter (amount/date candidates still match); concepto containing ADVA's CUIT plus a counterparty CUIT filters on the counterparty CUIT; concepto with only a counterparty CUIT unchanged.
2. Run verifier (expect fail)
3. During concepto identity extraction (`matcher.ts:253` alias of `extractCuitFromText`), skip CUITs in `ADVA_CUITS` (config.ts:12) and continue scanning for the next valid non-ADVA CUIT; none remaining → no CUIT filter. Apply identically in debit (`matchMovement`) and credit (`matchCreditMovement`) paths.
4. Run verifier (expect pass)

**Notes:**
- If this implementation uses the currently-unreferenced `isAdvaCuit` helper, update Task 70 (ADV-355) accordingly — it would no longer be dead code.

### Task 29: Use tierToConfidence in matchCreditMovement direct-factura path (ADV-342)
**Linear Issue:** [ADV-342](https://linear.app/lw-claude/issue/ADV-342/matchcreditmovement-direct-factura-confidence-ignores-tier-tier-5)
**Files:**
- `src/bank/matcher.ts` (modify)
- `src/bank/matcher.test.ts` (modify)

**Steps:**
1. Write tests: tier-5 credit direct-factura match (no CUIT, no keyword, same currency) → LOW; tier-2 (CUIT match) → HIGH; tier-2 cross-currency → MEDIUM (unchanged).
2. Run verifier (expect fail)
3. Replace the ad-hoc confidence block at `matcher.ts:806-811` with `tierToConfidence(tier, isCrossCurrency)`; only tier 5 changes MEDIUM → LOW.
4. Run verifier (expect pass)

**Notes:**
- Depends on Tasks 27-28 (same file).

### Task 30: Normalize matchedType in row-version hash (ADV-323)
**Linear Issue:** [ADV-323](https://linear.app/lw-claude/issue/ADV-323/row-version-hash-uses-raw-matchedtype-while-read-side-normalizes)
**Files:**
- `src/services/movimientos-detalle.ts` (modify)
- `src/services/movimientos-detalle.test.ts` (modify)

**Steps:**
1. Write tests: round-trip — a row read with column H = 'manual' produces a `computeRowVersion` hash equal to `computeVersionFromRow` over the raw row, so the update applies; canonical 'AUTO'/'MANUAL'/'' hash identically (no regression); unknown garbage in H normalizes to '' on both sides.
2. Run verifier (expect fail)
3. Apply the same matchedType normalization as `parseMatchedType` (trim + uppercase, unknown → '') in `computeVersionFromRow` (`movimientos-detalle.ts:61`); share/export one normalization function rather than duplicating.
4. Run verifier (expect pass)

**Notes:**
- Affected rows self-heal on the next match run once hashes align. Run before Task 34 (same file).

### Task 31: Align movimiento match-replacement tier semantics with the selection matcher (ADV-319)
**Linear Issue:** [ADV-319](https://linear.app/lw-claude/issue/ADV-319/movimiento-match-replacement-comparison-uses-tier-semantics-that)
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/bank/match-movimientos.test.ts` (modify)

**Steps:**
1. Write tests: an existing direct-factura match with `matchedPagoFileId` set compares at its real tier (2/4/5), not 1, and is displaceable by a genuine tier-1 pago-with-linked-factura candidate; a concepto containing a dashed CUIT matching the document CUIT yields tier 2 in the comparison; no-CUIT concepto still falls through to keyword/tier-5.
2. Run verifier (expect fail)
3. In `buildMatchQuality` (`match-movimientos.ts:710-713, :784-788`): grant tier 1 only for pagos (`pago_recibido`/`pago_enviado`) with a linked factura; detect the concepto CUIT via `extractCuitFromText` (same as the selection matcher) instead of raw `includes`; keep tier 3/4/5 logic.
4. Run verifier (expect pass)

**Notes:**
- Same region as Tasks 32-34 — order mandatory.

### Task 32: Exclude linked counterpart documents from the movimiento matching pool (ADV-324)
**Linear Issue:** [ADV-324](https://linear.app/lw-claude/issue/ADV-324/same-economic-transaction-can-be-matched-to-two-different-bank)
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/bank/match-movimientos.test.ts` (modify)

**Steps:**
1. Write tests: two equal-amount movements, pago P linked to factura F — after movement A matches P, movement B cannot match F (and vice versa); a replacement that frees P also frees F for future runs; an unlinked pago and an unrelated factura of the same amount can still match two different movements (no over-exclusion).
2. Run verifier (expect fail)
3. When adding a matched document's fileId to the exclusion set (pre-seed at `match-movimientos.ts:919-923` and match-accept at `:1116-1118`), also add its linked counterpart (`matchedFacturaFileId` for pagos, `matchedPagoFileId` for facturas, via `documentMap`); apply symmetrically when freeing fileIds on replacement/force-clear; propagate counterpart exclusions into `globalExcludeFileIds`.
4. Run verifier (expect pass)

**Notes:**
- Existing double-matched rows resolve via `?force=true` re-match after deploy — release-notes item, not a migration.

### Task 33: Revert pagada='SI' when its justifying match is removed (ADV-320)
**Linear Issue:** [ADV-320](https://linear.app/lw-claude/issue/ADV-320/pagadasi-is-never-reverted-when-a-match-is-unmatched-replaced-or-force)
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/processing/matching/factura-pago-matcher.ts` (modify if cascade-unmatch is touched)
- `src/bank/match-movimientos.test.ts`, `src/processing/matching/factura-pago-matcher.test.ts` (modify)

**Steps:**
1. Write tests: force-clear (`?force=true`, no new match) reverts `pagada` to '' on the previously matched factura; replacement reverts the displaced factura's `pagada`; NC-set 'SI' on a factura with no pago/movimiento link survives the revert pass; a factura with a surviving `matchedPagoFileId` keeps 'SI'.
2. Run verifier (expect fail)
3. On replacement (`match-movimientos.ts:1081-1124`) and force-clear (`:1127-1138`), revert the previously matched factura's `pagada` unless another justification survives (its `matchedPagoFileId` is set, another movimiento still points at it, or the 'SI' is NC-attributable). Cascade-unmatch in factura-pago-matcher follows the same rule if touched.
4. Run verifier (expect pass)

**Notes:**
- **Migration note:** existing orphaned `pagada='SI'` rows are not auto-repaired; a force re-match after deploy re-derives state — release-notes item.
- Pagos/Cobros Pendientes re-sync after the update (existing `matchAllMovimientos` flow) must still run.

### Task 34: Gate pagada writes on actually-applied detalle updates (ADV-343)
**Linear Issue:** [ADV-343](https://linear.app/lw-claude/issue/ADV-343/pagadasi-written-even-for-movimiento-rows-whose-detalle-update-was)
**Files:**
- `src/services/movimientos-detalle.ts` (modify)
- `src/bank/match-movimientos.ts` (modify)
- both colocated test files (modify)

**Steps:**
1. Write tests: a version-mismatched movimiento row results in no pagada write for its factura while other applied rows still trigger theirs; sheet read failure during verification skips that sheet's pagada writes; an all-skipped scenario writes zero pagada updates despite `ok:true`.
2. Run verifier (expect fail)
3. `updateDetalle` returns the set of applied updates (sheetName + rowNumber, or applied/skipped breakdown) instead of only a count; `PagadaUpdate` entries carry their source movimiento (captured at `match-movimientos.ts:1110`); filter `pagadaUpdates` to applied sources before writing; stats reflect applied rows only.
4. Run verifier (expect pass)

**Notes:**
- Depends on Tasks 30 (same service file) and 31-33 (same match-movimientos regions).

### Task 35: Close exchange-rate prefetch coverage gaps for USD matching (ADV-318)
**Linear Issue:** [ADV-318](https://linear.app/lw-claude/issue/ADV-318/exchange-rate-prefetch-coverage-gaps-make-some-usd-cross-currency)
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/processing/matching/index.ts` (modify)
- possibly a shared date-collection helper in `src/utils/exchange-rate.ts`
- `src/bank/match-movimientos.test.ts` + matching pipeline tests (modify)

**Steps:**
1. Write tests: a USD pago enviado without `importeEnPesos` matches an ARS debit when the rate API mock returns a rate (prefetch invoked with its fechaPago); `runMatching` on a cold cache with a USD factura/pago pair produces a cross-currency match; prefetch failure logs a warn and matching continues without throwing.
2. Run verifier (expect fail)
3. Include USD pagosEnviados `fechaPago` (and any other USD docs consumed by `BankMovementMatcher`) in `extractUsdDocumentDates` (`match-movimientos.ts:98-124`); in the `runMatching` pipeline, collect USD document dates and call `prefetchExchangeRates` before invoking the matchers (warn-and-continue on failure); no prefetch call for ARS-only datasets.
4. Run verifier (expect pass)

**Notes:**
- External HTTP (ArgentinaDatos API): prefetch already carries timeout/error handling — reuse it; the sync lookup stays cache-only by design.
- Depends on Tasks 31-34 (same match-movimientos.ts).

### Task 36: Date-parse NC-factura ordering guard (ADV-341)
**Linear Issue:** [ADV-341](https://linear.app/lw-claude/issue/ADV-341/nc-factura-date-ordering-uses-lexicographic-string-comparison-on-un)
**Files:**
- `src/processing/matching/nc-factura-matcher.ts` (modify)
- `src/processing/matching/nc-factura-matcher.test.ts` (modify)

**Steps:**
1. Write tests: NC with text date '15/03/2025' vs factura ISO '2025-03-01' passes the guard (NC is after); NC dated before the factura rejected regardless of string format; unparseable date in either row → no match (skip, consistent with sibling matchers).
2. Run verifier (expect fail)
3. Parse both dates with `parseArgDate` at `nc-factura-matcher.ts:245` and compare Date values; unparseable → skip the candidate pair.
4. Run verifier (expect pass)

### Phase E — Sheets & storage primitives

### Task 37: Harden appendRowsWithFormatting with the ADV-242 lock + response validation (ADV-288)
**Linear Issue:** [ADV-288](https://linear.app/lw-claude/issue/ADV-288/appendrowswithformatting-lacks-adv-242-hardening-per-sheet-lock)
**Files:**
- `src/services/sheets.ts` (modify)
- `src/services/sheets.test.ts` (modify)

**Steps:**
1. Write tests: two concurrent `appendRowsWithFormatting` calls to the same sheet execute serially; concurrent calls to different sheets run in parallel; a batchUpdate response with missing/empty `replies` causes a retry and eventually `ok:false`, never silent success.
2. Run verifier (expect fail)
3. Wrap the entire body (metadata fetch → batchUpdate, `sheets.ts:1648-1739`) in the same `withLock` keyed `sheet-append:${spreadsheetId}:${sheetName}` (60 s wait / 900 s expiry); validate `replies[0]` like `appendRowsWithLinks` (`:1241-1246`); return value unchanged.
4. Run verifier (expect pass)

**Notes:**
- Reachable today: `extractor.ts:147` fire-and-forgets `logTokenUsage` per file at queue concurrency 12. CLAUDE.md SHEETS API CONCURRENCY rules apply verbatim.

### Task 38: Add HTTP timeouts to googleapis Drive/Sheets clients (ADV-289)
**Linear Issue:** [ADV-289](https://linear.app/lw-claude/issue/ADV-289/no-http-timeout-on-googleapis-drivesheets-calls-can-hang-the)
**Files:**
- `src/config.ts`, `src/services/sheets.ts`, `src/services/drive.ts` (modify)
- `src/services/sheets.test.ts`, `src/services/drive.test.ts` (modify)

**Steps:**
1. Write tests: service construction passes the configured timeout option; a call whose transport never responds rejects within the timeout and surfaces as a normal retryable/`ok:false` error (mock gaxios/transport) rather than hanging; the constant exists and is > 0.
2. Run verifier (expect fail)
3. Add `GOOGLE_API_TIMEOUT_MS` (~60 s) to `src/config.ts`; pass `timeout` in the `google.sheets()` (`sheets.ts:166`) and `google.drive()` (`drive.ts:61`) constructor options; timed-out requests flow into `withQuotaRetry`/Result error paths.
4. Run verifier (expect pass)

**Notes:**
- This closes the hung-socket path that defeats both the processing lock and `scanState` reset (`scanner.ts:851`).
- Depends on Task 37 (same sheets.ts).

### Task 39: Offset saldoCalculado formulas for non-empty month sheets; guard the SIN MOVIMIENTOS banner (ADV-322)
**Linear Issue:** [ADV-322](https://linear.app/lw-claude/issue/ADV-322/storemovimientosbancario-assumes-the-target-month-sheet-is-empty)
**Files:**
- `src/processing/storage/movimientos-store.ts`, `src/utils/balance-formulas.ts`, `src/services/sheets.ts` (modify)
- `src/processing/storage/movimientos-store.test.ts` (create if missing), `src/utils/balance-formulas.test.ts` (modify)

**Steps:**
1. Write tests: storing a second statement into an already-populated month sheet produces formulas offset by the existing row count (first new tx references the new SALDO INICIAL row, not F2); SALDO FINAL references the batch's own last row; an empty statement against a populated month sheet performs NO update over row 3; metadata/row-count read failure returns `ok:false` rather than appending with wrong references.
2. Run verifier (expect fail)
3. Determine the existing data-row count of the target month sheet before building rows; pass a start-row offset into `generateMovimientoRowWithFormula`/`generateFinalBalanceRow` (`balance-formulas.ts:55-60, 88-96`); a second batch starts its own SALDO INICIAL block at the correct offset; `formatEmptyMonthSheet` (`sheets.ts:1967-1981`) writes the banner only when the sheet has no data rows below the header (otherwise skip with info log).
4. Run verifier (expect pass)

**Notes:**
- **Migration note:** month sheets that already received two same-month batches have corrupted formulas (saldoCalculado referencing a row outside its batch). Detection + re-store via data-ops; no code migration.
- ADV-325 is a duplicate of this issue (moved to Duplicate state). Depends on Tasks 37-38 (same sheets.ts).

### Task 40: Write fechaEmision as CellDate in Pagos/Cobros Pendientes (ADV-290)
**Linear Issue:** [ADV-290](https://linear.app/lw-claude/issue/ADV-290/fechaemision-written-as-plain-string-instead-of-celldate-in)
**Files:**
- `src/services/pagos-pendientes.ts` (modify)
- `src/services/pagos-pendientes.test.ts` (modify)

**Steps:**
1. Write tests: written row[0] equals the CellDate form of '2025-12-02' for both dashboards; a row whose fechaEmision normalizes to empty writes `''`, not a malformed CellDate.
2. Run verifier (expect fail)
3. Wrap the normalized fechaEmision as `CellDate` in both row builders (`pagos-pendientes.ts:149, :357`); keep `''` for empty normalization results.
4. Run verifier (expect pass)

**Notes:**
- Both sheets are derived views fully cleared and rewritten on each sync — the next sync converts all rows; no migration.

### Task 41: Remove dead, mis-indexed DuplicateCache resumen methods (ADV-345)
**Linear Issue:** [ADV-345](https://linear.app/lw-claude/issue/ADV-345/duplicatecache-resumen-methods-use-column-indices-off-by-one-vs-the)
**Files:**
- `src/processing/caches/duplicate-cache.ts`, `src/processing/storage/resumen-store.ts` (modify)
- `src/processing/caches/duplicate-cache.test.ts` (modify)

**Steps:**
1. Adjust/remove the duplicate-cache tests covering `isDuplicateResumen*`; assert resumen store paths still detect duplicates via the API-based check; storing a resumen with no `context.duplicateCache` continues to work.
2. Run verifier (expect fail where tests changed)
3. Delete `isDuplicateResumenBancario/Tarjeta/Broker` (wrong indices, zero callers — resumen dedup is API-based at `resumen-store.ts:158/287/406`); remove the no-op `addEntry(..., 'Resumenes', ...)` calls (`resumen-store.ts:233/351/474`); comment that resumen dedup is API-only by design.
4. Run verifier (expect pass)

**Notes:**
- Run after Tasks 3, 6-8 (same store files; Task 6 also edits duplicate-cache.ts).

### Phase F — Subdiario

### Task 42: Detect phantom rows and full-rewrite instead of positional diff (ADV-309)
**Linear Issue:** [ADV-309](https://linear.app/lw-claude/issue/ADV-309/blank-fecha-rows-break-applysubdiariodiff-positional-math-updates)
**Files:**
- `src/services/subdiario-writer.ts`, `src/services/subdiario-diff.ts` (modify; `src/services/sheets.ts` only if positional handling changes)
- `src/services/subdiario-writer.test.ts`, `src/services/subdiario-diff.test.ts` (modify)

**Steps:**
1. Write tests: a sheet with a blank separator row between two data rows → sync runs a full rewrite whose deletes cover the blank row's physical index and final rows land at correct positions; a row with cleared fecha but populated cod/nro → no duplicate row for that (cod,nro) after apply; all-blank/short sheet → no positional updates emitted.
2. Run verifier (expect fail)
3. `readSubdiarioRows` reports the raw physical row count (or skipped-row positions) alongside parsed rows (`subdiario-writer.ts:210-211`); when parsed < physical, skip the incremental positional diff and route to the full-rewrite branch; the full-rewrite branch deletes ALL physical data rows, not just parsed `existing` indices (`:712`), purging phantom rows.
4. Run verifier (expect pass)

**Notes:**
- Production sheets with existing phantom rows are healed by the first full-rewrite pass — self-migrating.
- Same files as Tasks 43 and 49 — order mandatory.

### Task 43: Guard against duplicate keys in the desired Subdiario set (ADV-328)
**Linear Issue:** [ADV-328](https://linear.app/lw-claude/issue/ADV-328/diffsubdiariorows-has-no-guard-for-duplicate-keys-in-the-desired-set)
**Files:**
- `src/services/subdiario-diff.ts` (modify)
- `src/services/subdiario-diff.test.ts`, `src/services/subdiario-writer.test.ts` (modify)

**Steps:**
1. Write tests: desired containing a bare-'NC' row and an 'NC C' row with the same nro, key present in existing → diff flags the violation and emits no update pair sharing a rowIndex; duplicate desired keys NOT present in existing → still flagged (insert path would create real duplicates); clean desired set → no flag (regression).
2. Run verifier (expect fail)
3. Detect duplicate (cod,nro) keys during the desired walk (`subdiario-diff.ts:132-148`); on detection set the existing violation flag so the writer's full-rewrite fallback runs; the fallback warn surfaces that desired-side duplicates triggered it.
4. Run verifier (expect pass)

**Notes:**
- Depends on Task 42 (same diff/fallback code).

### Task 44: Distinguish failure classes in readFacturador (ADV-330)
**Linear Issue:** [ADV-330](https://linear.app/lw-claude/issue/ADV-330/readfacturador-swallows-real-api-errors-into-ok-empty-map-subdiario)
**Files:**
- `src/services/facturador-reader.ts` (modify)
- `src/services/facturador-reader.test.ts`, `src/services/subdiario-writer.test.ts` (modify)

**Steps:**
1. Write tests: `getValues` returning a quota/500 error → `readFacturador` returns `ok:false`; `syncSubdiario` with a failed reader → returns `ok:false` and performs zero sheet writes; missing-tab error → still ok-empty (degraded mode); env var unset → ok-empty (regression).
2. Run verifier (expect fail)
3. Classify failures (`facturador-reader.ts:87-96`): env unset → ok-empty (documented degraded mode); year-tab-missing 400 → ok-empty with warn; any other Sheets error (quota, 5xx, auth) → `ok:false`. The writer's existing `!facturadorResult.ok` guard (`subdiario-writer.ts:516-524`) then aborts before any write. Update the JSDoc contract.
4. Run verifier (expect pass)

**Notes:**
- This closes a failing-open mass overwrite (transient failure erases categoria sheet-wide). Same file as Task 45 — run first.

### Task 45: Strip-then-pad in normalizeNroComprobante (ADV-350)
**Linear Issue:** [ADV-350](https://linear.app/lw-claude/issue/ADV-350/normalizenrocomprobante-pads-without-stripping-leading-zeros)
**Files:**
- `src/services/facturador-reader.ts` (modify; optionally share one normalizer with `src/services/subdiario-builder.ts`)
- `src/services/facturador-reader.test.ts` (modify)

**Steps:**
1. Write tests: '000005-000000057' → '00005-00000057' (joins with the builder key); '0005-00000057' and '5-57' both → canonical form; input without dash returns trimmed input unchanged; all-zeros segments survive (strip then padStart restores '00000').
2. Run verifier (expect fail)
3. Make `normalizeNroComprobante` (`facturador-reader.ts:56-58`) strip leading zeros before padding, identical to the builder's `normalizeNro` (`subdiario-builder.ts:84-92`); preferably extract one shared normalizer so they cannot drift.
4. Run verifier (expect pass)

**Notes:**
- Depends on Task 44 (same file). Note Task 70: `getFacturadorSpreadsheetId` is currently dead — this task may adopt it instead of reading the env var directly; coordinate.

### Task 46: Emit the TC-faltante review flag for NC rows (ADV-327)
**Linear Issue:** [ADV-327](https://linear.app/lw-claude/issue/ADV-327/nc-rows-never-receive-the-revisar-tc-faltante-flag-usd-nc-without)
**Files:**
- `src/services/subdiario-builder.ts` (modify)
- `src/services/subdiario-builder.test.ts` (modify)

**Steps:**
1. Write tests: USD NC with tipoDeCambio undefined/0 → row.notas contains '[REVISAR: TC faltante]'; USD NC with valid TC → notas '' and total is the negated converted amount; ARS NC → notas '' (no spurious flag).
2. Run verifier (expect fail)
3. In `composeNotas` (`subdiario-builder.ts:526`), emit the REVISAR marker for NC rows when `revisar` is true (check before the NC early-return); other FC-only note parts stay suppressed for NCs.
4. Run verifier (expect pass)

**Notes:**
- Next sync updates affected rows via the diff (notas is an equality field). Same file as Task 47 — run first.

### Task 47: Prevent double-attachment of unclaimed retenciones (ADV-329)
**Linear Issue:** [ADV-329](https://linear.app/lw-claude/issue/ADV-329/findmatchingretenciones-pass-2-can-attach-the-same-unclaimed-retencion)
**Files:**
- `src/services/subdiario-builder.ts` (modify)
- `src/services/subdiario-builder.test.ts` (modify)

**Steps:**
1. Write tests: two facturas with identical cuitReceptor and importeTotal plus one unclaimed retencion → exactly one factura's nota contains the retencion; a retencion claimed via `matchedFacturaFileId` for factura A is still returned for A even after an unclaimed retencion was consumed elsewhere; a second unclaimed retencion with the same CUIT/amount attaches to the second factura.
2. Run verifier (expect fail)
3. Thread a shared `consumedRetencionIds: Set<string>` through the per-factura nota loop into `findMatchingRetenciones` pass 2 (`subdiario-builder.ts:388-405`), same pattern as `computeCancellingNCs` (`:340-351`); pass 1 (authoritative claims) unaffected; deterministic attribution via existing build order.
4. Run verifier (expect pass)

**Notes:**
- Depends on Task 46 (same file). Subdiario is fully rebuilt each run — no migration.

### Task 48: Exclude NC/ND from Pagos Pendientes (ADV-326)
**Linear Issue:** [ADV-326](https://linear.app/lw-claude/issue/ADV-326/syncpagospendientes-does-not-exclude-ncnd-comprobantes-credit-notes)
**Files:**
- `src/services/pagos-pendientes.ts` (modify)
- `src/services/pagos-pendientes.test.ts` (modify)

**Steps:**
1. Write tests: Facturas Recibidas row with tipoComprobante 'NC A' and pagada≠'SI' does not appear in Pagos Pendientes; 'ND B' likewise; regular 'A' unpaid row still appears; empty tipoComprobante cell → row still included.
2. Run verifier (expect fail)
3. Add the NC/ND prefix exclusion to the `unpaidFacturas` filter (`pagos-pendientes.ts:121-126`), mirroring the cobros-side check (`:329-332`) including its comment.
4. Run verifier (expect pass)

**Notes:**
- Run after Task 40 (same file).

### Task 49: Skip non-bank tabs in readMovimientosRows via header guard (ADV-352)
**Linear Issue:** [ADV-352](https://linear.app/lw-claude/issue/ADV-352/readmovimientosrows-reads-every-yyyy-mm-tab-of-every-movimientos)
**Files:**
- `src/services/subdiario-writer.ts` (modify; reuse `isBankMovimientosHeader` from `src/services/movimientos-reader.ts`)
- `src/services/subdiario-writer.test.ts` (modify)

**Steps:**
1. Write tests: a workbook whose tabs have a card-schema header → zero BankMovimiento rows and at most one `getValues` for it; a bank-schema workbook → rows parsed as before (matchedType/credito/sourceUrl/label intact); empty or header-only tab → skipped without error.
2. Run verifier (expect fail)
3. Apply `isBankMovimientosHeader` per tab before parsing (`subdiario-writer.ts:342-399`); skip whole non-bank workbooks after the first tab's header fails (card/broker schemas are uniform). Do NOT blindly restrict by period — prior-year unpaid FCs can be cobrados by any-period movimientos.
4. Run verifier (expect pass)

**Notes:**
- Depends on Task 42 (same file). Reduces quota cost and the lock-hold time Task 2 budgets for.

### Phase G — Routes, environment & infra

### Task 50: Report real version and environment identity in status (ADV-310)
**Linear Issue:** [ADV-310](https://linear.app/lw-claude/issue/ADV-310/status-reporting-hardcodes-version-100-and-reports-nodeenv-instead-of)
**Files:**
- `src/routes/status.ts`, `src/services/status-sheet.ts` (modify)
- new `src/utils/version.ts` + `src/utils/version.test.ts` (create)
- `src/routes/status.test.ts`, `src/services/status-sheet.test.ts` (modify)

**Steps:**
1. Write tests: `/api/status` returns the version matching package.json (read independently in the test) and `environment` equal to `config.environment`; `collectStatusMetrics().version` equals package.json version; Entorno metric equals `config.environment`; version helper returns 'unknown' (not a throw) when package.json is unreadable.
2. Run verifier (expect fail)
3. Read the version from package.json once at module load via a small helper (fallback 'unknown'); use it in `/api/status` (`status.ts:93`) and `collectStatusMetrics`; report `config.environment` instead of `config.nodeEnv` in both.
4. Run verifier (expect pass)

**Notes:**
- Status sheet rows are overwritten on every update — old values self-correct post-deploy.

### Task 51: Add .catch() to the fire-and-forget updateStatusSheet call (ADV-296)
**Linear Issue:** [ADV-296](https://linear.app/lw-claude/issue/ADV-296/updatestatussheet-fire-and-forget-call-missing-catch-in-scan-route)
**Files:**
- `src/routes/scan.ts` (modify)
- `src/routes/scan.test.ts` (modify)

**Steps:**
1. Write test: with `updateStatusSheet` mocked to reject, POST /api/scan still resolves 200 and no unhandled rejection is emitted; the error is logged with module context.
2. Run verifier (expect fail)
3. Append `.catch()` at `scan.ts:108` logging via the route logger with `{ module: 'scan', phase: 'status-sheet' }`; keep the call fire-and-forget (do not await).
4. Run verifier (expect pass)

**Notes:**
- Same file as Tasks 52-53 — run in order. Follows the documented ADV-211 `void` + `.catch()` convention.

### Task 52: Add structured context to two bare log calls (ADV-299)
**Linear Issue:** [ADV-299](https://linear.app/lw-claude/issue/ADV-299/two-log-calls-lack-structured-context-webhooks-string-only-rematch)
**Files:**
- `src/routes/webhooks.ts`, `src/routes/scan.ts` (modify)
- `src/routes/webhooks.test.ts`, `src/routes/scan.test.ts` (modify)

**Steps:**
1. Write tests: a Drive notification missing the channel-ID header logs a warn whose first argument is a non-empty object; POST /api/rematch logs 'Starting rematch' with a non-empty context object; rematch with no body still logs without throwing.
2. Run verifier (expect fail)
3. `webhooks.ts:82`: pass a context object (e.g. resourceState/messageNumber) matching adjacent calls; `scan.ts:133`: replace `{}` with meaningful fields (e.g. requested documentType).
4. Run verifier (expect pass)

### Task 53: Remove the dead `force` field from /api/scan (ADV-335)
**Linear Issue:** [ADV-335](https://linear.app/lw-claude/issue/ADV-335/apiscan-accepts-a-force-boolean-in-its-body-schema-but-the-handler)
**Files:**
- `src/routes/scan.ts` (modify)
- `src/routes/scan.test.ts` (modify)

**Steps:**
1. Write tests: POST /api/scan with `{"force": true}` returns 400 (schema validation, `additionalProperties: false`); empty body and `{folderId}` still work.
2. Run verifier (expect fail)
3. Remove `force` from the `ScanRequest` interface (`scan.ts:23`) and the body schema (`:56`).
4. Run verifier (expect pass)

**Notes:**
- Apps Script client verified not to send the field (POSTs null body). Depends on Tasks 51-52 (same file). API change only — internal API, no migration.

### Task 54: Map delivery downstream failures to 503 per ADV-219 convention (ADV-334)
**Linear Issue:** [ADV-334](https://linear.app/lw-claude/issue/ADV-334/delivery-routes-map-isdescendantofdrive-failures-to-500-inconsistent)
**Files:**
- `src/routes/delivery.ts` (modify)
- `src/routes/delivery.test.ts` (modify)

**Steps:**
1. Write tests: build-movimientos returns 503 when `isDescendantOf` rejects with a Drive error; 503 when `findByName` returns `ok:false`; still 400 when `isDescendantOf` resolves false (guard semantics unchanged).
2. Run verifier (expect fail)
3. In the build-movimientos ancestry guard, map `findByName` failure (`delivery.ts:242`) and `isDescendantOf` failure (`:249`) to `respond503`; "Entregas folder not found" (null) and the 400 non-descendant rejection stay as-is.
4. Run verifier (expect pass)

**Notes:**
- Same file as Task 55 — run first. Other delivery 500s are explicitly out of scope (mixed local+Drive logic).

### Task 55: Serialize mutating delivery endpoints behind a lock (ADV-354)
**Linear Issue:** [ADV-354](https://linear.app/lw-claude/issue/ADV-354/preparedeliveryfolder-find-then-create-races-concurrent-deliverycopy)
**Files:**
- `src/routes/delivery.ts` (modify; `src/services/delivery-package.ts` only if the lock lands at service level)
- `src/routes/delivery.test.ts`, `src/services/delivery-package.test.ts` (modify)

**Steps:**
1. Write tests: two concurrent copy-pdfs calls for the same period → exactly one `createFolder('Entregas')` and one period folder (mocked Drive), second call serialized; while copy-pdfs holds the lock, build-movimientos waits or is rejected with the documented status; lock-holder failure releases the lock so a subsequent request succeeds.
2. Run verifier (expect fail)
3. Serialize copy-pdfs and build-movimientos behind `withLock` (dedicated `delivery-lock` key or `PROCESSING_LOCK_ID`); a second request either waits (bounded) or returns 409/503 with a clear "delivery in progress" message — pick one and document it in the route comment, replacing the current "no lock" rationale. The lock covers the full prepare → clear → copy/build sequence.
4. Run verifier (expect pass)

**Notes:**
- The clear step uses permanent `files.delete` (`drive.ts:1240-1250`) — interleaving is destructive, hence the lock must wrap it entirely. Depends on Task 54 (same file).

### Task 56: Derive business-local dates in Argentina timezone (ADV-353)
**Linear Issue:** [ADV-353](https://linear.app/lw-claude/issue/ADV-353/business-local-dates-derived-from-utc-clock-delivery-entregado-date)
**Files:**
- `src/utils/date.ts` (modify) + `src/utils/date.test.ts`
- `src/services/delivery-package.ts`, `src/routes/subdiario.ts`, `src/bank/match-movimientos.ts` (modify) + colocated tests

**Steps:**
1. Write tests: with clock fixed at 2026-01-01T01:30:00Z (= 2025-12-31 22:30 ART) the delivery folder name contains 'entregado 2025-12-31' and `businessYear` returns 2025; at 2026-01-01T04:00:00Z (01:00 ART) returns 2026; mid-year noon UTC matches the UTC date (regression).
2. Run verifier (expect fail)
3. Add helpers returning current date parts in America/Argentina/Buenos_Aires (Intl.DateTimeFormat formatToParts): `businessDateString` and `businessYear`; use them in `formatDeliveryFolderName` (`delivery-package.ts:514`), the subdiario route (`subdiario.ts:69`), and `matchAllMovimientos` (`match-movimientos.ts:1217`).
4. Run verifier (expect pass)

**Notes:**
- Touches `match-movimientos.ts` and `subdiario.ts` — run AFTER Tasks 1-2 and 31-35 (same files) and after Task 55 (delivery-package). Existing delivery folder names keep their dates (prefix-matching reuse ignores the entregado suffix).

### Task 57: Default unset ENVIRONMENT to staging; validate NODE_ENV (ADV-346)
**Linear Issue:** [ADV-346](https://linear.app/lw-claude/issue/ADV-346/unset-environment-resolves-to-development-not-staging-as-documented)
**Files:**
- `src/config.ts` (modify) + `src/config.test.ts`
- `src/services/folder-structure.ts` (modify if the 'development' bypass is removed) + `src/services/folder-structure.test.ts`

**Steps:**
1. Write tests: `loadConfig` with ENVIRONMENT unset and NODE_ENV=development yields `environment === 'staging'`; miscased `NODE_ENV='Production'` is rejected/normalized rather than silently taking the non-production path; `checkEnvironmentMarker` is invoked (not bypassed) for the unset-ENVIRONMENT boot path; ENVIRONMENT='prod' still throws.
2. Run verifier (expect fail)
3. Unset ENVIRONMENT with non-production NODE_ENV resolves to 'staging' (`config.ts:262-266`); the production-requires-explicit-ENVIRONMENT throw stays; validate NODE_ENV against development|production|test (unknown → throw at boot); decide the `'development'` bypass in `checkEnvironmentMarker` (remove, or keep only for `nodeEnv === 'test'`) and document the fail-closed rationale in CLAUDE.md ENV VARS.
4. Run verifier (expect pass)

**Notes:**
- **Migration note:** Railway sets ENVIRONMENT in both envs — no production impact. Local dev boots now run the marker check: a dev boot pointed at the production folder fails with a mismatch error (intended fail-closed behavior).
- Same function as Task 58 — run first. Run after Tasks 1, 3, 38 (same config.ts).

### Task 58: Refuse to auto-claim a populated unmarked root folder (ADV-347)
**Linear Issue:** [ADV-347](https://linear.app/lw-claude/issue/ADV-347/checkenvironmentmarker-claims-an-unmarked-root-folder-by-creating-its)
**Files:**
- `src/services/folder-structure.ts` (modify)
- `src/services/folder-structure.test.ts` (modify)

**Steps:**
1. Write tests: unmarked root with existing children → `checkEnvironmentMarker` returns an error and does NOT create a marker; unmarked empty root → creates marker, ok (first-boot preserved); correct marker present → ok without create; child-listing failure → error propagated (no claim).
2. Run verifier (expect fail)
3. Before auto-claiming (`folder-structure.ts:936-946`), check whether the folder already contains data (children / Control spreadsheets / year folders); unmarked + populated → error instructing the operator to restore or create the correct marker manually (boot fails closed), logged with folder ID and findings.
4. Run verifier (expect pass)

**Notes:**
- Depends on Task 57 (same function). Both existing roots carry markers — normal boots unaffected; graceful handling of old format preserved (marker present → unchanged behavior).

### Task 59: Sanitize Gemini-derived fields in Drive filenames (ADV-349)
**Linear Issue:** [ADV-349](https://linear.app/lw-claude/issue/ADV-349/gemini-derived-fechanrofacturanrocertificado-interpolated-into-drive)
**Files:**
- `src/utils/file-naming.ts` (modify)
- `src/utils/file-naming.test.ts` (modify)

**Steps:**
1. Write tests: factura with `nroFactura='0001/00001234'` produces a filename with no `/`; retencion with `nroCertificado='123|456'` strips the pipe; malformed fechaEmision containing `\` or control chars yields a sanitized (or placeholder) prefix; well-formed inputs produce byte-identical names to current output.
2. Run verifier (expect fail)
3. Pass `fecha` and `numero` through `sanitizeFileName` in `generateFacturaFileName` (`file-naming.ts:106/126/140`) and `fechaEmision`/`nroCertificado` in `generateRetencionFileName` (`:294/297`); optionally validate fecha shape with a safe placeholder for grossly malformed dates.
4. Run verifier (expect pass)

### Task 60: Literal template substitution in build.js (ADV-333)
**Linear Issue:** [ADV-333](https://linear.app/lw-claude/issue/ADV-333/buildjs-template-substitution-mangles-secrets-containing-dollar)
**Files:**
- `apps-script/build.js` (modify)
- build test (create colocated test if none exists for `escapeTemplateValue`)

**Steps:**
1. Write tests: substituting `{{API_SECRET}}` with secrets containing `$$`, `$&`, `` $` ``, `$'` yields the exact literal secret in the output (currently fails); a secret combining `\`, `'`, and `$$` round-trips through escape + substitution.
2. Run verifier (expect fail)
3. Make both substitutions literal (function replacement or split/join) for API_BASE_URL and API_SECRET (`build.js:137-139`); `escapeTemplateValue` semantics unchanged.
4. Run verifier (expect pass)

**Notes:**
- Distinct from the accepted embed-the-secret pattern — this is escaping correctness. A corrupted secret ships silently and 401s every Apps Script call.

### Task 61: Guard cached Google auth client against scope mismatch (ADV-294)
**Linear Issue:** [ADV-294](https://linear.app/lw-claude/issue/ADV-294/getgoogleauthasync-silently-ignores-scopes-argument-after-first-call)
**Files:**
- `src/services/google-auth.ts` (modify)
- `src/services/google-auth.test.ts` (modify)

**Steps:**
1. Write tests: `getGoogleAuthAsync(scopesA)` then `(scopesB)` rejects with an error naming both scope sets; same scopes in different order returns the cached client; after a failed first init, a retry with different scopes succeeds (no stale scope record).
2. Run verifier (expect fail)
3. Remember initialization scopes alongside `authClient` (`google-auth.ts:68-72`); compare with order-insensitive set equality on subsequent calls and throw a descriptive error on mismatch; reset cached scopes wherever the client/promise cache resets (error path at `:98`); document the single-client cache in JSDoc.
4. Run verifier (expect pass)

### Task 62: Wire dashboardId into token-usage batch auto-flush (ADV-298)
**Linear Issue:** [ADV-298](https://linear.app/lw-claude/issue/ADV-298/tokenusagebatch-max-batch-size-auto-flush-never-fires-dashboardid-not)
**Files:**
- `src/processing/scanner.ts`, `src/processing/extractor.ts` (modify)
- `src/services/token-usage-batch.test.ts`, `src/processing/extractor.test.ts` (modify)

**Steps:**
1. Write tests: adding 100 entries with a dashboardId triggers exactly one flush (mock `appendRowsWithFormatting`) and resets `pendingCount`; the extractor passes the context dashboardId to `tokenBatch.add`; a failed auto-flush write preserves entries and subsequent adds don't throw.
2. Run verifier (expect fail)
3. Add the dashboard ID to `ScanContext` (`scanner.ts:348-355`); pass it in `extractor.ts:143`; keep the end-of-scan flush (`scanner.ts:766`) as the final drain.
4. Run verifier (expect pass)

**Notes:**
- Run after Tasks 5, 8, 11 (same scanner.ts) and Task 23 (same extractor.ts).

### Task 63: Remove the double-cast on subdiario headers (ADV-300)
**Linear Issue:** [ADV-300](https://linear.app/lw-claude/issue/ADV-300/unnecessary-double-cast-as-unknown-as-on-subdiario-headers)
**Files:**
- `src/services/subdiario-writer.ts` (modify)

**Steps:**
1. Remove `as unknown as CellValue[]` at `subdiario-writer.ts:725` (the cast-free form at `:320` proves assignability).
2. Run verifier full mode — existing subdiario-writer tests pass and the build compiles with zero warnings.

**Notes:**
- Type-level-only change; run after Phase F tasks editing the same file (42, 49).

### Phase H — Refactor & test hygiene

### Task 64: Centralize sheet column-index parsing on spreadsheet-headers.ts (ADV-332)
**Linear Issue:** [ADV-332](https://linear.app/lw-claude/issue/ADV-332/positional-column-index-sheet-parsing-duplicated-across)
**Files:**
- `src/constants/spreadsheet-headers.ts` (modify) + test
- `src/processing/matching/factura-pago-matcher.ts`, `recibo-pago-matcher.ts`, `nc-factura-matcher.ts`, `retencion-factura-matcher.ts` (modify) + tests
- `src/services/folder-structure.ts`, `src/services/movimientos-reader.ts`, `src/services/movimientos-detalle.ts` (modify) + tests

**Steps:**
1. Write tests: each matcher's row-parsing test feeds a row built positionally from the headers constant and asserts field mapping; inserting a synthetic extra column mid-array still maps fields correctly (fails with hardcoded indices); the lookup helper throws for a header name absent from the constant (drift guard).
2. Run verifier (expect fail)
3. Export an index-lookup helper from `spreadsheet-headers.ts` (throws on unknown header); replace every hardcoded `row[N]`/offset read in the seven cited sites with indices derived from the canonical header arrays; delete the `o`/`colOffset` arithmetic.
4. Run verifier (expect pass)

**Notes:**
- MUST run after Tasks 25, 26, 30, 34, 36, 58 (it refactors the files they fix). ADV-304 was a production instance of exactly this drift — the helper prevents recurrence.
- Read-path refactor only; sheet schemas unchanged; no migration.

### Task 65: Update MANUAL-lock test to the 21-column factura schema (ADV-291)
**Linear Issue:** [ADV-291](https://linear.app/lw-claude/issue/ADV-291/manual-lock-test-uses-outdated-20-column-factura-schema-masking-column)
**Files:**
- `src/processing/matching/factura-pago-matcher.test.ts` (test-only)

**Steps:**
1. Update the MANUAL-lock test's fixtures (`factura-pago-matcher.test.ts:415-417`) to the 21-column schema with `condicionIVAReceptor` (copy shape from the ADV-170 tests at `:210`); keep existing assertions (`result.value === 0`, no batchUpdate).
2. Add a non-MANUAL variant asserting a match IS produced with `importeTotal` read from the correct offset index, plus an edge case where a 20-col misalignment would misread importeTotal and produce NO match — proving fixture alignment matters.
3. Run verifier (expect pass).

**Notes:**
- Run after Tasks 26 and 64 (same file). Test-only — the red phase is the new non-MANUAL variant against the current fixture.

### Task 66: Replace real personal CUIT/CUILs and names in fixtures and FACTURA_PROMPT (ADV-331)
**Linear Issue:** [ADV-331](https://linear.app/lw-claude/issue/ADV-331/real-personal-cuitcuils-valid-check-digits-with-real-looking-names)
**Files:**
- `src/gemini/prompts.ts`, `src/gemini/parser.test.ts`, `src/matching/matcher.test.ts`, `src/utils/validation.test.ts`, `src/processing/caches/duplicate-cache.test.ts` (modify)

**Steps:**
1. Replace the FACTURA_PROMPT example's real name with a fictional one ("Juan Perez") and the CUIL with an approved fictional value, preserving the example's structural fingerprints (Consumidor Final shape, allCuits with ADVA CUIT first).
2. Test the prompt change via the Gemini MCP (`gemini_analyze_pdf`) on a sample Consumidor Final factura before/after to confirm extraction accuracy is preserved (this is the documented prompt-testing use of that MCP).
3. Replace all listed test occurrences with approved fictional identifiers; for `validation.test.ts`, derive the expected DNI from the chosen CUIT (e.g. 20123456786 → DNI 12345678) and update assertions consistently.
4. Run verifier (expect pass); final grep confirms no valid-check-digit CUIT/CUILs remain outside the approved list + ADVA's.

**Notes:**
- Same matcher.test.ts as Task 67 and parser.test.ts as Task 69 — run first. Run after Phase C (parser.test.ts) and Phase D (matcher tests). Git history retains old values; history rewrite is out of scope.

### Task 67: Replace non-approved fictional CUITs in matcher/recibo-store tests (ADV-301)
**Linear Issue:** [ADV-301](https://linear.app/lw-claude/issue/ADV-301/non-approved-fictional-cuitcuils-in-test-fixtures-20123456789)
**Files:**
- `src/matching/matcher.test.ts`, `src/processing/storage/recibo-store.test.ts` (test-only)

**Steps:**
1. Replace `20123456789` with approved `20123456786` (or `20111111119` where a distinct second identity is needed) in both files; replace `27987654321` with `27234567891`; preserve test semantics where two fixtures need DIFFERENT CUILs.
2. Run verifier (expect pass); grep confirms zero remaining hits for both numbers.

**Notes:**
- Depends on Task 66 (same matcher.test.ts).

### Task 68: Realign match-movimientos test fixtures to their headers (ADV-356)
**Linear Issue:** [ADV-356](https://linear.app/lw-claude/issue/ADV-356/match-movimientos-fixture-rows-misaligned-with-their-header-arrays)
**Files:**
- `src/bank/match-movimientos.test.ts` (test-only)

**Steps:**
1. Realign the three fixture rows (`match-movimientos.test.ts:1340-1341, :1562`) to the 19-column header (cuitemisor=`20123456786`, importetotal numeric, etc.); the equal-quality test must genuinely construct two tier-2 CUIT-match candidates (same CUIT, same date distance) and assert the existing match is kept under force=false; the orphaned-fileId test keeps its semantics.
2. Add assertions that the parsed candidates carry `cuitEmisor === '20123456786'` and `importeTotal === 1000`, plus a regression case where a strictly better new match DOES replace.
3. Run verifier (expect pass).

**Notes:**
- Run after Phase D Tasks 31-35 (the same file's source-under-test changes tier semantics there).

### Task 69: Test the non-finite debito needsReview branch for real (ADV-357)
**Linear Issue:** [ADV-357](https://linear.app/lw-claude/issue/ADV-357/rejects-nan-debito-with-needsreview-flag-test-asserts-nothing-about)
**Files:**
- `src/gemini/parser.test.ts` (test-only; `src/gemini/parser.ts` only if the red phase reveals a real gap)

**Steps:**
1. Replace the test at `parser.test.ts:851-878` with one delivering a genuinely non-finite number: a raw JSON string containing `"debito": 1e999` (JSON.parse → Infinity); assert `result.ok === true` AND `result.value.needsReview === true`; rename to describe the asserted behavior; same for `credito`; keep a separate test documenting `debito: null` is accepted without needsReview.
2. Run verifier — if the needsReview assertion fails, that exposes a real parser gap in the `Number.isFinite` branch: fix it in `parser.ts` under this task.

**Notes:**
- Run after Phase C Tasks 14-18 and Task 66 (same files).

### Task 70: Delete seven dead exported functions (ADV-355)
**Linear Issue:** [ADV-355](https://linear.app/lw-claude/issue/ADV-355/seven-exported-functions-with-zero-references-anywhere-in-the)
**Files:**
- `src/config.ts`, `src/processing/queue.ts`, `src/utils/date.ts`, `src/utils/concurrency.ts`, `src/services/drive.ts` (modify)

**Steps:**
1. Re-verify zero references for each candidate with a whole-repo grep — REQUIRED because earlier tasks may have introduced callers (in particular: Task 28 may now use `isAdvaCuit`; Task 45 may adopt `getFacturadorSpreadsheetId`; Task 56 touches `utils/date.ts`). Drop any function that gained a caller from this task's scope.
2. Delete the remaining dead exports (`isAdvaCuit`, `getFacturadorSpreadsheetId`, `resetProcessingQueue`, `toDateString`, `checkVersion`, `isResourceLocked`, `getFileWithContent`) and any now-orphaned private helpers/imports.
3. Run verifier full mode — the zero-warning build catches any missed reference; all tests pass.

**Notes:**
- MUST be the last task in the plan. CLAUDE.md: delete unused code only when safe — no production data depends on these (runtime code only).

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review changes for bugs — Fix any issues found
2. Run `verifier` agent (full mode) — Verify all tests pass and zero warnings — Fix any issues

---

## Plan Summary

**Objective:** Clear the entire validated Backlog (70 issues) — data-integrity bugs in matching/storage/Subdiario, AI-boundary validation gaps, lock-expiry races, recovery dead code, PDF-injection defense gaps, dependency vulnerabilities, and test hygiene.

**Linear Issues:** 70 planned (see Source); ADV-292, ADV-293, ADV-295 canceled as not applicable; ADV-325 marked duplicate of ADV-322.

**Approach:** 8 parallel triage agents verified every issue against current code before planning. Tasks are grouped into 8 phases by file/domain so same-file tasks run in a mandatory order (locks → scanner/recovery → AI boundary → matching → sheets/storage → Subdiario → routes/env → refactor/test hygiene), with the broad ADV-332 refactor and dead-code deletion (ADV-355) deliberately last. Every task follows Red-Green-Refactor with explicit error-path/edge-case tests.

**Scope:** 70 tasks, ~75 source/test files, ~190 new or updated test assertions.

**Key Decisions:**
- ADV-302/ADV-351 fixed via a shared lock-expiry constant (waiter timeout stays 5 min; expiry ≥ 900 s, mirroring ADV-242) rather than lock heartbeats.
- ADV-345 resolved by deleting the dead mis-indexed cache methods (resumen dedup stays API-based by design) rather than fixing unreachable code.
- ADV-316 stops fabricating 'Visa': missing tipoTarjeta becomes a parse-level review failure (Sin Procesar), trading silent misfiling for operator visibility.
- ADV-337 keeps the CUIT-position heuristic but stops trusting it silently (needsReview), preserving the prompt's "do not assign parties" extraction strategy.
- ADV-309 routes phantom-row sheets to full rewrite instead of attempting positional repair.

**Risks:**
- Matching-behavior changes (Tasks 25-36) alter production match outcomes; a `?force=true` re-match after release re-derives state — release-notes items are flagged per task.
- Task 7 (row carry-forward) and Task 8 (resumen retry idempotency) touch the most data-critical write paths; their state-consistency tests are the gate.
- Task 66 changes a production prompt; the Gemini MCP before/after comparison is mandatory.
- Plan size: 70 tasks across one branch — plan-implement must respect phase ordering to avoid worktree merge conflicts.

---

## Iteration 1

**Implemented:** 2026-06-12
**Method:** Agent team (7 workers across 3 waves, worktree-isolated) + lead-reserved tasks

### Tasks Completed This Iteration

All 70 tasks. By work unit:

- **worker-1 (wave 1):** Task 1 (ADV-302), Task 2 (ADV-351), Task 3 (ADV-344), Task 4 (ADV-306), Task 5 (ADV-311), Task 6 (ADV-297), Task 7 (ADV-307), Task 8 (ADV-308), Task 9 (ADV-303), Task 10 (ADV-312), Task 11 (ADV-348), Task 41 (ADV-345) — lock expiry decoupling, timezone-correct processedAt decode, scan-queue recovery gates, fail-closed duplicate cache, match-column/MANUAL-lock preservation on reprocess, resumen/movimientos atomicity, watch-channel retry + fallback-poll survival, rename-only failure handling, dead resumen cache methods removed
- **worker-2 (wave 1):** Task 12 (ADV-284), Tasks 14-24 (ADV-286, ADV-287, ADV-317, ADV-336, ADV-338, ADV-313, ADV-314, ADV-337, ADV-315, ADV-316, ADV-339) — PDF scanner FlateDecode/Tr-3/q-Q hardening with zip-bomb cap, enum + monetary validation at the AI boundary, per-field sign rules, suspicious-empty-fields trigger, count-mismatch flag, word-boundary ADVA matching, CUIT/DNI checksum validation, CUIT-position-fallback review flag, string-aware JSON brace counting, tipoTarjeta normalization (no more fabricated 'Visa'), multi-dot Argentine number parsing
- **worker-3 (wave 1):** Tasks 25-36 (ADV-304, ADV-305, ADV-321, ADV-340, ADV-342, ADV-323, ADV-319, ADV-324, ADV-320, ADV-343, ADV-318, ADV-341) — beneficiario column mapping, NC/ND pool exclusion, recibo CUIL tier-2 identity, ADVA-CUIT exclusion from concepto extraction (isAdvaCuit now live), tierToConfidence on credit path, matchedType hash normalization, replacement tier alignment, linked-counterpart exclusion, pagada revert on unmatch, pagada gating on applied detalle updates, USD prefetch coverage, parseArgDate NC ordering guard
- **worker-4 (wave 1):** Tasks 37-40, 42-49 (ADV-288, ADV-289, ADV-322, ADV-290, ADV-309, ADV-328, ADV-330, ADV-350, ADV-327, ADV-329, ADV-326, ADV-352) — appendRowsWithFormatting ADV-242 hardening, GOOGLE_API_TIMEOUT_MS, balance-formula row offsets + banner guard, CellDate fechaEmision, phantom-row full-rewrite, desired-set duplicate-key guard, facturador failure classification, strip-then-pad nro normalization, NC TC-faltante flag, retencion consumed-set, NC/ND exclusion in Pagos Pendientes, bank-header tab guard
- **worker-5 (wave 2):** Tasks 50-56, 59-61 (ADV-310, ADV-296, ADV-299, ADV-335, ADV-334, ADV-354, ADV-353, ADV-349, ADV-333, ADV-294) — real version + environment in status, fire-and-forget .catch(), structured log context, dead force field removed, delivery 503 mapping + delivery lock, Argentina-timezone business dates, filename sanitization, literal template substitution in build.js, auth scope-mismatch guard
- **worker-6 (wave 2):** Tasks 57, 58, 62, 63 (ADV-346, ADV-347, ADV-298, ADV-300) — ENVIRONMENT defaults to staging with NODE_ENV validation (CLAUDE.md updated), populated-unmarked-root refusal, dashboardId wired into token-batch auto-flush, double-cast removed
- **worker-7 (wave 3):** Tasks 64, 65, 67-70 (ADV-332, ADV-291, ADV-301, ADV-356, ADV-357, ADV-355) — buildHeaderIndex column-index centralization (also fixed latent nc-factura-matcher cuitField wiring), 21-col MANUAL-lock fixtures, approved fictional CUITs, realigned match-movimientos fixtures, real non-finite debito test, dead exports deleted (isAdvaCuit kept — now used by bank/matcher.ts)
- **Lead:** Task 13 (ADV-285) npm audit fix (fast-uri high, qs moderate → 0 vulnerabilities); Task 66 (ADV-331) real personal CUIT/CUILs + names replaced in FACTURA_PROMPT and four test files, prompt regression-verified via Gemini MCP before/after on a production Consumidor Final factura (byte-identical extraction)

### Files Modified

~80 source/test files across src/processing/, src/bank/, src/gemini/, src/services/, src/utils/, src/routes/, src/constants/, src/config.ts, apps-script/build.js, CLAUDE.md, MIGRATIONS.md. New files: src/utils/version.ts(+test). Net ~+7,800/-1,100 lines.

### Linear Updates

- All 70 issues: Todo → In Progress → Review (real-time per worker report)
- Worker labels applied per wave for review traceability

### Pre-commit Verification

- bug-hunter: Found 1 LOW bug (pagada reverts not gated on applied detalle updates — ADV-320/343 interaction), fixed with regression test before proceeding
- verifier (full mode): All tests pass (2757), lint clean, zero build warnings

### Work Partition

- Wave 1 — worker-1: locks/scanner/recovery/watch (12 tasks); worker-2: AI boundary/parser/PDF (12); worker-3: matching pipeline (12); worker-4: sheets primitives/subdiario (12)
- Wave 2 (after wave-1 merge) — worker-5: routes/delivery/auth/naming (10); worker-6: environment/infra (4)
- Wave 3 (after wave-2 merge) — worker-7: refactor/test hygiene (6)
- Lead-reserved: Task 13 (npm audit mutates shared node_modules), Task 66 (requires Gemini MCP)

### Merge Summary

- All 7 worker branches merged foundation-first with ZERO conflicts; typecheck gate after each merge
- 2 post-merge type errors in worker-7's new tests (batchUpdate mock value type) fixed by lead
- Full suite run after each wave's merge (2700 → 2742 → 2756 tests)

### Migration Notes (release-notes items, no schema migrations)

- Matching-behavior changes (Tasks 25-36): run `POST /api/match-movimientos?force=true` after deploy to re-derive match state (resolves existing double-matched rows and orphaned pagada='SI')
- ADV-308: resumen rows with missing Movimientos sheets recover by re-uploading the affected PDF
- ADV-322: month sheets that received two same-month batches before this fix have corrupted formulas — detection + re-store via data-ops
- ADV-306: migrateDashboardProcessedAt is now idempotent (MIGRATIONS.md updated)

### Continuation Status

All tasks completed.

### Review Findings

**Reviewed:** 2026-06-12 — agent team (security, reliability, quality reviewers; ~100 changed files)

**FIX (5 — Fix Plan created; M-size fixes present, inline threshold not met):**

1. **[high] [bug]** `src/processing/storage/{factura,pago,recibo,retencion}-store.ts` — `findRowByFileId` returns `{found:false}` on a Sheets API read error, conflating "not present" with "read failed". The reprocess path then bypasses ADV-307 carry-forward and can append a duplicate row. Violates the Task 7 plan requirement "read failure → ok:false". → [ADV-358](https://linear.app/lw-claude/issue/ADV-358)
2. **[medium] [async]** `src/services/watch-manager.ts:538` — ADV-312 deferred-scan retry uses `setTimeout(..., 0)`; while an external scan holds the scanner, the skip→re-queue→retry cycle spins at event-loop speed (CPU burn + log flood). → [ADV-359](https://linear.app/lw-claude/issue/ADV-359)
3. **[medium] [type]** `src/processing/storage/movimientos-store.ts:84` — row accumulator declared `any[]`, silently bypassing `CellValueOrLink[][]` checking on the Movimientos write path. → [ADV-360](https://linear.app/lw-claude/issue/ADV-360)
4. **[low] [convention]** `src/bank/match-movimientos.ts:1301-1305, 1339-1343` — two ADV-320 pagada log calls missing the `phase` structured field. → [ADV-361](https://linear.app/lw-claude/issue/ADV-361)
5. **[low] [convention]** factura/pago/recibo stores — ADV-307 carry-forward reads `existing[16..19]` etc. via hardcoded indices instead of the ADV-332 `buildHeaderIndex` drift-guard pattern introduced in this same branch. → [ADV-362](https://linear.app/lw-claude/issue/ADV-362)

**DISCARDED (1 — not a bug):**

- **[edge-case]** `movimientos-store.ts` "duplicate SALDO INICIAL blocks when two resumens share a month" — intentional ADV-322 design: each statement batch is a self-contained block with its own PDF-sourced opening balance, and the `startRowOffset` logic exists precisely to support appending a second block with correct formulas. The iteration's migration notes already document multi-batch sheets as the anticipated scenario.

**Security review:** clean (auth, IDOR guards, input validation, PDF sanitizer hardening, template-injection escaping all verified; no real personal CUITs added by this branch).

### Linear Updates (review)

- All 70 plan issues: Review → Merge (state UUID used per same-type transition gotcha)
- New bug issues created in Todo: ADV-358, ADV-359, ADV-360, ADV-361, ADV-362

<!-- REVIEW COMPLETE -->

---

## Fix Plan

Bugs found during review of Iteration 1. Each fix follows TDD.

### Fix 1: Propagate Sheets read errors from findRowByFileId (all four stores)
**Linear Issue:** [ADV-358](https://linear.app/lw-claude/issue/ADV-358)
**Files:** `src/processing/storage/factura-store.ts`, `pago-store.ts`, `recibo-store.ts`, `retencion-store.ts` + colocated tests

1. Write tests per store: `getValues` returning `ok:false` during the fileId lookup → store returns `ok:false`, no append, no update; empty/header-only sheet still treated as not-found (first store succeeds); found path unchanged.
2. Run verifier (expect fail)
3. Change `findRowByFileId` to a three-state result (e.g. `{ found: true, ... } | { found: false } | { error: Error }` or `Result`-wrapped); on `!rowsResult.ok` return the error variant; callers return `ok:false` with the read error instead of falling through to the new-document path.
4. Run verifier (expect pass)

### Fix 2: Backoff delay for deferred-scan retry
**Linear Issue:** [ADV-359](https://linear.app/lw-claude/issue/ADV-359)
**Files:** `src/services/watch-manager.ts`, `src/services/watch-manager.test.ts`

1. Write test (fake timers): a skipped scan is NOT retried immediately — only after the backoff delay elapses; repeated skips do not stack extra timers.
2. Run verifier (expect fail)
3. Replace `setTimeout(..., 0)` at `watch-manager.ts:538` with a named backoff constant (5–30 s); ensure only one retry timer is pending at a time.
4. Run verifier (expect pass)

### Fix 3: Type the movimientos-store row accumulators
**Linear Issue:** [ADV-360](https://linear.app/lw-claude/issue/ADV-360)
**Files:** `src/processing/storage/movimientos-store.ts` (+ test only if a type fix changes behavior)

1. Change `const rows: any[]` to `CellValueOrLink[][]` in `storeMovimientosBancario` and the tarjeta/broker functions if they share the pattern.
2. Run verifier full mode — zero build warnings; fix any surfaced type errors properly (no casts).

### Fix 4: Add phase field to pagada log calls
**Linear Issue:** [ADV-361](https://linear.app/lw-claude/issue/ADV-361)
**Files:** `src/bank/match-movimientos.ts` (+ tests if they assert log args)

1. Add `phase` to the `logError` at `:1301` and `warn` at `:1339`, matching the file's existing phase naming.
2. Run verifier (expect pass).

### Fix 5: Header-derived carry-forward indices
**Linear Issue:** [ADV-362](https://linear.app/lw-claude/issue/ADV-362)
**Files:** `src/processing/storage/factura-store.ts`, `pago-store.ts`, `recibo-store.ts` + colocated tests

1. Write tests: carry-forward still preserves MANUAL lock + pagada with the current schema; a sheet whose header row is missing an expected column → store returns `ok:false` (loud failure) instead of carrying wrong cells.
2. Run verifier (expect fail)
3. Derive the match-column indices from the header row already fetched by `findRowByFileId` (or the canonical constants in `spreadsheet-headers.ts`), replacing the hardcoded literals in all three stores.
4. Run verifier (expect pass)

### Post-Implementation Checklist

1. `bug-hunter` — review git changes, fix any issues found
2. `verifier` (full mode) — all tests pass, lint clean, zero warnings

---

## Iteration 2

**Implemented:** 2026-06-12
**Method:** Agent team (2 workers, worktree-isolated)

### Tasks Completed This Iteration
- Fix 1 (ADV-358): `findRowByFileId` three-state result (`found:true | found:false | error`) in all four stores — Sheets read failure now propagates as `ok:false` (no append, no update) instead of failing open into the new-document path; empty/header-only sheets still treated as not-found (worker-1)
- Fix 2 (ADV-359): deferred-scan retry backoff — `setTimeout(0)` replaced with `DEFERRED_SCAN_RETRY_DELAY_MS = 10_000` plus a single-pending-timer guard (`deferredScanRetryTimer`), cleared in `shutdownWatchManager`; fake-timer tests prove no immediate retry and no stacked timers (worker-2)
- Fix 3 (ADV-360): movimientos-store row accumulators typed `CellValueOrLink[][]` instead of `any[]` (worker-1)
- Fix 4 (ADV-361): `phase: 'pagada-sync'` / `phase: 'pagada-revert'` added to the two ADV-320 pagada log calls in match-movimientos.ts (worker-2)
- Fix 5 (ADV-362): carry-forward column indices in factura/pago/recibo stores derived from the sheet header row via `buildHeaderIndex` (header drift now fails loudly with `ok:false`); retencion-store intentionally excluded per issue scope (worker-1)

### Files Modified
- `src/processing/storage/factura-store.ts` (+test) - three-state findRowByFileId, header-derived carry-forward
- `src/processing/storage/pago-store.ts` (+test) - same
- `src/processing/storage/recibo-store.ts` (+test) - same
- `src/processing/storage/retencion-store.ts` (+test) - three-state findRowByFileId (error propagation only)
- `src/processing/storage/movimientos-store.ts` - typed row accumulators
- `src/services/watch-manager.ts` (+test) - retry backoff + timer guard
- `src/bank/match-movimientos.ts` - phase log fields

### Linear Updates
- ADV-358, ADV-359, ADV-360, ADV-361, ADV-362: Todo → In Progress → Review (real-time per worker report)
- Worker labels applied: ADV-358/360/362 → "Worker 1"; ADV-359/361 → "Worker 2"

### Pre-commit Verification
- bug-hunter: Found 1 LOW bug (missing `hasCuitMatch` assertion in the new factura MANUAL-lock test — implementation correct, test coverage incomplete), fixed by lead
- verifier (full mode): All tests pass (2774), lint clean, zero build warnings

### Work Partition
- Worker 1: storage domain — Fix 1 (ADV-358), Fix 3 (ADV-360), Fix 5 (ADV-362)
- Worker 2: reliability/logging — Fix 2 (ADV-359), Fix 4 (ADV-361)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: merged via ort strategy, no conflicts; typecheck gate clean

### Continuation Status
All tasks completed.
