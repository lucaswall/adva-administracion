# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lucaswall/adva-administracion/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/lucaswall/adva-administracion/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/lucaswall/adva-administracion/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/lucaswall/adva-administracion/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/lucaswall/adva-administracion/commits/v1.0.0
