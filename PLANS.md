# Implementation Plan

**Created:** 2026-02-22
**Source:** Inline request: Extract and store tipo de cambio from COMEX pagos and Factura E, fix same-currency matching bug, implement "better duplicate replaces existing" mechanism
**Linear Issues:** [ADV-108](https://linear.app/lw-claude/issue/ADV-108), [ADV-109](https://linear.app/lw-claude/issue/ADV-109), [ADV-110](https://linear.app/lw-claude/issue/ADV-110), [ADV-111](https://linear.app/lw-claude/issue/ADV-111), [ADV-112](https://linear.app/lw-claude/issue/ADV-112)

## Context Gathered

### Codebase Analysis

**TipoDeCambio extraction:**
- `Factura` type (`src/types/index.ts:86-140`): Has `moneda` but no `tipoDeCambio`
- `Pago` type (`src/types/index.ts:145-195`): Has `moneda` but no `tipoDeCambio`/`importeEnPesos`
- `FACTURA_PROMPT` (`src/gemini/prompts.ts:148-265`): Does not ask for exchange rate
- `PAGO_BBVA_PROMPT` (`src/gemini/prompts.ts:270-319`): Does not ask for tipo de cambio or importe en pesos
- Parser validates required fields but has no tipoDeCambio handling
- Extractor (`src/processing/extractor.ts:338-356, 411-427`): Builds objects from parse results, no tipoDeCambio passthrough
- Headers: Facturas Emitidas 18 cols (A:R), Facturas Recibidas 19 cols (A:S), Pagos Enviados/Recibidos 15 cols (A:O)
- Stores: factura-store.ts rows match header counts exactly, pago-store.ts same

**Matching bug:**
- `amountsMatchCrossCurrency` (`src/utils/exchange-rate.ts:318-373`): Signature takes `(facturaAmount, facturaMoneda, facturaFecha, pagoAmount, tolerancePercent)` — no `pagoMoneda`
- Comment says "Payment amount (always in ARS)" — incorrect for COMEX USD pagos
- When both are USD, tries to convert factura USD→ARS via exchange rate, then compares with pago's USD amount → guaranteed mismatch
- Single call site: `src/matching/matcher.ts:142-148` — passes `pago.importePagado` without `pago.moneda`
- Production logs show hundreds of "Exchange rate cache miss" errors for these USD-USD pairs
- Existing tests in `src/utils/exchange-rate.test.ts` and `src/matching/matcher.test.ts` — extensive coverage to update

**Duplicate replacement:**
- Current flow: pago-store.ts `isDuplicatePago` (lines 26-62) checks fecha+importe+cuit → returns `{isDuplicate, existingFileId}` → scanner moves new file to Duplicado
- No quality comparison, no "replace existing" path
- `batchUpdate` in `src/services/sheets.ts:284-305` can update existing rows
- Duplicate cache reads columns A:H — has fileId (B), all core data fields
- Scanner duplicate branches (5+ branches) all follow same pattern: `moveToDuplicadoFolder` → `updateFileStatus('duplicate', ..., existingFileId)`
- Key insight: quality signals include tipoDeCambio presence, non-empty CUITs, confidence score

### MCP Context
- **Railway (production):** Confirmed hundreds of exchange rate cache miss errors in production logs
- **Google Drive (production):** Verified Factura E has `Exchange Rate: 1429.50`, COMEX pago has `Tipo de Cambio: 1396.25` + `Importe equivalente en Pesos: 1,675,500.00`
- **Linear:** No existing backlog issues for these items

## Original Plan

### Task 1: Add tipoDeCambio to types, prompts, and parser
**Linear Issue:** [ADV-108](https://linear.app/lw-claude/issue/ADV-108/extract-tipodecambio-types-prompts-parser)

1. Write tests in `src/gemini/parser.test.ts`:
   - USD factura response with `tipoDeCambio: 1429.5` parses correctly
   - ARS factura response without `tipoDeCambio` → field is undefined
   - USD pago response with `tipoDeCambio: 1396.25` and `importeEnPesos: 1675500` parses correctly
   - ARS pago response without these fields → undefined
   - `tipoDeCambio` with value 0 or negative → treated as undefined
2. Run `verifier "parser"` (expect fail)
3. Add to `Factura` interface in `src/types/index.ts` (after `moneda`):
   - `tipoDeCambio?: number` — Exchange rate for USD invoices (AFIP rate at invoice date)
4. Add to `Pago` interface in `src/types/index.ts` (after `moneda`):
   - `tipoDeCambio?: number` — Exchange rate for cross-currency payments (bank liquidation rate)
   - `importeEnPesos?: number` — Equivalent amount in ARS for cross-currency payments
5. Update `FACTURA_PROMPT` in `src/gemini/prompts.ts` — add to optional fields:
   - tipoDeCambio: Exchange rate for USD invoices (number). Look for "Exchange Rate:", "Tipo de Cambio:", "T.C." Only extract if moneda is USD.
6. Update `PAGO_BBVA_PROMPT` in `src/gemini/prompts.ts` — add to optional fields:
   - tipoDeCambio: Exchange rate for cross-currency payments (number). Look for "Tipo de Cambio:", "T.C.", "Exchange Rate:". Only extract if payment involves currency conversion.
   - importeEnPesos: Equivalent amount in Argentine Pesos (number). Look for "Importe equivalente en Pesos:", "Total en Pesos". Only extract if tipoDeCambio is present.
7. Update `parseFacturaResponse` in `src/gemini/parser.ts` — add validation for tipoDeCambio: accept only positive numbers, else undefined
8. Update `parsePagoResponse` in `src/gemini/parser.ts` — add validation for tipoDeCambio and importeEnPesos: accept only positive numbers, else undefined
9. Run `verifier "parser"` (expect pass)

### Task 2: Update extractor, headers, and stores for tipoDeCambio
**Linear Issue:** [ADV-109](https://linear.app/lw-claude/issue/ADV-109/store-tipodecambio-extractor-headers-stores)

**Migration note:** This adds columns to Control de Ingresos (Facturas Emitidas S, Pagos Recibidos P-Q) and Control de Egresos (Facturas Recibidas T, Pagos Enviados P-Q). Existing production/staging sheets will be migrated by Task 3.

1. Write tests in `src/constants/spreadsheet-headers.test.ts`:
   - `FACTURA_EMITIDA_HEADERS` has 19 elements, last is `'tipoDeCambio'`
   - `FACTURA_RECIBIDA_HEADERS` has 20 elements, last is `'tipoDeCambio'`
   - `PAGO_ENVIADO_HEADERS` has 17 elements, last two are `'tipoDeCambio'`, `'importeEnPesos'`
   - `PAGO_RECIBIDO_HEADERS` has 17 elements, last two are `'tipoDeCambio'`, `'importeEnPesos'`
2. Write tests in `src/processing/storage/factura-store.test.ts`:
   - USD factura with `tipoDeCambio: 1429.5` → row has `CellNumber` at new column position (index 18 for emitida, index 19 for recibida)
   - ARS factura without tipoDeCambio → row has empty string at new column position
3. Write tests in `src/processing/storage/pago-store.test.ts`:
   - USD pago with `tipoDeCambio: 1396.25` and `importeEnPesos: 1675500` → row has `CellNumber` values at positions 15-16
   - ARS pago without these fields → row has empty strings at positions 15-16
4. Run `verifier` (expect fail)
5. Update `src/constants/spreadsheet-headers.ts`:
   - Append `'tipoDeCambio'` to `FACTURA_EMITIDA_HEADERS` (19 cols) and `FACTURA_RECIBIDA_HEADERS` (20 cols)
   - Append `'tipoDeCambio'`, `'importeEnPesos'` to `PAGO_ENVIADO_HEADERS` and `PAGO_RECIBIDO_HEADERS` (17 cols each)
   - Add number formats: `{ type: 'number', decimals: 2 }` for tipoDeCambio, `{ type: 'currency', decimals: 2 }` for importeEnPesos in the relevant `CONTROL_INGRESOS_SHEETS` and `CONTROL_EGRESOS_SHEETS` format definitions
6. Update `src/processing/extractor.ts`:
   - Factura object (line ~352 area): pass through `tipoDeCambio: parseResult.value.data.tipoDeCambio`
   - Pago object (line ~423 area): pass through `tipoDeCambio` and `importeEnPesos`
7. Update `src/processing/storage/factura-store.ts`:
   - Import `CellNumber` type from sheets
   - factura_emitida row (lines 130-156): append tipoDeCambio as `CellNumber` or empty string after hasCuitMatch. Change range from `A:R` to `A:S`
   - factura_recibida row (lines 160-180): append tipoDeCambio after pagada. Change range from `A:S` to `A:T`
8. Update `src/processing/storage/pago-store.ts`:
   - Import `CellNumber` type from sheets
   - Both pago_enviado (lines 130-146) and pago_recibido (lines 150-166): append tipoDeCambio + importeEnPesos as `CellNumber` or empty string. Change ranges from `A:O` to `A:Q`
9. Run `verifier` (expect pass)

### Task 3: Schema migration for tipoDeCambio columns
**Linear Issue:** [ADV-110](https://linear.app/lw-claude/issue/ADV-110/schema-migration-docs-for-tipodecambio-columns)

**Migration note:** Existing production sheets (Facturas Emitidas 18 cols, Facturas Recibidas 19 cols, Pagos Enviados/Recibidos 15 cols) need new headers appended. Migration must be idempotent.

1. Write tests in `src/services/folder-structure.test.ts`:
   - `migrateControlIngresosHeaders`: 18-col Facturas Emitidas gets `tipoDeCambio` appended at S; 15-col Pagos Recibidos gets `tipoDeCambio`+`importeEnPesos` appended at P-Q
   - `migrateControlEgresosHeaders`: 19-col Facturas Recibidas gets `tipoDeCambio` appended at T; 15-col Pagos Enviados gets `tipoDeCambio`+`importeEnPesos` appended at P-Q
   - Already-migrated sheets (correct column count) are skipped (idempotent)
   - Empty sheets are skipped
2. Run `verifier "folder-structure"` (expect fail)
3. Implement `migrateControlIngresosHeaders(spreadsheetId)` and `migrateControlEgresosHeaders(spreadsheetId)` in `src/services/folder-structure.ts`:
   - Follow `migrateArchivosProcesadosHeaders` pattern (lines 332-361): read header row → check column count → append missing headers
   - Facturas Emitidas: if exactly 18 cols, append `tipoDeCambio` at S1
   - Facturas Recibidas: if exactly 19 cols, append `tipoDeCambio` at T1
   - Pagos Recibidos/Enviados: if exactly 15 cols, append `tipoDeCambio` and `importeEnPesos` at P1:Q1
4. Call both migration functions in `discoverFolderStructure()` after the `ensureSheetsExist` calls (~line 770-774)
5. Run `verifier "folder-structure"` (expect pass)

### Task 4: Fix amountsMatchCrossCurrency for same-currency matching
**Linear Issue:** [ADV-111](https://linear.app/lw-claude/issue/ADV-111/fix-same-currency-matching-usd-usd-in-amountsmatchcrosscurrency)

1. Write tests in `src/utils/exchange-rate.test.ts`:
   - USD factura + USD pago with matching amounts → `{matches: true, isCrossCurrency: false}` (same-currency, no exchange rate needed)
   - USD factura + USD pago with non-matching amounts → `{matches: false, isCrossCurrency: false}`
   - USD factura + ARS pago → existing cross-currency behavior (uses exchange rate, tolerance)
   - ARS factura + ARS pago → existing exact match behavior (unchanged)
2. Update tests in `src/matching/matcher.test.ts`:
   - Test that USD pago matching USD factura uses direct comparison (no exchange rate fetch)
   - Update any existing cross-currency tests that need the new `pagoMoneda` parameter
3. Run `verifier "exchange-rate"` (expect fail)
4. Update `amountsMatchCrossCurrency` in `src/utils/exchange-rate.ts`:
   - Add `pagoMoneda: Moneda` parameter after `pagoAmount`
   - When `facturaMoneda === pagoMoneda` (same currency): use `amountsMatch()` regardless of currency, return `{matches, isCrossCurrency: false}`
   - When currencies differ: existing cross-currency logic (exchange rate lookup + tolerance)
   - Update `CrossCurrencyMatchResult` if needed (the `isCrossCurrency` flag already exists)
5. Update the caller in `src/matching/matcher.ts` (line 142-148): pass `pago.moneda` as the new parameter
6. Run `verifier "exchange-rate"` then `verifier "matcher"` (expect pass)

### Task 5: Better duplicate replaces existing (pagos)
**Linear Issue:** [ADV-112](https://linear.app/lw-claude/issue/ADV-112/better-duplicate-replaces-existing-pagos)

1. Write tests in `src/processing/storage/pago-store.test.ts`:
   - New pago with tipoDeCambio vs existing without → returns `{stored: true, replacedFileId: existingFileId}` (new is better)
   - New pago without tipoDeCambio vs existing with → returns `{stored: false, existingFileId}` (existing is better, current behavior)
   - New pago identical quality → returns `{stored: false, existingFileId}` (existing wins on tie)
   - New pago with more populated counterparty fields vs existing with fewer → new wins
2. Run `verifier "pago-store"` (expect fail)
3. Add `isQualityBetter(newPago, existingRowData)` function to `src/processing/storage/pago-store.ts`:
   - Compare quality signals in priority order: (1) has tipoDeCambio > doesn't, (2) has non-empty counterparty CUIT > empty, (3) higher confidence > lower
   - Return `'better' | 'worse' | 'equal'`
   - Existing row data available from duplicate cache/check (columns A:H plus new tipoDeCambio columns)
4. Modify `storePago` flow: when duplicate detected AND new is better quality:
   - Instead of returning `{stored: false}`, proceed to update the existing spreadsheet row via `batchUpdate`
   - Return `{stored: true, replacedFileId: existingFileId}` (new return variant)
5. Add `replacedFileId?: string` to `StoreResult` type in `src/types/index.ts`
6. Update duplicate cache read range from `A:H` to `A:Q` to include new tipoDeCambio columns
7. Run `verifier "pago-store"` (expect pass)

### Task 6: Scanner support for duplicate replacement
**Linear Issue:** [ADV-112](https://linear.app/lw-claude/issue/ADV-112/better-duplicate-replaces-existing-pagos)

1. Write tests or verify existing scanner test coverage for the replacement path
2. Update scanner duplicate branches for `pago_recibido` and `pago_enviado` (lines ~1141-1186, ~1260-1305):
   - Check `storeResult.value.replacedFileId`: if present, the new file replaced an existing one
   - Move the OLD file (replacedFileId) to Duplicado folder instead of the new file
   - Move the NEW file to the year/month folder (normal storage path)
   - Update dashboard: new file gets `'success'` status; old file gets `'duplicate'` status with `originalFileId` pointing to new file
   - Log the replacement event
3. If `storeResult.value.replacedFileId` is absent, keep current behavior (move new file to Duplicado)
4. Run `verifier` (expect pass)

### Task 7: Documentation
**Linear Issue:** [ADV-110](https://linear.app/lw-claude/issue/ADV-110/schema-migration-docs-for-tipodecambio-columns)

1. Update `SPREADSHEET_FORMAT.md`:
   - Add tipoDeCambio column to Facturas Emitidas (19 cols A:S) and Facturas Recibidas (20 cols A:T) tables
   - Add tipoDeCambio + importeEnPesos columns to Pagos Enviados and Pagos Recibidos (17 cols A:Q) tables
   - Update column counts
   - Update Cross-Currency Matching section to mention same-currency support
2. Update `CLAUDE.md`:
   - Update column counts in SPREADSHEETS section
   - Note the matching fix (same-currency support)

## Post-Implementation Checklist

1. Run `bug-hunter` agent — review all git changes for bugs, fix any issues
2. Run `verifier` agent — all tests pass, zero warnings, fix any issues

---

## Plan Summary

**Objective:** Extract exchange rate data from documents, fix USD-USD matching, and enable smarter duplicate replacement

**Request:** Extract and store tipo de cambio from COMEX pagos and Factura E documents. Fix the matching bug where USD pagos can't match USD facturas because the matcher assumes all pagos are ARS. Implement "better duplicate replaces existing" so higher-quality documents aren't discarded.

**Linear Issues:** ADV-108, ADV-109, ADV-110, ADV-111, ADV-112

**Approach:** Three interconnected improvements: (1) Add tipoDeCambio/importeEnPesos fields through the full extraction→storage pipeline with schema migration for existing spreadsheets. (2) Fix `amountsMatchCrossCurrency` by adding a `pagoMoneda` parameter — when currencies match, use direct comparison instead of exchange rate conversion. (3) Add quality comparison to pago duplicate detection so a document with more data (e.g., tipoDeCambio, signed status) replaces a less complete one.

**Scope:**
- Tasks: 7
- Files affected: ~15
- New tests: yes

**Key Decisions:**
- tipoDeCambio columns appended at end of each sheet to avoid breaking existing column indices
- Same-currency matching (USD-USD) uses direct `amountsMatch()` — no exchange rate needed
- Duplicate quality comparison uses tipoDeCambio presence as primary signal, counterparty CUIT presence as secondary
- Only pago duplicates get replacement logic initially (facturas have stronger business keys — nroFactura — making quality differences rarer)

**Risks/Considerations:**
- Duplicate replacement involves multiple atomic operations (update row, move old file, move new file) — partial failures must be handled gracefully
- Duplicate cache read range expansion (A:H → A:Q) slightly increases memory usage per scan
- Exchange rate tests need careful update — the function signature change affects all call sites and test mocks
