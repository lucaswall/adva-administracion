import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  initWatchManager,
  shutdownWatchManager,
  cleanupExpiredNotifications,
  markNotificationProcessedWithTimestamp,
  getNotificationCount,
  getChannelCount,
  triggerScan,
  checkAndMarkNotification,
} from './watch-manager.js';
import * as cron from 'node-cron';

// Mock node-cron
vi.mock('node-cron', () => ({
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Mock drive service
vi.mock('./drive.js', () => ({
  watchFolder: vi.fn(async () => ({ ok: true, value: { channelId: 'test-channel', resourceId: 'test-resource', expiration: Date.now() + 86400000 } })),
}));

// Mock config
vi.mock('../config.js', () => ({
  getConfig: () => ({
    driveRootFolderId: 'test-root-folder',
    apiBaseUrl: 'http://localhost:3000',
  }),
}));

// Mock scanner
vi.mock('../processing/scanner.js', () => ({
  scanFolder: vi.fn(async () => ({
    ok: true,
    value: {
      filesProcessed: 0,
      errors: 0,
      facturasAdded: 0,
      pagosAdded: 0
    }
  })),
}));

// Mock folder structure
vi.mock('./folder-structure.js', () => ({
  getCachedFolderStructure: vi.fn(() => null),
}));

describe('watch-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await shutdownWatchManager();
  });

  describe('cleanupExpiredNotifications', () => {
    it('should remove expired notifications', () => {
      const channelId = 'test-channel';
      const now = Date.now();
      const thirtyMinutesAgo = now - 1800000; // Within 1 hour limit
      const twoHoursAgo = now - 7200000; // Beyond 1 hour limit

      // Mark some notifications with different timestamps
      markNotificationProcessedWithTimestamp('resource-old', channelId, twoHoursAgo);
      markNotificationProcessedWithTimestamp('resource-recent', channelId, thirtyMinutesAgo);

      // Verify 2 notifications exist
      expect(getNotificationCount()).toBe(2);
      expect(getChannelCount()).toBe(1);

      // Run cleanup
      cleanupExpiredNotifications();

      // Only 1 notification should remain (the recent one)
      expect(getNotificationCount()).toBe(1);
      expect(getChannelCount()).toBe(1);
    });

    it('should handle empty channels after cleanup', () => {
      const channelId = 'test-channel';
      const twoHoursAgo = Date.now() - 7200000;

      // Mark old notification
      markNotificationProcessedWithTimestamp('resource-1', channelId, twoHoursAgo);

      expect(getNotificationCount()).toBe(1);
      expect(getChannelCount()).toBe(1);

      // Run cleanup
      cleanupExpiredNotifications();

      // Channel should be removed entirely (empty map removal)
      expect(getNotificationCount()).toBe(0);
      expect(getChannelCount()).toBe(0);
    });

    it('should cleanup across multiple channels', () => {
      const now = Date.now();
      const twoHoursAgo = now - 7200000;
      const thirtyMinutesAgo = now - 1800000;

      // Mark notifications in different channels
      markNotificationProcessedWithTimestamp('resource-1', 'channel-1', twoHoursAgo);
      markNotificationProcessedWithTimestamp('resource-2', 'channel-2', twoHoursAgo);
      markNotificationProcessedWithTimestamp('resource-3', 'channel-3', thirtyMinutesAgo);

      // 3 notifications across 3 channels
      expect(getNotificationCount()).toBe(3);
      expect(getChannelCount()).toBe(3);

      // Run cleanup
      cleanupExpiredNotifications();

      // Only 1 notification and 1 channel should remain
      // (channels 1 and 2 are removed because they're empty)
      expect(getNotificationCount()).toBe(1);
      expect(getChannelCount()).toBe(1);
    });

    it('should handle cleanup with no notifications', () => {
      // Should not throw when no notifications exist
      expect(() => cleanupExpiredNotifications()).not.toThrow();
    });
  });

  describe('initWatchManager', () => {
    it('should schedule cleanup job on initialization', () => {
      initWatchManager('http://localhost:3000/webhook');

      // Verify cron.schedule was called 4 times (renewal, polling, status, cleanup)
      expect(cron.schedule).toHaveBeenCalledTimes(4);

      // Verify cleanup job schedule pattern (every 10 minutes)
      expect(cron.schedule).toHaveBeenCalledWith(
        '*/10 * * * *',
        expect.any(Function)
      );
    });
  });

  describe('shutdownWatchManager', () => {
    it('should stop cleanup job', async () => {
      const mockCleanupJob = { stop: vi.fn() };
      const mockRenewalJob = { stop: vi.fn() };
      const mockPollingJob = { stop: vi.fn() };
      const mockStatusJob = { stop: vi.fn() };

      vi.mocked(cron.schedule)
        .mockReturnValueOnce(mockRenewalJob as any)  // renewal job
        .mockReturnValueOnce(mockPollingJob as any)   // polling job
        .mockReturnValueOnce(mockStatusJob as any)    // status job
        .mockReturnValueOnce(mockCleanupJob as any);  // cleanup job

      initWatchManager('http://localhost:3000/webhook');
      await shutdownWatchManager();

      // Verify cleanup job was stopped
      expect(mockCleanupJob.stop).toHaveBeenCalled();
    });
  });

  describe('triggerScan - pending scan queue', () => {
    it('should queue multiple triggerScan calls with different folderIds', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      // First call will complete immediately, second and third will be queued
      const scanPromises: Array<{ resolve: () => void }> = [];

      mockScanFolder.mockImplementation(() => {
        return new Promise((resolve) => {
          scanPromises.push({
            resolve: () => resolve({
              ok: true,
              value: { filesProcessed: 0, errors: 0, facturasAdded: 0, pagosAdded: 0, recibosAdded: 0, matchesFound: 0, duration: 0 }
            })
          });
        });
      });

      // Trigger first scan (will start)
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10)); // Let it start

      // Trigger second and third scans while first is running (will be queued)
      triggerScan('folder2');
      triggerScan('folder3');

      // Should only have called scanFolder once so far
      expect(mockScanFolder).toHaveBeenCalledTimes(1);
      expect(mockScanFolder).toHaveBeenCalledWith('folder1');

      // Complete first scan - this should trigger folder2
      scanPromises[0].resolve();
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for promise chain

      // Should have started folder2
      expect(mockScanFolder).toHaveBeenCalledTimes(2);

      // Complete folder2 scan - this should trigger folder3
      scanPromises[1].resolve();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have started folder3
      expect(mockScanFolder).toHaveBeenCalledTimes(3);

      // Complete folder3 scan
      scanPromises[2].resolve();
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should process all pending scans in order after current scan completes', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      const scanPromises: Array<{ resolve: () => void }> = [];

      mockScanFolder.mockImplementation(() => {
        return new Promise((resolve) => {
          scanPromises.push({
            resolve: () => resolve({
              ok: true,
              value: { filesProcessed: 0, errors: 0, facturasAdded: 0, pagosAdded: 0, recibosAdded: 0, matchesFound: 0, duration: 0 }
            })
          });
        });
      });

      // Trigger scans
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10));

      triggerScan('folder2');
      triggerScan('folder3');

      // Complete first scan
      scanPromises[0].resolve();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Complete second pending scan
      scanPromises[1].resolve();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have processed folder3 as well
      scanPromises[2].resolve();
      await new Promise(resolve => setTimeout(resolve, 50));

      // All three scans should have been processed
      expect(mockScanFolder).toHaveBeenCalledTimes(3);
      expect(mockScanFolder).toHaveBeenNthCalledWith(1, 'folder1');
      // folder2 and folder3 are both in the queue (Set maintains insertion order)
      const secondCall = mockScanFolder.mock.calls[1][0];
      const thirdCall = mockScanFolder.mock.calls[2][0];
      expect([secondCall, thirdCall]).toContain('folder2');
      expect([secondCall, thirdCall]).toContain('folder3');
    });

    it('should deduplicate folderIds in pending queue', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      const scanPromises: Array<{ resolve: () => void }> = [];

      mockScanFolder.mockImplementation(() => {
        return new Promise((resolve) => {
          scanPromises.push({
            resolve: () => resolve({
              ok: true,
              value: { filesProcessed: 0, errors: 0, facturasAdded: 0, pagosAdded: 0, recibosAdded: 0, matchesFound: 0, duration: 0 }
            })
          });
        });
      });

      // Trigger first scan
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue same folder multiple times
      triggerScan('folder2');
      triggerScan('folder2');
      triggerScan('folder2');

      // Complete first scan
      scanPromises[0].resolve();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should only scan folder2 once (deduplicated)
      expect(mockScanFolder).toHaveBeenCalledTimes(2);
      expect(mockScanFolder).toHaveBeenNthCalledWith(2, 'folder2');

      // Complete pending scan
      scanPromises[1].resolve();
      await new Promise(resolve => setTimeout(resolve, 50));

      // No additional scans
      expect(mockScanFolder).toHaveBeenCalledTimes(2);
    });

    it('should handle undefined folderId (full scan) specially', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      const scanPromises: Array<{ resolve: () => void }> = [];

      mockScanFolder.mockImplementation(() => {
        return new Promise((resolve) => {
          scanPromises.push({
            resolve: () => resolve({
              ok: true,
              value: { filesProcessed: 0, errors: 0, facturasAdded: 0, pagosAdded: 0, recibosAdded: 0, matchesFound: 0, duration: 0 }
            })
          });
        });
      });

      // Trigger first scan
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue full scan and specific folder scan
      triggerScan(undefined); // full scan
      triggerScan('folder2');

      // Complete first scan
      scanPromises[0].resolve();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should process both pending scans
      expect(mockScanFolder).toHaveBeenCalledTimes(2);

      // Complete remaining scans
      scanPromises[1].resolve();
      await new Promise(resolve => setTimeout(resolve, 50));
      scanPromises[2].resolve();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockScanFolder).toHaveBeenCalledTimes(3);
    });
  });

  describe('triggerScan - recursive calls in finally block', () => {
    it('should not have concurrent execution pile-up', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      // Track concurrent executions
      let currentConcurrency = 0;
      let maxConcurrency = 0;
      const scanPromises: Array<{ resolve: () => void }> = [];

      mockScanFolder.mockImplementation(() => {
        currentConcurrency++;
        maxConcurrency = Math.max(maxConcurrency, currentConcurrency);

        return new Promise((resolve) => {
          scanPromises.push({
            resolve: () => {
              currentConcurrency--;
              resolve({
                ok: true,
                value: { filesProcessed: 0, errors: 0, facturasAdded: 0, pagosAdded: 0, recibosAdded: 0, matchesFound: 0, duration: 0 }
              });
            }
          });
        });
      });

      // Trigger 5 scans - first starts, others are queued
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10));
      triggerScan('folder2');
      triggerScan('folder3');
      triggerScan('folder4');
      triggerScan('folder5');

      // Complete all scans sequentially
      for (let i = 0; i < 5; i++) {
        if (scanPromises[i]) {
          scanPromises[i].resolve();
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Should never have more than 1 concurrent scan
      expect(maxConcurrency).toBe(1);
      // All 5 folders should have been scanned
      expect(mockScanFolder).toHaveBeenCalledTimes(5);
    });
  });

  describe('checkAndMarkNotification - concurrent calls', () => {
    it('should handle 10 concurrent calls with same messageNumber atomically', async () => {
      const channelId = 'test-channel';
      const messageNumber = '12345';

      // Spawn 10 concurrent calls with the same messageNumber
      const concurrentCalls = Array.from({ length: 10 }, () =>
        Promise.resolve(checkAndMarkNotification(messageNumber, channelId))
      );

      // Wait for all calls to complete
      const results = await Promise.all(concurrentCalls);

      // Exactly one should return true (new), 9 should return false (duplicate)
      const trueCount = results.filter(r => r === true).length;
      const falseCount = results.filter(r => r === false).length;

      expect(trueCount).toBe(1);
      expect(falseCount).toBe(9);
    });

    it('should return true for undefined messageNumber (legacy behavior)', () => {
      const result = checkAndMarkNotification(undefined, 'test-channel');
      expect(result).toBe(true);
    });

    it('should mark different messageNumbers as new', () => {
      const channelId = 'test-channel';

      const result1 = checkAndMarkNotification('msg-1', channelId);
      const result2 = checkAndMarkNotification('msg-2', channelId);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });
  });
});
