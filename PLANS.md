# Implementation Plan

**Created:** 2026-05-08
**Source:** Inline request: "Envío a Contadores" delivery package — Dashboard menu operation that gathers all resumen PDFs (banks, cards, brokers) and a per-month per-bank movimientos workbook into a flat `Entregas/` Drive folder for a chosen period or range.
**Linear Issues:** [ADV-228](https://linear.app/lw-claude/issue/ADV-228/envio-a-contadores-period-range-parser), [ADV-229](https://linear.app/lw-claude/issue/ADV-229/envio-a-contadores-enumerate-resumenes-for-period-range), [ADV-230](https://linear.app/lw-claude/issue/ADV-230/envio-a-contadores-enumerate-movimientos-for-period-range), [ADV-231](https://linear.app/lw-claude/issue/ADV-231/envio-a-contadores-drive-copyfile-helper), [ADV-232](https://linear.app/lw-claude/issue/ADV-232/envio-a-contadores-prepare-delivery-folder-create-or-clear), [ADV-233](https://linear.app/lw-claude/issue/ADV-233/envio-a-contadores-copy-pdfs-to-delivery-folder), [ADV-234](https://linear.app/lw-claude/issue/ADV-234/envio-a-contadores-build-movimientos-workbook), [ADV-235](https://linear.app/lw-claude/issue/ADV-235/envio-a-contadores-delivery-routes-plan-copy-pdfs-build-movimientos), [ADV-236](https://linear.app/lw-claude/issue/ADV-236/envio-a-contadores-apps-script-menu-integration-with-progress-toasts)
**Branch:** feat/envio-a-contadores

## Context Gathered

### Codebase Analysis

- **Apps Script menu** is defined in `apps-script/src/main.ts:39-48` as `createMenu()`. Menu items map to exported handlers and must be registered in the STUBS array in `apps-script/build.js:152-161`. All current items are zero-input — no existing modal/HTML pattern. Backend calls go through `makeApiCall()` (`main.ts:112-189`) using Bearer auth + JSON body, with `ui.alert()` for feedback.
- **Movimientos sheets** live one-per-bank-account in `{YYYY}/Bancos/{Bank Account}/Movimientos - …`. Each spreadsheet has one tab per month named `YYYY-MM`. Schema is `MOVIMIENTOS_BANCARIO_SHEET` in `src/constants/spreadsheet-headers.ts:230-250` — 9 columns (`fecha`, `concepto`, `debito`, `credito`, `saldo`, `saldoCalculado`, `matchedFileId`, `matchedType`, `detalle`). Discovery via `discoverMovimientosSpreadsheets(rootId)` in `src/services/folder-structure.ts:723-820`. Reading via `readMovimientosForPeriod(spreadsheetId, "YYYY-MM")` in `src/services/movimientos-reader.ts:150-202` — already filters out SALDO INICIAL/FINAL via `isSpecialRow()` (`movimientos-reader.ts:16-34`).
- **Resumen PDFs** are filed under `{YYYY}/Bancos/{Account|Card|Broker folder}/` with filenames pre-prefixed with `YYYY-MM`. Three Control sheets track them with `periodo` (column A) and `fileId` (column D): `CONTROL_RESUMENES_BANCARIO_SHEET` (12 cols A:L), `CONTROL_RESUMENES_TARJETA_SHEET` (10 cols A:J), `CONTROL_RESUMENES_BROKER_SHEET` (9 cols A:I), all in `src/constants/spreadsheet-headers.ts`.
- **Drive service** (`src/services/drive.ts`) exposes `createFolder()`, `moveFile()`, `getParents()`, `listFilesInFolder()`, `findByName()`. **No `copyFile()` helper exists** — must add a wrapper around `drive.files.copy`. Same module hosts the `withQuotaRetry()` pattern used everywhere for Drive/Sheets calls.
- **Sheets service** (`src/services/sheets.ts`) exposes `createSheet()` for new tabs, `appendRowsWithFormatting()` for typed rows (`CellDate`, `CellNumber`), `formatSheet()` for column number formats and frozen header rows, `getValues()` for reads, `batchUpdate()` for bulk writes.
- **Routes** (`src/routes/scan.ts`) follow the Fastify async-handler shape with `{ onRequest: authMiddleware }`, body schema validation, JSON return, and error responses through `respond500`/`respond503`.
- **Logger** (`src/utils/logger.ts`) is Pino with `{module, phase, ...}` context.
- **Result<T,E>** is used everywhere for fallible operations.
- **Test conventions**: Vitest, tests colocated as `*.test.ts`, fake CUITs from CLAUDE.md TESTING section.

### MCP Context

- **Linear MCP:** confirmed connected. Team: `ADVA Administracion`. Labels include `Feature`, `Improvement`, `Bug`. No related issues exist for "entrega" / "contadores" / "delivery".
- **Drive / Gemini / Railway MCPs:** not consulted — codebase already exposes the right helpers; no document-content investigation required.

### Cross-cutting Requirements Sweep

| Pattern in plan | Required spec | Where addressed |
|-----------------|---------------|-----------------|
| Google API calls (Drive, Sheets) | Wrap in existing `withQuotaRetry()` for rate-limit handling | Tasks 4, 5, 6, 7 (each notes the wrapper) |
| Error messages exposed in API responses | Spanish-language generic message in body, raw error logged via Pino at `error` | Task 8 |
| Async ops triggered by HTTP request | Concurrency design | Task 8: documented as "no lock acquired — operation reads as snapshot, writes only into the new Entregas/ subtree" |
| Write ops to Drive (folder + PDFs + spreadsheet) | Atomicity / retry semantics | Task 5 (delete-then-create, idempotent on retry); Task 6/7 (re-running clears prior partial state) |
| Repeated triggers (re-delivery same period) | Idempotency via overwrite | Task 5: existing folder contents deleted before re-populating |

No Gemini API calls; no migrations to existing spreadsheet schemas (purely additive); no env var changes.

## Tasks

### Task 1: Period range parser

**Linear Issue:** [ADV-228](https://linear.app/lw-claude/issue/ADV-228/envio-a-contadores-period-range-parser)

**Files:**
- `src/services/delivery-package.ts` (create — first contributor; later tasks extend it)
- `src/services/delivery-package.test.ts` (create)

**Specification:**

Add `parsePeriodRange(input: string): Result<{from: string, to: string}, Error>`. Accepts `YYYY-MM` (single month) or `YYYY-MM..YYYY-MM` (range). Single month yields `from === to`. Whitespace not tolerated (no leading/trailing/internal whitespace inside the period token). Year must be 2000–2100 inclusive. Month must be 01–12. Range must satisfy `to >= from` (lexicographic compare on `YYYY-MM` is sufficient). All error cases return `Result.err` with a Spanish-language message intended to be surfaced verbatim to the user.

**Steps:**
1. Write tests in `src/services/delivery-package.test.ts` for `parsePeriodRange`:
   - Valid single month `'2025-01'` → `{from: '2025-01', to: '2025-01'}`.
   - Valid range `'2025-01..2025-03'` → `{from: '2025-01', to: '2025-03'}`.
   - Range crossing year boundary `'2024-11..2025-02'` accepted.
   - Invalid format (missing month, wrong separator like `'-'` or `' to '`, extra spaces) → `Result.err`.
   - Invalid month (`'2025-00'`, `'2025-13'`) → `Result.err`.
   - Invalid year (3-digit, `'9999-01'`) → `Result.err`.
   - Inverted range (`'2025-03..2025-01'`) → `Result.err` with Spanish message.
   - Empty / whitespace-only input → `Result.err`.
2. Run verifier (expect fail).
3. Implement `parsePeriodRange` using a strict regex `^(\d{4})-(\d{2})(\.\.(\d{4})-(\d{2}))?$`.
4. Run verifier (expect pass).

**Notes:**
- Mirror error-construction style from existing parsing helpers in `src/utils/date.ts`.
- Spanish error messages will be surfaced through the route → Apps Script alert, so they must be user-facing quality.

---

### Task 2: Enumerate resumenes for period range

**Linear Issue:** [ADV-229](https://linear.app/lw-claude/issue/ADV-229/envio-a-contadores-enumerate-resumenes-for-period-range)

**Files:**
- `src/services/delivery-package.ts` (modify)
- `src/services/delivery-package.test.ts` (modify)

**Specification:**

Add `enumerateResumenes(from: string, to: string, controlResumenesId: string): Promise<Result<ResumenScopeItem[], Error>>` where `ResumenScopeItem = { fileId, fileName, type: 'bancario' | 'tarjeta' | 'broker', periodo }`. Reads the three Control de Resumenes tabs (names taken from the schema constants in `src/constants/spreadsheet-headers.ts` — do NOT hardcode tab names in this file), uses header-based column lookup (pattern in `match-movimientos.ts:281-310`), filters rows where `from <= periodo <= to`, and aggregates results across all three types into a single array.

**Steps:**
1. Write tests for `enumerateResumenes` mocking `getValues()` for the three tabs:
   - Empty sheets → empty array.
   - Periods inside range included; outside range excluded (boundary inclusive on both ends).
   - Header row skipped via header-based column lookup (not row-index assumptions).
   - Mixed-type rows aggregated correctly (one bancario + two tarjetas + one broker → 4 items with correct `type`).
   - Single-month range (`from === to`) returns only that period.
   - Drive read failure on any one sheet → `Result.err` (do not return partial data on error).
2. Run verifier (expect fail).
3. Implement `enumerateResumenes` reading the three tabs in parallel via `Promise.all`, projecting `(periodo, fileId, fileName, type)`, filtering by range.
4. Run verifier (expect pass).

**Notes:**
- The caller (Task 8 route) supplies `controlResumenesId` from the same folder-discovery path scan/match routes already use. Do not re-discover here.

---

### Task 3: Enumerate movimientos for period range

**Linear Issue:** [ADV-230](https://linear.app/lw-claude/issue/ADV-230/envio-a-contadores-enumerate-movimientos-for-period-range)

**Files:**
- `src/services/delivery-package.ts` (modify)
- `src/services/delivery-package.test.ts` (modify)

**Specification:**

Add `enumerateMovimientos(from: string, to: string, rootFolderId: string): Promise<Result<MovimientoScopeItem[], Error>>` where `MovimientoScopeItem = { spreadsheetId, sheetName: 'YYYY-MM', banco, numeroCuenta, moneda }`. This task only enumerates scope; reading rows happens in Task 7.

**Steps:**
1. Write tests for `enumerateMovimientos`:
   - Mock `discoverMovimientosSpreadsheets()` returning two accounts across two years.
   - Range crossing year boundary (`'2024-11..2025-02'`) walks both year folders.
   - For each account, only months in `[from, to]` are emitted (boundary inclusive).
   - Months without a corresponding tab in the source spreadsheet are silently skipped (not an error).
   - Single-month range yields one tab per account that has data.
   - One source spreadsheet's tab-list lookup fails → that account's entries are skipped (logged at `warn`); other accounts proceed; overall result is `Result.ok`.
2. Run verifier (expect fail).
3. Implement: build month list `[from..to]`, call `discoverMovimientosSpreadsheets(rootFolderId)`, for each `(year:account)` parse `banco / numeroCuenta / moneda` from the discovery key (`"{year}:{banco} {numeroCuenta} {moneda}"`), fetch the spreadsheet's tab list (reuse the YYYY-MM filter pattern from `getRecentMovimientoSheets` in `movimientos-reader.ts:112-141`), intersect with the month list, emit one item per intersection.
4. Run verifier (expect pass).

**Notes:**
- Reuse `discoverMovimientosSpreadsheets()` and the `^\d{4}-\d{2}$` tab-name pattern. Do not duplicate folder-traversal logic here.

---

### Task 4: Drive copyFile helper

**Linear Issue:** [ADV-231](https://linear.app/lw-claude/issue/ADV-231/envio-a-contadores-drive-copyfile-helper)

**Files:**
- `src/services/drive.ts` (modify — append helper)
- `src/services/drive.test.ts` (modify if it exists; otherwise create)

**Specification:**

Add `copyFile(fileId: string, parentFolderId: string, name?: string): Promise<Result<DriveFileInfo, Error>>` wrapping `drive.files.copy({ fileId, requestBody: { parents: [parentFolderId], name? } })`. Mirror error-handling and logging conventions from `moveFile` (`src/services/drive.ts:834-874`). Wrap the call in `withQuotaRetry()`.

**Steps:**
1. Write tests for `copyFile`:
   - Successful copy returns `Result.ok` with `{ id, name, mimeType }`.
   - Optional `name` parameter renames the copy.
   - Missing source fileId → `Result.err`.
   - Quota error path triggers `withQuotaRetry` retry behaviour (mock the same retry semantics other tests use).
   - Drive API error → `Result.err` with sanitized message.
2. Run verifier (expect fail).
3. Implement `copyFile` using the standard `googleapis` Drive client method.
4. Run verifier (expect pass).

**Notes:**
- Use `module: 'drive'`, `phase: 'copy-file'` for logging.

---

### Task 5: Prepare delivery folder (create-or-clear)

**Linear Issue:** [ADV-232](https://linear.app/lw-claude/issue/ADV-232/envio-a-contadores-prepare-delivery-folder-create-or-clear)

**Files:**
- `src/services/delivery-package.ts` (modify)
- `src/services/delivery-package.test.ts` (modify)

**Specification:**

Add `prepareDeliveryFolder(rootFolderId: string, periodLabel: string, deliveryDate: Date): Promise<Result<{folderId: string, folderUrl: string, isReuse: boolean}, Error>>`. Also add a pure helper `formatDeliveryFolderName({from, to, deliveryDate}): string` so the route's plan-only response can show the prospective folder name without creating anything.

Folder naming:
- Single month (`from === to`): `"YYYY-MM (entregado YYYY-MM-DD)"` — e.g. `"2025-01 (entregado 2025-05-08)"`.
- Range: `"YYYY-MM al YYYY-MM (entregado YYYY-MM-DD)"`.

Folder URL format: `https://drive.google.com/drive/folders/{folderId}`.

**Steps:**
1. Write tests:
   - `formatDeliveryFolderName` produces both single-month and range forms correctly.
   - First-time delivery: creates `Entregas/` if missing, then creates the period folder inside; returns `isReuse: false`.
   - Second-time delivery to same period: finds existing folder, deletes its contents (PDFs + spreadsheet + any other), returns same folderId; `isReuse: true`.
   - Delete-contents step uses `listFilesInFolder` + per-file delete; the delivery folder itself is NOT deleted, only its contents.
   - `Entregas/` already exists → reused, not duplicated.
   - Drive error during create or delete → `Result.err` (do not leave partial state silently).
2. Run verifier (expect fail).
3. Implement using `findByName` to locate `Entregas/` and the period folder, `createFolder` for new ones, `listFilesInFolder` + Drive `files.delete` for cleanup.
4. Run verifier (expect pass).

**Notes:**
- Use `module: 'delivery'`, `phase: 'prepare-folder'`.

---

### Task 6: Copy PDFs to delivery folder

**Linear Issue:** [ADV-233](https://linear.app/lw-claude/issue/ADV-233/envio-a-contadores-copy-pdfs-to-delivery-folder)

**Files:**
- `src/services/delivery-package.ts` (modify)
- `src/services/delivery-package.test.ts` (modify)

**Specification:**

Add `copyPdfsToDelivery(folderId: string, scope: ResumenScopeItem[]): Promise<Result<{copied: number, failed: Array<{fileId: string, error: string}>}, Error>>`. Iterates the scope sequentially, copying each PDF via `copyFile()`. Sequential iteration is intentional — gentler on Drive quota and easier to reason about. Per-PDF failures are accumulated into `failed`, not thrown — the caller decides whether to escalate.

**Steps:**
1. Write tests:
   - Empty scope → `{copied: 0, failed: []}`, overall `Result.ok`.
   - All copies succeed → `{copied: N, failed: []}`.
   - One copy fails → `failed` contains it, others still complete, overall `Result.ok`.
   - All copies fail → still `Result.ok` with `failed.length === N` (route layer logs + decides response).
2. Run verifier (expect fail).
3. Implement using `copyFile`. Log per-PDF at `debug` (`module: 'delivery'`, `phase: 'copy-pdfs'`), totals at `info`.
4. Run verifier (expect pass).

---

### Task 7: Build movimientos workbook

**Linear Issue:** [ADV-234](https://linear.app/lw-claude/issue/ADV-234/envio-a-contadores-build-movimientos-workbook)

**Files:**
- `src/services/delivery-package.ts` (modify)
- `src/services/delivery-package.test.ts` (modify)

**Specification:**

Add `buildMovimientosWorkbook(folderId: string, scope: MovimientoScopeItem[]): Promise<Result<{workbookId: string, workbookUrl: string, tabCount: number}, Error>>`. Creates a Google Sheets file named `Movimientos` inside the delivery folder via `drive.files.create` with mimeType `application/vnd.google-apps.spreadsheet`. For each scope item, reads the source month's rows via `readMovimientosForPeriod()` (which already filters SALDO INICIAL/FINAL), projects six columns (`fecha`, `concepto`, `debito`, `credito`, `saldo`, `detalle` — `saldo` is the parsed PDF value, NOT `saldoCalculado`), creates a tab named `YYYY-MM {banco} {numeroCuenta} {moneda}` (month-major so tabs sort lexicographically), writes the rows with `CellDate` for `fecha` and `CellNumber` for `debito`/`credito`/`saldo`, and freezes the header row. After all real tabs are added, deletes the default tab via `sheets.spreadsheets.batchUpdate({ deleteSheet })`. Workbook URL format: `https://docs.google.com/spreadsheets/d/{id}/edit`.

Empty-scope handling: a Google Sheets file cannot have zero tabs. When `scope` is empty, leave the default tab in place (rename it to `Sin Movimientos` and include only the six headers as a placeholder). Return `tabCount: 0`.

**Steps:**
1. Write tests:
   - Empty scope → workbook is created with one placeholder tab `Sin Movimientos` containing only the six headers; `tabCount: 0`.
   - One scope item → workbook with one tab named correctly, six columns, header row frozen, types `CellDate` / `CellNumber` / string applied per column. Default tab deleted.
   - Multiple items across months → tabs sort lexicographically (month-major).
   - Source has only SALDO rows → tab created with header row only (zero data rows).
   - Source `readMovimientosForPeriod` returns `Result.err` for one tab → that tab is skipped, error logged at `warn`, others still written, overall `Result.ok`.
2. Run verifier (expect fail).
3. Implement using `drive.files.create` for the spreadsheet, then `createSheet` + `appendRowsWithFormatting` + `formatSheet` (with `frozenRows: 1` and per-column number formats) for each tab. Use `sheets.spreadsheets.batchUpdate({ deleteSheet })` to remove the default tab.
4. Run verifier (expect pass).

**Notes:**
- `module: 'delivery'`, `phase: 'build-movimientos'`.
- Source detalle is column I (index 8) in `MOVIMIENTOS_BANCARIO_SHEET`; project to position 6 (zero-indexed 5) in the output.
- Tabs read sequentially to avoid bursting Sheets quota; revisit only if performance demands it.

---

### Task 8: Delivery routes

**Linear Issue:** [ADV-235](https://linear.app/lw-claude/issue/ADV-235/envio-a-contadores-delivery-routes-plan-copy-pdfs-build-movimientos)

**Files:**
- `src/routes/delivery.ts` (create)
- `src/routes/delivery.test.ts` (create)
- `src/server.ts` (modify — register the new route module)

**Specification:**

Three Fastify routes, all protected with `{ onRequest: authMiddleware }`. Each route is independent and idempotent on retry (recomputes scope from `period`):

- `POST /api/delivery/plan` — body `{ period: string }`. Calls `parsePeriodRange`, `enumerateResumenes`, `enumerateMovimientos`, `formatDeliveryFolderName`. Returns `{ folderName, pdfCount, movimientosTabCount, periodLabel }`. Read-only — no Drive mutations.
- `POST /api/delivery/copy-pdfs` — body `{ period: string }`. Calls `parsePeriodRange` + `enumerateResumenes` + `prepareDeliveryFolder` + `copyPdfsToDelivery`. Returns `{ folderId, folderUrl, copied, failed }`.
- `POST /api/delivery/build-movimientos` — body `{ period: string, folderId: string }`. Calls `parsePeriodRange` + `enumerateMovimientos` + `buildMovimientosWorkbook`. Returns `{ workbookUrl, tabCount }`.

Error responses are sanitized: Spanish-language generic message in the body (`error`, optionally `details` for parse errors that already produce user-facing strings); raw error logged via Pino at `error` level with `module: 'delivery'`.

**Steps:**
1. Write tests for the three routes:
   - Invalid period → 400 with the Spanish message from `parsePeriodRange`.
   - Auth missing → 401.
   - Downstream service error → 500 with sanitized message; raw error appears in Pino mock at `error` level.
   - Happy-path response shapes match spec for each endpoint.
2. Run verifier (expect fail).
3. Implement using existing patterns from `src/routes/scan.ts`: schema-validate request bodies, use `respond500`/`respond503` helpers if present, register under `/api` prefix in `src/server.ts`. Look up `controlResumenesId` and `rootFolderId` via the same lookup scan/match routes use.
4. Run verifier (expect pass).

**Notes:**
- No `withLock` acquired — documented in Architecture rationale: read-only against existing data, writes only to a new `Entregas/` subtree.

---

### Task 9: Apps Script integration

**Linear Issue:** [ADV-236](https://linear.app/lw-claude/issue/ADV-236/envio-a-contadores-apps-script-menu-integration-with-progress-toasts)

**Files:**
- `apps-script/src/main.ts` (modify)
- `apps-script/build.js` (modify — STUBS array)

**Specification:**

Add an exported `triggerEnvioContadores()` and a menu entry `📦 Envío a Contadores`. Use the user's documented progress UX:
- Long-timeout in-progress toasts (300s) replace each other as work advances.
- Final short-timeout toast `Listo.` (3s) clears any lingering long toast.
- Modal alert `✅ Entrega lista` after the Done toast, summarizing folder name, counts, and folder URL.

Flow inside `triggerEnvioContadores()`:
1. `validateConfig()`.
2. `ui.prompt('Período de entrega', 'YYYY-MM para un mes, o YYYY-MM..YYYY-MM para un rango.', ButtonSet.OK_CANCEL)`. Cancel → return silently.
3. Client-side validate with regex `^\d{4}-\d{2}(\.\.\d{4}-\d{2})?$`. Mismatch → error alert + return.
4. Toast `Preparando entrega para {periodo}...` (long).
5. `POST /api/delivery/plan` → read `pdfCount`, `movimientosTabCount`, `folderName`.
6. Toast `Encontrados {N} PDFs y {M} hojas. Copiando PDFs...` (long).
7. `POST /api/delivery/copy-pdfs` → read `folderId`, `folderUrl`, `copied`, `failed`.
8. Toast `PDFs copiados ({copied}). Generando movimientos...` (long).
9. `POST /api/delivery/build-movimientos` (with `folderId` from step 7) → read `workbookUrl`, `tabCount`.
10. Toast `Listo.` (short).
11. Modal alert with summary.

Add helpers:
- `progressToast(msg)` — `SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Envío a Contadores', 300)`.
- `doneToast()` — `SpreadsheetApp.getActiveSpreadsheet().toast('Listo.', 'Envío a Contadores', 3)`.

Menu insertion: in `createMenu()` at `main.ts:39-48`, after `📝 Completar Detalles de Movimientos` and before the existing `addSeparator()`. Build stubs: append `{ exposed: 'triggerEnvioContadores', topLevel: 'triggerEnvioContadores' }` to STUBS in `apps-script/build.js:152-161`.

**Steps:**
1. Implement helpers, the trigger function, the menu item, and the STUB.
2. Run verifier — confirms the Apps Script TS bundle compiles with zero warnings.

**Notes:**
- No unit tests for Apps Script — verifier runs the bundled-build path which `tsc`-checks `apps-script/src/`. Behaviour is exercised via the manual end-to-end test below.
- Apps Script `UrlFetchApp.fetch` per-call timeout is 60s. With three endpoints, each call has its own budget. Document the limit in a brief code comment if the build step is at risk for very long ranges.
- On any HTTP error from a step: surface the backend's Spanish message via `ui.alert('⚠️ Error de la API', ...)`. If `copy-pdfs` returns a non-empty `failed` array, include that count in the final summary alert.

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review changes for bugs.
2. Run `verifier` agent — Verify all tests pass and zero warnings.

---

## Plan Summary

**Objective:** Add a Dashboard menu operation `📦 Envío a Contadores` that, given a single month or month range, assembles all resumen PDFs (banks + cards + brokers) plus a per-month per-bank movimientos workbook into a flat `Entregas/{periodLabel} (entregado YYYY-MM-DD)/` Drive folder, ready for the user to download and email to the accounting team.

**Linear Issues:** ADV-228, ADV-229, ADV-230, ADV-231, ADV-232, ADV-233, ADV-234, ADV-235, ADV-236

**Approach:** Three new Fastify endpoints (`plan`, `copy-pdfs`, `build-movimientos`) backed by a new `delivery-package` service that filters Control de Resumenes rows by `periodo`, walks `discoverMovimientosSpreadsheets()` for the in-range months, copies PDFs via a new `drive.files.copy` wrapper, and assembles a 6-column movimientos workbook with one tab per `(month, bank-account)`. Apps Script side adds a single text prompt with regex validation, calls the three endpoints sequentially, and surfaces progress via long-timeout toasts that replace each other, ending with a short `Listo` toast and a summary modal.

**Scope:** 9 tasks; ~4 new source files (`src/services/delivery-package.ts` + test, `src/routes/delivery.ts` + test); ~4 modified files (`src/services/drive.ts` + test, `src/server.ts`, `apps-script/src/main.ts`, `apps-script/build.js`); ~30+ tests covering parsing, enumeration, folder prep, copy, workbook assembly, and route shape.

**Key Decisions:**
- Three endpoints, not one, so Apps Script can post progress toasts between phases (each call ≤ 60s timeout).
- No concurrency lock — operation is read-only against existing data and writes only into the new `Entregas/` subtree.
- Re-delivery is overwrite (delete existing folder contents, reuse folder), no prompt.
- Flat folder layout (no subfolders) — user downloads everything to email.
- Movimientos workbook tab naming is month-major (`YYYY-MM {banco} {cuenta} {moneda}`) for chronological scan.
- `saldo` column projects the parsed PDF value (column E), not `saldoCalculado`.
- New `copyFile()` helper in `drive.ts`; rest of Drive/Sheets work uses existing helpers.
- Empty-scope movimientos workbook keeps the default tab as `Sin Movimientos` placeholder (Sheets cannot have zero tabs).

**Risks:**
- Very large ranges (year-plus, many accounts) may approach Apps Script's 60s `UrlFetchApp` timeout on the `build-movimientos` step. Initial cut accepts this; chunking can be added if observed in practice.
- `drive.files.copy` quota: each copy is a single API call. For typical quarter-scale deliveries (≤30 PDFs) this is well under quota; sequential iteration is intentionally quota-gentle.
- User-placed files inside a re-used delivery folder are deleted on overwrite. Documented as "the folder is owned by the operation."
