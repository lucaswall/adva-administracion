# Implementation Plan

**Created:** 2026-02-23
**Source:** Inline request: Create manual-match skill for Claude Code. Requires adding spreadsheet write + file move/rename capabilities to gdrive MCP server. Skill handles manual document matching in Control de Ingresos/Egresos, file moves/renames with confirmation, environment selection (staging/production), and scoped queries (by sheet, date, area).
**Linear Issues:** [ADV-136](https://linear.app/lw-claude/issue/ADV-136/add-write-capabilities-to-gdrive-mcp-server-gsheets_update-move-rename), [ADV-137](https://linear.app/lw-claude/issue/ADV-137/create-manual-match-skill-for-document-matching-file-moves-and-renames), [ADV-138](https://linear.app/lw-claude/issue/ADV-138/update-claudemd-with-new-mcp-tools-and-manual-match-skill)

## Context Gathered

### Codebase Analysis

**MCP Server (`mcp-gdrive/`):**
- Custom MCP server using `@modelcontextprotocol/sdk` with `googleapis`
- Currently read-only: scopes are `drive.readonly` + `spreadsheets.readonly` (`mcp-gdrive/auth.ts`)
- 5 tools: `gdrive_search`, `gdrive_read_file`, `gdrive_list_folder`, `gdrive_get_pdf`, `gsheets_read`
- Tool pattern: schema export + handler function, registered in `tools/index.ts`
- Types in `tools/types.ts`, each tool has its own input interface

**Spreadsheet Schema (matching-relevant columns):**
- Facturas Emitidas (A:S): matchedPagoFileId=P, matchConfidence=Q
- Pagos Recibidos (A:Q): matchedFacturaFileId=N, matchConfidence=O
- Retenciones Recibidas (A:O): matchedFacturaFileId=N, matchConfidence=O
- Facturas Recibidas (A:T): matchedPagoFileId=P, matchConfidence=Q, pagada=S
- Pagos Enviados (A:Q): matchedFacturaFileId=N, matchConfidence=O
- Recibos (A:R): matchedPagoFileId=Q, matchConfidence=R

**Environment handling:**
- `.env` has `DRIVE_ROOT_FOLDER_ID_PRODUCTION` and `DRIVE_ROOT_FOLDER_ID_STAGING`
- Investigate skill pattern: read `.env`, ask user which environment, use corresponding root folder
- Root folder contains `Control de Ingresos.gsheet` and `Control de Egresos.gsheet`

**Existing patterns:**
- `investigate` skill in `.claude/skills/investigate/SKILL.md` — good model for environment selection + Drive MCP usage
- All matching sheets use `MANUAL` value in `matchConfidence` to lock matches (ADV-131, already implemented)

### MCP Context
- Linear MCP verified: team "ADVA Administracion" exists
- Google Drive MCP: `drive.files.update()` handles both move (addParents/removeParents) and rename (requestBody.name)
- Sheets API: `sheets.spreadsheets.values.batchUpdate()` for multi-cell updates with `USER_ENTERED` mode

## Original Plan

### Task 1: Add write capabilities to gdrive MCP server
**Linear Issue:** [ADV-136](https://linear.app/lw-claude/issue/ADV-136/add-write-capabilities-to-gdrive-mcp-server-gsheets_update-move-rename)

Adds three new MCP tools: `gsheets_update` (batch cell updates), `gdrive_move_file`, `gdrive_rename_file`. Upgrades auth scopes from read-only to read-write.

No TDD — MCP tools are external integrations with no test infrastructure in `mcp-gdrive/`. Verified via manual testing after implementation.

**Subtasks:**

1. Upgrade auth scopes in `mcp-gdrive/auth.ts`:
   - `drive.readonly` → `drive` (enables file move/rename)
   - `spreadsheets.readonly` → `spreadsheets` (enables cell updates)

2. Add new input types in `mcp-gdrive/tools/types.ts`:
   - `GSheetsUpdateInput`: `{ spreadsheetId, updates: Array<{ range, value }> }`
   - `GDriveMoveFileInput`: `{ fileId, newParentFolderId }`
   - `GDriveRenameFileInput`: `{ fileId, newName }`

3. Create `mcp-gdrive/tools/gsheets_update.ts`:
   - Uses `sheets.spreadsheets.values.batchUpdate()` with `USER_ENTERED` valueInputOption
   - Takes array of `{ range, value }` pairs (A1 notation, e.g., `"'Facturas Emitidas'!P5"`)
   - Returns count of updated cells + confirmation

4. Create `mcp-gdrive/tools/gdrive_move_file.ts`:
   - Uses `drive.files.get()` to get current parents
   - Uses `drive.files.update()` with `addParents` + `removeParents`
   - Returns new file location info
   - Include `supportsAllDrives: true` per existing pattern

5. Create `mcp-gdrive/tools/gdrive_rename_file.ts`:
   - Uses `drive.files.update()` with `requestBody: { name }`
   - Returns old name → new name confirmation
   - Include `supportsAllDrives: true`

6. Register all 3 tools in `mcp-gdrive/tools/index.ts`

7. Add permissions in `.claude/settings.json`:
   - `mcp__gdrive__gsheets_update`
   - `mcp__gdrive__gdrive_move_file`
   - `mcp__gdrive__gdrive_rename_file`

### Task 2: Create manual-match skill
**Linear Issue:** [ADV-137](https://linear.app/lw-claude/issue/ADV-137/create-manual-match-skill-for-document-matching-file-moves-and-renames)

Create `.claude/skills/manual-match/SKILL.md` — a user-invocable skill for manually matching documents across Control de Ingresos and Control de Egresos spreadsheets.

No TDD — this is a skill file (markdown instructions), not TypeScript code.

**Skill frontmatter:**
- `name: manual-match`
- `description`: Triggers on "manual match", "fix match", "unmatch", "link factura", "link pago", "show unmatched", "review matches", "move file", "rename file", "fix document"
- `disable-model-invocation: true` (has side effects — writes to spreadsheets, moves/renames files)
- `allowed-tools`: Read, Glob, Grep, all `mcp__gdrive__*` tools (search, read, list, get_pdf, gsheets_read, gsheets_update, gdrive_move_file, gdrive_rename_file)
- Does NOT include `mcp__gemini__*` — Claude reads/analyzes documents directly via `gdrive_read_file` or `gdrive_get_pdf` + Read tool

**Skill workflow (embedded in SKILL.md):**

1. **Environment selection** — Read `.env` for `DRIVE_ROOT_FOLDER_ID_PRODUCTION` and `DRIVE_ROOT_FOLDER_ID_STAGING`. If both exist, ask user which environment. Use the selected root folder for all subsequent Drive queries.

2. **Find spreadsheets** — Use `gdrive_list_folder` on root folder to locate `Control de Ingresos` and `Control de Egresos` spreadsheet IDs.

3. **Interpret user request** — Parse `$ARGUMENTS` to determine action:
   - **Show unmatched**: Read relevant sheet(s), filter rows where matchedFileId is empty
   - **Show low-confidence**: Filter rows where matchConfidence is MEDIUM or LOW
   - **Show needs review**: Filter rows where needsReview is TRUE
   - **Match documents**: User specifies two documents to link (by nroFactura, fileId, CUIT, name, row number)
   - **Unmatch**: Clear match columns on both sides of a link
   - **Move file**: Move a file to a different folder (requires explicit confirmation)
   - **Rename file**: Rename a file (requires explicit confirmation)
   - **Scoped queries**: Filter by sheet name, date range, CUIT, company name, amount range

4. **Matching operations** — For each match type, update BOTH sides of the link and set `matchConfidence=MANUAL`:

   **Ingresos — Factura Emitida ↔ Pago Recibido:**
   - FE: col P = pago fileId, col Q = MANUAL
   - PR: col N = factura fileId, col O = MANUAL

   **Ingresos — Retencion Recibida → Factura Emitida:**
   - RR: col N = factura fileId, col O = MANUAL

   **Egresos — Factura Recibida ↔ Pago Enviado:**
   - FR: col P = pago fileId, col Q = MANUAL, col S = SI
   - PE: col N = factura fileId, col O = MANUAL

   **Egresos — Recibo ↔ Pago Enviado:**
   - R: col Q = pago fileId, col R = MANUAL
   - PE: col N = recibo fileId, col O = MANUAL

5. **Unmatch** — Clear match columns (empty string) on both sides. For Factura Recibida, also clear `pagada` (col S).

6. **File operations** — For move/rename:
   - Show current file location/name and proposed change
   - Require explicit user confirmation before executing
   - Use `gdrive_move_file` or `gdrive_rename_file` MCP tools

7. **Verification** — After any write operation, re-read the affected rows to confirm changes applied correctly. Report the before/after state.

**Embedded schema reference** — The skill includes a condensed column mapping table so Claude can construct correct A1 notation ranges without needing to re-read SPREADSHEET_FORMAT.md each time.

### Task 3: Update CLAUDE.md with new MCP tools and skill
**Linear Issue:** [ADV-138](https://linear.app/lw-claude/issue/ADV-138/update-claudemd-with-new-mcp-tools-and-manual-match-skill)

1. Add to MCP SERVERS → Google Drive section:
   - `gsheets_update` — write to spreadsheet cells (used ONLY by `manual-match` skill)
   - `gdrive_move_file` — move files between folders (used ONLY by `manual-match` skill)
   - `gdrive_rename_file` — rename files (used ONLY by `manual-match` skill)
   - Note: these write tools are restricted to the `manual-match` skill via `allowed-tools`

2. Add `manual-match` to the SKILLS table:
   - Description: Manually match documents, fix matches, move/rename files. Use when user says "manual match", "fix match", "unmatch", "show unmatched", "move file", "rename file".

3. Add a note in the Google Drive MCP section that `manual-match` is the ONLY skill authorized to write to spreadsheets or move/rename files.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Create a manual-match skill with spreadsheet write and file management capabilities

**Request:** Create a skill for Claude Code to help with manual matching of documents in Control de Ingresos/Egresos, with environment selection (staging/production), scoped queries, and file move/rename with confirmation. Add write capabilities to the gdrive MCP server.

**Linear Issues:** ADV-136, ADV-137, ADV-138

**Approach:** Add three new MCP tools (gsheets_update, gdrive_move_file, gdrive_rename_file) to the existing custom gdrive MCP server by upgrading auth scopes and creating new tool files following the existing pattern. Create a manual-match skill that orchestrates reading spreadsheet data, identifying unmatched/low-confidence documents, and writing manual matches with MANUAL confidence locking.

**Scope:**
- Tasks: 3
- Files affected: ~9 (3 new MCP tools + types + index + auth + settings.json + skill + CLAUDE.md)
- New tests: no (MCP tools are external integrations; skill is markdown)

**Key Decisions:**
- Auth scopes upgraded to full drive + spreadsheets (necessary for write operations)
- `gsheets_update` uses batch update with array of {range, value} pairs for atomic multi-cell updates
- File move/rename require explicit user confirmation in the skill
- Claude reads documents directly (no Gemini) when analysis is needed
- Skill is the ONLY write-capable tool user, enforced via `allowed-tools` + CLAUDE.md documentation

**Risks/Considerations:**
- Scope upgrade from read-only to read-write on Drive and Sheets — mitigated by restricting write tools to `manual-match` skill only
- Wrong cell updates could corrupt spreadsheet data — mitigated by verification step (re-read after write)
- Moving files to wrong folder — mitigated by confirmation requirement in skill

---

## Iteration 1

**Implemented:** 2026-02-23
**Method:** Single-agent (effort score 2 — no workers justified)

### Tasks Completed This Iteration
- Task 1: Add write capabilities to gdrive MCP server (ADV-136) — Upgraded auth scopes, created gsheets_update/gdrive_move_file/gdrive_rename_file tools, registered in index, added permissions
- Task 2: Create manual-match skill (ADV-137) — Created SKILL.md with environment selection, match/unmatch workflows, file operations, column reference, verification
- Task 3: Update CLAUDE.md (ADV-138) — Added new MCP tools to Google Drive section with write restriction note, added manual-match to SKILLS table

### Files Modified
- `mcp-gdrive/auth.ts` — Upgraded scopes from readonly to read-write
- `mcp-gdrive/tools/types.ts` — Added GSheetsUpdateInput, GDriveMoveFileInput, GDriveRenameFileInput
- `mcp-gdrive/tools/gsheets_update.ts` — New: batch cell update tool
- `mcp-gdrive/tools/gdrive_move_file.ts` — New: file move tool with parent validation
- `mcp-gdrive/tools/gdrive_rename_file.ts` — New: file rename tool
- `mcp-gdrive/tools/index.ts` — Registered 3 new tools
- `.claude/settings.json` — Added 3 new MCP tool permissions
- `.claude/skills/manual-match/SKILL.md` — New: manual-match skill
- `CLAUDE.md` — Added write tools and manual-match skill documentation

### Linear Updates
- ADV-136: Todo → In Progress → Review
- ADV-137: Todo → In Progress → Review
- ADV-138: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 5 issues (1 HIGH, 3 MEDIUM, 1 LOW), all fixed before proceeding
- verifier: All 1792 tests pass, zero warnings

### Continuation Status
All tasks completed.
