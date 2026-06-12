/**
 * Tests for POST /api/rebuild-subdiario route
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ─── Mock folder-structure ────────────────────────────────────────────────────

const mockGetCachedFolderStructure = vi.fn();

vi.mock('../services/folder-structure.js', () => ({
  getCachedFolderStructure: () => mockGetCachedFolderStructure(),
}));

// ─── Mock concurrency ─────────────────────────────────────────────────────────

const mockWithLock = vi.fn();

vi.mock('../utils/concurrency.js', () => ({
  withLock: (...args: unknown[]) => mockWithLock(...args),
}));

// ─── Mock subdiario-writer ────────────────────────────────────────────────────

const mockSyncSubdiario = vi.fn();

vi.mock('../services/subdiario-writer.js', () => ({
  syncSubdiario: (...args: unknown[]) => mockSyncSubdiario(...args),
}));

// ─── Mock config ──────────────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  getConfig: vi.fn(),
  PROCESSING_LOCK_ID: 'document-processing',
  PROCESSING_LOCK_TIMEOUT_MS: 300000,
  PROCESSING_LOCK_EXPIRY_MS: 900000,
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { subdiarioRoutes } from './subdiario.js';
import { getConfig } from '../config.js';
import * as logger from '../utils/logger.js';

// ─── Test data ────────────────────────────────────────────────────────────────

const API_SECRET = 'test-secret-123';

const mockConfig = {
  nodeEnv: 'test' as const,
  port: 3000,
  logLevel: 'INFO' as const,
  apiSecret: API_SECRET,
  apiBaseUrl: 'http://localhost:3000',
  googleServiceAccountKey: 'mock-key',
  geminiApiKey: 'mock-gemini-key',
  driveRootFolderId: 'mock-folder-id',
  webhookUrl: 'http://localhost:3000/webhooks/drive',
  matchDaysBefore: 10,
  matchDaysAfter: 60,
  usdMatchDaysAfter: 90,
  usdArsTolerancePercent: 5,
  geminiRpmLimit: 150,
  geminiDailyBudget: 0,
  maxDocumentBytes: 25 * 1024 * 1024,
  environment: 'staging' as const,
};

const mockFolderStructure = {
  rootId: 'root-id',
  entradaId: 'entrada-id',
  sinProcesarId: 'sin-procesar-id',
  duplicadoId: 'duplicado-id',
  controlIngresosId: 'ingresos-id',
  controlEgresosId: 'egresos-id',
  dashboardOperativoId: 'dashboard-id',
  bankSpreadsheets: new Map<string, string>(),
  movimientosSpreadsheets: new Map<string, string>(),
  yearFolders: new Map<string, string>(),
  classificationFolders: new Map<string, string>(),
  monthFolders: new Map<string, string>(),
  bankAccountFolders: new Map<string, string>(),
  bankAccountSpreadsheets: new Map<string, string>(),
  lastRefreshed: new Date(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/rebuild-subdiario', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue(mockConfig);
    mockGetCachedFolderStructure.mockReturnValue(mockFolderStructure);

    // Default: lock acquired successfully — mirrors real withLock semantics
    // (catches callback throws and wraps them as ok:false, just like the real impl)
    mockWithLock.mockImplementation(async (_id: unknown, fn: () => Promise<unknown>) => {
      try {
        const result = await fn();
        return { ok: true, value: result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    });

    mockSyncSubdiario.mockResolvedValue({
      ok: true,
      value: { rowsWritten: 42, gapsDetected: 3, inserts: 1, updates: 0, deletes: 0, sortInvariantFallback: false },
    });

    server = Fastify({ logger: false });
    await server.register(subdiarioRoutes, { prefix: '/api' });
    await server.ready();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await server.close();
  });

  it('returns 401 without Authorization header', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 with invalid Bearer token', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: 'Bearer wrong-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 200 with rowsWritten, gapsDetected, durationMs on success', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.rowsWritten).toBe(42);
    expect(body.gapsDetected).toBe(3);
    expect(typeof body.durationMs).toBe('number');
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls syncSubdiario with correct arguments from folder structure', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(mockSyncSubdiario).toHaveBeenCalledWith(
      'root-id',
      'ingresos-id',
      'egresos-id',
      expect.any(Number),
      expect.any(Map)
    );
  });

  it('returns 503 when PROCESSING_LOCK cannot be acquired (service busy)', async () => {
    mockWithLock.mockResolvedValue({
      ok: false,
      error: new Error('Failed to acquire lock for document-processing within 300000ms'),
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Service busy — try again later');
  });

  it('returns 500 when syncSubdiario returns Result.err; raw error NOT exposed', async () => {
    mockSyncSubdiario.mockResolvedValue({
      ok: false,
      error: new Error('Drive quota exceeded during write'),
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Subdiario rebuild failed');
    // Raw error message must NOT appear in response
    expect(JSON.stringify(body)).not.toContain('Drive quota');
  });

  it('returns 500 when syncSubdiario throws; raw error NOT exposed', async () => {
    mockSyncSubdiario.mockRejectedValue(new Error('Unexpected internal error XYZ'));

    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Subdiario rebuild failed');
    expect(JSON.stringify(body)).not.toContain('XYZ');
  });

  it('route does not double-log inner error when syncSubdiario returns Result.err (ADV-256)', async () => {
    // The writer is the single source of truth for cause logging.
    // The route must NOT re-log the inner error.message that the writer already logged.
    mockSyncSubdiario.mockResolvedValue({
      ok: false,
      error: new Error('Drive quota exceeded: spreadsheet write'),
    });

    await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    // logError must NOT have been called with the writer's inner error message
    const errorCalls = vi.mocked(logger.error).mock.calls;
    const calledWithInnerCause = errorCalls.some((args) => {
      const meta = args[1] as { error?: string } | undefined;
      return typeof meta?.error === 'string' && meta.error.includes('Drive quota');
    });
    expect(calledWithInnerCause).toBe(false);
  });

  it('lock is acquired using PROCESSING_LOCK_ID (document-processing)', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(mockWithLock).toHaveBeenCalledWith(
      'document-processing',
      expect.any(Function),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('lock uses separate timeout (PROCESSING_LOCK_TIMEOUT_MS) and expiry (PROCESSING_LOCK_EXPIRY_MS) (ADV-302)', async () => {
    // The waiter timeout (3rd arg) must equal PROCESSING_LOCK_TIMEOUT_MS (5 min),
    // and the auto-expiry (4th arg) must equal PROCESSING_LOCK_EXPIRY_MS (15 min).
    // These must be different values — expiry > timeout — to prevent slow-but-valid scans
    // from being displaced by waiters.
    await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(mockWithLock).toHaveBeenCalledWith(
      'document-processing',
      expect.any(Function),
      300000,  // PROCESSING_LOCK_TIMEOUT_MS — waiter wait budget
      900000   // PROCESSING_LOCK_EXPIRY_MS  — crash-recovery expiry
    );
  });

  it('lock expiry covers inner Comprobantes lock budget (ADV-351)', async () => {
    // PROCESSING_LOCK_EXPIRY_MS must be >= COMPROBANTES_LOCK_EXPIRY_MS (900 000 ms) so
    // the outer processing lock cannot expire mid-sync while the inner Comprobantes
    // sheet-append lock is still legitimately held.
    await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    const calls = mockWithLock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    const expiryMs = lastCall[3] as number; // 4th arg = autoExpiryMs
    expect(expiryMs).toBeGreaterThanOrEqual(900000);
    const timeoutMs = lastCall[2] as number; // 3rd arg = timeoutMs
    expect(expiryMs).toBeGreaterThan(timeoutMs);
  });

  it('lock is released on error path (withLock still called on failure)', async () => {
    mockSyncSubdiario.mockResolvedValue({
      ok: false,
      error: new Error('Write failed'),
    });

    await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    // withLock wraps the body — return ensures lock release via withLock's finally block
    expect(mockWithLock).toHaveBeenCalled();
  });

  it('handles missing folderStructure gracefully (returns 500)', async () => {
    mockGetCachedFolderStructure.mockReturnValue(null);

    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Subdiario rebuild failed');
  });

  // ─── Task 5: diff stats surfaced in response ──────────────────────────────────

  it('successful sync: response body includes inserts/updates/deletes/sortInvariantFallback', async () => {
    mockSyncSubdiario.mockResolvedValue({
      ok: true,
      value: {
        rowsWritten: 10,
        gapsDetected: 0,
        inserts: 3,
        updates: 2,
        deletes: 1,
        sortInvariantFallback: false,
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.rowsWritten).toBe(10);
    expect(body.gapsDetected).toBe(0);
    expect(body.inserts).toBe(3);
    expect(body.updates).toBe(2);
    expect(body.deletes).toBe(1);
    expect(body.sortInvariantFallback).toBe(false);
    expect(typeof body.durationMs).toBe('number');
  });

  it('no-op sync (all zero counts) passes through correctly', async () => {
    mockSyncSubdiario.mockResolvedValue({
      ok: true,
      value: {
        rowsWritten: 5,
        gapsDetected: 0,
        inserts: 0,
        updates: 0,
        deletes: 0,
        sortInvariantFallback: false,
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.inserts).toBe(0);
    expect(body.updates).toBe(0);
    expect(body.deletes).toBe(0);
    expect(body.sortInvariantFallback).toBe(false);
  });

  it('sync failure: 500 response has no diff fields in body', async () => {
    mockSyncSubdiario.mockResolvedValue({
      ok: false,
      error: new Error('Sheet write failed'),
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Subdiario rebuild failed');
    expect(body.inserts).toBeUndefined();
    expect(body.updates).toBeUndefined();
    expect(body.deletes).toBeUndefined();
    expect(body.sortInvariantFallback).toBeUndefined();
  });

  it('sort-invariant fallback: sortInvariantFallback=true and inserts equals rowsWritten', async () => {
    const rowsWritten = 8;
    mockSyncSubdiario.mockResolvedValue({
      ok: true,
      value: {
        rowsWritten,
        gapsDetected: 1,
        inserts: rowsWritten, // full rewrite: all rows re-inserted
        updates: 0,
        deletes: rowsWritten, // all old rows deleted first
        sortInvariantFallback: true,
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/rebuild-subdiario',
      headers: { authorization: `Bearer ${API_SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.sortInvariantFallback).toBe(true);
    expect(body.inserts).toBe(rowsWritten);
    expect(body.deletes).toBe(rowsWritten);
    expect(body.updates).toBe(0);
  });
});
