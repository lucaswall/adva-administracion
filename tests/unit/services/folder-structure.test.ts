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

vi.mock('../../../src/services/sheets.js', () => ({
  getSheetMetadata: (...args: unknown[]) => mockGetSheetMetadata(...args),
  createSheet: (...args: unknown[]) => mockCreateSheet(...args),
  setValues: (...args: unknown[]) => mockSetValues(...args),
  formatSheet: (...args: unknown[]) => mockFormatSheet(...args),
  deleteSheet: (...args: unknown[]) => mockDeleteSheet(...args),
  getValues: (...args: unknown[]) => mockGetValues(...args),
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
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      // Mock listing bank spreadsheets (at root)
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'bank1-id', name: 'BBVA Movimientos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'bank2-id', name: 'Galicia Movimientos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Creditos sheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        // Control de Debitos sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
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
        expect(result.value.controlCreditosId).toBe('control-creditos-id');
        expect(result.value.controlDebitosId).toBe('control-debitos-id');
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
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      // Mock creating Entrada folder
      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } });

      // Mock listing bank spreadsheets
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Creditos sheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        // Control de Debitos sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
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
        .mockResolvedValueOnce({ ok: true, value: null }) // Control de Creditos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Control de Debitos not found

      mockCreateSpreadsheet
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'new-control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'new-control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Creditos sheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        // Control de Debitos sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.controlCreditosId).toBe('new-control-creditos-id');
        expect(result.value.controlDebitosId).toBe('new-control-debitos-id');
      }

      expect(mockCreateSpreadsheet).toHaveBeenCalledTimes(2);
      expect(mockCreateSpreadsheet).toHaveBeenCalledWith('root-folder-id', 'Control de Creditos');
      expect(mockCreateSpreadsheet).toHaveBeenCalledWith('root-folder-id', 'Control de Debitos');
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
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Creditos sheets
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Emitidas', sheetId: 1 },
            { title: 'Pagos Recibidos', sheetId: 2 },
          ],
        })
        // Control de Debitos sheets
        .mockResolvedValueOnce({
          ok: true,
          value: [
            { title: 'Facturas Recibidas', sheetId: 1 },
            { title: 'Pagos Enviados', sheetId: 2 },
            { title: 'Recibos', sheetId: 3 },
          ],
        });

      // First call discovers (now only 4 findByName calls: Entrada, Sin Procesar, 2 spreadsheets)
      await discoverFolderStructure();
      expect(mockFindByName).toHaveBeenCalledTimes(4);

      // Second call uses cache
      const cached = getCachedFolderStructure();
      expect(cached).not.toBe(null);
      expect(cached?.entradaId).toBe('entrada-id');

      // Clear cache and verify it's gone
      clearFolderStructureCache();
      expect(getCachedFolderStructure()).toBe(null);
    });

    it('creates missing sheets in Control de Debitos spreadsheet', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - both spreadsheets have no sheets
      mockGetSheetMetadata.mockResolvedValue({ ok: true, value: [] });

      // Mock creating sheets (2 for Creditos + 3 for Debitos = 5 total)
      mockCreateSheet
        .mockResolvedValueOnce({ ok: true, value: 1 }) // Facturas Emitidas
        .mockResolvedValueOnce({ ok: true, value: 2 }) // Pagos Recibidos
        .mockResolvedValueOnce({ ok: true, value: 3 }) // Facturas Recibidas
        .mockResolvedValueOnce({ ok: true, value: 4 }) // Pagos Enviados
        .mockResolvedValueOnce({ ok: true, value: 5 }); // Recibos

      // Mock setting header values
      mockSetValues.mockResolvedValue({ ok: true, value: 23 });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify sheets were created for both spreadsheets
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('control-creditos-id');
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('control-debitos-id');
      expect(mockCreateSheet).toHaveBeenCalledTimes(5);
      expect(mockCreateSheet).toHaveBeenCalledWith('control-creditos-id', 'Facturas Emitidas');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-creditos-id', 'Pagos Recibidos');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-debitos-id', 'Facturas Recibidas');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-debitos-id', 'Pagos Enviados');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-debitos-id', 'Recibos');

      // Verify headers were set
      expect(mockSetValues).toHaveBeenCalledTimes(5);
    });

    it('does not create sheets that already exist', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - all sheets already exist for both spreadsheets
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
        });

      // Mock getValues for existing sheets with correct headers (starting with 'fileId')
      mockGetValues.mockResolvedValue({ ok: true, value: [['fileId', 'fileName', 'folderPath']] });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify sheets were NOT created (they already exist)
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('control-creditos-id');
      expect(mockGetSheetMetadata).toHaveBeenCalledWith('control-debitos-id');
      expect(mockCreateSheet).not.toHaveBeenCalled();
      expect(mockSetValues).not.toHaveBeenCalled();
    });

    it('creates only missing sheets when some exist', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - Control de Creditos has only Facturas Emitidas
      // Control de Debitos has only Facturas Recibidas
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Facturas Emitidas', sheetId: 1 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Facturas Recibidas', sheetId: 1 }],
        });

      // Mock getValues for existing sheets with correct headers (starting with 'fileId')
      mockGetValues.mockResolvedValue({ ok: true, value: [['fileId', 'fileName', 'folderPath']] });

      // Mock creating missing sheets (1 for Creditos + 2 for Debitos = 3)
      mockCreateSheet
        .mockResolvedValueOnce({ ok: true, value: 2 }) // Pagos Recibidos
        .mockResolvedValueOnce({ ok: true, value: 3 }) // Pagos Enviados
        .mockResolvedValueOnce({ ok: true, value: 4 }); // Recibos

      mockSetValues.mockResolvedValue({ ok: true, value: 17 });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify only missing sheets were created
      expect(mockCreateSheet).toHaveBeenCalledTimes(3);
      expect(mockCreateSheet).toHaveBeenCalledWith('control-creditos-id', 'Pagos Recibidos');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-debitos-id', 'Pagos Enviados');
      expect(mockCreateSheet).toHaveBeenCalledWith('control-debitos-id', 'Recibos');
      expect(mockCreateSheet).not.toHaveBeenCalledWith('control-creditos-id', 'Facturas Emitidas');
      expect(mockCreateSheet).not.toHaveBeenCalledWith('control-debitos-id', 'Facturas Recibidas');

      // Verify headers were set only for new sheets
      expect(mockSetValues).toHaveBeenCalledTimes(3);
    });

    it('handles sheet creation failure gracefully', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
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
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet metadata - newly created spreadsheet has only Sheet1
      mockGetSheetMetadata
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Sheet1', sheetId: 0 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [{ title: 'Sheet1', sheetId: 0 }],
        });

      // Mock creating sheets (2 for Creditos + 3 for Debitos = 5 total)
      mockCreateSheet
        .mockResolvedValueOnce({ ok: true, value: 1 }) // Facturas Emitidas
        .mockResolvedValueOnce({ ok: true, value: 2 }) // Pagos Recibidos
        .mockResolvedValueOnce({ ok: true, value: 3 }) // Facturas Recibidas
        .mockResolvedValueOnce({ ok: true, value: 4 }) // Pagos Enviados
        .mockResolvedValueOnce({ ok: true, value: 5 }); // Recibos

      // Mock setting header values
      mockSetValues.mockResolvedValue({ ok: true, value: 23 });

      // Mock getValues to return empty for Sheet1 (no headers)
      mockGetValues.mockResolvedValue({ ok: true, value: [[]] });

      // Mock deleteSheet to succeed
      mockDeleteSheet.mockResolvedValue({ ok: true, value: undefined });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify sheets were created for both spreadsheets
      expect(mockCreateSheet).toHaveBeenCalledTimes(5);

      // Verify Sheet1 was deleted from both spreadsheets
      expect(mockDeleteSheet).toHaveBeenCalledTimes(2);
      expect(mockDeleteSheet).toHaveBeenCalledWith('control-creditos-id', 0);
      expect(mockDeleteSheet).toHaveBeenCalledWith('control-debitos-id', 0);
    });

    it('does not delete Sheet1 if it has been converted to a custom sheet', async () => {
      // Mock finding root-level folders and spreadsheets
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
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
        });

      // Mock getValues for existing sheets with correct headers (starting with 'fileId')
      mockGetValues.mockResolvedValue({ ok: true, value: [['fileId', 'fileName', 'folderPath']] });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);

      // Verify Sheet1 was NOT deleted (it doesn't exist)
      expect(mockDeleteSheet).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateMonthFolder', () => {
    beforeEach(async () => {
      // Setup cached structure for year-based tests
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' } });
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'control-creditos-id', name: 'Control de Creditos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'control-debitos-id', name: 'Control de Debitos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      // Mock sheet operations for both spreadsheets (all sheets exist)
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
        });

      await discoverFolderStructure();
      vi.clearAllMocks();
    });

    it('creates year folder when first needed', async () => {
      // Mock: year folder doesn't exist, needs to be created
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // Year folder not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Creditos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }) // Debitos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }); // Month folder not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } }) // Year folder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-creditos-id', name: 'Creditos', mimeType: 'application/vnd.google-apps.folder' } }) // Creditos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-debitos-id', name: 'Debitos', mimeType: 'application/vnd.google-apps.folder' } }) // Debitos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } }) // Bancos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-01-creditos-id', name: '01 - Enero', mimeType: 'application/vnd.google-apps.folder' } }); // Month in creditos

      const result = await getOrCreateMonthFolder('creditos', new Date(2024, 0, 15));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('2024-01-creditos-id');
      }

      // Verify year folder was created in root
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', '2024');
      // Verify all classification folders were created in year
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Creditos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Debitos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Bancos');
      // Verify month folder was created in classification folder
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-creditos-id', '01 - Enero');
    });

    it('reuses existing year folder when it exists', async () => {
      // Mock: year folder exists
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } }) // Year found
        .mockResolvedValueOnce({ ok: true, value: null }) // Creditos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }) // Debitos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos folder not found in year
        .mockResolvedValueOnce({ ok: true, value: null }); // Month folder not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-creditos-id', name: 'Creditos', mimeType: 'application/vnd.google-apps.folder' } }) // Creditos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-debitos-id', name: 'Debitos', mimeType: 'application/vnd.google-apps.folder' } }) // Debitos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } }) // Bancos in year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-02-debitos-id', name: '02 - Febrero', mimeType: 'application/vnd.google-apps.folder' } }); // Month in debitos

      const result = await getOrCreateMonthFolder('debitos', new Date(2024, 1, 20));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('2024-02-debitos-id');
      }

      // Verify year folder was NOT created (already exists)
      expect(mockCreateFolder).not.toHaveBeenCalledWith('root-folder-id', '2024');
      // Verify classification folders were created in existing year
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Creditos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Debitos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Bancos');
      // Verify month folder was created
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-debitos-id', '02 - Febrero');
    });

    it('handles multiple years independently', async () => {
      // First request: 2024
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // 2024 not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Creditos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Debitos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Month not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-creditos-id', name: 'Creditos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-debitos-id', name: 'Debitos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-03-creditos-id', name: '03 - Marzo', mimeType: 'application/vnd.google-apps.folder' } });

      const result2024 = await getOrCreateMonthFolder('creditos', new Date(2024, 2, 15));
      expect(result2024.ok).toBe(true);

      vi.clearAllMocks();

      // Second request: 2025
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // 2025 not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Creditos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Debitos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Month not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-folder-id', name: '2025', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-creditos-id', name: 'Creditos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-debitos-id', name: 'Debitos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2025-03-creditos-id', name: '03 - Marzo', mimeType: 'application/vnd.google-apps.folder' } });

      const result2025 = await getOrCreateMonthFolder('creditos', new Date(2025, 2, 15));
      expect(result2025.ok).toBe(true);
      if (result2025.ok) {
        expect(result2025.value).toBe('2025-03-creditos-id');
      }

      // Verify both years were created
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', '2025');
    });

    it('creates all classification folders when year is first created', async () => {
      // Mock: year folder doesn't exist
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // Year not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Creditos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Debitos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Bancos not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } }) // Year
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-creditos-id', name: 'Creditos', mimeType: 'application/vnd.google-apps.folder' } }) // Creditos
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-debitos-id', name: 'Debitos', mimeType: 'application/vnd.google-apps.folder' } }) // Debitos
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } }); // Bancos

      const result = await getOrCreateMonthFolder('bancos', new Date(2024, 5, 10));

      expect(result.ok).toBe(true);

      // Verify year folder was created
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', '2024');
      // Verify all three classification folders were created
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Creditos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Debitos');
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-folder-id', 'Bancos');
    });

    it('caches year and classification folders for subsequent requests', async () => {
      // First request: create year and all classification folders
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // Year not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Creditos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Debitos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Bancos not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Month not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-creditos-id', name: 'Creditos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-debitos-id', name: 'Debitos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-01-creditos-id', name: '01 - Enero', mimeType: 'application/vnd.google-apps.folder' } });

      await getOrCreateMonthFolder('creditos', new Date(2024, 0, 15));

      vi.clearAllMocks();

      // Second request: same year, different month - should use cached year and classification folders
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }); // Only month folder not found

      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-02-creditos-id', name: '02 - Febrero', mimeType: 'application/vnd.google-apps.folder' } });

      const result = await getOrCreateMonthFolder('creditos', new Date(2024, 1, 20));

      expect(result.ok).toBe(true);

      // Should not create year or classification folders again (only month folder)
      expect(mockFindByName).toHaveBeenCalledTimes(1);
      expect(mockCreateFolder).toHaveBeenCalledTimes(1);
      expect(mockCreateFolder).toHaveBeenCalledWith('2024-creditos-id', '02 - Febrero');
    });

    it('returns bancos folder directly under year without month subfolder', async () => {
      // Mock: year folder exists, all classification folders exist
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-folder-id', name: '2024', mimeType: 'application/vnd.google-apps.folder' } }) // Year found
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-creditos-id', name: 'Creditos', mimeType: 'application/vnd.google-apps.folder' } }) // Creditos found
        .mockResolvedValueOnce({ ok: true, value: { id: '2024-debitos-id', name: 'Debitos', mimeType: 'application/vnd.google-apps.folder' } }) // Debitos found
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
