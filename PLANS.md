# Implementation Plan

**Status:** IMPLEMENTED
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

---

## Iteration 1

**Implemented:** 2026-02-22
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Add ENVIRONMENT config variable with validation (worker-1)
- Task 2: Implement environment marker file check in folder structure (worker-1)
- Task 3: Wire marker check into server startup (worker-1)
- Task 4: Add dual Drive folder IDs for investigation (worker-3)
- Task 5: Add originalFileId column to Archivos Procesados with startup migration (worker-2)
- Task 6: Extend updateFileStatus with duplicate support (worker-2)
- Task 7: Update scanner duplicate branches to use new status (worker-2)
- Task 8: Update documentation (worker-3)

### Files Modified
- `src/config.ts` — Added ENVIRONMENT env var parsing and validation
- `src/config.test.ts` — 7 new tests for ENVIRONMENT config
- `vitest.config.ts` — Added ENVIRONMENT to test env block
- `src/services/drive.ts` — Added `createFile()` function
- `src/services/folder-structure.ts` — `checkEnvironmentMarker()`, `migrateArchivosProcesadosHeaders()`, wired into startup
- `src/services/folder-structure.test.ts` — 14 new tests (8 marker, 6 migration)
- `src/constants/spreadsheet-headers.ts` — Added `originalFileId` to ARCHIVOS_PROCESADOS_HEADERS
- `src/constants/spreadsheet-headers.test.ts` — Updated for 6-column schema
- `src/processing/storage/index.ts` — `duplicate` status, `originalFileId` parameter
- `src/processing/storage/index.test.ts` — Tests for duplicate status tracking
- `src/processing/scanner.ts` — 9 duplicate branches updated to use `duplicate` status
- `src/middleware/auth.test.ts` — Added environment to mock config
- `src/routes/status.test.ts` — Added environment to mock config
- `src/routes/scan.test.ts` — Added environment to mock config
- `src/server.test.ts` — Added environment to mock config
- `SPREADSHEET_FORMAT.md` — Documented Column F originalFileId
- `.env.example` — Added DRIVE_ROOT_FOLDER_ID_PRODUCTION/STAGING
- `.claude/skills/investigate/SKILL.md` — Added Drive Folder Resolution step
- `CLAUDE.md` — ENV VARS, folder structure diagram, Archivos Procesados schema, duplicate status
- `package.json` — Added `typecheck` npm script

### Linear Updates
- ADV-100: Todo → In Progress → Review
- ADV-103: Todo → In Progress → Review
- ADV-104: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 critical (committed conflict marker) and 1 low (mock type), both fixed before final commit
- verifier: All 1640 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 1, 2, 3 (environment marker — config, folder-structure, startup wiring)
- Worker 2: Tasks 5, 6, 7 (duplicate tracking — headers, storage, scanner)
- Worker 3: Tasks 4, 8 (config/docs — .env, investigate skill, CLAUDE.md)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: 1 conflict in folder-structure.test.ts (both workers added tests at EOF), resolved
- Worker 3: clean merge (no conflicts)
- Post-merge fix: Updated spreadsheet-headers.test.ts for 6-column schema, fixed Column F docs

### Review Findings

