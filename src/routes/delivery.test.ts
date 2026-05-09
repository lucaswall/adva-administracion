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
const mockBuildMovimientosWorkbook = vi.fn();

vi.mock('../services/delivery-package.js', () => ({
  parsePeriodRange: (...args: unknown[]) => mockParsePeriodRange(...args),
  enumerateResumenes: (...args: unknown[]) => mockEnumerateResumenes(...args),
  enumerateMovimientos: (...args: unknown[]) => mockEnumerateMovimientos(...args),
  formatDeliveryFolderName: (...args: unknown[]) => mockFormatDeliveryFolderName(...args),
  prepareDeliveryFolder: (...args: unknown[]) => mockPrepareDeliveryFolder(...args),
  copyPdfsToDelivery: (...args: unknown[]) => mockCopyPdfsToDelivery(...args),
  buildMovimientosWorkbook: (...args: unknown[]) => mockBuildMovimientosWorkbook(...args),
}));

// Mock folder structure
const mockGetCachedFolderStructure = vi.fn();

vi.mock('../services/folder-structure.js', () => ({
  getCachedFolderStructure: () => mockGetCachedFolderStructure(),
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
    controlResumenesId: 'mock-resumenes-id',
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
          { spreadsheetId: 'sp1', sheetName: '2025-01', bankName: 'BBVA ARS' },
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
      expect(mockEnumerateResumenes).toHaveBeenCalledWith('2025-01', '2025-03', 'mock-resumenes-id');
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

      expect(mockEnumerateResumenes).toHaveBeenCalledWith('2025-01', '2025-03', 'mock-resumenes-id');
      expect(mockPrepareDeliveryFolder).toHaveBeenCalledWith(
        'mock-root-folder-id',
        expect.any(String),
        expect.any(Date)
      );
      expect(mockCopyPdfsToDelivery).toHaveBeenCalledWith('folder-xyz', mockScope);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/delivery/build-movimientos
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /api/delivery/build-movimientos', () => {
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

    it('returns 500 when buildMovimientosWorkbook fails', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: true,
        value: [],
      });
      mockBuildMovimientosWorkbook.mockResolvedValue({
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

    it('returns 200 with correct shape on happy path', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-03' },
      });
      mockEnumerateMovimientos.mockResolvedValue({
        ok: true,
        value: [
          { spreadsheetId: 'sp1', sheetName: '2025-01', bankName: 'BBVA ARS' },
          { spreadsheetId: 'sp1', sheetName: '2025-02', bankName: 'BBVA ARS' },
          { spreadsheetId: 'sp2', sheetName: '2025-01', bankName: 'Galicia USD' },
        ],
      });
      mockBuildMovimientosWorkbook.mockResolvedValue({
        ok: true,
        value: {
          workbookId: 'workbook-id-123',
          workbookUrl: 'https://docs.google.com/spreadsheets/d/workbook-id-123',
          tabCount: 3,
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
      expect(body.workbookUrl).toBe('https://docs.google.com/spreadsheets/d/workbook-id-123');
      expect(body.tabCount).toBe(3);
    });

    it('passes correct arguments to service functions', async () => {
      mockParsePeriodRange.mockReturnValue({
        ok: true,
        value: { from: '2025-01', to: '2025-01' },
      });
      const mockScope = [
        { spreadsheetId: 'sp1', sheetName: '2025-01', bankName: 'BBVA ARS' },
      ];
      mockEnumerateMovimientos.mockResolvedValue({ ok: true, value: mockScope });
      mockBuildMovimientosWorkbook.mockResolvedValue({
        ok: true,
        value: { workbookId: 'wb1', workbookUrl: 'https://...', tabCount: 1 },
      });

      await server.inject({
        method: 'POST',
        url: '/api/delivery/build-movimientos',
        headers: { authorization: 'Bearer test-secret-123' },
        payload: { period: '2025-01', folderId: 'custom-folder-id' },
      });

      expect(mockParsePeriodRange).toHaveBeenCalledWith('2025-01');
      expect(mockEnumerateMovimientos).toHaveBeenCalledWith('2025-01', '2025-01', 'mock-root-folder-id');
      expect(mockBuildMovimientosWorkbook).toHaveBeenCalledWith('custom-folder-id', mockScope);
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
  });
});
