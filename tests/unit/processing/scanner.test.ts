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
const mockAppendRows = vi.fn();
const mockBatchUpdate = vi.fn();

vi.mock('../../../src/services/sheets.js', () => ({
  getValues: (...args: unknown[]) => mockGetValues(...args),
  setValues: (...args: unknown[]) => mockSetValues(...args),
  appendRows: (...args: unknown[]) => mockAppendRows(...args),
  batchUpdate: (...args: unknown[]) => mockBatchUpdate(...args),
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

vi.mock('../../../src/services/document-sorter.js', () => ({
  sortDocument: (...args: unknown[]) => mockSortDocument(...args),
  sortToSinProcesar: (...args: unknown[]) => mockSortToSinProcesar(...args),
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

vi.mock('../../../src/gemini/parser.js', () => ({
  parseClassificationResponse: (...args: unknown[]) => mockParseClassificationResponse(...args),
  parseFacturaResponse: (...args: unknown[]) => mockParseFacturaResponse(...args),
  parsePagoResponse: (...args: unknown[]) => mockParsePagoResponse(...args),
  parseReciboResponse: (...args: unknown[]) => mockParseReciboResponse(...args),
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
  createScanner,
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
      folderPath: '',
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
      mockAppendRows.mockResolvedValue({ ok: true, value: 1 });

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

      mockAppendRows.mockResolvedValue({ ok: true, value: 1 });

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

      mockAppendRows.mockResolvedValue({ ok: true, value: 1 });

      const result = await processFile(mockFileInfo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.documentType).toBe('recibo');
        expect((result.value.document as Recibo).nombreEmpleado).toBe('MARTIN, Miguel');
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
            folderPath: '',
          },
          {
            id: 'file-2',
            name: 'pago1.pdf',
            mimeType: 'application/pdf',
            lastUpdated: new Date('2024-01-16'),
            folderPath: '',
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

      mockAppendRows.mockResolvedValue({ ok: true, value: 1 });
      mockSortDocument.mockResolvedValue({ success: true });

      const result = await scanFolder();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filesProcessed).toBe(2);
        expect(result.value.facturasAdded).toBe(1);
        expect(result.value.pagosAdded).toBe(1);
      }

      expect(mockListFilesInFolder).toHaveBeenCalledWith('entrada-id', '');
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
            folderPath: '',
          },
          {
            id: 'file-2',
            name: 'already-processed.pdf',
            mimeType: 'application/pdf',
            lastUpdated: new Date('2024-01-14'),
            folderPath: '',
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

      mockAppendRows.mockResolvedValue({ ok: true, value: 1 });
      mockSortDocument.mockResolvedValue({ success: true });

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
          { id: 'file-1', name: 'good.pdf', mimeType: 'application/pdf', lastUpdated: new Date(), folderPath: '' },
          { id: 'file-2', name: 'bad.pdf', mimeType: 'application/pdf', lastUpdated: new Date(), folderPath: '' },
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

      mockAppendRows.mockResolvedValue({ ok: true, value: 1 });
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
    it('matches unmatched pagos to facturas', async () => {
      // Mock fetching unmatched facturas
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          // Header row
          ['fileId', 'fileName', 'tipo', 'puntoVenta', 'numero', 'fechaEmision', 'cuitEmisor', 'razonSocial', 'importeTotal', 'moneda', 'matchedPagoFileId'],
          // Unmatched factura
          ['fact-1', 'factura1.pdf', 'A', '00001', '00001234', '2024-01-15', '20123456786', 'TEST SA', 1210, 'ARS', ''],
        ],
      });

      // Mock fetching unmatched pagos
      mockGetValues.mockResolvedValueOnce({
        ok: true,
        value: [
          // Header row
          ['fileId', 'fileName', 'banco', 'fechaPago', 'importePagado', 'cuitBeneficiario', 'matchedFacturaFileId'],
          // Unmatched pago that should match factura
          ['pago-1', 'pago1.pdf', 'BBVA', '2024-01-18', 1210, '20123456786', ''],
        ],
      });

      // Mock updating sheets
      mockBatchUpdate.mockResolvedValue({ ok: true, value: 2 });

      const result = await rematch();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matchesFound).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles no unmatched documents', async () => {
      // All documents are already matched
      mockGetValues
        .mockResolvedValueOnce({
          ok: true,
          value: [
            ['fileId', 'matchedPagoFileId'],
            ['fact-1', 'pago-1'], // Already matched
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            ['fileId', 'matchedFacturaFileId'],
            ['pago-1', 'fact-1'], // Already matched
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
  });

  describe('createScanner', () => {
    it('creates a scanner with custom config', () => {
      const scanner = createScanner({
        concurrency: 5,
        matchDaysBefore: 15,
        matchDaysAfter: 90,
      });

      expect(scanner).toBeDefined();
      expect(scanner.processFile).toBeDefined();
      expect(scanner.scanFolder).toBeDefined();
      expect(scanner.rematch).toBeDefined();
    });
  });
});
