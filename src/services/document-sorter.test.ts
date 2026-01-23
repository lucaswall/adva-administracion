/**
 * Tests for document sorter service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moveToDuplicadoFolder } from './document-sorter.js';

// Mock dependencies
vi.mock('./drive.js', () => ({
  moveFile: vi.fn(),
  getParents: vi.fn(),
  renameFile: vi.fn(),
}));

vi.mock('./folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(),
  getOrCreateMonthFolder: vi.fn(),
}));

import { moveFile, getParents } from './drive.js';
import { getCachedFolderStructure } from './folder-structure.js';

describe('moveToDuplicadoFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves file to Duplicado folder successfully', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue({
      rootId: 'root-id',
      entradaId: 'entrada-id',
      sinProcesarId: 'sin-procesar-id',
      duplicadoId: 'duplicado-id',
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      dashboardOperativoId: 'dashboard-id',
      bankSpreadsheets: new Map(),
      yearFolders: new Map(),
      classificationFolders: new Map(),
      monthFolders: new Map(),
      lastRefreshed: new Date(),
    });
    vi.mocked(getParents).mockResolvedValue({ ok: true, value: ['current-parent-id'] });
    vi.mocked(moveFile).mockResolvedValue({ ok: true, value: undefined });

    const result = await moveToDuplicadoFolder('test-file-id', 'test-file.pdf');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.targetFolderId).toBe('duplicado-id');
      expect(result.value.targetPath).toBe('Duplicado');
    }
    expect(moveFile).toHaveBeenCalledWith('test-file-id', 'current-parent-id', 'duplicado-id');
  });

  it('returns error when folder structure not initialized', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue(null);

    const result = await moveToDuplicadoFolder('test-file-id', 'test-file.pdf');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Folder structure not initialized');
    }
  });

  it('returns error when duplicadoId is missing', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue({
      rootId: 'root-id',
      entradaId: 'entrada-id',
      sinProcesarId: 'sin-procesar-id',
      duplicadoId: '', // Empty duplicadoId
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      dashboardOperativoId: 'dashboard-id',
      bankSpreadsheets: new Map(),
      yearFolders: new Map(),
      classificationFolders: new Map(),
      monthFolders: new Map(),
      lastRefreshed: new Date(),
    });

    const result = await moveToDuplicadoFolder('test-file-id', 'test-file.pdf');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Duplicado folder not found');
    }
  });

  it('returns error when getParents fails', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue({
      rootId: 'root-id',
      entradaId: 'entrada-id',
      sinProcesarId: 'sin-procesar-id',
      duplicadoId: 'duplicado-id',
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      dashboardOperativoId: 'dashboard-id',
      bankSpreadsheets: new Map(),
      yearFolders: new Map(),
      classificationFolders: new Map(),
      monthFolders: new Map(),
      lastRefreshed: new Date(),
    });
    vi.mocked(getParents).mockResolvedValue({ ok: false, error: new Error('API error') });

    const result = await moveToDuplicadoFolder('test-file-id', 'test-file.pdf');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API error');
    }
  });

  it('returns error when file has no parent folder', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue({
      rootId: 'root-id',
      entradaId: 'entrada-id',
      sinProcesarId: 'sin-procesar-id',
      duplicadoId: 'duplicado-id',
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      dashboardOperativoId: 'dashboard-id',
      bankSpreadsheets: new Map(),
      yearFolders: new Map(),
      classificationFolders: new Map(),
      monthFolders: new Map(),
      lastRefreshed: new Date(),
    });
    vi.mocked(getParents).mockResolvedValue({ ok: true, value: [] });

    const result = await moveToDuplicadoFolder('test-file-id', 'test-file.pdf');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('has no parent folder');
    }
  });

  it('returns error when moveFile fails', async () => {
    vi.mocked(getCachedFolderStructure).mockReturnValue({
      rootId: 'root-id',
      entradaId: 'entrada-id',
      sinProcesarId: 'sin-procesar-id',
      duplicadoId: 'duplicado-id',
      controlIngresosId: 'ingresos-id',
      controlEgresosId: 'egresos-id',
      dashboardOperativoId: 'dashboard-id',
      bankSpreadsheets: new Map(),
      yearFolders: new Map(),
      classificationFolders: new Map(),
      monthFolders: new Map(),
      lastRefreshed: new Date(),
    });
    vi.mocked(getParents).mockResolvedValue({ ok: true, value: ['current-parent-id'] });
    vi.mocked(moveFile).mockResolvedValue({ ok: false, error: new Error('Move failed') });

    const result = await moveToDuplicadoFolder('test-file-id', 'test-file.pdf');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Move failed');
    }
  });
});
