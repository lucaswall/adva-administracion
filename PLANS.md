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

## Phase 2: Core Processing ❌ NOT STARTED

### Tasks
- [ ] Port scanner orchestration to `src/processing/scanner.ts`
  - File discovery from Drive
  - Classification with Gemini
  - Data extraction
  - Sheet storage
  - Matching execution
- [ ] Implement `POST /api/scan` endpoint logic
- [ ] Implement `POST /api/rematch` endpoint logic
- [ ] Implement `POST /api/autofill-bank` endpoint logic
- [ ] Write integration tests for processing pipeline

### Notes
- Processing queue infrastructure is ready (`src/processing/queue.ts`)
- Drive and Sheets services are ready
- Gemini client is ready
- Matching logic is preserved and tested
- Need to wire everything together in scanner

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
| Phase 2: Core Processing | ❌ Not Started | 0% |
| Phase 3: Real-time Monitoring | ❌ Not Started | 0% |
| Phase 4: Extended Classification | ❌ Not Started | 0% |
| Phase 5: Multi-Spreadsheet | ❌ Not Started | 0% |

**Overall Progress: ~35%** (infrastructure complete, processing logic pending)

---

## Files Created in Migration

```
src/
├── server.ts              # NEW - Fastify entry
├── config.ts              # REWRITTEN - env vars
├── routes/
│   ├── status.ts          # NEW
│   ├── scan.ts            # NEW (stubs)
│   └── webhooks.ts        # NEW (stub)
├── services/
│   ├── google-auth.ts     # NEW
│   ├── drive.ts           # NEW
│   └── sheets.ts          # NEW
├── processing/
│   └── queue.ts           # NEW
├── gemini/
│   └── client.ts          # REWRITTEN - native fetch
└── utils/
    └── exchange-rate.ts   # REWRITTEN - native fetch
```

---

## Next Steps

1. **Phase 2 Priority**: Implement `src/processing/scanner.ts`
   - This is the main business logic that ties everything together
   - Start with basic scan → classify → extract → store flow
   - Add matching as second step

2. **Testing**: Add integration tests for the scanner
   - Mock Google API responses
   - Test full processing pipeline

3. **Deployment**: Set up Railway.app
   - Create project
   - Configure environment variables
   - Deploy and test endpoints