Summary: 3 issue(s) found (Team: security, reliability, quality reviewers)
- FIX: 3 issue(s) — Linear issues created
- DISCARDED: 9 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [HIGH] BUG: processedAt serial number format in retry path causes `getStaleProcessingFileIds` to always flag retried files as stale — infinite reprocessing loop (`src/processing/storage/index.ts:97-99, 355-360`)
- [MEDIUM] BUG: documentType column permanently shows 'unknown' — `updateFileStatus` never updates column D after classification (`src/processing/scanner.ts:85`, `src/processing/storage/index.ts`)
- [LOW] BUG: Missing `environment` field in server.test.ts default mock config — future tests using default mock would get undefined (`src/server.test.ts:9-25`)

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: Drive API query parameter sanitization in `findByName`/`listByMimeType` — all callers pass hardcoded internal constants, no user input path
- [DISCARDED] SECURITY: Internal error messages in 500 API responses — API is internal, consumed only by co-deployed Apps Script
- [DISCARDED] SECURITY: No minimum length for API_SECRET — developer-set value in .env, non-empty check catches the common mistake
- [DISCARDED] SECURITY: Timing test threshold too lenient (< 1.0) — implementation is correct (SHA-256 + timingSafeEqual), timing tests are inherently unreliable in CI
- [DISCARDED] SECURITY: No rate limiting on failed auth — feature request, not a bug
- [DISCARDED] CONVENTION: CLAUDE.md vs numberFormats contradiction for processedAt — documentation issue subsumed by processedAt format bug
- [DISCARDED] TEST: Fragile regex-based documentation tests in folder-structure.test.ts — weak assertions but zero correctness impact
- [DISCARDED] BUG: Stale comment "10s timeout" when value is 30s — zero correctness impact
- [DISCARDED] EDGE CASE: getDriveService double-initialization race — harmless per reviewer, no functional impact

### Linear Updates
- ADV-100: Review → Merge (original task)
- ADV-103: Review → Merge (original task)
- ADV-104: Review → Merge (original task)
- ADV-105: Created in Todo (Fix: processedAt serial number format)
- ADV-106: Created in Todo (Fix: documentType permanently unknown)
- ADV-107: Created in Todo (Fix: missing environment in mock)

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed. Fix Plan below.

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [ADV-105](https://linear.app/lw-claude/issue/ADV-105/fix-processedat-serial-number-format-in-retry-path-causing-infinite), [ADV-106](https://linear.app/lw-claude/issue/ADV-106/fix-documenttype-column-permanently-showing-unknown-in-archivos), [ADV-107](https://linear.app/lw-claude/issue/ADV-107/fix-missing-environment-field-in-servertestts-default-mock-config)

### Fix 1: processedAt serial number format in retry path
**Linear Issue:** [ADV-105](https://linear.app/lw-claude/issue/ADV-105/fix-processedat-serial-number-format-in-retry-path-causing-infinite)

1. Write test in `src/processing/storage/index.test.ts` verifying that `markFileProcessing` retry path stores processedAt as ISO string (not serial number), and that `getStaleProcessingFileIds` correctly evaluates age of retried files
2. Run verifier (expect fail)
3. In `src/processing/storage/index.ts` retry path (line 97-99): remove `dateToSerialInTimezone` conversion, store raw ISO string `processedAt` directly in batchUpdate (matching the new-file path)
4. Run verifier (expect pass)

### Fix 2: documentType column permanently showing 'unknown'
**Linear Issue:** [ADV-106](https://linear.app/lw-claude/issue/ADV-106/fix-documenttype-column-permanently-showing-unknown-in-archivos)

1. Write tests in `src/processing/storage/index.test.ts` verifying that `updateFileStatus` with 'success' or 'duplicate' status also updates column D (documentType)
2. Run verifier (expect fail)
3. In `src/processing/storage/index.ts`: add `documentType?: string` parameter to `updateFileStatus`, extend batchUpdate range from `E:F` to `D:F` when documentType is provided
4. In `src/processing/scanner.ts`: update all ~9 branches that call `updateFileStatus` to pass the classified documentType (e.g., `'factura_emitida'`, `'pago_recibido'`, etc.)
5. Remove `as any` cast on scanner.ts:85 — use a proper type assertion or add 'unknown' to the type if appropriate
6. Run verifier (expect pass)

### Fix 3: Missing environment field in server.test.ts default mock
**Linear Issue:** [ADV-107](https://linear.app/lw-claude/issue/ADV-107/fix-missing-environment-field-in-servertestts-default-mock-config)

1. Write test (or verify existing tests cover this) — the fix is self-verifying via TypeScript type checking
2. In `src/server.test.ts`: add `environment: 'staging'` to the default mock config factory (line ~9-25)
3. Run verifier (expect pass)
