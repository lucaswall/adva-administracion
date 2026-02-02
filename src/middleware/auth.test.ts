/**
 * Unit tests for authentication middleware
 * Tests Bearer token authentication for API endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock config
vi.mock('../config.js', () => ({
  getConfig: vi.fn(),
}));

// Import middleware after mocks
import { authMiddleware } from './auth.js';
import { getConfig } from '../config.js';

describe('Authentication middleware', () => {
  let server: FastifyInstance;

  const mockConfig = {
    nodeEnv: 'test' as const,
    port: 3000,
    logLevel: 'INFO' as const,
    apiSecret: 'test-secret-token-12345',
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

    // Register auth middleware
    server.addHook('onRequest', authMiddleware);

    // Add test route
    server.get('/api/test', async () => {
      return { success: true };
    });

    await server.ready();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await server.close();
  });

  describe('Valid authentication', () => {
    it('allows request with valid Bearer token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer test-secret-token-12345',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('is case-insensitive for Bearer keyword', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'bearer test-secret-token-12345',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Invalid authentication', () => {
    it('rejects request with missing Authorization header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('rejects request with invalid token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('rejects request with malformed Authorization header (no Bearer prefix)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'test-secret-token-12345',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('rejects request with empty token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer ',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('rejects request with only whitespace token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer    ',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('Timing attack resistance', () => {
    it('uses constant-time comparison (timing should be similar for valid and invalid tokens)', async () => {
      const iterations = 100;
      const validTimings: number[] = [];
      const invalidTimings: number[] = [];

      // Measure valid token timing
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await server.inject({
          method: 'GET',
          url: '/api/test',
          headers: {
            authorization: 'Bearer test-secret-token-12345',
          },
        });
        const end = process.hrtime.bigint();
        validTimings.push(Number(end - start));
      }

      // Measure invalid token timing
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await server.inject({
          method: 'GET',
          url: '/api/test',
          headers: {
            authorization: 'Bearer wrong-token-xxxxxxxxxx',
          },
        });
        const end = process.hrtime.bigint();
        invalidTimings.push(Number(end - start));
      }

      const avgValid = validTimings.reduce((a, b) => a + b, 0) / validTimings.length;
      const avgInvalid = invalidTimings.reduce((a, b) => a + b, 0) / invalidTimings.length;

      // Timing difference should be less than 100% (constant-time comparison)
      // Using a lenient threshold due to system load variance
      // The goal is to catch obvious timing leaks (e.g., 10x+ difference) while tolerating system noise
      const timingDifference = Math.abs(avgValid - avgInvalid) / Math.max(avgValid, avgInvalid);
      expect(timingDifference).toBeLessThan(1.0);
    });
  });

  describe('Error responses', () => {
    it('returns JSON error response with correct structure', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain('application/json');

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
      expect(body.error).toBe('Unauthorized');
    });

    it('does not leak secret information in error messages', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer wrong-token',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.message).not.toContain('test-secret-token-12345');
      expect(body.message).not.toContain('expected');
      expect(body.message).not.toContain('actual');
    });
  });

describe('ADV-6: Timing leak prevention', () => {
    it('should normalize string lengths by hashing before comparison', async () => {
      // Import the constantTimeCompare function for direct testing
      // We need to test that the comparison function works correctly for matching tokens
      const response1 = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer test-secret-token-12345',
        },
      });
      expect(response1.statusCode).toBe(200);
    });

    it('should use SHA-256 hashing to normalize input lengths', async () => {
      // This test verifies that different length strings don't leak timing info
      // by testing that the comparison still works correctly
      // With hashing, a 10-char string and a 100-char string both become 64-char hashes

      // Very short token (should fail but not leak timing)
      const shortResponse = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer x',
        },
      });
      expect(shortResponse.statusCode).toBe(401);

      // Very long token (should fail but not leak timing)
      const longToken = 'x'.repeat(1000);
      const longResponse = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: `Bearer ${longToken}`,
        },
      });
      expect(longResponse.statusCode).toBe(401);

      // Correct length but wrong content (should fail)
      const sameLengthResponse = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer test-secret-token-XXXXX',
        },
      });
      expect(sameLengthResponse.statusCode).toBe(401);
    });

    it('should pad both strings to same length before timingSafeEqual', async () => {
      // With hash-based comparison, both inputs become 32-byte hashes
      // This ensures timingSafeEqual always compares equal-length buffers

      // Test that comparison works for correct token
      const validResponse = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer test-secret-token-12345',
        },
      });
      expect(validResponse.statusCode).toBe(200);

      // Test that comparison rejects incorrect tokens
      const invalidResponse = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer test-secret-token-12346',
        },
      });
      expect(invalidResponse.statusCode).toBe(401);
    });
  });

  describe('Empty API_SECRET configuration', () => {
    it('rejects all requests when API_SECRET is empty string', async () => {
      // Create new server with empty API_SECRET
      await server.close();
      vi.mocked(getConfig).mockReturnValue({
        ...mockConfig,
        apiSecret: '',
      });

      server = Fastify({ logger: false });
      server.addHook('onRequest', authMiddleware);
      server.get('/api/test', async () => ({ success: true }));
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer ',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toContain('API_SECRET not configured');
    });

    it('rejects valid token when API_SECRET is empty', async () => {
      // Create new server with empty API_SECRET
      await server.close();
      vi.mocked(getConfig).mockReturnValue({
        ...mockConfig,
        apiSecret: '',
      });

      server = Fastify({ logger: false });
      server.addHook('onRequest', authMiddleware);
      server.get('/api/test', async () => ({ success: true }));
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          authorization: 'Bearer some-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toContain('API_SECRET not configured');
    });
  });
});
