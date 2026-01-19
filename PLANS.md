# Migration Plan Status

## Overview

Migration from Google Apps Script to Node.js server on Railway.app.

---

## Phase 0: Project Cleanup & Rename ✅ COMPLETE

### Completed
- [x] Deleted GAS build/deploy files (`.clasp.*.json`, `appsscript.json`, `rollup.config.js`, `tsconfig.build.json`)
- [x] Deleted `scripts/post-build.js`
- [x] Deleted GAS-specific source code:
  - `src/index.ts` (menu handlers)
  - `src/ui/` (SpreadsheetApp.getUi())
  - `src/triggers/` (trigger management)
  - `src/drive/` (DriveApp)
  - `src/sheets/` (SpreadsheetApp)
  - `src/config.ts` (PropertiesService)
  - `src/scanner.ts` (GAS orchestration)
- [x] Deleted GAS test mocks (`tests/mocks/gas.ts`, `tests/setup.ts`)
- [x] Deleted GAS-dependent tests
- [x] Updated `package.json` with server dependencies
- [x] Updated `tsconfig.json` for Node.js ESM
- [x] Updated `CLAUDE.md` for server architecture
- [x] Updated `README.md` for server deployment

### Files Kept (Reused ~65-70%)
- [x] `src/types/index.ts` - Updated (removed GAS Blob, kept interfaces)
- [x] `src/matching/matcher.ts` - Updated imports to .js
- [x] `src/gemini/prompts.ts` - Unchanged
- [x] `src/gemini/parser.ts` - Updated imports
- [x] `src/gemini/errors.ts` - Updated imports
- [x] `src/utils/validation.ts` - Updated imports
- [x] `src/utils/date.ts` - Unchanged
- [x] `src/utils/currency.ts` - Updated imports
- [x] `src/utils/numbers.ts` - Unchanged
- [x] `src/bank/matcher.ts` - Updated imports
- [x] `src/bank/subdiario-matcher.ts` - Updated imports

### Files Rewritten
- [x] `src/gemini/client.ts` - Native fetch instead of UrlFetchApp
- [x] `src/utils/exchange-rate.ts` - Native fetch + in-memory cache
- [x] `src/utils/drive-parser.ts` - Removed GAS DriveApp dependency

---

## Phase 1: Server Foundation ✅ COMPLETE

### Completed
- [x] Created Fastify server entry point (`src/server.ts`)
- [x] Implemented environment-based config (`src/config.ts`)
- [x] Implemented Google Service Account auth (`src/services/google-auth.ts`)
- [x] Created Drive API wrapper (`src/services/drive.ts`)
  - `listFilesInFolder()` - recursive file listing
  - `downloadFile()` - file content download
  - `getFileWithContent()` - full FileInfo retrieval
  - `watchFolder()` - push notification setup
  - `stopWatching()` - channel cleanup
- [x] Created Sheets API wrapper (`src/services/sheets.ts`)
  - `getValues()` - read range
  - `setValues()` - write range
  - `appendRows()` - append data
  - `batchUpdate()` - batch updates
  - `getSheetMetadata()` - list sheets
  - `createSheet()` - create new sheet
- [x] Ported Gemini client to native fetch
- [x] Created processing queue (`src/processing/queue.ts`)
- [x] Implemented routes:
  - `GET /health` - simple health check
  - `GET /api/status` - status with queue info
  - `POST /api/scan` - trigger scan (stub)
  - `POST /api/rematch` - rematch (stub)
  - `POST /api/autofill-bank` - bank autofill (stub)
  - `POST /webhooks/drive` - Drive notifications (stub)
- [x] All 525 tests passing
- [x] Build with zero warnings

---

## Phase 1.5: Folder Structure Infrastructure ✅ COMPLETE

### Target Structure
```
ADVA Root Folder (env: DRIVE_ROOT_FOLDER_ID)
├── Control de Cobros.gsheet       # Collections tracking
├── Control de Pagos.gsheet        # Payments tracking
├── Entrada/                        # Incoming documents (scan source)
├── Bancos/                         # Bank movement spreadsheets (auto-discovered)
├── Cobros/                         # Sorted: matched collections
│   ├── 01 - Enero/
│   └── ... (12 months, created on demand)
├── Pagos/                          # Sorted: matched payments
│   ├── 01 - Enero/
│   └── ... (12 months, created on demand)
└── Sin Procesar/                   # Failed or unmatched documents
```

### Completed
- [x] Add Drive folder operations to `src/services/drive.ts`
  - `findByName()` - Find item by name in folder
  - `listByMimeType()` - List items by MIME type
  - `createFolder()` - Create folder
  - `moveFile()` - Move file between folders
  - `getParents()` - Get parent folder IDs
- [x] Create `src/utils/spanish-date.ts` utility
  - `SPANISH_MONTHS` constant
  - `formatMonthFolder()` - Format date as "MM - MonthName"
- [x] Add folder structure types to `src/types/index.ts`
  - `FolderStructure` interface
  - `SortDestination` type
  - `SortResult` interface
- [x] Create `src/services/folder-structure.ts` (discovery/caching)
  - `discoverFolderStructure()` - Discover and cache folder hierarchy
  - `getOrCreateMonthFolder()` - Get/create month folders for sorting
  - `getCachedFolderStructure()` - Access cached structure
  - `clearFolderStructureCache()` - Clear cache for testing
