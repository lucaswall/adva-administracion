# Migrations

Auto-applied schema migrations for persistent data (spreadsheets, folder structure). Each entry records the trigger condition and the migration path. Migrations must be idempotent — running them again on already-migrated data must be a no-op.

## Subdiario de Ventas — Comprobantes 13 → 14 cols (ADV-272)

**Trigger:** On `syncSubdiario`, before reading the data rows, the writer reads `Comprobantes!A1:N1`. If the header has fewer than 14 cells, OR `M1='notas'` with `N1` empty, the old 13-column layout is detected.

**Rewrite path:**
1. Log `Comprobantes schema migration: 13 → 14 cols (added movimiento)` once per fire.
2. Read `Comprobantes!A2:N` to enumerate the old data rows by sheet index — `A2:N` (not `A2:A`) so rows where `fecha` was manually cleared but other cells remain are still counted. Do NOT parse 13-col data as 14-col data (column shift would mangle `notas` → `movimiento`); the rows are used only for their indices.
3. Emit a full-rewrite `SubdiarioDiff` via `applySubdiarioDiff`: deletes for every old row (DESC) + inserts for every desired row built from current sources.
4. **After** `applySubdiarioDiff` succeeds, overwrite the header row to `A1:N1` with the new 14-column layout (inserts `movimiento` at column M between `recibido` and `notas`). This ordering (data first, header last) is intentional — see crash recovery below.

**Crash recovery (ADV-273):** If the process is killed between step 3 (data rewrite) and step 4 (header rewrite), the workbook is left with the OLD 13-col header on top of NEW 14-col data. On the next boot the trigger fires again, the data rewrite runs idempotently (delete-all + insert-all of the same desired rows), and the header rewrite retries. The inverse ordering would leave NEW 14-col header on top of OLD 13-col data — the trigger would NOT re-fire and `readSubdiarioRows` would mangle the columns indefinitely.

**Idempotency:** Subsequent runs read the 14-col header, skip the migration branch, and take the normal diff path.

**Scope:** Affects every Subdiario de Ventas workbook (one per root folder, so one in staging and one in production). New workbooks created after deploy use the 14-col header from `SUBDIARIO_COMPROBANTES_HEADERS` directly via `initializeComprobantesSheet`.
