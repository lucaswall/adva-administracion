# Migrations

Auto-applied schema migrations for persistent data (spreadsheets, folder structure). Each entry records the trigger condition and the migration path. Migrations must be idempotent — running them again on already-migrated data must be a no-op.

## Subdiario de Ventas — Comprobantes 13 → 14 cols (ADV-272)

**Trigger:** On `syncSubdiario`, before reading the data rows, the writer reads `Comprobantes!A1:N1`. If the header has fewer than 14 cells, OR `M1='notas'` with `N1` empty, the old 13-column layout is detected.

**Rewrite path:**
1. Overwrite the header row to `A1:N1` with the new 14-column layout (inserts `movimiento` at column M between `recibido` and `notas`).
2. Read `Comprobantes!A2:A` to enumerate the old data rows by sheet index — do NOT parse 13-col data as 14-col data (column shift would mangle `notas` → `movimiento`).
3. Emit a full-rewrite `SubdiarioDiff` via `applySubdiarioDiff`: deletes for every old row (DESC) + inserts for every desired row built from current sources.
4. Log `Comprobantes schema migration: 13 → 14 cols (added movimiento)` once per fire.

**Idempotency:** Subsequent runs read the 14-col header, skip the migration branch, and take the normal diff path.

**Scope:** Affects every Subdiario de Ventas workbook (one per root folder, so one in staging and one in production). New workbooks created after deploy use the 14-col header from `SUBDIARIO_COMPROBANTES_HEADERS` directly via `initializeComprobantesSheet`.
