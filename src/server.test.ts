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
    apiSecret: 'test-secret',
    driveRootFolderId: 'test-root',
    webhookUrl: null,
    googleServiceAccountKey: '{}',
    geminiApiKey: 'test-key',
    logLevel: 'INFO',
    apiBaseUrl: null,
    matchDaysBefore: 10,
    matchDaysAfter: 60,
    usdArsTolerancePercent: 5,
    geminiRpmLimit: 150,
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
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
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
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
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
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
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
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
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
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
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
        usdArsTolerancePercent: 5,
        geminiRpmLimit: 150,
      });

      const { performStartupScan } = await import('./server.js');
      const result = await performStartupScan();

      expect(result.ok).toBe(true);
      // scanFolder should NOT be called in test mode
      expect(scanFolder).not.toHaveBeenCalled();
    });
  });
});
