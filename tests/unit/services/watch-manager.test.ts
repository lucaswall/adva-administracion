/**
 * Unit tests for watch manager service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Result } from '../../../src/types/index.js';

// Mock dependencies before importing watch-manager
vi.mock('../../../src/services/drive.js', () => ({
  watchFolder: vi.fn(),
  stopWatching: vi.fn(),
}));

vi.mock('../../../src/processing/scanner.js', () => ({
  scanFolder: vi.fn(),
}));

vi.mock('../../../src/services/folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(),
}));

vi.mock('node-cron', () => ({
  schedule: vi.fn((cronExpression: string, callback: () => void) => ({
    stop: vi.fn(),
    start: vi.fn(),
  })),
}));

// Import after mocks
import {
  initWatchManager,
  startWatching,
  stopWatching,
  stopAllWatching,
  getActiveChannels,
  isNotificationDuplicate,
  markNotificationProcessed,
  triggerScan,
  getWatchManagerStatus,
  shutdownWatchManager,
} from '../../../src/services/watch-manager.js';
import * as drive from '../../../src/services/drive.js';
import * as scanner from '../../../src/processing/scanner.js';
import * as cron from 'node-cron';

describe('watch-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default mock for stopWatching to prevent errors in cleanup
    vi.mocked(drive.stopWatching).mockResolvedValue({ ok: true, value: undefined });
  });

  afterEach(async () => {
    // Clean up watch manager state
    await shutdownWatchManager();
  });

  describe('initWatchManager', () => {
    it('initializes with provided webhook URL', () => {
      initWatchManager('https://example.com/webhooks/drive');

      // Verify status shows enabled
      const status = getWatchManagerStatus();
      expect(status.enabled).toBe(true);
    });

    it('starts renewal cron job', () => {
      initWatchManager('https://example.com/webhooks/drive');

      expect(cron.schedule).toHaveBeenCalledWith(
        '*/30 * * * *',
        expect.any(Function)
      );
    });

    it('starts fallback polling cron job', () => {
      initWatchManager('https://example.com/webhooks/drive');

      expect(cron.schedule).toHaveBeenCalledWith(
        '*/5 * * * *',
        expect.any(Function)
      );
    });
  });

  describe('startWatching', () => {
    beforeEach(async () => {
      // Ensure clean state
      await shutdownWatchManager();
      initWatchManager('https://example.com/webhooks/drive');
    });

    it('calls drive.watchFolder with correct parameters', async () => {
      const mockWatchResult: Result<{ resourceId: string; expiration: string }> = {
        ok: true,
        value: {
          resourceId: 'resource123',
          expiration: String(Date.now() + 3600000),
        },
      };
      vi.mocked(drive.watchFolder).mockResolvedValue(mockWatchResult);

      const result = await startWatching('folder123');

      expect(result.ok).toBe(true);
      expect(drive.watchFolder).toHaveBeenCalledWith(
        'folder123',
        'https://example.com/webhooks/drive',
        expect.any(String),
        3600000
      );
    });

    it('stores channel in active channels', async () => {
      const mockWatchResult: Result<{ resourceId: string; expiration: string }> = {
        ok: true,
        value: {
          resourceId: 'resource123',
          expiration: String(Date.now() + 3600000),
        },
      };
      vi.mocked(drive.watchFolder).mockResolvedValue(mockWatchResult);

      await startWatching('folder123');

      const channels = getActiveChannels();
      expect(channels).toHaveLength(1);
      expect(channels[0].folderId).toBe('folder123');
      expect(channels[0].resourceId).toBe('resource123');
    });

    it('returns error when drive.watchFolder fails', async () => {
      const mockError: Result<{ resourceId: string; expiration: string }> = {
        ok: false,
        error: new Error('Watch failed'),
      };
      vi.mocked(drive.watchFolder).mockResolvedValue(mockError);

      const result = await startWatching('folder-unique-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Watch failed');
      }
    });
  });

  describe('stopWatching', () => {
    beforeEach(async () => {
      // Ensure clean state
      await shutdownWatchManager();
      initWatchManager('https://example.com/webhooks/drive');

      const mockWatchResult: Result<{ resourceId: string; expiration: string }> = {
        ok: true,
        value: {
          resourceId: 'resource123',
          expiration: String(Date.now() + 3600000),
        },
      };
      vi.mocked(drive.watchFolder).mockResolvedValue(mockWatchResult);
      await startWatching('folder123');
    });

    it('calls drive.stopWatching with correct parameters', async () => {
      const mockStopResult: Result<void> = { ok: true, value: undefined };
      vi.mocked(drive.stopWatching).mockResolvedValue(mockStopResult);

      const result = await stopWatching('folder123');

      expect(result.ok).toBe(true);
      expect(drive.stopWatching).toHaveBeenCalledWith(
        expect.any(String),
        'resource123'
      );
    });

    it('removes channel from active channels', async () => {
      const mockStopResult: Result<void> = { ok: true, value: undefined };
      vi.mocked(drive.stopWatching).mockResolvedValue(mockStopResult);

      await stopWatching('folder123');

      const channels = getActiveChannels();
      expect(channels).toHaveLength(0);
    });

    it('returns error when folder is not being watched', async () => {
      const result = await stopWatching('unknown-folder');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not being watched');
      }
    });
  });

  describe('stopAllWatching', () => {
    beforeEach(async () => {
      // Ensure clean state
      await shutdownWatchManager();
      initWatchManager('https://example.com/webhooks/drive');

      const mockWatchResult: Result<{ resourceId: string; expiration: string }> = {
        ok: true,
        value: {
          resourceId: 'resource123',
          expiration: String(Date.now() + 3600000),
        },
      };
      vi.mocked(drive.watchFolder).mockResolvedValue(mockWatchResult);
      await startWatching('folder1');
      await startWatching('folder2');
    });

    it('stops all active channels', async () => {
      const mockStopResult: Result<void> = { ok: true, value: undefined };
      vi.mocked(drive.stopWatching).mockResolvedValue(mockStopResult);

      await stopAllWatching();

      expect(drive.stopWatching).toHaveBeenCalledTimes(2);
      const channels = getActiveChannels();
      expect(channels).toHaveLength(0);
    });

    it('continues if stopping a channel fails', async () => {
      const mockFailResult: Result<void> = { ok: false, error: new Error('Stop failed') };
      vi.mocked(drive.stopWatching).mockResolvedValue(mockFailResult);

      await stopAllWatching();

      // Should attempt to stop all channels despite errors
      expect(drive.stopWatching).toHaveBeenCalledTimes(2);
    });
  });

  describe('isNotificationDuplicate and markNotificationProcessed', () => {
    beforeEach(async () => {
      // Ensure clean state
      await shutdownWatchManager();
      initWatchManager('https://example.com/webhooks/drive');
    });

    it('returns false for new notification', () => {
      const isDuplicate = isNotificationDuplicate('123', 'channel1');

      expect(isDuplicate).toBe(false);
    });

    it('returns true for processed notification', () => {
      markNotificationProcessed('123', 'channel1');
      const isDuplicate = isNotificationDuplicate('123', 'channel1');

      expect(isDuplicate).toBe(true);
    });

    it('tracks notifications per channel', () => {
      markNotificationProcessed('123', 'channel1');

      const isDuplicateChannel1 = isNotificationDuplicate('123', 'channel1');
      const isDuplicateChannel2 = isNotificationDuplicate('123', 'channel2');

      expect(isDuplicateChannel1).toBe(true);
      expect(isDuplicateChannel2).toBe(false);
    });

    it('handles undefined message number', () => {
      const isDuplicate = isNotificationDuplicate(undefined, 'channel1');

      expect(isDuplicate).toBe(false);
    });
  });

  describe('triggerScan', () => {
    beforeEach(async () => {
      // Ensure clean state
      await shutdownWatchManager();
      initWatchManager('https://example.com/webhooks/drive');
    });

    it('queues a scan via scanner.scanFolder', async () => {
      const mockScanResult = {
        ok: true,
        value: {
          filesProcessed: 5,
          facturasAdded: 2,
          pagosAdded: 1,
          recibosAdded: 0,
          matchesFound: 1,
          errors: 0,
          duration: 1000,
        },
      };
      vi.mocked(scanner.scanFolder).mockResolvedValue(mockScanResult);

      triggerScan();

      // Wait for the scan to be queued
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(scanner.scanFolder).toHaveBeenCalled();
    });

    it('passes folderId to scanner when provided', async () => {
      const mockScanResult = {
        ok: true,
        value: {
          filesProcessed: 5,
          facturasAdded: 2,
          pagosAdded: 1,
          recibosAdded: 0,
          matchesFound: 1,
          errors: 0,
          duration: 1000,
        },
      };
      vi.mocked(scanner.scanFolder).mockResolvedValue(mockScanResult);

      triggerScan('folder123');

      // Wait for the scan to be queued
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(scanner.scanFolder).toHaveBeenCalledWith('folder123');
    });

    it('updates lastScan timestamp', async () => {
      const mockScanResult = {
        ok: true,
        value: {
          filesProcessed: 5,
          facturasAdded: 2,
          pagosAdded: 1,
          recibosAdded: 0,
          matchesFound: 1,
          errors: 0,
          duration: 1000,
        },
      };
      vi.mocked(scanner.scanFolder).mockResolvedValue(mockScanResult);

      const beforeStatus = getWatchManagerStatus();
      expect(beforeStatus.lastScan).toBeNull();

      triggerScan();

      // Wait for the scan to be queued
      await new Promise(resolve => setTimeout(resolve, 100));

      const afterStatus = getWatchManagerStatus();
      expect(afterStatus.lastScan).not.toBeNull();
    });

    it('queues a pending scan when scan is triggered during active scan', async () => {
      // Mock a slow scan that takes 200ms
      let scanResolve: () => void;
      const scanPromise = new Promise<void>(resolve => {
        scanResolve = resolve;
      });

      const mockScanResult = {
        ok: true,
        value: {
          filesProcessed: 5,
          facturasAdded: 2,
          pagosAdded: 1,
          recibosAdded: 0,
          matchesFound: 1,
          errors: 0,
          duration: 1000,
        },
      };

      // First call will delay, second call returns immediately
      vi.mocked(scanner.scanFolder)
        .mockImplementationOnce(async () => {
          await scanPromise;
          return mockScanResult;
        })
        .mockResolvedValue(mockScanResult);

      // Trigger first scan (will be slow)
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Trigger second scan while first is running (should be queued)
      triggerScan('folder2');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Complete first scan
      scanResolve!();
      await new Promise(resolve => setTimeout(resolve, 150));

      // Both scans should have been called
      expect(scanner.scanFolder).toHaveBeenCalledTimes(2);
      expect(scanner.scanFolder).toHaveBeenNthCalledWith(1, 'folder1');
      expect(scanner.scanFolder).toHaveBeenNthCalledWith(2, 'folder2');
    });

    it('consolidates multiple pending scan requests into one', async () => {
      // Mock a slow scan
      let scanResolve: () => void;
      const scanPromise = new Promise<void>(resolve => {
        scanResolve = resolve;
      });

      const mockScanResult = {
        ok: true,
        value: {
          filesProcessed: 5,
          facturasAdded: 2,
          pagosAdded: 1,
          recibosAdded: 0,
          matchesFound: 1,
          errors: 0,
          duration: 1000,
        },
      };

      vi.mocked(scanner.scanFolder)
        .mockImplementationOnce(async () => {
          await scanPromise;
          return mockScanResult;
        })
        .mockResolvedValue(mockScanResult);

      // Trigger first scan (will be slow)
      triggerScan();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Trigger multiple scans while first is running (should consolidate)
      triggerScan();
      triggerScan();
      triggerScan();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Complete first scan
      scanResolve!();
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should only call scanFolder twice: once for initial, once for consolidated pending
      expect(scanner.scanFolder).toHaveBeenCalledTimes(2);
    });
  });

  describe('getWatchManagerStatus', () => {
    it('returns disabled status before initialization', async () => {
      // Ensure clean state
      await shutdownWatchManager();

      const status = getWatchManagerStatus();

      expect(status.enabled).toBe(false);
      expect(status.activeChannels).toBe(0);
      expect(status.channels).toEqual([]);
      expect(status.lastNotification).toBeNull();
      expect(status.lastScan).toBeNull();
    });

    it('returns enabled status after initialization', async () => {
      // Ensure clean state
      await shutdownWatchManager();
      initWatchManager('https://example.com/webhooks/drive');

      const status = getWatchManagerStatus();

      expect(status.enabled).toBe(true);
    });

    it('includes active channels in status', async () => {
      // Ensure clean state
      await shutdownWatchManager();
      initWatchManager('https://example.com/webhooks/drive');

      const mockWatchResult: Result<{ resourceId: string; expiration: string }> = {
        ok: true,
        value: {
          resourceId: 'resource123',
          expiration: String(Date.now() + 3600000),
        },
      };
      vi.mocked(drive.watchFolder).mockResolvedValue(mockWatchResult);
      await startWatching('folder123');

      const status = getWatchManagerStatus();

      expect(status.activeChannels).toBe(1);
      expect(status.channels).toHaveLength(1);
      expect(status.channels[0].folderId).toBe('folder123');
      expect(status.channels[0].expiresIn).toBeGreaterThan(0);
    });
  });

  describe('shutdownWatchManager', () => {
    it('stops all cron jobs', async () => {
      // Ensure clean state
      await shutdownWatchManager();

      const mockStopFn = vi.fn();
      vi.mocked(cron.schedule).mockReturnValue({
        stop: mockStopFn,
        start: vi.fn(),
      });

      initWatchManager('https://example.com/webhooks/drive');
      await shutdownWatchManager();

      // Should stop both renewal and polling jobs
      expect(mockStopFn).toHaveBeenCalledTimes(2);
    });

    it('stops all watch channels', async () => {
      // Ensure clean state
      await shutdownWatchManager();
      initWatchManager('https://example.com/webhooks/drive');

      const mockWatchResult: Result<{ resourceId: string; expiration: string }> = {
        ok: true,
        value: {
          resourceId: 'resource123',
          expiration: String(Date.now() + 3600000),
        },
      };
      vi.mocked(drive.watchFolder).mockResolvedValue(mockWatchResult);
      await startWatching('folder123');

      const mockStopResult: Result<void> = { ok: true, value: undefined };
      vi.mocked(drive.stopWatching).mockResolvedValue(mockStopResult);

      await shutdownWatchManager();

      expect(drive.stopWatching).toHaveBeenCalled();
    });
  });
});
