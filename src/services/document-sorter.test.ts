/**
 * Tests for document sorter service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moveToDuplicadoFolder, getDocumentDate } from './document-sorter.js';
import type { Factura, Pago, Recibo, ResumenBancario } from '../types/index.js';

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
      bankAccountFolders: new Map(),
      bankAccountSpreadsheets: new Map(),
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
      bankAccountFolders: new Map(),
      bankAccountSpreadsheets: new Map(),
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
      bankAccountFolders: new Map(),
      bankAccountSpreadsheets: new Map(),
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
      bankAccountFolders: new Map(),
      bankAccountSpreadsheets: new Map(),
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
      bankAccountFolders: new Map(),
      bankAccountSpreadsheets: new Map(),
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

describe('getDocumentDate', () => {
  it('extracts date from factura with YYYY-MM-DD fechaEmision', () => {
    const factura: Partial<Factura> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaEmision: '2025-11-01',
    };
    const date = getDocumentDate(factura as Factura);
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(10); // November = 10
    expect(date.getUTCDate()).toBe(1);
  });

  it('extracts date from factura with DD/MM/YYYY fechaEmision (parseArgDate handles it)', () => {
    const factura: Partial<Factura> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaEmision: '01/11/2025',
    };
    const date = getDocumentDate(factura as Factura);
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(10); // November = 10
    expect(date.getUTCDate()).toBe(1);
  });

  it('extracts date from pago with valid fechaPago', () => {
    const pago: Partial<Pago> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaPago: '2025-12-15',
    };
    const date = getDocumentDate(pago as Pago);
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(11); // December = 11
    expect(date.getUTCDate()).toBe(15);
  });

  it('extracts date from recibo with valid fechaPago', () => {
    const recibo: Partial<Recibo> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaPago: '2025-11-30',
    };
    const date = getDocumentDate(recibo as Recibo);
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(10); // November = 10
    expect(date.getUTCDate()).toBe(30);
  });

  it('extracts date from resumen with valid fechaHasta', () => {
    const resumen: Partial<ResumenBancario> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaDesde: '2025-11-01',
      fechaHasta: '2025-11-30',
    };
    const date = getDocumentDate(resumen as ResumenBancario);
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(10); // November = 10
    expect(date.getUTCDate()).toBe(30);
  });

  it('throws error for document with invalid date', () => {
    const factura: Partial<Factura> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaEmision: 'invalid-date',
    };
    expect(() => getDocumentDate(factura as Factura)).toThrow();
  });
});
