/**
 * Subdiario de Ventas Deliverable Writer.
 *
 * Creates (or replaces) a Google Sheet named "Subdiario de Ventas {YEAR}"
 * inside the caller-provided folderId and writes the formatted deliverable
 * that the accountants receive.
 *
 * Idempotent: if a spreadsheet with the target name already exists in the
 * folder, the existing sheet is deleted and a fresh one created before writing.
 *
 * ADV-382
 */

import type { Result } from '../types/index.js';
import type { CellValueOrLink, RowStyleSpec } from './sheets.js';
import type { DeliverableRenderRow } from './subdiario-deliverable.js';
import {
  getSheetMetadata,
  createSheet,
  deleteSheet,
  renameSheet,
  appendRowsWithLinks,
  formatSheet,
  applyRowStyles,
} from './sheets.js';
import { findByName, createSpreadsheet } from './drive.js';
import { info, debug } from '../utils/logger.js';

// ─── Temp sheet naming ────────────────────────────────────────────────────────

/**
 * Prefix for the throwaway sheet used during in-place replacement. The fresh
 * sheet is created under `${TMP_SHEET_PREFIX}${oldSheetId}` first so the
 * workbook never reaches zero sheets while the old target is deleted. Any sheet
 * carrying this prefix is therefore a leftover from an interrupted prior run and
 * is safe to sweep.
 */
const TMP_SHEET_PREFIX = '__subdiario_tmp_';

// ─── Color palette ────────────────────────────────────────────────────────────

/** Cream/yellow background for rows cancelled by an NC (~#FFF2CC) */
const CREAM_BG = { red: 1, green: 0.949, blue: 0.8 };

/** Red foreground text for NC and FALTA rows (#FF0000) */
const RED_FG = { red: 1, green: 0, blue: 0 };

// ─── Column header names (13 display columns) ─────────────────────────────────

const DELIVERABLE_HEADERS = [
  'fecha', 'cod', 'tipo', 'nro', 'cliente', 'cuit',
  'condicion', 'total', 'concepto', 'categoria', 'fechaCobro',
  'recibido', 'notas',
] as const;

// ─── Column index constants (0-based) ─────────────────────────────────────────

const COL_FECHA        = 0;
const COL_NRO          = 3;
const COL_CLIENTE      = 4; // section label goes here for 'header' render rows
const COL_TOTAL        = 7; // subtotal value goes here for 'subtotal' render rows
const COL_FECHA_COBRO  = 10;
const COL_RECIBIDO     = 11;
const NUM_COLS         = 13;

// ─── Public types ─────────────────────────────────────────────────────────────

