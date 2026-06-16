# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- PDF invisible-text scanner (prompt-injection heuristic). It false-flagged legitimate compressed PDFs — Mercado Pago payment receipts and BBVA bank/card statements — as "invisible text" and routed them to *Sin Procesar*. Indirect prompt injection remains mitigated by structural data/instruction delimiting and the output classifier.

## [1.14.0] - 2026-06-12

### Added
- Bank movements that are transfers between ADVA's own accounts (ADVA's CUIT in the concepto, no other counterparty) are now auto-labeled "Transferencia entre cuentas propias" instead of entering the document-matching pool

### Changed
- Bank-fee auto-labeling now recognizes Banco Ciudad and Credicoop fee wordings (comisiones, Ley 25.413, IVA débito fiscal, sellos, intereses por saldo deudor)
- BBVA's monthly card payment, posted with a bare card name (`VISA`, `MASTERCARD`, etc.) as the concepto, is now recognized as a credit-card payment

## [1.13.0] - 2026-06-12

### Added
- Mercado Pago payments ingestion via API: a monthly sync (cron on the 1st + boot-time catch-up) pulls payments into a `Mercado Pago {collectorId} ARS` account with per-month Movimientos tabs (gross credit plus per-charge fee debits) and resumen rows for closed periods — fully idempotent, safe to re-run
- `POST /api/mp-sync` endpoint and "Sincronizar Mercado Pago" item in the Dashboard ADVA menu for manual sync (optional `?period=YYYY-MM`)
- New optional `MP_ACCESS_TOKEN` env var — when unset, the entire Mercado Pago feature is disabled

### Changed
- Bank matching identity comparisons now recognize a DNI embedded in a CUIT/CUIL as the same person — consumidor-final facturas (stored with DNI) now match bank/MP movements carrying the full CUIT
- Mercado Pago accounts use an extended forward factura matching window (+25 days instead of +5) to cover the subscription-billing lag between the charge and the factura emission
- The Entrega flow skips spreadsheet-backed resumen entries that have no PDF (Mercado Pago accounts) instead of failing the copy

## [1.12.0] - 2026-06-12

### Changed
- Status endpoint now reports the real application version instead of a hardcoded placeholder
- Extraction validation hardened at the AI boundary: invalid document types, currencies, and non-numeric amounts are now flagged for human review instead of being stored as-is, and an unrecognized card type is never silently defaulted to Visa

### Fixed
- Matching corrections: credit/debit notes can no longer be claimed by payments, the same transaction can no longer be matched to two different bank movements, salary receipts now match bank movements via the employee's CUIL, and ADVA's own CUIT appearing in a bank concepto no longer blocks matching — run a force re-match after deploy to re-derive existing matches
- `pagada='SI'` is now reverted when the match that justified it is removed, replaced, or force-cleared
- Legitimate negative amounts (account overdrafts, card payments, broker sales) no longer trigger false review flags, and dot-thousands Argentine numbers without decimals (e.g. `1.234.567`) now parse correctly
- Documents whose extracted text contains braces no longer deterministically fail processing and land in Sin Procesar
- Processing reliability: duplicate detection fails closed when its cache cannot load, reprocessing a document preserves its existing match, MANUAL lock, and paid status, bank statements whose movements fail to persist are retried instead of being marked successful, and running-balance formulas no longer corrupt non-empty month sheets
- Automatic file ingestion no longer dies permanently after a single Drive watch-channel renewal failure, and stuck or failed files are correctly re-queued on startup
- USD cross-currency matching now prefetches exchange rates for all relevant documents — some USD matches were previously impossible

### Security
- Fixed dependency vulnerabilities: fast-uri (high) and qs (moderate)
- Hardened the PDF invisible-text scanner (prompt-injection defense): compressed content streams are now decoded, invisible render mode is detected, and graphics-state tracking closes white-on-white bypasses

## [1.11.0] - 2026-05-17

### Added
- Subdiario `nro` column is now a clickable link to the source factura PDF
- Subdiario `movimiento` column now shows a descriptive label (`{bank folder} {YYYY-MM} #{row}`) linked to the exact bank movimiento row, replacing the opaque 3-letter "Mov" tag

### Changed
- Subdiario hard-paid detection now follows one-hop `pago_recibido → factura` indirection — bank-confirmed cuotas that match the pago (not the factura directly) are correctly classified as hard-paid instead of misleadingly tagged "Pendiente confirmación bancaria". Expect a large reshuffle on the first sync after deploy
- Subdiario link cells (`nro`, `movimiento`) switched from `HYPERLINK` formulas to the project-standard `textFormatRuns` shape used by every other sheet — diff equality is now exact, no more semantic-presence workarounds

