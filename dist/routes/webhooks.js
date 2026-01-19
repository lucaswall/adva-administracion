/**
 * Webhook routes for external notifications
 */
import { getActiveChannels, isNotificationDuplicate, markNotificationProcessed, triggerScan, } from '../services/watch-manager.js';
/**
 * Register webhook routes
 */
export async function webhookRoutes(server) {
    /**
     * POST /webhooks/drive - Handle Drive push notifications
     *
     * Google Drive sends notifications when files change in a watched folder.
     * This endpoint receives those notifications and triggers processing.
     *
     * Headers include:
     * - X-Goog-Channel-ID: Our channel ID
     * - X-Goog-Resource-ID: Resource being watched
     * - X-Goog-Resource-State: 'sync' (initial), 'change', 'remove', etc.
     * - X-Goog-Changed: Comma-separated list of changed aspects
     * - X-Goog-Message-Number: Sequence number
     */
    server.post('/drive', async (request, reply) => {
        const headers = request.headers;
        const channelId = headers['x-goog-channel-id'];
        const resourceId = headers['x-goog-resource-id'];
        const resourceState = headers['x-goog-resource-state'];
        const changed = headers['x-goog-changed'];
        const messageNumber = headers['x-goog-message-number'];
        server.log.info({
            channelId,
            resourceId,
            resourceState,
            changed,
            messageNumber
        }, 'Drive notification received');
        // Validate channel ID is present
        if (!channelId) {
            server.log.warn('Received notification without channel ID');
            return reply.code(200).send({ status: 'ignored', reason: 'missing_channel_id' });
        }
        // Validate channel ID matches an active channel
        const activeChannels = getActiveChannels();
        const channel = activeChannels.find(c => c.channelId === channelId);
        if (!channel) {
            server.log.warn({ channelId }, 'Received notification for unknown channel');
            return reply.code(200).send({ status: 'ignored', reason: 'unknown_channel' });
        }
        // Check for duplicate notification
        if (messageNumber && isNotificationDuplicate(messageNumber, channelId)) {
            server.log.debug({ channelId, messageNumber }, 'Duplicate notification ignored');
            return reply.code(200).send({ status: 'duplicate' });
        }
        // Handle sync message (initial subscription confirmation)
        if (resourceState === 'sync') {
            server.log.info({ channelId }, 'Drive watch channel synced');
            return reply.code(200).send({ status: 'synced' });
        }
        // Handle change notifications
        if (resourceState === 'change') {
            // Mark notification as processed
            if (messageNumber) {
                markNotificationProcessed(messageNumber, channelId);
            }
            // Queue scan for the watched folder
            server.log.info({ channelId, changed }, 'Change detected, queueing scan');
            triggerScan(channel.folderId);
            return reply.code(200).send({ status: 'queued' });
        }
        // Handle other states (remove, update, etc.)
        server.log.debug({ channelId, resourceState }, 'Unhandled resource state');
        return reply.code(200).send({ status: 'received' });
    });
}
