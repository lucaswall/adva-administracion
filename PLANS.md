# Implementation Plan

**Created:** 2026-02-22
**Source:** Inline request: Extract tipoDeCambio, fix USD-USD matching, reprocessing support, better duplicates, factura filename with tipo letter
**Linear Issues:** [ADV-108](https://linear.app/lw-claude/issue/ADV-108), [ADV-109](https://linear.app/lw-claude/issue/ADV-109), [ADV-110](https://linear.app/lw-claude/issue/ADV-110), [ADV-111](https://linear.app/lw-claude/issue/ADV-111), [ADV-112](https://linear.app/lw-claude/issue/ADV-112), [ADV-113](https://linear.app/lw-claude/issue/ADV-113), [ADV-114](https://linear.app/lw-claude/issue/ADV-114)

## Context Gathered

### Codebase Analysis

**TipoDeCambio extraction:**
- `Factura` type (`src/types/index.ts:86-140`): Has `moneda` but no `tipoDeCambio`
- `Pago` type (`src/types/index.ts:145-195`): Has `moneda` but no `tipoDeCambio`/`importeEnPesos`
- Prompts (`src/gemini/prompts.ts`): Neither FACTURA_PROMPT nor PAGO_BBVA_PROMPT ask for exchange rate data
- Headers: Facturas Emitidas 18 cols (A:R), Facturas Recibidas 19 cols (A:S), Pagos Enviados/Recibidos 15 cols (A:O)

**Matching bug (affects both ingresos AND egresos):**
- `amountsMatchCrossCurrency` (`src/utils/exchange-rate.ts:318-373`): No `pagoMoneda` parameter — assumes all pagos are ARS
- Same matcher code (`src/matching/matcher.ts`) handles both ingresos (Facturas Emitidas↔Pagos Recibidos) and egresos (Facturas Recibidas↔Pagos Enviados)
- Production logs: hundreds of "Exchange rate cache miss" errors

**Reprocessing (moving files back to Entrada):**
- `markFileProcessing` (`src/processing/storage/index.ts:43-154`): Already handles known fileIds — updates tracking row instead of creating new one
- Store functions (`isDuplicateFactura`, `isDuplicatePago`): Detect by business key, return `{isDuplicate, existingFileId}` but NOT the row index
- If same fileId is reprocessed, business key check would match → currently returns `{stored: false}` → scanner moves file to Duplicado
- Problem: no way to distinguish "same file reprocessed" from "different file, same transaction"
- Fix: check fileId column BEFORE business key check. If fileId already in sheet → update that row (reprocessing)

**File naming:**
- `generateFacturaFileName` (`src/utils/file-naming.ts:101-145`): Currently produces "Factura Emitida" for all A/B/C/E types — no letter
- NC → "Nota de Credito Emitida" — no letter variant
- `TipoComprobante = 'A' | 'B' | 'C' | 'E' | 'NC' | 'ND' | 'LP'` — NC/ND don't carry the letter
- FACTURA_PROMPT asks for "A/B/C/E/NC/ND/LP" — Gemini returns "NC" not "NC A"

### MCP Context
- **Railway (production):** Confirmed exchange rate cache miss errors affect both ingresos and egresos
- **Google Drive (production):** Verified Factura E has `Exchange Rate: 1429.50`, COMEX pago has `Tipo de Cambio: 1396.25` + `Importe equivalente en Pesos: 1,675,500.00`
- **Linear:** No existing backlog issues

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

**Note:** This fix applies to both ingresos and egresos since both use the same `FacturaPagoMatcher` class. Ingresos: Facturas Emitidas↔Pagos Recibidos. Egresos: Facturas Recibidas↔Pagos Enviados. The single call site in `matcher.ts:142-148` is shared.

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
5. Update the caller in `src/matching/matcher.ts` (line 142-148): pass `pago.moneda` as the new parameter
6. Run `verifier "exchange-rate"` then `verifier "matcher"` (expect pass)

### Task 5: Factura filename with comprobante letter
**Linear Issue:** [ADV-113](https://linear.app/lw-claude/issue/ADV-113/factura-filename-with-comprobante-letter-abce-nc-abc)

**Context:** Current filenames use "Factura Emitida" for all types (A/B/C/E). User needs the letter for quick identification: "Factura C Emitida", "Factura E Emitida". For NC/ND, the letter variant (A/B/C) is also needed: "Nota de Credito A Emitida". Currently `TipoComprobante` stores 'NC' without the letter — Gemini prompt needs to be updated to extract the full type.

1. Write tests in `src/utils/file-naming.test.ts`:
   - Factura with tipoComprobante 'A' → filename contains "Factura A Emitida"
   - Factura with tipoComprobante 'C' → "Factura C Recibida"
   - Factura with tipoComprobante 'E' → "Factura E Emitida"
   - Factura with tipoComprobante 'NC A' → "Nota de Credito A Emitida"
   - Factura with tipoComprobante 'NC B' → "Nota de Credito B Recibida"
   - Factura with tipoComprobante 'ND A' → "Nota de Debito A Emitida"
   - Backward compat: tipoComprobante 'NC' (old format) → "Nota de Credito Emitida" (no letter, graceful)
2. Write tests in `src/gemini/parser.test.ts`:
   - Response with `tipoComprobante: "NC A"` → parsed correctly
   - Response with `tipoComprobante: "ND B"` → parsed correctly
   - Response with `tipoComprobante: "NC"` → still accepted (backward compat)
3. Run `verifier "file-naming"` (expect fail)
4. Update `TipoComprobante` type in `src/types/index.ts`:
   - Expand to: `'A' | 'B' | 'C' | 'E' | 'NC' | 'NC A' | 'NC B' | 'NC C' | 'ND' | 'ND A' | 'ND B' | 'ND C' | 'LP'`
   - Keep plain 'NC'/'ND' for backward compatibility with existing spreadsheet data
5. Update `FACTURA_PROMPT` in `src/gemini/prompts.ts`:
   - Change tipoComprobante instruction to ask for letter variant: "For Notas de Credito, include the letter: NC A, NC B, NC C. For Notas de Debito: ND A, ND B, ND C."
6. Update `validateTipoComprobante` in `src/utils/validation.ts` (or parser):
   - Accept new values ('NC A', 'NC B', 'NC C', 'ND A', 'ND B', 'ND C')
7. Update `generateFacturaFileName` in `src/utils/file-naming.ts`:
   - For A/B/C/E: `Factura ${tipoComprobante} ${direction}` (e.g., "Factura C Emitida")
   - For 'NC A'/'NC B'/'NC C': `Nota de Credito ${letter} ${direction}`
   - For 'ND A'/'ND B'/'ND C': `Nota de Debito ${letter} ${direction}`
   - For plain 'NC'/'ND' (backward compat): `Nota de Credito ${direction}` / `Nota de Debito ${direction}`
   - For 'LP': `Liquidacion de Premio ${direction}`
8. Run `verifier "file-naming"` then `verifier "parser"` (expect pass)

### Task 6: Reprocessing support (stores + scanner)
**Linear Issue:** [ADV-114](https://linear.app/lw-claude/issue/ADV-114/reprocessing-support-re-extract-files-moved-back-to-entrada)

**Context:** When the user moves a previously-processed file from a subfolder back to Entrada, the system should re-extract it and update the existing spreadsheet row rather than treating it as a duplicate. This enables bulk reprocessing (e.g., to populate tipoDeCambio for all existing documents). The file must also be re-sorted to the correct year/month folder and renamed with the current naming convention.

**Flow:** File enters Entrada → `markFileProcessing` updates tracking row (already works) → Gemini extracts → store detects fileId already in sheet → updates existing row → scanner sorts/renames file to correct folder.

1. Write tests in `src/processing/storage/factura-store.test.ts`:
   - Factura with fileId already in sheet → returns `{stored: true, updated: true}`, row data updated via `batchUpdate`
   - Factura with fileId NOT in sheet, no business key match → normal insert (existing behavior)
   - Factura with fileId NOT in sheet, business key matches different fileId → `{stored: false, existingFileId}` (existing duplicate behavior)
2. Write tests in `src/processing/storage/pago-store.test.ts`:
   - Same three scenarios as factura
3. Run `verifier "factura-store"` (expect fail)
4. Add `findRowByFileId(spreadsheetId, sheetName, fileId)` utility (in stores or shared):
   - Read column B (fileId column) from sheet
   - Return `{found: true, rowIndex: number}` or `{found: false}`
   - rowIndex is 1-indexed (for spreadsheet API ranges)
5. Update `storeFactura` in `src/processing/storage/factura-store.ts`:
   - BEFORE the business key duplicate check, call `findRowByFileId`
   - If found: build updated row (same format as new insert), call `batchUpdate` to overwrite the existing row, return `{stored: true, updated: true}`
   - If not found: proceed to existing `isDuplicateFactura` check (no change)
6. Update `storePago` in `src/processing/storage/pago-store.ts`:
   - Same pattern: `findRowByFileId` before `isDuplicatePago`
   - If found: build updated row, `batchUpdate`, return `{stored: true, updated: true}`
7. Add `updated?: boolean` to `StoreResult` type in `src/types/index.ts`
8. Update scanner branches for ALL document types (factura_emitida, factura_recibida, pago_recibido, pago_enviado):
   - When `storeResult.value.stored === true` (whether new or updated), always call `sortAndRenameDocument` to move and rename the file
   - The existing code already does this — `sortAndRenameDocument` is called for `stored === true`, the `else` branch (duplicate) handles `stored === false`
   - **Verify** that `sortAndRenameDocument` works correctly when the file is in Entrada (not in a year/month folder) — it should, since `sortDocument` moves from current parent to target folder
9. Run `verifier` (expect pass)

### Task 7: Better duplicate replaces existing (pagos)
**Linear Issue:** [ADV-112](https://linear.app/lw-claude/issue/ADV-112/better-duplicate-replaces-existing-pagos)

**Context:** When a DIFFERENT file contains the same transaction (same fecha+importe+cuit but different fileId), compare quality. If new is better, replace the existing entry. This is separate from reprocessing (Task 6) which handles same-fileId re-extraction.

1. Write tests in `src/processing/storage/pago-store.test.ts`:
   - Different fileId, same business key, new has tipoDeCambio, existing doesn't → returns `{stored: true, replacedFileId: existingFileId}`
   - Different fileId, same business key, existing has tipoDeCambio, new doesn't → returns `{stored: false, existingFileId}` (existing wins)
   - Different fileId, same business key, equal quality → returns `{stored: false, existingFileId}` (existing wins on tie)
2. Run `verifier "pago-store"` (expect fail)
3. Update `isDuplicatePago` to also return `existingRowIndex` (the 1-indexed row number for batchUpdate)
4. Add `isQualityBetter(newPago, existingRowData)` function to `src/processing/storage/pago-store.ts`:
   - Compare quality signals: (1) has tipoDeCambio > doesn't, (2) has non-empty counterparty CUIT > empty, (3) higher confidence > lower
   - Return `'better' | 'worse' | 'equal'`
5. Modify `storePago`: when duplicate detected (after reprocessing check from Task 6):
   - If quality is better: build new row, `batchUpdate` to overwrite existing row, return `{stored: true, replacedFileId: existingFileId}`
   - If worse or equal: return `{stored: false, existingFileId}` (current behavior)
6. Add `replacedFileId?: string` to `StoreResult` type in `src/types/index.ts`
7. Update duplicate cache read range from `A:H` to full column range to include tipoDeCambio columns for quality comparison
8. Update scanner duplicate branches for `pago_recibido` and `pago_enviado`:
   - Check `storeResult.value.replacedFileId`: if present, the new file replaced an existing one
   - Move the OLD file (replacedFileId) to Duplicado folder
   - Sort/rename the NEW file to correct year/month folder (call `sortAndRenameDocument`)
   - Update dashboard: new file gets `'success'` status; old file needs a tracking entry with `'duplicate'` status
9. Run `verifier "pago-store"` (expect pass)

### Task 8: Documentation
**Linear Issue:** [ADV-110](https://linear.app/lw-claude/issue/ADV-110/schema-migration-docs-for-tipodecambio-columns)

1. Update `SPREADSHEET_FORMAT.md`:
   - Add tipoDeCambio column to Facturas Emitidas (19 cols A:S) and Facturas Recibidas (20 cols A:T) tables
   - Add tipoDeCambio + importeEnPesos columns to Pagos Enviados and Pagos Recibidos (17 cols A:Q) tables
   - Update column counts
   - Update Cross-Currency Matching section to mention same-currency support
   - Document reprocessing behavior
2. Update `CLAUDE.md`:
   - Update column counts in SPREADSHEETS section
   - Update TipoComprobante values (add NC A/B/C, ND A/B/C)
   - Note the matching fix (same-currency support)
   - Document reprocessing capability

## Post-Implementation Checklist

1. Run `bug-hunter` agent — review all git changes for bugs, fix any issues
2. Run `verifier` agent — all tests pass, zero warnings, fix any issues

---

## Plan Summary

**Objective:** Extract exchange rate data, fix USD-USD matching, enable file reprocessing, smarter duplicates, and descriptive factura filenames

**Request:** (1) Extract and store tipo de cambio from COMEX pagos and Factura E. (2) Fix same-currency matching bug (USD↔USD). (3) Enable reprocessing: moving a file back to Entrada re-extracts, updates the row, and re-sorts/renames. (4) Better duplicate replacement for pagos. (5) Factura filenames include comprobante letter ("Factura C Emitida", "Nota de Credito A Emitida").

**Linear Issues:** ADV-108, ADV-109, ADV-110, ADV-111, ADV-112, ADV-113, ADV-114

**Approach:** Five interconnected improvements: (1) tipoDeCambio through the full extraction→storage pipeline with schema migration. (2) Fix `amountsMatchCrossCurrency` with `pagoMoneda` parameter — same-currency uses direct comparison. (3) Store functions check fileId before business key — same fileId updates row (reprocessing), different fileId checks quality (duplicate). (4) Quality comparison for pago duplicates. (5) Expand `TipoComprobante` to carry NC/ND letter variants, update prompts and filename generation.

**Scope:**
- Tasks: 8
- Files affected: ~18
- New tests: yes

**Key Decisions:**
- tipoDeCambio columns appended at end of each sheet to avoid breaking column indices
- Reprocessing check (same fileId) runs BEFORE business key duplicate check — always updates the row
- Better duplicate (different fileId, same business key) only for pagos initially
- `TipoComprobante` expanded with backward-compatible values ('NC' still valid alongside 'NC A')
- Same-currency matching uses direct `amountsMatch()` — no exchange rate needed
- All matching and store changes apply to both ingresos and egresos (shared code)

**Risks/Considerations:**
- Reprocessing bulk files: moving many files to Entrada at once could trigger long processing runs — existing queue handles this but scan duration may be long
- `TipoComprobante` expansion: old rows in spreadsheets have 'NC', new rows have 'NC A' — acceptable, no migration needed since both are valid display values
- Duplicate replacement involves multiple operations (update row, move old file, sort new file) — partial failures need graceful handling
- `findRowByFileId` adds one API call per store operation — acceptable since it's a simple column read, and can share the data already fetched by `isDuplicate*`
