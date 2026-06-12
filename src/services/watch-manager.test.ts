import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  initWatchManager,
  shutdownWatchManager,
  cleanupExpiredNotifications,
  markNotificationProcessedWithTimestamp,
  getNotificationCount,
  getChannelCount,
  startWatching,
  getActiveChannels,
  triggerScan,
  checkAndMarkNotification,
  resetConsecutiveFailures,
} from './watch-manager.js';
import * as cron from 'node-cron';
import * as logger from '../utils/logger.js';
import { watchFolder } from './drive.js';
import { scanFolder } from '../processing/scanner.js';

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
  stopWatching: vi.fn(async () => ({ ok: true, value: undefined })),
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

// Mock status sheet
vi.mock('./status-sheet.js', () => ({
  updateStatusSheet: vi.fn(async () => undefined),
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

describe('triggerScan - failure handling (ADV-18)', () => {
    beforeEach(() => {
      // Reset the consecutive failure counter before each test
      resetConsecutiveFailures();
    });

    it('should stop triggering scans after consecutive failures', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      // All scans fail
      mockScanFolder.mockResolvedValue({
        ok: false,
        error: new Error('Simulated scan failure')
      });

      // Trigger multiple scans - queue more than MAX_CONSECUTIVE_FAILURES (3)
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue additional scans - these should be limited by failure threshold
      triggerScan('folder2');
      triggerScan('folder3');
      triggerScan('folder4');
      triggerScan('folder5');

      // Wait for all processing to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // After MAX_CONSECUTIVE_FAILURES (3), should stop processing pending scans
      // Should see exactly 3 calls (folder1, folder2, folder3), then stops
      expect(mockScanFolder).toHaveBeenCalledTimes(3);
    });

    it('should reset failure counter on successful scan', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      const scanPromises: Array<{ resolve: (value: any) => void }> = [];

      mockScanFolder.mockImplementation(() => {
        return new Promise((resolve) => {
          scanPromises.push({ resolve });
        });
      });

      // First scan
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue more scans
      triggerScan('folder2');

      // First scan succeeds - counter should reset
      scanPromises[0].resolve({
        ok: true,
        value: { filesProcessed: 1, errors: 0, facturasAdded: 0, pagosAdded: 0, recibosAdded: 0, matchesFound: 0, duration: 0 }
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second scan should proceed (counter was reset)
      expect(mockScanFolder).toHaveBeenCalledTimes(2);

      // Second scan succeeds
      scanPromises[1].resolve({
        ok: true,
        value: { filesProcessed: 1, errors: 0, facturasAdded: 0, pagosAdded: 0, recibosAdded: 0, matchesFound: 0, duration: 0 }
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should stop immediately on auth failure without retries', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      // Use a controlled promise to simulate slow auth failure
      const scanPromises: Array<{ reject: (err: Error) => void }> = [];

      mockScanFolder.mockImplementation(() => {
        return new Promise((_, reject) => {
          scanPromises.push({ reject: (err: Error) => reject(err) });
        });
      });

      // Trigger first scan
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue additional scans while first is running
      triggerScan('folder2');
      triggerScan('folder3');

      // Now trigger auth failure for first scan
      scanPromises[0].reject(new Error('Invalid Credentials'));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should NOT trigger any pending scans after auth failure - only 1 call
      expect(mockScanFolder).toHaveBeenCalledTimes(1);
    });

    it('should not trigger pending scan when scan execution throws (after max failures)', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      // Throw error instead of returning Result
      mockScanFolder.mockRejectedValue(new Error('Unexpected crash'));

      // Trigger multiple scans to hit MAX_CONSECUTIVE_FAILURES
      triggerScan('folder1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue more scans than MAX_CONSECUTIVE_FAILURES
      triggerScan('folder2');
      triggerScan('folder3');
      triggerScan('folder4');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Should only run 3 scans (MAX_CONSECUTIVE_FAILURES) then stop
      expect(mockScanFolder).toHaveBeenCalledTimes(3);
    });
  });

  describe('cron callback error handling (ADV-201)', () => {
    it('status-update cron catches errors and logs them instead of propagating', async () => {
      // Make getCachedFolderStructure return a folder structure so updateStatusSheet is called
      const { getCachedFolderStructure } = await import('./folder-structure.js');
      vi.mocked(getCachedFolderStructure).mockReturnValue({
        dashboardOperativoId: 'test-dashboard-id',
      } as any);

      // Make updateStatusSheet reject to simulate an error
      const { updateStatusSheet } = await import('./status-sheet.js');
      vi.mocked(updateStatusSheet).mockRejectedValue(new Error('Sheets API down'));

      // Init watch manager (registers 4 cron jobs)
      initWatchManager('http://localhost:3000/webhook');

      // Extract the status-update cron callback (index 2: renewal=0, polling=1, status=2, cleanup=3)
      const cronScheduleMock = vi.mocked(cron.schedule);
      const statusUpdateFn = cronScheduleMock.mock.calls[2][1] as () => void | Promise<void>;

      // Track unhandled rejections
      let hadUnhandledRejection = false;
      const rejectionListener = () => { hadUnhandledRejection = true; };
      process.on('unhandledRejection', rejectionListener);

      // Invoke callback — after fix, it returns void and catches errors internally
      statusUpdateFn();

      // Allow the async runCronTask to complete (fire-and-forget pattern)
      await new Promise(resolve => setTimeout(resolve, 10));

      process.off('unhandledRejection', rejectionListener);

      // No unhandled rejection should have fired
      expect(hadUnhandledRejection).toBe(false);

      // The error should have been logged
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Cron task failed',
        expect.objectContaining({
          module: 'watch-manager',
          phase: 'status-update',
          error: 'Sheets API down',
        })
      );
    });

    it('renewal cron does not propagate errors as unhandled rejections', async () => {
      initWatchManager('http://localhost:3000/webhook');

      // Index 0 = renewal cron
      const cronScheduleMock = vi.mocked(cron.schedule);
      const renewalFn = cronScheduleMock.mock.calls[0][1] as () => void;

      let hadUnhandledRejection = false;
      const rejectionListener = () => { hadUnhandledRejection = true; };
      process.on('unhandledRejection', rejectionListener);

      renewalFn();
      await new Promise(resolve => setTimeout(resolve, 10));
      process.off('unhandledRejection', rejectionListener);

      expect(hadUnhandledRejection).toBe(false);
    });

    it('cleanup cron does not propagate errors as unhandled rejections', async () => {
      initWatchManager('http://localhost:3000/webhook');

      // Index 3 = cleanup cron
      const cronScheduleMock = vi.mocked(cron.schedule);
      const cleanupFn = cronScheduleMock.mock.calls[3][1] as () => void;

      let hadUnhandledRejection = false;
      const rejectionListener = () => { hadUnhandledRejection = true; };
      process.on('unhandledRejection', rejectionListener);

      cleanupFn();
      await new Promise(resolve => setTimeout(resolve, 10));
      process.off('unhandledRejection', rejectionListener);

      expect(hadUnhandledRejection).toBe(false);
    });
  });

  describe('channel renewal failure (ADV-303)', () => {
    it('keeps channel in activeChannels when startWatching fails during renewal', async () => {
      // Arrange: add a channel with an expiration in the past so renewal triggers
      vi.mocked(watchFolder).mockResolvedValueOnce({
        ok: true,
        value: { resourceId: 'old-resource', expiration: String(Date.now() - 1000) },
      });
      initWatchManager('http://localhost:3000/webhook');
      await startWatching('test-folder');
      expect(getActiveChannels()).toHaveLength(1);

      // Act: make the next startWatching call (during renewal) fail
      vi.mocked(watchFolder).mockResolvedValueOnce({
        ok: false,
        error: new Error('Drive API error'),
      });

      // Trigger the renewal cron callback (index 0 = renewal job)
      const cronScheduleMock = vi.mocked(cron.schedule);
      const renewalFn = cronScheduleMock.mock.calls[0][1] as () => void;
      renewalFn();
      await new Promise(resolve => setTimeout(resolve, 20));

      // Assert: channel must still be present so fallback polling continues
      // and the next renewal cycle can retry (ADV-303)
      expect(getActiveChannels()).toHaveLength(1);
    });
  });

  describe('skipped scan re-queue (ADV-312)', () => {
    it('triggers follow-up scan when scanFolder returns skipped due to concurrent scan', async () => {
      // Use fake timers so we can advance past the backoff delay without waiting real seconds
      vi.useFakeTimers();

      try {
        initWatchManager('http://localhost:3000/webhook');

        // First call: scan is skipped (another scan already running)
        vi.mocked(scanFolder).mockResolvedValueOnce({
          ok: true,
          value: {
            skipped: true,
            reason: 'scan_running',
            filesProcessed: 0, facturasAdded: 0, pagosAdded: 0,
            recibosAdded: 0, matchesFound: 0, errors: 0, duration: 0,
          },
        });
        // Second call: succeeds
        vi.mocked(scanFolder).mockResolvedValueOnce({
          ok: true,
          value: {
            filesProcessed: 1, facturasAdded: 0, pagosAdded: 0,
            recibosAdded: 0, matchesFound: 0, errors: 0, duration: 50,
          },
        });

        triggerScan('test-folder');

        // Flush microtasks so the initial skipped scan settles and its timer is registered
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Advance past the backoff delay to fire the deferred retry timer
        await vi.advanceTimersByTimeAsync(15_000);

        // scanFolder must be called twice: once (skipped) + once (follow-up after backoff)
        expect(vi.mocked(scanFolder)).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('triggerScan - deferred retry backoff (ADV-359)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not retry a skipped scan before the backoff delay elapses', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      // First call: skipped (scanner is busy with an external scan)
      mockScanFolder.mockResolvedValueOnce({
        ok: true,
        value: {
          skipped: true,
          reason: 'scan_running',
          filesProcessed: 0, facturasAdded: 0, pagosAdded: 0,
          recibosAdded: 0, matchesFound: 0, errors: 0, duration: 0,
        },
      });

      triggerScan('test-folder');

      // Flush microtasks so the initial scan promise chain settles
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Advance 1 ms — with old code (setTimeout 0) the retry timer fires;
      // with the fix (backoff >= 5 s) it must not.
      await vi.advanceTimersByTimeAsync(1);

      // Retry must NOT have fired yet
      expect(mockScanFolder).toHaveBeenCalledTimes(1);
    });

    it('does not stack extra timers when triggerScan is called while a retry is pending', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      // First two calls return skipped; subsequent calls use the default success mock
      mockScanFolder
        .mockResolvedValueOnce({
          ok: true,
          value: {
            skipped: true,
            reason: 'scan_running',
            filesProcessed: 0, facturasAdded: 0, pagosAdded: 0,
            recibosAdded: 0, matchesFound: 0, errors: 0, duration: 0,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            skipped: true,
            reason: 'scan_running',
            filesProcessed: 0, facturasAdded: 0, pagosAdded: 0,
            recibosAdded: 0, matchesFound: 0, errors: 0, duration: 0,
          },
        });

      // First trigger — skipped, sets a deferred retry timer
      triggerScan('test-folder');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Second trigger while retry timer is pending — must not add a second timer
      triggerScan('test-folder');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Advance 1 ms — with old code (no guard, setTimeout 0) both stacked timers fire
      // → 4 total calls. With the fix (backoff > 1 ms) no timers fire → still 2 calls.
      await vi.advanceTimersByTimeAsync(1);

      expect(mockScanFolder).toHaveBeenCalledTimes(2);
    });

    it('clears a pending deferred retry timer when an auth failure pauses scanning', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);
      resetConsecutiveFailures();

      // First call: skipped (scanner busy) — sets the deferred retry timer
      mockScanFolder
        .mockResolvedValueOnce({
          ok: true,
          value: {
            skipped: true,
            reason: 'scan_running',
            filesProcessed: 0, facturasAdded: 0, pagosAdded: 0,
            recibosAdded: 0, matchesFound: 0, errors: 0, duration: 0,
          },
        })
        // Second call: permanent auth failure — must clear the pending timer
        .mockResolvedValueOnce({
          ok: false,
          error: new Error('Invalid Credentials'),
        });

      // Skipped scan sets a 10 s deferred retry timer
      triggerScan('test-folder');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Auth-failure scan — its finally block pauses scanning and must also
      // cancel the orphaned deferred timer
      triggerScan('other-folder');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Advance well past the backoff — the orphaned timer must NOT fire
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockScanFolder).toHaveBeenCalledTimes(2);
    });

    it('clears a pending deferred retry timer when max consecutive failures pause scanning', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);
      resetConsecutiveFailures();

      // First call: skipped — sets the deferred retry timer.
      // Next three calls: failures — third one reaches MAX_CONSECUTIVE_FAILURES (3).
      mockScanFolder
        .mockResolvedValueOnce({
          ok: true,
          value: {
            skipped: true,
            reason: 'scan_running',
            filesProcessed: 0, facturasAdded: 0, pagosAdded: 0,
            recibosAdded: 0, matchesFound: 0, errors: 0, duration: 0,
          },
        })
        .mockResolvedValue({
          ok: false,
          error: new Error('Simulated scan failure'),
        });

      // Skipped scan sets a 10 s deferred retry timer
      triggerScan('test-folder');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Three consecutive failures reach the pause threshold
      for (const folder of ['f1', 'f2', 'f3']) {
        triggerScan(folder);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }

      expect(mockScanFolder).toHaveBeenCalledTimes(4);

      // Advance well past the backoff — the orphaned timer must NOT fire
      // (the pause decision would otherwise be bypassed)
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockScanFolder).toHaveBeenCalledTimes(4);
    });

    it('shutdownWatchManager clears a pending deferred retry timer', async () => {
      const { scanFolder } = await import('../processing/scanner.js');
      const mockScanFolder = vi.mocked(scanFolder);

      // Skipped scan sets the deferred retry timer
      mockScanFolder.mockResolvedValueOnce({
        ok: true,
        value: {
          skipped: true,
          reason: 'scan_running',
          filesProcessed: 0, facturasAdded: 0, pagosAdded: 0,
          recibosAdded: 0, matchesFound: 0, errors: 0, duration: 0,
        },
      });

      triggerScan('test-folder');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      await shutdownWatchManager();

      // Advance past the backoff — the cleared timer must not fire
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockScanFolder).toHaveBeenCalledTimes(1);
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
