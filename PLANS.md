# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/ADV-100-backlog-batch
**Issues:** ADV-100, ADV-103, ADV-104
**Created:** 2026-02-22
**Last Updated:** 2026-02-22

## Summary

This plan implements three operational safety and traceability improvements: (1) environment marker files to prevent cross-environment contamination between staging and production, (2) dual Drive root folder IDs in `.env` for the investigate skill, and (3) distinct duplicate status tracking in the Dashboard's Archivos Procesados sheet.

## Issues

### ADV-100: Environment marker files to prevent cross-environment contamination

**Priority:** High
**Labels:** Improvement
**Description:** Both staging and production servers access Google Drive via DRIVE_ROOT_FOLDER_ID, but there's no safeguard against misconfiguration. A staging server could point at the production Drive folder (or vice versa) and corrupt real data. This adds a marker file mechanism in the Drive root folder to detect and prevent mismatches at startup.

**Acceptance Criteria:**
- [ ] New `ENVIRONMENT` env var required in production (values: `staging` | `production`)
- [ ] On startup, server checks root Drive folder for `.staging` or `.production` marker file
- [ ] If no marker exists: creates the correct one and proceeds
- [ ] If correct marker exists: proceeds normally
- [ ] If wrong marker exists: refuses to start with clear error
- [ ] CLAUDE.md updated with new env var and marker file documentation
- [ ] Tests cover all three scenarios (no marker, correct marker, wrong marker)

### ADV-103: Add staging and production Drive root folder IDs to .env for dual-environment investigation

**Priority:** High
**Labels:** Improvement
**Description:** Claude Code can only investigate one Google Drive environment at a time because only a single DRIVE_ROOT_FOLDER_ID is in `.env`. When debugging issues, the user needs to compare staging vs production Drive contents. This adds two new env vars for Claude Code skills only (not server code).

**Acceptance Criteria:**
- [ ] Two new env vars: `DRIVE_ROOT_FOLDER_ID_PRODUCTION` and `DRIVE_ROOT_FOLDER_ID_STAGING`
- [ ] Investigate skill reads both vars and asks which environment to target
- [ ] If only one var is set, uses it without asking
- [ ] CLAUDE.md ENV VARS table updated with new vars
- [ ] `.env.example` updated

### ADV-104: Track duplicate files in Dashboard with distinct status and original file reference

**Priority:** High
**Labels:** Improvement
**Description:** When a duplicate file is detected and moved to the Duplicado folder, it's recorded in the Dashboard tracking sheet (Archivos Procesados) with status `success` — indistinguishable from normally processed files. The existingFileId is logged but not persisted, making it impossible to trace duplicates from the Dashboard.

**Acceptance Criteria:**
- [ ] New Column F in Archivos Procesados: `originalFileId` (empty for non-duplicates)
- [ ] Duplicate files get status `duplicate` instead of `success`
- [ ] Column F contains the Drive file ID of the original document
- [ ] SPREADSHEET_FORMAT.md updated with new column
- [ ] Startup migration: existing sheets get new column F header automatically
- [ ] Tests cover duplicate tracking with new status and originalFileId column

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Linear MCP connected
- [ ] Google Drive MCP available (for testing marker files)

## Implementation Tasks

### Task 1: Add ENVIRONMENT config variable with validation

**Issue:** ADV-100
**Files:**
- `src/config.ts` (modify)
- `src/config.test.ts` (modify)
- `vitest.config.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/config.test.ts`:
   - Test that `ENVIRONMENT` is parsed from env var with values `staging` | `production`
   - Test that missing `ENVIRONMENT` in production mode (`NODE_ENV=production`) throws descriptive error
   - Test that `ENVIRONMENT` is optional in development/test modes (defaults to `development`)
   - Test that invalid `ENVIRONMENT` values are rejected
   - Follow existing config validation test patterns (lines 27-92 of `config.test.ts`)
