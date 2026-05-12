# Implementation Plan

**Created:** 2026-05-12
**Source:** Inline request: Build a new Subdiario de Ventas spreadsheet — an auto-synced registry of all comprobantes (FC / NC) emitted by ADVA, joined with the Facturador de Socios for socio metadata and with bank movimientos for cobro data, with AFIP numbering-gap detection and multi-installment support. Replaces the manually-maintained `ADVA SUBDIARIO VENTAS 2025` workbook.
**Linear Issues:** [ADV-245](https://linear.app/lw-claude/issue/ADV-245/subdiario-extract-condicionivareceptor-for-factura-emitida-schema), [ADV-246](https://linear.app/lw-claude/issue/ADV-246/subdiario-facturador-de-socios-reader-service), [ADV-247](https://linear.app/lw-claude/issue/ADV-247/subdiario-builder-pure-function-scope-join-nc-linkage-gap-detection), [ADV-248](https://linear.app/lw-claude/issue/ADV-248/subdiario-writer-workbook-creation-sync-hook-in-matchallmovimientos), [ADV-249](https://linear.app/lw-claude/issue/ADV-249/subdiario-post-apirebuild-subdiario-endpoint), [ADV-250](https://linear.app/lw-claude/issue/ADV-250/subdiario-apps-script-menu-entry-reconstruir-subdiario-de-ventas)
**Branch:** feat/subdiario-de-ventas

## Context Gathered

### Codebase Analysis

- **Schema migration pattern** — `migrateFacturasEmitidasPagadaColumn` at `src/services/folder-structure.ts:425` (called from `src/services/migrations.ts:355-466` startup orchestrator) is the canonical pattern. Uses `insertColumn(spreadsheetId, sheetId, columnIndex)` which wraps `insertDimension`. Versions tracked via `.schema_version` file (no MIGRATIONS.md in repo).
- **FACTURA_PROMPT** lives at `src/gemini/prompts.ts:186-304`; JSON schema portion at lines 262-275. New field goes here.
- **`Factura` interface** at `src/types/index.ts:90+`. New optional field `condicionIVAReceptor?: string` goes here.
- **Parser plumb-through** at `src/gemini/parser.ts:89-135` (`assignCuitsAndClassify` decides factura_emitida vs factura_recibida).
- **Schema constants** at `src/constants/spreadsheet-headers.ts:7-28` (`FACTURA_EMITIDA_HEADERS`).
- **Row builder** at `src/processing/storage/factura-store.ts:24-81` (`buildFacturaRowFormatted`).
- **Derived-sheet sync pattern** — `syncPagosPendientes` / `syncCobrosPendientes` at `src/services/pagos-pendientes.ts:43-244`. Full clear + rewrite via `clearSheetData` + `appendRowsWithLinks`. **This is the pattern the Subdiario writer follows.**
- **Sync trigger point** — `src/bank/match-movimientos.ts:1289-1294`. `matchAllMovimientos` calls `syncPagosPendientes` and `syncCobrosPendientes` here, inside the `PROCESSING_LOCK` scope. New `syncSubdiario` call goes alongside.
- **Endpoint pattern** — `src/routes/scan.ts:44-61` (POST /scan with `authMiddleware`). `PROCESSING_LOCK_ID` at `src/config.ts:42` with 5-min wait via `PROCESSING_LOCK_TIMEOUT_MS`.
- **Spreadsheet creation** — `createSpreadsheet(parentId, name)` exists at `src/services/drive.ts:1117-1129`. `createSheet` (add tab to existing workbook) at `src/services/sheets.ts:451-460` via `batchUpdate({addSheet})`.
- **Apps Script menu** — `apps-script/src/main.ts:39-49` (`createMenu` + existing trigger functions: `triggerScan`, `triggerRematch`, `triggerMatchMovimientos`, `triggerEnvioContadores`). Boot sync at `src/bootstrap/apps-script-sync.ts:28-80` pushes the bundle.
- **NC linkage helper** — `extractReferencedFacturaNumber(concepto: string): string | null` at `src/processing/matching/nc-factura-matcher.ts:75-99`. Reusable from the Subdiario builder for NC→FC linkage without re-running the full matcher.
- **Folder structure resolution** — `getCachedFolderStructure` / `discoverFolderStructure` at `src/services/folder-structure.ts:78-80, 900-1001`. ROOT folder ID is the parent for the new workbook.
- **Concurrent sheet appends** — `appendRowsWithLinks` in `src/services/sheets.ts` is already per-sheet-locked (ADV-242). Subdiario writes pick this up automatically.

### MCP Context

- **Google Drive MCP** consulted to read both source spreadsheets:
  - `ADVA SUBDIARIO VENTAS 2025` (`1L0cE-kssvxYmnSEHpakTfRbmflBGGKaPiuOAfOmr81Y`) — current manual workbook, two sheets `Facturas` (1446 rows) and `Cobros` (1237 rows), heavily formatted, multiple in-sheet section headers. Will be replaced (not modified) by the new auto-synced workbook.
  - `ADVA - Facturador de Socios` (`1WUEB-8B79-Ma6-yZ5FNS1Nj2cTi7p2P9lUNGMc8R2lU`) — issuance log for socio comprobantes, one tab per year (`2026` is the active tab as of today). Columns: Nro Socio, Comprobante, Empresa, Representante, Email, Membresia, Cobro Id, Cond IVA, Fecha, Importe, Enviado?, Pagado?, Status. This is the canonical enrichment source for socio rows.
- **Padron de Socios** (`18_9-G0jGa-OrKg7WS4aLmYAVljC8H63GcLuTcXIiKDU`) — read but **intentionally dropped** as a Subdiario input. The Facturador already pre-joins Padron data at issuance time; using both would duplicate logic.
- **Linear MCP** — created 6 issues in Todo state (ADV-245..250). Previous ADV-244 was the last completed issue (DuplicateCache unit tests inline-fix from ADV-242 review).
- **Multi-puntoVenta streams observed** in current Subdiario: `00003/FC` (cod 011 main local), `00003/NC` (cod 013, closed Sept 2025), `00004/FC` (cod 019 export), `00004/NC` (cod 021 export), `00005/NC` (cod 013, opened Oct 2025). Gap detection must run per `(puntoVenta, FC|NC)`.
- **AFIP cod mapping** confirmed from observed data: `A→001`, `B→006`, `C→011`, `E→019`, `NC A→003`, `NC B→008`, `NC C→013`, `NC E→021`.

## Tasks

### Task 1: Extract `condicionIVAReceptor` for `factura_emitida` + Facturas Emitidas schema migration

**Linear Issue:** [ADV-245](https://linear.app/lw-claude/issue/ADV-245/subdiario-extract-condicionivareceptor-for-factura-emitida-schema)
**Files:**
- `src/gemini/prompts.ts` (modify)
- `src/gemini/parser.ts` (modify)
- `src/types/index.ts` (modify)
- `src/constants/spreadsheet-headers.ts` (modify)
- `src/services/folder-structure.ts` (modify — add migration)
- `src/services/migrations.ts` (modify — register migration)
- `src/processing/storage/factura-store.ts` (modify)
- `src/gemini/parser.test.ts` (modify)
- `src/processing/storage/factura-store.test.ts` (modify)
- New test for the migration in `src/services/folder-structure.test.ts` (modify)

**Steps:**

1. Write tests in `src/gemini/parser.test.ts`:
   - A `factura_emitida` PDF response containing receptor with "Responsable Inscripto" → parsed `Factura.condicionIVAReceptor === 'IVA Responsable Inscripto'`
   - All 5 canonical strings tested (`IVA Responsable Inscripto`, `Consumidor Final`, `Responsable Monotributo`, `Cliente del Exterior`, `IVA Sujeto Exento`)
   - Unknown/garbled value → field remains empty + `needsReview = true` (uses existing review-flag plumbing)
   - `factura_recibida` extraction does NOT set `condicionIVAReceptor` (ADVA's own condition is constant)
2. Run verifier (expect fail).
3. Update `FACTURA_PROMPT` (`src/gemini/prompts.ts:262-275`) to extract receptor's "Condición frente al IVA" as a new JSON key `condicionIVAReceptor`. Include explicit enum guidance for the 5 canonical values exactly as written above. Add to the prompt's instruction section and to the example JSON.
4. Add `condicionIVAReceptor?: string` to `Factura` interface in `src/types/index.ts` (place near `cuitReceptor` for cohesion).
5. Plumb through `src/gemini/parser.ts:89-135` — `assignCuitsAndClassify` is the right place to set this field on the `factura_emitida` branch only.
6. Run verifier (expect Step 1's parser tests pass).

7. Write tests in `src/processing/storage/factura-store.test.ts`:
   - `buildFacturaRowFormatted` for a factura_emitida with `condicionIVAReceptor='Consumidor Final'` → row[7] (column H position 0-indexed) is `'Consumidor Final'`; column I and onwards shift to match new layout
   - factura_emitida with empty `condicionIVAReceptor` → row[7] is `''`
   - factura_recibida is unaffected (no change to its row layout)
8. Run verifier (expect fail).
9. Update `FACTURA_EMITIDA_HEADERS` in `src/constants/spreadsheet-headers.ts:7-28`: insert `'condicionIVAReceptor'` at index 7 (between `razonSocialReceptor` and `importeNeto`). Update `FACTURA_RECIBIDA_HEADERS` is **NOT** touched.
10. Update `buildFacturaRowFormatted` in `src/processing/storage/factura-store.ts:24-81` so the factura_emitida branch writes `condicionIVAReceptor` into the new column position; all downstream cells (importeNeto, importeIva, ...) shift right by one position in the array.
11. Run verifier (expect Step 7's tests pass).

12. Write tests in `src/services/folder-structure.test.ts` (or a new sibling test file if needed) for the migration:
    - Old 20-column sheet → `migrateFacturasEmitidasCondicionIvaColumn` inserts a column at index 7, leaving existing data shifted right
    - Idempotency: running the migration on an already-21-column sheet is a no-op (detect by header at index 7 already being `condicionIVAReceptor`)
    - Header at the new column is `condicionIVAReceptor`
13. Run verifier (expect fail).
14. Implement `migrateFacturasEmitidasCondicionIvaColumn` in `src/services/folder-structure.ts` following the `migrateFacturasEmitidasPagadaColumn` (line 425) pattern. Use `insertColumn(spreadsheetId, sheetId, 7)`. Header write follows the existing migration's `setValues` pattern.
15. Register the migration in `src/services/migrations.ts:355-466` startup orchestrator (same registration shape as the pagada migration). Order: after pagada migration (so the migration sequence stays append-only).
16. Run verifier (expect Step 12's tests pass + full suite green).

**Notes:**
- Pattern reference: `migrateFacturasEmitidasPagadaColumn` at `src/services/folder-structure.ts:425` — copy the structure verbatim, only change the column index and header name.
- The migration is **fail-closed** (matches existing pattern): if the `insertColumn` API call fails on boot, the server fails startup rather than writing to a misaligned sheet.
- **Migration note:** This task changes spreadsheet schema (Facturas Emitidas grows from 20 to 21 columns). Existing rows have empty `condicionIVAReceptor`. User will backfill manually post-deploy by reprocessing historical PDFs (out of scope). Migration must be registered in `MIGRATIONS.md` if that file exists; the codebase currently tracks via `.schema_version` instead.
- Control de Egresos / Facturas Recibidas remains untouched (ADVA's own IVA condition is constant — no value in extracting from PDFs we issue ourselves).

---

### Task 2: Facturador de Socios reader service

**Linear Issue:** [ADV-246](https://linear.app/lw-claude/issue/ADV-246/subdiario-facturador-de-socios-reader-service)
**Files:**
- `src/services/facturador-reader.ts` (create)
- `src/services/facturador-reader.test.ts` (create)
- `src/config.ts` (modify — add `FACTURADOR_SPREADSHEET_ID` env var)
- `README.md` and `CLAUDE.md` ENV VARS table (modify)

**Steps:**

1. Write tests in `src/services/facturador-reader.test.ts`:
   - Reads the current-year tab (test uses fixed `currentYear=2026`) and returns a `Map<normalizedComprobante, FacturadorEntry>`
   - Comprobante normalization: `0005-00000057` (Facturador format) → `00005-00000057` (Facturas Emitidas format). Both `0004-00000020` and `00004-00000020` normalize to the same key.
   - Multi-row read: a sheet with 3 rows returns a Map of 3 entries
   - Missing current-year tab → returns empty Map and logs a `warn` (does not throw)
   - Missing `FACTURADOR_SPREADSHEET_ID` env var → returns empty Map and logs a `warn`
   - `FacturadorEntry` shape: `{ nroSocio, empresa, representante, email, membresia, cobroId, condIVA, fecha, importe, pagadoCol }` — all strings except `importe` which is a number
   - Empty Empresa in source → entry's `empresa` field is `''` (reader returns verbatim; caller decides the Empresa-vs-Representante fallback)
   - `Pagado?` column containing an NC number like `0005-00000011` → preserved in `pagadoCol` verbatim
2. Run verifier (expect fail).
3. Implement `readFacturador(currentYear: number): Promise<Result<Map<string, FacturadorEntry>, Error>>` in `src/services/facturador-reader.ts`:
   - Use existing `gsheets_read` equivalent (Sheets API call) on tab named `String(currentYear)` of the spreadsheet at `process.env.FACTURADOR_SPREADSHEET_ID`
   - Normalize each row's `Comprobante` value via a private helper `normalizeNroComprobante(raw: string): string` (5-digit pto + dash + 8-digit numero)
   - Convert `Importe` to number (handle thousands separators / currency format from the sheet)
   - Skip empty rows (Comprobante empty)
   - Log warns for missing tab and missing env var; never throw — return empty Map
   - Use Pino logger from `src/utils/logger.ts`
4. Add `FACTURADOR_SPREADSHEET_ID` to `src/config.ts` with a getter (optional — empty default).
5. Update CLAUDE.md and README.md ENV VARS table with the new variable: required for the Subdiario rebuild to enrich socio rows; if unset, the Subdiario builds but with `categoria='-'` for all rows.
6. Run verifier (expect pass).

**Notes:**
- Follow the `Result<T,E>` pattern for the public API (CLAUDE.md rule).
- This reader does NOT cache across invocations — the builder always gets fresh data. Within a single rebuild call, the result is passed by reference (caller does not re-read).
- Reader returns BOTH `empresa` AND `representante` so the caller can decide the fallback (Empresa-or-Representante). Reader is dumb.

---

### Task 3: Subdiario de Ventas builder (pure function)

**Linear Issue:** [ADV-247](https://linear.app/lw-claude/issue/ADV-247/subdiario-builder-pure-function-scope-join-nc-linkage-gap-detection)
**Files:**
- `src/services/subdiario-builder.ts` (create)
- `src/services/subdiario-builder.test.ts` (create)
- `src/types/index.ts` (modify — export `SubdiarioRow` type)

**Steps:**

1. Write tests in `src/services/subdiario-builder.test.ts` covering each behaviour from the issue spec. Each fixture exercises one rule; all 16 cases are independent tests:
   - **Plain socio FC paid same year**: socio FC matched to a movimiento; row joins Facturador; `categoria='Micro'` (or whatever), `cobro=movimiento.fecha`, `recibido=movimiento.credito`, Notas = `Socio 1003 - An Otter Game Studio S.R.L.`
   - **Non-socio FC**: not in Facturador → `categoria='-'`, Notas empty
   - **FC E export with USD, paid**: Notas = `Pago del exterior - USD 10000 - TC fact 1430 - TC pago 1428.5` (bankRate computed when no pagoRecibido row); `total = 10000 * 1430 = 14300000` ARS
   - **FC E export, unpaid**: Notas = `Pago del exterior - USD 10000 - TC fact 1430`
   - **NC cancelling current-year FC**: FC row shows `fechaCobro='NC 00003-00000140'`, `recibido=0`; NC row present with negative total
   - **NC cancelling prior-year FC**: same as above, both rows in scope (rule c)
   - **Prior-year FC paid this year**: in scope (rule b)
   - **Prior-year FC still unpaid**: in scope (rule d)
   - **Prior-year FC paid prior year**: OUT of scope
   - **Prior-year FC cancelled by prior-year NC**: OUT of scope
   - **Multi-installment**: 2 movimientos matched to one FC → `recibido = sum`, `fechaCobro = latest`, Notas = `Cobrado en 2 cuotas: $1.000.000 (15/03/2026), $800.000 (22/03/2026)`
   - **Retencion-adjusted recibido**: `recibido + retencion = total` → Notas includes `Retencion Ganancias $50000`
   - **Numbering gap mid-stream**: 00003-00001955, 00003-00001957 present → placeholder row for 00003-00001956 with `cliente='FALTA 00003-00001956'`, `total=0`
   - **Independent gaps across streams**: gap in 00003/FC does not trigger placeholder in 00005/NC and vice versa
   - **FE missing from Facturador**: `categoria='-'`, `condicion` from PDF extraction
   - **FE missing condicionIVAReceptor but Facturador has condIVA**: row uses Facturador's `condIVA`
   - **Combined Notas** (socio FC E): both pieces concatenated with `; ` → `Socio 1029 - UNRaf; Pago del exterior - USD 10000 - TC fact 1430`
   - **Sort verification**: rows sorted by Fecha ASC then Nro ASC; cross-stream within same date interleaves correctly
2. Run verifier (expect fail).
3. Implement `buildSubdiarioRows(input: SubdiarioInput): SubdiarioRow[]` in `src/services/subdiario-builder.ts`:
   - Pure function — no `await`, no I/O, no Pino logger calls beyond a single optional summary log via injected logger if useful for diagnostics (acceptable: no logger; this is a pure transform)
   - Decompose into named helpers: `applyScopeFilter`, `deriveCod`, `deriveTipo`, `convertTotalToARS`, `joinFacturador`, `findCancellingNC`, `aggregateMovimientos`, `composeNotas`, `detectGaps`, `sortRows`
   - Reuse `extractReferencedFacturaNumber` from `src/processing/matching/nc-factura-matcher.ts:75-99` for NC cancellation lookup; combine with same-CUIT + same-`importeTotal` (absolute value) for confirmation
   - Reuse retencion-matching tolerance logic from `src/matching/matcher.ts` — extract the predicate into a local helper if it's not already exported
   - Sort: `fecha` ASC, then full `nro` string ASC (lexicographic; the zero-padding ensures correct ordering)
   - Gap detection: group by `(puntoVenta, tipo)` after sorting; within each stream, iterate min→max numero and emit placeholder rows for missing integers; placeholders carry the previous row's date so they slot in at the right sort position
4. Run verifier (expect all 17+ tests pass).

**Notes:**
- This is the heart of the feature. The 17 tests are the minimum — add more as needed during implementation to fully cover the rules.
- Total ARS conversion edge case: if `moneda='USD'` but `tipoDeCambio` is missing/0, emit row with `total=0` AND append `[REVISAR: TC faltante]` to Notas.
- Cliente column from `Facturas Emitidas.razonSocialReceptor` (NOT from Facturador, which may have a different display name) — the AFIP-issued name is the legal record.
- For NCs, Cliente comes from the NC's own `razonSocialReceptor` (which equals the cancelled FC's receptor by construction).

---

### Task 4: Subdiario writer + workbook creation + sync hook

**Linear Issue:** [ADV-248](https://linear.app/lw-claude/issue/ADV-248/subdiario-writer-workbook-creation-sync-hook-in-matchallmovimientos)
**Files:**
- `src/services/subdiario-writer.ts` (create)
- `src/services/subdiario-writer.test.ts` (create)
- `src/services/folder-structure.ts` (modify — add `subdiarioId` to FolderStructure)
- `src/bank/match-movimientos.ts` (modify — add `syncSubdiario` call after `syncCobrosPendientes`)
- `src/bank/match-movimientos.test.ts` (modify — assert the new call)
- `src/constants/spreadsheet-headers.ts` (modify — add `SUBDIARIO_COMPROBANTES_HEADERS`)

**Steps:**

1. Write tests in `src/services/subdiario-writer.test.ts` (mock Drive and Sheets APIs):
   - **First run** (workbook missing): calls `searchFiles('Subdiario de Ventas', rootFolderId)` → empty → `createSpreadsheet(rootFolderId, 'Subdiario de Ventas')` is called → first sheet renamed from `Sheet1` to `Comprobantes` via `batchUpdate` `updateSheetProperties` → header row written → data rows written via `appendRowsWithLinks`
   - **Subsequent run** (workbook exists): no createSpreadsheet call → sheet is cleared (rows 2 onwards) → data rows written
   - **Workbook creation failure**: propagates an error result; matchAllMovimientos hook catches and logs (covered in match-movimientos.test.ts)
   - **Empty rows input**: header row preserved, no data rows; no crash
   - **Builder throws**: error caught at writer; returns `Result.err`; does not partial-write
2. Run verifier (expect fail).
3. Implement `syncSubdiario(rootFolderId, controlIngresosId, facturadorYear, movimientosByBank, ...args): Promise<Result<{ rowsWritten: number, gapsDetected: number }, Error>>` in `src/services/subdiario-writer.ts`:
   - Step 1: Resolve `subdiarioId` from `FolderStructure` cache; if absent, search Drive for `Subdiario de Ventas` in root folder, or create it via `createSpreadsheet(rootFolderId, 'Subdiario de Ventas')` from `src/services/drive.ts:1117-1129`
   - Step 2: Ensure the `Comprobantes` sheet exists with header row. If the new spreadsheet was just created, rename `Sheet1` → `Comprobantes` via `batchUpdate` with `updateSheetProperties`. Set frozen row 1 via `updateSheetProperties { gridProperties: { frozenRowCount: 1 } }`. Write headers via `appendRowsWithLinks` on first creation only (detect by checking if header row is present).
   - Step 3: Read inputs (callers pass them in or this function reads them — keep separation: writer reads `Facturas Emitidas` / `Pagos Recibidos` / `Retenciones Recibidas` / `Facturador` / movimientos itself, then delegates to builder)
   - Step 4: Call `buildSubdiarioRows(input)` (the pure builder from Task 3)
   - Step 5: Convert builder output to `CellValueOrLink[][]`: `fecha → {type:'date', value:fecha}`, `total/recibido → {type:'number', value:n}`, strings pass through
   - Step 6: Clear sheet rows from row 2 to end via existing `clearSheetData` (or equivalent batchUpdate with `range: 'Comprobantes!A2:M'` and `clearedFields: 'userEnteredValue,userEnteredFormat'`)
   - Step 7: Single `appendRowsWithLinks(subdiarioId, 'Comprobantes', rows, spreadsheetTimezone)` — per-sheet lock comes for free from ADV-242
   - Return `{ rowsWritten, gapsDetected }`
4. Add `SUBDIARIO_COMPROBANTES_HEADERS` to `src/constants/spreadsheet-headers.ts`: `['fecha', 'cod', 'tipo', 'nro', 'cliente', 'cuit', 'condicion', 'total', 'concepto', 'categoria', 'fechaCobro', 'recibido', 'notas']`
5. Extend `FolderStructure` in `src/services/folder-structure.ts` to include `subdiarioId?: string`; populate it during `discoverFolderStructure` by searching Drive for `Subdiario de Ventas` (don't auto-create at discovery time — let the writer create lazily on first sync).
6. Write tests in `src/bank/match-movimientos.test.ts`:
   - `matchAllMovimientos` calls `syncSubdiario` after `syncPagosPendientes` and `syncCobrosPendientes`
   - If `syncSubdiario` throws, the surrounding match cycle still completes (error is caught and logged via Pino)
   - The whole sequence runs inside the existing `PROCESSING_LOCK_ID` scope (verified by checking the call site is between the lock acquire and release)
7. Run verifier (expect fail).
8. Modify `src/bank/match-movimientos.ts:1289-1294` to call `syncSubdiario` right after the existing `syncCobrosPendientes` call. Wrap in a try/catch that logs via Pino and continues.
9. Run verifier (expect pass).

**Notes:**
- **Migration note:** First production deploy will create the new workbook `Subdiario de Ventas.gsheet` in the ROOT folder. No data migration needed — the workbook starts empty and is fully populated on first sync.
- The writer is the **only** code that creates the workbook. There is no startup-time auto-creation — the workbook is created lazily on first `matchAllMovimientos` after deploy.
- `clearSheetData` may need a new helper; if `src/services/sheets.ts` doesn't have one, follow the pattern in `pagos-pendientes.ts` for how the existing code clears before re-writing.
- Pino logger via `src/utils/logger.ts` for all logging.

---

### Task 5: `POST /api/rebuild-subdiario` endpoint

**Linear Issue:** [ADV-249](https://linear.app/lw-claude/issue/ADV-249/subdiario-post-apirebuild-subdiario-endpoint)
**Files:**
- `src/routes/subdiario.ts` (create)
- `src/routes/subdiario.test.ts` (create)
- `src/server.ts` (modify — register the new route)

**Steps:**

1. Write tests in `src/routes/subdiario.test.ts` with Fastify test harness:
   - `POST /api/rebuild-subdiario` without Authorization header → 401
   - `POST /api/rebuild-subdiario` with valid Bearer token → 200 + `{ rowsWritten, gapsDetected, durationMs }` (mock `syncSubdiario`)
   - `POST /api/rebuild-subdiario` when `PROCESSING_LOCK` already held → 503 (mock the lock manager to immediately fail on acquire)
   - `POST /api/rebuild-subdiario` when `syncSubdiario` throws → 500 with generic message; raw error logged via Pino only (capture log spy)
   - `POST /api/rebuild-subdiario` when `FACTURADOR_SPREADSHEET_ID` env var unset → still 200 (graceful degradation; categoria='-' for all rows)
   - Lock is **released** in both success and error paths (use `withLock` semantics from `src/utils/concurrency.ts`)
2. Run verifier (expect fail).
3. Implement the route in `src/routes/subdiario.ts`:
   - `server.post('/api/rebuild-subdiario', { onRequest: authMiddleware }, async (request, reply) => { ... })`
   - Acquire `PROCESSING_LOCK_ID` from `src/config.ts:42` via existing `withLock` (waits up to 5 min — same as scan)
   - Inside lock: read folder structure → call `syncSubdiario(rootFolderId, controlIngresosId, currentYear, ...)`
   - Response 200: `{ rowsWritten: N, gapsDetected: N, durationMs: N }`
   - On lock timeout: 503 + `{ error: 'Service busy — try again later' }`; raw error logged via Pino
   - On syncSubdiario error: 500 + `{ error: 'Subdiario rebuild failed' }`; raw error logged via Pino
4. Register the route in `src/server.ts` alongside `/api/scan`, `/api/rematch`, etc.
5. Run verifier (expect pass).

**Notes:**
- Match the existing `/api/scan` pattern — same auth, same lock, same response shape.
- Sanitize all error messages in HTTP responses; raw errors are Pino-logged only.
- The lock release is automatic via `withLock`'s try/finally; tests must confirm via a follow-up acquire attempt.

---

### Task 6: Apps Script menu entry for Subdiario rebuild

**Linear Issue:** [ADV-250](https://linear.app/lw-claude/issue/ADV-250/subdiario-apps-script-menu-entry-reconstruir-subdiario-de-ventas)
**Files:**
- `apps-script/src/main.ts` (modify)

**Steps:**

1. Add a `triggerRebuildSubdiario()` function in `apps-script/src/main.ts` near the existing trigger functions (`triggerScan`, `triggerRematch`, `triggerMatchMovimientos`, `triggerEnvioContadores`). Follow the same UrlFetchApp call shape:
   - POST to `${API_BASE_URL}/api/rebuild-subdiario`
   - `Authorization: Bearer ${API_SECRET}` header
   - On 200: SpreadsheetApp toast "Subdiario reconstruido — N comprobantes"
   - On error: SpreadsheetApp toast with sanitized error message
2. Add the menu item in `createMenu()` at `apps-script/src/main.ts:39-49`: `addItem('Reconstruir Subdiario de Ventas', 'triggerRebuildSubdiario')`. Place it after the existing match-movimientos item, before Envio Contadores.
3. Run `npm run build` and inspect `dist/apps-script/Code.js` to confirm the new function and menu item are bundled.

**Notes:**
- No automated test — Apps Script bundles aren't unit-tested in this repo.
- Boot sync at `src/bootstrap/apps-script-sync.ts` pushes the new bundle automatically on next Railway deploy.
- Verifier on the build will catch any syntactic issues; Code.js must remain valid Apps Script JS after bundling.

---

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs across all 6 tasks. Pay particular attention to:
   - Schema migration idempotency (rerunning the migration on already-migrated sheets must be a no-op)
   - The `condicionIVAReceptor` column being correctly written ONLY for factura_emitida (not factura_recibida)
   - Subdiario builder's scope filter correctness on year boundaries (Dec 31 / Jan 1 edge cases)
   - Gap detection not producing false positives when a stream starts mid-range (the first observed number is the floor, not zero)
   - Lock release in all error paths of `/api/rebuild-subdiario`
   - Writer's handling of the "first run" workbook-creation race (two simultaneous matchAllMovimientos invocations both trying to create the workbook — mitigated by `PROCESSING_LOCK` but verify)
2. Run `verifier` agent — Verify all tests pass and zero warnings.

---

## Plan Summary

**Objective:** Build an auto-synced `Subdiario de Ventas.gsheet` workbook with a single `Comprobantes` tab containing all FC/NC comprobantes relevant to the current fiscal year (emitted this year, paid this year, cancelled by NC this year, or still unpaid from prior year), joined with the Facturador de Socios for socio metadata and with bank movimientos for cobro data. Replaces the manually-maintained `ADVA SUBDIARIO VENTAS 2025` workbook with a deterministic, source-grounded, AFIP-numbering-gap-aware projection.

**Linear Issues:** ADV-245, ADV-246, ADV-247, ADV-248, ADV-249, ADV-250

**Approach:** Six discrete, sequential tasks under one feature branch. Task 1 lands the new `condicionIVAReceptor` field + Facturas Emitidas schema migration. Task 2 adds the Facturador reader (sole socio enrichment source — Padron intentionally dropped). Task 3 builds the pure-function Subdiario builder (the heart — heavy TDD with 17+ fixture cases covering scope, join, NC linkage, multi-installment, retenciones, gap detection, sort). Task 4 writes the output via the existing Cobros/Pagos Pendientes sync pattern, creates the workbook lazily, and hooks into `matchAllMovimientos`. Task 5 exposes the rebuild via `POST /api/rebuild-subdiario`. Task 6 adds the Apps Script menu item. Heavy TDD throughout; reuses existing patterns (migration via `insertColumn`, lock via ADV-242 per-sheet `appendRowsWithLinks`, sync hook via the existing `pagos-pendientes` trigger point).

**Scope:** 6 tasks, ~12 production files created/modified, ~6 test files created/modified, ~30+ new tests (most concentrated in Task 3).

**Key Decisions:**
- **Padron dropped entirely** in favour of the Facturador (which already pre-joins Padron data at issuance time). Reduces complexity and removes a stale-data risk surface.
- **Condicion IVA extracted only for ingresos.** Egresos untouched — ADVA's own condition is constant, so no value in extracting from PDFs we issue ourselves.
- **Full-rewrite sync pattern.** Same as `syncPagosPendientes` / `syncCobrosPendientes`. Idempotent. No incremental updates. Performance is fine — ~1400 rows × 13 columns is well within Sheets batch limits.
- **Subdiario builder is a pure function.** All I/O lives in the writer. This makes the builder heavily unit-testable with in-memory fixtures.
- **Single-tab single-year workbook.** No per-year tabs. The current year tab is the only tab. At year boundary, the previous year's data drops out of scope and the sheet repopulates for the new year. (Tax filings already happened off the live data; the manual 2025 workbook remains as historical reference.)
- **Workbook created lazily** on first sync, not at startup. Avoids creating workbooks in dev environments that never run a match cycle.
- **NC cancellation linkage reused from `nc-factura-matcher`.** Don't re-derive the logic; import `extractReferencedFacturaNumber` and combine with same-CUIT + same-amount checks.
- **Gap detection per `(puntoVenta, FC|NC)` stream.** Five concurrent streams observed in production data — they must be checked independently.

**Risks:**
- **Schema migration timing.** If the `condicionIVAReceptor` migration is registered AFTER an existing `factura-store` write tries to write the new column, the write will fail on the unmigrated sheet. Mitigation: migrations run at startup BEFORE any scan request is served; writes only happen after `matchAllMovimientos` first invocation post-boot. Verify ordering in `src/bootstrap/`.
- **Facturador env var.** If `FACTURADOR_SPREADSHEET_ID` is unset in production, all rows get `categoria='-'` and Notas without socio info. Tasks 2 and 5 both handle this gracefully (warn + continue), but a missed deploy step would produce a Subdiario without socio enrichment. Mitigation: documentation in CLAUDE.md ENV VARS table + a startup-time warn log when the var is missing.
- **Gemini extraction accuracy for `condicionIVAReceptor`.** Five enum-like values; should be high accuracy, but garbled values fall through to `needsReview=YES`. Backfill cost (out of scope): ~1400 PDFs × ~$0.0007 per Gemini call ≈ $1, run via `/api/rematch` after deploy.
- **Workbook creation race.** Two parallel `matchAllMovimientos` invocations both trying to create the workbook simultaneously. Mitigated by `PROCESSING_LOCK_ID` (mutually exclusive across scan/match/rebuild-subdiario), but the test in Task 4 must verify the second attempt observes the existing workbook.
- **Cross-year FC E payment TC pago.** When a USD factura issued prior year is paid this year, `TC pago` reflects the current-year bank rate; `TC fact` reflects the prior-year invoice rate. The Notas explicitly shows both — verify the builder doesn't conflate them.

---

## Iteration 1

**Implemented:** 2026-05-12
**Method:** Agent team (4 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1 (ADV-245): condicionIVAReceptor extraction + Facturas Emitidas schema migration v7 (worker-1)
- Task 2 (ADV-246): Facturador de Socios reader service (worker-2)
- Task 3 (ADV-247): Subdiario de Ventas builder pure function — 20 tests covering scope, join, NC linkage, multi-installment, retenciones, gap detection, sort (worker-3)
- Task 4 (ADV-248): Subdiario writer + lazy workbook creation + sync hook in matchAllMovimientos (worker-4)
- Task 5 (ADV-249): POST /api/rebuild-subdiario endpoint with auth + PROCESSING_LOCK (worker-4)
- Task 6 (ADV-250): Apps Script triggerRebuildSubdiario + "Reconstruir Subdiario de Ventas" menu item (worker-4)

### Files Modified
- `src/gemini/prompts.ts` — added condicionIVAReceptor extraction (5 canonical values)
- `src/gemini/parser.ts` — validates against canonical strings; emitida-only; unknown → needsReview
- `src/types/index.ts` — `Factura.condicionIVAReceptor?` + new `BankMovimiento`, `FacturadorEntry`, `SubdiarioRow`, `SubdiarioInput`; `FolderStructure.subdiarioId?`
- `src/constants/spreadsheet-headers.ts` — FACTURA_EMITIDA_HEADERS 20→21 cols; added SUBDIARIO_COMPROBANTES_HEADERS
- `src/processing/storage/factura-store.ts` — condicionIVAReceptor at H(7) for emitida; downstream cells shifted
- `src/services/folder-structure.ts` — migrateFacturasEmitidasCondicionIvaColumn (idempotent insertColumn at index 7); discoverFolderStructure searches for existing Subdiario workbook
- `src/services/migrations.ts` — CURRENT_SCHEMA_VERSION 6→7 + v7 entry registered
- `src/services/facturador-reader.ts` — readFacturador(currentYear) returns Map keyed by normalized comprobante
- `src/services/subdiario-builder.ts` — pure buildSubdiarioRows transform with scope filter, AFIP cod mapping, USD→ARS conversion, Facturador join, NC cancellation lookup, multi-installment aggregation, retencion matching, Notas composition, sort, gap detection
- `src/services/subdiario-writer.ts` — syncSubdiario orchestrator (lazy workbook resolve/create, init Comprobantes sheet, read sources, parse to typed arrays, delegate to builder, full-rewrite write)
- `src/routes/subdiario.ts` — POST /api/rebuild-subdiario with authMiddleware + PROCESSING_LOCK
- `src/server.ts` — registered subdiarioRoutes
- `src/bank/match-movimientos.ts` — syncSubdiario hook after syncCobrosPendientes; parseFacturasEmitidas + parseRetenciones exports; added includeNcNd option + condicionIVAReceptor read
- `src/processing/matching/factura-pago-matcher.ts`, `nc-factura-matcher.ts`, `matching/index.ts` — column-shift fixes for Facturas Emitidas (colOffset=1)
- `apps-script/src/main.ts` — triggerRebuildSubdiario function + menu item
- `src/config.ts` — FACTURADOR_SPREADSHEET_ID getter
- `CLAUDE.md`, `README.md` — FACTURADOR_SPREADSHEET_ID env var documented
- Test files for all of the above

### Linear Updates
- ADV-245: Todo → In Progress → Review
- ADV-246: Todo → Review (worker-2 finished before assignment dispatch)
- ADV-247: Todo → Review (worker-3 finished before assignment dispatch)
- ADV-248: Todo → Review
- ADV-249: Todo → Review
- ADV-250: Todo → Review

### Pre-commit Verification
- bug-hunter: Found 4 bugs (2 HIGH, 1 MEDIUM, 1 LOW). All 4 fixed before commit:
  - HIGH 1: Writer read `Facturas Emitidas!A:T` truncated column U — fixed to `A:U`
  - HIGH 2: parseFacturasEmitidas stripped NCs preventing scope rule (c) — added `includeNcNd` option
  - MEDIUM 3: parseFacturasEmitidas did not read condicionIVAReceptor — added to colIndex
  - LOW 4: nc-factura-matcher row length guard used hardcoded 10 — now `10 + colOffset`
- verifier: 73 test files, 2366 tests pass; TypeScript clean; Apps Script bundle generated; zero warnings

### Work Partition
- Worker 1: Task 1 (ADV-245) — schema/extraction (foundation, L)
- Worker 2: Task 2 (ADV-246) — Facturador reader (M)
- Worker 3: Task 3 (ADV-247) — builder pure function (L, 20 tests)
- Worker 4: Tasks 4+5+6 (ADV-248/249/250) — writer + route + apps script (L+M+S)

### Merge Summary
- Worker 1: salvaged uncommitted changes from worktree + main-worktree leak; merged with no further conflicts
- Worker 2: clean merge
- Worker 3: 1 conflict in src/types/index.ts (both branches added condicionIVAReceptor — kept worker-1 JSDoc)
- Worker 4: 2 add/add conflicts in subdiario-builder.ts and facturador-reader.ts (W4 had stubs; kept W2/W3 real implementations). Required additional lead work: rewrote subdiario-writer.ts to use canonical SubdiarioInput/SubdiarioRow types from src/types/index.ts, added BankMovimiento parsing, and refactored gap detection to use placeholder-row marker (`cliente.startsWith('FALTA ')`) instead of W4's boolean `gap` flag.

### Continuation Status
[All tasks completed.]
