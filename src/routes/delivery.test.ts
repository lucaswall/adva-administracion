/**
 * Unit tests for delivery routes
 * Tests POST /api/delivery/plan, /api/delivery/copy-pdfs, /api/delivery/build-movimientos
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock the delivery-package service module
const mockParsePeriodRange = vi.fn();
const mockEnumerateResumenes = vi.fn();
const mockEnumerateMovimientos = vi.fn();
const mockFormatDeliveryFolderName = vi.fn();
const mockPrepareDeliveryFolder = vi.fn();
const mockCopyPdfsToDelivery = vi.fn();
const mockBuildMovimientosFiles = vi.fn();
const mockBuildSubdiarioDeliverableFile = vi.fn();

vi.mock('../services/delivery-package.js', () => ({
  parsePeriodRange: (...args: unknown[]) => mockParsePeriodRange(...args),
  enumerateResumenes: (...args: unknown[]) => mockEnumerateResumenes(...args),
  enumerateMovimientos: (...args: unknown[]) => mockEnumerateMovimientos(...args),
  formatDeliveryFolderName: (...args: unknown[]) => mockFormatDeliveryFolderName(...args),
  prepareDeliveryFolder: (...args: unknown[]) => mockPrepareDeliveryFolder(...args),
  copyPdfsToDelivery: (...args: unknown[]) => mockCopyPdfsToDelivery(...args),
  buildMovimientosFiles: (...args: unknown[]) => mockBuildMovimientosFiles(...args),
  buildSubdiarioDeliverableFile: (...args: unknown[]) => mockBuildSubdiarioDeliverableFile(...args),
}));

// Mock subdiario-writer (gatherSubdiarioInput)
const mockGatherSubdiarioInput = vi.fn();

vi.mock('../services/subdiario-writer.js', () => ({
  gatherSubdiarioInput: (...args: unknown[]) => mockGatherSubdiarioInput(...args),
}));

// Mock folder structure
const mockGetCachedFolderStructure = vi.fn();

vi.mock('../services/folder-structure.js', () => ({
  getCachedFolderStructure: () => mockGetCachedFolderStructure(),
}));

// Mock drive helpers used by routes (Entregas/ ancestry guard)
const mockFindByName = vi.fn();
const mockIsDescendantOf = vi.fn();

vi.mock('../services/drive.js', () => ({
  findByName: (...args: unknown[]) => mockFindByName(...args),
  isDescendantOf: (...args: unknown[]) => mockIsDescendantOf(...args),
}));

// Mock concurrency — withLock defaults to calling through (simulates normal lock acquisition)
const mockWithLock = vi.fn();

vi.mock('../utils/concurrency.js', () => ({
  withLock: (...args: unknown[]) => mockWithLock(...args),
}));

// Mock config
vi.mock('../config.js', () => ({
  getConfig: vi.fn(),
}));

// Mock logger for error assertions
vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Import after mocks
import { deliveryRoutes } from './delivery.js';
import { getConfig } from '../config.js';
import * as logger from '../utils/logger.js';

describe('Delivery routes', () => {
  let server: FastifyInstance;

  const mockConfig = {
    nodeEnv: 'test' as const,
    port: 3000,
    logLevel: 'INFO' as const,
    apiSecret: 'test-secret-123',
    apiBaseUrl: 'http://localhost:3000',
    googleServiceAccountKey: 'mock-key',
    geminiApiKey: 'mock-gemini-key',
    driveRootFolderId: 'mock-root-folder-id',
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
    rootId: 'mock-root-folder-id',
    entradaId: 'entrada-id',
    sinProcesarId: 'sin-procesar-id',
    duplicadoId: 'duplicado-id',
    controlIngresosId: 'control-ingresos-id',
    controlEgresosId: 'control-egresos-id',
    dashboardOperativoId: 'dashboard-id',
    bankSpreadsheets: new Map(),
    movimientosSpreadsheets: new Map(),
    yearFolders: new Map(),
    classificationFolders: new Map(),
    monthFolders: new Map(),
    bankAccountFolders: new Map(),
    bankAccountSpreadsheets: new Map(),
    lastRefreshed: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue(mockConfig);
    mockGetCachedFolderStructure.mockReturnValue(mockFolderStructure);

    // Default: withLock calls through to fn() and returns {ok:true, value} — simulates
    // normal lock acquisition. Individual tests override this to simulate timeout.
    mockWithLock.mockImplementation(async (_id: unknown, fn: () => Promise<unknown>) => {
      try {
        const value = await fn();
        return { ok: true, value };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    });

    server = Fastify({ logger: false });
    await server.register(deliveryRoutes, { prefix: '/api' });
    await server.ready();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await server.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/delivery/plan
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /api/delivery/plan', () => {
    it('returns 401 when authorization header is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(401);
      expect(mockParsePeriodRange).not.toHaveBeenCalled();
    });

    it('returns 400 with Spanish message when period is invalid', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: false,
        error: new Error('Formato de período inválido'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: 'not-a-period' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Formato de período inválido');
    });

    it('returns 503 when folder structure is not cached', async () => {
      mockGetCachedFolderStructure.mockReturnValue(null);
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Service unavailable');
      expect(typeof body.correlationId).toBe('string');
    });

    it('returns 500 when enumerateResumenes fails', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({
        ok: false,
        error: new Error('Sheets API error'),
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: true,
        value: [],
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Internal server error');
      expect(typeof body.correlationId).toBe('string');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Internal server error',
        expect.objectContaining({
          error: 'Sheets API error',
          correlationId: body.correlationId,
        })
      );
    });

    it('returns 500 when enumerateMovimientos fails', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({
        ok: true,
        value: [],
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: false,
        error: new Error('Drive API error'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Internal server error');
    });

    it('returns 200 with correct shape for single-month period', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({
        ok: true,
        value: [
          { fileId: 'f1', fileName: 'resumen1.pdf', type: 'bancario', periodo: '2025-01' },
          { fileId: 'f2', fileName: 'resumen2.pdf', type: 'tarjeta', periodo: '2025-01' },
        ],
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: true,
        value: [
          { kind: 'bank', spreadsheetId: 'sp1', sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234567890', moneda: 'ARS' },
        ],
      });
      mockFormatDeliveryFolderName.mockReturnValue('Entregas 2025-01 - 08-05-2025');

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.folderName).toBe('Entregas 2025-01 - 08-05-2025');
      expect(body.pdfCount).toBe(2);
      expect(body.movimientosTabCount).toBe(1);
      expect(body.periodLabel).toBe('2025-01');
    });

    it('returns periodLabel as range string for multi-month period', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-03' },
      });
      mockEnumerateResumenes.mockResolvedValue({ ok: true, value: [] });
      mockEnumerateMovimientos.mockResolvedValue({ ok: true, value: [] });
      mockFormatDeliveryFolderName.mockReturnValue('Entregas 2025-01..2025-03 - 08-05-2025');

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01..2025-03' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.periodLabel).toBe('2025-01..2025-03');
    });

    it('passes correct arguments to service functions', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-03' },
      });
      mockEnumerateResumenes.mockResolvedValue({ ok: true, value: [] });
      mockEnumerateMovimientos.mockResolvedValue({ ok: true, value: [] });
      mockFormatDeliveryFolderName.mockReturnValue('Entregas folder');

      await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01..2025-03' },
      });

      expect(mockParsePeriodRange).toHaveBeenCalledWith('2025-01..2025-03');
      expect(mockEnumerateResumenes).toHaveBeenCalledWith('2025-01', '2025-03', 'mock-root-folder-id');
      expect(mockEnumerateMovimientos).toHaveBeenCalledWith('2025-01', '2025-03', 'mock-root-folder-id');
    });

    it('returns 400 when period field is missing from body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/plan',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/delivery/copy-pdfs
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /api/delivery/copy-pdfs', () => {
    it('returns 401 when authorization header is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 with Spanish message when period is invalid', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: false,
        error: new Error('El período es inválido: use YYYY-MM'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: 'bad' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('El período es inválido: use YYYY-MM');
    });

    it('returns 503 when folder structure is not cached', async () => {
      mockGetCachedFolderStructure.mockReturnValue(null);
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(503);
    });

    it('returns 500 when enumerateResumenes fails', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({
        ok: false,
        error: new Error('Sheets read failed'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Internal server error');
    });

    it('returns 500 when prepareDeliveryFolder fails', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({ ok: true, value: [] });
      mockPrepareDeliveryFolder.mockResolvedValue({
        ok: false,
        error: new Error('Drive quota exceeded'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when copyPdfsToDelivery fails', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({ ok: true, value: [] });
      mockPrepareDeliveryFolder.mockResolvedValue({
        ok: true,
        value: { folderId: 'folder-abc', folderUrl: 'https://drive.google.com/...', isReuse: false },
      });
      mockCopyPdfsToDelivery.mockResolvedValue({
        ok: false,
        error: new Error('Copy failed'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 200 with correct shape on happy path', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({
        ok: true,
        value: [
          { fileId: 'f1', fileName: 'resumen1.pdf', type: 'bancario', periodo: '2025-01' },
          { fileId: 'f2', fileName: 'resumen2.pdf', type: 'tarjeta', periodo: '2025-01' },
        ],
      });
      mockPrepareDeliveryFolder.mockResolvedValue({
        ok: true,
        value: {
          folderId: 'folder-abc123',
          folderUrl: 'https://drive.google.com/drive/folders/folder-abc123',
          isReuse: false,
        },
      });
      mockCopyPdfsToDelivery.mockResolvedValue({
        ok: true,
        value: {
          copied: 2,
          failed: [],
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.folderId).toBe('folder-abc123');
      expect(body.folderUrl).toBe('https://drive.google.com/drive/folders/folder-abc123');
      expect(body.copied).toBe(2);
      expect(body.failed).toEqual([]);
    });

    it('includes failed array in response when some copies fail', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({
        ok: true,
        value: [
          { fileId: 'f1', fileName: 'resumen1.pdf', type: 'bancario', periodo: '2025-01' },
        ],
      });
      mockPrepareDeliveryFolder.mockResolvedValue({
        ok: true,
        value: { folderId: 'folder-abc', folderUrl: 'https://...', isReuse: false },
      });
      mockCopyPdfsToDelivery.mockResolvedValue({
        ok: true,
        value: {
          copied: 0,
          failed: [{ fileId: 'f1', error: 'File not found' }],
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.copied).toBe(0);
      expect(body.failed).toHaveLength(1);
      expect(body.failed[0]).toEqual({ fileId: 'f1', error: 'File not found' });
    });

    it('passes correct arguments to service functions', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-03' },
      });
      const mockScope = [{ fileId: 'f1', fileName: 'r.pdf', type: 'bancario', periodo: '2025-01' }];
      mockEnumerateResumenes.mockResolvedValue({ ok: true, value: mockScope });
      mockPrepareDeliveryFolder.mockResolvedValue({
        ok: true,
        value: { folderId: 'folder-xyz', folderUrl: 'https://...', isReuse: false },
      });
      mockCopyPdfsToDelivery.mockResolvedValue({
        ok: true,
        value: { copied: 1, failed: [] },
      });

      await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01..2025-03' },
      });

      expect(mockEnumerateResumenes).toHaveBeenCalledWith('2025-01', '2025-03', 'mock-root-folder-id');
      expect(mockPrepareDeliveryFolder).toHaveBeenCalledWith(
        'mock-root-folder-id',
        expect.any(String),
        expect.any(Date)
      );
      expect(mockCopyPdfsToDelivery).toHaveBeenCalledWith('folder-xyz', mockScope);
    });

    // ADV-354: copy-pdfs must be serialized behind a lock
    it('ADV-354: returns 503 when the delivery lock times out for copy-pdfs', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateResumenes.mockResolvedValue({ ok: true, value: [] });
      // Simulate lock timeout
      mockWithLock.mockResolvedValue({
        ok: false,
        error: new Error('Failed to acquire lock for delivery:mutating within 30000ms'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/copy-pdfs',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Service unavailable');
      expect(typeof body.correlationId).toBe('string');
      // Mutations must not have run
      expect(mockPrepareDeliveryFolder).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/delivery/build-movimientos
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /api/delivery/build-movimientos', () => {
    beforeEach(() => {
      // Default mocks for the IDOR/ancestry guard: Entregas/ exists and the
      // supplied folderId is a descendant. Individual tests override these.
      mockFindByName.mockResolvedValue({
        ok: true,
        value: { id: 'entregas-id', name: 'Entregas', mimeType: 'application/vnd.google-apps.folder' },
      });
      mockIsDescendantOf.mockResolvedValue({ ok: true, value: true });
    });

    it('returns 401 when authorization header is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        payload: { period: '2025-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when folderId is missing from body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when period is missing from body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 with Spanish message when period is invalid', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: false,
        error: new Error('Período fuera del rango permitido'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '1999-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Período fuera del rango permitido');
    });

    it('returns 500 when enumerateMovimientos fails', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: false,
        error: new Error('Drive listing failed'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Internal server error');
    });

    it('returns 500 when buildMovimientosFiles fails', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: true,
        value: [],
      });
      mockBuildMovimientosFiles.mockResolvedValue({
        ok: false,
        error: new Error('Sheets creation failed'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 200 with {created, failed} shape on happy path', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-03' },
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: true,
        value: [
          { kind: 'bank', spreadsheetId: 'sp1', sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234567890', moneda: 'ARS' },
          { kind: 'bank', spreadsheetId: 'sp1', sheetName: '2025-02', banco: 'BBVA', numeroCuenta: '1234567890', moneda: 'ARS' },
          { kind: 'bank', spreadsheetId: 'sp2', sheetName: '2025-01', banco: 'Galicia', numeroCuenta: '9876543210', moneda: 'USD' },
        ],
      });
      mockBuildMovimientosFiles.mockResolvedValue({
        ok: true,
        value: {
          created: 3,
          failed: [],
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01..2025-03', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.created).toBe(3);
      expect(body.failed).toEqual([]);
    });

    it('passes correct arguments to service functions', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      const mockScope = [
        { kind: 'bank', spreadsheetId: 'sp1', sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234567890', moneda: 'ARS' },
      ];
      mockEnumerateMovimientos.mockResolvedValue({ ok: true, value: mockScope });
      mockBuildMovimientosFiles.mockResolvedValue({
        ok: true,
        value: { created: 1, failed: [] },
      });

      await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'custom-folder-id' },
      });

      expect(mockParsePeriodRange).toHaveBeenCalledWith('2025-01');
      expect(mockEnumerateMovimientos).toHaveBeenCalledWith('2025-01', '2025-01', 'mock-root-folder-id');
      expect(mockBuildMovimientosFiles).toHaveBeenCalledWith('custom-folder-id', mockScope);
    });

    it('logs error at error level and does not expose raw error message on 500', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: false,
        error: new Error('Internal spreadsheet ID leaked'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Internal server error');
      expect(body.error).not.toContain('Internal spreadsheet');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Internal server error',
        expect.objectContaining({
          error: 'Internal spreadsheet ID leaked',
        })
      );
    });

    // ─── IDOR / Entregas ancestry guard (ADV-238) ────────────────────────────

    it('returns 400 with Spanish message when folderId is not a descendant of Entregas/', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockIsDescendantOf.mockResolvedValue({ ok: true, value: false });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'attacker-folder-id' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('folderId no pertenece a la carpeta Entregas/');
      // Validation must happen BEFORE any expensive enumeration / build call
      expect(mockEnumerateMovimientos).not.toHaveBeenCalled();
      expect(mockBuildMovimientosFiles).not.toHaveBeenCalled();
    });

    it('proceeds normally when folderId IS a descendant of Entregas/', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockIsDescendantOf.mockResolvedValue({ ok: true, value: true });
      mockEnumerateMovimientos.mockResolvedValue({ ok: true, value: [] });
      mockBuildMovimientosFiles.mockResolvedValue({
        ok: true,
        value: { created: 0, failed: [] },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'legit-folder-inside-entregas' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockIsDescendantOf).toHaveBeenCalledWith('legit-folder-inside-entregas', 'entregas-id');
      expect(mockBuildMovimientosFiles).toHaveBeenCalled();
    });

    it('returns 500 when the Entregas/ folder cannot be located (null value, not a Drive error)', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockFindByName.mockResolvedValue({ ok: true, value: null });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(500);
      expect(mockEnumerateMovimientos).not.toHaveBeenCalled();
      expect(mockBuildMovimientosFiles).not.toHaveBeenCalled();
    });

    // ADV-354: build-movimientos must be serialized behind a lock
    it('ADV-354: returns 503 when the delivery lock times out for build-movimientos', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      // Ancestry guard succeeds (read-only, outside the lock)
      mockFindByName.mockResolvedValue({
        ok: true,
        value: { id: 'entregas-id', name: 'Entregas', mimeType: 'application/vnd.google-apps.folder' },
      });
      mockIsDescendantOf.mockResolvedValue({ ok: true, value: true });
      // Simulate lock timeout
      mockWithLock.mockResolvedValue({
        ok: false,
        error: new Error('Failed to acquire lock for delivery:mutating within 30000ms'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Service unavailable');
      expect(typeof body.correlationId).toBe('string');
      // Mutations must not have run
      expect(mockBuildMovimientosFiles).not.toHaveBeenCalled();
    });

    // ADV-334: Drive API errors during ancestry guard must map to 503, not 500
    it('ADV-334: returns 503 when findByName fails with Drive API error', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockFindByName.mockResolvedValue({ ok: false, error: new Error('Drive API quota exceeded') });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Service unavailable');
      expect(typeof body.correlationId).toBe('string');
      expect(mockEnumerateMovimientos).not.toHaveBeenCalled();
      expect(mockBuildMovimientosFiles).not.toHaveBeenCalled();
    });

    // ADV-334: Drive API errors during ancestry guard must map to 503, not 500
    it('ADV-334: returns 503 when the descendant check itself fails (Drive API error)', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockIsDescendantOf.mockResolvedValue({ ok: false, error: new Error('Drive timeout') });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Service unavailable');
      expect(typeof body.correlationId).toBe('string');
      expect(mockBuildMovimientosFiles).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/delivery/build-subdiario
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /api/delivery/build-subdiario', () => {
    const MOCK_SUBDIARIO_INPUT = {
      currentYear: 2026,
      facturasEmitidas: [],
      pagosRecibidos: [],
      retencionesRecibidas: [],
      movimientos: [],
      facturador: new Map(),
    };

    beforeEach(() => {
      // Default mocks: Entregas/ found, folderId is a descendant, gather + build succeed
      mockFindByName.mockResolvedValue({
        ok: true,
        value: { id: 'entregas-id', name: 'Entregas', mimeType: 'application/vnd.google-apps.folder' },
      });
      mockIsDescendantOf.mockResolvedValue({ ok: true, value: true });
      mockGatherSubdiarioInput.mockResolvedValue({ ok: true, value: MOCK_SUBDIARIO_INPUT });
      mockBuildSubdiarioDeliverableFile.mockResolvedValue({
        ok: true,
        value: { spreadsheetId: 'subdiario-sheet-id', sheetId: 0, rowsWritten: 42 },
      });
    });

    it('returns 401 when authorization header is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        payload: { folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when folderId is missing from body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 503 when folder structure is not cached', async () => {
      mockGetCachedFolderStructure.mockReturnValue(null);

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Service unavailable');
      expect(typeof body.correlationId).toBe('string');
    });

    it('returns 400 when folderId is not a descendant of Entregas/', async () => {
      mockIsDescendantOf.mockResolvedValue({ ok: true, value: false });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'attacker-folder-id' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('folderId no pertenece a la carpeta Entregas/');
      // Validation must happen BEFORE any gathering / build
      expect(mockGatherSubdiarioInput).not.toHaveBeenCalled();
      expect(mockBuildSubdiarioDeliverableFile).not.toHaveBeenCalled();
    });

    it('returns 503 when findByName fails (Drive API error) during IDOR guard', async () => {
      mockFindByName.mockResolvedValue({ ok: false, error: new Error('Drive API quota exceeded') });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Service unavailable');
      expect(mockGatherSubdiarioInput).not.toHaveBeenCalled();
    });

    it('returns 503 when isDescendantOf fails (Drive API error)', async () => {
      mockIsDescendantOf.mockResolvedValue({ ok: false, error: new Error('Drive timeout') });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(503);
      expect(mockGatherSubdiarioInput).not.toHaveBeenCalled();
    });

    it('returns 503 when delivery lock times out', async () => {
      mockWithLock.mockResolvedValue({
        ok: false,
        error: new Error('Failed to acquire lock for delivery:mutating within 30000ms'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Service unavailable');
      expect(typeof body.correlationId).toBe('string');
      // Mutations must not have run
      expect(mockGatherSubdiarioInput).not.toHaveBeenCalled();
      expect(mockBuildSubdiarioDeliverableFile).not.toHaveBeenCalled();
    });

    it('happy path returns { spreadsheetId, rowsWritten } on success', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'legit-folder-id' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.spreadsheetId).toBe('subdiario-sheet-id');
      expect(body.rowsWritten).toBe(42);
    });

    it('calls gatherSubdiarioInput with folder structure params and buildSubdiarioDeliverableFile with folderId', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'legit-folder-id' },
      });

      expect(mockGatherSubdiarioInput).toHaveBeenCalledWith(
        'mock-root-folder-id',
        'control-ingresos-id',
        expect.any(Number),
        expect.any(Map)
      );
      expect(mockBuildSubdiarioDeliverableFile).toHaveBeenCalledWith(
        'legit-folder-id',
        expect.any(Number),
        MOCK_SUBDIARIO_INPUT
      );
    });

    it('idempotent re-run calls writer again (replacement is writer\'s job)', async () => {
      // First run
      await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'legit-folder-id' },
      });

      // Second run (same folderId)
      await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'legit-folder-id' },
      });

      // Writer must have been called on both runs
      expect(mockBuildSubdiarioDeliverableFile).toHaveBeenCalledTimes(2);
    });

    it('returns 500 when gatherSubdiarioInput fails', async () => {
      mockGatherSubdiarioInput.mockResolvedValue({
        ok: false,
        error: new Error('Sheets API error during gather'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'legit-folder-id' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Internal server error');
      expect(typeof body.correlationId).toBe('string');
    });

    it('returns 500 when buildSubdiarioDeliverableFile fails', async () => {
      mockBuildSubdiarioDeliverableFile.mockResolvedValue({
        ok: false,
        error: new Error('Failed to write Subdiario sheet'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'legit-folder-id' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Internal server error');
      expect(body.error).not.toContain('Subdiario');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Internal server error',
        expect.objectContaining({ error: 'Failed to write Subdiario sheet' })
      );
    });

    it('returns 500 when Entregas/ folder cannot be located (null value)', async () => {
      mockFindByName.mockResolvedValue({ ok: true, value: null });

      const response = await server.inject({
        method: 'POST',
        url: '/api/delivery/build-subdiario',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { folderId: 'folder-abc' },
      });

      expect(response.statusCode).toBe(500);
      expect(mockGatherSubdiarioInput).not.toHaveBeenCalled();
    });
  });
});