### Fixed
- Factura E (exports) now hardcodes `condicionIVAReceptor='Exterior'`, bypassing unreliable Gemini extraction that was leaving the field blank or with non-canonical values
- NC E and ND E are now recognized as valid `tipoComprobante` (no longer falsely flagged for review); they inherit the Factura E `condicion='Exterior'` hardcode

## [1.10.0] - 2026-05-13

### Added
- Subdiario de Ventas now has a `movimiento` column with a clickable HYPERLINK to the source Resumen Bancario row for every hard-paid FC (automatic schema migration from 13 → 14 columns)
- Subdiario surfaces a soft-paid intermediate status: FCs with a matched `pago_recibido` but no confirming bank movement are populated with the pago's `fechaCobro` and `recibido` and tagged `"Pendiente confirmación bancaria"` in `notas`

### Changed
- Subdiario scope filter now trusts `pagada='SI'` to drop prior-year paid FCs, closing the gap with Cobros Pendientes (prior-year paid invoices no longer linger in the registry unless a current-year event references them)

### Fixed
- Subdiario soft-paid no longer shows `recibido=0` when a USD pago has neither `importeEnPesos` nor a factura `tipoDeCambio` — falls through to unpaid instead of silently masking the row as paid
- Subdiario schema migration (13 → 14 cols) is now crash-safe — data rewrite completes before the header is widened, preventing a stuck mixed-arity state if the process dies mid-migration

## [1.9.0] - 2026-05-13

### Added
- New "Subdiario de Ventas" workbook auto-synced after every bank match — a chronological registry of every comprobante emitted (FC/NC) with socio category enrichment, NC↔FC linkage, gap detection in numeración, and per-row payment status from matched bank movements
- `POST /api/rebuild-subdiario` endpoint and matching "Reconstruir Subdiario de Ventas" entry in the Dashboard ADVA menu for ad-hoc rebuilds without running a full scan
- Subdiario writes are now incremental — only changed rows are rewritten, so the workbook's revision history stays clean instead of one full overwrite per match
- `condicionIVAReceptor` is now extracted from `factura_emitida` (Responsable Inscripto / Consumidor Final / Monotributo / etc.) and persisted to Control de Ingresos (automatic schema migration)

### Fixed
- Minor refinements to factura/pago, NC/factura, recibo/pago, and retención/factura matching
- Duplicate-cache normalization for wrapped cell values

### Fixed
- Facturas Emitidas (and every other sheet append path) no longer silently drops rows when multiple writes hit the same sheet concurrently — `appendCells` is now serialized per-(spreadsheet, sheet) to prevent the Google Sheets "current end of data" race that lost 9 production facturas over ~3 weeks
- Sheets API responses are now validated to surface silent partial failures, so an unexpected empty `replies` array triggers an automatic retry instead of returning false success
- Intra-scan duplicate detection now works for freshly-added entries — `DuplicateCache.addEntry` normalizes wrapped cell values (CellDate/CellNumber/CellLink/CellFormula) before storing so subsequent dupe checks match the spreadsheet shape

## [1.8.2] - 2026-05-09

### Fixed
- Pagos Pendientes and Cobros Pendientes dashboard sheets no longer include blank rows from empty source rows in Facturas Recibidas/Emitidas
- `fileName` cells in Pagos Pendientes and Cobros Pendientes are now clickable links to the Drive document, matching the rest of the dashboard

## [1.8.1] - 2026-05-09

### Fixed
- "Envío a Contadores" now finds all resumen PDFs in the requested range — previously dropped rows whose `periodo` cell had been auto-formatted by Google Sheets as a date serial instead of plain text

### Changed
- "Envío a Contadores" delivery layout: one standalone spreadsheet per (bank account × month) inside the delivery folder, instead of a single workbook with multiple tabs; credit cards are now included alongside bank accounts with the manually-filled `detalle` column

## [1.8.0] - 2026-05-09

### Added
- "Envío a Contadores" delivery package: new Dashboard menu and API endpoints assemble bank, credit card, and broker resumen PDFs plus a per-bank Movimientos workbook into a flat `Entregas/` folder for delivery to accountants
- BBVA pago extraction now uses the document filename as a hint to disambiguate transfer-vs-payment cases on ambiguous documents
- Manually-filled `detalle` column on the Resumen Tarjeta schema for human-entered credit-card payment notes (automatic migration)

### Fixed
- Bank movement matcher now skips non-bank movimientos sheets via header schema check, preventing false matches against unrelated tabs

