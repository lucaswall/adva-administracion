/**
 * Unit tests for webhook routes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server.js';

// Mock watch manager
vi.mock('../../../src/services/watch-manager.js', () => ({
  getActiveChannels: vi.fn(),
  isNotificationDuplicate: vi.fn(),
  markNotificationProcessed: vi.fn(),
  triggerScan: vi.fn(),
}));

// Mock folder structure (for server startup)
vi.mock('../../../src/services/folder-structure.js', () => ({
  discoverFolderStructure: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      rootId: 'root',
      entradaId: 'entrada',
      cobrosId: 'cobros',
      pagosId: 'pagos',
      sinProcesarId: 'sin-procesar',
      bancosId: 'bancos',
      controlCobrosId: 'control-cobros',
      controlPagosId: 'control-pagos',
      bankSpreadsheets: new Map(),
      monthFolders: new Map(),
      lastRefreshed: new Date(),
    },
  }),
  getCachedFolderStructure: vi.fn(),
}));

import * as watchManager from '../../../src/services/watch-manager.js';

describe('webhook routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('POST /webhooks/drive', () => {
    it('returns 200 with "synced" for sync message', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'sync',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'synced' });
    });

    it('returns 200 with "ignored" for unknown channel', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([]);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'unknown-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'change',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        status: 'ignored',
        reason: 'unknown_channel',
      });
    });

    it('returns 200 with "duplicate" for duplicate notification', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);
      vi.mocked(watchManager.isNotificationDuplicate).mockReturnValue(true);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'change',
          'x-goog-message-number': '123',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'duplicate' });
      expect(watchManager.isNotificationDuplicate).toHaveBeenCalledWith('123', 'test-channel');
    });

    it('queues scan for change notification', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);
      vi.mocked(watchManager.isNotificationDuplicate).mockReturnValue(false);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'change',
          'x-goog-message-number': '123',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'queued' });
      expect(watchManager.markNotificationProcessed).toHaveBeenCalledWith('123', 'test-channel');
      expect(watchManager.triggerScan).toHaveBeenCalledWith('folder123');
    });

    it('handles change notification without message number', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'change',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'queued' });
      expect(watchManager.markNotificationProcessed).not.toHaveBeenCalled();
      expect(watchManager.triggerScan).toHaveBeenCalledWith('folder123');
    });

    it('queues scan for add notification (file created/shared)', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);
      vi.mocked(watchManager.isNotificationDuplicate).mockReturnValue(false);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'add',
          'x-goog-message-number': '1000',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'queued' });
      expect(watchManager.markNotificationProcessed).toHaveBeenCalledWith('1000', 'test-channel');
      expect(watchManager.triggerScan).toHaveBeenCalledWith('folder123');
    });

    it('queues scan for update notification with children changes', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);
      vi.mocked(watchManager.isNotificationDuplicate).mockReturnValue(false);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'update',
          'x-goog-changed': 'children',
          'x-goog-message-number': '1426892',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'queued' });
      expect(watchManager.markNotificationProcessed).toHaveBeenCalledWith('1426892', 'test-channel');
      expect(watchManager.triggerScan).toHaveBeenCalledWith('folder123');
    });

    it('queues scan for update notification with content changes', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);
      vi.mocked(watchManager.isNotificationDuplicate).mockReturnValue(false);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'update',
          'x-goog-changed': 'content',
          'x-goog-message-number': '2000',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'queued' });
      expect(watchManager.markNotificationProcessed).toHaveBeenCalledWith('2000', 'test-channel');
      expect(watchManager.triggerScan).toHaveBeenCalledWith('folder123');
    });

    it('ignores update notification without children changes', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'update',
          'x-goog-changed': 'properties',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'received' });
      expect(watchManager.triggerScan).not.toHaveBeenCalled();
    });

    it('returns 200 for unhandled resource state', async () => {
      vi.mocked(watchManager.getActiveChannels).mockReturnValue([
        {
          channelId: 'test-channel',
          resourceId: 'resource123',
          folderId: 'folder123',
          expiration: new Date(Date.now() + 3600000),
          createdAt: new Date(),
        },
      ]);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel',
          'x-goog-resource-id': 'resource123',
          'x-goog-resource-state': 'remove',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'received' });
    });
  });
});
