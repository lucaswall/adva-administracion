/**
 * Tests for webhook routes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { webhookRoutes } from './webhooks.js';
import type { WatchChannel } from '../types/index.js';

// Mock watch-manager service
vi.mock('../services/watch-manager.js', () => ({
  getActiveChannels: vi.fn(),
  checkAndMarkNotification: vi.fn(() => true), // Default: always return true (new notification)
  triggerScan: vi.fn(),
}));

import {
  getActiveChannels,
  checkAndMarkNotification,
  triggerScan,
} from '../services/watch-manager.js';

describe('POST /webhooks/drive - resourceId validation', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = Fastify();
    await server.register(webhookRoutes, { prefix: '/webhooks' });
  });

  afterEach(async () => {
    await server.close();
  });

  it('rejects notification when resourceId is missing', async () => {
    const mockChannel: WatchChannel = {
      channelId: 'test-channel-id',
      resourceId: 'test-resource-id',
      folderId: 'test-folder-id',
      expiration: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    };

    vi.mocked(getActiveChannels).mockReturnValue([mockChannel]);

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/drive',
      headers: {
        'x-goog-channel-id': 'test-channel-id',
        // Missing x-goog-resource-id
        'x-goog-resource-state': 'add',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ignored',
      reason: 'resource_mismatch',
    });
    expect(triggerScan).not.toHaveBeenCalled();
  });

  it('rejects notification when resourceId does not match channel', async () => {
    const mockChannel: WatchChannel = {
      channelId: 'test-channel-id',
      resourceId: 'expected-resource-id',
      folderId: 'test-folder-id',
      expiration: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    };

    vi.mocked(getActiveChannels).mockReturnValue([mockChannel]);

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/drive',
      headers: {
        'x-goog-channel-id': 'test-channel-id',
        'x-goog-resource-id': 'wrong-resource-id',
        'x-goog-resource-state': 'add',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ignored',
      reason: 'resource_mismatch',
    });
    expect(triggerScan).not.toHaveBeenCalled();
  });

  it('accepts notification when channelId and resourceId both match', async () => {
    const mockChannel: WatchChannel = {
      channelId: 'test-channel-id',
      resourceId: 'expected-resource-id',
      folderId: 'test-folder-id',
      expiration: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    };

    vi.mocked(getActiveChannels).mockReturnValue([mockChannel]);
    vi.mocked(checkAndMarkNotification).mockReturnValue(true);

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/drive',
      headers: {
        'x-goog-channel-id': 'test-channel-id',
        'x-goog-resource-id': 'expected-resource-id',
        'x-goog-resource-state': 'add',
        'x-goog-message-number': '1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'queued' });
    expect(checkAndMarkNotification).toHaveBeenCalledWith('1', 'test-channel-id');
    expect(triggerScan).toHaveBeenCalledWith('test-folder-id');
  });
});

describe('POST /webhooks/drive - rate limiting', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = Fastify();
    await server.register(webhookRoutes, { prefix: '/webhooks' });
  });

  afterEach(async () => {
    await server.close();
  });

  it('allows requests under rate limit', async () => {
    const mockChannel: WatchChannel = {
      channelId: 'test-channel-id',
      resourceId: 'test-resource-id',
      folderId: 'test-folder-id',
      expiration: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    };

    vi.mocked(getActiveChannels).mockReturnValue([mockChannel]);
    vi.mocked(checkAndMarkNotification).mockReturnValue(true);

    // Send multiple requests under the limit (e.g., 5 requests, limit is 60/min)
    for (let i = 0; i < 5; i++) {
      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'test-channel-id',
          'x-goog-resource-id': 'test-resource-id',
          'x-goog-resource-state': 'add',
          'x-goog-message-number': String(i + 1),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'queued' });
    }

    expect(triggerScan).toHaveBeenCalledTimes(5);
  });

  it('rejects requests over rate limit with 429 status', async () => {
    const mockChannel: WatchChannel = {
      channelId: 'rate-limit-test',
      resourceId: 'test-resource-id',
      folderId: 'test-folder-id',
      expiration: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    };

    vi.mocked(getActiveChannels).mockReturnValue([mockChannel]);
    vi.mocked(checkAndMarkNotification).mockReturnValue(true);

    // Send requests to exceed the rate limit (61 requests for 60/min limit)
    for (let i = 0; i < 61; i++) {
      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'rate-limit-test',
          'x-goog-resource-id': 'test-resource-id',
          'x-goog-resource-state': 'add',
          'x-goog-message-number': String(i + 1),
        },
      });

      if (i < 60) {
        expect(response.statusCode).toBe(200);
      } else {
        // 61st request should be rate limited
        expect(response.statusCode).toBe(429);
        const body = response.json();
        expect(body).toHaveProperty('error', 'Too Many Requests');
        expect(body).toHaveProperty('retryAfter');
        expect(typeof body.retryAfter).toBe('number');
        expect(response.headers['retry-after']).toBeDefined();
      }
    }
  });

  it('rate limits per channelId not globally', async () => {
    const mockChannel1: WatchChannel = {
      channelId: 'channel-1',
      resourceId: 'resource-1',
      folderId: 'folder-1',
      expiration: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    };

    const mockChannel2: WatchChannel = {
      channelId: 'channel-2',
      resourceId: 'resource-2',
      folderId: 'folder-2',
      expiration: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    };

    vi.mocked(getActiveChannels).mockReturnValue([mockChannel1, mockChannel2]);
    vi.mocked(checkAndMarkNotification).mockReturnValue(true);

    // Send 30 requests for channel-1
    for (let i = 0; i < 30; i++) {
      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'channel-1',
          'x-goog-resource-id': 'resource-1',
          'x-goog-resource-state': 'add',
          'x-goog-message-number': `ch1-${i + 1}`,
        },
      });

      expect(response.statusCode).toBe(200);
    }

    // Send 30 requests for channel-2 (should not be affected by channel-1's usage)
    for (let i = 0; i < 30; i++) {
      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/drive',
        headers: {
          'x-goog-channel-id': 'channel-2',
          'x-goog-resource-id': 'resource-2',
          'x-goog-resource-state': 'add',
          'x-goog-message-number': `ch2-${i + 1}`,
        },
      });

      expect(response.statusCode).toBe(200);
    }

    expect(triggerScan).toHaveBeenCalledTimes(60);
  });
});
