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
      movimientosSpreadsheets: new Map(),
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
      movimientosSpreadsheets: new Map(),
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
      movimientosSpreadsheets: new Map(),
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
      movimientosSpreadsheets: new Map(),
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
      movimientosSpreadsheets: new Map(),
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
  it('returns ok:true with Date for factura with YYYY-MM-DD fechaEmision', () => {
    const factura: Partial<Factura> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaEmision: '2025-11-01',
    };
    const result = getDocumentDate(factura as Factura);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.getUTCFullYear()).toBe(2025);
      expect(result.value.getUTCMonth()).toBe(10); // November = 10
      expect(result.value.getUTCDate()).toBe(1);
    }
  });

  it('returns ok:true with Date for factura with DD/MM/YYYY fechaEmision (parseArgDate handles it)', () => {
    const factura: Partial<Factura> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaEmision: '01/11/2025',
    };
    const result = getDocumentDate(factura as Factura);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.getUTCFullYear()).toBe(2025);
      expect(result.value.getUTCMonth()).toBe(10); // November = 10
      expect(result.value.getUTCDate()).toBe(1);
    }
  });

  it('returns ok:true with Date for pago with valid fechaPago', () => {
    const pago: Partial<Pago> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaPago: '2025-12-15',
    };
    const result = getDocumentDate(pago as Pago);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.getUTCFullYear()).toBe(2025);
      expect(result.value.getUTCMonth()).toBe(11); // December = 11
      expect(result.value.getUTCDate()).toBe(15);
    }
  });

  it('returns ok:true with Date for recibo with valid fechaPago', () => {
    const recibo: Partial<Recibo> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaPago: '2025-11-30',
    };
    const result = getDocumentDate(recibo as Recibo);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.getUTCFullYear()).toBe(2025);
      expect(result.value.getUTCMonth()).toBe(10); // November = 10
      expect(result.value.getUTCDate()).toBe(30);
    }
  });

  it('returns ok:true with Date for resumen with valid fechaHasta', () => {
    const resumen: Partial<ResumenBancario> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaDesde: '2025-11-01',
      fechaHasta: '2025-11-30',
    };
    const result = getDocumentDate(resumen as ResumenBancario);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.getUTCFullYear()).toBe(2025);
      expect(result.value.getUTCMonth()).toBe(10); // November = 10
      expect(result.value.getUTCDate()).toBe(30);
    }
  });

  it('returns ok:false for document with no date field', () => {
    const factura: Partial<Factura> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      // No fechaEmision
    };
    const result = getDocumentDate(factura as Factura);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('no valid date field');
    }
  });

  it('returns ok:false for document with invalid date format', () => {
    const factura: Partial<Factura> = {
      fileId: 'test-id',
      fileName: 'test.pdf',
      fechaEmision: 'invalid-date',
    };
    const result = getDocumentDate(factura as Factura);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid date format');
    }
  });
});
