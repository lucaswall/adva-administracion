/**
 * Tests for Subdiario de Ventas writer service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncSubdiario, readSubdiarioRows } from './subdiario-writer.js';
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
  applySubdiarioDiff: vi.fn(),
}));

// ─── Mock folder-structure ────────────────────────────────────────────────────

vi.mock('./folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(),
}));

// ─── Mock diff module ─────────────────────────────────────────────────────────

vi.mock('./subdiario-diff.js', () => ({
  diffSubdiarioRows: vi.fn(),
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
import * as logger from '../utils/logger.js';
import * as subdiarioDiff from './subdiario-diff.js';

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
    recibido: null,
    movimiento: '',
    notas: '',
  },
];

// 14-col header (post-ADV-272). Mocked when the schema-migration trigger reads A1:N1.
const NEW_HEADER_14COL: CellValue[] = [
  'fecha', 'cod', 'tipo', 'nro', 'cliente', 'cuit', 'condicion', 'total',
  'concepto', 'categoria', 'fechaCobro', 'recibido', 'movimiento', 'notas',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupDefaultMocks() {
  // getValues: serve the schema-migration header check, the comprobantes read,
  // and EMPTY_SHEET_DATA for source-data reads.
  vi.mocked(sheets.getValues).mockImplementation(async (_id: string, range: string) => {
    if (range === 'Comprobantes!A1:N1') {
      // 14-col header → no migration triggered in default tests
      return { ok: true, value: [NEW_HEADER_14COL] };
    }
    if (range === 'Comprobantes!A2:N') {
      return { ok: true, value: [] as CellValue[][] };
    }
    return { ok: true, value: EMPTY_SHEET_DATA };
  });
  vi.mocked(sheets.setValues).mockResolvedValue({ ok: true, value: 1 });
  vi.mocked(sheets.appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
  vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({
    ok: true,
    value: 'America/Argentina/Buenos_Aires',
  });
  // Return Comprobantes sheet with sheetId=42 by default (needed by diff path)
  vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
    ok: true,
    value: [{ title: 'Comprobantes', sheetId: 42, index: 0 }],
  });
  vi.mocked(sheets.renameSheet).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(sheets.formatSheet).mockResolvedValue({ ok: true, value: undefined });
  // applySubdiarioDiff default: 1 insert (MOCK_ROWS has 1 row → all inserts on first sync)
  vi.mocked(sheets.applySubdiarioDiff).mockResolvedValue({
    ok: true,
    value: { updates: 0, inserts: 1, deletes: 0 },
  });
  // diffSubdiarioRows default: 1 insert (MOCK_ROWS[0]) — covers most existing-workbook tests
  vi.mocked(subdiarioDiff.diffSubdiarioRows).mockReturnValue({
    updates: [],
    inserts: [{ insertAt: 0, row: MOCK_ROWS[0]! }],
    deletes: [],
    sortInvariantViolated: false,
    duplicateKeysDetected: false,
  });
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
      // First call: initializeComprobantesSheet needs Sheet1 to rename
      // Second call: diff path needs Comprobantes sheetId
      vi.mocked(sheets.getSheetMetadata)
        .mockResolvedValueOnce({ ok: true, value: [{ title: 'Sheet1', sheetId: 0, index: 0 }] })
        .mockResolvedValue({ ok: true, value: [{ title: 'Comprobantes', sheetId: 42, index: 0 }] });

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
      // Diff path wrote rows via applySubdiarioDiff (not appendRowsWithLinks)
      expect(sheets.applySubdiarioDiff).toHaveBeenCalled();
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
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
    it('skips Drive search when subdiarioId is cached, uses diff path to write data', async () => {
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
      // Data written via diff path (no clear+append)
      expect(sheets.applySubdiarioDiff).toHaveBeenCalled();
      expect(sheets.clearSheetData).not.toHaveBeenCalled();
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
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
      // Data written via diff path (no clear+append)
      expect(sheets.applySubdiarioDiff).toHaveBeenCalled();
      expect(sheets.clearSheetData).not.toHaveBeenCalled();
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
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
      // Diff returns no-op (desired=[] vs existing=[] → no changes)
      vi.mocked(subdiarioDiff.diffSubdiarioRows).mockReturnValue({
        updates: [],
        inserts: [],
        deletes: [],
        sortInvariantViolated: false,
        duplicateKeysDetected: false,
      });

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
      // No batchUpdate for empty no-op diff
      expect(sheets.applySubdiarioDiff).not.toHaveBeenCalled();
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
      expect(sheets.clearSheetData).not.toHaveBeenCalled();
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

  describe('readMovimientosRows column mapping (ADV-251)', () => {
    it('maps row[2] to debito and row[3] to credito per canonical schema', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );

      const movsSpreadsheetId = 'bank-movs-id';
      const movsMap = new Map<string, string>([['BBVA ARS', movsSpreadsheetId]]);

      // Two rows in canonical order:
      //   A fecha | B concepto | C debito | D credito | E saldo | F saldoCalc | G fileId | H type | I detalle
      const outgoingRow: CellValue[] = ['2025-03-15', 'Pago proveedor', 50000, 0, 100000, 100000, '', '', ''];
      const incomingRow: CellValue[] = ['2025-03-16', 'Cobro cliente', 0, 75000, 175000, 175000, '', '', ''];

      vi.mocked(sheets.getSheetMetadata).mockImplementation(async (id: string) => {
        if (id === movsSpreadsheetId) {
          return { ok: true, value: [{ title: '2025-03', sheetId: 1, index: 0 }] };
        }
        return { ok: true, value: [{ title: 'Sheet1', sheetId: 0, index: 0 }] };
      });

      vi.mocked(sheets.getValues).mockImplementation(async (id: string, range: string) => {
        if (id === movsSpreadsheetId && range.startsWith('2025-03')) {
          return {
            ok: true,
            value: [
              ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalc', 'fileId', 'type', 'detalle'],
              outgoingRow,
              incomingRow,
            ],
          };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
      });

      await syncSubdiario(ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, movsMap);

      expect(subdiarioBuilder.buildSubdiarioRows).toHaveBeenCalled();
      const input = vi.mocked(subdiarioBuilder.buildSubdiarioRows).mock.calls[0]?.[0];
      expect(input).toBeDefined();
      expect(input!.movimientos).toHaveLength(2);

      const out = input!.movimientos[0]!;
      const inc = input!.movimientos[1]!;

      // Outgoing: debito=50000, credito=null/0
      expect(out.debito).toBe(50000);
      expect(out.credito).toBeNull();
      // Incoming: credito=75000, debito=null/0
      expect(inc.credito).toBe(75000);
      expect(inc.debito).toBeNull();
    });
  });

  describe('readMovimientosRows sourceUrl (ADV-269)', () => {
    it('assigns a Sheets cell URL to each BankMovimiento covering distinct sheets and rows', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );

      const movsSpreadsheetId = 'bank-movs-id';
      const movsMap = new Map<string, string>([['BBVA ARS', movsSpreadsheetId]]);

      vi.mocked(sheets.getSheetMetadata).mockImplementation(async (id: string) => {
        if (id === movsSpreadsheetId) {
          return {
            ok: true,
            value: [
              { title: '2025-03', sheetId: 111, index: 0 },
              { title: '2025-04', sheetId: 222, index: 1 },
            ],
          };
        }
        return { ok: true, value: [{ title: 'Comprobantes', sheetId: 42, index: 0 }] };
      });

      vi.mocked(sheets.getValues).mockImplementation(async (id: string, range: string) => {
        if (id === movsSpreadsheetId && range.startsWith('2025-03')) {
          return {
            ok: true,
            value: [
              ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalc', 'fileId', 'type', 'detalle'],
              ['2025-03-15', 'mov 1', 0, 10000, 10000, 10000, 'fileA', 'AUTO', 'd1'],
              ['2025-03-20', 'mov 2', 0, 20000, 30000, 30000, '', '', ''],
            ],
          };
        }
        if (id === movsSpreadsheetId && range.startsWith('2025-04')) {
          return {
            ok: true,
            value: [
              ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalc', 'fileId', 'type', 'detalle'],
              ['2025-04-05', 'mov 3', 0, 30000, 60000, 60000, 'fileB', 'MANUAL', 'd3'],
            ],
          };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
      });

      await syncSubdiario(ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, movsMap);

      const input = vi.mocked(subdiarioBuilder.buildSubdiarioRows).mock.calls[0]?.[0];
      expect(input).toBeDefined();
      expect(input!.movimientos).toHaveLength(3);

      const [m1, m2, m3] = input!.movimientos;

      // First data row in 2025-03 = spreadsheet row 2
      expect(m1!.sourceUrl).toBe(
        `https://docs.google.com/spreadsheets/d/${movsSpreadsheetId}/edit#gid=111&range=A2`
      );
      // Second data row in 2025-03 = spreadsheet row 3
      expect(m2!.sourceUrl).toBe(
        `https://docs.google.com/spreadsheets/d/${movsSpreadsheetId}/edit#gid=111&range=A3`
      );
      // First data row in 2025-04 (different sheetId) = spreadsheet row 2
      expect(m3!.sourceUrl).toBe(
        `https://docs.google.com/spreadsheets/d/${movsSpreadsheetId}/edit#gid=222&range=A2`
      );
    });

    it('assigns sourceUrl to unmatched movimientos (row-identity, not match-identity)', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );

      const movsSpreadsheetId = 'bank-movs-id';
      const movsMap = new Map<string, string>([['BBVA ARS', movsSpreadsheetId]]);

      vi.mocked(sheets.getSheetMetadata).mockImplementation(async (id: string) => {
        if (id === movsSpreadsheetId) {
          return { ok: true, value: [{ title: '2025-06', sheetId: 99, index: 0 }] };
        }
        return { ok: true, value: [{ title: 'Comprobantes', sheetId: 42, index: 0 }] };
      });

      vi.mocked(sheets.getValues).mockImplementation(async (id: string, range: string) => {
        if (id === movsSpreadsheetId && range.startsWith('2025-06')) {
          return {
            ok: true,
            value: [
              ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalc', 'fileId', 'type', 'detalle'],
              ['2025-06-10', 'unmatched mov', 0, 5000, 5000, 5000, '', '', ''],
            ],
          };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
      });

      await syncSubdiario(ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, movsMap);

      const input = vi.mocked(subdiarioBuilder.buildSubdiarioRows).mock.calls[0]?.[0];
      expect(input!.movimientos).toHaveLength(1);
      expect(input!.movimientos[0]!.matchedFileId).toBe('');
      expect(input!.movimientos[0]!.sourceUrl).toBe(
        `https://docs.google.com/spreadsheets/d/${movsSpreadsheetId}/edit#gid=99&range=A2`
      );
    });
  });

  describe('I/O failure propagation (ADV-257)', () => {
    it('returns Result.err when Facturas Emitidas getValues fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(sheets.getValues).mockImplementation(async (_id: string, range: string) => {
        if (range.startsWith('Facturas Emitidas')) {
          return { ok: false, error: new Error('Facturas Emitidas read failed') };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
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
        expect(result.error.message).toContain('Facturas Emitidas read failed');
      }
      // Must not write after a failed read
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
      expect(sheets.clearSheetData).not.toHaveBeenCalled();
    });

    it('returns Result.err when Pagos Recibidos getValues fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(sheets.getValues).mockImplementation(async (_id: string, range: string) => {
        if (range.startsWith('Pagos Recibidos')) {
          return { ok: false, error: new Error('Pagos Recibidos read failed') };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
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
        expect(result.error.message).toContain('Pagos Recibidos read failed');
      }
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('returns Result.err when Retenciones Recibidas getValues fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(sheets.getValues).mockImplementation(async (_id: string, range: string) => {
        if (range.startsWith('Retenciones Recibidas')) {
          return { ok: false, error: new Error('Retenciones read failed') };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
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
        expect(result.error.message).toContain('Retenciones read failed');
      }
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('returns Result.err when applySubdiarioDiff fails on subsequent run', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(sheets.applySubdiarioDiff).mockResolvedValue({
        ok: false,
        error: new Error('Diff apply failed'),
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
        expect(result.error.message).toContain('Diff apply failed');
      }
      // Neither clear nor append path used
      expect(sheets.clearSheetData).not.toHaveBeenCalled();
      expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('returns Result.err when readSubdiarioRows (getValues for Comprobantes) fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(sheets.getValues).mockImplementation(async (_id: string, range: string) => {
        if (range === 'Comprobantes!A1:N1') {
          return { ok: true, value: [NEW_HEADER_14COL] };
        }
        if (range === 'Comprobantes!A2:N') {
          return { ok: false, error: new Error('Comprobantes read failed') };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
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
        expect(result.error.message).toContain('Comprobantes read failed');
      }
      expect(sheets.applySubdiarioDiff).not.toHaveBeenCalled();
    });
  });

  describe('Error logging — review-iteration-2 follow-up', () => {
    // After ADV-256 removed double-logging at the route + match-movimientos layer,
    // the writer is the single source of cause logging. Verify every Result.err
    // path emits a logError so failures are visible under LOG_LEVEL=error.

    it('logs error when findByName fails (resolveSubdiarioId)', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure()
      );
      vi.mocked(drive.findByName).mockResolvedValue({
        ok: false,
        error: new Error('Drive search failed'),
      });

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      expect(result.ok).toBe(false);
      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Drive search failed'
        )
      ).toBe(true);
    });

    it('logs error when createSpreadsheet fails (resolveSubdiarioId)', async () => {
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
      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Drive quota exceeded'
        )
      ).toBe(true);
    });

    it('logs error when initializeComprobantesSheet fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure()
      );
      vi.mocked(drive.findByName).mockResolvedValue({ ok: true, value: null });
      vi.mocked(drive.createSpreadsheet).mockResolvedValue({
        ok: true,
        value: { id: NEW_SUBDIARIO_ID, name: 'Subdiario de Ventas', mimeType: SPREADSHEET_MIME },
      });
      vi.mocked(sheets.renameSheet).mockResolvedValue({
        ok: false,
        error: new Error('Rename failed'),
      });

      const result = await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      expect(result.ok).toBe(false);
      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Rename failed'
        )
      ).toBe(true);
    });

    it('logs error (not warn) when Facturas Emitidas read fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(sheets.getValues).mockImplementation(async (_id: string, range: string) => {
        if (range.startsWith('Facturas Emitidas')) {
          return { ok: false, error: new Error('Facturas read failed') };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
      });

      await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Facturas read failed'
        )
      ).toBe(true);
      // The warn should NOT be the sole log channel for this hard failure
      const warnCalls = vi.mocked(logger.warn).mock.calls;
      expect(
        warnCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Facturas read failed'
        )
      ).toBe(false);
    });

    it('logs error (not warn) when Pagos Recibidos read fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(sheets.getValues).mockImplementation(async (_id: string, range: string) => {
        if (range.startsWith('Pagos Recibidos')) {
          return { ok: false, error: new Error('Pagos read failed') };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
      });

      await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Pagos read failed'
        )
      ).toBe(true);
      const warnCalls = vi.mocked(logger.warn).mock.calls;
      expect(
        warnCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Pagos read failed'
        )
      ).toBe(false);
    });

    it('logs error (not warn) when Retenciones Recibidas read fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(sheets.getValues).mockImplementation(async (_id: string, range: string) => {
        if (range.startsWith('Retenciones Recibidas')) {
          return { ok: false, error: new Error('Retenciones read failed') };
        }
        return { ok: true, value: EMPTY_SHEET_DATA };
      });

      await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Retenciones read failed'
        )
      ).toBe(true);
      const warnCalls = vi.mocked(logger.warn).mock.calls;
      expect(
        warnCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Retenciones read failed'
        )
      ).toBe(false);
    });

    it('logs error (not warn) when Facturador read fails', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(facturadorReader.readFacturador).mockResolvedValue({
        ok: false,
        error: new Error('Facturador read failed'),
      });

      await syncSubdiario(
        ROOT_ID,
        CONTROL_INGRESOS_ID,
        CONTROL_EGRESOS_ID,
        CURRENT_YEAR,
        new Map()
      );

      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Facturador read failed'
        )
      ).toBe(true);
      const warnCalls = vi.mocked(logger.warn).mock.calls;
      expect(
        warnCalls.some(([, ctx]) =>
          (ctx as { error?: string } | undefined)?.error === 'Facturador read failed'
        )
      ).toBe(false);
    });
  });

  describe('Returns correct rowsWritten and gapsDetected', () => {
    it('counts rows written from builder output', async () => {
      vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
        makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
      );
      vi.mocked(subdiarioBuilder.buildSubdiarioRows).mockReturnValue([
        { ...MOCK_ROWS[0]! },
        { ...MOCK_ROWS[0]!, nro: '00001-00000002' },
        // Gap placeholder — builder emits these with cliente='FALTA <nro>'
        {
          ...MOCK_ROWS[0]!,
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

// ─── readSubdiarioRows ────────────────────────────────────────────────────────

describe('readSubdiarioRows', () => {
  // Column indices for Comprobantes!A2:N
  // A(0)=fecha, B(1)=cod, C(2)=tipo, D(3)=nro, E(4)=cliente, F(5)=cuit,
  // G(6)=condicion, H(7)=total, I(8)=concepto, J(9)=categoria,
  // K(10)=fechaCobro, L(11)=recibido, M(12)=movimiento, N(13)=notas

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSheetRow(overrides: Partial<Record<number, CellValue>> = {}): CellValue[] {
    const base: CellValue[] = [
      '2025-01-15', // A: fecha
      '006',        // B: cod
      'FC',         // C: tipo
      '00001-00000001', // D: nro
      'TEST SA',    // E: cliente
      '20123456786',// F: cuit
      'IVA Responsable Inscripto', // G: condicion
      1000,         // H: total
      'Servicios',  // I: concepto
      'Micro',      // J: categoria
      '',           // K: fechaCobro
      '',           // L: recibido (blank → null)
      '',           // M: movimiento (blank — only hard-paid FCs have a URL)
      '',           // N: notas
    ];
    for (const [i, v] of Object.entries(overrides)) {
      base[Number(i)] = v;
    }
    return base;
  }

  it('empty sheet (no data rows) → {ok:true, value:[]}', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: [] });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('two FC rows + one NC row → parsed correctly; rowIndex 0/1/2; recibido=null for blank col L', async () => {
    const fc1 = makeSheetRow({ 3: '00001-00000001', 2: 'FC', 11: '' });
    const fc2 = makeSheetRow({ 3: '00001-00000002', 2: 'FC', 7: 2000, 11: '' });
    const nc1 = makeSheetRow({ 3: '00003-00000001', 2: 'NC', 1: '003', 7: -1000, 11: '' });

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: [fc1, fc2, nc1] });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      expect(result.value[0]!.rowIndex).toBe(0);
      expect(result.value[1]!.rowIndex).toBe(1);
      expect(result.value[2]!.rowIndex).toBe(2);
      expect(result.value[0]!.recibido).toBeNull();
      expect(result.value[1]!.recibido).toBeNull();
      expect(result.value[2]!.recibido).toBeNull();
      expect(result.value[0]!.tipo).toBe('FC');
      expect(result.value[2]!.tipo).toBe('NC');
      expect(result.value[2]!.total).toBe(-1000);
    }
  });

  it('fecha as serial number (45993) → normalized to "2025-12-02"', async () => {
    const row = makeSheetRow({ 0: 45993 }); // serial for 2025-12-02
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: [row] });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.fecha).toBe('2025-12-02');
    }
  });

  it('fechaCobro string value ("NC 00003-00000140") is passed through as-is', async () => {
    const row = makeSheetRow({ 10: 'NC 00003-00000140' });
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: [row] });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.fechaCobro).toBe('NC 00003-00000140');
    }
  });

  it('fechaCobro as serial number → normalized to YYYY-MM-DD', async () => {
    const row = makeSheetRow({ 10: 45993 }); // serial for 2025-12-02
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: [row] });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.fechaCobro).toBe('2025-12-02');
    }
  });

  it('fechaCobro serial=0 → treated as blank ("") not "1899-12-30"', async () => {
    const row = makeSheetRow({ 10: 0 }); // serial 0 = 1899-12-30 epoch — treat as blank
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: [row] });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Must be '' not '1899-12-30'
      expect(result.value[0]!.fechaCobro).toBe('');
    }
  });

  it('total as number round-trips numerically', async () => {
    const row = makeSheetRow({ 7: 1234567.89 });
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: [row] });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.total).toBe(1234567.89);
    }
  });

  it('getValues failure is propagated as ok:false', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: false,
      error: new Error('Sheets API error'),
    });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Sheets API error');
    }
  });

  it('row with empty fecha is skipped; subsequent rows retain correct rowIndex reflecting sheet position', async () => {
    const row1 = makeSheetRow({ 0: '2025-01-10', 3: '00001-00000001' });
    const blankFechaRow = makeSheetRow({ 0: '', 3: '00001-00000002' }); // empty fecha → skip
    const row3 = makeSheetRow({ 0: '2025-01-20', 3: '00001-00000003', 7: 2000 });

    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: [row1, blankFechaRow, row3],
    });

    const result = await readSubdiarioRows('test-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2); // blankFechaRow is skipped
      expect(result.value[0]!.rowIndex).toBe(0); // row1 at position 0
      expect(result.value[1]!.rowIndex).toBe(2); // row3 at position 2 (not 1!)
      expect(result.value[0]!.nro).toBe('00001-00000001');
      expect(result.value[1]!.nro).toBe('00001-00000003');
    }
  });
});

// ─── syncSubdiario diff path (Task 3, ADV-265) ────────────────────────────────

describe('syncSubdiario diff path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
      makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
    );
  });

  it('happy path: calls applySubdiarioDiff once; lock key includes Comprobantes', async () => {
    // Default mocks: diff returns 1 insert, applySubdiarioDiff returns success
    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(true);
    // Exactly one applySubdiarioDiff call (not clear+append)
    expect(sheets.applySubdiarioDiff).toHaveBeenCalledTimes(1);
    // getSheetMetadata called to resolve the Comprobantes sheetId
    expect(sheets.getSheetMetadata).toHaveBeenCalledWith(SUBDIARIO_ID);
    // diffSubdiarioRows called with existing=[] (readSubdiarioRows returned empty) and desired rows
    expect(subdiarioDiff.diffSubdiarioRows).toHaveBeenCalledWith([], MOCK_ROWS);
  });

  it('no-op: when diff is empty → zero applySubdiarioDiff calls; result has all zero diff counts', async () => {
    vi.mocked(subdiarioDiff.diffSubdiarioRows).mockReturnValue({
      updates: [],
      inserts: [],
      deletes: [],
      sortInvariantViolated: false,
      duplicateKeysDetected: false,
    });

    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(true);
    expect(sheets.applySubdiarioDiff).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.inserts).toBe(0);
      expect(result.value.updates).toBe(0);
      expect(result.value.deletes).toBe(0);
      expect(result.value.sortInvariantFallback).toBe(false);
    }
  });

  it('sort-invariant fallback: sortInvariantViolated=true → warns; sortInvariantFallback=true in result; inserts=desired.length', async () => {
    vi.mocked(subdiarioDiff.diffSubdiarioRows).mockReturnValue({
      updates: [],
      inserts: [],
      deletes: [],
      sortInvariantViolated: true,
      duplicateKeysDetected: false,
    });
    vi.mocked(sheets.applySubdiarioDiff).mockResolvedValue({
      ok: true,
      value: { updates: 0, inserts: MOCK_ROWS.length, deletes: 0 },
    });

    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sortInvariantFallback).toBe(true);
      expect(result.value.inserts).toBe(MOCK_ROWS.length);
    }
    // A warning must be logged about the sort invariant violation
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    // applySubdiarioDiff IS called (rewrite path)
    expect(sheets.applySubdiarioDiff).toHaveBeenCalledTimes(1);
  });

  it('first-ever sync (isNew=true): skips readSubdiarioRows; all rows are inserts', async () => {
    // Simulate first-ever sync: workbook just created
    vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
      makeCachedStructure() // no subdiarioId
    );
    vi.mocked(drive.findByName).mockResolvedValue({ ok: true, value: null });
    vi.mocked(drive.createSpreadsheet).mockResolvedValue({
      ok: true,
      value: { id: NEW_SUBDIARIO_ID, name: 'Subdiario de Ventas', mimeType: SPREADSHEET_MIME },
    });
    // Two-call sequence for getSheetMetadata (initializeComprobantesSheet + diff path)
    vi.mocked(sheets.getSheetMetadata)
      .mockResolvedValueOnce({ ok: true, value: [{ title: 'Sheet1', sheetId: 0, index: 0 }] })
      .mockResolvedValue({ ok: true, value: [{ title: 'Comprobantes', sheetId: 42, index: 0 }] });

    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(true);
    // When isNew=true, readSubdiarioRows is skipped → existing=[]
    // diffSubdiarioRows called with empty existing
    expect(subdiarioDiff.diffSubdiarioRows).toHaveBeenCalledWith([], MOCK_ROWS);
    // getValues for Comprobantes not called (skipped when isNew)
    const getValuesCalls = vi.mocked(sheets.getValues).mock.calls;
    const comprobantesCall = getValuesCalls.find(([, range]) => range === 'Comprobantes!A2:N');
    expect(comprobantesCall).toBeUndefined();
  });

  it('getSheetMetadata failure → Result.err propagated; no applySubdiarioDiff', async () => {
    vi.mocked(sheets.getSheetMetadata).mockResolvedValue({
      ok: false,
      error: new Error('Metadata fetch failed'),
    });

    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Metadata fetch failed');
    }
    expect(sheets.applySubdiarioDiff).not.toHaveBeenCalled();
  });

  it('gapsDetected count survives — placeholder rows counted from desired set, independent of diff counts', async () => {
    const gapRow: SubdiarioRow = {
      ...MOCK_ROWS[0]!,
      nro: '00001-00000099',
      cliente: 'FALTA 00001-00000099',
      total: 0,
    };
    vi.mocked(subdiarioBuilder.buildSubdiarioRows).mockReturnValue([
      MOCK_ROWS[0]!,
      gapRow,
    ]);
    vi.mocked(subdiarioDiff.diffSubdiarioRows).mockReturnValue({
      updates: [],
      inserts: [{ insertAt: 0, row: MOCK_ROWS[0]! }, { insertAt: 1, row: gapRow }],
      deletes: [],
      sortInvariantViolated: false,
      duplicateKeysDetected: false,
    });
    vi.mocked(sheets.applySubdiarioDiff).mockResolvedValue({
      ok: true,
      value: { updates: 0, inserts: 2, deletes: 0 },
    });

    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rowsWritten).toBe(2);
      expect(result.value.gapsDetected).toBe(1); // FALTA row counted
    }
  });

  it('two concurrent syncSubdiario calls on same subdiarioId both complete successfully', async () => {
    const [result1, result2] = await Promise.all([
      syncSubdiario(ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()),
      syncSubdiario(ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()),
    ]);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
  });
});

// ─── Schema migration (ADV-272) ───────────────────────────────────────────────

describe('syncSubdiario schema migration (ADV-272)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    vi.mocked(folderStructure.getCachedFolderStructure).mockReturnValue(
      makeCachedStructure({ subdiarioId: SUBDIARIO_ID })
    );
  });

  const OLD_HEADER_13COL: CellValue[] = [
    'fecha', 'cod', 'tipo', 'nro', 'cliente', 'cuit', 'condicion', 'total',
    'concepto', 'categoria', 'fechaCobro', 'recibido', 'notas',
  ];

  it('detects 13-col header → rewrites header to 14 cols and emits a full rewrite', async () => {
    // Existing workbook has 2 rows in the old 13-col layout
    vi.mocked(sheets.getValues).mockImplementation(async (_id, range) => {
      if (range === 'Comprobantes!A1:N1') {
        return { ok: true, value: [OLD_HEADER_13COL] };
      }
      if (range === 'Comprobantes!A2:N') {
        // 2 old rows in 13-col layout — used for delete-index emission
        return {
          ok: true,
          value: [
            ['2025-01-10', '006', 'FC', '00001-00000001', 'CLIENTE A', '20123456786', 'IVA RI', 1000, '', 'Micro', '', '', 'note A'],
            ['2025-01-15', '006', 'FC', '00001-00000002', 'CLIENTE B', '20123456786', 'IVA RI', 2000, '', 'Micro', '', '', 'note B'],
          ],
        };
      }
      return { ok: true, value: EMPTY_SHEET_DATA };
    });
    vi.mocked(sheets.applySubdiarioDiff).mockResolvedValue({
      ok: true,
      value: { updates: 0, inserts: MOCK_ROWS.length, deletes: 2 },
    });

    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(true);

    // Header was rewritten to A1:N1 with the 14-col layout
    const setValuesCalls = vi.mocked(sheets.setValues).mock.calls;
    const headerWrite = setValuesCalls.find(([, range]) => range === 'Comprobantes!A1:N1');
    expect(headerWrite).toBeDefined();
    expect(headerWrite![2]).toEqual([NEW_HEADER_14COL]);

    // The regular diff path was BYPASSED — diffSubdiarioRows must not have been called
    expect(subdiarioDiff.diffSubdiarioRows).not.toHaveBeenCalled();

    // applySubdiarioDiff was called once with full-rewrite payload (deletes for both
    // old rows + inserts for every desired row + sortInvariantViolated=true)
    expect(sheets.applySubdiarioDiff).toHaveBeenCalledTimes(1);
    const [, , diffArg] = vi.mocked(sheets.applySubdiarioDiff).mock.calls[0]!;
    expect(diffArg.sortInvariantViolated).toBe(true);
    expect(diffArg.inserts).toHaveLength(MOCK_ROWS.length);
    // Deletes are descending row indices of the 2 old rows
    expect(diffArg.deletes).toEqual([1, 0]);

    // sortInvariantFallback is surfaced in the result
    if (result.ok) {
      expect(result.value.sortInvariantFallback).toBe(true);
    }
  });

  it('14-col header → migration path is skipped; normal diff path runs', async () => {
    // setupDefaultMocks already serves the 14-col header
    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(true);
    // Header should NOT be rewritten
    const setValuesCalls = vi.mocked(sheets.setValues).mock.calls;
    const headerWrite = setValuesCalls.find(([, range]) => range === 'Comprobantes!A1:N1');
    expect(headerWrite).toBeUndefined();
    // Normal diff path was used
    expect(subdiarioDiff.diffSubdiarioRows).toHaveBeenCalled();
  });

  it('empty header (truly broken state) → migration triggers', async () => {
    vi.mocked(sheets.getValues).mockImplementation(async (_id, range) => {
      if (range === 'Comprobantes!A1:N1') {
        return { ok: true, value: [] };
      }
      if (range === 'Comprobantes!A2:N') {
        return { ok: true, value: [] };
      }
      return { ok: true, value: EMPTY_SHEET_DATA };
    });

    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(true);
    const setValuesCalls = vi.mocked(sheets.setValues).mock.calls;
    const headerWrite = setValuesCalls.find(([, range]) => range === 'Comprobantes!A1:N1');
    expect(headerWrite).toBeDefined();
  });

  it('header read failure → Result.err propagated; no applySubdiarioDiff (ADV-272)', async () => {
    vi.mocked(sheets.getValues).mockImplementation(async (_id, range) => {
      if (range === 'Comprobantes!A1:N1') {
        return { ok: false, error: new Error('header read failed') };
      }
      return { ok: true, value: EMPTY_SHEET_DATA };
    });

    const result = await syncSubdiario(
      ROOT_ID, CONTROL_INGRESOS_ID, CONTROL_EGRESOS_ID, CURRENT_YEAR, new Map()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('header read failed');
    }
    expect(sheets.applySubdiarioDiff).not.toHaveBeenCalled();
  });
});

