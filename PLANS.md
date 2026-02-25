# Implementation Plan

**Status:** COMPLETE
**Created:** 2026-02-24
**Source:** Inline request: Add `.schema_version` file to Drive root for tracking schema migrations. Version-gate startup migrations to avoid redundant checks.
**Linear Issues:** [ADV-160](https://linear.app/lw-claude/issue/ADV-160/add-drive-file-content-operations-createfilewithcontent), [ADV-161](https://linear.app/lw-claude/issue/ADV-161/create-schema-version-service-readwrite-schema_version-from-drive), [ADV-162](https://linear.app/lw-claude/issue/ADV-162/migration-registry-with-version-gated-execution), [ADV-163](https://linear.app/lw-claude/issue/ADV-163/remove-migration-calls-from-folder-structurets-discovery)

## Context Gathered

### Codebase Analysis

**Current startup flow** (`src/server.ts:318-386`):
1. `initializeFolderStructure()` — discovers Drive folders, creates spreadsheets, runs tipoDeCambio + ArchivosProcesados migrations inline
2. `runStartupMigrations()` — runs Movimientos column reorder + Dashboard processedAt migrations
3. `initializeRealTimeMonitoring()` → `updateStatusSheet()` → `performStartupScan()`

**Current migrations (all idempotent, all already applied in production):**
- `migrateTipoDeCambioHeaders` — 4 calls in `discoverFolderStructure()` (folder-structure.ts:826-845) for Facturas Emitidas, Pagos Recibidos, Facturas Recibidas, Pagos Enviados
- `migrateArchivosProcesadosHeaders` — called inside `initializeDashboardOperativo()` (folder-structure.ts:428)
- `migrateMovimientosColumns` — called in `runStartupMigrations()` (migrations.ts:284), iterates all movimientos spreadsheets
- `migrateDashboardProcessedAt` — called in `runStartupMigrations()` (migrations.ts:313)

**Existing dot-file pattern:** `.staging`/`.production` environment markers created via `createFile()` (drive.ts:572) which creates EMPTY `text/plain` files. `findByName()` (drive.ts:324) discovers them. This is the exact pattern to follow for `.schema_version`.

**Drive file operations available:**
- `createFile(parentId, name)` — creates empty text/plain file (NO content support)
- `downloadFile(fileId)` — returns Buffer (can parse text content)
- `findByName(parentId, name)` — finds file by name in folder
- No `updateFileContent` or `createFileWithContent` exists yet

**Folder structure type:** `FolderStructure` (types/index.ts:968-999) includes `rootId`, `controlIngresosId`, `controlEgresosId`, `dashboardOperativoId`, `movimientosSpreadsheets`

**Test patterns:** `migrations.test.ts` mocks `sheets.js` and `folder-structure.js` via `vi.mock()`. `folder-structure.test.ts` mocks `drive.js` and `sheets.js`.

### Key Design Decisions

1. **`.schema_version` text file** (not appProperties) — consistent with existing `.staging`/`.production` dot-file pattern, inspectable in Drive UI, debuggable
2. **Plain integer content** — file contains just a number (e.g., `4`)
3. **First-time initialization:** When no `.schema_version` exists, create it with `CURRENT_SCHEMA_VERSION` and skip all migrations. This works because:
   - Existing environments already have all migrations applied
   - New environments get correct schemas from `ensureSheetsExist()` (latest headers)
4. **Consolidate all migrations** into a single registry in `migrations.ts` — removes migration calls from `discoverFolderStructure()` so folder discovery is purely discovery
5. **Keep migrations idempotent** — version gating prevents re-running, but idempotency remains a safety net

## Original Plan

### Task 1: Add Drive file content operations
**Linear Issue:** [ADV-160](https://linear.app/lw-claude/issue/ADV-160/add-drive-file-content-operations-createfilewithcontent)

1. Write tests in `src/services/drive.test.ts` (create if needed, follow folder-structure.test.ts mock patterns):
   - Test `createFileWithContent(parentId, name, content)` — mock `drive.files.create` and verify `media` parameter includes content string with `mimeType: 'text/plain'`. Verify returned `DriveFileInfo`.
   - Test `updateFileContent(fileId, content)` — mock `drive.files.update` and verify `media` parameter includes content string. Verify success result.
   - Test error cases for both functions (API failure → Result error)
2. Run verifier with pattern "drive" (expect fail)
3. Implement in `src/services/drive.ts`:
   - `createFileWithContent(parentId, name, content)` — extends `createFile` pattern (line 572) by adding `media: { mimeType: 'text/plain', body: content }` to the `drive.files.create` call. Returns `Result<DriveFileInfo, Error>`.
   - `updateFileContent(fileId, content)` — uses `drive.files.update` with `media: { mimeType: 'text/plain', body: content }`. Returns `Result<void, Error>`. Wrap in `withQuotaRetry`.
   - Both functions use Pino logger for debug logging, follow existing error handling patterns.
4. Run verifier with pattern "drive" (expect pass)

### Task 2: Create schema version service
**Linear Issue:** [ADV-161](https://linear.app/lw-claude/issue/ADV-161/create-schema-version-service-readwrite-schema_version-from-drive)

**Depends on:** Task 1

1. Write tests in `src/services/schema-version.test.ts`:
   - Test `readSchemaVersion` when file exists with content `"4"` → returns `{ ok: true, value: { version: 4, fileId: 'file-123' } }`
   - Test `readSchemaVersion` when file not found → returns `{ ok: true, value: { version: 0, fileId: null } }`
   - Test `readSchemaVersion` when file exists with non-numeric content → returns error
   - Test `readSchemaVersion` when `findByName` fails → propagates error
   - Test `writeSchemaVersion` with no existing fileId → calls `createFileWithContent` with `.schema_version` name and version string
   - Test `writeSchemaVersion` with existing fileId → calls `updateFileContent` with version string
   - Test `writeSchemaVersion` error propagation
2. Run verifier with pattern "schema-version" (expect fail)
3. Implement `src/services/schema-version.ts`:
   - Constants: `SCHEMA_VERSION_FILE = '.schema_version'`
   - Interface: `SchemaVersionInfo = { version: number; fileId: string | null }`
   - `readSchemaVersion(rootId: string): Promise<Result<SchemaVersionInfo, Error>>`:
     - Call `findByName(rootId, SCHEMA_VERSION_FILE)`
     - If not found → return `{ version: 0, fileId: null }`
     - If found → call `downloadFile(fileId)`, parse `Buffer.toString('utf-8').trim()` as integer
     - If parse fails (NaN) → return error
   - `writeSchemaVersion(rootId: string, version: number, existingFileId: string | null): Promise<Result<string, Error>>`:
     - If `existingFileId` → call `updateFileContent(existingFileId, String(version))`, return fileId
     - If not → call `createFileWithContent(rootId, SCHEMA_VERSION_FILE, String(version))`, return new fileId
   - Use Pino logger (`info` for version read/write, `debug` for details)
4. Run verifier with pattern "schema-version" (expect pass)

### Task 3: Migration registry with version-gated execution
**Linear Issue:** [ADV-162](https://linear.app/lw-claude/issue/ADV-162/migration-registry-with-version-gated-execution)

**Depends on:** Task 2

1. Write tests in `src/services/migrations.test.ts` (extend existing file):
   - Test `runStartupMigrations` when no `.schema_version` file (version 0): should create file with `CURRENT_SCHEMA_VERSION`, should NOT call any migration functions
   - Test `runStartupMigrations` when version equals `CURRENT_SCHEMA_VERSION`: should skip all migrations, should NOT update version file
   - Test `runStartupMigrations` when version is 2 and `CURRENT_SCHEMA_VERSION` is 4: should run migrations v3 and v4 only, should update version to 4
   - Test `runStartupMigrations` when a migration fails: should stop, should NOT update version (so it retries next startup), should log error
   - Test that existing `migrateMovimientosColumns` and `migrateDashboardProcessedAt` tests still pass
   - Mock `readSchemaVersion` and `writeSchemaVersion` from `schema-version.js`
2. Run verifier with pattern "migration" (expect fail)
3. Implement in `src/services/migrations.ts`:
   - Add import of `readSchemaVersion`, `writeSchemaVersion` from `./schema-version.js`
   - Add import of `migrateTipoDeCambioHeaders`, `migrateArchivosProcesadosHeaders` from `./folder-structure.js`
   - Define `CURRENT_SCHEMA_VERSION = 4` (exported)
   - Define `Migration` interface: `{ version: number; name: string; migrate: (fs: FolderStructure) => Promise<void> }`
   - Define `MIGRATIONS` array with 4 entries:
     - v1 `tipoDeCambio-columns`: calls `migrateTipoDeCambioHeaders` 4 times (Facturas Emitidas 18→S, Pagos Recibidos 15→P, Facturas Recibidas 19→T, Pagos Enviados 15→P) using `fs.controlIngresosId` and `fs.controlEgresosId`
     - v2 `archivos-procesados-column-f`: calls `migrateArchivosProcesadosHeaders(fs.dashboardOperativoId)`
     - v3 `movimientos-column-reorder`: iterates `fs.movimientosSpreadsheets` calling `migrateMovimientosColumns` for each
     - v4 `dashboard-processedAt-format`: calls `migrateDashboardProcessedAt(fs.dashboardOperativoId)`
   - Refactor `runStartupMigrations()`:
     - Get folder structure (existing check)
     - Call `readSchemaVersion(folderStructure.rootId)`
     - If version is 0 (no file): call `writeSchemaVersion(rootId, CURRENT_SCHEMA_VERSION, null)`, log "initialized schema version", return
     - If version >= `CURRENT_SCHEMA_VERSION`: log "schema up to date", return
     - Filter `MIGRATIONS` to those with `version > storedVersion`, sort by version
     - Execute each pending migration sequentially, log each one
     - If any migration fails: log error and return WITHOUT updating version (retry next startup)
     - After all succeed: call `writeSchemaVersion(rootId, CURRENT_SCHEMA_VERSION, fileId)`
4. Run verifier with pattern "migration" (expect pass)

### Task 4: Remove migration calls from folder-structure.ts
**Linear Issue:** [ADV-163](https://linear.app/lw-claude/issue/ADV-163/remove-migration-calls-from-folder-structurets-discovery)

**Depends on:** Task 3

1. Write/update tests in `src/services/folder-structure.test.ts`:
   - Verify that `migrateTipoDeCambioHeaders` is no longer called during discovery (if there are existing tests for discovery flow that assert migration calls, update them)
   - Verify that `migrateArchivosProcesadosHeaders` is no longer called during dashboard initialization
   - Existing unit tests for `migrateTipoDeCambioHeaders` and `migrateArchivosProcesadosHeaders` functions should remain (functions still exist, just called from migrations.ts now)
2. Run verifier (expect fail if tests assert migration calls during discovery)
3. Implement in `src/services/folder-structure.ts`:
   - In `discoverFolderStructure()`: remove the 4 `migrateTipoDeCambioHeaders` calls (lines ~826-845) and their error handling. Keep the `ensureSheetsExist` calls that precede them.
   - In `initializeDashboardOperativo()`: remove the `migrateArchivosProcesadosHeaders` call (line ~428) and its error handling. Keep the `ensureSheetsExist` call.
   - Keep function definitions of `migrateTipoDeCambioHeaders` and `migrateArchivosProcesadosHeaders` — they are now called by the migration registry.
   - Verify exports: both functions must remain exported (used by migrations.ts).
4. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Iteration 1

**Implemented:** 2026-02-24
**Method:** Single-agent (linear dependency chain, 1 work unit)

### Tasks Completed This Iteration
- Task 1: Add Drive file content operations (ADV-160) - Added `createFileWithContent` and `updateFileContent` to drive.ts
- Task 2: Create schema version service (ADV-161) - New `schema-version.ts` with `readSchemaVersion`/`writeSchemaVersion`
- Task 3: Migration registry with version-gated execution (ADV-162) - Refactored `runStartupMigrations` with `MIGRATIONS` array (v1-v4), `CURRENT_SCHEMA_VERSION`, version-gated execution
- Task 4: Remove migration calls from folder-structure.ts (ADV-163) - Removed 4 `migrateTipoDeCambioHeaders` calls from `discoverFolderStructure` and `migrateArchivosProcesadosHeaders` call from `initializeDashboardOperativo`

### Files Modified
- `src/services/drive.ts` - Added `createFileWithContent`, `updateFileContent` functions
- `src/services/drive.test.ts` - Added tests for new Drive functions
- `src/services/schema-version.ts` - New file: schema version read/write service
- `src/services/schema-version.test.ts` - New file: 10 tests for schema version service
- `src/services/migrations.ts` - Refactored to version-gated migration registry, changed `migrateDashboardProcessedAt` to return `Result<void, Error>`
- `src/services/migrations.test.ts` - Updated `runStartupMigrations` tests for version-gated behavior
- `src/services/folder-structure.ts` - Removed inline migration calls from discovery/initialization

### Linear Updates
- ADV-160: Todo → In Progress → Review
- ADV-161: Todo → In Progress → Review
- ADV-162: Todo → In Progress → Review
- ADV-163: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 HIGH bugs (migration functions silently swallowing errors), fixed before proceeding
- verifier: All 1892 tests pass, zero warnings

### Continuation Status
All tasks completed.

### Review Findings

Summary: 4 issue(s) found, fixed inline (Team: security, reliability, quality reviewers)
- FIXED INLINE: 4 issue(s) — verified via TDD + bug-hunter

**Issues fixed inline:**
- [MEDIUM] BUG: Unbounded batchUpdate in migrateMovimientosColumns (`src/services/migrations.ts:196`) — added chunking loop using SHEETS_BATCH_UPDATE_LIMIT + test
- [MEDIUM] BUG: Unknown column layout proceeds to corrupt data (`src/services/migrations.ts:148`) — simplified guard to `if (!isOldLayout)` + `continue` + test
- [LOW] BUG: Silent subfolder error swallowing in listFilesInFolder (`src/services/drive.ts:103-108`) — added warn log + test
- [LOW] EDGE CASE: parseInt partial parse bypass in readSchemaVersion (`src/services/schema-version.ts:46`) — added `/^\d+$/` regex validation + test

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: Inconsistent Drive query escaping (`drive.ts:333`) — parentId/mimeType are internal values from API responses, never user input
- [DISCARDED] SECURITY: Raw file content in error message (`schema-version.ts:51`) — application-controlled file, Pino logs not exposed externally
- [DISCARDED] TYPE: Non-null assertion `firstError!` (`migrations.ts:319`) — logically safe, failedRows > 0 guarantees firstError was set
- [DISCARDED] TEST: Incomplete v4 coverage in partial-run test (`migrations.test.ts:401-428`) — v4 implicitly tested (runs to completion, writeSchemaVersion called)
- [DISCARDED] TYPE: `as any` cast on mockFolderStructure (`migrations.test.ts:356`) — standard test mock pattern

### Linear Updates
- ADV-160: Review → Merge (original task)
- ADV-161: Review → Merge (original task)
- ADV-162: Review → Merge (original task)
- ADV-163: Review → Merge (original task)
- ADV-164: Created in Merge (Fix: unbounded batchUpdate — fixed inline)
- ADV-165: Created in Merge (Fix: unknown column layout corruption — fixed inline)
- ADV-166: Created in Merge (Fix: silent subfolder error swallowing — fixed inline)
- ADV-167: Created in Merge (Fix: parseInt partial parse bypass — fixed inline)

### Inline Fix Verification
- Unit tests: all 1896 pass
- Bug-hunter: guard condition tightened (headerRow.length check removed), no remaining issues

<!-- REVIEW COMPLETE -->

---

## Plan Summary

**Objective:** Add schema version tracking via `.schema_version` Drive file to gate startup migrations and avoid redundant spreadsheet checks.

**Request:** Track schema version in a `.schema_version` file in the root Drive folder. On startup, read version, run only new migrations, update version. Consolidate all migrations into a versioned registry.

**Linear Issues:** ADV-160, ADV-161, ADV-162, ADV-163

**Approach:** Add Drive file content read/write operations, create a schema version service, refactor migrations.ts into a versioned registry (v1-v4 for existing migrations), and remove migration calls from folder-structure discovery. First-time startup on existing environments creates `.schema_version` with version 4 (all current migrations already applied). Future migrations increment from v5+.

**Scope:**
- Tasks: 4
- Files affected: ~6 (drive.ts, schema-version.ts [new], migrations.ts, folder-structure.ts, + test files)
- New tests: yes

**Key Decisions:**
- `.schema_version` text file (not appProperties) — consistent with existing `.staging`/`.production` dot-file pattern
- Plain integer content (e.g., `4`) — simplest possible format
- Version 0 = no file found → initialize with CURRENT_SCHEMA_VERSION and skip all migrations
- Migrations stay idempotent as safety net, but version gating prevents re-execution
- Migration failure stops execution and does NOT update version → automatic retry next startup

**Risks/Considerations:**
- Existing environments need a one-time `.schema_version` file creation (handled automatically: version 0 → write CURRENT_SCHEMA_VERSION)
- Moving migrations out of `discoverFolderStructure()` changes execution order: migrations now run AFTER full discovery instead of inline. This is safe because `ensureSheetsExist()` creates new sheets with latest headers, and migrations only patch OLD schemas.
- Dynamic bank account spreadsheets created after a migration are created with latest headers (no migration needed) — this already works correctly.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
