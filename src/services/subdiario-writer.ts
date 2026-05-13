/**
 * Subdiario de Ventas writer service
 * Orchestrates reading source data and writing to the Subdiario de Ventas workbook.
 *
 * Cross-worker dependencies (resolved at merge time by team lead):
 *  - buildSubdiarioRows from ./subdiario-builder.js  (worker-3)
 *  - readFacturador       from ./facturador-reader.js (worker-2)
 */

import type {
  Result,
  SubdiarioRow,
  SubdiarioRowWithIndex,
  SubdiarioDiff,
  SubdiarioInput,
  BankMovimiento,
} from '../types/index.js';
import {
  getValues,
  setValues,
  getSheetMetadata,
  renameSheet,
  formatSheet,
  applySubdiarioDiff,
  type CellValue,
  type NumberFormat,
} from './sheets.js';
import { findByName, createSpreadsheet } from './drive.js';
import { getCachedFolderStructure } from './folder-structure.js';
import { SUBDIARIO_COMPROBANTES_HEADERS } from '../constants/spreadsheet-headers.js';
import { info, warn, debug, error as logError } from '../utils/logger.js';
import { getCorrelationId } from '../utils/correlation.js';
import { normalizeSpreadsheetDate } from '../utils/date.js';
import { parseNumber } from '../utils/numbers.js';
import {
  parseFacturasEmitidas,
  parsePagos,
  parseRetenciones,
} from '../bank/match-movimientos.js';
import { buildSubdiarioRows } from './subdiario-builder.js';
import { readFacturador } from './facturador-reader.js';
import { diffSubdiarioRows } from './subdiario-diff.js';
import { withLockResult } from '../utils/concurrency.js';

/** MIME type for Google Sheets spreadsheets */
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/**
 * Lock wait timeout for the Comprobantes sheet-append lock.
 * Matches the constant used by appendRowsWithLinks in sheets.ts (ADV-242).
 */
const COMPROBANTES_LOCK_WAIT_MS = 60_000;

/**
 * Lock auto-expiry for the Comprobantes sheet-append lock.
 * Generous timeout: covers worst-case withQuotaRetry chains (~12 min).
 * The lock exists only to recover from a crashed holder, not to bound normal slow paths.
 */
const COMPROBANTES_LOCK_EXPIRY_MS = 900_000;

/** Name of the Subdiario workbook in Drive */
const SUBDIARIO_NAME = 'Subdiario de Ventas';

/** Name of the Comprobantes sheet inside the Subdiario workbook */
const COMPROBANTES_SHEET = 'Comprobantes';

/**
 * Result of the Subdiario sync operation.
 */
