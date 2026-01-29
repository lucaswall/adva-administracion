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
  processFile: vi.fn(async () => ({
    ok: true,
    value: {
      documentType: 'factura_emitida',
      document: { fechaEmision: '2024-01-01' }
    }
  })),
  hasValidDate: vi.fn(() => true),
}));

vi.mock('./storage/index.js', () => ({
  getProcessedFileIds: vi.fn(async () => ({ ok: true, value: new Set() })),
  getStaleProcessingFileIds: vi.fn(async () => ({ ok: true, value: new Set() })),
  markFileProcessing: vi.fn(async () => ({ ok: true, value: undefined })),
  updateFileStatus: vi.fn(async () => ({ ok: true, value: undefined })),
  storeFactura: vi.fn(async () => ({ ok: true, value: { stored: true } })),
  storePago: vi.fn(async () => ({ ok: true, value: { stored: true } })),
  storeRecibo: vi.fn(async () => ({ ok: true, value: { stored: true } })),
  storeRetencion: vi.fn(async () => ({ ok: true, value: { stored: true } })),
  storeResumenBancario: vi.fn(async () => ({ ok: true, value: { stored: true } })),
  storeResumenTarjeta: vi.fn(async () => ({ ok: true, value: { stored: true } })),
  storeResumenBroker: vi.fn(async () => ({ ok: true, value: { stored: true } })),
  storeMovimientosBancario: vi.fn(async () => ({ ok: true, value: undefined })),
  storeMovimientosTarjeta: vi.fn(async () => ({ ok: true, value: undefined })),
  storeMovimientosBroker: vi.fn(async () => ({ ok: true, value: undefined })),
}));

vi.mock('../services/folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(() => ({
    entradaId: 'entrada',
    sinProcesarId: 'sin-procesar',
    duplicadoId: 'duplicado',
    controlIngresosId: 'control-ingresos',
    controlEgresosId: 'control-egresos',
    dashboardOperativoId: 'dashboard',
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
  sortToSinProcesar: vi.fn(async () => ({ success: true, targetPath: 'Sin Procesar/file.pdf' })),
  sortAndRenameDocument: vi.fn(async () => ({ success: true, targetPath: 'Ingresos/file.pdf' })),
  moveToDuplicadoFolder: vi.fn(async () => ({ ok: true, value: { targetPath: 'Duplicado/file.pdf' } })),
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
  runMatching: vi.fn(async () => ({ ok: true, value: 0 })),
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
    this.flush = vi.fn(async () => ({ ok: true, value: undefined }));
    return this;
  });

  return {
    TokenUsageBatch,
  };
});