/** Result of a successful writeSubdiarioDeliverable call */
export interface WriteDeliverableResult {
  spreadsheetId: string;
  sheetId: number;
  /** Total sheet rows written (data + header + subtotal + blank render rows) */
  rowsWritten: number;
  /**
   * Count of actual comprobante rows (render rows of type 'data'). Excludes the
   * structural header/subtotal/blank rows, so it is the number the accountant
   * sees as invoices — use this for user-facing "N comprobantes" summaries.
   */
  dataRowsWritten: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Create a 13-cell all-blank row (all null) */
function blankCells(): CellValueOrLink[] {
  return new Array<null>(NUM_COLS).fill(null);
}

/** True when a string is a valid YYYY-MM-DD date */
function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Project a single DeliverableRenderRow to 13 CellValueOrLink cells.
 */
function projectRenderRow(renderRow: DeliverableRenderRow): CellValueOrLink[] {
  switch (renderRow.type) {
    case 'blank':
      return blankCells();

    case 'header': {
      const cells = blankCells();
      cells[COL_CLIENTE] = renderRow.label ?? '';
      return cells;
    }

    case 'subtotal': {
      const cells = blankCells();
      cells[COL_TOTAL] = { type: 'number', value: renderRow.subtotal ?? 0 };
      return cells;
    }

    case 'data': {
      const row = renderRow.row!;
      const cells: CellValueOrLink[] = new Array(NUM_COLS).fill(null);

      // A: fecha → CellDate
      cells[COL_FECHA] = { type: 'date', value: row.fecha };

      // B: cod
      cells[1] = row.cod;

      // C: tipo
      cells[2] = row.tipo;

      // D: nro → CellLink when facturaFileId non-empty, else plain string
      if (row.facturaFileId) {
        cells[COL_NRO] = {
          text: row.nro,
          url: `https://drive.google.com/file/d/${row.facturaFileId}/view`,
        };
      } else {
        cells[COL_NRO] = row.nro;
      }

      // E: cliente
      cells[COL_CLIENTE] = row.cliente;

      // F: cuit
      cells[5] = row.cuit;

      // G: condicion
      cells[6] = row.condicion;

      // H: total → CellNumber
      cells[COL_TOTAL] = { type: 'number', value: row.total };

      // I: concepto
      cells[8] = row.concepto;

      // J: categoria
      cells[9] = row.categoria;

      // K: fechaCobro → CellDate when YYYY-MM-DD, plain text otherwise
      if (isIsoDate(row.fechaCobro)) {
        cells[COL_FECHA_COBRO] = { type: 'date', value: row.fechaCobro };
      } else {
        cells[COL_FECHA_COBRO] = row.fechaCobro;
      }

      // L: recibido → CellNumber when not null, else null (blank)
      cells[COL_RECIBIDO] = row.recibido !== null
        ? { type: 'number', value: row.recibido }
        : null;

      // M: notas
      cells[12] = row.notas;

      return cells;
    }
  }
}

/**
 * Build the per-row style specs for applyRowStyles.
 *
 * Sheet row 0 = column header (styled by formatSheet, not here).
 * Sheet row N+1 = renderRows[N].
 */
function buildStyleSpecs(renderRows: DeliverableRenderRow[]): RowStyleSpec[] {
  const specs: RowStyleSpec[] = [];

  for (let i = 0; i < renderRows.length; i++) {
    const sheetRow = i + 1; // +1 because sheet row 0 is the column header
    const startRowIndex = sheetRow;
    const endRowIndex = sheetRow + 1;
    const renderRow = renderRows[i];

    if (renderRow.type === 'header' || renderRow.type === 'subtotal') {
      // Bold
      specs.push({ startRowIndex, endRowIndex, bold: true });
    } else if (renderRow.type === 'data') {
      const { isCancelledByNC, isNC, isFalta } = renderRow;

      if (isCancelledByNC) {
        specs.push({ startRowIndex, endRowIndex, backgroundColor: CREAM_BG });
      }

      if (isNC || isFalta) {
        specs.push({ startRowIndex, endRowIndex, foregroundColor: RED_FG });
      }
    }
    // 'blank' rows get no special styling
  }

  return specs;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Delete every leftover `__subdiario_tmp_*` sheet found in the given metadata
 * snapshot. These only ever exist when a prior replacement run was interrupted
 * mid-swap, so removing them is always safe. The caller is responsible for
 * ordering: in the no-target path the real target must be created first so the
 * workbook never momentarily reaches zero sheets.
 *
 * @param spreadsheetId - Workbook to clean
 * @param sheetMeta     - Metadata snapshot (title/sheetId) read before mutations
 * @returns Ok(void) when all stale temps are gone, or the first delete Error
 */
async function sweepStaleTempSheets(
  spreadsheetId: string,
  sheetMeta: Array<{ title: string; sheetId: number }>,
): Promise<Result<void, Error>> {
  const staleTmps = sheetMeta.filter(s => s.title.startsWith(TMP_SHEET_PREFIX));
  for (const stale of staleTmps) {
    debug('writeSubdiarioDeliverable: deleting stale temp sheet from prior run', {
      module: 'subdiario-deliverable-writer',
      phase: 'idempotency',
      spreadsheetId,
      staleTmpSheetId: stale.sheetId,
    });
    const deleteResult = await deleteSheet(spreadsheetId, stale.sheetId);
    if (!deleteResult.ok) return deleteResult;
  }
  return { ok: true, value: undefined };
}

/**
 * Write the deliverable Subdiario to a new (or replaced) Google Sheet.
 *
 * Idempotency:
 *   - If a spreadsheet named `Subdiario de Ventas {year}` exists in folderId,
 *     find the sheet inside it with the same name; delete it; create a fresh
 *     sheet with the same name; write to that.
 *   - If no spreadsheet exists, create one; rename its default sheet; write.
 *
 * @param folderId   - Drive folder where the spreadsheet lives (or will be created)
 * @param year       - Fiscal year (e.g. 2026)
 * @param renderRows - Output of buildSubdiarioDeliverable()
 * @returns WriteDeliverableResult or Error
 */
export async function writeSubdiarioDeliverable(
  folderId: string,
  year: number,
  renderRows: DeliverableRenderRow[],
): Promise<Result<WriteDeliverableResult, Error>> {
  const spreadsheetName = `Subdiario de Ventas ${year}`;
  const sheetName = `Subdiario de Ventas ${year}`;

  info('writeSubdiarioDeliverable: start', {
    module: 'subdiario-deliverable-writer',
    phase: 'start',
    year,
    renderRowCount: renderRows.length,
  });

  // ── Step 1: Resolve spreadsheet (create or find existing) ─────────────────

  let spreadsheetId: string;
  let targetSheetId: number;

  const findResult = await findByName(folderId, spreadsheetName);
  if (!findResult.ok) return findResult;

  const existingFile = findResult.value;

  if (existingFile) {
    // Existing spreadsheet: delete the old sheet and create a fresh one
    spreadsheetId = existingFile.id;

    debug('writeSubdiarioDeliverable: existing spreadsheet found', {
      module: 'subdiario-deliverable-writer',
      phase: 'idempotency',
      spreadsheetId,
    });

    const metaResult = await getSheetMetadata(spreadsheetId);
    if (!metaResult.ok) return metaResult;

    const existingSheet = metaResult.value.find(s => s.title === sheetName);
    if (existingSheet) {
      // The target sheet already exists. Deleting it directly fails when it is
      // the workbook's ONLY sheet ("must have at least one visible sheet") —
      // the common case, since a spreadsheet created by this writer has exactly
      // one sheet. Create the fresh sheet FIRST (under a temp name keyed on the
      // old sheetId so it cannot collide with the target name), THEN delete the
      // old sheet, THEN rename the fresh one. The workbook never reaches zero
      // sheets, so the delete is always legal.
      const tmpName = `${TMP_SHEET_PREFIX}${existingSheet.sheetId}`;

      // Retry-safety: a prior run that created the temp sheet but died before
      // the delete/rename leaves a stale `__subdiario_tmp_*` sheet behind.
      // createSheet would then fail with a duplicate-title error, permanently
      // stalling the otherwise-idempotent retry. Sweep ALL stale temp sheets
      // first (not just the deterministic `tmpName`, since an orphan from an
      // earlier old sheetId can also linger) — the target sheet still exists
      // here, so the workbook never hits zero sheets and the deletes are legal.
      const cleanupResult = await sweepStaleTempSheets(spreadsheetId, metaResult.value);
      if (!cleanupResult.ok) return cleanupResult;

      const createResult = await createSheet(spreadsheetId, tmpName);
      if (!createResult.ok) return createResult;
      targetSheetId = createResult.value;

      const deleteResult = await deleteSheet(spreadsheetId, existingSheet.sheetId);
      if (!deleteResult.ok) return deleteResult;

      const renameResult = await renameSheet(spreadsheetId, targetSheetId, sheetName);
      if (!renameResult.ok) return renameResult;
    } else {
      // No same-named sheet — other sheets keep the workbook non-empty, so a
      // direct create is safe. Create the target FIRST so the workbook never
      // hits zero sheets, THEN sweep any orphan `__subdiario_tmp_*` left by a
      // prior run that deleted the old target but died before renaming its temp.
      // The orphan's name is keyed on the now-gone old sheetId, so the same-name
      // path above can never reach it; without this sweep it would stay visible
      // in the accountant-facing workbook forever.
      const createResult = await createSheet(spreadsheetId, sheetName);
      if (!createResult.ok) return createResult;
      targetSheetId = createResult.value;

      const cleanupResult = await sweepStaleTempSheets(spreadsheetId, metaResult.value);
      if (!cleanupResult.ok) return cleanupResult;
    }

  } else {
    // No existing spreadsheet: create one
    const createSsResult = await createSpreadsheet(folderId, spreadsheetName);
    if (!createSsResult.ok) return createSsResult;
    spreadsheetId = createSsResult.value.id;

    // Get metadata to find the default sheet (Sheet1)
    const metaResult = await getSheetMetadata(spreadsheetId);
    if (!metaResult.ok) return metaResult;

    const defaultSheet = metaResult.value[0];
    if (!defaultSheet) {
      return { ok: false, error: new Error('New spreadsheet has no default sheet') };
    }
    targetSheetId = defaultSheet.sheetId;

    // Rename default sheet to target name
    const renameResult = await renameSheet(spreadsheetId, targetSheetId, sheetName);
    if (!renameResult.ok) return renameResult;
  }

  // ── Step 2: Build and write all rows ──────────────────────────────────────

  // Row 0: column headers
  const columnHeaderRow: CellValueOrLink[] = [...DELIVERABLE_HEADERS];

  // Rows 1+: projected render rows
  const dataRows = renderRows.map(projectRenderRow);

  const allRows: CellValueOrLink[][] = [columnHeaderRow, ...dataRows];

  const range = `${sheetName}!A:M`;
  const appendResult = await appendRowsWithLinks(spreadsheetId, range, allRows);
  if (!appendResult.ok) return appendResult;

  // ── Step 3: Apply column-header formatting (freeze + bold) ────────────────

  const formatResult = await formatSheet(spreadsheetId, targetSheetId, { frozenRows: 1 });
  if (!formatResult.ok) return formatResult;

  // ── Step 4: Apply per-row styles ──────────────────────────────────────────

  const styleSpecs = buildStyleSpecs(renderRows);
  if (styleSpecs.length > 0) {
    const stylesResult = await applyRowStyles(spreadsheetId, targetSheetId, styleSpecs);
    if (!stylesResult.ok) return stylesResult;
  }

  const dataRowsWritten = renderRows.filter(r => r.type === 'data').length;

  info('writeSubdiarioDeliverable: complete', {
    module: 'subdiario-deliverable-writer',
    phase: 'complete',
    spreadsheetId,
    targetSheetId,
    rowsWritten: renderRows.length,
    dataRowsWritten,
  });

  return {
    ok: true,
    value: {
      spreadsheetId,
      sheetId: targetSheetId,
      rowsWritten: renderRows.length,
      dataRowsWritten,
    },
  };
}
