/**
 * Webhook routes for external notifications
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Drive push notification headers
 */
interface DriveNotificationHeaders {
  'x-goog-channel-id'?: string;
  'x-goog-resource-id'?: string;
  'x-goog-resource-state'?: string;
  'x-goog-changed'?: string;
  'x-goog-message-number'?: string;
}

/**
 * Register webhook routes
 */
export async function webhookRoutes(server: FastifyInstance) {
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
  server.post('/drive', async (request: FastifyRequest<{ Headers: DriveNotificationHeaders }>, reply) => {
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

    // Handle sync message (initial subscription confirmation)
    if (resourceState === 'sync') {
      server.log.info('Drive watch channel synced');
      return reply.code(200).send({ status: 'synced' });
    }

    // Handle change notifications
    if (resourceState === 'change') {
      // TODO: Queue a scan of the folder
      // This will be implemented in Phase 3

      server.log.info('Change detected, queueing scan');
    }

    return reply.code(200).send({ status: 'received' });
  });
}