2. **Run verifier** (expect fail — config property doesn't exist yet)
3. **GREEN** — Implement in `src/config.ts`:
   - Add `environment: 'development' | 'staging' | 'production'` to the Config interface (near line 158)
   - Parse `process.env.ENVIRONMENT` with validation (after line 231)
   - Default to `'development'` when `NODE_ENV` is not `production`
   - Require it when `NODE_ENV === 'production'`
   - Add to returned config object (near line 266)
   - Update `vitest.config.ts` to include `ENVIRONMENT: 'test-env'` or similar in env block
4. **Run verifier** (expect pass)

**Notes:**
- The existing `nodeEnv` field stays — `ENVIRONMENT` is a separate concept (server identity vs Node mode)
- `ENVIRONMENT` is about which Drive folder this server owns, not about Node.js runtime mode

### Task 2: Implement environment marker file check in folder structure

**Issue:** ADV-100
**Files:**
- `src/services/folder-structure.ts` (modify)
- `src/services/folder-structure.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/services/folder-structure.test.ts`:
   - Test `checkEnvironmentMarker()` function:
     - When no marker file exists in root folder → creates correct marker (`.staging` or `.production`), returns ok
     - When correct marker exists → returns ok, does not create anything
     - When wrong marker exists → returns error with message "Environment mismatch: server is {X} but Drive folder is marked {Y}"
   - Mock `findByName()` and Drive file creation calls
   - Follow existing test patterns in the file (Vitest mocks)
2. **Run verifier** (expect fail)
3. **GREEN** — Implement `checkEnvironmentMarker()` in `src/services/folder-structure.ts`:
   - New exported async function: `checkEnvironmentMarker(rootId: string, environment: string): Promise<Result<void, Error>>`
   - Use `findByName(rootId, '.staging')` and `findByName(rootId, '.production')` to check for existing markers
   - If no marker: create the correct one using Drive API (create an empty file with the marker name)
   - If correct marker: return ok
   - If wrong marker: return error Result with descriptive message
   - Skip check when `environment === 'development'` (return ok immediately)
4. **Run verifier** (expect pass)

**Notes:**
- Marker files are plain empty files named `.staging` or `.production` in the Drive root folder
- Use `findByName()` from `src/services/drive.ts` for detection (returns `DriveFileInfo | null`)
- For file creation, use the Drive API to create a minimal file (not a folder) — check existing patterns in `drive.ts` for creating non-folder files, or add a `createFile()` function if needed
- The function should be called from `discoverFolderStructure()` early, before any folder creation

### Task 3: Wire marker check into server startup

**Issue:** ADV-100
**Files:**
- `src/services/folder-structure.ts` (modify — integrate into `discoverFolderStructure()`)
- `src/server.ts` (no changes needed if integrated into `discoverFolderStructure()`)

**Steps:**

1. Integrate `checkEnvironmentMarker()` call into `discoverFolderStructure()` (line ~630, right after getting `rootId` from config):
   - Read `config.environment` from `getConfig()`
   - Call `checkEnvironmentMarker(rootId, config.environment)` before any folder creation
   - If it returns error, propagate it (will cause `initializeFolderStructure()` in server.ts to throw and abort startup)
2. **Run verifier** (expect pass — existing tests should still pass, new integration is behind environment check)

**Notes:**
- The abort-on-mismatch happens naturally: `discoverFolderStructure()` returns `Result`, and `initializeFolderStructure()` in `server.ts:66-72` already throws on error, causing `start()` to catch and `process.exit(1)`
- No changes to `server.ts` needed — the existing error propagation handles it

### Task 4: Add dual Drive folder IDs for investigation

**Issue:** ADV-103
**Files:**
- `.env.example` (modify)
- `.claude/skills/investigate/SKILL.md` (modify)
- `CLAUDE.md` (modify)

**Steps (no TDD — config/skill files only, no TypeScript code):**

1. Add to `.env.example`:
   - `DRIVE_ROOT_FOLDER_ID_PRODUCTION=your_production_drive_root_folder_id`
   - `DRIVE_ROOT_FOLDER_ID_STAGING=your_staging_drive_root_folder_id`
   - Add comment explaining these are for Claude Code skills only, not used by server
2. Update `.claude/skills/investigate/SKILL.md`:
   - In the context-gathering phase, add a step to check for both `DRIVE_ROOT_FOLDER_ID_PRODUCTION` and `DRIVE_ROOT_FOLDER_ID_STAGING` in `.env`
   - If both are set, ask the user which environment to investigate (production or staging), then use that folder ID as the root for Drive MCP queries
   - If only one is set, use it without asking
   - If neither is set, fall back to `DRIVE_ROOT_FOLDER_ID`
3. Update `CLAUDE.md` ENV VARS table:
   - Add `DRIVE_ROOT_FOLDER_ID_PRODUCTION` — No — "Production Drive root folder ID (for Claude Code investigate skill)"
   - Add `DRIVE_ROOT_FOLDER_ID_STAGING` — No — "Staging Drive root folder ID (for Claude Code investigate skill)"

**Notes:**
- These vars are NOT loaded by `src/config.ts` — they are read by Claude Code skills directly from `.env`
- The existing `DRIVE_ROOT_FOLDER_ID` remains unchanged (server runtime var)
- The Drive MCP service account already has access to both folders

### Task 5: Add originalFileId column to Archivos Procesados schema with startup migration

**Issue:** ADV-104
**Files:**
- `src/constants/spreadsheet-headers.ts` (modify)
- `src/services/folder-structure.ts` (modify — add header migration)
- `src/services/folder-structure.test.ts` (modify)
- `SPREADSHEET_FORMAT.md` (modify)

**Migration note:** This adds Column F to the Archivos Procesados sheet in Dashboard Operativo. Existing production/staging sheets have 5 columns (A:E). The startup migration must detect old schema and append the new header.

**TDD Steps:**

1. **RED** — Write tests in `src/services/folder-structure.test.ts`:
   - Test that `migrateArchivosProcesadosHeaders()` detects 5-column schema and appends Column F header
   - Test that 6-column schema (already migrated) is left untouched
   - Test that empty sheet gets full 6-column headers (handled by existing `ensureSheetsExist`)
   - Mock `getValues()` and `setValues()` calls
2. **Run verifier** (expect fail)
3. **GREEN** — Implement:
   - In `src/constants/spreadsheet-headers.ts`: Add `'originalFileId'` to `ARCHIVOS_PROCESADOS_HEADERS` array (after `'status'`)
   - In `src/services/folder-structure.ts`: Add `migrateArchivosProcesadosHeaders(dashboardId)` function
     - Read header row: `getValues(dashboardId, 'Archivos Procesados!A1:Z1')`
     - If header count is 5 (old schema): write `'originalFileId'` to cell F1
     - If header count is 6+: skip (already migrated)
   - Call `migrateArchivosProcesadosHeaders()` in `initializeDashboardOperativo()` after `ensureSheetsExist()` (near line 337)
4. **Run verifier** (expect pass)
5. Update `SPREADSHEET_FORMAT.md`:
   - Add Column F: `originalFileId` — string — "Drive file ID of the original document (populated for duplicates only)"

**Notes:**
- The existing `ensureSheetsExist()` only checks if `firstRow[0]` matches — it does NOT detect added columns. That's why we need explicit migration logic.
- Existing rows in production will have Column F empty — this is expected and correct per the acceptance criteria.
- `getStaleProcessingFileIds()` reads `A:E` by column index and is unaffected by the new column.

### Task 6: Extend updateFileStatus with duplicate support

**Issue:** ADV-104
**Files:**
- `src/processing/storage/index.ts` (modify)
- `src/processing/storage/index.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/processing/storage/index.test.ts`:
   - Test `updateFileStatus()` with `status: 'duplicate'` writes `'duplicate'` to Column E
   - Test `updateFileStatus()` with `status: 'duplicate'` and `originalFileId: 'abc123'` writes `'abc123'` to Column F
   - Test `updateFileStatus()` with `status: 'success'` still works (no Column F write)
   - Test `updateFileStatus()` with `status: 'failed'` still works (no Column F write, retry logic preserved)
   - Follow existing test patterns at lines 232-319 of `index.test.ts`
2. **Run verifier** (expect fail)
3. **GREEN** — Implement in `src/processing/storage/index.ts`:
   - Change `updateFileStatus` signature: `status: 'success' | 'failed' | 'duplicate'`
   - Add optional parameter: `originalFileId?: string`
   - Expand the read range from `A:E` to `A:F` (line 186)
   - When `status === 'duplicate'` and `originalFileId` is provided: write both Column E (`'duplicate'`) and Column F (`originalFileId`) in a single `batchUpdate` call
   - For `'success'` and `'failed'` statuses: behavior unchanged (only write Column E)
   - Also update `markFileProcessing()` to include empty string for Column F in new rows (line 123: add `''` to the row array)
   - Update the retry branch (line 102) range from `C:E` to `C:F` to include the new column, with empty string for Column F
4. **Run verifier** (expect pass)

**Notes:**
- The `'duplicate'` status should NOT participate in retry count logic — duplicates are final
- `batchUpdate` range for duplicate: `Archivos Procesados!E${rowIndex}:F${rowIndex}` with values `[['duplicate', originalFileId]]`

### Task 7: Update scanner duplicate branches to use new status

**Issue:** ADV-104
**Files:**
- `src/processing/scanner.ts` (modify)

**Steps:**

1. Update ALL duplicate handling branches in `scanner.ts` to use `'duplicate'` status instead of `'success'`:
   - `factura_emitida` duplicate (line ~910): change `updateFileStatus(dashboardOperativoId, fileInfo.id, 'success')` to `updateFileStatus(dashboardOperativoId, fileInfo.id, 'duplicate', undefined, storeResult.value.existingFileId)`
   - `factura_recibida` duplicate (line ~1032): same pattern
   - `pago_recibido` duplicate (line ~1150): same pattern
   - `pago_enviado` duplicate (line ~1267): same pattern
   - `recibo` duplicate (line ~1384): same pattern
   - Resumenes duplicate (line ~1602): same pattern
   - `certificado_retencion` duplicate (line ~2140): same pattern
   - Each branch already has `storeResult.value.existingFileId` available in scope
2. **Run verifier** (expect pass — scanner tests should pass if they exist, or verify no regressions)

**Notes:**
- There are ~7 duplicate branches in scanner.ts, each following the same pattern
- The failed branch for duplicate move errors should remain `'failed'` (not `'duplicate'`) — only successful duplicate handling gets the new status
- The `existingFileId` is already logged in each branch; now it's also persisted

### Task 8: Update documentation

**Issues:** ADV-100, ADV-103, ADV-104
**Files:**
- `CLAUDE.md` (modify)

**Steps:**

1. Update `CLAUDE.md` ENV VARS table:
   - Add `ENVIRONMENT` — Yes (production only) — "Server environment identity: `staging` | `production`"
   - Add `DRIVE_ROOT_FOLDER_ID_PRODUCTION` — No — "Production Drive root folder (Claude Code skills only)"
   - Add `DRIVE_ROOT_FOLDER_ID_STAGING` — No — "Staging Drive root folder (Claude Code skills only)"
2. Update `CLAUDE.md` FOLDER STRUCTURE section:
   - Add marker files `.staging` / `.production` to the root folder diagram
3. Update `CLAUDE.md` Archivos Procesados schema reference (if any) to mention Column F
4. Update `CLAUDE.md` status values: add `'duplicate'` to the list alongside `'processing'`, `'success'`, `'failed'`

### Post-Implementation Checklist

1. Run `bug-hunter` agent — review all git changes for bugs
2. Fix any issues found
3. Run `verifier` agent (full mode) — all tests + build with zero warnings
4. Fix any issues found

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to In Progress when starting, Review when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| ENVIRONMENT not set in production | Startup throws with descriptive error | Unit test (Task 1) |
| Wrong marker file in Drive folder | Startup aborts with "Environment mismatch" error | Unit test (Task 2) |
| Marker file creation fails (Drive API error) | Startup aborts, error propagated | Unit test (Task 2) |
| File not found in tracking sheet during duplicate update | Returns error Result (existing behavior) | Unit test (Task 6) |

## Risks & Open Questions

- [ ] Drive API may not support creating empty files (only folders) — Task 2 implementer should verify and use appropriate MIME type (e.g., `text/plain` with empty content)
- [ ] Marker file names with dots (`.staging`) may behave differently in Google Drive search — verify `findByName()` handles this correctly

## Scope Boundaries

**In Scope:**
- Environment marker file creation and validation at startup
- ENVIRONMENT env var in config.ts
- Dual Drive folder IDs in .env for investigate skill
- Dashboard Column F for originalFileId
- 'duplicate' status in Archivos Procesados
- Startup header migration for existing sheets
- Documentation updates

**Out of Scope:**
- Changing existing `NODE_ENV` behavior
- Server-side use of `DRIVE_ROOT_FOLDER_ID_PRODUCTION`/`STAGING` (these are skill-only)
- Dashboard UI changes for duplicate display
- Retroactive backfill of existing duplicate rows
