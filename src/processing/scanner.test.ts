import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scanFolder } from './scanner.js';

// Mock dependencies
vi.mock('../services/drive.js', () => ({
  listFilesInFolder: vi.fn(),
}));

vi.mock('./queue.js', () => ({
  getProcessingQueue: vi.fn(() => ({
    add: vi.fn(async (fn: () => Promise<void>) => await fn()),
    onIdle: vi.fn(async () => undefined),
  })),
}));

vi.mock('./extractor.js', () => ({
  processFile: vi.fn(),
  hasValidDate: vi.fn(() => true),
}));

vi.mock('./storage/index.js', () => ({
  getProcessedFileIds: vi.fn(async () => ({ ok: true, value: new Set() })),
  markFileProcessing: vi.fn(async () => ({ ok: true, value: undefined })),
  updateFileStatus: vi.fn(async () => ({ ok: true, value: undefined })),
  storeFactura: vi.fn(),
  storePago: vi.fn(),
  storeRecibo: vi.fn(),
  storeRetencion: vi.fn(),
  storeResumenBancario: vi.fn(),
  storeResumenTarjeta: vi.fn(),
  storeResumenBroker: vi.fn(),
  storeMovimientosBancario: vi.fn(),
  storeMovimientosTarjeta: vi.fn(),
  storeMovimientosBroker: vi.fn(),
}));

vi.mock('../services/folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(() => ({
    entradaFolderId: 'entrada',
    sinProcesarFolderId: 'sin-procesar',
    duplicadoFolderId: 'duplicado',
  })),
  getOrCreateBankAccountFolder: vi.fn(),
  getOrCreateBankAccountSpreadsheet: vi.fn(),
  getOrCreateCreditCardFolder: vi.fn(),
  getOrCreateCreditCardSpreadsheet: vi.fn(),
  getOrCreateBrokerFolder: vi.fn(),
  getOrCreateBrokerSpreadsheet: vi.fn(),
  getOrCreateMovimientosSpreadsheet: vi.fn(),
}));

vi.mock('../services/document-sorter.js', () => ({
  sortToSinProcesar: vi.fn(async () => ({ ok: true, value: undefined })),
  sortAndRenameDocument: vi.fn(async () => ({ ok: true, value: undefined })),
  moveToDuplicadoFolder: vi.fn(async () => ({ ok: true, value: undefined })),
}));

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../utils/correlation.js', () => ({
  withCorrelationAsync: vi.fn(async (fn: () => Promise<void>) => await fn()),
  getCorrelationId: vi.fn(() => 'test-correlation-id'),
  generateCorrelationId: vi.fn(() => 'test-correlation-id'),
}));

vi.mock('./matching/index.js', () => ({
  runMatching: vi.fn(async () => undefined),
}));

vi.mock('./caches/index.js', () => {
  const SortBatch = vi.fn(function (this: any) {
    this.flush = vi.fn();
    this.clear = vi.fn();
    this.flushSorts = vi.fn(async () => undefined);
    this.recordSort = vi.fn();
    return this;
  });
  const DuplicateCache = vi.fn(function (this: any) {
    this.clear = vi.fn();
    this.loadSheet = vi.fn(async () => undefined);
    this.isDuplicate = vi.fn(() => false);
    this.markAsProcessed = vi.fn();
    return this;
  });
  const MetadataCache = vi.fn(function (this: any) {
    this.clear = vi.fn();
    this.getMetadata = vi.fn();
    this.setMetadata = vi.fn();
    return this;
  });
  const SheetOrderBatch = vi.fn(function (this: any) {
    this.flush = vi.fn();
    this.clear = vi.fn();
    this.flushReorders = vi.fn(async () => undefined);
    this.recordMove = vi.fn();
    return this;
  });

  return {
    SortBatch,
    DuplicateCache,
    MetadataCache,
    SheetOrderBatch,
  };
});

vi.mock('../services/token-usage-batch.js', () => {
  const TokenUsageBatch = vi.fn(function (this: any) {
    this.flush = vi.fn();
    return this;
  });

  return {
    TokenUsageBatch,
  };
});

describe('scanner', () => {
  let mockQueue: any;
  let mockListFiles: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up fresh mocks
    const { listFilesInFolder } = await import('../services/drive.js');
    const { getProcessingQueue } = await import('./queue.js');

    mockListFiles = vi.mocked(listFilesInFolder);
    mockQueue = {
      add: vi.fn(async (fn: () => Promise<void>) => await fn()),
      onIdle: vi.fn(async () => undefined),
    };
    vi.mocked(getProcessingQueue).mockReturnValue(mockQueue);
  });

  describe('scanFolder', () => {
    it('should use queue.onIdle() instead of tracking promises manually', async () => {
      // Create 10 mock files (simpler for test)
      const mockFiles = Array.from({ length: 10 }, (_, i) => ({
        id: `file-${i}`,
        name: `document-${i}.pdf`,
        mimeType: 'application/pdf',
        parents: ['folder-id'],
      }));

      mockListFiles.mockResolvedValue({
        ok: true,
        value: mockFiles,
      });

      // Run scan
      await scanFolder('folder-id');

      // Verify queue.onIdle was called to wait for completion
      expect(mockQueue.onIdle).toHaveBeenCalled();

      // The key behavioral test: scanner should use queue.onIdle()
      // instead of maintaining processingPromises/retryPromises arrays
    });
  });
});
