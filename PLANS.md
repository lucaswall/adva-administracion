# Implementation Plan

**Status:** IN_PROGRESS
**Created:** 2026-06-12
**Source:** Inline request: Mercadopago payments ingestion via API — monthly server process with manual trigger endpoint, idempotent; builds "Mercado Pago {collectorId} ARS" Movimientos workbook with monthly tabs (gross credit + fee debit rows) and resumen rows; matching to facturas emitidas via CUIT with CUIT↔DNI equivalence and an MP-specific forward date window.
**Linear Issues:** [ADV-365](https://linear.app/lw-claude/issue/ADV-365/mercadopago-api-client-with-pagination-timeout-and-429-backoff), [ADV-366](https://linear.app/lw-claude/issue/ADV-366/transform-mp-payments-into-movimientobancario-rows-gross-credit-fee), [ADV-367](https://linear.app/lw-claude/issue/ADV-367/idempotent-mp-movimientos-writer-incremental-month-tab-appends), [ADV-368](https://linear.app/lw-claude/issue/ADV-368/mp-resumen-row-for-closed-periods-synthetic-running-balance), [ADV-369](https://linear.app/lw-claude/issue/ADV-369/mp-sync-orchestrator-with-processing-lock-and-match-auto-trigger), [ADV-370](https://linear.app/lw-claude/issue/ADV-370/post-apimp-sync-route-manual-trigger), [ADV-371](https://linear.app/lw-claude/issue/ADV-371/mp-monthly-cron-boot-time-catch-up-scheduler), [ADV-372](https://linear.app/lw-claude/issue/ADV-372/matcher-cuitdni-equivalence-in-identity-comparisons), [ADV-373](https://linear.app/lw-claude/issue/ADV-373/matcher-mp-specific-forward-factura-date-window-25-days), [ADV-374](https://linear.app/lw-claude/issue/ADV-374/mp-ingestion-documentation-claudemd-spreadsheet-formatmd-envexample), [ADV-375](https://linear.app/lw-claude/issue/ADV-375/delivery-copy-pdfs-skip-non-pdf-resumen-fileids-mp-spreadsheet-backed)
**Branch:** feat/mercadopago-sync

## Context Gathered

### Codebase Analysis

- **Folder/workbook provisioning is fully reusable:** `getOrCreateBankAccountFolder(year, banco, numeroCuenta, moneda)` (`src/services/folder-structure.ts:1353-1468`) creates `{year}/Bancos/{banco} {numeroCuenta} {moneda}/`; `getOrCreateMovimientosSpreadsheet(folderId, year, folderName, 'bancario')` (`:1942-2006`) creates `Movimientos - {folderName}`; `getOrCreateBankAccountSpreadsheet` (`:1717-1788`) creates `Control de Resumenes` with `CONTROL_RESUMENES_BANCARIO_SHEET` headers. All cached in `cachedStructure` maps and guarded by `withLock`.
- **Movimientos writing:** `storeMovimientosBancario(movimientos, spreadsheetId, period, saldoInicial, sheetOrderBatch?)` (`src/processing/storage/movimientos-store.ts:28-156`) is scanner-independent, handles non-empty tabs via row-offset (ADV-322, reads `{month}!A:A` first), builds rows with `generateMovimientoRowWithFormula`/`generateInitialBalanceRow`/`generateFinalBalanceRow` (`src/utils/balance-formulas.ts`), appends via `appendRowsWithLinks` (ADV-242 per-sheet lock inside). It writes SALDO INICIAL + transactions + SALDO FINAL in one batch — **not directly usable for incremental mid-month appends** (SALDO FINAL would land mid-tab); the MP writer needs an incremental variant reusing the same primitives.
- **Resumen writing:** `storeResumenBancario(resumen, spreadsheetId, context?)` (`src/processing/storage/resumen-store.ts:173-304`) — append + dedupe on `(banco, numeroCuenta, fechaDesde, fechaHasta, moneda)`; builds `balanceOk` formula via `generateBalanceOkFormulaLocal` and `balanceDiff` via `calculateBalanceDiff`; fileName hyperlink built from `fileId` as `https://drive.google.com/file/d/{fileId}/view`.
- **Matching discovery:** `discoverMovimientosSpreadsheets(rootId)` (`src/bank/match-movimientos.ts:779-887`) maps `{year}:{folderName} → spreadsheetId`; `readMovimientosForPeriod` (`src/services/movimientos-reader.ts:154-201`) reads rows, `isBankMovimientosHeader` (`:54-58`) schema-gates sheets, `isSpecialRow` skips SALDO INICIAL/FINAL. An MP workbook with the standard 9-col bancario schema is matched automatically.
- **Credit matching:** `matchMovement` in `src/bank/matcher.ts` extracts concepto identity via `extractCuitFromText` (`src/utils/validation.ts:473-507`, handles "CUIT"/"CUIL" prefixes and checksum validation), filters ADVA CUITs, then hard-filters candidates by **strict string equality** (`matcher.ts:391` style comparisons). `cuitOrDniMatch(id1, id2)` already exists (`validation.ts:207-232`) handling CUIT↔DNI equivalence — the matcher simply doesn't use it yet. Date windows: `FACTURA_DATE_RANGE_BEFORE = 5`, `FACTURA_DATE_RANGE_AFTER = 30` (`matcher.ts:35-36`); the matcher has **no account context** today.
- **Scheduling infra:** `node-cron` already used in `src/services/watch-manager.ts` (`cron.schedule`, init in `initWatchManager`). Scan auto-triggers `matchAllMovimientos` via `triggerMatchAsync` after success. Routes follow `server.post('/...', { onRequest: authMiddleware }, handler)` with `/api` prefix; scan/match share `PROCESSING_LOCK_ID` with `PROCESSING_LOCK_TIMEOUT_MS` (5 min wait) and `PROCESSING_LOCK_EXPIRY_MS` (15 min expiry) from `src/config.ts`.
- **Outbound HTTP pattern:** `src/utils/exchange-rate.ts:164-259` — `fetch` + `AbortController` timeout (`EXCHANGE_RATE_TIMEOUT_MS`), Result error paths, in-memory cache; config constants + `validateNumericEnv` pattern in `src/config.ts`.
- **Test conventions:** Vitest colocated `*.test.ts`; `vi.mock` of `sheets.js`/`logger.js`/`concurrency.js` (transparent `withLock`); route tests via Fastify `inject` with `authorization: Bearer` header (`src/routes/scan.test.ts`); fake CUITs `20123456786`, `27234567891`, `20111111119`; real-timer describe blocks touching quota paths call `quotaThrottle.reset()` in `beforeEach`.

### MCP Context

- **MCPs used:** Linear (team "ADVA Administracion" verified); Google Drive/Sheets (production Control de Ingresos read for match dry-run); live Mercadopago API probe with the user's production access token.
- **Findings (empirically verified against production data, 2026-06-12):**
  - `GET /v1/payments/search?range=date_approved&begin_date=...&end_date=...&sort=date_approved&criteria=asc&limit=50` with `Authorization: Bearer {MP_ACCESS_TOKEN}` returned all 23 May-2026 approved payments (cross-checked against the MP settlement xlsx).
  - **Every payment on every rail (account_money, credit_card, debit_card) carries `payer.identification` with a real CUIT/CUIL.** Card payments additionally carry `card.cardholder.identification` (DNI).
  - Fee math: `fee_details` sums only `mercadopago_fee` (e.g. 450); IIBB withholdings live in `charges_details`; **`transaction_details.net_received_amount` is the reliable net** (gross 25000 → net 23350/23975). Total deduction = `transaction_amount − net_received_amount`.
  - `date_approved` comes in **GMT-4 offset** (e.g. `2026-05-11T13:07:57.000-04:00`) — date-part extraction must convert to America/Argentina/Buenos_Aires (GMT-3) or late-evening payments land on the wrong day.
  - Dry-run matching: all 23 payments matched 1:1 to distinct facturas emitidas by CUIT+amount+date — but 9 recurring payments (charged the 25th) precede their factura (issued the 11th of the following month) by ~17 days, requiring a forward window of ~25 days; with it, 23/23. Facturas store consumidor-final receptor IDs as **DNI** (8 digits) while MP reports CUIT/CUIL (11 digits) — CUIT↔DNI equivalence is mandatory (e.g. factura `42489444` vs payer `20424894444`).
  - API limits: `limit` max 50, `offset` max 10 000, 12-month lookback, range filter `date_approved`. Rate limits undocumented — 429s must be handled with backoff.

### Scope Boundaries

**Out of scope:** MP money-out (withdrawals to bank) — `/v1/payments/search` covers collections only; the MP "saldo" columns are a synthetic running net-collected balance, not a real account balance. Refund/chargeback handling beyond flagging (`amount_refunded > 0` logs a warn; no negative rows generated). The MP release report (real saldo inicial/final) is a possible future enhancement. Backfilling months older than the 12-month API lookback.

---

## Tasks

Tasks 1-7 are sequential (each builds on the previous). Tasks 8-9 (matcher) are independent of 1-7 but Task 9 should land after Task 8 (same matcher files). Task 11 (delivery) is independent of 1-9. Task 10 (docs) last.

### Task 1: Mercadopago API client with pagination, timeout, and 429 backoff
**Linear Issue:** [ADV-365](https://linear.app/lw-claude/issue/ADV-365/mercadopago-api-client-with-pagination-timeout-and-429-backoff)
**Files:**
- `src/mercadopago/client.ts` (create)
- `src/mercadopago/client.test.ts` (create)
- `src/config.ts` (modify — `MP_ACCESS_TOKEN` env read, `MP_API_TIMEOUT_MS`, `MP_API_BASE_URL`, `MP_MAX_RETRIES` constants)

**Steps:**
1. Write tests in `src/mercadopago/client.test.ts` for `searchApprovedPayments(periodo: string)` (periodo = `YYYY-MM`):
   - Builds the correct query: `range=date_approved`, `begin_date`/`end_date` covering the periodo in `-03:00` offset (`YYYY-MM-01T00:00:00.000-03:00` to first day of next month), `sort=date_approved`, `criteria=asc`, `limit=50`, `Authorization: Bearer` header (mock global fetch).
   - Paginates with `offset` until `paging.total` is exhausted; aggregates results.
   - Filters to `status === 'approved'`; non-approved results from the API are dropped.
   - Timeout: a fetch that never resolves aborts after `MP_API_TIMEOUT_MS` and returns `ok: false` (AbortController pattern from `src/utils/exchange-rate.ts:195-196`).
   - 429 response: retries with backoff up to `MP_MAX_RETRIES`, then `ok: false`; 401 returns `ok: false` immediately (no retry) with a descriptive error.
   - Malformed JSON body → `ok: false`, no throw.
   - The access token NEVER appears in any log call (assert via logger mock).
2. Run verifier (expect fail)
3. Implement `searchApprovedPayments` in `src/mercadopago/client.ts` returning `Result<MpPayment[], Error>`. Define an `MpPayment` interface with only the consumed fields: `id`, `status`, `date_approved`, `operation_type`, `description`, `external_reference`, `currency_id`, `transaction_amount`, `transaction_details.net_received_amount`, `payer.identification.{type,number}`, `payer.email`, `card.cardholder.identification` (optional), `collector_id`, `amount_refunded`, `charges_details[]` (`name`, `type`, `amounts.{original,refunded}`, `accounts.{from,to}` — needed by Task 2 to itemize fee/tax debit rows for the accountants). Read `MP_ACCESS_TOKEN` from env in `src/config.ts` (optional — absence disables the feature, see Task 5). Follow the exchange-rate fetch pattern; log request metadata (period, page, count) at debug, never the token.
4. Run verifier (expect pass)

**Notes:**
- External HTTP: timeout `MP_API_TIMEOUT_MS = 30_000`, bounded retries with exponential backoff on 429/5xx/network errors; JSON parse errors are terminal `ok:false` (no infinite retry).
- Per-page runtime validation: results missing `id`, `date_approved`, or `transaction_amount` are skipped with a warn (AI-boundary-style defensiveness at the API boundary).

### Task 2: Transform MP payments into MovimientoBancario rows
**Linear Issue:** [ADV-366](https://linear.app/lw-claude/issue/ADV-366/transform-mp-payments-into-movimientobancario-rows-gross-credit-fee)
**Files:**
- `src/mercadopago/transform.ts` (create)
- `src/mercadopago/transform.test.ts` (create)

**Steps:**
1. Write tests for `paymentsToMovimientos(payments: MpPayment[]): { movimientos: MovimientoBancario[]; skipped: number }`:
   - An approved ARS payment (gross 25000, net 23350, payer CUIT `20123456786`, description "Unipersonal", id 158805080384, charges: `mercadopago_fee` 450, `tax_withholding_collector-debitos_creditos` 150, `tax_withholding_sirtac-caba` 425, `tax_withholding-caba` 625) produces a credit row `{ fecha: <approval date in AR timezone>, concepto: 'MP 158805080384 - CUIT 20123456786 - Unipersonal', credito: 25000, debito: null, saldo: null }` followed by ONE DEBIT ROW PER CHARGE with human-readable conceptos: `'MP 158805080384 - Comisión Mercado Pago'` (450), `'MP 158805080384 - Imp. Débitos y Créditos'` (150), `'MP 158805080384 - Retención SIRTAC CABA'` (425), `'MP 158805080384 - Retención IIBB CABA'` (625). The accountants need the comisión (expense with IVA) separated from each tax withholding (jurisdiction-specific IIBB/SIRTAC credits and Ley 25.413 credit).
   - Only charges with `accounts.from === 'collector'` produce debit rows; charge amounts are net of `amounts.refunded`.
   - Charge-name mapping: `mercadopago_fee` → `Comisión Mercado Pago`; `tax_withholding_collector-debitos_creditos` → `Imp. Débitos y Créditos`; `tax_withholding_sirtac-{jurisdiccion}` → `Retención SIRTAC {Jurisdicción}`; `tax_withholding-{jurisdiccion}` → `Retención IIBB {Jurisdicción}`; unknown names fall back to the raw name (still itemized, never dropped).
   - **Reconciliation guard:** when `Σ(charge debits) !== transaction_amount − net_received_amount` (beyond 0.01), fall back to a single combined debit row `'MP {id} - Comisiones e impuestos Mercado Pago'` for the full difference and log a warn (never let itemization drift the running balance).
   - No charges and `transaction_amount === net_received_amount` → credit row only, no debit rows.
   - CUIL identification renders as `CUIL {number}` (must remain extractable by `extractCuitFromText`).
   - Payer identification missing/empty → credit concepto omits the identity segment (no "CUIT undefined"), row still produced.
   - **Timezone edge:** `date_approved = '2026-05-31T23:15:00.000-04:00'` (= June 1 00:15 ART) yields fecha `2026-06-01`; `'2026-05-11T13:07:57.000-04:00'` yields `2026-05-11`.
   - Non-ARS `currency_id` → payment skipped, counted in `skipped`.
   - `amount_refunded > 0` → row still produced, warn logged.
   - Rows sorted by fecha ascending; deterministic order for same-day payments (by id).
2. Run verifier (expect fail)
3. Implement in `src/mercadopago/transform.ts`. Debit rows must NOT contain any payer identity (it would mis-feed the matcher's hard CUIT filter on the debit side). Use `Intl.DateTimeFormat` with `America/Argentina/Buenos_Aires` (or existing date utils) for the date conversion — never naive ISO substring.
4. Run verifier (expect pass)

**Notes:**
- Concepto format `MP {id} - ...` is the idempotency key (Task 3 dedupes on it) — the `MP <digits>` prefix is load-bearing; tests must pin it.
- Identity rendered with explicit `CUIT `/`CUIL ` prefix so `extractCuitFromText` (`validation.ts:473`) hits its prefix pattern, enabling matcher tier 2.

### Task 3: Idempotent MP movimientos writer (incremental month-tab appends)
**Linear Issue:** [ADV-367](https://linear.app/lw-claude/issue/ADV-367/idempotent-mp-movimientos-writer-incremental-month-tab-appends)
**Files:**
- `src/mercadopago/movimientos-writer.ts` (create)
- `src/mercadopago/movimientos-writer.test.ts` (create)

**Steps:**
1. Write tests for `writeMpMovimientos(spreadsheetId: string, periodo: string, movimientos: MovimientoBancario[], saldoInicialPeriodo: number): Promise<Result<{ appended: number; skippedExisting: number }, Error>>`:
   - Empty/new month tab: writes a SALDO INICIAL row (concepto `SALDO INICIAL`, saldoCalculado = `saldoInicialPeriodo` as CellNumber) followed by all movimiento rows with `generateMovimientoRowWithFormula` formulas; NO SALDO FINAL row.
   - Tab already containing SALDO INICIAL + rows for ops `MP 111`, `MP 222`: calling with ops 111, 222, 333 appends ONLY op 333's rows (credit+fee), with formula row offsets continuing the existing chain (offset derived from existing row count, ADV-322 pattern in `movimientos-store.ts:75-78`).
   - Re-running with an identical payment set appends nothing (`appended: 0`, `skippedExisting` counts them) — idempotency.
   - Dedupe key: the `MP {id}` prefix parsed from existing concepto column values; a credit row and its fee row share the op id — both are skipped together when the op id exists.
   - Sheets read failure → `ok: false` (never blind-append).
   - Month tab creation reuses the same path as `movimientos-store.ts` (headers from `MOVIMIENTOS_BANCARIO_SHEET`).
2. Run verifier (expect fail)
3. Implement reusing primitives from `src/utils/balance-formulas.ts` and the month-tab get-or-create used by `movimientos-store.ts` (extract/share a helper if needed rather than duplicating). Read existing `{periodo}!A:I` (or `B` column) to collect existing `MP {id}` keys before appending. Append via `appendRowsWithLinks` in a single batch per call.
4. Run verifier (expect pass)

**Notes:**
- Atomicity: the single `appendRowsWithLinks` call either lands or fails whole; a failure leaves prior rows intact and the next run re-derives the missing set from the sheet (idempotent recovery).
- No SALDO FINAL row is ever written to MP tabs — period close is represented by the Resumenes row (Task 4). `isSpecialRow` already protects readers.
- MANUAL matches on existing rows are untouched (writer only appends; never rewrites G/H/I columns).

### Task 4: MP resumen row for closed periods (synthetic running balance)
**Linear Issue:** [ADV-368](https://linear.app/lw-claude/issue/ADV-368/mp-resumen-row-for-closed-periods-synthetic-running-balance)
**Files:**
- `src/mercadopago/resumen-writer.ts` (create)
- `src/mercadopago/resumen-writer.test.ts` (create)

**Steps:**
1. Write tests for `writeMpResumenIfClosed(controlSpreadsheetId, movimientosSpreadsheetId, periodo, accountInfo, today)`:
   - Periodo `2026-05` with `today = 2026-06-12` (closed): reads the period's movimientos tab, computes `saldoFinal = saldoInicial + Σcredito − Σdebito`, `saldoInicial` taken from the previous periodo's resumen row `saldoFinal` (0 when none), and stores a `ResumenBancario` row via `storeResumenBancario` with: `banco = 'Mercado Pago'`, `numeroCuenta = {collectorId}`, `moneda = 'ARS'`, `fechaDesde`/`fechaHasta` = first/last day of periodo, `cantidadMovimientos` = transaction-row count (excluding SALDO INICIAL), `fileId` = movimientos spreadsheetId, `fileName` = `{periodo} - Resumen - Mercado Pago - {collectorId} ARS`, `confidence: 1`, `needsReview: false`.
   - Periodo equal to the current month (open) → no-op result (`written: false`).
   - Re-run for an already-stored periodo → `storeResumenBancario` dedupe path is honored (`written: false`, no duplicate row).
   - Period tab with zero transaction rows → no resumen row, info log.
   - balanceDiff computed by the existing `calculateBalanceDiff` is 0 by construction (saldos derive from the same rows) → `balanceOk = SI`.
2. Run verifier (expect fail)
3. Implement, reusing `storeResumenBancario` (`resumen-store.ts:173-304`) unchanged — its dedupe on `(banco, numeroCuenta, fechaDesde, fechaHasta, moneda)` provides the idempotency. Read movimientos rows via `readMovimientosForPeriod` (`movimientos-reader.ts:154-201`).
4. Run verifier (expect pass)

**Notes:**
- The saldo columns represent cumulative net collected through MP (no money-out data exists in this API) — document this in Task 10, not a schema change.
- `fileId` pointing at a spreadsheet makes the hyperlink resolve via Drive's file URL redirect; if `https://drive.google.com/file/d/{id}/view` does not open spreadsheets cleanly, build the docs URL — assert the chosen URL in the test.

### Task 5: Sync orchestrator with processing lock and match auto-trigger
**Linear Issue:** [ADV-369](https://linear.app/lw-claude/issue/ADV-369/mp-sync-orchestrator-with-processing-lock-and-match-auto-trigger)
**Files:**
- `src/mercadopago/sync.ts` (create)
- `src/mercadopago/sync.test.ts` (create)

**Steps:**
1. Write tests for `syncMercadopago(periods?: string[]): Promise<Result<MpSyncStats, Error | { skipped: true; reason: string }>>`:
   - Default periods (no arg) = previous + current month (AR timezone).
   - `MP_ACCESS_TOKEN` unset → returns skipped result with reason `'mp_disabled'`, warn logged once, no API calls.
   - Happy path per period: client fetch → transform → get-or-create folder/workbooks (`getOrCreateBankAccountFolder` + `getOrCreateMovimientosSpreadsheet` + `getOrCreateBankAccountSpreadsheet` with `banco='Mercado Pago'`, `numeroCuenta` = `collector_id` from the first payment, `moneda='ARS'`) → `writeMpMovimientos` → `writeMpResumenIfClosed`; stats aggregate `{ periods, fetched, appended, skippedExisting, resumenesWritten }`.
   - Period with zero payments → no folder/workbook creation, no writes, period still reported in stats.
   - Acquires `PROCESSING_LOCK_ID` (wait `PROCESSING_LOCK_TIMEOUT_MS`, expiry `PROCESSING_LOCK_EXPIRY_MS`) — concurrent scan blocks sync and vice versa (mirror the scan/match pattern); lock not acquired in the disabled path.
   - After a successful sync with `appended > 0`, `matchAllMovimientos` is triggered asynchronously AFTER lock release (mirror `triggerMatchAsync` in scanner.ts); no trigger when nothing was appended.
   - A failing period (client error) marks the run `ok: false` with the error but still attempts remaining periods first (partial progress preserved; stats include per-period outcome).
2. Run verifier (expect fail)
3. Implement in `src/mercadopago/sync.ts`. Period strings validated as `YYYY-MM`; future periods rejected. Collector id: taken from payment `collector_id`; with zero payments no account inference is needed (skip).
4. Run verifier (expect pass)

**Notes:**
- Concurrency guard: the unified PROCESSING_LOCK keeps sync, scan, and match mutually exclusive (CLAUDE.md Concurrency Control). The match auto-trigger must not run under the sync's lock (deadlock — match acquires the same lock).
- Idempotency end-to-end: re-running any period any number of times is safe (Task 3 dedupe + Task 4 resumen dedupe).

### Task 6: POST /api/mp-sync route
**Linear Issue:** [ADV-370](https://linear.app/lw-claude/issue/ADV-370/post-apimp-sync-route-manual-trigger)
**Files:**
- `src/routes/mp-sync.ts` (create)
- `src/routes/mp-sync.test.ts` (create)
- `src/server.ts` (modify — register route)

**Steps:**
1. Write tests (Fastify `inject`, pattern from `src/routes/scan.test.ts`):
   - No/bad bearer token → 401 (authMiddleware).
   - `POST /api/mp-sync` → 200 with stats JSON from `syncMercadopago()` (mocked).
   - `?period=2026-05` → passes `['2026-05']`; malformed (`2026-13`, `garbage`, future month) → 400 with a generic validation message.
   - Sync returns `skipped: 'mp_disabled'` → 200 with `{ skipped: true, reason: 'mp_disabled' }` (operator-visible, not an error).
   - Sync returns `ok: false` → 500 with a **generic** error message in the body; the raw error is logged via Fastify logger only (no internal details in the response).
2. Run verifier (expect fail)
3. Implement route with `{ onRequest: authMiddleware }`; register in `src/server.ts` alongside scan routes.
4. Run verifier (expect pass)

**Notes:**
- Error sanitization rule (cross-cutting sweep): response bodies carry generic messages; raw errors go to logs.
- Lock contention semantics live inside `syncMercadopago` (it waits like scans do); the route stays thin.

### Task 7: Monthly cron + boot-time catch-up
**Linear Issue:** [ADV-371](https://linear.app/lw-claude/issue/ADV-371/mp-monthly-cron-boot-time-catch-up-scheduler)
**Files:**
- `src/mercadopago/scheduler.ts` (create)
- `src/mercadopago/scheduler.test.ts` (create)
- `src/server.ts` (modify — init/stop hooks)

**Steps:**
1. Write tests for `initMpScheduler()` / `stopMpScheduler()`:
   - Registers a `node-cron` job with expression `0 6 1 * *` (06:00 on the 1st, server time) whose handler calls `syncMercadopago()` with default periods (previous + current month) — assert via cron mock (pattern: watch-manager tests).
   - `MP_ACCESS_TOKEN` unset → no cron registered, info log.
   - Boot catch-up: `initMpScheduler` fires one immediate async `syncMercadopago()` (idempotent, covers missed cron runs across Railway deploys); a failure in the boot sync is logged and does NOT crash boot (`.catch` + logError, mirroring the signal-handler pattern in `src/server.ts`).
   - `stopMpScheduler` destroys the cron task (graceful-shutdown symmetry with watch-manager).
2. Run verifier (expect fail)
3. Implement; wire `initMpScheduler` into server startup after watch-manager init and `stopMpScheduler` into the shutdown handler in `src/server.ts`.
4. Run verifier (expect pass)

**Notes:**
- The boot catch-up plus the monthly cron means every month is synced at least once shortly after it closes even if the instance was down on the 1st. All runs are idempotent.
- Boot sync runs after the scanner's startup recovery; the shared PROCESSING_LOCK serializes them naturally.

### Task 8: Matcher CUIT↔DNI equivalence in identity comparisons
**Linear Issue:** [ADV-372](https://linear.app/lw-claude/issue/ADV-372/matcher-cuitdni-equivalence-in-identity-comparisons)
**Files:**
- `src/bank/matcher.ts` (modify)
- `src/bank/matcher.test.ts` (modify)

**Steps:**
1. Write tests:
   - Credit movement with concepto `MP 123 - CUIT 20123456786 - Plan X` vs a factura emitida whose `cuitReceptor` is the embedded DNI `12345678` → tier 2 identity match, HIGH confidence.
   - Reverse direction (factura stores full CUIT, concepto carries a CUIL embedding the same DNI) → matches.
   - Distinct DNIs → hard filter still excludes (no false positives); 11-digit vs 11-digit comparison remains exact (two different CUITs sharing no DNI relation never match).
   - Debit-side identity comparisons get the same equivalence (pago enviado `cuitBeneficiario` as DNI).
2. Run verifier (expect fail)
3. Replace strict `===` identity comparisons in the hard CUIT filter and tier-2 checks of `matchMovement`/`matchCreditMovement` (`src/bank/matcher.ts`, comparisons like `:391`) with `cuitOrDniMatch` from `src/utils/validation.ts:207-232`. Audit all concepto-CUIT-vs-document-CUIT comparison sites in matcher.ts and apply uniformly.
4. Run verifier (expect pass)

**Notes:**
- `cuitOrDniMatch` already exists and is tested — this task is wiring, not new identity logic.
- Benefits all consumidor-final matching (bank transfers too), not just MP.

### Task 9: MP-specific forward factura date window
**Linear Issue:** [ADV-373](https://linear.app/lw-claude/issue/ADV-373/matcher-mp-specific-forward-factura-date-window-25-days)
**Files:**
- `src/bank/matcher.ts` (modify)
- `src/bank/match-movimientos.ts` (modify — thread account context)
- `src/config.ts` (modify — `MP_FACTURA_DATE_RANGE_AFTER_DAYS = 25`, `MERCADO_PAGO_BANK_NAME = 'Mercado Pago'` constants)
- `src/bank/matcher.test.ts`, `src/bank/match-movimientos.test.ts` (modify)

**Steps:**
1. Write tests:
   - An MP-account credit movement dated 2026-05-25 with CUIT in concepto matches a factura emitida dated 2026-06-11 (17 days later, CUIT+amount match) at HIGH confidence.
   - The same movement on a regular bank account does NOT match that factura (existing windows unchanged — regression guard).
   - MP window upper bound enforced: factura 26+ days after the movement does not match even for MP.
   - The backward window (factura up to 30 days before movement) is unchanged for MP.
2. Run verifier (expect fail)
3. Implement: `discoverMovimientosSpreadsheets`/`matchAllMovimientos` already know the bank-account folder name per workbook — derive `isMercadoPago = folderName.startsWith(MERCADO_PAGO_BANK_NAME)` and thread it to the matcher per movement batch (constructor option or per-call flag on `BankMovementMatcher`). In the credit-path candidate windows and date-proximity confidence ranges, extend the forward bound to `MP_FACTURA_DATE_RANGE_AFTER_DAYS` when the flag is set; tier/confidence semantics otherwise unchanged.
4. Run verifier (expect pass)

**Notes:**
- Root cause: MP subscriptions charge on the 25th; facturas are emitted on the ~11th of the following month (verified against production data) — payment precedes its factura by ~17 days.
- Depends on Task 8 (same files/comparison sites).

### Task 10: Documentation updates
**Linear Issue:** [ADV-374](https://linear.app/lw-claude/issue/ADV-374/mp-ingestion-documentation-claudemd-spreadsheet-formatmd-envexample)
**Files:**
- `CLAUDE.md` (modify)
- `SPREADSHEET_FORMAT.md` (modify)
- `.env.example` (modify)

**Steps:**
1. CLAUDE.md: add `MP_ACCESS_TOKEN` to ENV VARS (optional; feature disabled when unset; must never be logged); add `POST /api/mp-sync` to API ENDPOINTS; add `src/mercadopago/` to STRUCTURE; add a MATCHING note (CUIT↔DNI equivalence; MP forward window constant and why); extend Concurrency Control to mention mp-sync sharing the PROCESSING_LOCK.
2. SPREADSHEET_FORMAT.md: document the MP account convention — folder `Mercado Pago {collectorId} ARS`, movimientos tabs use the standard bancario 9-col schema with no SALDO FINAL row, concepto format `MP {operationId} - ...`, resumen saldos are synthetic running net-collected (no money-out data).
3. `.env.example`: add `MP_ACCESS_TOKEN=` with a comment.
4. Run verifier full mode (docs-only change; regression gate).

**Notes:**
- No code; no TDD cycle (docs-only, like dependency-bump tasks). Keep KNOWN ACCEPTED PATTERNS untouched.
- Also document the Entrega behavior for MP: no PDF is copied (Task 11); the per-account-month movimientos files carry the data.

### Task 11: Delivery copy-pdfs skips non-PDF resumen fileIds
**Linear Issue:** [ADV-375](https://linear.app/lw-claude/issue/ADV-375/delivery-copy-pdfs-skip-non-pdf-resumen-fileids-mp-spreadsheet-backed)
**Files:**
- `src/services/delivery-package.ts` (modify)
- `src/services/delivery-package.test.ts` (modify)
- `src/routes/delivery.ts` (modify — surface `skippedNonPdf` in response)

**Steps:**
1. Write tests: an enumerated resumen item whose file is a Google Sheet (MP case — `fileId` points at the movimientos spreadsheet) is NOT copied by `copyPdfsToDelivery` (`delivery-package.ts:661-691`), is counted in a new `skippedNonPdf` result field, and produces an info log — not a `failed` entry; PDF items copy exactly as before; the copy-pdfs route response includes the new count.
2. Run verifier (expect fail)
3. Implement: carry/lookup the file mimeType during enumeration (`enumerateResumenes`) or before copy; skip non-`application/pdf` items. Without this, the Entrega would copy the ENTIRE MP movimientos workbook (all months) into the delivery folder under the resumen's name.
4. Run verifier (expect pass)

**Notes:**
- The MP account still reaches the accountants through `buildMovimientosFiles` (per-account-month files with fecha, concepto incl. payer CUIT + op id, debito/credito, matched detalle) — verified the delivery discovery enumerates `{YYYY}/Bancos/` folders generically, so `Mercado Pago {collectorId} ARS` is auto-included.
- Independent of Tasks 1-9 (different files); conceptually pairs with Task 4's fileId convention.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Ingest Mercadopago collections via the payments API as a bank-account-style Movimientos workbook with monthly resumen rows, automatically matched to facturas emitidas — replacing a nonexistent MP "resumen bancario" PDF with an idempotent monthly server process plus a manual trigger endpoint.
**Linear Issues:** ADV-365, ADV-366, ADV-367, ADV-368, ADV-369, ADV-370, ADV-371, ADV-372, ADV-373, ADV-374, ADV-375
**Approach:** New `src/mercadopago/` module (client → transform → idempotent writers → orchestrator) reusing the existing bank folder/workbook/resumen primitives, the unified PROCESSING_LOCK, and the auto-match trigger; two surgical matcher upgrades (CUIT↔DNI equivalence via the existing `cuitOrDniMatch`, MP-specific +25-day forward factura window) make matching deterministic at tier 2/HIGH — verified 23/23 against production May data.
**Scope:** 11 tasks, ~17 files (9 new), ~50 test scenarios.
**Key Decisions:** API-based ingestion (no XLSX parsing — the collection report is manual-only, the settlement report lacks payer identity); deductions itemized as one identity-free debit row per MP charge (comisión, Imp. Débitos y Créditos, SIRTAC/IIBB withholdings per jurisdiction — the accountants need each tax credit separated) with a reconciliation-guard fallback to a combined row; credits stay at gross for matching; `MP {operationId}` concepto prefix as the idempotency key; resumen rows only for closed periods with synthetic running-net saldos (balanceOk = SI by construction); monthly cron (1st, 06:00) + idempotent boot catch-up instead of state-tracking missed-run logic; Entrega copies no PDF for MP (skip non-PDF resumen fileIds) — the per-account-month movimientos files carry the data.
**Risks:** MP could mask payer PII in the future (mitigation documented: subscriptions' `external_reference` + member registry; current data verified clean); fee debit rows could occasionally amount-match unrelated documents (low impact — debit side carries no identity, tier 5 LOW at worst); `date_approved` GMT-4 vs ART date-bucketing handled explicitly in transform tests.

---

## Iteration 1

**Implemented:** 2026-06-12
**Method:** Agent team (4 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Mercadopago API client (ADV-365) — `src/mercadopago/client.ts`, pagination/timeout/429 backoff, token never logged, 18 tests (worker-1)
- Task 2: Transform MP payments → MovimientoBancario (ADV-366) — gross credit + per-charge debit rows, reconciliation guard, AR-timezone dates, 19 tests (worker-1)
- Task 3: Idempotent MP movimientos writer (ADV-367) — incremental month-tab appends, `MP {id}` dedupe, no SALDO FINAL, 17 tests (worker-2)
- Task 4: MP resumen row for closed periods (ADV-368) — synthetic running balance via `storeResumenBancario`, 21 tests (worker-2)
- Task 5: Sync orchestrator (ADV-369) — PROCESSING_LOCK, match auto-trigger after lock release, partial-failure handling, 32 tests (worker-3)
- Task 6: POST /api/mp-sync route (ADV-370) — auth, period validation, generic error bodies, 18 tests (worker-3)
- Task 7: Monthly cron + boot catch-up (ADV-371) — `0 6 1 * *`, boot sync never crashes boot, 10 tests (worker-3)
- Task 8: Matcher CUIT↔DNI equivalence (ADV-372) — `cuitOrDniMatch` at all 10 identity comparison sites; also fixed `buildMatchQuality` tier evaluation for DNI-CUIT matches (worker-4)
- Task 9: MP-specific forward factura window (ADV-373) — +25 days for MP accounts, threaded via `isMercadoPago` flag (worker-4)
- Task 10: Documentation (ADV-374) — CLAUDE.md, SPREADSHEET_FORMAT.md, .env.example, MIGRATIONS.md (lead, post-merge)
- Task 11: Delivery copy-pdfs skips non-PDF resumen fileIds (ADV-375) — `skippedNonPdf` count surfaced in route response (worker-4)

### Files Modified
- `src/mercadopago/client.ts`, `transform.ts`, `movimientos-writer.ts`, `resumen-writer.ts`, `sync.ts`, `scheduler.ts` (+ colocated tests) — new module
- `src/routes/mp-sync.ts` (+ test) — new route; registered in `src/server.ts` with scheduler init/stop hooks
- `src/config.ts` — MP_API_BASE_URL/TIMEOUT/RETRIES, getMpAccessToken(), MP_ACCESS_TOKEN, MERCADO_PAGO_BANK_NAME, MP_FACTURA_DATE_RANGE_AFTER_DAYS
- `src/types/index.ts` — `MovimientoBancario.saldo: number | null` (+ `src/gemini/parser.ts` signature)
- `src/bank/matcher.ts`, `src/bank/match-movimientos.ts` — CUIT↔DNI equivalence, MP forward window, `isMercadoPagoAccount` helper
- `src/services/delivery-package.ts`, `src/routes/delivery.ts` — non-PDF skip
- `CLAUDE.md`, `SPREADSHEET_FORMAT.md`, `.env.example`, `MIGRATIONS.md` — docs

### Linear Updates
- ADV-365…ADV-375 (all 11): Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs (1 HIGH: `isMercadoPago` always false — discovery map keys are `{year}:{folderName}` so `startsWith` never matched; extracted tested `isMercadoPagoAccount` helper. 2 LOW: non-ARS `skipped` count silently discarded → warn added; lock-failure log conflated timeout with callback throw → messages split). All fixed with TDD.
- verifier (full): 2,924 tests pass (82 files), lint clean, build zero warnings.

### Work Partition
- Worker 1: Tasks 1-2 (MP API domain — client, transform)
- Worker 2: Tasks 3-4 (MP sheet writers)
- Worker 3: Tasks 5-7 (orchestration — sync, route, scheduler; built against stub interfaces)
- Worker 4: Tasks 8, 9, 11 (matcher upgrades + delivery skip)
- Lead: Task 10 (docs, post-merge)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: clean merge
- Worker 3: 4 add/add stub conflicts (client/transform/movimientos-writer/resumen-writer) resolved keeping real implementations; 1 integration fix (`writeMpResumenIfClosed` takes a `YYYY-MM-DD` string — sync now passes `businessDateString()`); config.ts MP_ACCESS_TOKEN const reconciled alongside getMpAccessToken()
- Worker 4: clean merge

### Continuation Status
All tasks completed.