describe('scanner', () => {
  let mockQueue: any;
  let mockListFiles: any;
  let mockProcessFile: any;
  let mockSortToSinProcesar: any;
  let pendingTasks: Set<Promise<void>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up fresh mocks
    const { listFilesInFolder } = await import('../services/drive.js');
    const { getProcessingQueue } = await import('./queue.js');
    const { processFile } = await import('./extractor.js');
    const { sortToSinProcesar } = await import('../services/document-sorter.js');

    mockListFiles = vi.mocked(listFilesInFolder);
    mockProcessFile = vi.mocked(processFile);
    mockSortToSinProcesar = vi.mocked(sortToSinProcesar);

    // Create a proper queue mock that tracks pending tasks
    pendingTasks = new Set<Promise<void>>();
    mockQueue = {
      add: vi.fn((fn: () => Promise<void>) => {
        const task = fn().finally(() => pendingTasks.delete(task));
        pendingTasks.add(task);
        return task;
      }),
      onIdle: vi.fn(async () => {
        while (pendingTasks.size > 0) {
          await Promise.race(Array.from(pendingTasks));
        }
      }),
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

    it('should retry JSON parse errors up to 3 times with delays', async () => {
      vi.useFakeTimers();

      const mockFile = {
        id: 'test-file',
        name: 'test.pdf',
        mimeType: 'application/pdf',
        parents: ['folder-id'],
      };

      mockListFiles.mockResolvedValue({
        ok: true,
        value: [mockFile],
      });

      // Mock processFile to fail with JSON error 3 times, then succeed
      let attemptCount = 0;
      mockProcessFile.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount <= 3) {
          return {
            ok: false,
            error: new Error('Expected \',\' or \']\' after array element in JSON at position 422'),
          };
        }
        return {
          ok: true,
          value: {
            documentType: 'factura_emitida',
            document: { fechaEmision: '2024-01-01' },
          },
        };
      });

      mockSortToSinProcesar.mockResolvedValue({
        success: true,
        targetPath: 'Sin Procesar/test.pdf',
      });

      // Start scan (don't await yet)
      const scanPromise = scanFolder('folder-id');

      // Fast-forward through delays: 10s, 30s, 60s
      await vi.advanceTimersByTimeAsync(10000); // First retry after 10s
      await vi.advanceTimersByTimeAsync(30000); // Second retry after 30s
      await vi.advanceTimersByTimeAsync(60000); // Third retry after 60s

      await scanPromise;

      // Should have attempted 4 times total (1 initial + 3 retries)
      expect(attemptCount).toBe(4);

      vi.useRealTimers();
    });

    it('should move file to Sin Procesar after 3 failed retries', async () => {
      vi.useFakeTimers();

      const mockFile = {
        id: 'test-file',
        name: 'test.pdf',
        mimeType: 'application/pdf',
        parents: ['folder-id'],
      };

      mockListFiles.mockResolvedValue({
        ok: true,
        value: [mockFile],
      });

      // Mock processFile to always fail with JSON error
      let attemptCount = 0;
      mockProcessFile.mockImplementation(async () => {
        attemptCount++;
        return {
          ok: false,
          error: new Error('No JSON found in response'),
        };
      });

      mockSortToSinProcesar.mockResolvedValue({
        success: true,
        targetPath: 'Sin Procesar/test.pdf',
      });

      // Start scan (don't await yet)
      const scanPromise = scanFolder('folder-id');

      // Fast-forward through delays: 10s, 30s, 60s
      await vi.advanceTimersByTimeAsync(10000); // First retry after 10s
      await vi.advanceTimersByTimeAsync(30000); // Second retry after 30s
      await vi.advanceTimersByTimeAsync(60000); // Third retry after 60s

      await scanPromise;

      // Should have tried 4 times (1 initial + 3 retries)
      expect(attemptCount).toBe(4);
      // Should have moved to Sin Procesar after all retries exhausted
      expect(mockSortToSinProcesar).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should only retry JSON parse errors, not other errors', async () => {
      const mockFile = {
        id: 'test-file',
        name: 'test.pdf',
        mimeType: 'application/pdf',
        parents: ['folder-id'],
      };

      mockListFiles.mockResolvedValue({
        ok: true,
        value: [mockFile],
      });

      // Mock processFile to fail with non-JSON error
      mockProcessFile.mockResolvedValue({
        ok: false,
        error: new Error('Network timeout'),
      });

      mockSortToSinProcesar.mockResolvedValue({
        success: true,
        targetPath: 'Sin Procesar/test.pdf',
      });

      await scanFolder('folder-id');

      // Should only process once (no retries for non-JSON errors)
      expect(mockProcessFile).toHaveBeenCalledTimes(1);
      // Should move to Sin Procesar immediately
      expect(mockSortToSinProcesar).toHaveBeenCalled();
    });

    it('should recover files with stale processing status on startup', async () => {
      // Import the storage module to get the mock
      const { getStaleProcessingFileIds, getProcessedFileIds } = await import('./storage/index.js');

      // Mock file list in Entrada folder
      const mockFile = {
        id: 'stale-file',
        name: 'stale-document.pdf',
        mimeType: 'application/pdf',
        parents: ['entrada'],
      };

      mockListFiles.mockResolvedValue({
        ok: true,
        value: [mockFile],
      });

      // Mock that this file has stale processing status
      vi.mocked(getStaleProcessingFileIds).mockResolvedValue({
        ok: true,
        value: new Set(['stale-file']),
      });

      // Mock that no files are successfully processed
      vi.mocked(getProcessedFileIds).mockResolvedValue({
        ok: true,
        value: new Set(),
      });

      // Mock successful processing on recovery
      mockProcessFile.mockResolvedValue({
        ok: true,
        value: {
          documentType: 'factura_emitida',
          document: { fechaEmision: '2024-01-01' }
        }
      });

      await scanFolder('entrada');

      // Should call getStaleProcessingFileIds to find stale files
      expect(getStaleProcessingFileIds).toHaveBeenCalled();
      // Should process the stale file
      expect(mockProcessFile).toHaveBeenCalled();
    });

    it('should not recover stale files that are not in Entrada folder', async () => {
      const { getStaleProcessingFileIds, getProcessedFileIds } = await import('./storage/index.js');

      // Mock empty Entrada folder
      mockListFiles.mockResolvedValue({
        ok: true,
        value: [],
      });

      // Mock that a file has stale processing status (but not in Entrada)
      vi.mocked(getStaleProcessingFileIds).mockResolvedValue({
        ok: true,
        value: new Set(['missing-file']),
      });

      vi.mocked(getProcessedFileIds).mockResolvedValue({
        ok: true,
        value: new Set(),
      });

      await scanFolder('entrada');

      // Should not process the file since it's not in Entrada
      expect(mockProcessFile).not.toHaveBeenCalled();
    });
  });
});
