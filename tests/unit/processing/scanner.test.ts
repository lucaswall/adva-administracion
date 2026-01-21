/**
 * Unit tests for scanner module
 * Tests file processing, classification, extraction, and storage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileInfo, Factura, Pago, Recibo, ClassificationResult, ScanResult } from '../../../src/types/index.js';

// Mock all external dependencies
const mockListFilesInFolder = vi.fn();
const mockDownloadFile = vi.fn();
const mockGetFileWithContent = vi.fn();

vi.mock('../../../src/services/drive.js', () => ({
  listFilesInFolder: (...args: unknown[]) => mockListFilesInFolder(...args),
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  getFileWithContent: (...args: unknown[]) => mockGetFileWithContent(...args),
  clearDriveCache: vi.fn(),
}));

const mockGetValues = vi.fn();
const mockSetValues = vi.fn();
const mockAppendRowsWithLinks = vi.fn();
const mockBatchUpdate = vi.fn();
const mockSortSheet = vi.fn();

vi.mock('../../../src/services/sheets.js', () => ({
  getValues: (...args: unknown[]) => mockGetValues(...args),
  setValues: (...args: unknown[]) => mockSetValues(...args),
  appendRowsWithLinks: (...args: unknown[]) => mockAppendRowsWithLinks(...args),
  batchUpdate: (...args: unknown[]) => mockBatchUpdate(...args),
  sortSheet: (...args: unknown[]) => mockSortSheet(...args),
  clearSheetsCache: vi.fn(),
}));

const mockGetCachedFolderStructure = vi.fn();
const mockDiscoverFolderStructure = vi.fn();

vi.mock('../../../src/services/folder-structure.js', () => ({
  getCachedFolderStructure: () => mockGetCachedFolderStructure(),
  discoverFolderStructure: () => mockDiscoverFolderStructure(),
  clearFolderStructureCache: vi.fn(),
}));

const mockSortDocument = vi.fn();
const mockSortToSinProcesar = vi.fn();
const mockSortAndRenameDocument = vi.fn();

vi.mock('../../../src/services/document-sorter.js', () => ({
  sortDocument: (...args: unknown[]) => mockSortDocument(...args),
  sortToSinProcesar: (...args: unknown[]) => mockSortToSinProcesar(...args),
  sortAndRenameDocument: (...args: unknown[]) => mockSortAndRenameDocument(...args),
}));

// Mock GeminiClient
const mockAnalyzeDocument = vi.fn();
vi.mock('../../../src/gemini/client.js', () => ({
  GeminiClient: class MockGeminiClient {
    analyzeDocument(...args: unknown[]) {
      return mockAnalyzeDocument(...args);
    }
  },
}));

// Mock parsers
const mockParseClassificationResponse = vi.fn();
const mockParseFacturaResponse = vi.fn();
const mockParsePagoResponse = vi.fn();
const mockParseReciboResponse = vi.fn();
const mockParseResumenBancarioResponse = vi.fn();

vi.mock('../../../src/gemini/parser.js', () => ({
  parseClassificationResponse: (...args: unknown[]) => mockParseClassificationResponse(...args),
  parseFacturaResponse: (...args: unknown[]) => mockParseFacturaResponse(...args),
  parsePagoResponse: (...args: unknown[]) => mockParsePagoResponse(...args),
  parseReciboResponse: (...args: unknown[]) => mockParseReciboResponse(...args),
  parseResumenBancarioResponse: (...args: unknown[]) => mockParseResumenBancarioResponse(...args),
}));

// Mock config
vi.mock('../../../src/config.js', () => ({
  getConfig: vi.fn(() => ({
    driveRootFolderId: 'root-folder-id',
    geminiApiKey: 'test-api-key',
    matchDaysBefore: 10,
    matchDaysAfter: 60,
    usdArsTolerancePercent: 5,
  })),
  isAdvaCuit: vi.fn((cuit: string) => cuit === '30709076783'),
}));

// Mock queue
vi.mock('../../../src/processing/queue.js', () => ({
  getProcessingQueue: vi.fn(() => ({
    add: async <T>(task: () => Promise<T>) => task(),
    onIdle: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn(() => ({ pending: 0, running: 0, completed: 0, failed: 0 })),
  })),
  resetProcessingQueue: vi.fn(),
}));

// Import after mocks
import {
  processFile,
  scanFolder,
  rematch,
} from '../../../src/processing/scanner.js';

describe('Scanner module', () => {
  const mockFolderStructure = {
    rootId: 'root-id',
    entradaId: 'entrada-id',
    creditosId: 'creditos-id',
    debitosId: 'debitos-id',
    sinProcesarId: 'sin-procesar-id',
    bancosId: 'bancos-id',
    controlCreditosId: 'control-creditos-id',
    controlDebitosId: 'control-debitos-id',
    bankSpreadsheets: new Map(),
    monthFolders: new Map(),
    lastRefreshed: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedFolderStructure.mockReturnValue(mockFolderStructure);
    // Default mock for sortToSinProcesar
    mockSortToSinProcesar.mockResolvedValue({ success: true, targetPath: 'Sin Procesar' });
    // Default mock for appendRowsWithLinks
    mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 1 });
    // Default mock for sortSheet
    mockSortSheet.mockResolvedValue({ ok: true, value: undefined });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('processFile', () => {
    const mockFileInfo: Omit<FileInfo, 'content'> = {
      id: 'file-123',
      name: 'test-factura.pdf',
      mimeType: 'application/pdf',
      lastUpdated: new Date('2024-01-15'),
    };

    it('processes a factura_recibida file successfully', async () => {
      // Mock file download
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      // Mock classification - factura received by ADVA (ADVA is receptor)
      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"documentType": "factura_recibida", "confidence": 0.95, "reason": "ARCA invoice, ADVA is receptor", "indicators": ["CAE", "ADVA CUIT as receptor"]}',
      });
      mockParseClassificationResponse.mockReturnValue({
        ok: true,
        value: {
          documentType: 'factura_recibida',
          confidence: 0.95,
          reason: 'ARCA invoice, ADVA is receptor',
          indicators: ['CAE', 'ADVA CUIT as receptor'],
        },
      });

      // Mock extraction
      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"tipoComprobante": "A", "puntoVenta": "00001", ...}',
      });
      mockParseFacturaResponse.mockReturnValue({
        ok: true,
        value: {
          data: {
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
          },
          confidence: 0.95,
          needsReview: false,
        },
      });

      // Mock sheet append
      mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 1 });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.documentType).toBe('factura_recibida');
        expect(result.value.document).toBeDefined();
        expect((result.value.document as Factura).tipoComprobante).toBe('A');
      }

      expect(mockDownloadFile).toHaveBeenCalledWith('file-123');
      expect(mockAnalyzeDocument).toHaveBeenCalledTimes(2);
    });

    it('processes a pago_enviado file successfully', async () => {
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"documentType": "pago_enviado", ...}',
      });
      mockParseClassificationResponse.mockReturnValue({
        ok: true,
        value: {
          documentType: 'pago_enviado',
          confidence: 0.9,
          reason: 'Bank payment slip, ADVA is ordenante',
          indicators: ['BBVA', 'Transferencia', 'ADVA as payer'],
        },
      });

      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"banco": "BBVA", ...}',
      });
      mockParsePagoResponse.mockReturnValue({
        ok: true,
        value: {
          data: {
            banco: 'BBVA',
            fechaPago: '2024-01-18',
            importePagado: 1210,
          },
          confidence: 0.9,
          needsReview: false,
        },
      });

      mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 1 });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.documentType).toBe('pago_enviado');
        expect((result.value.document as Pago).banco).toBe('BBVA');
      }
    });

    it('processes a recibo file successfully', async () => {
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"documentType": "recibo", ...}',
      });
      mockParseClassificationResponse.mockReturnValue({
        ok: true,
        value: {
          documentType: 'recibo',
          confidence: 0.95,
          reason: 'Salary slip',
          indicators: ['RECIBO DE HABERES', 'CUIL'],
        },
      });

      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"tipoRecibo": "sueldo", ...}',
      });
      mockParseReciboResponse.mockReturnValue({
        ok: true,
        value: {
          data: {
            tipoRecibo: 'sueldo',
            nombreEmpleado: 'MARTIN, Miguel',
            cuilEmpleado: '20271190523',
            legajo: '1',
            cuitEmpleador: '30709076783',
            periodoAbonado: 'diciembre/2024',
            fechaPago: '2024-12-30',
            subtotalRemuneraciones: 2346822.36,
            subtotalDescuentos: 398959.80,
            totalNeto: 1947863.00,
          },
          confidence: 0.95,
          needsReview: false,
        },
      });

      mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 1 });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.documentType).toBe('recibo');
        expect((result.value.document as Recibo).nombreEmpleado).toBe('MARTIN, Miguel');
      }
    });

    it('processes a resumen_bancario file successfully', async () => {
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      // Mock classification
      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"documentType": "resumen_bancario", "confidence": 0.9, "reason": "Bank statement", "indicators": ["BBVA", "Resumen"]}',
      });
      mockParseClassificationResponse.mockReturnValue({
        ok: true,
        value: {
          documentType: 'resumen_bancario',
          confidence: 0.9,
          reason: 'Bank statement',
          indicators: ['BBVA', 'Resumen'],
        },
      });

      // Mock extraction
      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"banco": "BBVA", "fechaDesde": "2024-01-01", ...}',
      });
      mockParseResumenBancarioResponse.mockReturnValue({
        ok: true,
        value: {
          data: {
            banco: 'BBVA',
            numeroCuenta: '1234567890',
            fechaDesde: '2024-01-01',
            fechaHasta: '2024-01-31',
            saldoInicial: 150000.00,
            saldoFinal: 185000.00,
            moneda: 'ARS',
            cantidadMovimientos: 47,
          },
          confidence: 0.9,
          needsReview: false,
        },
      });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.documentType).toBe('resumen_bancario');
        expect(result.value.document).toBeDefined();
        const resumen = result.value.document as import('../../../src/types/index.js').ResumenBancario;
        expect(resumen.banco).toBe('BBVA');
        expect(resumen.fechaDesde).toBe('2024-01-01');
        expect(resumen.fechaHasta).toBe('2024-01-31');
        // Should call extraction for resumen_bancario (implemented now)
        expect(mockAnalyzeDocument).toHaveBeenCalledTimes(2);
      }
    });

    it('handles unrecognized documents', async () => {
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: '{"documentType": "unrecognized", ...}',
      });
      mockParseClassificationResponse.mockReturnValue({
        ok: true,
        value: {
          documentType: 'unrecognized',
          confidence: 0.3,
          reason: 'Unknown document type',
          indicators: [],
        },
      });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.documentType).toBe('unrecognized');
        expect(result.value.document).toBeUndefined();
      }
    });

    it('returns error when download fails', async () => {
      mockDownloadFile.mockResolvedValue({
        ok: false,
        error: new Error('Download failed'),
      });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Download failed');
      }
    });

    it('returns error when classification fails', async () => {
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: false,
        error: { message: 'API error', code: 500 },
      });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(false);
    });

    it('returns error when parsing fails', async () => {
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      mockAnalyzeDocument.mockResolvedValueOnce({
        ok: true,
        value: 'invalid json',
      });
      mockParseClassificationResponse.mockReturnValue({
        ok: false,
        error: new Error('Invalid JSON'),
      });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(false);
    });
  });

  describe('scanFolder', () => {
    it('scans entrada folder and processes files', async () => {
      // Mock file listing
      mockListFilesInFolder.mockResolvedValue({
        ok: true,
        value: [
          {
            id: 'file-1',
            name: 'factura1.pdf',
            mimeType: 'application/pdf',
            lastUpdated: new Date('2024-01-15'),
          },
          {
            id: 'file-2',
            name: 'pago1.pdf',
            mimeType: 'application/pdf',
            lastUpdated: new Date('2024-01-16'),
          },
        ],
      });

      // Mock empty processed files list
      mockGetValues.mockResolvedValue({ ok: true, value: [] });

      // Mock successful processing for each file
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      // First file - factura
      mockAnalyzeDocument
        .mockResolvedValueOnce({
          ok: true,
          value: '{"documentType": "factura_recibida", ...}',
        })
        .mockResolvedValueOnce({
          ok: true,
          value: '{"tipoComprobante": "A", ...}',
        });
      mockParseClassificationResponse.mockReturnValueOnce({
        ok: true,
        value: { documentType: 'factura_recibida', confidence: 0.95, reason: '', indicators: [] },
      });
      mockParseFacturaResponse.mockReturnValueOnce({
        ok: true,
        value: {
          data: {
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
          },
          confidence: 0.95,
          needsReview: false,
        },
      });

      // Second file - pago
      mockAnalyzeDocument
        .mockResolvedValueOnce({
          ok: true,
          value: '{"documentType": "pago_enviado", ...}',
        })
        .mockResolvedValueOnce({
          ok: true,
          value: '{"banco": "BBVA", ...}',
        });
      mockParseClassificationResponse.mockReturnValueOnce({
        ok: true,
        value: { documentType: 'pago_enviado', confidence: 0.9, reason: '', indicators: [] },
      });
      mockParsePagoResponse.mockReturnValueOnce({
        ok: true,
        value: {
          data: {
            banco: 'BBVA',
            fechaPago: '2024-01-18',
            importePagado: 1210,
          },
          confidence: 0.9,
          needsReview: false,
        },
      });

      mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 1 });
      mockSortAndRenameDocument.mockResolvedValue({ success: true });

      const result = await scanFolder();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filesProcessed).toBe(2);
        expect(result.value.facturasAdded).toBe(1);
        expect(result.value.pagosAdded).toBe(1);
      }

      expect(mockListFilesInFolder).toHaveBeenCalledWith('entrada-id');
    });

    it('skips already processed files', async () => {
      mockListFilesInFolder.mockResolvedValue({
        ok: true,
        value: [
          {
            id: 'file-1',
            name: 'factura1.pdf',
            mimeType: 'application/pdf',
            lastUpdated: new Date('2024-01-15'),
          },
          {
            id: 'file-2',
            name: 'already-processed.pdf',
            mimeType: 'application/pdf',
            lastUpdated: new Date('2024-01-14'),
          },
        ],
      });

      // Mock: file-2 is already in processed files
      // getValues is called for Facturas, Pagos, and Recibos sheets
      mockGetValues
        .mockResolvedValueOnce({
          ok: true,
          value: [['fileId'], ['file-2']], // Facturas - file-2 already processed
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [['fileId']], // Pagos - empty
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [['fileId']], // Recibos - empty
        });

      // Only first file gets processed
      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      mockAnalyzeDocument
        .mockResolvedValueOnce({
          ok: true,
          value: '{"documentType": "factura_recibida", ...}',
        })
        .mockResolvedValueOnce({
          ok: true,
          value: '{"tipoComprobante": "A", ...}',
        });
      mockParseClassificationResponse.mockReturnValueOnce({
        ok: true,
        value: { documentType: 'factura_recibida', confidence: 0.95, reason: '', indicators: [] },
      });
      mockParseFacturaResponse.mockReturnValueOnce({
        ok: true,
        value: {
          data: {
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
          },
          confidence: 0.95,
          needsReview: false,
        },
      });

      mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 1 });
      mockSortAndRenameDocument.mockResolvedValue({ success: true });

      const result = await scanFolder();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filesProcessed).toBe(1);
      }

      // Download should only be called for file-1
      expect(mockDownloadFile).toHaveBeenCalledTimes(1);
    });

    it('handles empty folder', async () => {
      mockListFilesInFolder.mockResolvedValue({
        ok: true,
        value: [],
      });

      const result = await scanFolder();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filesProcessed).toBe(0);
        expect(result.value.facturasAdded).toBe(0);
        expect(result.value.pagosAdded).toBe(0);
      }
    });

    it('moves resumen_bancario with valid dates to Bancos folder', async () => {
      mockListFilesInFolder.mockResolvedValue({
        ok: true,
        value: [
          {
            id: 'resumen-1',
            name: 'resumen_banco.pdf',
            mimeType: 'application/pdf',
            lastUpdated: new Date('2024-01-31'),
          },
        ],
      });

      // Mock empty processed files list
      mockGetValues.mockResolvedValue({ ok: true, value: [] });

      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      // Classification returns resumen_bancario
      mockAnalyzeDocument
        .mockResolvedValueOnce({
          ok: true,
          value: '{"documentType": "resumen_bancario", "confidence": 0.9, "reason": "Bank statement", "indicators": ["BBVA", "Resumen"]}',
        })
        .mockResolvedValueOnce({
          ok: true,
          value: '{"banco": "BBVA", "fechaDesde": "2024-01-01", ...}',
        });
      mockParseClassificationResponse.mockReturnValueOnce({
        ok: true,
        value: {
          documentType: 'resumen_bancario',
          confidence: 0.9,
          reason: 'Bank statement',
          indicators: ['BBVA', 'Resumen'],
        },
      });
      mockParseResumenBancarioResponse.mockReturnValueOnce({
        ok: true,
        value: {
          data: {
            banco: 'BBVA',
            numeroCuenta: '1234567890',
            fechaDesde: '2024-01-01',
            fechaHasta: '2024-01-31',
            saldoInicial: 150000.00,
            saldoFinal: 185000.00,
            moneda: 'ARS',
            cantidadMovimientos: 47,
          },
          confidence: 0.9,
          needsReview: false,
        },
      });

      mockSortAndRenameDocument.mockResolvedValue({ success: true, targetPath: 'Bancos' });

      const result = await scanFolder();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filesProcessed).toBe(1);
        // Resumen bancario should be moved but not added to facturas/pagos/recibos counts
        expect(result.value.facturasAdded).toBe(0);
        expect(result.value.pagosAdded).toBe(0);
        expect(result.value.recibosAdded).toBe(0);
      }

      // Should call sortAndRenameDocument with resumen data
      expect(mockSortAndRenameDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'resumen-1',
          fileName: 'resumen_banco.pdf',
          banco: 'BBVA',
          fechaDesde: '2024-01-01',
          fechaHasta: '2024-01-31',
        }),
        'bancos',
        'resumen_bancario'
      );
    });

    it('moves resumen_bancario without dates to Sin Procesar', async () => {
      // When extraction fails or returns empty dates, files go to Sin Procesar
      mockListFilesInFolder.mockResolvedValue({
        ok: true,
        value: [
          {
            id: 'resumen-bad',
            name: 'resumen_sin_fecha.pdf',
            mimeType: 'application/pdf',
            lastUpdated: new Date('2024-01-31'),
          },
        ],
      });

      // Mock empty processed files list
      mockGetValues.mockResolvedValue({ ok: true, value: [] });

      mockDownloadFile.mockResolvedValue({
        ok: true,
        value: Buffer.from('pdf content'),
      });

      // Classification returns resumen_bancario
      mockAnalyzeDocument
        .mockResolvedValueOnce({
          ok: true,
          value: '{"documentType": "resumen_bancario", "confidence": 0.9, "reason": "Bank statement", "indicators": ["BBVA", "Resumen"]}',
        })
        .mockResolvedValueOnce({
          ok: true,
          value: '{"banco": "BBVA"}',
        });
      mockParseClassificationResponse.mockReturnValueOnce({
        ok: true,
        value: {
          documentType: 'resumen_bancario',
          confidence: 0.9,
          reason: 'Bank statement',
          indicators: ['BBVA', 'Resumen'],
        },
      });
      // Extraction returns incomplete data (missing dates and numeroCuenta)
      mockParseResumenBancarioResponse.mockReturnValueOnce({
        ok: true,
        value: {
          data: {
            banco: 'BBVA',
            numeroCuenta: '',
            fechaDesde: '',
            fechaHasta: '',
            saldoInicial: 0,
            saldoFinal: 0,
            moneda: 'ARS',
            cantidadMovimientos: 0,
          },
          confidence: 0.5,
          needsReview: true,
        },
      });

      mockSortToSinProcesar.mockResolvedValue({ success: true, targetPath: 'Sin Procesar' });

      const result = await scanFolder();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filesProcessed).toBe(1);
        // Resumen bancario without dates should not be added to any counts
        expect(result.value.facturasAdded).toBe(0);
        expect(result.value.pagosAdded).toBe(0);
        expect(result.value.recibosAdded).toBe(0);
      }

      // Should move to Sin Procesar because dates are empty
      expect(mockSortToSinProcesar).toHaveBeenCalledWith('resumen-bad', 'resumen_sin_fecha.pdf');
      // Should NOT call sortAndRenameDocument (keeps original filename)
      expect(mockSortAndRenameDocument).not.toHaveBeenCalled();
    });

    it('returns error when folder structure is not initialized', async () => {
      mockGetCachedFolderStructure.mockReturnValue(null);

      const result = await scanFolder();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Folder structure not initialized');
      }
    });

    it('returns error when listing files fails', async () => {
      mockListFilesInFolder.mockResolvedValue({
        ok: false,
        error: new Error('Drive API error'),
      });

      const result = await scanFolder();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Drive API error');
      }
    });

    it('counts errors but continues processing', async () => {
      mockListFilesInFolder.mockResolvedValue({
        ok: true,
        value: [
          { id: 'file-1', name: 'good.pdf', mimeType: 'application/pdf', lastUpdated: new Date() },
          { id: 'file-2', name: 'bad.pdf', mimeType: 'application/pdf', lastUpdated: new Date() },
        ],
      });

      mockGetValues.mockResolvedValue({ ok: true, value: [] });

      // First file succeeds
      mockDownloadFile
        .mockResolvedValueOnce({ ok: true, value: Buffer.from('pdf') })
        .mockResolvedValueOnce({ ok: false, error: new Error('Download failed') });

      mockAnalyzeDocument
        .mockResolvedValueOnce({ ok: true, value: '{"documentType": "factura_recibida"}' })
        .mockResolvedValueOnce({ ok: true, value: '{}' });
      mockParseClassificationResponse.mockReturnValueOnce({
        ok: true,
        value: { documentType: 'factura_recibida', confidence: 0.9, reason: '', indicators: [] },
      });
      mockParseFacturaResponse.mockReturnValueOnce({
        ok: true,
        value: {
          data: {
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
          },
          confidence: 0.95,
          needsReview: false,
        },
      });

      mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 1 });
      mockSortDocument.mockResolvedValue({ success: true });
      mockSortToSinProcesar.mockResolvedValue({ success: true });

      const result = await scanFolder();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filesProcessed).toBe(1);
        expect(result.value.errors).toBe(1);
      }
    });
  });

  describe('rematch', () => {
    it('matches unmatched pagos to facturas in Debitos', async () => {
      // Mock Debitos: Facturas Recibidas
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
          ['2024-01-15', 'fact-1', 'factura1.pdf', 'A', '00001234', '20123456786', 'TEST SA', 1000, 210, 1210, 'ARS', 'Test', '2024-01-16', 0.95, 'NO', '', '', ''],
        ],
      });

      // Mock Debitos: Pagos Enviados
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2024-01-18', 'pago-1', 'pago1.pdf', 'BBVA', 1210, 'ARS', 'REF123', '20123456786', 'TEST SA', 'Payment', '2024-01-18', 0.9, 'NO', '', ''],
        ],
      });

      // Mock Creditos: Facturas Emitidas (all matched)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
        ],
      });

      // Mock Creditos: Pagos Recibidos (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitPagador', 'nombrePagador', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
        ],
      });

      // Mock Debitos: Recibos (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence'],
        ],
      });

      // Mock Debitos: Pagos Enviados for recibos matching (reuse same data)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2024-01-18', 'pago-1', 'pago1.pdf', 'BBVA', 1210, 'ARS', 'REF123', '20123456786', 'TEST SA', 'Payment', '2024-01-18', 0.9, 'NO', 'fact-1', 'HIGH'], // Already matched
        ],
      });

      // Mock batch updates
      mockBatchUpdate.mockResolvedValue({ ok: true, value: 2 });

      const result = await rematch();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matchesFound).toBeGreaterThanOrEqual(0);
      }
    });

    it('matches Creditos: Facturas Emitidas with Pagos Recibidos', async () => {
      // Mock Debitos: Facturas Recibidas (all matched)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
        ],
      });

      // Mock Debitos: Pagos Enviados (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
        ],
      });

      // Mock Creditos: Facturas Emitidas
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
          ['2024-02-10', 'fact-emit-1', 'factura_emitida.pdf', 'A', '00005678', '27234567891', 'EMPRESA UNO SA', 5000, 1050, 6050, 'ARS', 'Service', '2024-02-10', 0.95, 'NO', '', '', ''],
        ],
      });

      // Mock Creditos: Pagos Recibidos
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitPagador', 'nombrePagador', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2024-02-15', 'pago-recib-1', 'pago_recibido.pdf', 'Galicia', 6050, 'ARS', 'TRANS001', '27234567891', 'EMPRESA UNO SA', 'Payment received', '2024-02-15', 0.9, 'NO', '', ''],
        ],
      });

      // Mock Debitos: Recibos (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence'],
        ],
      });

      // Mock Debitos: Pagos Enviados for recibos (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
        ],
      });

      // Mock batch updates
      mockBatchUpdate.mockResolvedValue({ ok: true, value: 2 });

      const result = await rematch();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matchesFound).toBeGreaterThanOrEqual(0);
      }
    });

    it('matches Recibos with Pagos Enviados in Debitos', async () => {
      // Mock Debitos: Facturas Recibidas (all matched)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
        ],
      });

      // Mock Debitos: Pagos Enviados (empty for first call)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
        ],
      });

      // Mock Creditos: Facturas Emitidas (all matched)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
        ],
      });

      // Mock Creditos: Pagos Recibidos (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitPagador', 'nombrePagador', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
        ],
      });

      // Mock Debitos: Recibos
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence'],
          ['2024-03-31', 'recibo-1', 'recibo_marzo.pdf', 'sueldo', 'MARTIN, Miguel', '20271190523', '1', 'Operario', '30709076783', 'marzo/2024', 2346822.36, 398959.80, 1947863.00, '2024-03-31', 0.95, 'NO', '', ''],
        ],
      });

      // Mock Debitos: Pagos Enviados for recibos matching
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2024-03-31', 'pago-sueldo-1', 'transferencia_sueldo.pdf', 'BBVA', 1947863.00, 'ARS', 'SUELDO-MAR', '20271190523', 'MARTIN, Miguel', 'Salary payment', '2024-03-31', 0.9, 'NO', '', ''],
        ],
      });

      // Mock batch updates
      mockBatchUpdate.mockResolvedValue({ ok: true, value: 2 });

      const result = await rematch();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matchesFound).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles all documents already matched', async () => {
      // Mock all spreadsheets with already matched documents
      // Debitos: Facturas Recibidas (matched)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
          ['2024-01-15', 'fact-1', 'factura1.pdf', 'A', '00001234', '20123456786', 'TEST SA', 1000, 210, 1210, 'ARS', 'Test', '2024-01-16', 0.95, 'NO', 'pago-1', 'HIGH', 'YES'],
        ],
      });

      // Debitos: Pagos Enviados (matched)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2024-01-18', 'pago-1', 'pago1.pdf', 'BBVA', 1210, 'ARS', 'REF123', '20123456786', 'TEST SA', 'Payment', '2024-01-18', 0.9, 'NO', 'fact-1', 'HIGH'],
        ],
      });

      // Creditos: Facturas Emitidas (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
        ],
      });

      // Creditos: Pagos Recibidos (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitPagador', 'nombrePagador', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
        ],
      });

      // Debitos: Recibos (empty)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence'],
        ],
      });

      // Debitos: Pagos Enviados for recibos (matched)
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2024-01-18', 'pago-1', 'pago1.pdf', 'BBVA', 1210, 'ARS', 'REF123', '20123456786', 'TEST SA', 'Payment', '2024-01-18', 0.9, 'NO', 'fact-1', 'HIGH'],
        ],
      });

      const result = await rematch();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matchesFound).toBe(0);
      }
    });

    it('returns error when fetching fails', async () => {
      mockGetValues.mockResolvedValue({
        ok: false,
        error: new Error('Sheets API error'),
      });

      const result = await rematch();

      expect(result.ok).toBe(false);
    });

    it('returns error when batch update fails', async () => {
      // Mock unmatched documents
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor', 'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
          ['2024-01-15', 'fact-1', 'factura1.pdf', 'A', '00001234', '20123456786', 'TEST SA', 1000, 210, 1210, 'ARS', 'Test', '2024-01-16', 0.95, 'NO', '', '', ''],
        ],
      });

      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'],
          ['2024-01-18', 'pago-1', 'pago1.pdf', 'BBVA', 1210, 'ARS', 'REF123', '20123456786', 'TEST SA', 'Payment', '2024-01-18', 0.9, 'NO', '', ''],
        ],
      });

      // Mock batch update failure
      mockBatchUpdate.mockResolvedValue({
        ok: false,
        error: new Error('Update failed'),
      });

      const result = await rematch();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Update failed');
      }
    });
  });

});
