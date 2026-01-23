/**
 * Unit tests for folder structure service
 * Tests discovery, caching, and creation of Drive folder structure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Result } from '../../../src/types/index.js';

// Mock the drive module
const mockFindByName = vi.fn();
const mockListByMimeType = vi.fn();
const mockCreateFolder = vi.fn();
const mockCreateSpreadsheet = vi.fn();

vi.mock('../../../src/services/drive.js', () => ({
  findByName: (...args: unknown[]) => mockFindByName(...args),
  listByMimeType: (...args: unknown[]) => mockListByMimeType(...args),
  createFolder: (...args: unknown[]) => mockCreateFolder(...args),
  createSpreadsheet: (...args: unknown[]) => mockCreateSpreadsheet(...args),
  clearDriveCache: vi.fn(),
}));

// Mock the sheets module
const mockGetSheetMetadata = vi.fn();
const mockCreateSheet = vi.fn();
const mockSetValues = vi.fn();
const mockFormatSheet = vi.fn();
const mockDeleteSheet = vi.fn();
const mockGetValues = vi.fn();
const mockMoveSheetToFirst = vi.fn();

vi.mock('../../../src/services/sheets.js', () => ({
  getSheetMetadata: (...args: unknown[]) => mockGetSheetMetadata(...args),
  createSheet: (...args: unknown[]) => mockCreateSheet(...args),
  setValues: (...args: unknown[]) => mockSetValues(...args),
  formatSheet: (...args: unknown[]) => mockFormatSheet(...args),
  deleteSheet: (...args: unknown[]) => mockDeleteSheet(...args),
  getValues: (...args: unknown[]) => mockGetValues(...args),
  moveSheetToFirst: (...args: unknown[]) => mockMoveSheetToFirst(...args),
  clearSheetsCache: vi.fn(),
}));

// Mock config
vi.mock('../../../src/config.js', () => ({
  getConfig: vi.fn(() => ({
    driveRootFolderId: 'root-folder-id',
  })),
}));

import {
  discoverFolderStructure,
  getOrCreateMonthFolder,
  clearFolderStructureCache,
  getCachedFolderStructure,
} from '../../../src/services/folder-structure.js';

describe('FolderStructure service', () => {
  beforeEach(() => {
    clearFolderStructureCache();
    vi.clearAllMocks();
    // Mock formatSheet to always succeed by default
    mockFormatSheet.mockResolvedValue({ ok: true, value: undefined });
    // Mock getValues to return empty by default (no headers)
    mockGetValues.mockResolvedValue({ ok: true, value: [[]] });
    // Mock deleteSheet to always succeed by default
    mockDeleteSheet.mockResolvedValue({ ok: true, value: undefined });
    // Mock setValues to always succeed by default
    mockSetValues.mockResolvedValue({ ok: true, value: 0 });
    // Mock createSheet to always succeed by default
    mockCreateSheet.mockResolvedValue({ ok: true, value: 0 });
    // Mock moveSheetToFirst to always succeed by default
    mockMoveSheetToFirst.mockResolvedValue({ ok: true, value: undefined });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('discoverFolderStructure', () => {
    it('discovers all required folders and spreadsheets at root', async () => {
      // Mock finding root-level folders (Entrada and Sin Procesar only)
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      // Mock listing bank spreadsheets (at root)
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'bank1-id', name: 'BBVA Movimientos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'bank2-id', name: 'Galicia Movimientos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Ingresos sheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        // Control de Egresos sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        })
        // Dashboard Operativo Contable sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Resumen Mensual', sheetId: 1 },
            { title: 'Uso de API', sheetId: 2 },
          ],
        });

      // Mock getValues for existing sheets with correct headers (starting with 'fileId')
      mockGetValues.mockResolvedValue({ ok: true, value: [['fileId', 'fileName', 'folderPath']] });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rootId).toBe('root-folder-id');
        expect(result.value.entradaId).toBe('entrada-id');
        expect(result.value.sinProcesarId).toBe('sin-procesar-id');
        expect(result.value.controlIngresosId).toBe('control-ingresos-id');
        expect(result.value.controlEgresosId).toBe('control-egresos-id');
        expect(result.value.dashboardOperativoId).toBe('dashboard-operativo-id');
        expect(result.value.bankSpreadsheets.get('BBVA Movimientos')).toBe('bank1-id');
        expect(result.value.bankSpreadsheets.get('Galicia Movimientos')).toBe('bank2-id');
        // Year and classification folders should be empty (created on-demand)
        expect(result.value.yearFolders.size).toBe(0);
        expect(result.value.classificationFolders.size).toBe(0);
        expect(result.value.monthFolders.size).toBe(0);
      }
    });

    it('creates missing folders when they do not exist', async () => {
      // Mock: Entrada doesn't exist, Sin Procesar does
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // Entrada not found
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      // Mock creating Entrada folder
      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } });

      // Mock listing bank spreadsheets
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Ingresos sheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        // Control de Egresos sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        })
        // Dashboard Operativo Contable sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Resumen Mensual', sheetId: 1 },
            { title: 'Uso de API', sheetId: 2 },
          ],
        });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entradaId).toBe('new-entrada-id');
        expect(result.value.sinProcesarId).toBe('sin-procesar-id');
      }

      expect(mockCreateFolder).toHaveBeenCalledTimes(1);
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', 'Entrada');
    });

    it('creates missing spreadsheets when they do not exist', async () => {
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: null }) // Control de Ingresos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Control de Egresos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Dashboard Operativo Contable not found

      mockCreateSpreadsheet
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'new-control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'new-control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'new-dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Ingresos sheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        // Control de Egresos sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        })
        // Dashboard Operativo Contable sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Resumen Mensual', sheetId: 1 },
            { title: 'Uso de API', sheetId: 2 },
          ],
        });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.controlIngresosId).toBe('new-control-ingresos-id');
        expect(result.value.controlEgresosId).toBe('new-control-egresos-id');
        expect(result.value.dashboardOperativoId).toBe('new-dashboard-operativo-id');
      }

      expect(mockCreateSpreadsheet).toHaveBeenCalledTimes(3);
      expect(mockCreateSpreadsheet).toHaveBeenCalledWith('root-folder-id', 'Control de Ingresos');
      expect(mockCreateSpreadsheet).toHaveBeenCalledWith('root-folder-id', 'Control de Egresos');
      expect(mockCreateSpreadsheet).toHaveBeenCalledWith('root-folder-id', 'Dashboard Operativo Contable');
    });

    it('returns error on Drive API failure', async () => {
      mockFindByName.mockResolvedValueOnce({ ok: false, error: new Error('API error') });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('API error');
      }
    });

    it('caches the discovered structure', async () => {
      // Setup successful discovery
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Ingresos sheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        // Control de Egresos sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        })
        // Dashboard Operativo Contable sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Resumen Mensual', sheetId: 1 },
            { title: 'Uso de API', sheetId: 2 },
          ],
        });

      // First call discovers (now 5 findByName calls: Entrada, Sin Procesar, 3 spreadsheets)
      await discoverFolderStructure();
      expect(mockFindByName).toHaveBeenCalledTimes(5);

      // Second call uses cache
      const cached = getCachedFolderStructure();
      expect(cached).not.toBe(null);
      expect(cached?.entradaId).toBe('entrada-id');

      // Clear cache and verify it's gone
      clearFolderStructureCache();
      expect(getCachedFolderStructure()).toBe(null);
    });

    it('creates missing sheets in Control de Egresos spreadsheet', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - all spreadsheets have no sheets
      mockGetSheetMetadata.mockResolvedValue({ ok: true, value: [] });

      // Mock creating sheets (2 for Ingresos + 3 for Egresos + 3 for Dashboard = 8 total)
      mockCreateSheet
        .mockResolvedValueOnce({ ok: true, value: 1 }) // Facturas Emitidas
        .mockResolvedValueOnce({ ok: true, value: 2 }) // Pagos Recibidos
        .mockResolvedValueOnce({ ok: true, value: 3 }) // Facturas Recibidas
        .mockResolvedValueOnce({ ok: true, value: 4 }) // Pagos Enviados
        .mockResolvedValueOnce({ ok: true, value: 5 }) // Recibos
        .mockResolvedValueOnce({ ok: true, value: 6 }) // Pagos Pendientes
        .mockResolvedValueOnce({ ok: true, value: 7 }) // Resumen Mensual
        .mockResolvedValueOnce({ ok: true, value: 8 }); // Uso de API

      // Mock setting header values
      mockSetValues.mockResolvedValue({ ok: true, value: 23 });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify sheets were created for all spreadsheets
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('control-ingresos-id');
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('control-egresos-id');
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('dashboard-operativo-id');
      expect(mockCreateSheet).toHaveBeenCalledTimes(9);
      expect(mockCreateSheet).toHaveBeenCalledWith('control-ingresos-id', 'Facturas Emitidas');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-ingresos-id', 'Pagos Recibidos');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-ingresos-id', 'Retenciones Recibidas');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-egresos-id', 'Facturas Recibidas');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-egresos-id', 'Pagos Enviados');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-egresos-id', 'Recibos');
      expect(mockCreateSheet).toHaveBeenCalledWith('dashboard-operativo-id', 'Pagos Pendientes');
      expect(mockCreateSheet).toHaveBeenCalledWith('dashboard-operativo-id', 'Resumen Mensual');
      expect(mockCreateSheet).toHaveBeenCalledWith('dashboard-operativo-id', 'Uso de API');

      // Verify headers were set
      expect(mockSetValues).toHaveBeenCalled();
    });

    it('does not create sheets that already exist', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - all sheets already exist for all spreadsheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
            { title: 'Retenciones Recibidas', sheetId: 3 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Pagos Pendientes', sheetId: 1 },
            { title: 'Resumen Mensual', sheetId: 2 },
            { title: 'Uso de API', sheetId: 3 },
          ],
        });

      // Mock getValues for existing sheets with correct headers
      // Facturas start with 'fechaEmision', Pagos/Recibos start with 'fechaPago', Dashboard has specific headers
      mockGetValues
        .mockResolvedValueOnce({ ok: true, value: [['fechaEmision', 'fileId', 'fileName']] }) // Facturas Emitidas headers
        .mockResolvedValueOnce({ ok: true, value: [['fechaPago', 'fileId', 'fileName']] }) // Pagos Recibidos headers
        .mockResolvedValueOnce({ ok: true, value: [['fechaEmision', 'fileId', 'fileName']] }) // Retenciones Recibidas headers
        .mockResolvedValueOnce({ ok: true, value: [['fechaEmision', 'fileId', 'fileName']] }) // Facturas Recibidas headers
        .mockResolvedValueOnce({ ok: true, value: [['fechaPago', 'fileId', 'fileName']] }) // Pagos Enviados headers
        .mockResolvedValueOnce({ ok: true, value: [['fechaPago', 'fileId', 'fileName']] }) // Recibos headers
        .mockResolvedValueOnce({ ok: true, value: [['fechaEmision', 'fileId', 'fileName']] }) // Pagos Pendientes headers
        .mockResolvedValueOnce({ ok: true, value: [['fecha', 'totalLlamadas', 'tokensEntrada', 'tokensSalida', 'costoTotalUSD', 'tasaExito', 'duracionPromedio']] }) // Resumen Mensual headers
        .mockResolvedValueOnce({ ok: true, value: [['timestamp', 'requestId', 'fileId', 'fileName', 'model', 'promptTokens', 'outputTokens', 'totalTokens', 'estimatedCostUSD', 'durationMs', 'success', 'errorMessage']] }) // Uso de API headers
        .mockResolvedValueOnce({ ok: true, value: [[2026]] }); // Resumen Mensual A2:A2 (data exists)

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify sheets were NOT created (they already exist)
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('control-ingresos-id');
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('control-egresos-id');
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('dashboard-operativo-id');
      expect(mockCreateSheet).not.toHaveBeenCalled();

      // Dashboard Operativo Contable's Resumen Mensual is skipped when data already exists
      expect(mockSetValues).not.toHaveBeenCalled();
    });

    it('creates only missing sheets when some exist', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Ingresos has only Facturas Emitidas
      // Control de Egresos has only Facturas Recibidas
      // Dashboard Operativo has only Resumen Mensual
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Facturas Emitidas', sheetId: 1 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Facturas Recibidas', sheetId: 1 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Resumen Mensual', sheetId: 1 }],
        });

      // Mock getValues for existing sheets with correct headers
      // Facturas start with 'fechaEmision', Dashboard has specific headers
      mockGetValues
        .mockResolvedValueOnce({ ok: true, value: [['fechaEmision', 'fileId', 'fileName']] }) // Facturas Emitidas
        .mockResolvedValueOnce({ ok: true, value: [['fechaEmision', 'fileId', 'fileName']] }) // Facturas Recibidas
        .mockResolvedValueOnce({ ok: true, value: [['fecha', 'totalLlamadas', 'tokensEntrada']] }); // Resumen Mensual

      // Mock creating missing sheets (2 for Ingresos + 2 for Egresos + 2 for Dashboard = 6)
      mockCreateSheet
        .mockResolvedValueOnce({ ok: true, value: 2 }) // Pagos Recibidos
        .mockResolvedValueOnce({ ok: true, value: 3 }) // Retenciones Recibidas
        .mockResolvedValueOnce({ ok: true, value: 4 }) // Pagos Enviados
        .mockResolvedValueOnce({ ok: true, value: 5 }) // Recibos
        .mockResolvedValueOnce({ ok: true, value: 6 }) // Pagos Pendientes
        .mockResolvedValueOnce({ ok: true, value: 7 }); // Uso de API

      mockSetValues.mockResolvedValue({ ok: true, value: 17 });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify only missing sheets were created
      expect(mockCreateSheet).toHaveBeenCalledTimes(6);
      expect(mockCreateSheet).toHaveBeenCalledWith('control-ingresos-id', 'Pagos Recibidos');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-ingresos-id', 'Retenciones Recibidas');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-egresos-id', 'Pagos Enviados');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-egresos-id', 'Recibos');
      expect(mockCreateSheet).toHaveBeenCalledWith('dashboard-operativo-id', 'Pagos Pendientes');
      expect(mockCreateSheet).toHaveBeenCalledWith('dashboard-operativo-id', 'Uso de API');
      expect(mockCreateSheet).not.toHaveBeenCalledWith('control-ingresos-id', 'Facturas Emitidas');
      expect(mockCreateSheet).not.toHaveBeenCalledWith('control-egresos-id', 'Facturas Recibidas');
      expect(mockCreateSheet).not.toHaveBeenCalledWith('dashboard-operativo-id', 'Resumen Mensual');

      // Verify headers were set only for new sheets
      expect(mockSetValues).toHaveBeenCalled();
    });

    it('handles sheet creation failure gracefully', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - no sheets exist
      mockGetSheetMetadata.mockResolvedValue({ ok: true, value: [] });

      // Mock sheet creation failure
      mockCreateSheet.mockResolvedValue({ ok: false, error: new Error('Failed to create sheet') });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to create sheet');
      }
    });

    it('deletes initial Sheet1 when creating new spreadsheet with custom sheets', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - newly created spreadsheets have only Sheet1
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Sheet1', sheetId: 0 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Sheet1', sheetId: 0 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Sheet1', sheetId: 0 }],
        });

      // Mock creating sheets (2 for Ingresos + 3 for Egresos + 3 for Dashboard = 8 total)
      mockCreateSheet
        .mockResolvedValueOnce({ ok: true, value: 1 }) // Facturas Emitidas
        .mockResolvedValueOnce({ ok: true, value: 2 }) // Pagos Recibidos
        .mockResolvedValueOnce({ ok: true, value: 3 }) // Facturas Recibidas
        .mockResolvedValueOnce({ ok: true, value: 4 }) // Pagos Enviados
        .mockResolvedValueOnce({ ok: true, value: 5 }) // Recibos
        .mockResolvedValueOnce({ ok: true, value: 6 }) // Pagos Pendientes
        .mockResolvedValueOnce({ ok: true, value: 7 }) // Resumen Mensual
        .mockResolvedValueOnce({ ok: true, value: 8 }); // Uso de API

      // Mock setting header values
      mockSetValues.mockResolvedValue({ ok: true, value: 23 });

      // Mock getValues to return empty for Sheet1 (no headers)
      mockGetValues.mockResolvedValue({ ok: true, value: [[]] });

      // Mock deleteSheet to succeed
      mockDeleteSheet.mockResolvedValue({ ok: true, value: undefined });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify sheets were created for all spreadsheets
      expect(mockCreateSheet).toHaveBeenCalledTimes(9);

      // Verify Sheet1 was deleted from all spreadsheets
      expect(mockDeleteSheet).toHaveBeenCalledTimes(3);
      expect(mockDeleteSheet).toHaveBeenCalledWith('control-ingresos-id', 0);
      expect(mockDeleteSheet).toHaveBeenCalledWith('control-egresos-id', 0);
      expect(mockDeleteSheet).toHaveBeenCalledWith('dashboard-operativo-id', 0);
    });

    it('does not delete Sheet1 if it has been converted to a custom sheet', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - all custom sheets already exist, no Sheet1
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Resumen Mensual', sheetId: 1 },
            { title: 'Uso de API', sheetId: 2 },
          ],
        });

      // Mock getValues for existing sheets with correct headers (starting with 'fileId')
      mockGetValues.mockResolvedValue({ ok: true, value: [['fileId', 'fileName', 'folderPath']] });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify Sheet1 was NOT deleted (it doesn't exist)
      expect(mockDeleteSheet).not.toHaveBeenCalled();
    });

    it('discovers and creates Dashboard Operativo Contable spreadsheet with initialization', async () => {
      // Mock finding root-level folders and control spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: null }); // Dashboard Operativo Contable not found

      // Mock creating fresh Dashboard Operativo Contable
      mockCreateSpreadsheet.mockResolvedValueOnce({
        ok: true,
        value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' }
      });

      // Mock listing bank spreadsheets
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata for control spreadsheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        })
        // Dashboard Operativo Contable - default Sheet1 only
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Sheet1', sheetId: 0 },
          ],
        });

      // Mock getValues for existing sheets (headers check)
      mockGetValues.mockImplementation((spreadsheetId: string, range: string) => {
        // For data check (A2:A2), return empty to indicate no existing data
        if (range.includes('A2:A2')) {
          return Promise.resolve({ ok: true, value: [] });
        }
        // For header checks, return headers
        return Promise.resolve({ ok: true, value: [['fileId', 'fileName', 'folderPath']] });
      });

      // Mock createSheet for Dashboard Operativo sheets
      mockCreateSheet
        .mockResolvedValueOnce({ ok: true, value: 1 }) // Resumen Mensual
        .mockResolvedValueOnce({ ok: true, value: 2 }); // Uso de API

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dashboardOperativoId).toBe('dashboard-operativo-id');
      }

      // Verify Dashboard Operativo Contable was created fresh
      expect(mockCreateSpreadsheet).toHaveBeenCalledWith('root-folder-id', 'Dashboard Operativo Contable');

      // Verify both sheets were created
      expect(mockCreateSheet).toHaveBeenCalledWith('dashboard-operativo-id', 'Resumen Mensual');
      expect(mockCreateSheet).toHaveBeenCalledWith('dashboard-operativo-id', 'Uso de API');

      // Verify headers were set for both sheets
      expect(mockSetValues).toHaveBeenCalledWith(
        'dashboard-operativo-id',
        'Resumen Mensual!A1',
        [['fecha', 'totalLlamadas', 'tokensEntrada', 'tokensSalida', 'costoTotalUSD', 'tasaExito', 'duracionPromedio']]
      );
      expect(mockSetValues).toHaveBeenCalledWith(
        'dashboard-operativo-id',
        'Uso de API!A1',
        [['timestamp', 'requestId', 'fileId', 'fileName', 'model', 'promptTokens', 'cachedTokens', 'outputTokens', 'totalTokens', 'estimatedCostUSD', 'durationMs', 'success', 'errorMessage']]
      );

      // Verify Resumen Mensual was initialized with current month and next month
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
      const yearForNextMonth = currentMonth === 11 ? currentYear + 1 : currentYear;
      const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
      const nextMonthStr = `${yearForNextMonth}-${String(nextMonth + 1).padStart(2, '0')}`;

      // Verify current month and next month rows were initialized with formulas wrapped in IFERROR
      expect(mockSetValues).toHaveBeenCalledWith(
        'dashboard-operativo-id',
        'Resumen Mensual!A2:G3',
        expect.arrayContaining([
          expect.arrayContaining([
            currentMonthStr,
            expect.stringContaining('=IFERROR(COUNTIFS'), // totalLlamadas formula with IFERROR
            expect.stringContaining('=IFERROR(SUMIFS'),   // tokensEntrada formula with IFERROR
            expect.stringContaining('=IFERROR(SUMIFS'),   // tokensSalida formula with IFERROR
            expect.stringContaining('=IFERROR(SUMIFS'),   // costoTotalUSD formula with IFERROR
            expect.stringContaining('=IFERROR(IF'),       // tasaExito formula with IFERROR
            expect.stringContaining('=IFERROR(AVERAGEIFS'), // duracionPromedio formula with IFERROR
          ]),
          expect.arrayContaining([
            nextMonthStr,
            expect.stringContaining('=IFERROR(COUNTIFS'),
            expect.stringContaining('=IFERROR(SUMIFS'),
            expect.stringContaining('=IFERROR(SUMIFS'),
            expect.stringContaining('=IFERROR(SUMIFS'),
            expect.stringContaining('=IFERROR(IF'),
            expect.stringContaining('=IFERROR(AVERAGEIFS'),
          ])
        ])
      );

      // Verify Sheet1 was deleted
      expect(mockDeleteSheet).toHaveBeenCalledWith('dashboard-operativo-id', 0);
    });
  });

  describe('getOrCreateMonthFolder', () => {
    beforeEach(async () => {
      // Setup cached structure for year-based tests
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' } });
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-ingresos-id', name: 'Control de Ingresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-egresos-id', name: 'Control de Egresos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'dashboard-operativo-id', name: 'Dashboard Operativo Contable', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet operations for all spreadsheets (all sheets exist)
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Resumen Mensual', sheetId: 1 },
            { title: 'Uso de API', sheetId: 2 },
          ],
        });

      await discoverFolderStructure();
      vi.clearAllMocks();
    });

    it('creates year folder when first needed', async () => {
      // Mock: year folder doesn't exist, needs to be created
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // Year folder not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Ingresos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }) // Egresos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }); // Month folder not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } }) // Year folder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-ingresos-id', name: 'Ingresos', mimeType: 'application/vnd.google-apps.folder' } }) // Ingresos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-egresos-id', name: 'Egresos', mimeType: 'application/vnd.google-apps.folder' } }) // Egresos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } }) // Bancos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-01-ingresos-id', name: '01 - Enero', mimeType: 'application/vnd.google-apps.folder' } }); // Month in ingresos

      const result = await getOrCreateMonthFolder('ingresos', new Date(2024, 0, 15));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('2024-01-ingresos-id');
      }

      // Verify year folder was created in root
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', '2024');
      // Verify all classification folders were created in year
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Ingresos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Egresos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Bancos');
      // Verify month folder was created in classification folder
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-ingresos-id', '01 - Enero');
    });

    it('reuses existing year folder when it exists', async () => {
      // Mock: year folder exists
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } }) // Year found
        .mockResolvedValueOnce({ ok: true, value: null }) // Ingresos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }) // Egresos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }); // Month folder not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-ingresos-id', name: 'Ingresos', mimeType: 'application/vnd.google-apps.folder' } }) // Ingresos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-egresos-id', name: 'Egresos', mimeType: 'application/vnd.google-apps.folder' } }) // Egresos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } }) // Bancos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-02-egresos-id', name: '02 - Febrero', mimeType: 'application/vnd.google-apps.folder' } }); // Month in egresos

      const result = await getOrCreateMonthFolder('egresos', new Date(2024, 1, 20));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('2024-02-egresos-id');
      }

      // Verify year folder was NOT created (already exists)
      expect(mockCreateFolder).not.toHaveBeenCalledWith('root-folder-id', '2024');
      // Verify classification folders were created in existing year
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Ingresos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Egresos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Bancos');
      // Verify month folder was created
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-egresos-id', '02 - Febrero');
    });

    it('handles multiple years independently', async () => {
      // First request: 2024
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // 2024 not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Ingresos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Egresos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Month not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-ingresos-id', name: 'Ingresos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-egresos-id', name: 'Egresos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-03-ingresos-id', name: '03 - Marzo', mimeType: 'application/vnd.google-apps.folder' } });

      const result2024 = await getOrCreateMonthFolder('ingresos', new Date(2024, 2, 15));
      expect(result2024.ok).toBe(true);

      vi.clearAllMocks();

      // Second request: 2025
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // 2025 not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Ingresos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Egresos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Month not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-folder-id', name: '2025', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-ingresos-id', name: 'Ingresos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-egresos-id', name: 'Egresos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-03-ingresos-id', name: '03 - Marzo', mimeType: 'application/vnd.google-apps.folder' } });

      const result2025 = await getOrCreateMonthFolder('ingresos', new Date(2025, 2, 15));
      expect(result2025.ok).toBe(true);
      if (result2025.ok) {
        expect(result2025.value).toBe('2025-03-ingresos-id');
      }

      // Verify both years were created
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', '2025');
    });

    it('creates all classification folders when year is first created', async () => {
      // Mock: year folder doesn't exist
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // Year not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Ingresos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Egresos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Bancos not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } }) // Year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-ingresos-id', name: 'Ingresos', mimeType: 'application/vnd.google-apps.folder' } }) // Ingresos
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-egresos-id', name: 'Egresos', mimeType: 'application/vnd.google-apps.folder' } }) // Egresos
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } }); // Bancos

      const result = await getOrCreateMonthFolder('bancos', new Date(2024, 5, 10));

      expect(result.ok).toBe(true);

      // Verify year folder was created
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', '2024');
      // Verify all three classification folders were created
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Ingresos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Egresos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Bancos');
    });

    it('caches year and classification folders for subsequent requests', async () => {
      // First request: create year and all classification folders
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // Year not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Ingresos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Egresos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Month not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-ingresos-id', name: 'Ingresos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-egresos-id', name: 'Egresos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-01-ingresos-id', name: '01 - Enero', mimeType: 'application/vnd.google-apps.folder' } });

      await getOrCreateMonthFolder('ingresos', new Date(2024, 0, 15));

      vi.clearAllMocks();

      // Second request: same year, different month - should use cached year and classification folders
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }); // Only month folder not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-02-ingresos-id', name: '02 - Febrero', mimeType: 'application/vnd.google-apps.folder' } });

      const result = await getOrCreateMonthFolder('ingresos', new Date(2024, 1, 20));

      expect(result.ok).toBe(true);

      // Should not create year or classification folders again (only month folder)
      expect(mockFindByName).toHaveBeenCalledTimes(1);
      expect(mockCreateFolder).toHaveBeenCalledTimes(1);
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-ingresos-id', '02 - Febrero');
    });

    it('returns bancos folder directly under year without month subfolder', async () => {
      // Mock: year folder exists, all classification folders exist
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } }) // Year found
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-ingresos-id', name: 'Ingresos', mimeType: 'application/vnd.google-apps.folder' } }) // Ingresos found
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-egresos-id', name: 'Egresos', mimeType: 'application/vnd.google-apps.folder' } }) // Egresos found
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } }); // Bancos found

      const result = await getOrCreateMonthFolder('bancos', new Date(2024, 3, 15));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('2024-bancos-id');
      }

      // Should not create any folders (all exist) and no month folder for bancos
      expect(mockCreateFolder).not.toHaveBeenCalled();
    });

    it('keeps Sin Procesar at root level without year or month folders', async () => {
      const result = await getOrCreateMonthFolder('sin_procesar', new Date(2024, 5, 20));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('sin-procesar-id');
      }

      // Should not search for or create any folders
      expect(mockFindByName).not.toHaveBeenCalled();
      expect(mockCreateFolder).not.toHaveBeenCalled();
    });
  });
});
