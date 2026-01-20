/**
 * Watch Manager Service
 * Manages Google Drive push notification channels for real-time monitoring
 */

import * as cron from 'node-cron';
import { randomUUID } from 'crypto';
import { watchFolder, stopWatching as driveStopWatching } from './drive.js';
import { scanFolder } from '../processing/scanner.js';
import type { WatchChannel, WatchManagerStatus, Result } from '../types/index.js';
import { debug, info, error as logError } from '../utils/logger.js';

/**
 * Watch manager state
 */
let webhookUrl: string | null = null;
let activeChannels: Map<string, WatchChannel> = new Map();
let processedNotifications: Map<string, Set<string>> = new Map();
let lastNotificationTime: Date | null = null;
let lastScanTime: Date | null = null;
let renewalJob: cron.ScheduledTask | null = null;
let pollingJob: cron.ScheduledTask | null = null;
let runningScan: Promise<void> | null = null;
let hasPendingScan: boolean = false;
let pendingScanFolderId: string | undefined = undefined;

// Configuration
const CHANNEL_EXPIRATION_MS = 3600000; // 1 hour
const RENEWAL_THRESHOLD_MS = 600000; // Renew if expires within 10 minutes
const MAX_NOTIFICATION_AGE_MS = 3600000; // Keep notifications for 1 hour
const MAX_NOTIFICATIONS_PER_CHANNEL = 1000;

/**
 * Initialize watch manager with webhook URL and start cron jobs
 *
 * @param url - Public webhook URL for Drive notifications
 */
export function initWatchManager(url: string): void {
  webhookUrl = url;

  // Start channel renewal cron job (every 30 minutes)
  renewalJob = cron.schedule('*/30 * * * *', async () => {
    debug('Running channel renewal check', { module: 'watch-manager', phase: 'renewal' });
    await renewChannels();
  });

  // Start fallback polling cron job (every 5 minutes)
  pollingJob = cron.schedule('*/5 * * * *', () => {
    debug('Running fallback polling check', { module: 'watch-manager', phase: 'polling' });
    checkAndTriggerFallbackScan();
  });

  info('Watch manager initialized', { module: 'watch-manager', phase: 'init' });
}

/**
 * Start watching a folder for changes
 *
 * @param folderId - Folder ID to watch
 * @returns Result with channel info or error
 */
export async function startWatching(folderId: string): Promise<Result<WatchChannel>> {
  if (!webhookUrl) {
    return {
      ok: false,
      error: new Error('Watch manager not initialized'),
    };
  }

  // Check if already watching
  if (activeChannels.has(folderId)) {
    return {
      ok: false,
      error: new Error(`Already watching folder ${folderId}`),
    };
  }

  // Generate unique channel ID
  const channelId = randomUUID();

  // Set up watch with Drive API
  const result = await watchFolder(
    folderId,
    webhookUrl,
    channelId,
    CHANNEL_EXPIRATION_MS
  );

  if (!result.ok) {
    return result;
  }

  // Store channel info
  const channel: WatchChannel = {
    channelId,
    resourceId: result.value.resourceId,
    folderId,
    expiration: new Date(Number(result.value.expiration)),
    createdAt: new Date(),
  };

  activeChannels.set(folderId, channel);

  info('Started watching folder', {
    module: 'watch-manager',
    phase: 'start-watching',
    folderId,
    channelId,
    expiration: channel.expiration.toISOString()
  });

  return { ok: true, value: channel };
}

/**
 * Stop watching a folder
 *
 * @param folderId - Folder ID to stop watching
 * @returns Result indicating success or error
 */
