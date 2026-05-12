/**
 * Tests for Subdiario de Ventas writer service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncSubdiario } from './subdiario-writer.js';
import * as drive from './drive.js';
import * as sheets from './sheets.js';
import type { CellValue } from './sheets.js';
import type { SubdiarioRow } from '../types/index.js';
import * as folderStructure from './folder-structure.js';

// ─── Mock drive ───────────────────────────────────────────────────────────────

vi.mock('./drive.js', () => ({
  findByName: vi.fn(),
  createSpreadsheet: vi.fn(),
}));

// ─── Mock sheets ──────────────────────────────────────────────────────────────

vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  setValues: vi.fn(),
  appendRowsWithLinks: vi.fn(),
  clearSheetData: vi.fn(),
  getSpreadsheetTimezone: vi.fn(),
  getSheetMetadata: vi.fn(),
  renameSheet: vi.fn(),
  formatSheet: vi.fn(),
}));

// ─── Mock folder-structure ────────────────────────────────────────────────────

vi.mock('./folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(),
}));

// ─── Mock cross-worker deps (may not exist yet at merge time) ─────────────────

vi.mock('./facturador-reader.js', () => ({
  readFacturador: vi.fn(),
}));

vi.mock('./subdiario-builder.js', () => ({
  buildSubdiarioRows: vi.fn(),
}));

// ─── Mock logger + correlation ────────────────────────────────────────────────

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../utils/correlation.js', () => ({
  getCorrelationId: vi.fn(() => 'test-correlation-id'),
}));

// ─── Imports AFTER mocks ──────────────────────────────────────────────────────

import * as facturadorReader from './facturador-reader.js';
import * as subdiarioBuilder from './subdiario-builder.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROOT_ID = 'root-folder-id';
const CONTROL_INGRESOS_ID = 'control-ingresos-id';
const CONTROL_EGRESOS_ID = 'control-egresos-id';
const SUBDIARIO_ID = 'subdiario-id';
const NEW_SUBDIARIO_ID = 'new-subdiario-id';
const CURRENT_YEAR = 2025;
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

const EMPTY_SHEET_DATA: CellValue[][] = [
  ['fechaEmision', 'fileId', 'fileName'], // header
];

const MOCK_ROWS: SubdiarioRow[] = [
  {
    fecha: '2025-01-15',
    cod: '006',
    tipo: 'FC',
    nro: '00001-00000001',
    cliente: 'TEST SA',
    cuit: '20123456786',
    condicion: 'IVA Responsable Inscripto',
    total: 1000,
    concepto: 'Servicios',
    categoria: 'Ingresos',
    fechaCobro: '',
    recibido: 0,
    notas: '',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupDefaultMocks() {
  vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: EMPTY_SHEET_DATA });
  vi.mocked(sheets.setValues).mockResolvedValue({ ok: true, value: 1 });
  vi.mocked(sheets.appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
  vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({
    ok: true,
    value: 'America/Argentina/Buenos_Aires',
  });
  vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
    ok: true,
    value: [{ title: 'Sheet1', sheetId: 0, index: 0 }],
  });
  vi.mocked(sheets.renameSheet).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(sheets.formatSheet).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(facturadorReader.readFacturador).mockResolvedValue({
    ok: true,
    value: new Map(),
  });
  vi.mocked(subdiarioBuilder.buildSubdiarioRows).mockReturnValue(MOCK_ROWS);
}

function makeCachedStructure(overrides: Record<string, unknown> = {}) {
  return {
    rootId: ROOT_ID,
    controlIngresosId: CONTROL_INGRESOS_ID,
    controlEgresosId: CONTROL_EGRESOS_ID,
    dashboardOperativoId: 'dashboard-id',
    entradaId: 'entrada-id',
    sinProcesarId: 'sin-procesar-id',
    duplicadoId: 'duplicado-id',
    bankSpreadsheets: new Map<string, string>(),
    movimientosSpreadsheets: new Map<string, string>(),
    yearFolders: new Map<string, string>(),
    classificationFolders: new Map<string, string>(),
    monthFolders: new Map<string, string>(),
    bankAccountFolders: new Map<string, string>(),
    bankAccountSpreadsheets: new Map<string, string>(),
    lastRefreshed: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('syncSubdiario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('First run — workbook missing', () => {
    it('creates workbook, renames Sheet1, freezes header, writes header and data', async () => {
      // Cache without subdiarioId
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure() // no subdiarioId
      );
      // Drive: workbook not found
      vi.mocked(drive.findByName).mockResolvedValue({ ok: true, value: null });
      // Drive: create spreadsheet succeeds
      vi.mocked(drive.createSpreadsheet).mockResolvedValue({
        ok: true,
        value: { id: NEW_SUBDIARIO_ID, name: 'Subdiario de Ventas', mimeType: SPREADSHEET_MIME },
      });

      const movimientosSpreadsheets = new Map<string, string>();

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        movimientosSpreadsheets
      );

      expect(result.ok).toBe(true);

      // Searched Drive for workbook
      expect(drive.findByName).toHaveBeenCalledWith(
        ROOT_ID,
        'Subdiario de Ventas',
        SPREADSHEET_MIME
      );
      // Created workbook
      expect(drive.createSpreadsheet).toHaveBeenCalledWith(ROOT_ID, 'Subdiario de Ventas');
      // Got Sheet1 metadata for rename
      expect(sheets.getSheetMetadata).toHaveBeenCalledWith(NEW_SUBDIARIO_ID);
      // Renamed Sheet1 → Comprobantes
      expect(sheets.renameSheet).toHaveBeenCalledWith(NEW_SUBDIARIO_ID, 0, 'Comprobantes');
      // Froze row 1
      expect(sheets.formatSheet).toHaveBeenCalled();
      // Wrote header row
      expect(sheets.setValues).toHaveBeenCalled();
      // Did NOT clear data (first run — brand new sheet)
      expect(sheets.clearSheetData).not.toHaveBeenCalled();
      // Wrote data rows
      expect(sheets.appendRowsWithLinks).toHaveBeenCalled();
    });

    it('stores subdiarioId in cached structure', async () => {
      const cached = makeCachedStructure();
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(cached);
      vi.mocked(drive.findByName).mockResolvedValue({ ok: true, value: null });
      vi.mocked(drive.createSpreadsheet).mockResolvedValue({
        ok: true,
        value: { id: NEW_SUBDIARIO_ID, name: 'Subdiario de Ventas', mimeType: SPREADSHEET_MIME },
      });

      await syncSubdiario(ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map());

      // Cache must be updated with the new ID
      expect((cached as Record<string, unknown>)['subdiarioId']).toBe(NEW_SUBDIARIO_ID);
    });
  });

  describe('Subsequent run — workbook exists in cache', () => {
    it('skips Drive search when subdiarioId is cached, clears rows, writes data', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      expect(result.ok).toBe(true);

      // No Drive lookup needed
      expect(drive.findByName).not.toHaveBeenCalled();
      // No creation needed
      expect(drive.createSpreadsheet).not.toHaveBeenCalled();
      // No rename (workbook already set up)
      expect(sheets.renameSheet).not.toHaveBeenCalled();
      // Sheet cleared before writing
      expect(sheets.clearSheetData).toHaveBeenCalledWith(SUBDIARIO_ID, 'Comprobantes');
      // Data written
      expect(sheets.appendRowsWithLinks).toHaveBeenCalled();
    });
  });

  describe('Subsequent run — workbook exists in Drive', () => {
    it('finds workbook via Drive search, clears rows, writes data', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure() // no subdiarioId in cache
      );
      vi.mocked(drive.findByName).mockResolvedValue({
        ok: true,
        value: { id: SUBDIARIO_ID, name: 'Subdiario de Ventas', mimeType: SPREADSHEET_MIME },
      });

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      expect(result.ok).toBe(true);

      // Searched Drive
      expect(drive.findByName).toHaveBeenCalledWith(
        ROOT_ID,
        'Subdiario de Ventas',
        SPREADSHEET_MIME
      );
      // No creation
      expect(drive.createSpreadsheet).not.toHaveBeenCalled();
      // No rename (already exists)
      expect(sheets.renameSheet).not.toHaveBeenCalled();
      // Cleared before writing
      expect(sheets.clearSheetData).toHaveBeenCalledWith(SUBDIARIO_ID, 'Comprobantes');
      // Data written
      expect(sheets.appendRowsWithLinks).toHaveBeenCalled();
    });
  });

  describe('Workbook creation failure', () => {
    it('returns Result.err when createSpreadsheet fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure()
      );
      vi.mocked(drive.findByName).mockResolvedValue({ ok: true, value: null });
      vi.mocked(drive.createSpreadsheet).mockResolvedValue({
        ok: false,
        error: new Error('Drive quota exceeded'),
      });

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Drive quota exceeded');
      }
      // Must not write anything after failure
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
    });
  });

  describe('Empty rows input', () => {
    it('preserves header, writes no data rows, returns rowsWritten: 0', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      // Builder returns no rows
      vi.mocked(subdiarioBuilder.buildSubdiarioRows).mockReturnValue([]);

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rowsWritten).toBe(0);
        expect(result.value.gapsDetected).toBe(0);
      }
      // appendRowsWithLinks not called for empty data
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
      // but clearSheetData still called
      expect(sheets.clearSheetData).toHaveBeenCalled();
    });
  });

  describe('Builder throws', () => {
    it('returns Result.err, does not partial-write', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(subdiarioBuilder.buildSubdiarioRows).mockImplementation(() => {
        throw new Error('Builder internal error');
      });

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Builder internal error');
      }
      // No partial write
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
    });
  });

  describe('Returns correct rowsWritten and gapsDetected', () => {
    it('counts rows written from builder output', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(subdiarioBuilder.buildSubdiarioRows).mockReturnValue([
        { ...MOCK_ROWS[0] },
        { ...MOCK_ROWS[0], nro: '00001-00000002' },
        // Gap placeholder — builder emits these with cliente='FALTA <nro>'
        {
          ...MOCK_ROWS[0],
          nro: '00001-00000003',
          cliente: 'FALTA 00001-00000003',
          total: 0,
        },
      ]);

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rowsWritten).toBe(3);
        expect(result.value.gapsDetected).toBe(1);
      }
    });
  });
});
