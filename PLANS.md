# Implementation Plan

**Created:** 2026-03-03
**Source:** Inline request: Add pagada column to Facturas Emitidas, Cobros Pendientes dashboard, and movimientos→pagada sync
**Linear Issues:** [ADV-169](https://linear.app/lw-claude/issue/ADV-169/add-pagada-column-to-facturas-emitidas-schema-and-storage), [ADV-170](https://linear.app/lw-claude/issue/ADV-170/add-pagada-handling-to-factura-pago-matcher-for-ingresos), [ADV-171](https://linear.app/lw-claude/issue/ADV-171/add-nc-matching-for-facturas-emitidas-ingresos), [ADV-172](https://linear.app/lw-claude/issue/ADV-172/add-cobros-pendientes-dashboard-sheet-and-sync-service), [ADV-173](https://linear.app/lw-claude/issue/ADV-173/mark-facturas-as-pagada-from-movimientos-matching), [ADV-174](https://linear.app/lw-claude/issue/ADV-174/startup-migration-for-facturas-emitidas-pagada-column), [ADV-175](https://linear.app/lw-claude/issue/ADV-175/update-documentation-for-pagada-ingresos-and-cobros-pendientes)
**Branch:** feat/pagada-ingresos-cobros-pendientes

## Context Gathered

### Codebase Analysis

- **Existing pagada pattern (Egresos):** Facturas Recibidas has `pagada` column at index S (19th col). Set to 'SI'/'NO'/empty. Written by `factura-pago-matcher.ts:580` (match creates → 'SI', unmatch → 'NO') and `nc-factura-matcher.ts:243` (NC cancellation → 'SI'). Initial value is empty string (`factura-store.ts:76`).
- **Facturas Emitidas layout (Ingresos):** Currently 19 columns A:S. `tipoDeCambio` is at S (index 18). Adding `pagada` at S shifts `tipoDeCambio` to T, making it 20 columns A:T — identical layout to Facturas Recibidas.
- **Pagos Pendientes service:** `src/services/pagos-pendientes.ts` reads Facturas Recibidas, filters `pagada !== 'SI'`, writes to Dashboard "Pagos Pendientes" sheet. Called from `src/processing/matching/index.ts:192` after all matching completes.
- **NC matcher:** `src/processing/matching/nc-factura-matcher.ts` currently hardcoded to Facturas Recibidas only (sheet name, column S for pagada at index 18). Needs to also handle Facturas Emitidas with same logic.
- **Movimientos matching:** `src/bank/match-movimientos.ts` reads both Control sheets, matches bank movements to documents, writes only to movimientos rows (columns G-I). Does NOT write back `pagada` to Control sheets. The `matchBankMovimientos` function processes all banks sequentially and produces `DetalleUpdate[]` for each bank.
- **Factura-Pago matcher:** `src/processing/matching/factura-pago-matcher.ts:573-592` writes match updates. For Facturas Recibidas: writes P:S (includes pagada). For Facturas Emitidas: writes P:R (no pagada). Needs to write P:S for Emitidas too.
- **Cascade matcher:** `src/matching/cascade-matcher.ts:78-95` defines `MatchUpdate` interface with `pagada?: boolean`. `buildFacturaMatchUpdate` at line 162 defaults `pagada: true`.
- **Spreadsheet headers:** `src/constants/spreadsheet-headers.ts` — `FACTURA_EMITIDA_HEADERS` needs `pagada` inserted before `tipoDeCambio`.
- **Number format configs:** `CONTROL_INGRESOS_SHEETS[0].numberFormats` maps index 18 to tipoDeCambio format. After inserting pagada, tipoDeCambio moves to index 19.
- **Column ranges in match-movimientos.ts:** `loadControlIngresos` reads `Facturas Emitidas!A:S` — needs to become `A:T` after adding pagada column.
- **Test files:** `src/services/pagos-pendientes.test.ts`, `src/processing/matching/factura-pago-matcher.test.ts`, `src/processing/matching/nc-factura-matcher.test.ts`, `src/bank/match-movimientos.test.ts`, `src/processing/storage/factura-store.test.ts`.

### Key Design Decisions

1. **pagada column position:** Insert at S in Facturas Emitidas (same position as Facturas Recibidas). `tipoDeCambio` moves from S→T.
2. **NC matching for Ingresos:** Generalize `matchNCsWithFacturas` to accept spreadsheetId + sheet config, or create a second call in `runMatching` for Control de Ingresos. The NC matcher needs to know column positions, so passing the sheet name and pagada column index is cleanest.
3. **Movimientos → pagada sync:** After `matchBankMovimientos` produces its updates, collect matched facturas (both emitidas and recibidas) and batch-write `pagada='SI'` to the Control sheets. This runs as a post-processing step within `matchAllMovimientos`, using the control spreadsheet IDs already available.
4. **Cobros Pendientes:** Mirror of Pagos Pendientes. Same 10-column schema but with Receptor counterparty fields instead of Emisor. New sheet in Dashboard, new sync function, new headers constant.
5. **Migration:** Existing Facturas Emitidas rows have 19 columns. Startup migration adds `pagada` header and shifts data. Pattern follows existing `migrateArchivosProcesadosHeaders`.

## Tasks

### Task 1: Add pagada column to Facturas Emitidas schema and storage
**Linear Issue:** [ADV-169](https://linear.app/lw-claude/issue/ADV-169/add-pagada-column-to-facturas-emitidas-schema-and-storage)
**Files:**
- `src/constants/spreadsheet-headers.ts` (modify)
- `src/processing/storage/factura-store.ts` (modify)
- `src/processing/storage/factura-store.test.ts` (modify)

**Steps:**
1. Write tests in `src/processing/storage/factura-store.test.ts`:
   - Test that `buildFacturaRowFormatted` for `factura_emitida` produces 20 columns (A:T) with `pagada` at S (empty initially) and `tipoDeCambio` at T
   - Test that `storeFactura` uses range `A:T` for factura_emitida (not `A:S`)
2. Run verifier with pattern "factura-store" (expect fail)
3. Implement changes:
   - In `spreadsheet-headers.ts`: Insert `'pagada'` before `'tipoDeCambio'` in `FACTURA_EMITIDA_HEADERS` (making it 20 items)
   - In `spreadsheet-headers.ts`: Update `CONTROL_INGRESOS_SHEETS[0].numberFormats` — tipoDeCambio moves from index 18 to index 19
   - In `factura-store.ts`: Update `buildFacturaRowFormatted` for `factura_emitida` branch — add `''` (empty string) for pagada at S position, before tipoDeCambioCell
   - In `factura-store.ts`: Update `lastCol` for factura_emitida from `'S'` to `'T'` (reprocessing path)
   - In `factura-store.ts`: Update append range from `A:S` to `A:T` for factura_emitida
4. Run verifier with pattern "factura-store" (expect pass)

**Migration note:** Existing Facturas Emitidas rows have 19 columns (A:S) without `pagada`. Need startup migration to insert the header and shift existing data. See Task 6.

### Task 2: Add pagada handling to factura-pago matcher for Ingresos
**Linear Issue:** [ADV-170](https://linear.app/lw-claude/issue/ADV-170/add-pagada-handling-to-factura-pago-matcher-for-ingresos)
**Files:**
- `src/processing/matching/factura-pago-matcher.ts` (modify)
- `src/processing/matching/factura-pago-matcher.test.ts` (modify)

**Steps:**
1. Write tests in `factura-pago-matcher.test.ts`:
   - Test that matching Facturas Emitidas writes columns P:S (4 columns: matchedPagoFileId, matchConfidence, hasCuitMatch, pagada) — same as Facturas Recibidas
   - Test that unmatching Facturas Emitidas clears columns P:S (4 empty values)
   - Test that displacement on Facturas Emitidas sets pagada='NO' on displaced factura
2. Run verifier with pattern "factura-pago-matcher" (expect fail)
3. Implement in `factura-pago-matcher.ts`:
   - In `doMatchFacturasWithPagos`: Update `facturasRange` for Facturas Emitidas from `A:S` to `A:T`
   - In the batch update section (lines 583-592): Change the Facturas Emitidas branch to write P:S (include pagada) instead of P:R, mirroring the Facturas Recibidas branch
   - In the unmatch section (lines 613-617): Change the Facturas Emitidas branch to clear P:S (4 empty values) instead of P:R (3 empty values)
4. Run verifier with pattern "factura-pago-matcher" (expect pass)

### Task 3: Add NC matching for Facturas Emitidas (Ingresos)
**Linear Issue:** [ADV-171](https://linear.app/lw-claude/issue/ADV-171/add-nc-matching-for-facturas-emitidas-ingresos)
**Files:**
- `src/processing/matching/nc-factura-matcher.ts` (modify)
- `src/processing/matching/nc-factura-matcher.test.ts` (modify)
- `src/processing/matching/index.ts` (modify)

**Steps:**
1. Write tests in `nc-factura-matcher.test.ts`:
   - Test that `matchNCsWithFacturas` works with Facturas Emitidas — matches NC Emitida with Factura Emitida by `cuitReceptor`, sets pagada='SI'
   - Test that MANUAL NCs in Facturas Emitidas are skipped
   - Test that MANUAL Facturas Emitidas are excluded from matching
   - Test that pagada column is read/written at the correct index for Facturas Emitidas (S = index 18, same position but different total column count)
2. Run verifier with pattern "nc-factura-matcher" (expect fail)
3. Implement:
   - Generalize `matchNCsWithFacturas` to accept sheet name and column configuration. The function currently hardcodes `'Facturas Recibidas'`, column indices, and `cuitEmisor` as the CUIT field. Refactor to accept parameters: `sheetName` ('Facturas Recibidas' | 'Facturas Emitidas'), `cuitField` ('cuitEmisor' | 'cuitReceptor'), `readRange` ('A:S' for Recibidas which has pagada at S/18, 'A:T' for Emitidas which has pagada at S/18), `pagadaColumnLetter` ('S' for both)
   - In `src/processing/matching/index.ts`: Add a second call to `matchNCsWithFacturas` for Control de Ingresos after the existing Egresos call. Pass `controlIngresosId`, `'Facturas Emitidas'`, `'cuitReceptor'` and appropriate range
4. Run verifier with pattern "nc-factura-matcher" (expect pass)

**Notes:**
- The pagada column is at index S in both Facturas Recibidas and Facturas Emitidas (after Task 1 adds it). The CUIT field to match differs: `cuitEmisor` for Recibidas (same supplier), `cuitReceptor` for Emitidas (same client).
- The read range differs: Recibidas uses A:S (pagada is last at index 18), Emitidas uses A:T (pagada at index 18, tipoDeCambio at index 19).

### Task 4: Add Cobros Pendientes dashboard sheet and sync service
**Linear Issue:** [ADV-172](https://linear.app/lw-claude/issue/ADV-172/add-cobros-pendientes-dashboard-sheet-and-sync-service)
**Files:**
- `src/constants/spreadsheet-headers.ts` (modify)
- `src/services/pagos-pendientes.ts` (modify — rename or extend)
- `src/services/pagos-pendientes.test.ts` (modify)
- `src/processing/matching/index.ts` (modify)

**Steps:**
1. Write tests in `pagos-pendientes.test.ts`:
   - Test `syncCobrosPendientes`: reads Facturas Emitidas, filters `pagada !== 'SI'`, writes to Dashboard "Cobros Pendientes" sheet
   - Test column mapping: fechaEmision, fileId, fileName, tipoComprobante, nroFactura, cuitReceptor, razonSocialReceptor, importeTotal, moneda, concepto (10 columns — same structure as Pagos Pendientes but with Receptor counterparty)
   - Test that facturas with pagada='SI' are excluded
   - Test that NCs/NDs are excluded from Cobros Pendientes
   - Test sort order: ascending by fechaEmision (oldest first)
   - Test empty sheet handling
   - Test missing column handling
2. Run verifier with pattern "pagos-pendientes" (expect fail)
3. Implement:
   - In `spreadsheet-headers.ts`: Add `COBROS_PENDIENTES_HEADERS` constant — same 10 fields but with `cuitReceptor` and `razonSocialReceptor` instead of `cuitEmisor`/`razonSocialEmisor`
   - Add "Cobros Pendientes" sheet config to `DASHBOARD_OPERATIVO_SHEETS` array
   - In `pagos-pendientes.ts`: Add `syncCobrosPendientes(controlIngresosId, dashboardId)` function — follows same pattern as `syncPagosPendientes` but reads from Facturas Emitidas (A:T range), uses `cuitReceptor`/`razonSocialReceptor` columns, filters pagada !== 'SI' AND excludes NC/ND tipoComprobante, writes to "Cobros Pendientes" sheet
   - In `index.ts` (matching orchestrator): After calling `syncPagosPendientes`, also call `syncCobrosPendientes(controlIngresosId, dashboardId)`
4. Run verifier with pattern "pagos-pendientes" (expect pass)

**Migration note:** Dashboard Operativo needs a new "Cobros Pendientes" sheet. Startup migration should detect missing sheet and create it with headers. Follow the existing `ensureSheetExists` pattern used during folder structure setup.

### Task 5: Mark facturas as pagada from movimientos matching
**Linear Issue:** [ADV-173](https://linear.app/lw-claude/issue/ADV-173/mark-facturas-as-pagada-from-movimientos-matching)
**Files:**
- `src/bank/match-movimientos.ts` (modify)
- `src/bank/match-movimientos.test.ts` (modify)
- `src/services/sheets.ts` (verify `setValues` or `batchUpdate` is available)

**Steps:**
1. Write tests in `match-movimientos.test.ts`:
   - Test that when a DEBIT movimiento matches a Factura Recibida, `pagada='SI'` is written to Control de Egresos at the correct cell (column S, factura's row)
   - Test that when a CREDIT movimiento matches a Factura Emitida, `pagada='SI'` is written to Control de Ingresos at the correct cell (column S, factura's row)
   - Test that when a movimiento matches a Pago (not a factura directly), no pagada update is made (pagos don't have pagada column)
   - Test that MANUAL factura matches (matchConfidence='MANUAL') are not overwritten — the pagada update is skipped when matchConfidence is already MANUAL
   - Test that bank fee and credit card payment auto-labels do not trigger pagada updates
   - Test that pagada updates use `batchUpdate` for efficiency (single API call for all pagada updates per bank)
   - Test that pagada is only set to 'SI', never to 'NO' or empty (write-only-SI from movimientos context)
2. Run verifier with pattern "match-movimientos" (expect fail)
3. Implement in `match-movimientos.ts`:
   - Add a new interface `PagadaUpdate` with fields: `spreadsheetId`, `sheetName`, `rowNumber`, `columnLetter` (always 'S')
   - In `matchBankMovimientos`: After processing all movimientos and collecting `DetalleUpdate[]`, also collect `PagadaUpdate[]` — when `shouldUpdate` is true and the matched document is a factura (emitida or recibida), add a pagada update. Use the `documentMap` to look up the matched document and determine its type and row. Only update if the factura's matchConfidence is not 'MANUAL'.
   - After writing detalle updates, batch-write all pagada updates using `batchUpdate` to the appropriate Control spreadsheet (controlIngresosId for factura_emitida, controlEgresosId for factura_recibida). The spreadsheet IDs must be passed down to `matchBankMovimientos` — currently it only receives data arrays, not IDs. Add `controlIngresosId` and `controlEgresosId` as parameters.
   - Guard: Only set `pagada='SI'`, never clear it. The movimientos context only confirms payment (bank movement = money moved), never negates it.
4. Run verifier with pattern "match-movimientos" (expect pass)

**Notes:**
- The movimientos matcher already has access to the parsed factura data (including row numbers) via `ingresosData` and `egresosData`. The `documentMap` lookup gives both the row and the type.
- Pagada updates from movimientos are independent of the detalle updates — they go to different spreadsheets (Control sheets vs bank Movimientos sheets).
- A single factura could match multiple bank movements across different banks. The update is idempotent (always 'SI'), so duplicates are harmless.

### Task 6: Startup migration for Facturas Emitidas pagada column
**Linear Issue:** [ADV-174](https://linear.app/lw-claude/issue/ADV-174/startup-migration-for-facturas-emitidas-pagada-column)
**Files:**
- `src/services/folder-structure.ts` (modify)
- `src/services/folder-structure.test.ts` or new test file (modify)

**Steps:**
1. Write tests:
   - Test that migration detects old 19-column Facturas Emitidas (no `pagada` header) and adds it at position S, shifting tipoDeCambio to T
   - Test that migration is idempotent — running on already-migrated sheet does nothing
   - Test that existing data in tipoDeCambio column is preserved after shift
2. Run verifier (expect fail)
3. Implement migration function `migrateFacturasEmitidasHeaders`:
   - Read header row of "Facturas Emitidas" from Control de Ingresos
   - Check if `pagada` header exists. If yes, skip (already migrated)
   - If `pagada` is missing: insert column at position S (shift tipoDeCambio right), set header to `pagada`. Use Google Sheets API `insertDimension` + header write, or use the batch approach to read all data, insert column, write back.
   - Follow pattern of existing `migrateArchivosProcesadosHeaders` in folder-structure.ts
   - Call this migration during startup folder structure setup, after ensuring sheets exist
4. Run verifier (expect pass)

**Migration note:** Production Facturas Emitidas has existing rows with 19 columns. The migration must insert a column (not append) so existing tipoDeCambio values are preserved. Google Sheets `insertDimension` API shifts existing columns right automatically.

### Task 7: Update documentation
**Linear Issue:** [ADV-175](https://linear.app/lw-claude/issue/ADV-175/update-documentation-for-pagada-ingresos-and-cobros-pendientes)
**Files:**
- `SPREADSHEET_FORMAT.md` (modify)
- `CLAUDE.md` (modify)

**Steps:**
1. Update `SPREADSHEET_FORMAT.md`:
   - Facturas Emitidas: Add `pagada` at column S, shift `tipoDeCambio` to T, update column count from 19 to 20 (A:T)
   - Dashboard: Add "Cobros Pendientes" section with schema (10 columns, same as Pagos Pendientes but with Receptor fields)
   - Movimientos: Document that matching now sets `pagada='SI'` on matched facturas in both Control sheets
2. Update `CLAUDE.md`:
   - Structure section: Update Facturas Emitidas column count
   - Spreadsheets section: Add Cobros Pendientes reference
   - Matching section: Document movimientos→pagada sync behavior
3. No test needed for documentation changes.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add payment tracking to Control de Ingresos (Facturas Emitidas) and create a Cobros Pendientes dashboard, mirroring the existing Egresos/Pagos Pendientes pattern. Additionally, mark facturas as paid when bank movements match them.

**Linear Issues:** ADV-169, ADV-170, ADV-171, ADV-172, ADV-173, ADV-174, ADV-175

**Approach:** Add `pagada` column to Facturas Emitidas (same position S as Facturas Recibidas), extend factura-pago matching and NC matching to write pagada for the Ingresos direction, create Cobros Pendientes dashboard sheet with sync service mirroring Pagos Pendientes, and add a post-processing step to movimientos matching that writes `pagada='SI'` back to Control sheets when facturas are matched from bank data.

**Scope:**
- Tasks: 7
- Files affected: ~14 (source + tests + docs)
- New tests: yes (all tasks include TDD)

**Key Decisions:**
- pagada column at S in both Facturas sheets (consistent position)
- Movimientos only set pagada='SI', never clear it (bank evidence is additive)
- NC matching generalized to work with both Ingresos and Egresos
- Startup migration uses insertDimension to preserve existing tipoDeCambio data

**Risks/Considerations:**
- Spreadsheet column shift migration must handle production data correctly — insertDimension is the safe approach
- Movimientos pagada sync adds cross-sheet writes — needs error handling that doesn't fail the main matching flow
- Multiple banks could set pagada='SI' on the same factura — idempotent so no conflict