### Security
- Filename hints are sanitized before being interpolated into Gemini prompts, preventing indirect prompt injection from email-attachment filenames
- Delivery endpoints verify `folderId` is a descendant of the configured `Entregas/` subtree, preventing IDOR via authenticated callers

## [1.7.0] - 2026-05-07

### Added
- Daily Gemini API budget cap to prevent unbounded LLM cost from authenticated misuse or webhook replays
- PDF invisible-text sanitization before submission to Gemini, mitigating indirect prompt-injection from malicious documents
- `hasCuitMatch` column persisted in Recibos sheet (schema v6, automatic migration)

### Changed
- Single shared GeminiClient now enforces the configured RPM cap across concurrent file processing (previously up to 12× over the configured limit)
- `isDescendantOf` has a 10-second overall deadline so a hung Drive API can no longer hold the scan handler open

### Fixed
- `/api/rematch` now acquires the processing lock, preventing concurrent corruption with scans and movimientos matching
- LockManager release now CAS-checks the holder, so a stale release after auto-expiry can no longer delete another holder's lock
- Scanner queue rejections, watch-manager cron failures, and signal-handler shutdown errors are now caught instead of becoming unhandled promise rejections
- `pagada='SI'` write no longer silently skipped when the preceding `detalle` batchUpdate fails
- Service-account credentials are now required at boot regardless of `NODE_ENV` — staging deploys no longer start silently without them

### Security
- `/api/scan` now restricts `folderId` to descendants of the configured root, so authenticated callers can no longer scan arbitrary Drive folders
- HTTP 500 responses no longer echo internal `error.message` verbatim, preventing leakage of Drive IDs and internal state
- Cleared 22 transitive Dependabot alerts via dependency updates across server and MCP subprojects

## [1.6.0] - 2026-05-06

### Added
- Apps Script bundle is now built and pushed to the bound script project automatically on Railway boot, removing the manual clasp deploy step

### Changed
- Negative exchange-rate API responses are cached so missing rates no longer spam the production logs on every match attempt
- Resumen duplicates are now visibly recorded as `duplicate` in the Dashboard tracking sheet instead of silently being marked as `success`
- Credicoop bank statement extraction now anchors on the statement period header, fixing the 2-7 day window that was being returned for monthly summaries
- Recibo-pago cascade reads `hasCuitMatch` directly from the document instead of inferring it from match confidence, fixing displacement decisions for MANUAL-locked recibos
- Node 24 is now explicitly pinned on Railway via nixpacks.toml and `.nvmrc`; `@types/node` synced to the Node 24 line; all other dependencies bumped to latest
- Build now installs dev dependencies during `npm ci` so TypeScript is available at build time on Railway

## [1.5.0] - 2026-03-03

### Added
- Payment tracking for issued invoices (Facturas Emitidas): a new `pagada` column marks invoices as paid when matched by a payment or bank movement
- Cobros Pendientes dashboard: a new sheet listing unpaid issued invoices, mirroring the existing Pagos Pendientes sheet for received invoices
- Bank movement matching now marks facturas as paid (`pagada='SI'`) in both Ingresos and Egresos when a movement is matched
- NC/ND matching extended to Facturas Emitidas — credit/debit notes now cancel issued invoices the same way they already did for received invoices

### Fixed
- Pago displacement no longer clears a factura's paid status that was set by a Nota de Crédito
- NC matching partial-write failure no longer leaves the NC permanently unmatched on subsequent runs

## [1.4.1] - 2026-02-26

### Fixed
- Notas de Crédito and Notas de Débito were incorrectly included in the bank movement matching pool, potentially causing false matches

## [1.4.0] - 2026-02-26

### Added
- Bank movement descriptions for Factura E (USD) credit matches now include exchange rate details: original rate from the invoice (TC orig) and effective liquidation rate calculated from the actual bank credit amount (TC liq)

## [1.3.0] - 2026-02-25

### Added
- Schema version tracking: startup migrations are now version-gated via a `.schema_version` file, running only new migrations instead of checking all schemas on every startup

### Fixed
- Reprocessed document rows had inconsistent spreadsheet formatting compared to newly created rows (text strings instead of proper numbers, missing date formatting)
- Dashboard processing timestamps displayed in inconsistent format for older entries
- Pending payment dates displayed incorrectly when read back from spreadsheets

## [1.2.0] - 2026-02-24

### Added
- Retencion-factura matching: retenciones are now automatically linked to their corresponding facturas
- MANUAL match locking: documents and bank movements marked as MANUAL are permanently protected from automatic re-matching
- Automatic spreadsheet schema migrations on server startup for seamless column additions
- Match origin tracking (AUTO/MANUAL) visible in bank movements spreadsheet

### Changed
- Bank movement matching now prevents the same document from being matched across different bank accounts (cross-bank deduplication)