export async function stopWatching(folderId: string): Promise<Result<void>> {
  const channel = activeChannels.get(folderId);

  if (!channel) {
    return {
      ok: false,
      error: new Error(`Folder ${folderId} is not being watched`),
    };
  }

  // Stop watching via Drive API
  const result = await driveStopWatching(channel.channelId, channel.resourceId);

  if (!result.ok) {
    return result;
  }

  // Remove from active channels
  activeChannels.delete(folderId);

  // Clean up processed notifications for this channel
  processedNotifications.delete(channel.channelId);

  info('Stopped watching folder', {
    module: 'watch-manager',
    phase: 'stop-watching',
    folderId
  });

  return { ok: true, value: undefined };
}

/**
 * Stop watching all folders
 * Used during graceful shutdown
 */
export async function stopAllWatching(): Promise<void> {
  const folderIds = Array.from(activeChannels.keys());

  for (const folderId of folderIds) {
    const result = await stopWatching(folderId);
    if (!result.ok) {
      logError('Failed to stop watching folder', {
        module: 'watch-manager',
        phase: 'stop-all-watching',
        folderId,
        error: result.error.message
      });
    }
  }

  info('Stopped all watch channels', {
    module: 'watch-manager',
    phase: 'stop-all-watching'
  });
}

/**
 * Get list of active watch channels
 *
 * @returns Array of active channels
 */
export function getActiveChannels(): WatchChannel[] {
  return Array.from(activeChannels.values());
}

/**
 * Check if a notification has already been processed
 *
 * @param messageNumber - Notification message number
 * @param channelId - Channel ID
 * @returns True if notification was already processed
 */
export function isNotificationDuplicate(
  messageNumber: string | undefined,
  channelId: string
): boolean {
  if (!messageNumber) {
    return false;
  }

  const channelNotifications = processedNotifications.get(channelId);
  return channelNotifications?.has(messageNumber) ?? false;
}

/**
 * Mark a notification as processed
 *
 * @param messageNumber - Notification message number
 * @param channelId - Channel ID
 */
export function markNotificationProcessed(
  messageNumber: string,
  channelId: string
): void {
  lastNotificationTime = new Date();

  let channelNotifications = processedNotifications.get(channelId);

  if (!channelNotifications) {
    channelNotifications = new Set();
    processedNotifications.set(channelId, channelNotifications);
  }

  channelNotifications.add(messageNumber);

  // Limit size to prevent memory growth
  if (channelNotifications.size > MAX_NOTIFICATIONS_PER_CHANNEL) {
    // Remove oldest entries (simple FIFO)
    const entries = Array.from(channelNotifications);
    const toRemove = entries.slice(0, channelNotifications.size - MAX_NOTIFICATIONS_PER_CHANNEL);
    toRemove.forEach(entry => channelNotifications!.delete(entry));
  }
}

/**
 * Trigger a scan of the folder
 * Runs scan directly (NOT queued) to avoid deadlock
 * The scan internally uses the processing queue for individual files
 * Prevents concurrent scans - if a scan is already running, queues a pending scan
 *
 * @param folderId - Optional folder ID to scan (defaults to all)
 */
export function triggerScan(folderId?: string): void {
  // If a scan is already running, queue a pending scan
  if (runningScan) {
    info('Scan already in progress, queuing pending scan', {
      module: 'watch-manager',
      phase: 'scan-trigger',
      folderId
    });
    hasPendingScan = true;
    pendingScanFolderId = folderId;
    return;
  }

  info('Starting folder scan', {
    module: 'watch-manager',
    phase: 'scan-trigger',
    folderId
  });

  // Run scan directly (not in queue) to avoid deadlock
  // The scanFolder function will use the queue for individual file processing
  runningScan = scanFolder(folderId)
    .then(result => {
      if (result.ok) {
        lastScanTime = new Date();
        info('Scan complete', {
          module: 'watch-manager',
          phase: 'scan-complete',
          filesProcessed: result.value.filesProcessed,
          errors: result.value.errors,
          facturasAdded: result.value.facturasAdded,
          pagosAdded: result.value.pagosAdded
        });
      } else {
        logError('Scan failed', {
          module: 'watch-manager',
          phase: 'scan-complete',
          error: result.error.message
        });
      }
    })
    .catch(err => {
      logError('Scan execution failed', {
        module: 'watch-manager',
        phase: 'scan-complete',
        error: err instanceof Error ? err.message : String(err)
      });
    })
    .finally(() => {
      runningScan = null;

      // If a pending scan was queued, trigger it now
      if (hasPendingScan) {
        const queuedFolderId = pendingScanFolderId;
        hasPendingScan = false;
        pendingScanFolderId = undefined;
        info('Starting pending scan', {
          module: 'watch-manager',
          phase: 'scan-trigger',
          folderId: queuedFolderId
        });
        triggerScan(queuedFolderId);
      }
    });
}

