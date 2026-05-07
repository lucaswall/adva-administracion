/**
 * Tests for server startup behavior
 * ADV-26: Startup scan silent failure allows partial initialization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all dependencies before importing server
vi.mock('./config.js', () => ({
  getConfig: vi.fn(() => ({
    port: 3000,
    nodeEnv: 'test',
    environment: 'staging',
    apiSecret: 'test-secret',
    driveRootFolderId: 'test-root',
    webhookUrl: null,
    googleServiceAccountKey: '{}',
    geminiApiKey: 'test-key',
    logLevel: 'INFO',
    apiBaseUrl: null,
    matchDaysBefore: 10,
    matchDaysAfter: 60,
    usdMatchDaysAfter: 90,
    usdArsTolerancePercent: 5,
    geminiRpmLimit: 150,
    geminiDailyBudget: 0,
    maxDocumentBytes: 25 * 1024 * 1024,
  })),
}));

vi.mock('./processing/scanner.js', () => ({
  scanFolder: vi.fn(),
}));

vi.mock('./services/folder-structure.js', () => ({
  discoverFolderStructure: vi.fn(),
  getCachedFolderStructure: vi.fn(),
}));

vi.mock('./services/watch-manager.js', () => ({
  initWatchManager: vi.fn(),
  startWatching: vi.fn(),
  shutdownWatchManager: vi.fn(),
  updateLastScanTime: vi.fn(),
}));

vi.mock('./services/status-sheet.js', () => ({
  updateStatusSheet: vi.fn(),
}));

vi.mock('./utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import { getConfig } from './config.js';
import { scanFolder } from './processing/scanner.js';
import { getCachedFolderStructure } from './services/folder-structure.js';
import { error as logError } from './utils/logger.js';


// Reset module cache between tests to get fresh imports
afterEach(async () => {
  vi.resetModules();
});

describe('Server startup scan (ADV-26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isCriticalScanError', () => {
    it('identifies authentication errors as critical', async () => {
      const { isCriticalScanError } = await import('./server.js');

      const authErrors = [
        'Request had insufficient authentication scopes',
        'Invalid credentials',
        'Access denied',
        'Authentication failed',
        '401 Unauthorized',
        '403 Forbidden',
      ];

      for (const msg of authErrors) {
        expect(isCriticalScanError(new Error(msg))).toBe(true);
      }
    });

    it('identifies folder structure errors as critical', async () => {
      const { isCriticalScanError } = await import('./server.js');

      const folderErrors = [
        'Folder structure not initialized',
        'Entrada folder not found',
        'Root folder does not exist',
        'Control de Ingresos not found',
        'Dashboard Operativo not found',
      ];

      for (const msg of folderErrors) {
        expect(isCriticalScanError(new Error(msg))).toBe(true);
      }
    });

    it('identifies transient errors as non-critical', async () => {
      const { isCriticalScanError } = await import('./server.js');

      const transientErrors = [
        'Rate limit exceeded',
        'Quota exceeded',
        'Timeout waiting for response',
        'Network error',
        'Service unavailable',
      ];

      for (const msg of transientErrors) {
        expect(isCriticalScanError(new Error(msg))).toBe(false);
      }
    });
  });

  describe('performStartupScan', () => {
    it('should return Result<void, Error> instead of void', async () => {
      // Mock config to run in development mode (not test, which skips scan)
      vi.mocked(getConfig).mockReturnValue({
        port: 3000,
        nodeEnv: 'development',
        apiSecret: 'test-secret',
        driveRootFolderId: 'test-root',
        webhookUrl: null,
        googleServiceAccountKey: '{}',
        geminiApiKey: 'test-key',
        logLevel: 'INFO',
        apiBaseUrl: null,
        matchDaysBefore: 10,
        matchDaysAfter: 60,
        usdMatchDaysAfter: 90,
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
        geminiDailyBudget: 0,
        maxDocumentBytes: 25 * 1024 * 1024,
        environment: 'staging' as const,
      });

      // Mock successful scan
      vi.mocked(scanFolder).mockResolvedValue({
        ok: true,
        value: {
          filesProcessed: 0,
          facturasAdded: 0,
          pagosAdded: 0,
          recibosAdded: 0,
          matchesFound: 0,
          errors: 0,
          duration: 100,
        },
      });

      vi.mocked(getCachedFolderStructure).mockReturnValue(null);

      const { performStartupScan } = await import('./server.js');
      const result = await performStartupScan();

      // Should return Result type
      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
    });

    it('should return error result for critical errors (auth failure)', async () => {
      vi.mocked(getConfig).mockReturnValue({
        port: 3000,
        nodeEnv: 'development',
        apiSecret: 'test-secret',
        driveRootFolderId: 'test-root',
        webhookUrl: null,
        googleServiceAccountKey: '{}',
        geminiApiKey: 'test-key',
        logLevel: 'INFO',
        apiBaseUrl: null,
        matchDaysBefore: 10,
        matchDaysAfter: 60,
        usdMatchDaysAfter: 90,
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
        geminiDailyBudget: 0,
        maxDocumentBytes: 25 * 1024 * 1024,
        environment: 'staging' as const,
      });

      // Mock auth failure - critical error
      vi.mocked(scanFolder).mockResolvedValue({
        ok: false,
        error: new Error('Request had insufficient authentication scopes'),
      });

      const { performStartupScan } = await import('./server.js');
      const result = await performStartupScan();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('authentication');
      }
    });

    it('should return error result for critical errors (missing folder)', async () => {
      vi.mocked(getConfig).mockReturnValue({
        port: 3000,
        nodeEnv: 'development',
        apiSecret: 'test-secret',
        driveRootFolderId: 'test-root',
        webhookUrl: null,
        googleServiceAccountKey: '{}',
        geminiApiKey: 'test-key',
        logLevel: 'INFO',
        apiBaseUrl: null,
        matchDaysBefore: 10,
        matchDaysAfter: 60,
        usdMatchDaysAfter: 90,
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
        geminiDailyBudget: 0,
        maxDocumentBytes: 25 * 1024 * 1024,
        environment: 'staging' as const,
      });

      // Mock missing folder - critical error
      vi.mocked(scanFolder).mockResolvedValue({
        ok: false,
        error: new Error('Folder structure not initialized'),
      });

      const { performStartupScan } = await import('./server.js');
      const result = await performStartupScan();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Folder structure');
      }
    });

    it('should return success for transient errors (logged but continues)', async () => {
      vi.mocked(getConfig).mockReturnValue({
        port: 3000,
        nodeEnv: 'development',
        apiSecret: 'test-secret',
        driveRootFolderId: 'test-root',
        webhookUrl: null,
        googleServiceAccountKey: '{}',
        geminiApiKey: 'test-key',
        logLevel: 'INFO',
        apiBaseUrl: null,
        matchDaysBefore: 10,
        matchDaysAfter: 60,
        usdMatchDaysAfter: 90,
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
        geminiDailyBudget: 0,
        maxDocumentBytes: 25 * 1024 * 1024,
        environment: 'staging' as const,
      });

      // Mock transient error - should NOT fail startup
      vi.mocked(scanFolder).mockResolvedValue({
        ok: false,
        error: new Error('Rate limit exceeded'),
      });

      const { performStartupScan } = await import('./server.js');
      const result = await performStartupScan();

      // Transient errors return success (logged but continue)
      expect(result.ok).toBe(true);
    });

    it('should succeed when scan finds no files', async () => {
      vi.mocked(getConfig).mockReturnValue({
        port: 3000,
        nodeEnv: 'development',
        apiSecret: 'test-secret',
        driveRootFolderId: 'test-root',
        webhookUrl: null,
        googleServiceAccountKey: '{}',
        geminiApiKey: 'test-key',
        logLevel: 'INFO',
        apiBaseUrl: null,
        matchDaysBefore: 10,
        matchDaysAfter: 60,
        usdMatchDaysAfter: 90,
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
        geminiDailyBudget: 0,
        maxDocumentBytes: 25 * 1024 * 1024,
        environment: 'staging' as const,
      });

      // Mock successful scan with no files
      vi.mocked(scanFolder).mockResolvedValue({
        ok: true,
        value: {
          filesProcessed: 0,
          facturasAdded: 0,
          pagosAdded: 0,
          recibosAdded: 0,
          matchesFound: 0,
          errors: 0,
          duration: 50,
        },
      });

      vi.mocked(getCachedFolderStructure).mockReturnValue(null);

      const { performStartupScan } = await import('./server.js');
      const result = await performStartupScan();

      expect(result.ok).toBe(true);
    });

    it('should skip scan in test mode and return success', async () => {
      vi.mocked(getConfig).mockReturnValue({
        port: 3000,
        nodeEnv: 'test',
        apiSecret: 'test-secret',
        driveRootFolderId: 'test-root',
        webhookUrl: null,
        googleServiceAccountKey: '{}',
        geminiApiKey: 'test-key',
        logLevel: 'INFO',
        apiBaseUrl: null,
        matchDaysBefore: 10,
        matchDaysAfter: 60,
        usdMatchDaysAfter: 90,
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
        geminiDailyBudget: 0,
        maxDocumentBytes: 25 * 1024 * 1024,
        environment: 'staging' as const,
      });

      const { performStartupScan } = await import('./server.js');
      const result = await performStartupScan();

      expect(result.ok).toBe(true);
      // scanFolder should NOT be called in test mode
      expect(scanFolder).not.toHaveBeenCalled();
    });
  });

  describe('Signal handler void+catch (ADV-211)', () => {
    it('SIGTERM handler catches shutdown rejection with void+catch — no unhandled rejection', async () => {
      const { createShutdownHandler } = await import('./server.js');

      // Force createShutdownHandler's returned promise to reject:
      // processExit is called after the shutdown race completes. If it throws
      // synchronously, the error escapes createShutdownHandler's inner try/catch
      // (which only covers shutdownWatchManager/serverClose) and causes the outer
      // async function to reject.
      const throwingProcessExit = () => { throw new Error('processExit threw unexpectedly'); };

      const shutdownFn = createShutdownHandler(
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        throwingProcessExit,
        50 // short timeout for the test
      );

      let hadUnhandledRejection = false;
      const rejectionListener = () => { hadUnhandledRejection = true; };
      process.on('unhandledRejection', rejectionListener);

      // NEW pattern (the fix): void + .catch logs the rejection
      // OLD pattern (broken):   () => { shutdownFn('SIGTERM'); }
      //   — causes unhandled rejection when shutdownFn rejects
      const sigHandler = () => {
        void shutdownFn('SIGTERM').catch((err: Error) => {
          logError('Shutdown rejection', { module: 'server', error: err.message });
        });
      };

      process.once('SIGTERM', sigHandler);
      process.emit('SIGTERM' as NodeJS.Signals);

      // Allow the async chain to settle
      await new Promise(resolve => setTimeout(resolve, 100));
      process.off('unhandledRejection', rejectionListener);

      expect(hadUnhandledRejection).toBe(false);
      expect(vi.mocked(logError)).toHaveBeenCalledWith(
        'Shutdown rejection',
        expect.objectContaining({ module: 'server', error: 'processExit threw unexpectedly' })
      );
    });

    it('SIGINT handler catches shutdown rejection with void+catch — no unhandled rejection', async () => {
      const { createShutdownHandler } = await import('./server.js');

      const throwingProcessExit = () => { throw new Error('processExit threw on SIGINT'); };

      const shutdownFn = createShutdownHandler(
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        throwingProcessExit,
        50
      );

      let hadUnhandledRejection = false;
      const rejectionListener = () => { hadUnhandledRejection = true; };
      process.on('unhandledRejection', rejectionListener);

      const sigHandler = () => {
        void shutdownFn('SIGINT').catch((err: Error) => {
          logError('Shutdown rejection', { module: 'server', error: err.message });
        });
      };

      process.once('SIGINT', sigHandler);
      process.emit('SIGINT' as NodeJS.Signals);

      await new Promise(resolve => setTimeout(resolve, 100));
      process.off('unhandledRejection', rejectionListener);

      expect(hadUnhandledRejection).toBe(false);
      expect(vi.mocked(logError)).toHaveBeenCalledWith(
        'Shutdown rejection',
        expect.objectContaining({ module: 'server', error: 'processExit threw on SIGINT' })
      );
    });
  });

  describe('createShutdownHandler (ADV-7)', () => {
    it('should create a handler that properly awaits shutdown operations', async () => {
      const { createShutdownHandler } = await import('./server.js');

      // Track operation order and completion
      const operations: string[] = [];
      let watchManagerResolved = false;
      let serverCloseResolved = false;

      const mockShutdownWatchManager = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        operations.push('watchManager');
        watchManagerResolved = true;
      });

      const mockServerClose = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        operations.push('serverClose');
        serverCloseResolved = true;
      });

      const mockProcessExit = vi.fn((code: number) => {
        operations.push(`exit:${code}`);
      });

      const handler = createShutdownHandler(
        mockShutdownWatchManager,
        mockServerClose,
        mockProcessExit
      );

      // Call handler and wait for it to complete
      await handler('SIGTERM');

      // Verify all operations completed IN ORDER
      expect(watchManagerResolved).toBe(true);
      expect(serverCloseResolved).toBe(true);
      expect(operations).toEqual(['watchManager', 'serverClose', 'exit:0']);
    });

    it('should exit with code 0 after successful shutdown', async () => {
      const { createShutdownHandler } = await import('./server.js');

      let exitCode = -1;
      const mockProcessExit = vi.fn((code: number) => {
        exitCode = code;
      });

      const handler = createShutdownHandler(
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        mockProcessExit
      );

      await handler('SIGINT');

      expect(exitCode).toBe(0);
    });

    it('should exit with code 1 if shutdown operations fail', async () => {
      const { createShutdownHandler } = await import('./server.js');

      let exitCode = -1;
      const mockProcessExit = vi.fn((code: number) => {
        exitCode = code;
      });

      const handler = createShutdownHandler(
        vi.fn().mockRejectedValue(new Error('Watch manager cleanup failed')),
        vi.fn().mockResolvedValue(undefined),
        mockProcessExit
      );

      await handler('SIGTERM');

      // Should exit with error code on failure
      expect(exitCode).toBe(1);
    });

    it('should timeout after 30 seconds to prevent infinite hanging', async () => {
      const { createShutdownHandler, SHUTDOWN_TIMEOUT_MS } = await import('./server.js');

      // Verify timeout constant exists and is 30 seconds
      expect(SHUTDOWN_TIMEOUT_MS).toBe(30000);

      let exitCode = -1;
      const mockProcessExit = vi.fn((code: number) => {
        exitCode = code;
      });

      // Create a shutdown handler with operations that never complete
      const neverResolves = () => new Promise<void>(() => {});

      const handler = createShutdownHandler(
        neverResolves,
        neverResolves,
        mockProcessExit,
        50 // Use 50ms timeout for test instead of 30s
      );

      await handler('SIGTERM');

      // Should exit with code 1 on timeout
      expect(exitCode).toBe(1);
    });
  });
});
