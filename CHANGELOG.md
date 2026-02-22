# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lucaswall/adva-administracion/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/lucaswall/adva-administracion/commits/v1.0.0
