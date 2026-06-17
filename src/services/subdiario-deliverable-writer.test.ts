/**
 * Tests for writeSubdiarioDeliverable — formatted Google Sheets writer.
 *
 * ADV-382
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CellNumber, CellValueOrLink } from './sheets.js';
import type { DeliverableRenderRow } from './subdiario-deliverable.js';
import type { SubdiarioRow } from '../types/index.js';

// ─── Mocks (declared BEFORE imports of the module under test) ─────────────────

vi.mock('./drive.js', () => ({
  findByName: vi.fn(),
  createSpreadsheet: vi.fn(),
}));

vi.mock('./sheets.js', () => ({
  createSheet: vi.fn(),
  deleteSheet: vi.fn(),
  renameSheet: vi.fn(),
  getSheetMetadata: vi.fn(),
  appendRowsWithLinks: vi.fn(),
  formatSheet: vi.fn(),
  applyRowStyles: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// ─── Imports AFTER mocks ──────────────────────────────────────────────────────

import { writeSubdiarioDeliverable } from './subdiario-deliverable-writer.js';
import * as drive from './drive.js';
import * as sheets from './sheets.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const FOLDER_ID = 'folder-abc';
const YEAR = 2026;
const SPREADSHEET_NAME = `Subdiario de Ventas ${YEAR}`;
const SHEET_NAME = `Subdiario de Ventas ${YEAR}`;
const NEW_SPREADSHEET_ID = 'new-ss-id';
const DEFAULT_SHEET_ID = 42;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSubdiarioRow(overrides: Partial<SubdiarioRow> = {}): SubdiarioRow {
  return {
    fecha: '2026-01-15',
    cod: '006',
    tipo: 'FC',
    nro: '00001-00000001',
    cliente: 'TEST SA',
    cuit: '20123456786',
    condicion: 'IVA Responsable Inscripto',
    total: 1000,
    concepto: 'Servicios',
    categoria: 'Micro',
    fechaCobro: '',
    recibido: null,
    movimiento: '',
    movimientoLabel: '',
    facturaFileId: 'file-abc',
    notas: '',
    ...overrides,
  };
}

function makeDataRow(row: SubdiarioRow, flags?: {
  isNC?: boolean;
  isFalta?: boolean;
  isCancelledByNC?: boolean;
}): DeliverableRenderRow {
  return {
    type: 'data',
    row,
    isNC: flags?.isNC ?? false,
    isFalta: flags?.isFalta ?? false,
    isCancelledByNC: flags?.isCancelledByNC ?? false,
  };
}

function setupDefaultMocks() {
  vi.mocked(drive.findByName).mockResolvedValue({ ok: true, value: null });
  vi.mocked(drive.createSpreadsheet).mockResolvedValue({
    ok: true,
    value: { id: NEW_SPREADSHEET_ID, name: SPREADSHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet' },
  });
  vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
    ok: true,
    value: [{ title: 'Sheet1', sheetId: DEFAULT_SHEET_ID, index: 0 }],
  });
  vi.mocked(sheets.renameSheet).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(sheets.appendRowsWithLinks).mockResolvedValue({ ok: true, value: 13 });
  vi.mocked(sheets.formatSheet).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(sheets.applyRowStyles).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(sheets.createSheet).mockResolvedValue({ ok: true, value: 99 });
  vi.mocked(sheets.deleteSheet).mockResolvedValue({ ok: true, value: undefined });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('writeSubdiarioDeliverable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── Creation + idempotency ────────────────────────────────────────────────

  it('creates a new spreadsheet when none exists', async () => {
    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    expect(result.ok).toBe(true);
    expect(drive.createSpreadsheet).toHaveBeenCalledWith(FOLDER_ID, SPREADSHEET_NAME);
  });

  it('returns the spreadsheetId and sheetId in the result', async () => {
    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.spreadsheetId).toBe(NEW_SPREADSHEET_ID);
      expect(result.value.sheetId).toBe(DEFAULT_SHEET_ID);
    }
  });

  it('renames the default sheet to the spreadsheet name', async () => {
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    expect(sheets.renameSheet).toHaveBeenCalledWith(NEW_SPREADSHEET_ID, DEFAULT_SHEET_ID, SHEET_NAME);
  });

  it('when existing spreadsheet found: replaces the sheet via temp-create → delete → rename', async () => {
    const EXISTING_SS_ID = 'existing-ss-id';
    const EXISTING_SHEET_ID = 77;

    vi.mocked(drive.findByName).mockResolvedValue({
      ok: true,
      value: { id: EXISTING_SS_ID, name: SPREADSHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet' },
    });
    vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: SHEET_NAME, sheetId: EXISTING_SHEET_ID, index: 0 },
        { title: 'OtherSheet', sheetId: 88, index: 1 },
      ],
    });
    vi.mocked(sheets.createSheet).mockResolvedValue({ ok: true, value: 99 });

    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    expect(drive.createSpreadsheet).not.toHaveBeenCalled();
    // Fresh sheet created FIRST under a temp name (so the workbook never hits 0 sheets)
    expect(sheets.createSheet).toHaveBeenCalledWith(EXISTING_SS_ID, `__subdiario_tmp_${EXISTING_SHEET_ID}`);
    expect(sheets.deleteSheet).toHaveBeenCalledWith(EXISTING_SS_ID, EXISTING_SHEET_ID);
    expect(sheets.renameSheet).toHaveBeenCalledWith(EXISTING_SS_ID, 99, SHEET_NAME);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.spreadsheetId).toBe(EXISTING_SS_ID);
      expect(result.value.sheetId).toBe(99);
    }
  });

  it('when existing spreadsheet has the target as its ONLY sheet: still replaces without error (regression)', async () => {
    // Production reality: a spreadsheet created by this writer has exactly one
    // sheet. Deleting it directly would fail ("must have at least one visible
    // sheet"); the temp-create-first flow must avoid that.
    const EXISTING_SS_ID = 'existing-ss-id';
    const EXISTING_SHEET_ID = 77;

    vi.mocked(drive.findByName).mockResolvedValue({
      ok: true,
      value: { id: EXISTING_SS_ID, name: SPREADSHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet' },
    });
    vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: SHEET_NAME, sheetId: EXISTING_SHEET_ID, index: 0 }],
    });
    vi.mocked(sheets.createSheet).mockResolvedValue({ ok: true, value: 99 });

    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    // Order matters: create the temp sheet BEFORE deleting the only existing sheet.
    const createOrder = vi.mocked(sheets.createSheet).mock.invocationCallOrder[0];
    const deleteOrder = vi.mocked(sheets.deleteSheet).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(deleteOrder);
    expect(sheets.createSheet).toHaveBeenCalledWith(EXISTING_SS_ID, `__subdiario_tmp_${EXISTING_SHEET_ID}`);
    expect(sheets.deleteSheet).toHaveBeenCalledWith(EXISTING_SS_ID, EXISTING_SHEET_ID);
    expect(sheets.renameSheet).toHaveBeenCalledWith(EXISTING_SS_ID, 99, SHEET_NAME);
    expect(result.ok).toBe(true);
  });

  it('when a stale temp sheet from a prior interrupted run exists: deletes it before recreating (retry-safe)', async () => {
    // A prior run created the temp sheet but died before delete/rename, leaving
    // `__subdiario_tmp_${oldSheetId}` behind alongside the still-present target.
    // The temp name is deterministic, so a naive createSheet would fail with a
    // duplicate-title error and permanently stall the retry. The writer must
    // delete the stale temp first.
    const EXISTING_SS_ID = 'existing-ss-id';
    const EXISTING_SHEET_ID = 77;
    const STALE_TMP_SHEET_ID = 55;

    vi.mocked(drive.findByName).mockResolvedValue({
      ok: true,
      value: { id: EXISTING_SS_ID, name: SPREADSHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet' },
    });
    vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [
        { title: SHEET_NAME, sheetId: EXISTING_SHEET_ID, index: 0 },
        { title: `__subdiario_tmp_${EXISTING_SHEET_ID}`, sheetId: STALE_TMP_SHEET_ID, index: 1 },
      ],
    });
    vi.mocked(sheets.createSheet).mockResolvedValue({ ok: true, value: 99 });

    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    // Stale temp deleted BEFORE the fresh temp is created, so createSheet cannot collide.
    const staleDeleteOrder = vi.mocked(sheets.deleteSheet).mock.invocationCallOrder[0];
    const createOrder = vi.mocked(sheets.createSheet).mock.invocationCallOrder[0];
    expect(staleDeleteOrder).toBeLessThan(createOrder);
    expect(sheets.deleteSheet).toHaveBeenNthCalledWith(1, EXISTING_SS_ID, STALE_TMP_SHEET_ID);
    expect(sheets.createSheet).toHaveBeenCalledWith(EXISTING_SS_ID, `__subdiario_tmp_${EXISTING_SHEET_ID}`);
    // Old target still deleted, fresh sheet still renamed.
    expect(sheets.deleteSheet).toHaveBeenNthCalledWith(2, EXISTING_SS_ID, EXISTING_SHEET_ID);
    expect(sheets.renameSheet).toHaveBeenCalledWith(EXISTING_SS_ID, 99, SHEET_NAME);
    expect(result.ok).toBe(true);
  });

  it('when existing spreadsheet found but has no matching sheet: creates the target sheet directly (no temp/delete)', async () => {
    const EXISTING_SS_ID = 'existing-ss-id';

    vi.mocked(drive.findByName).mockResolvedValue({
      ok: true,
      value: { id: EXISTING_SS_ID, name: SPREADSHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet' },
    });
    // The workbook exists but does NOT contain a sheet named SHEET_NAME — other
    // sheets keep it non-empty, so the writer creates the target sheet directly.
    vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: 'OtherSheet', sheetId: 88, index: 0 }],
    });
    vi.mocked(sheets.createSheet).mockResolvedValue({ ok: true, value: 99 });

    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    expect(drive.createSpreadsheet).not.toHaveBeenCalled();
    // Direct create under the target name — no temp name, no delete, no rename.
    expect(sheets.createSheet).toHaveBeenCalledWith(EXISTING_SS_ID, SHEET_NAME);
    expect(sheets.deleteSheet).not.toHaveBeenCalled();
    expect(sheets.renameSheet).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.spreadsheetId).toBe(EXISTING_SS_ID);
      expect(result.value.sheetId).toBe(99);
    }
  });

  it('when target sheet is missing but an orphan temp sheet remains (interrupted rename): creates the target, THEN sweeps the orphan', async () => {
    // A prior replacement deleted the old target but died before renameSheet,
    // leaving `__subdiario_tmp_<oldId>` behind with no sheet named SHEET_NAME.
    // The retry lands in the direct-create path. The orphan's name is keyed on
    // the now-gone old sheetId, so the same-name cleanup never reaches it — it
    // would stay visible in the accountant-facing workbook forever. The writer
    // must sweep it. Orphan-only workbook: the target MUST be created before the
    // orphan is deleted, or the workbook would momentarily hit zero sheets.
    const EXISTING_SS_ID = 'existing-ss-id';
    const ORPHAN_TMP_SHEET_ID = 55;

    vi.mocked(drive.findByName).mockResolvedValue({
      ok: true,
      value: { id: EXISTING_SS_ID, name: SPREADSHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet' },
    });
    vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
      ok: true,
      value: [{ title: '__subdiario_tmp_77', sheetId: ORPHAN_TMP_SHEET_ID, index: 0 }],
    });
    vi.mocked(sheets.createSheet).mockResolvedValue({ ok: true, value: 99 });

    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    // Direct create of the target, no temp name, no rename.
    expect(sheets.createSheet).toHaveBeenCalledWith(EXISTING_SS_ID, SHEET_NAME);
    expect(sheets.renameSheet).not.toHaveBeenCalled();
    // Orphan swept — but only AFTER the target was created (never zero sheets).
    const createOrder = vi.mocked(sheets.createSheet).mock.invocationCallOrder[0];
    const deleteOrder = vi.mocked(sheets.deleteSheet).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(deleteOrder);
    expect(sheets.deleteSheet).toHaveBeenCalledWith(EXISTING_SS_ID, ORPHAN_TMP_SHEET_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sheetId).toBe(99);
    }
  });

  it('writes the 13-column header row as the first row', async () => {
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    expect(sheets.appendRowsWithLinks).toHaveBeenCalled();
    const calls = vi.mocked(sheets.appendRowsWithLinks).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // The first call should include the header row as row[0]
    const firstCallRows = calls[0][2] as CellValueOrLink[][];
    expect(firstCallRows[0]).toEqual([
      'fecha', 'cod', 'tipo', 'nro', 'cliente', 'cuit',
      'condicion', 'total', 'concepto', 'categoria', 'fechaCobro',
      'recibido', 'notas',
    ]);
  });

  it('reports rowsWritten equal to the number of render rows', async () => {
    const rows: DeliverableRenderRow[] = [
      { type: 'header', label: 'PERIODO ENERO 2026' },
      makeDataRow(makeSubdiarioRow()),
      { type: 'subtotal', subtotal: 1000 },
      { type: 'blank' },
    ];
    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, rows);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rowsWritten).toBe(4);
    }
  });

  it('reports dataRowsWritten as the count of data render rows only (excludes header/subtotal/blank)', async () => {
    const rows: DeliverableRenderRow[] = [
      { type: 'header', label: 'PERIODO ENERO 2026' },
      makeDataRow(makeSubdiarioRow()),
      makeDataRow(makeSubdiarioRow()),
      { type: 'subtotal', subtotal: 2000 },
      { type: 'blank' },
    ];
    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, rows);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rowsWritten).toBe(5);
      expect(result.value.dataRowsWritten).toBe(2);
    }
  });

  // ── Cell projection — 'header' render row ────────────────────────────────

  it('projects a header render row: label in col 4 (cliente), rest blank', async () => {
    const renderRows: DeliverableRenderRow[] = [
      { type: 'header', label: 'PERIODO MAYO 2026' },
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    const calls = vi.mocked(sheets.appendRowsWithLinks).mock.calls;
    const allRows = calls[0][2] as CellValueOrLink[][];
    // Row 0 = column header; Row 1 = the header render row
    const headerRenderRow = allRows[1];
    expect(headerRenderRow).toHaveLength(13);
    // Col 4 (E) = cliente position = section label
    expect(headerRenderRow[4]).toBe('PERIODO MAYO 2026');
    // All other cols should be null/empty
    for (let i = 0; i < 13; i++) {
      if (i !== 4) {
        expect(headerRenderRow[i] === null || headerRenderRow[i] === '' || headerRenderRow[i] === undefined).toBe(true);
      }
    }
  });

  // ── Cell projection — 'subtotal' render row ───────────────────────────────

  it('projects a subtotal render row: CellNumber in col 7 (total), rest blank', async () => {
    const renderRows: DeliverableRenderRow[] = [
      { type: 'subtotal', subtotal: 12345.67 },
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    const calls = vi.mocked(sheets.appendRowsWithLinks).mock.calls;
    const allRows = calls[0][2] as CellValueOrLink[][];
    const subtotalRow = allRows[1];
    expect(subtotalRow).toHaveLength(13);
    // Col 7 = total position = CellNumber
    const totalCell = subtotalRow[7] as CellNumber;
    expect(totalCell).toMatchObject({ type: 'number', value: 12345.67 });
    // Other cols blank
    for (let i = 0; i < 13; i++) {
      if (i !== 7) {
        expect(subtotalRow[i] === null || subtotalRow[i] === '' || subtotalRow[i] === undefined).toBe(true);
      }
    }
  });

  // ── Cell projection — 'blank' render row ─────────────────────────────────

  it('projects a blank render row as an empty array or all-null/empty row', async () => {
    const renderRows: DeliverableRenderRow[] = [
      { type: 'blank' },
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    const calls = vi.mocked(sheets.appendRowsWithLinks).mock.calls;
    const allRows = calls[0][2] as CellValueOrLink[][];
    const blankRow = allRows[1];
    // Either length 0, or all cells null/empty
    const isBlank = blankRow.length === 0 ||
      blankRow.every(c => c === null || c === '' || c === undefined);
    expect(isBlank).toBe(true);
  });

  // ── Cell projection — 'data' render row ──────────────────────────────────

  it('projects a data render row with all 13 columns', async () => {
    const row = makeSubdiarioRow({
      fecha: '2026-05-10',
      cod: '001',
      tipo: 'FC',
      nro: '00003-00001234',
      cliente: 'EMPRESA UNO SA',
      cuit: '27234567891',
      condicion: 'IVA Responsable Inscripto',
      total: 9999.50,
      concepto: 'Cuota mensual',
      categoria: 'Empresa',
      fechaCobro: '2026-06-01',
      recibido: 9999.50,
      facturaFileId: 'file-xyz',
      notas: 'Socio 1001',
    });
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, [makeDataRow(row)]);

    const calls = vi.mocked(sheets.appendRowsWithLinks).mock.calls;
    const allRows = calls[0][2] as CellValueOrLink[][];
    const dataRow = allRows[1];
    expect(dataRow).toHaveLength(13);

    // fecha (0): CellDate
    expect(dataRow[0]).toMatchObject({ type: 'date', value: '2026-05-10' });
    // cod (1): string
    expect(dataRow[1]).toBe('001');
    // tipo (2): string
    expect(dataRow[2]).toBe('FC');
    // nro (3): CellLink when facturaFileId set
    expect(dataRow[3]).toMatchObject({
      text: '00003-00001234',
      url: 'https://drive.google.com/file/d/file-xyz/view',
    });
    // cliente (4): string
    expect(dataRow[4]).toBe('EMPRESA UNO SA');
    // cuit (5): string
    expect(dataRow[5]).toBe('27234567891');
    // condicion (6): string
    expect(dataRow[6]).toBe('IVA Responsable Inscripto');
    // total (7): CellNumber
    expect(dataRow[7]).toMatchObject({ type: 'number', value: 9999.50 });
    // concepto (8): string
    expect(dataRow[8]).toBe('Cuota mensual');
    // categoria (9): string
    expect(dataRow[9]).toBe('Empresa');
    // fechaCobro (10): CellDate when YYYY-MM-DD
    expect(dataRow[10]).toMatchObject({ type: 'date', value: '2026-06-01' });
    // recibido (11): CellNumber when not null
    expect(dataRow[11]).toMatchObject({ type: 'number', value: 9999.50 });
    // notas (12): string
    expect(dataRow[12]).toBe('Socio 1001');
  });

  it('renders nro as plain text when facturaFileId is empty (FALTA rows)', async () => {
    const row = makeSubdiarioRow({
      nro: '00001-00000002',
      cliente: 'FALTA 00001-00000002',
      facturaFileId: '',
    });
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, [makeDataRow(row, { isFalta: true })]);

    const calls = vi.mocked(sheets.appendRowsWithLinks).mock.calls;
    const allRows = calls[0][2] as CellValueOrLink[][];
    const dataRow = allRows[1];
    // nro (3) should be plain string, not a CellLink
    expect(typeof dataRow[3]).toBe('string');
    expect(dataRow[3]).toBe('00001-00000002');
  });

  it('renders fechaCobro as plain text when it is NC-prefixed or empty', async () => {
    const rowNC = makeSubdiarioRow({
      nro: '00001-00000001',
      fechaCobro: 'NC 00001-00000002',
    });
    const rowEmpty = makeSubdiarioRow({
      nro: '00001-00000003',
      fechaCobro: '',
    });

    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, [makeDataRow(rowNC), makeDataRow(rowEmpty)]);

    const calls = vi.mocked(sheets.appendRowsWithLinks).mock.calls;
    const allRows = calls[0][2] as CellValueOrLink[][];
    // Row[1] = rowNC, Row[2] = rowEmpty
    expect(typeof allRows[1][10]).toBe('string');
    expect(allRows[1][10]).toBe('NC 00001-00000002');
    expect(typeof allRows[2][10]).toBe('string');
    expect(allRows[2][10]).toBe('');
  });

  it('renders recibido as null/empty when row.recibido is null', async () => {
    const row = makeSubdiarioRow({ recibido: null });
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, [makeDataRow(row)]);

    const calls = vi.mocked(sheets.appendRowsWithLinks).mock.calls;
    const allRows = calls[0][2] as CellValueOrLink[][];
    const recibidoCell = allRows[1][11];
    expect(recibidoCell === null || recibidoCell === undefined || recibidoCell === '').toBe(true);
  });

  // ── Formatting ────────────────────────────────────────────────────────────

  it('calls formatSheet to freeze row 1 and bold the header', async () => {
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);

    expect(sheets.formatSheet).toHaveBeenCalledWith(
      NEW_SPREADSHEET_ID,
      DEFAULT_SHEET_ID,
      expect.objectContaining({ frozenRows: 1 })
    );
  });

  it('applies bold style to section header render rows', async () => {
    const renderRows: DeliverableRenderRow[] = [
      { type: 'header', label: 'PERIODO ENERO 2026' },
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    expect(sheets.applyRowStyles).toHaveBeenCalled();
    const styleSpecs = vi.mocked(sheets.applyRowStyles).mock.calls[0][2];
    // The section header is at sheet row 1 (0-based, row 0 = col header)
    const boldSpec = styleSpecs.find(s => s.bold === true && s.startRowIndex === 1 && s.endRowIndex === 2);
    expect(boldSpec).toBeDefined();
  });

  it('applies bold style to subtotal render rows', async () => {
    const renderRows: DeliverableRenderRow[] = [
      { type: 'subtotal', subtotal: 500 },
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    expect(sheets.applyRowStyles).toHaveBeenCalled();
    const styleSpecs = vi.mocked(sheets.applyRowStyles).mock.calls[0][2];
    const boldSpec = styleSpecs.find(s => s.bold === true && s.startRowIndex === 1 && s.endRowIndex === 2);
    expect(boldSpec).toBeDefined();
  });

  it('applies CREAM background to isCancelledByNC data rows', async () => {
    const row = makeSubdiarioRow({ fechaCobro: 'NC 00001-00000002' });
    const renderRows: DeliverableRenderRow[] = [
      makeDataRow(row, { isCancelledByNC: true }),
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    const styleSpecs = vi.mocked(sheets.applyRowStyles).mock.calls[0][2];
    const creamSpec = styleSpecs.find(s =>
      s.startRowIndex === 1 &&
      s.backgroundColor !== undefined &&
      s.backgroundColor.red === 1 &&
      s.backgroundColor.green > 0.9 &&
      s.backgroundColor.blue < 0.9
    );
    expect(creamSpec).toBeDefined();
  });

  it('applies RED text to isNC data rows', async () => {
    const row = makeSubdiarioRow({ tipo: 'NC', total: -500 });
    const renderRows: DeliverableRenderRow[] = [
      makeDataRow(row, { isNC: true }),
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    const styleSpecs = vi.mocked(sheets.applyRowStyles).mock.calls[0][2];
    const redSpec = styleSpecs.find(s =>
      s.startRowIndex === 1 &&
      s.foregroundColor !== undefined &&
      s.foregroundColor.red === 1 &&
      s.foregroundColor.green === 0 &&
      s.foregroundColor.blue === 0
    );
    expect(redSpec).toBeDefined();
  });

  it('applies RED text to isFalta data rows', async () => {
    const row = makeSubdiarioRow({ cliente: 'FALTA 00001-00000002', facturaFileId: '' });
    const renderRows: DeliverableRenderRow[] = [
      makeDataRow(row, { isFalta: true }),
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    const styleSpecs = vi.mocked(sheets.applyRowStyles).mock.calls[0][2];
    const redSpec = styleSpecs.find(s =>
      s.startRowIndex === 1 &&
      s.foregroundColor !== undefined &&
      s.foregroundColor.red === 1
    );
    expect(redSpec).toBeDefined();
  });

  it('does not apply special styles to normal FC data rows', async () => {
    const row = makeSubdiarioRow();
    const renderRows: DeliverableRenderRow[] = [
      makeDataRow(row, { isNC: false, isFalta: false, isCancelledByNC: false }),
    ];
    await writeSubdiarioDeliverable(FOLDER_ID, YEAR, renderRows);

    // applyRowStyles should NOT be called when there are no style specs
    // (normal FC rows generate no styles)
    const calls = vi.mocked(sheets.applyRowStyles).mock.calls;
    const styleSpecs = calls.length > 0 ? calls[0][2] : [];
    // Row 1 is the normal FC data row — no bold, no cream, no red
    const stylesForRow1 = styleSpecs.filter(s => s.startRowIndex === 1 && s.endRowIndex === 2);
    const hasBold = stylesForRow1.some(s => s.bold === true);
    const hasCream = stylesForRow1.some(s => s.backgroundColor !== undefined);
    const hasRed = stylesForRow1.some(s => s.foregroundColor !== undefined);
    expect(hasBold).toBe(false);
    expect(hasCream).toBe(false);
    expect(hasRed).toBe(false);
  });

  // ── Error propagation ─────────────────────────────────────────────────────

  it('returns error when findByName fails', async () => {
    vi.mocked(drive.findByName).mockResolvedValue({
      ok: false,
      error: new Error('Drive error'),
    });

    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);
    expect(result.ok).toBe(false);
  });

  it('returns error when createSpreadsheet fails', async () => {
    vi.mocked(drive.createSpreadsheet).mockResolvedValue({
      ok: false,
      error: new Error('Create failed'),
    });

    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);
    expect(result.ok).toBe(false);
  });

  it('returns error when appendRowsWithLinks fails', async () => {
    vi.mocked(sheets.appendRowsWithLinks).mockResolvedValue({
      ok: false,
      error: new Error('Append failed'),
    });

    const result = await writeSubdiarioDeliverable(FOLDER_ID, YEAR, []);
    expect(result.ok).toBe(false);
  });
});