- [x] Create `src/services/document-sorter.ts` (file movement)
  - `sortDocument()` - Sort document to destination folder
  - `sortToSinProcesar()` - Move failed/unrecognized files
- [x] Update `src/config.ts` to single `DRIVE_ROOT_FOLDER_ID`
- [x] Update `src/services/google-auth.ts` scopes for Drive write access
- [x] Initialize folder structure on server startup
- [x] All 575 tests passing
- [x] Build with zero warnings

### Notes
- Breaking change: existing deployments need folder restructure
- Prerequisite for Phase 2 (Core Processing)

---

## Phase 2: Core Processing ✅ COMPLETE

### Completed
- [x] Port scanner orchestration to `src/processing/scanner.ts`
  - File discovery from Drive
  - Classification with Gemini
  - Data extraction with type-specific prompts
  - Sheet storage (Facturas, Pagos, Recibos)
  - Matching execution (FacturaPagoMatcher)
  - Document sorting to appropriate folders
- [x] Implement `POST /api/scan` endpoint logic
  - Accepts optional `folderId` parameter
  - Returns scan results with statistics
- [x] Implement `POST /api/rematch` endpoint logic
  - Re-runs matching on unmatched documents
  - Updates sheets with match results
- [x] Implement `POST /api/autofill-bank` endpoint logic
  - Auto-fills bank movement descriptions
  - Uses BankMovementMatcher for document matching
- [x] Create `src/bank/autofill.ts` module
- [x] Write unit tests for scanner module (17 tests)
- [x] Write unit tests for routes (8 tests)
- [x] All 704 tests passing
- [x] Build with zero warnings

---

## Phase 3: Real-time Monitoring ❌ NOT STARTED

### Tasks
- [ ] Implement Drive Push Notifications setup on startup
- [ ] Complete `POST /webhooks/drive` implementation
  - Parse notification headers
  - Queue incremental scans
  - Handle sync messages
- [ ] Add channel auto-renewal with node-cron (every 30 min)
- [ ] Add fallback polling (every 5 min)
- [ ] Full scan on server startup

### Notes
- Drive watch/stop functions exist in `src/services/drive.ts`
- Webhook route stub exists in `src/routes/webhooks.ts`

---

## Phase 4: Extended Classification ❌ NOT STARTED

### New Document Types
| Type | Description |
|------|-------------|
| `factura_emitida` | Invoice FROM ADVA |
| `factura_recibida` | Invoice TO ADVA |
| `pago_enviado` | Payment made by ADVA |
| `pago_recibido` | Payment received by ADVA |
| `resumen_bancario` | Bank statement |
| `recibo` | Salary receipt (unchanged) |

### Tasks
- [ ] Extend Gemini prompts for new types
- [ ] Update parser for new document types
- [ ] Implement file movement to organized folders
- [ ] Update type definitions

---

## Phase 5: Multi-Spreadsheet Support ❌ NOT STARTED

### Tasks
- [ ] Implement spreadsheet routing logic
- [ ] Control de Cobros spreadsheet (Facturas Emitidas + Pagos Recibidos)
- [ ] Control de Gastos spreadsheet (Facturas Recibidas + Pagos Enviados)
- [ ] Per-bank Movimientos spreadsheets
- [ ] Update config for multiple spreadsheet IDs

---

## Current Status

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 0: Cleanup | ✅ Complete | 100% |
| Phase 1: Server Foundation | ✅ Complete | 100% |
| Phase 1.5: Folder Structure | ✅ Complete | 100% |
| Phase 2: Core Processing | ✅ Complete | 100% |
| Phase 3: Real-time Monitoring | ❌ Not Started | 0% |
| Phase 4: Extended Classification | ❌ Not Started | 0% |
| Phase 5: Multi-Spreadsheet | ❌ Not Started | 0% |

**Overall Progress: ~60%** (core processing complete, ready for real-time monitoring)

---

## Files Created in Migration

```
src/
├── server.ts              # NEW - Fastify entry
├── config.ts              # REWRITTEN - env vars
├── routes/
│   ├── status.ts          # NEW
│   ├── scan.ts            # IMPLEMENTED - scan, rematch, autofill-bank
│   └── webhooks.ts        # NEW (stub)
├── services/
│   ├── google-auth.ts     # NEW
│   ├── drive.ts           # NEW
│   ├── sheets.ts          # NEW
│   ├── folder-structure.ts # NEW - folder discovery/caching
│   └── document-sorter.ts # NEW - file movement
├── processing/
│   ├── queue.ts           # NEW
│   └── scanner.ts         # NEW - core processing orchestration
├── bank/
│   └── autofill.ts        # NEW - bank movement auto-fill
├── gemini/
│   └── client.ts          # REWRITTEN - native fetch
└── utils/
    ├── exchange-rate.ts   # REWRITTEN - native fetch
    └── spanish-date.ts    # NEW - month folder names
```

---

## Next Steps

1. **Phase 3 Priority**: Implement real-time monitoring
   - Set up Drive Push Notifications on startup
   - Complete webhook handler for incremental scans
   - Add channel auto-renewal with node-cron
   - Add fallback polling mechanism

2. **Deployment**: Set up Railway.app
   - Create project
   - Configure environment variables
   - Deploy and test endpoints
   - Ensure `DRIVE_ROOT_FOLDER_ID` is set with proper folder structure

3. **Integration Testing**: Add end-to-end tests
   - Test full scan → process → match → sort flow
   - Test rematch functionality
   - Test bank autofill functionality
