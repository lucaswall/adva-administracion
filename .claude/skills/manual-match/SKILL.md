---
name: manual-match
description: Manually match documents, fix matches, unmatch, show unmatched/low-confidence items, move files, rename files. Use when user says "manual match", "fix match", "unmatch", "link factura", "link pago", "show unmatched", "review matches", "move file", "rename file", "fix document".
argument-hint: <action and context, e.g. "show unmatched facturas recibidas" or "match factura X with pago Y">
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, mcp__gdrive__gdrive_search, mcp__gdrive__gdrive_read_file, mcp__gdrive__gdrive_list_folder, mcp__gdrive__gdrive_get_pdf, mcp__gdrive__gsheets_read, mcp__gdrive__gsheets_update, mcp__gdrive__gdrive_move_file, mcp__gdrive__gdrive_rename_file
---

Manually match documents, fix matches, move/rename files in ADVA's Control de Ingresos/Egresos spreadsheets.

## Step 1: Environment Selection

Read `.env` from the project root to find folder IDs:
- `DRIVE_ROOT_FOLDER_ID_PRODUCTION`
- `DRIVE_ROOT_FOLDER_ID_STAGING`

If **both** are set, ask the user which environment (production or staging).
If **only one** is set, use it.
If **neither**, fall back to `DRIVE_ROOT_FOLDER_ID`.

## Step 2: Find Spreadsheets

Use `gdrive_list_folder` on the selected root folder. Locate:
- **Control de Ingresos** (spreadsheet) — contains Facturas Emitidas, Pagos Recibidos, Retenciones Recibidas
- **Control de Egresos** (spreadsheet) — contains Facturas Recibidas, Pagos Enviados, Recibos

Save their spreadsheet IDs for subsequent operations.

## Step 3: Interpret Request

Parse `$ARGUMENTS` to determine the action:

| Action | Triggers | Description |
|--------|----------|-------------|
| **Show unmatched** | "show unmatched", "unmatched" | Rows where match fileId column is empty |
| **Show low-confidence** | "low confidence", "medium confidence" | Rows where matchConfidence is MEDIUM or LOW |
| **Show needs review** | "needs review", "review" | Rows where needsReview is TRUE |
| **Match** | "match", "link" | Link two documents together |
| **Unmatch** | "unmatch", "unlink", "clear match" | Remove a match link |
| **Move file** | "move file", "move to" | Move file to different folder |
| **Rename file** | "rename file", "rename to" | Rename a file |

### Scoped Queries

Users can filter by:
- **Sheet name**: "facturas emitidas", "pagos recibidos", etc.
- **Date range**: "from 2025-01-01 to 2025-06-30", "last month"
- **CUIT**: "CUIT 20123456786"
- **Company name**: "EMPRESA X"
- **Amount range**: "over 100000", "between 50000 and 200000"

When reading sheets, use `gsheets_read` with specific ranges to minimize data. For large sheets, read the header row first, then filter by date or other criteria.

## Step 4: Matching Operations

When matching two documents, update **BOTH sides** of the link and set `matchConfidence=MANUAL`.

### Column Reference

**Control de Ingresos** (spreadsheet):

| Sheet | matchFileId col | matchConfidence col | Notes |
|-------|----------------|-------------------|-------|
| Facturas Emitidas | P (matchedPagoFileId) | Q (matchConfidence) | Links to Pago Recibido |
| Pagos Recibidos | N (matchedFacturaFileId) | O (matchConfidence) | Links to Factura Emitida |
| Retenciones Recibidas | N (matchedFacturaFileId) | O (matchConfidence) | Links to Factura Emitida |

**Control de Egresos** (spreadsheet):

| Sheet | matchFileId col | matchConfidence col | Extra cols | Notes |
|-------|----------------|-------------------|-----------|-------|
| Facturas Recibidas | P (matchedPagoFileId) | Q (matchConfidence) | S (pagada) | Links to Pago Enviado |
| Pagos Enviados | N (matchedFacturaFileId) | O (matchConfidence) | | Links to Factura/Recibo |
| Recibos | Q (matchedPagoFileId) | R (matchConfidence) | | Links to Pago Enviado |

### Match Types