### Fixed
- Monetary values stored as text strings in spreadsheets instead of proper numbers, breaking formulas and sorting
- ARS credit matching used incorrect tolerance (inconsistent with debit matching)
- USD payments without explicit ARS amount couldn't match ARS bank debits
- Force re-matching left stale match data when no new match was found

## [1.1.0] - 2026-02-23

### Added
- Exchange rate (tipo de cambio) extraction from invoices and COMEX payments, stored in new spreadsheet columns with automatic schema migration
- Reprocessing support: files moved back to Entrada are re-extracted and existing spreadsheet rows updated instead of being flagged as duplicates
- Smarter duplicate detection for payments: newer documents with more data (e.g., exchange rate, signed status) replace lower-quality existing entries

### Changed
- Bank movement descriptions now include factura number and comprobante type (e.g., "Cobro Factura E 00003-00001957 de Cliente SA")
- COMEX bank movement descriptions include the bank's exchange rate (tipo de cambio)
- Cross-currency bank matching uses the payment's exact ARS amount when available, eliminating tolerance-based matching
- Factura filenames now include the comprobante letter (e.g., "Factura C Emitida" instead of "Factura Emitida")

### Fixed
- Same-currency (USD-to-USD) matching incorrectly applied cross-currency conversion
- Existing Tier 3/4 bank matches could be incorrectly replaced by weaker Tier 5 candidates
- Exchange rate API failure during prefetch crashed the entire bank matching operation instead of falling back gracefully
- Recibo bank matches were assigned HIGH confidence instead of the correct LOW for their tier

## [1.0.0] - 2026-02-22

### Added
- Environment marker files (`.staging` / `.production`) in Drive root folder to prevent cross-environment data corruption at startup
- Distinct `duplicate` status and `originalFileId` column (F) in Dashboard Archivos Procesados tracking sheet
- Dual Drive root folder IDs in `.env` (`DRIVE_ROOT_FOLDER_ID_PRODUCTION` / `DRIVE_ROOT_FOLDER_ID_STAGING`) for investigation skill
- Tier-based bank movement matching algorithm: Pago+Factura link (T1), CUIT from concepto (T2), referencia (T3), name token score (T4), amount+date (T5)
- Referencia extraction for ORDEN DE PAGO DEL EXTERIOR credit movements (Tier 3 matching)
- Dynamic concurrency throttling under Google Sheets quota pressure
- CI workflow for pull requests with pinned Node 24

### Changed
- CUIT/name matching in bank movement matcher extended to cover Ingresos (Facturas Emitidas ↔ Pagos Recibidos)
- Exchange rate API fetch now has 30-second timeout with `AbortController`; rates prefetched before `matchAllMovimientos`
- Pago date window expanded from ±1 to ±15 days; credit card payment patterns extended to match card type names

### Fixed
- Files stuck in Entrada folder after a failed move are now recovered automatically on the next scan
- Date serial number parsing corrected in bank movimientos matching, NC-factura matcher, and recibo-pago matcher
- `processedAt` serial number format in retry path caused infinite stale recovery loop
- Formula injection via spreadsheet strings starting with `=`
- Token usage logger TOCTOU race condition and unhandled async callback
- Unmatch cleanup missing in recibo-pago cascade displacement
- Bank fee detalle never written to movimientos spreadsheet; bank fee check missing from credit movement path
- `usageMetadata` discarded on Gemini error responses
- API_SECRET single-quote injection in Apps Script build script

### Security
- Updated fastify to fix high-severity Content-Type body validation bypass and low-severity DoS vulnerability
- Updated googleapis to v171, @google/clasp to v3, and resolved 6 npm audit vulnerabilities

[Unreleased]: https://github.com/lucaswall/adva-administracion/compare/v1.14.0...HEAD
[1.14.0]: https://github.com/lucaswall/adva-administracion/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/lucaswall/adva-administracion/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/lucaswall/adva-administracion/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/lucaswall/adva-administracion/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/lucaswall/adva-administracion/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/lucaswall/adva-administracion/compare/v1.8.3...v1.9.0
[1.8.3]: https://github.com/lucaswall/adva-administracion/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/lucaswall/adva-administracion/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/lucaswall/adva-administracion/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/lucaswall/adva-administracion/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/lucaswall/adva-administracion/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/lucaswall/adva-administracion/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/lucaswall/adva-administracion/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/lucaswall/adva-administracion/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/lucaswall/adva-administracion/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/lucaswall/adva-administracion/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/lucaswall/adva-administracion/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/lucaswall/adva-administracion/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/lucaswall/adva-administracion/commits/v1.0.0
