/**
 * Tests for POST /api/mp-sync route [ADV-370]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock syncMercadopago
const mockSyncMercadopago = vi.fn();
vi.mock('../mercadopago/sync.js', () => ({
  syncMercadopago: (...args: unknown[]) => mockSyncMercadopago(...args),
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Mock config (required by authMiddleware)
vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    apiSecret: 'test-secret-123',
    nodeEnv: 'test',
    logLevel: 'INFO',
  })),
  MP_ACCESS_TOKEN: 'test-mp-token',
}));

// Import after mocks
import { mpSyncRoutes } from './mp-sync.js';

describe('POST /api/mp-sync', () => {
  let server: FastifyInstance;

  const validHeaders = { authorization: 'Bearer test-secret-123' };

  const mockStats = {
    periods: ['2025-05'],
    fetched: 10,
    appended: 5,
    skippedExisting: 5,
    resumenesWritten: 1,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    server = Fastify({ logger: false });
    await server.register(mpSyncRoutes, { prefix: '/api' });
    await server.ready();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await server.close();
  });

  // --- Auth ---

  describe('authentication', () => {
    it('returns 401 with no bearer token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/mp-sync',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 with wrong bearer token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/mp-sync',
        headers: { authorization: 'Bearer wrong-token' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // --- Success ---

  describe('success', () => {
    it('returns 200 with sync stats', async () => {
      mockSyncMercadopago.mockResolvedValue({ ok: true, value: mockStats });

      const response = await server.inject({
        method: 'POST',
        url: '/api/mp-sync',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.periods).toEqual(['2025-05']);
      expect(body.fetched).toBe(10);
      expect(body.appended).toBe(5);
    });

    it('calls syncMercadopago with no periods when no query param', async () => {
      mockSyncMercadopago.mockResolvedValue({ ok: true, value: mockStats });

      await server.inject({
        method: 'POST',
        url: '/api/mp-sync',
        headers: validHeaders,
      });

      expect(mockSyncMercadopago).toHaveBeenCalledWith(undefined);
    });
  });

  // --- Period query param ---

  describe('?period= query parameter', () => {
    it('passes period as array to syncMercadopago', async () => {
      mockSyncMercadopago.mockResolvedValue({ ok: true, value: mockStats });

      await server.inject({
        method: 'POST',
        url: '/api/mp-sync?period=2026-05',
        headers: validHeaders,
      });

      expect(mockSyncMercadopago).toHaveBeenCalledWith(['2026-05']);
    });

    it('returns 400 for invalid month (13)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/mp-sync?period=2026-13',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBeTruthy();
    });

    it('returns 400 for garbage period format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/mp-sync?period=garbage',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for future month', async () => {
      // syncMercadopago returns ok:false for future periods
      mockSyncMercadopago.mockResolvedValue({ ok: false, error: new Error('future period') });

      // The route should pre-validate before calling sync, returning 400
      // OR the route can call sync and map ok:false to 400 for validation errors
      // Per task: "malformed (2026-13, garbage, future month) → 400"
      // The route validates the period format and rejects future periods with 400

      // Actually looking at the task requirements:
      // "?period=2026-05 → passes ['2026-05']; malformed (2026-13, garbage, future month) → 400"
      // So the route itself validates the period, NOT delegating to syncMercadopago
      const response = await server.inject({
        method: 'POST',
        url: '/api/mp-sync?period=2099-01',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // --- Skipped (disabled) ---

  describe('when sync is skipped', () => {
    it('returns 200 with skipped body when token unset', async () => {
      mockSyncMercadopago.mockResolvedValue({
        ok: true,
        value: { skipped: true, reason: 'mp_disabled' },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/mp-sync',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('mp_disabled');
    });
  });

  // --- Error ---

  describe('sync failure', () => {
    it('returns 500 with generic error message when sync ok:false', async () => {
      mockSyncMercadopago.mockResolvedValue({
        ok: false,
        error: new Error('Internal MP API failure with sensitive details'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/mp-sync',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      // Generic message, no internal details
      expect(body.error).toBeTruthy();
      expect(body.error).not.toContain('sensitive details');
      expect(body.error).not.toContain('Internal MP API failure');
    });
  });
});
