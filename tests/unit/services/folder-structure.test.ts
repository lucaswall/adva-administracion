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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('discoverFolderStructure', () => {
    it('discovers all required folders in root', async () => {
      // Mock finding all required folders
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'cobros-id', name: 'Cobros', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'pagos-id', name: 'Pagos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-cobros-id', name: 'Control de Cobros', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-pagos-id', name: 'Control de Pagos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      // Mock listing bank spreadsheets
      mockListByMimeType.mockResolvedValue({
        ok: true,
        value: [
          { id: 'bank1-id', name: 'BBVA Movimientos', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'bank2-id', name: 'Galicia Movimientos', mimeType: 'application/vnd.google-apps.spreadsheet' },
        ],
      });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rootId).toBe('root-folder-id');
        expect(result.value.entradaId).toBe('entrada-id');
        expect(result.value.cobrosId).toBe('cobros-id');
        expect(result.value.pagosId).toBe('pagos-id');
        expect(result.value.sinProcesarId).toBe('sin-procesar-id');
        expect(result.value.bancosId).toBe('bancos-id');
        expect(result.value.controlCobrosId).toBe('control-cobros-id');
        expect(result.value.controlPagosId).toBe('control-pagos-id');
        expect(result.value.bankSpreadsheets.get('BBVA Movimientos')).toBe('bank1-id');
        expect(result.value.bankSpreadsheets.get('Galicia Movimientos')).toBe('bank2-id');
      }
    });

    it('creates missing folders when they do not exist', async () => {
      // Mock: some folders exist, some don't
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: null }) // Entrada not found
        .mockResolvedValueOnce({ ok: true, value: { id: 'cobros-id', name: 'Cobros', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: null }) // Pagos not found
        .mockResolvedValueOnce({ ok: true, value: null }) // Sin Procesar not found
        .mockResolvedValueOnce({ ok: true, value: { id: 'bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-cobros-id', name: 'Control de Cobros', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-pagos-id', name: 'Control de Pagos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      // Mock creating folders
      mockCreateFolder
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-pagos-id', name: 'Pagos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } });

      // Mock listing bank spreadsheets
      mockListByMimeType.mockResolvedValue({ ok: true, value: [] });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entradaId).toBe('new-entrada-id');
        expect(result.value.pagosId).toBe('new-pagos-id');
        expect(result.value.sinProcesarId).toBe('new-sin-procesar-id');
      }

      expect(mockCreateFolder).toHaveBeenCalledTimes(3);
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', 'Entrada');
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', 'Pagos');
      expect(mockCreateFolder).toHaveBeenCalledWith('root-folder-id', 'Sin Procesar');
    });

    it('creates missing spreadsheets when they do not exist', async () => {
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'cobros-id', name: 'Cobros', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'pagos-id', name: 'Pagos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: null }) // Control de Cobros not found
        .mockResolvedValueOnce({ ok: true, value: null }); // Control de Pagos not found

      mockCreateSpreadsheet
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-control-cobros-id', name: 'Control de Cobros', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'new-control-pagos-id', name: 'Control de Pagos', mimeType: 'application/vnd.google-apps.spreadsheet' } });

      mockListByMimeType.mockResolvedValue({ ok: true, value: [] });

      const result = await discoverFolderStructure();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.controlCobrosId).toBe('new-control-cobros-id');
        expect(result.value.controlPagosId).toBe('new-control-pagos-id');
      }

      expect(mockCreateSpreadsheet).toHaveBeenCalledTimes(2);
      expect(mockCreateSpreadsheet).toHaveBeenCalledWith('root-folder-id', 'Control de Cobros');
      expect(mockCreateSpreadsheet).toHaveBeenCalledWith('root-folder-id', 'Control de Pagos');
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
        .mockResolvedValueOnce({ ok: true, value: { id: 'cobros-id', name: 'Cobros', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'pagos-id', name: 'Pagos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-cobros-id', name: 'Control de Cobros', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-pagos-id', name: 'Control de Pagos', mimeType: 'application/vnd.google-apps.spreadsheet' } });
      mockListByMimeType.mockResolvedValue({ ok: true, value: [] });

      // First call discovers
      await discoverFolderStructure();
      expect(mockFindByName).toHaveBeenCalledTimes(7);

      // Second call uses cache
      const cached = getCachedFolderStructure();
      expect(cached).not.toBe(null);
      expect(cached?.entradaId).toBe('entrada-id');

      // Clear cache and verify it's gone
      clearFolderStructureCache();
      expect(getCachedFolderStructure()).toBe(null);
    });
  });

  describe('getOrCreateMonthFolder', () => {
    beforeEach(async () => {
      // Setup cached structure
      mockFindByName
        .mockResolvedValueOnce({ ok: true, value: { id: 'entrada-id', name: 'Entrada', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'cobros-id', name: 'Cobros', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'pagos-id', name: 'Pagos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'sin-procesar-id', name: 'Sin Procesar', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'bancos-id', name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-cobros-id', name: 'Control de Cobros', mimeType: 'application/vnd.google-apps.spreadsheet' } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'control-pagos-id', name: 'Control de Pagos', mimeType: 'application/vnd.google-apps.spreadsheet' } });
      mockListByMimeType.mockResolvedValue({ ok: true, value: [] });

      await discoverFolderStructure();
      vi.clearAllMocks();
    });

    it('finds existing month folder in cobros', async () => {
      mockFindByName.mockResolvedValue({
        ok: true,
        value: { id: 'enero-folder-id', name: '01 - Enero', mimeType: 'application/vnd.google-apps.folder' },
      });

      // Use explicit local date to avoid timezone issues
      const result = await getOrCreateMonthFolder('cobros', new Date(2024, 0, 15));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('enero-folder-id');
      }

      expect(mockFindByName).toHaveBeenCalledWith(
        'cobros-id',
        '01 - Enero',
        'application/vnd.google-apps.folder'
      );
    });

    it('creates month folder when it does not exist', async () => {
      mockFindByName.mockResolvedValue({ ok: true, value: null });
      mockCreateFolder.mockResolvedValue({
        ok: true,
        value: { id: 'new-febrero-id', name: '02 - Febrero', mimeType: 'application/vnd.google-apps.folder' },
      });

      // Use explicit local date to avoid timezone issues
      const result = await getOrCreateMonthFolder('pagos', new Date(2024, 1, 20));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('new-febrero-id');
      }

      expect(mockCreateFolder).toHaveBeenCalledWith('pagos-id', '02 - Febrero');
    });

    it('caches month folder after creation', async () => {
      mockFindByName.mockResolvedValue({ ok: true, value: null });
      mockCreateFolder.mockResolvedValue({
        ok: true,
        value: { id: 'marzo-id', name: '03 - Marzo', mimeType: 'application/vnd.google-apps.folder' },
      });

      // Use explicit local dates to avoid timezone issues
      const marchDate1 = new Date(2024, 2, 1); // March 1, 2024 (months are 0-indexed)
      const marchDate2 = new Date(2024, 2, 15); // March 15, 2024

      // First call creates
      await getOrCreateMonthFolder('cobros', marchDate1);

      // Clear mocks to verify second call uses cache
      vi.clearAllMocks();

      // Second call should use cache
      const result = await getOrCreateMonthFolder('cobros', marchDate2);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('marzo-id');
      }

      // Should not have called findByName or createFolder
      expect(mockFindByName).not.toHaveBeenCalled();
      expect(mockCreateFolder).not.toHaveBeenCalled();
    });

    it('returns error when folder structure is not initialized', async () => {
      clearFolderStructureCache();

      const result = await getOrCreateMonthFolder('cobros', new Date(2024, 0, 15));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Folder structure not initialized');
      }
    });

    it('returns error when folder creation fails', async () => {
      mockFindByName.mockResolvedValue({ ok: true, value: null });
      mockCreateFolder.mockResolvedValue({ ok: false, error: new Error('Creation failed') });

      const result = await getOrCreateMonthFolder('cobros', new Date(2024, 3, 15));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Creation failed');
      }
    });

    it('handles all 12 months correctly', async () => {
      // Use explicit local dates to avoid timezone issues (months are 0-indexed)
      const months = [
        { date: new Date(2024, 0, 15), expected: '01 - Enero' },
        { date: new Date(2024, 1, 15), expected: '02 - Febrero' },
        { date: new Date(2024, 2, 15), expected: '03 - Marzo' },
        { date: new Date(2024, 3, 15), expected: '04 - Abril' },
        { date: new Date(2024, 4, 15), expected: '05 - Mayo' },
        { date: new Date(2024, 5, 15), expected: '06 - Junio' },
        { date: new Date(2024, 6, 15), expected: '07 - Julio' },
        { date: new Date(2024, 7, 15), expected: '08 - Agosto' },
        { date: new Date(2024, 8, 15), expected: '09 - Septiembre' },
        { date: new Date(2024, 9, 15), expected: '10 - Octubre' },
        { date: new Date(2024, 10, 15), expected: '11 - Noviembre' },
        { date: new Date(2024, 11, 15), expected: '12 - Diciembre' },
      ];

      for (const { date, expected } of months) {
        mockFindByName.mockResolvedValue({
          ok: true,
          value: { id: `${expected}-id`, name: expected, mimeType: 'application/vnd.google-apps.folder' },
        });

        const result = await getOrCreateMonthFolder('cobros', date);
        expect(result.ok).toBe(true);

        expect(mockFindByName).toHaveBeenLastCalledWith(
          'cobros-id',
          expected,
          'application/vnd.google-apps.folder'
        );
      }
    });
  });
});
