/**
 * Unit tests for document sorter service
 * Tests file movement to appropriate folders based on document type
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the drive module
const mockMoveFile = vi.fn();
const mockGetParents = vi.fn();

vi.mock('../../../src/services/drive.js', () => ({
  moveFile: (...args: unknown[]) => mockMoveFile(...args),
  getParents: (...args: unknown[]) => mockGetParents(...args),
  clearDriveCache: vi.fn(),
}));

// Mock the folder-structure module
const mockGetOrCreateMonthFolder = vi.fn();
const mockGetCachedFolderStructure = vi.fn();

vi.mock('../../../src/services/folder-structure.js', () => ({
  getOrCreateMonthFolder: (...args: unknown[]) => mockGetOrCreateMonthFolder(...args),
  getCachedFolderStructure: () => mockGetCachedFolderStructure(),
  clearFolderStructureCache: vi.fn(),
}));

import {
  sortDocument,
  sortToSinProcesar,
} from '../../../src/services/document-sorter.js';
import type { Factura, Pago, SortDestination } from '../../../src/types/index.js';

describe('DocumentSorter service', () => {
  const mockFolderStructure = {
    rootId: 'root-id',
    entradaId: 'entrada-id',
    cobrosId: 'cobros-id',
    pagosId: 'pagos-id',
    sinProcesarId: 'sin-procesar-id',
    bancosId: 'bancos-id',
    controlCobrosId: 'control-cobros-id',
    controlPagosId: 'control-pagos-id',
    bankSpreadsheets: new Map(),
    monthFolders: new Map(),
    lastRefreshed: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedFolderStructure.mockReturnValue(mockFolderStructure);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sortDocument', () => {
    it('moves factura to cobros month folder', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'factura.pdf',
        folderPath: '',
        tipoComprobante: 'A',
        puntoVenta: '00001',
        numeroComprobante: '00001234',
        fechaEmision: '2024-01-15',
        fechaVtoCae: '2024-01-25',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cae: '12345678901234',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'enero-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortDocument(factura, 'cobros');

      expect(result.success).toBe(true);
      expect(result.targetFolderId).toBe('enero-folder-id');
      expect(result.targetPath).toBe('Cobros/01 - Enero');

      expect(mockGetOrCreateMonthFolder).toHaveBeenCalledWith('cobros', expect.any(Date));
      expect(mockMoveFile).toHaveBeenCalledWith('file-123', 'entrada-id', 'enero-folder-id');
    });

    it('moves pago to pagos month folder', async () => {
      const pago: Pago = {
        fileId: 'pago-123',
        fileName: 'pago.pdf',
        folderPath: '',
        banco: 'BBVA',
        fechaPago: '2024-06-20',
        importePagado: 5000,
        processedAt: new Date().toISOString(),
        confidence: 0.9,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'junio-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortDocument(pago, 'pagos');

      expect(result.success).toBe(true);
      expect(result.targetFolderId).toBe('junio-folder-id');
      expect(result.targetPath).toBe('Pagos/06 - Junio');

      expect(mockGetOrCreateMonthFolder).toHaveBeenCalledWith('pagos', expect.any(Date));
      expect(mockMoveFile).toHaveBeenCalledWith('pago-123', 'entrada-id', 'junio-folder-id');
    });

    it('moves unmatched document to sin_procesar', async () => {
      const factura: Factura = {
        fileId: 'file-456',
        fileName: 'unmatched.pdf',
        folderPath: '',
        tipoComprobante: 'A',
        puntoVenta: '00001',
        numeroComprobante: '00001234',
        fechaEmision: '2024-03-10',
        fechaVtoCae: '2024-03-20',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cae: '12345678901234',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortDocument(factura, 'sin_procesar');

      expect(result.success).toBe(true);
      expect(result.targetFolderId).toBe('sin-procesar-id');
      expect(result.targetPath).toBe('Sin Procesar');

      expect(mockGetOrCreateMonthFolder).not.toHaveBeenCalled();
      expect(mockMoveFile).toHaveBeenCalledWith('file-456', 'entrada-id', 'sin-procesar-id');
    });

    it('returns error when folder structure is not initialized', async () => {
      mockGetCachedFolderStructure.mockReturnValue(null);

      const factura: Factura = {
        fileId: 'file-789',
        fileName: 'test.pdf',
        folderPath: '',
        tipoComprobante: 'A',
        puntoVenta: '00001',
        numeroComprobante: '00001234',
        fechaEmision: '2024-01-15',
        fechaVtoCae: '2024-01-25',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cae: '12345678901234',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      const result = await sortDocument(factura, 'cobros');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Folder structure not initialized');
    });

    it('returns error when getting parents fails', async () => {
      mockGetParents.mockResolvedValue({ ok: false, error: new Error('Failed to get parents') });

      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        folderPath: '',
        tipoComprobante: 'A',
        puntoVenta: '00001',
        numeroComprobante: '00001234',
        fechaEmision: '2024-01-15',
        fechaVtoCae: '2024-01-25',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cae: '12345678901234',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      const result = await sortDocument(factura, 'cobros');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to get parents');
    });

    it('returns error when month folder creation fails', async () => {
      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: false, error: new Error('Folder creation failed') });

      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        folderPath: '',
        tipoComprobante: 'A',
        puntoVenta: '00001',
        numeroComprobante: '00001234',
        fechaEmision: '2024-01-15',
        fechaVtoCae: '2024-01-25',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cae: '12345678901234',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      const result = await sortDocument(factura, 'cobros');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Folder creation failed');
    });

    it('returns error when move fails', async () => {
      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'enero-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: false, error: new Error('Move failed') });

      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        folderPath: '',
        tipoComprobante: 'A',
        puntoVenta: '00001',
        numeroComprobante: '00001234',
        fechaEmision: '2024-01-15',
        fechaVtoCae: '2024-01-25',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cae: '12345678901234',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      const result = await sortDocument(factura, 'cobros');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Move failed');
    });

    it('handles file with multiple parents', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        folderPath: '',
        tipoComprobante: 'A',
        puntoVenta: '00001',
        numeroComprobante: '00001234',
        fechaEmision: '2024-01-15',
        fechaVtoCae: '2024-01-25',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cae: '12345678901234',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      // File has multiple parents (unusual but possible in Drive)
      mockGetParents.mockResolvedValue({ ok: true, value: ['folder-a', 'folder-b'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'enero-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortDocument(factura, 'cobros');

      expect(result.success).toBe(true);
      // Should use first parent
      expect(mockMoveFile).toHaveBeenCalledWith('file-123', 'folder-a', 'enero-folder-id');
    });

    it('returns error when file has no parents', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        folderPath: '',
        tipoComprobante: 'A',
        puntoVenta: '00001',
        numeroComprobante: '00001234',
        fechaEmision: '2024-01-15',
        fechaVtoCae: '2024-01-25',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        cae: '12345678901234',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: [] });

      const result = await sortDocument(factura, 'cobros');

      expect(result.success).toBe(false);
      expect(result.error).toContain('no parent folder');
    });
  });

  describe('sortToSinProcesar', () => {
    it('moves file directly to sin procesar folder', async () => {
      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortToSinProcesar('file-error', 'error.pdf');

      expect(result.success).toBe(true);
      expect(result.targetFolderId).toBe('sin-procesar-id');
      expect(result.targetPath).toBe('Sin Procesar');

      expect(mockMoveFile).toHaveBeenCalledWith('file-error', 'entrada-id', 'sin-procesar-id');
    });

    it('returns error when folder structure is not initialized', async () => {
      mockGetCachedFolderStructure.mockReturnValue(null);

      const result = await sortToSinProcesar('file-error', 'error.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Folder structure not initialized');
    });

    it('returns error when move fails', async () => {
      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockMoveFile.mockResolvedValue({ ok: false, error: new Error('Move failed') });

      const result = await sortToSinProcesar('file-error', 'error.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Move failed');
    });
  });
});