**Ingresos: Factura Emitida <-> Pago Recibido**
1. Find the FE row (by fileId, nroFactura, or row number) — note its row number and fileId
2. Find the PR row — note its row number and fileId
3. Update via `gsheets_update`:
   - `'Facturas Emitidas'!P{row}` = PR fileId
   - `'Facturas Emitidas'!Q{row}` = MANUAL
   - `'Pagos Recibidos'!N{row}` = FE fileId
   - `'Pagos Recibidos'!O{row}` = MANUAL

**Ingresos: Retencion Recibida -> Factura Emitida**
1. Find the RR row — note its row number
2. Find the FE row — note its fileId
3. Update:
   - `'Retenciones Recibidas'!N{row}` = FE fileId
   - `'Retenciones Recibidas'!O{row}` = MANUAL

**Egresos: Factura Recibida <-> Pago Enviado**
1. Find the FR row — note its row number and fileId
2. Find the PE row — note its row number and fileId
3. Update:
   - `'Facturas Recibidas'!P{row}` = PE fileId
   - `'Facturas Recibidas'!Q{row}` = MANUAL
   - `'Facturas Recibidas'!S{row}` = SI
   - `'Pagos Enviados'!N{row}` = FR fileId
   - `'Pagos Enviados'!O{row}` = MANUAL

**Egresos: Recibo <-> Pago Enviado**
1. Find the Recibo row — note its row number and fileId
2. Find the PE row — note its row number and fileId
3. Update:
   - `'Recibos'!Q{row}` = PE fileId
   - `'Recibos'!R{row}` = MANUAL
   - `'Pagos Enviados'!N{row}` = Recibo fileId
   - `'Pagos Enviados'!O{row}` = MANUAL

### Row Numbers

Spreadsheet row numbers are 1-indexed. Row 1 is the header. Data starts at row 2.
When `gsheets_read` returns data, the first data entry (index 0) corresponds to row 2.

So: **spreadsheet row = data index + 2**

**Important:** The `index + 2` formula only applies when reading the full sheet (range like `A:Z`). When reading a scoped range (e.g., `A100:Q200`), use the `location` field from the cell data to determine the actual row number — do NOT use `index + 2`.

## Step 5: Unmatch

Clear match columns on both sides by writing empty strings.

**Factura Emitida <-> Pago Recibido (unmatch):**
- `'Facturas Emitidas'!P{row}` = (empty)
- `'Facturas Emitidas'!Q{row}` = (empty)
- `'Pagos Recibidos'!N{row}` = (empty)
- `'Pagos Recibidos'!O{row}` = (empty)

**Factura Recibida <-> Pago Enviado (unmatch):**
- `'Facturas Recibidas'!P{row}` = (empty)
- `'Facturas Recibidas'!Q{row}` = (empty)
- `'Facturas Recibidas'!S{row}` = (empty)
- `'Pagos Enviados'!N{row}` = (empty)
- `'Pagos Enviados'!O{row}` = (empty)

**Recibo <-> Pago Enviado (unmatch):**
- `'Recibos'!Q{row}` = (empty)
- `'Recibos'!R{row}` = (empty)
- `'Pagos Enviados'!N{row}` = (empty)
- `'Pagos Enviados'!O{row}` = (empty)

**Retencion Recibida (unmatch):**
- `'Retenciones Recibidas'!N{row}` = (empty)
- `'Retenciones Recibidas'!O{row}` = (empty)

To find the other side of a match, search the counterpart sheet for the fileId stored in the match column.

## Step 6: File Operations

### Move File
1. Show current file location (use `gdrive_search` or `gdrive_read_file` to get file info)
2. Show proposed destination
3. **Ask for explicit user confirmation** before executing
4. Use `gdrive_move_file` with fileId and newParentFolderId

### Rename File
1. Show current file name
2. Show proposed new name
3. **Ask for explicit user confirmation** before executing
4. Use `gdrive_rename_file` with fileId and newName

## Step 7: Verification

After any write operation (`gsheets_update`, `gdrive_move_file`, `gdrive_rename_file`):
1. Re-read the affected data to confirm changes applied
2. Report before/after state to the user

## Rules

- **Always update BOTH sides** of a match link (except retenciones, which are one-directional)
- **Always set matchConfidence=MANUAL** on matched documents
- **Always set pagada=SI** when matching a Factura Recibida with a Pago Enviado
- **Always verify** writes by re-reading affected rows
- **Always confirm** file moves and renames before executing
- **Never modify** rows beyond match/unmatch columns
- **Never delete** spreadsheet rows
- Use `gsheets_update` for all spreadsheet writes — it supports batch updates in a single call