export interface SyncSubdiarioResult {
  /** Number of data rows that SHOULD be in the sheet (desired.length) */
  rowsWritten: number;
  /** Number of rows flagged as payment gaps by the builder */
  gapsDetected: number;
  /** Number of rows inserted by the incremental diff */
  inserts: number;
  /** Number of rows updated in place by the incremental diff */
  updates: number;
  /** Number of rows deleted by the incremental diff */
  deletes: number;
  /** True when the sort invariant was violated and the diff fell back to a full rewrite */
  sortInvariantFallback: boolean;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Resolves the Subdiario spreadsheet ID.
 * Resolution order: FolderStructure cache → Drive search → create.
 *
 * @param rootFolderId - Root Drive folder ID
 * @returns `{ id, isNew }` — isNew=true when the workbook was just created
 */
export async function resolveSubdiarioId(
  rootFolderId: string
): Promise<Result<{ id: string; isNew: boolean }, Error>> {
  const cached = getCachedFolderStructure();

  // 1. Check cache
  if (cached?.subdiarioId) {
    return { ok: true, value: { id: cached.subdiarioId, isNew: false } };
  }

  // 2. Search Drive
  const findResult = await findByName(rootFolderId, SUBDIARIO_NAME, SPREADSHEET_MIME);
  if (!findResult.ok) return findResult;

  if (findResult.value) {
    const id = findResult.value.id;
    if (cached) cached.subdiarioId = id;
    return { ok: true, value: { id, isNew: false } };
  }

  // 3. Create new workbook
  const createResult = await createSpreadsheet(rootFolderId, SUBDIARIO_NAME);
  if (!createResult.ok) return createResult;

  const id = createResult.value.id;
  if (cached) cached.subdiarioId = id;
  info('Created Subdiario de Ventas workbook', {
    module: 'subdiario-writer',
    phase: 'create-workbook',
    spreadsheetId: id,
  });
  return { ok: true, value: { id, isNew: true } };
}

/**
 * Reads current rows from the Comprobantes sheet.
 *
 * Parses `Comprobantes!A2:N` (data rows only — header is at A1) and returns
 * them as `SubdiarioRowWithIndex` values with 0-based sheet positions.
 *
 * Parsing mirrors the cell-emission rules in `syncSubdiario` exactly so that
 * a row written by this writer round-trips without spurious updates on the
 * first incremental diff after deploy.
 *
 * Column M (movimiento) round-trip caveat (ADV-272): `getValues` uses
 * `UNFORMATTED_VALUE`, which returns the *displayed* text of HYPERLINK formulas
 * ("Mov"), not the formula or URL. The diff equality check in
 * `subdiario-diff.ts` therefore compares this column on semantic presence only.
 *
 * @internal Exported for test reach only. Do not call from outside this module.
 *
 * @param spreadsheetId - Subdiario spreadsheet ID
 */
export async function readSubdiarioRows(
  spreadsheetId: string
): Promise<Result<SubdiarioRowWithIndex[], Error>> {
  const valuesResult = await getValues(spreadsheetId, `${COMPROBANTES_SHEET}!A2:N`);
  if (!valuesResult.ok) return valuesResult;

  const rawRows = valuesResult.value;
  const result: SubdiarioRowWithIndex[] = [];

  for (let sheetPos = 0; sheetPos < rawRows.length; sheetPos++) {
    const row = rawRows[sheetPos] ?? [];

    // Col A: fecha — skip row if empty after normalization
    const fecha = normalizeSpreadsheetDate(row[0]);
    if (!fecha) continue;

    // Col C: tipo — warn if unknown but keep row
    const tipo = String(row[2] ?? '').trim();
    if (tipo !== 'FC' && tipo !== 'NC') {
      warn('readSubdiarioRows: unknown tipo — keeping row', {
        module: 'subdiario-writer',
        phase: 'read-comprobantes',
        sheetPos,
        tipo,
      });
    }

    // Col H: total — parseNumber with 0 fallback (null → 0, NaN impossible from parseNumber)
    const total = parseNumber(row[7]) ?? 0;

    // Col K: fechaCobro — serial → date string; string → pass through
    // Edge case: serial=0 maps to "1899-12-30" in Sheets — treat as blank instead.
    // normalizeSpreadsheetDate(0) returns '1899-12-30' (truthy), so `|| ''` cannot
    // distinguish it from a valid date. Guard on the raw value instead.
    const fechaCobroCell = row[10];
    const fechaCobro =
      typeof fechaCobroCell === 'number'
        ? (fechaCobroCell === 0 ? '' : normalizeSpreadsheetDate(fechaCobroCell))
        : String(fechaCobroCell ?? '').trim();

    // Col L: recibido — empty/blank → null; non-empty → parseNumber
    const recibidoCell = row[11];
    const recibidoStr = String(recibidoCell ?? '').trim();
    const recibido = recibidoStr === '' ? null : parseNumber(recibidoCell);

    result.push({
      rowIndex: sheetPos,
      fecha,
      cod:       String(row[1] ?? '').trim(),
      tipo:      tipo as SubdiarioRow['tipo'],
      nro:       String(row[3] ?? '').trim(),
      cliente:   String(row[4] ?? '').trim(),
      cuit:      String(row[5] ?? '').trim(),
      condicion: String(row[6] ?? '').trim(),
      total,
      concepto:  String(row[8] ?? '').trim(),
      categoria: String(row[9] ?? '').trim(),
      fechaCobro,
      recibido,
      movimiento: String(row[12] ?? '').trim(),
      notas:     String(row[13] ?? '').trim(),
    });
  }

  return { ok: true, value: result };
}

/**
 * Renames Sheet1 → Comprobantes, freezes row 1, applies date/number formats
 * to typed columns, and writes the header row. Called only when the workbook
 * was just created.
 *
 * Visual chrome (column widths, banding, header background, protected range,
 * locale) is intentionally NOT applied here — those are user-controlled in
 * the Sheets UI. Only cell-type formats (date pattern + number pattern) are
 * baked in, matching the convention used by other project sheets.
 *
 * @param spreadsheetId - The newly-created Subdiario spreadsheet ID
 */
async function initializeComprobantesSheet(
  spreadsheetId: string
): Promise<Result<void, Error>> {
  // Get current sheet metadata to find Sheet1
  const metadataResult = await getSheetMetadata(spreadsheetId);
  if (!metadataResult.ok) return metadataResult;

  // Fall back to the first available sheet if the locale-specific name differs
  // (e.g. "Hoja 1" on Spanish Drive, "Feuille 1" on French Drive).
  const sheet1 = metadataResult.value.find((s) => s.title === 'Sheet1') ?? metadataResult.value[0];
  if (!sheet1) {
    return { ok: false, error: new Error('No sheets found in newly-created workbook') };
  }

  const renameResult = await renameSheet(spreadsheetId, sheet1.sheetId, COMPROBANTES_SHEET);
  if (!renameResult.ok) return renameResult;

  // Freeze row 1 + bold header + date/number formats on typed columns.
  const numberFormats = new Map<number, NumberFormat>([
    [0,  { type: 'date' }],                // fecha
    [7,  { type: 'number', decimals: 2 }], // total
    [10, { type: 'date' }],                // fechaCobro
    [11, { type: 'number', decimals: 2 }], // recibido
  ]);
  const formatResult = await formatSheet(spreadsheetId, sheet1.sheetId, {
    frozenRows: 1,
    numberFormats,
  });
  if (!formatResult.ok) return formatResult;

  // Write header row
  const setResult = await setValues(
    spreadsheetId,
    `${COMPROBANTES_SHEET}!A1`,
    [SUBDIARIO_COMPROBANTES_HEADERS]
  );
  if (!setResult.ok) return setResult;

  return { ok: true, value: undefined };
}

/**
 * Reads all movimiento rows from the provided movimientos spreadsheets
 * and parses them into typed `BankMovimiento` objects.
 *
 * Movimientos sheet schema (9 cols A:I):
 *   A fecha | B descripcion | C debito | D credito | E saldo
 *   F saldoCalculado | G matchedFileId | H matchedType | I detalle
 */
async function readMovimientosRows(
  movimientosSpreadsheets: Map<string, string>
): Promise<BankMovimiento[]> {
  if (movimientosSpreadsheets.size === 0) return [];

  const allMovs: BankMovimiento[] = [];

  for (const [key, spreadsheetId] of movimientosSpreadsheets) {
    const metadataResult = await getSheetMetadata(spreadsheetId);
    if (!metadataResult.ok) {
      warn('Failed to get movimientos sheet metadata', {
        module: 'subdiario-writer',
        phase: 'read-movimientos',
        key,
        error: metadataResult.error.message,
      });
      continue;
    }

    for (const sheet of metadataResult.value) {
      if (!/^\d{4}-\d{2}$/.test(sheet.title)) continue;

      const rowsResult = await getValues(spreadsheetId, `${sheet.title}!A:I`);
      if (!rowsResult.ok) {
        warn('Failed to read movimientos sheet', {
          module: 'subdiario-writer',
          phase: 'read-movimientos',
          key,
          sheet: sheet.title,
          error: rowsResult.error.message,
        });
        continue;
      }

      const dataRows = rowsResult.value.slice(1);
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (!row || row.length === 0) continue;
        const fecha = normalizeSpreadsheetDate(row[0]);
        if (!fecha) continue;
        const matchedTypeRaw = String(row[7] ?? '');
        const matchedType: BankMovimiento['matchedType'] =
          matchedTypeRaw === 'AUTO' || matchedTypeRaw === 'MANUAL' ? matchedTypeRaw : '';
        // rowNumber is 1-indexed: header is row 1, first data row is row 2
        const rowNumber = i + 2;
        const sourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheet.sheetId}&range=A${rowNumber}`;
        allMovs.push({
          fecha,
          debito: parseNumber(row[2]) || null,
          credito: parseNumber(row[3]) || null,
          matchedFileId: String(row[6] ?? ''),
          matchedType,
          concepto: String(row[1] ?? ''),
          sourceUrl,
        });
      }
    }
  }

  return allMovs;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Syncs the Subdiario de Ventas workbook.
 *
 * Orchestrates:
 *   1. Resolve or create the Subdiario spreadsheet
 *   2. Initialize Comprobantes sheet on first run (rename, freeze, header)
 *   3. Read source data (Facturas Emitidas, Pagos Recibidos, Retenciones, Facturador, Movimientos)
 *   4. Delegate to buildSubdiarioRows
 *   5. Resolve Comprobantes sheetId (required by batchUpdate for row addressing)
 *   6. Compute desired row count and gap count from the desired row set
 *   7. Under sheet-append lock: read existing rows → diff → applySubdiarioDiff (single batchUpdate)
 *      Sort-invariant fallback: full rewrite (delete-all DESC + insert-all) in one batchUpdate
 *
 * Concurrency: step 7 holds the same `sheet-append:${id}:Comprobantes` lock used by
 * appendRowsWithLinks, serializing all writers to the Comprobantes sheet (ADV-242).
 *
 * @param rootFolderId       - Drive root folder ID
 * @param controlIngresosId  - Control de Ingresos spreadsheet ID
 * @param controlEgresosId   - Control de Egresos spreadsheet ID (reserved for future use)
 * @param facturadorYear     - Year used to read Facturador de Socios data
 * @param movimientosSpreadsheets - Map of (year:bankFolder) → movimientos spreadsheet IDs
 * @returns rowsWritten, gapsDetected, and incremental diff counts
 */
export async function syncSubdiario(
  rootFolderId: string,
  controlIngresosId: string,
  _controlEgresosId: string,
  facturadorYear: number,
  movimientosSpreadsheets: Map<string, string>
): Promise<Result<SyncSubdiarioResult, Error>> {
  const correlationId = getCorrelationId();

  try {
    info('Starting Subdiario de Ventas sync', {
      module: 'subdiario-writer',
      phase: 'sync',
      rootFolderId,
      controlIngresosId,
      facturadorYear,
      movimientosCount: movimientosSpreadsheets.size,
      correlationId,
    });

    // Step 1: Resolve subdiarioId
    const resolveResult = await resolveSubdiarioId(rootFolderId);
    if (!resolveResult.ok) {
      logError('Failed to resolve Subdiario workbook', {
        module: 'subdiario-writer',
        phase: 'resolve-workbook',
        error: resolveResult.error.message,
        correlationId,
      });
      return resolveResult;
    }

    const { id: subdiarioId, isNew } = resolveResult.value;

    // Step 2: Initialize sheet on first creation
    if (isNew) {
      const initResult = await initializeComprobantesSheet(subdiarioId);
      if (!initResult.ok) {
        logError('Failed to initialize Comprobantes sheet', {
          module: 'subdiario-writer',
          phase: 'init-sheet',
          spreadsheetId: subdiarioId,
          error: initResult.error.message,
          correlationId,
        });
        return initResult;
      }
    }

    // Step 3: Read source data
    // Facturas Emitidas grew to 21 columns (A:U) after ADV-245 (condicionIVAReceptor at H)
    const [facturasResult, pagosResult, retencionesResult] = await Promise.all([
      getValues(controlIngresosId, 'Facturas Emitidas!A:U'),
      getValues(controlIngresosId, 'Pagos Recibidos!A:Q'),
      getValues(controlIngresosId, 'Retenciones Recibidas!A:O'),
    ]);

    if (!facturasResult.ok) {
      logError('Failed to read Facturas Emitidas', {
        module: 'subdiario-writer',
        phase: 'read-data',
        error: facturasResult.error.message,
        correlationId,
      });
      return facturasResult;
    }
    if (!pagosResult.ok) {
      logError('Failed to read Pagos Recibidos', {
        module: 'subdiario-writer',
        phase: 'read-data',
        error: pagosResult.error.message,
        correlationId,
      });
      return pagosResult;
    }
    if (!retencionesResult.ok) {
      logError('Failed to read Retenciones Recibidas', {
        module: 'subdiario-writer',
        phase: 'read-data',
        error: retencionesResult.error.message,
        correlationId,
      });
      return retencionesResult;
    }

    const facturadorResult = await readFacturador(facturadorYear);
    if (!facturadorResult.ok) {
      logError('Failed to read Facturador de Socios', {
        module: 'subdiario-writer',
        phase: 'read-data',
        error: facturadorResult.error.message,
        correlationId,
      });
      return facturadorResult;
    }

    const movimientos = await readMovimientosRows(movimientosSpreadsheets);

    const input: SubdiarioInput = {
      currentYear: facturadorYear,
      // Subdiario needs both FCs AND NCs for scope rule (c) and findCancellingNC lookup.
      // NDs are excluded — the builder does not model them.
      facturasEmitidas: parseFacturasEmitidas(facturasResult.value as CellValue[][], {
        includeNc: true,
      }),
      pagosRecibidos: parsePagos(pagosResult.value as CellValue[][]),
      retencionesRecibidas: parseRetenciones(retencionesResult.value as CellValue[][]),
      facturador: facturadorResult.value,
      movimientos,
    };

    // Step 4: Build rows (pure — throws on error)
    let rows: SubdiarioRow[];
    try {
      rows = buildSubdiarioRows(input);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logError('buildSubdiarioRows threw an error', {
        module: 'subdiario-writer',
        phase: 'build-rows',
        error: error.message,
        correlationId,
      });
      return { ok: false, error };
    }

    info('Builder produced rows', {
      module: 'subdiario-writer',
      phase: 'build-rows',
      rowCount: rows.length,
      correlationId,
    });

    // Step 5: Resolve Comprobantes sheetId (needed for batchUpdate row addressing)
    const metaResult = await getSheetMetadata(subdiarioId);
    if (!metaResult.ok) {
      logError('Failed to get Comprobantes sheet metadata', {
        module: 'subdiario-writer',
        phase: 'resolve-sheet-id',
        error: metaResult.error.message,
        correlationId,
      });
      return metaResult;
    }
    const comprobantesSheet = metaResult.value.find((s) => s.title === COMPROBANTES_SHEET);
    if (!comprobantesSheet) {
      const err = new Error(`Sheet '${COMPROBANTES_SHEET}' not found in Subdiario workbook`);
      logError('Comprobantes sheet not found', {
        module: 'subdiario-writer',
        phase: 'resolve-sheet-id',
        error: err.message,
        correlationId,
      });
      return { ok: false, error: err };
    }

    // Step 6: Compute stable counts from the desired row set
    const rowsWritten = rows.length;
    // Placeholder rows for AFIP numbering gaps have cliente='FALTA <nro>'
    const gapsDetected = rows.filter((r) => r.cliente.startsWith('FALTA ')).length;

    // Step 7: Incremental diff + single batchUpdate under the append lock
    // (same lock key as appendRowsWithLinks — serializes all writers to Comprobantes, ADV-242)
    const lockKey = `sheet-append:${subdiarioId}:${COMPROBANTES_SHEET}`;
    const diffResult = await withLockResult(
      lockKey,
      async (): Promise<Result<{ inserts: number; updates: number; deletes: number; sortInvariantFallback: boolean }, Error>> => {
        // ── Schema migration trigger (ADV-272) ─────────────────────────────
        // Production / staging workbooks started at 13 cols (A:M). Detect the
        // old header and force a one-shot full rewrite to 14 cols (A:N). The
        // migration is idempotent — subsequent runs no-op via the diff path.
        let schemaMigration = false;
        if (!isNew) {
          const headerResult = await getValues(subdiarioId, `${COMPROBANTES_SHEET}!A1:N1`);
          if (!headerResult.ok) return headerResult;
          const header = headerResult.value[0] ?? [];
          const m1 = String(header[12] ?? '').trim();
          const n1 = String(header[13] ?? '').trim();
          // Old layout: header has < 14 cells, OR M1='notas' AND N1 is empty.
          //
          // Crash-recovery ordering (ADV-273): the header rewrite is DEFERRED
          // until AFTER the data rewrite succeeds. A crash between the two
          // operations leaves the OLD 13-col header in place, so the next boot
          // re-triggers the migration → the full-rewrite data step is
          // idempotent (delete-all + insert-all of the same desired rows) →
          // the header write retries. The inverse order would leave a NEW
          // 14-col header on top of OLD 13-col data, which silently bypasses
          // the migration on next boot and mis-aligns columns indefinitely.
          if (header.length < 14 || (m1 === 'notas' && n1 === '')) {
            schemaMigration = true;
            info('Comprobantes schema migration: 13 → 14 cols (added movimiento)', {
              module: 'subdiario-writer',
              phase: 'schema-migration',
              spreadsheetId: subdiarioId,
              correlationId,
            });
          }
        }

        // Read existing rows.
        //   - Workbook just created (isNew) → empty (no data rows yet).
        //   - Schema migration → fetch ONLY row indices for delete emission, do
        //     NOT parse 13-col data as 14-col data (column shift would mangle
        //     notas → movimiento and lose the real notas).
        //   - Normal path → full parse via readSubdiarioRows.
        const existing: SubdiarioRowWithIndex[] = [];
        if (schemaMigration) {
          // Read the full row range (A:N) for counting only — A2:A would miss
          // any row where fecha was manually cleared but other cells remain.
          // The Sheets API still trims fully-empty trailing rows, which is the
          // correct behavior (a truly empty row should not be re-inserted).
          const oldDataResult = await getValues(subdiarioId, `${COMPROBANTES_SHEET}!A2:N`);
          if (!oldDataResult.ok) return oldDataResult;
          // Index-only stubs — real fields aren't used because we fall through
          // to the full-rewrite branch below.
          for (let i = 0; i < oldDataResult.value.length; i++) {
            existing.push({
              rowIndex: i,
              fecha: '', cod: '', tipo: 'FC', nro: '', cliente: '', cuit: '',
              condicion: '', total: 0, concepto: '', categoria: '',
              fechaCobro: '', recibido: null, movimiento: '', notas: '',
            });
          }
        } else if (!isNew) {
          const readResult = await readSubdiarioRows(subdiarioId);
          if (!readResult.ok) return readResult;
          existing.push(...readResult.value);
        }

        // On migration, skip the diff entirely and run the full-rewrite branch.
        const diff = schemaMigration
          ? {
              updates: [],
              inserts: [],
              deletes: [],
              sortInvariantViolated: true,
              duplicateKeysDetected: false,
            }
          : diffSubdiarioRows(existing, rows);

        // No-op short-circuit: nothing changed
        if (
          diff.updates.length === 0 &&
          diff.inserts.length === 0 &&
          diff.deletes.length === 0 &&
          !diff.sortInvariantViolated
        ) {
          debug('Subdiario sync: no changes detected — skipping batchUpdate', {
            module: 'subdiario-writer',
            phase: 'diff',
            correlationId,
          });
          return { ok: true, value: { inserts: 0, updates: 0, deletes: 0, sortInvariantFallback: false } };
        }

        // Sort-invariant fallback: emit a one-shot full rewrite
        if (diff.sortInvariantViolated) {
          // ADV-275: the schema migration reuses this branch with index-only
          // stubs, so the out-of-order pair detection would always report []
          // and the warn would be misleading. Suppress the warn during
          // migration — the dedicated migration info log already fired above.
          if (!schemaMigration) {
            const outOfOrderPairs = existing
              .slice(0, -1)
              .reduce<string[]>((acc, row, i) => {
                const next = existing[i + 1]!;
                if (row.fecha > next.fecha || (row.fecha === next.fecha && row.nro > next.nro)) {
                  if (acc.length < 10) acc.push(`[${row.rowIndex}]${row.fecha}/${row.nro} > [${next.rowIndex}]${next.fecha}/${next.nro}`);
                }
                return acc;
              }, []);
            warn('Comprobantes sheet is out of order — falling back to full rewrite (one-shot)', {
              module: 'subdiario-writer',
              phase: 'diff',
              outOfOrderPairs,
              correlationId,
            });
          }
          const rewriteDiff: SubdiarioDiff = {
            updates: [],
            inserts: rows.map((row, i) => ({ insertAt: i, row })),
            deletes: existing.map((r) => r.rowIndex).sort((a, b) => b - a),
            sortInvariantViolated: true,
            duplicateKeysDetected: diff.duplicateKeysDetected,
          };
          const rewriteResult = await applySubdiarioDiff(subdiarioId, comprobantesSheet.sheetId, rewriteDiff, rows);
          if (!rewriteResult.ok) return rewriteResult;

          // ADV-273: header rewrite happens AFTER the data rewrite succeeds.
          // See schema-migration detection above for the crash-recovery rationale.
          if (schemaMigration) {
            const headerWriteResult = await setValues(
              subdiarioId,
              `${COMPROBANTES_SHEET}!A1:N1`,
              [SUBDIARIO_COMPROBANTES_HEADERS as unknown as CellValue[]]
            );
            if (!headerWriteResult.ok) return headerWriteResult;
          }

          return {
            ok: true,
            value: { ...rewriteResult.value, sortInvariantFallback: true },
          };
        }

        // Normal incremental batchUpdate
        const applyResult = await applySubdiarioDiff(subdiarioId, comprobantesSheet.sheetId, diff, rows);
        if (!applyResult.ok) return applyResult;
        return {
          ok: true,
          value: { ...applyResult.value, sortInvariantFallback: false },
        };
      },
      COMPROBANTES_LOCK_WAIT_MS,
      COMPROBANTES_LOCK_EXPIRY_MS,
    );

    if (!diffResult.ok) {
      logError('Subdiario diff/apply failed', {
        module: 'subdiario-writer',
        phase: 'diff-apply',
        error: diffResult.error.message,
        correlationId,
      });
      return diffResult;
    }

    info('Subdiario de Ventas sync complete', {
      module: 'subdiario-writer',
      phase: 'sync',
      rowsWritten,
      gapsDetected,
      ...diffResult.value,
      correlationId,
    });

    return {
      ok: true,
      value: {
        rowsWritten,
        gapsDetected,
        inserts: diffResult.value.inserts,
        updates: diffResult.value.updates,
        deletes: diffResult.value.deletes,
        sortInvariantFallback: diffResult.value.sortInvariantFallback,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logError('Subdiario sync failed unexpectedly', {
      module: 'subdiario-writer',
      phase: 'sync',
      error: error.message,
      correlationId,
    });
    return { ok: false, error };
  }
}
