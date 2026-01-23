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
const mockGetOrCreateBankAccountFolder = vi.fn();
const mockGetOrCreateBankAccountSpreadsheet = vi.fn();

vi.mock('../../../src/services/folder-structure.js', () => ({
  getCachedFolderStructure: () => mockGetCachedFolderStructure(),
  discoverFolderStructure: () => mockDiscoverFolderStructure(),
  getOrCreateBankAccountFolder: (...args: unknown[]) => mockGetOrCreateBankAccountFolder(...args),
  getOrCreateBankAccountSpreadsheet: (...args: unknown[]) => mockGetOrCreateBankAccountSpreadsheet(...args),
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
  MAX_CASCADE_DEPTH: 10,
  CASCADE_TIMEOUT_MS: 30000,
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

// Mock matching module
const mockRunMatching = vi.fn();
vi.mock('../../../src/processing/matching/index.js', () => ({
  runMatching: (...args: unknown[]) => mockRunMatching(...args),
  matchFacturasWithPagos: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  matchRecibosWithPagos: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
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
    // Default mock for sortToSinProcesar
    mockSortToSinProcesar.mockResolvedValue({ success: true, targetPath: 'Sin Procesar' });
    // Default mock for appendRowsWithLinks
    mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 1 });
    // Default mock for sortSheet
    mockSortSheet.mockResolvedValue({ ok: true, value: undefined });
    // Default mock for runMatching
    mockRunMatching.mockResolvedValue({ ok: true, value: 0 });
    // Default mocks for bank account functions
    mockGetOrCreateBankAccountFolder.mockResolvedValue({ ok: true, value: 'default-bank-folder-id' });
    mockGetOrCreateBankAccountSpreadsheet.mockResolvedValue({ ok: true, value: 'default-bank-spreadsheet-id' });
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

    it.skip('moves resumen_bancario with valid dates to Bancos folder', async () => {
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
      mockGetValues.mockResolvedValue({ ok: true, value: [['Header']] }); // No existing data

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

      // Mock new bank account functions
      mockGetOrCreateBankAccountFolder.mockResolvedValue({ ok: true, value: 'bbva-account-folder-id' });
      mockGetOrCreateBankAccountSpreadsheet.mockResolvedValue({ ok: true, value: 'bbva-spreadsheet-id' });

      // Mock storage (not a duplicate)
      mockAppendRowsWithLinks.mockResolvedValue({ ok: true, value: 9 });
      mockSortSheet.mockResolvedValue({ ok: true, value: undefined });

      mockSortAndRenameDocument.mockResolvedValue({ success: true, targetPath: '2024/Bancos/BBVA 1234567890 ARS' });

      const result = await scanFolder();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filesProcessed).toBe(1);
        // Resumen bancario should be moved but not added to facturas/pagos/recibos counts
        expect(result.value.facturasAdded).toBe(0);
        expect(result.value.pagosAdded).toBe(0);
        expect(result.value.recibosAdded).toBe(0);
      }

      // Verify bank account folder and spreadsheet were created
      expect(mockGetOrCreateBankAccountFolder).toHaveBeenCalledWith('2024', 'BBVA', '1234567890', 'ARS');
      expect(mockGetOrCreateBankAccountSpreadsheet).toHaveBeenCalledWith('bbva-account-folder-id', '2024', 'BBVA', '1234567890', 'ARS');

      // Verify the resumen was stored (appendRowsWithLinks called for storage)
      expect(mockAppendRowsWithLinks).toHaveBeenCalled();

      // Verify file was sorted and renamed after successful storage
      expect(mockSortAndRenameDocument).toHaveBeenCalledTimes(1);
      expect(mockSortAndRenameDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'resumen-1',
          banco: 'BBVA',
          numeroCuenta: '1234567890',
          fechaDesde: '2024-01-01',
          fechaHasta: '2024-01-31',
          moneda: 'ARS',
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
    // Note: The matching logic is now in separate modules (src/processing/matching/).
    // These tests verify scanner's rematch function behavior, not matching internals.
    // For detailed matching tests, see tests/unit/processing/matching/*.test.ts

    it('returns matches when runMatching succeeds', async () => {
      mockRunMatching.mockResolvedValueOnce({ ok: true, value: 5 });

      const result = await rematch();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matchesFound).toBe(5);
        expect(result.value.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns zero matches when nothing to match', async () => {
      mockRunMatching.mockResolvedValueOnce({ ok: true, value: 0 });

      const result = await rematch();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matchesFound).toBe(0);
      }
    });

    it('returns error when matching fails', async () => {
      mockRunMatching.mockResolvedValueOnce({
        ok: false,
        error: new Error('Matching failed'),
      });

      const result = await rematch();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Matching failed');
      }
    });

    it('returns error when folder structure is not initialized', async () => {
      mockGetCachedFolderStructure.mockReturnValueOnce(null);

      const result = await rematch();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Folder structure not initialized');
      }
    });

    // Note: Cascading match displacement tests have been moved to
    // tests/unit/processing/matching/factura-pago-matcher.test.ts
    // and tests/unit/processing/matching/recibo-pago-matcher.test.ts
    // These scanner tests now focus on the scanner's behavior with the matching module.
  });

});
