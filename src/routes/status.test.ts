/**
 * Unit tests for status routes
 * Tests GET /api/status and GET /health endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock config
vi.mock('../config.js', () => ({
  getConfig: vi.fn(),
}));

// Import modules after mocks
import { statusRoutes } from './status.js';
import { getConfig } from '../config.js';

describe('Status routes', () => {
  let server: FastifyInstance;

  const mockConfig = {
    nodeEnv: 'test' as const,
    port: 3000,
    logLevel: 'INFO' as const,
    apiSecret: 'test-secret-123',
    apiBaseUrl: 'http://localhost:3000',
    googleServiceAccountKey: 'mock-key',
    geminiApiKey: 'mock-gemini-key',
    driveRootFolderId: 'mock-folder-id',
    webhookUrl: 'http://localhost:3000/webhooks/drive',
    matchDaysBefore: 10,
    matchDaysAfter: 60,
    usdArsTolerancePercent: 5,
    geminiRpmLimit: 150,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue(mockConfig);

    server = Fastify({ logger: false });
    await server.register(statusRoutes);
    await server.ready();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await server.close();
  });

  describe('GET /api/status', () => {
    it('returns 200 status code', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns ok status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });

    it('returns timestamp in ISO format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.timestamp).toBeDefined();
      expect(() => new Date(body.timestamp)).not.toThrow();
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('returns correct version number', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.version).toBe('1.0.0');
    });

    it('returns environment from config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.environment).toBe('test');
    });

    it('returns queue status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.queue).toBeDefined();
      expect(body.queue.pending).toBeDefined();
      expect(body.queue.running).toBeDefined();
      expect(body.queue.completed).toBeDefined();
      expect(body.queue.failed).toBeDefined();
      expect(typeof body.queue.pending).toBe('number');
      expect(typeof body.queue.running).toBe('number');
      expect(typeof body.queue.completed).toBe('number');
      expect(typeof body.queue.failed).toBe('number');
    });

    it('returns all required fields', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('environment');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('startTime');
      expect(body).toHaveProperty('queue');
      expect(body).toHaveProperty('memory');
    });

    it('returns uptime information', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.uptime).toBeDefined();
      expect(typeof body.uptime).toBe('string');
      expect(body.startTime).toBeDefined();
      expect(() => new Date(body.startTime)).not.toThrow();
    });

    it('returns memory information', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.memory).toBeDefined();
      expect(body.memory.heapUsed).toBeDefined();
      expect(body.memory.heapTotal).toBeDefined();
      expect(body.memory.rss).toBeDefined();
      expect(body.memory.heapUsed).toMatch(/^\d+MB$/);
      expect(body.memory.heapTotal).toMatch(/^\d+MB$/);
      expect(body.memory.rss).toMatch(/^\d+MB$/);
    });

    it('rejects request without authorization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('rejects request with invalid token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        headers: {
          authorization: 'Bearer wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('GET /health', () => {
    it('returns 200 status code', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns ok status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });

    it('responds quickly for load balancer checks', async () => {
      const startTime = Date.now();

      await server.inject({
        method: 'GET',
        url: '/health',
      });

      const duration = Date.now() - startTime;
      // Should respond in less than 100ms
      expect(duration).toBeLessThan(100);
    });

    it('returns minimal response body', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      const body = JSON.parse(response.body);
      // Health check should be lightweight - only status field
      expect(Object.keys(body)).toHaveLength(1);
      expect(body).toHaveProperty('status');
    });
  });
});
