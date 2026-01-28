import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  initWatchManager,
  shutdownWatchManager,
  cleanupExpiredNotifications,
  markNotificationProcessedWithTimestamp,
  getNotificationCount,
  getChannelCount,
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
});
