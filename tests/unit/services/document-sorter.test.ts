/**
 * Unit tests for document sorter service
 * Tests file movement to appropriate folders based on document type
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the drive module
const mockMoveFile = vi.fn();
const mockGetParents = vi.fn();
const mockRenameFile = vi.fn();

vi.mock('../../../src/services/drive.js', () => ({
  moveFile: (...args: unknown[]) => mockMoveFile(...args),
  getParents: (...args: unknown[]) => mockGetParents(...args),
  renameFile: (...args: unknown[]) => mockRenameFile(...args),
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
  sortAndRenameDocument,
} from '../../../src/services/document-sorter.js';
import type { Factura, Pago, Recibo, ResumenBancario, SortDestination, DocumentType } from '../../../src/types/index.js';

describe('DocumentSorter service', () => {
  const mockFolderStructure = {
    rootId: 'root-id',
    entradaId: 'entrada-id',
    ingresosId: 'ingresos-id',
    egresosId: 'egresos-id',
    sinProcesarId: 'sin-procesar-id',
    bancosId: 'bancos-id',
    controlIngresosId: 'control-ingresos-id',
    controlEgresosId: 'control-egresos-id',
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
    it('moves factura to ingresos month folder', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'factura.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
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

      const result = await sortDocument(factura, 'ingresos');

      expect(result.success).toBe(true);
      expect(result.targetFolderId).toBe('enero-folder-id');
      expect(result.targetPath).toBe('2024/Ingresos/01 - Enero');

      expect(mockGetOrCreateMonthFolder).toHaveBeenCalledWith('ingresos', expect.any(Date));
      expect(mockMoveFile).toHaveBeenCalledWith('file-123', 'entrada-id', 'enero-folder-id');
    });

    it('moves pago to egresos month folder', async () => {
      const pago: Pago = {
        fileId: 'pago-123',
        fileName: 'pago.pdf',
        banco: 'BBVA',
        fechaPago: '2024-06-20',
        importePagado: 5000,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.9,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'junio-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortDocument(pago, 'egresos');

      expect(result.success).toBe(true);
      expect(result.targetFolderId).toBe('junio-folder-id');
      expect(result.targetPath).toBe('2024/Egresos/06 - Junio');

      expect(mockGetOrCreateMonthFolder).toHaveBeenCalledWith('egresos', expect.any(Date));
      expect(mockMoveFile).toHaveBeenCalledWith('pago-123', 'entrada-id', 'junio-folder-id');
    });

    it('moves unmatched document to sin_procesar', async () => {
      const factura: Factura = {
        fileId: 'file-456',
        fileName: 'unmatched.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-03-10',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
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
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      const result = await sortDocument(factura, 'ingresos');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Folder structure not initialized');
    });

    it('returns error when getting parents fails', async () => {
      mockGetParents.mockResolvedValue({ ok: false, error: new Error('Failed to get parents') });

      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      const result = await sortDocument(factura, 'ingresos');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to get parents');
    });

    it('returns error when month folder creation fails', async () => {
      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: false, error: new Error('Folder creation failed') });

      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      const result = await sortDocument(factura, 'ingresos');

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
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      const result = await sortDocument(factura, 'ingresos');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Move failed');
    });

    it('handles file with multiple parents', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
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

      const result = await sortDocument(factura, 'ingresos');

      expect(result.success).toBe(true);
      // Should use first parent
      expect(mockMoveFile).toHaveBeenCalledWith('file-123', 'folder-a', 'enero-folder-id');
    });

    it('returns error when file has no parents', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'test.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
        importeNeto: 1000,
        importeIva: 210,
        importeTotal: 1210,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: [] });

      const result = await sortDocument(factura, 'ingresos');

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

  describe('sortAndRenameDocument', () => {
    it('renames factura emitida with proper format after moving', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'factura.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '30709076783', // ADVA
        razonSocialEmisor: 'ADVA SA',
        cuitReceptor: '20123456786',
        razonSocialReceptor: 'CLIENTE SA',
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
      mockRenameFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortAndRenameDocument(factura, 'ingresos', 'factura_emitida');

      expect(result.success).toBe(true);
      expect(mockMoveFile).toHaveBeenCalledWith('file-123', 'entrada-id', 'enero-folder-id');
      expect(mockRenameFile).toHaveBeenCalledWith(
        'file-123',
        '2024-01-15 - Factura Emitida - 00001-00001234 - CLIENTE SA.pdf'
      );
    });

    it('renames factura recibida with proper format after moving', async () => {
      const factura: Factura = {
        fileId: 'file-456',
        fileName: 'factura.pdf',
        tipoComprobante: 'A',
        nroFactura: '00002-00005678',
        fechaEmision: '2024-06-20',
        cuitEmisor: '27234567891',
        razonSocialEmisor: 'EMPRESA UNO SA',
        cuitReceptor: '30709076783', // ADVA
        importeNeto: 2000,
        importeIva: 420,
        importeTotal: 2420,
        moneda: 'ARS',
        processedAt: new Date().toISOString(),
        confidence: 0.92,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'junio-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });
      mockRenameFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortAndRenameDocument(factura, 'egresos', 'factura_recibida');

      expect(result.success).toBe(true);
      expect(mockRenameFile).toHaveBeenCalledWith(
        'file-456',
        '2024-06-20 - Factura Recibida - 00002-00005678 - EMPRESA UNO SA.pdf'
      );
    });

    it('renames pago enviado with proper format after moving', async () => {
      const pago: Pago = {
        fileId: 'pago-123',
        fileName: 'pago.pdf',
        banco: 'BBVA',
        fechaPago: '2024-06-20',
        importePagado: 5000.50,
        moneda: 'ARS',
        nombreBeneficiario: 'PROVEEDOR SA',
        processedAt: new Date().toISOString(),
        confidence: 0.9,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'junio-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });
      mockRenameFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortAndRenameDocument(pago, 'egresos', 'pago_enviado');

      expect(result.success).toBe(true);
      expect(mockRenameFile).toHaveBeenCalledWith(
        'pago-123',
        '2024-06-20 - Pago Enviado - PROVEEDOR SA.pdf'
      );
    });

    it('renames pago recibido with proper format after moving', async () => {
      const pago: Pago = {
        fileId: 'pago-456',
        fileName: 'pago.pdf',
        banco: 'Santander Rio',
        fechaPago: '2024-03-15',
        importePagado: 12345.67,
        moneda: 'ARS',
        nombrePagador: 'CLIENTE SA',
        processedAt: new Date().toISOString(),
        confidence: 0.88,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'marzo-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });
      mockRenameFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortAndRenameDocument(pago, 'ingresos', 'pago_recibido');

      expect(result.success).toBe(true);
      expect(mockRenameFile).toHaveBeenCalledWith(
        'pago-456',
        '2024-03-15 - Pago Recibido - CLIENTE SA.pdf'
      );
    });

    it('renames recibo with proper format after moving', async () => {
      const recibo: Recibo = {
        fileId: 'recibo-123',
        fileName: 'recibo.pdf',
        tipoRecibo: 'sueldo',
        nombreEmpleado: 'Juan Perez',
        cuilEmpleado: '20111111119',
        legajo: '001',
        cuitEmpleador: '30709076783',
        periodoAbonado: 'diciembre/2024',
        fechaPago: '2024-12-05',
        subtotalRemuneraciones: 150000,
        subtotalDescuentos: 30000,
        totalNeto: 120000,
        processedAt: new Date().toISOString(),
        confidence: 0.95,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockGetOrCreateMonthFolder.mockResolvedValue({ ok: true, value: 'diciembre-folder-id' });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });
      mockRenameFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortAndRenameDocument(recibo, 'egresos', 'recibo');

      expect(result.success).toBe(true);
      expect(mockRenameFile).toHaveBeenCalledWith(
        'recibo-123',
        '2024-12 - Recibo de Sueldo - Juan Perez.pdf'
      );
    });

    it('renames resumen bancario with proper format after moving', async () => {
      const resumen: ResumenBancario = {
        fileId: 'resumen-123',
        fileName: 'resumen.pdf',
        banco: 'BBVA',
        numeroCuenta: '1234567890',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        saldoInicial: 150000,
        saldoFinal: 185000,
        moneda: 'ARS',
        cantidadMovimientos: 47,
        processedAt: new Date().toISOString(),
        confidence: 0.9,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });
      mockRenameFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortAndRenameDocument(resumen, 'bancos', 'resumen_bancario');

      expect(result.success).toBe(true);
      expect(mockRenameFile).toHaveBeenCalledWith(
        'resumen-123',
        '2024-01-01 - Resumen - BBVA - 1234567890 ARS.pdf'
      );
    });

    it('renames resumen bancario USD with proper format', async () => {
      const resumen: ResumenBancario = {
        fileId: 'resumen-456',
        fileName: 'resumen.pdf',
        banco: 'BBVA',
        numeroCuenta: 'VISA',
        fechaDesde: '2024-02-01',
        fechaHasta: '2024-02-29',
        saldoInicial: 10000,
        saldoFinal: 12500,
        moneda: 'USD',
        cantidadMovimientos: 23,
        processedAt: new Date().toISOString(),
        confidence: 0.9,
        needsReview: false,
      };

      mockGetParents.mockResolvedValue({ ok: true, value: ['entrada-id'] });
      mockMoveFile.mockResolvedValue({ ok: true, value: undefined });
      mockRenameFile.mockResolvedValue({ ok: true, value: undefined });

      const result = await sortAndRenameDocument(resumen, 'bancos', 'resumen_bancario');

      expect(result.success).toBe(true);
      expect(mockRenameFile).toHaveBeenCalledWith(
        'resumen-456',
        '2024-02-01 - Resumen - BBVA - VISA USD.pdf'
      );
    });

    it('returns error when renaming fails', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'factura.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
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
      mockRenameFile.mockResolvedValue({ ok: false, error: new Error('Rename failed') });

      const result = await sortAndRenameDocument(factura, 'ingresos', 'factura_emitida');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Rename failed');
    });

    it('does not rename files moved to sin_procesar', async () => {
      const factura: Factura = {
        fileId: 'file-123',
        fileName: 'factura.pdf',
        tipoComprobante: 'A',
        nroFactura: '00001-00001234',
        fechaEmision: '2024-01-15',
        cuitEmisor: '20123456786',
        razonSocialEmisor: 'TEST SA',
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

      const result = await sortAndRenameDocument(factura, 'sin_procesar', 'factura_emitida');

      expect(result.success).toBe(true);
      expect(mockMoveFile).toHaveBeenCalled();
      expect(mockRenameFile).not.toHaveBeenCalled(); // Should not rename in sin_procesar
    });
  });
});