/**
 * Get watch manager status for health checks
 *
 * @returns Current status
 */
export function getWatchManagerStatus(): WatchManagerStatus {
  const now = Date.now();

  return {
    enabled: webhookUrl !== null,
    activeChannels: activeChannels.size,
    channels: Array.from(activeChannels.values()).map(channel => ({
      folderId: channel.folderId,
      expiresIn: channel.expiration.getTime() - now,
    })),
    lastNotification: lastNotificationTime,
    lastScan: lastScanTime,
  };
}

/**
 * Renew channels that are expiring soon
 * Called by the renewal cron job
 */
async function renewChannels(): Promise<void> {
  const now = Date.now();
  const channels = Array.from(activeChannels.values());

  for (const channel of channels) {
    const timeUntilExpiration = channel.expiration.getTime() - now;

    if (timeUntilExpiration < RENEWAL_THRESHOLD_MS) {
      info('Renewing channel', {
        module: 'watch-manager',
        phase: 'renewal',
        folderId: channel.folderId,
        expiresIn: timeUntilExpiration
      });

      // Stop old channel
      const stopResult = await stopWatching(channel.folderId);
      if (!stopResult.ok) {
        logError('Failed to stop old channel', {
          module: 'watch-manager',
          phase: 'renewal',
          folderId: channel.folderId,
          error: stopResult.error.message
        });
        continue;
      }

      // Start new channel
      const startResult = await startWatching(channel.folderId);
      if (!startResult.ok) {
        logError('Failed to start new channel', {
          module: 'watch-manager',
          phase: 'renewal',
          folderId: channel.folderId,
          error: startResult.error.message
        });
      }
    }
  }
}

/**
 * Check if we should trigger a fallback scan
 * Triggers if no notifications received in a while
 */
function checkAndTriggerFallbackScan(): void {
  if (activeChannels.size === 0) {
    // No channels active, skip
    return;
  }

  const now = Date.now();

  // If we haven't received notifications in a while, trigger a scan
  if (!lastNotificationTime || (now - lastNotificationTime.getTime() > MAX_NOTIFICATION_AGE_MS)) {
    info('No recent notifications, triggering fallback scan', {
      module: 'watch-manager',
      phase: 'fallback-scan'
    });
    triggerScan();
  }
}

/**
 * Shutdown watch manager
 * Stops cron jobs and all watch channels
 */
export async function shutdownWatchManager(): Promise<void> {
  info('Shutting down watch manager', {
    module: 'watch-manager',
    phase: 'shutdown'
  });

  // Stop cron jobs
  if (renewalJob) {
    renewalJob.stop();
    renewalJob = null;
  }

  if (pollingJob) {
    pollingJob.stop();
    pollingJob = null;
  }

  // Stop all watch channels
  await stopAllWatching();

  // Clear state
  activeChannels.clear();
  processedNotifications.clear();
  webhookUrl = null;
  lastNotificationTime = null;
  lastScanTime = null;
  runningScan = null;
  hasPendingScan = false;
  pendingScanFolderId = undefined;

  info('Watch manager shutdown complete', {
    module: 'watch-manager',
    phase: 'shutdown'
  });
}
