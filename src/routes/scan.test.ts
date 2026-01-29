/**
 * Unit tests for scan routes
 * Tests POST /api/scan, /api/rematch, and /api/autofill-bank endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock the scanner module
const mockScanFolder = vi.fn();
const mockRematch = vi.fn();

vi.mock('../processing/scanner.js', () => ({
  scanFolder: (...args: unknown[]) => mockScanFolder(...args),
  rematch: (...args: unknown[]) => mockRematch(...args),
}));

// Mock folder structure
const mockGetCachedFolderStructure = vi.fn();
const mockDiscoverFolderStructure = vi.fn();

vi.mock('../services/folder-structure.js', () => ({
  getCachedFolderStructure: () => mockGetCachedFolderStructure(),
  discoverFolderStructure: () => mockDiscoverFolderStructure(),
  clearFolderStructureCache: vi.fn(),
}));

// Mock bank autofill
const mockAutoFillBankMovements = vi.fn();

vi.mock('../bank/autofill.js', () => ({
  autoFillBankMovements: (...args: unknown[]) => mockAutoFillBankMovements(...args),
}));

// Mock config
vi.mock('../config.js', () => ({
  getConfig: vi.fn(),
}));

// Import modules after mocks
import { scanRoutes } from './scan.js';
import { getConfig } from '../config.js';

describe('Scan routes', () => {
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

  const mockFolderStructure = {
    rootId: 'root-id',
    entradaId: 'entrada-id',
    cobrosId: 'cobros-id',
    pagosId: 'pagos-id',
    sinProcesarId: 'sin-procesar-id',
    bancosId: 'bancos-id',
    controlCobrosId: 'control-cobros-id',
    controlPagosId: 'control-pagos-id',
    bankSpreadsheets: new Map([['BBVA', 'bbva-sheet-id']]),
    monthFolders: new Map(),
    lastRefreshed: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue(mockConfig);
    mockGetCachedFolderStructure.mockReturnValue(mockFolderStructure);

    server = Fastify({ logger: false });
    await server.register(scanRoutes, { prefix: '/api' });
    await server.ready();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await server.close();
  });

  describe('POST /api/scan', () => {
    it('triggers a successful scan', async () => {
      mockScanFolder.mockResolvedValue({
        ok: true,
        value: {
          filesProcessed: 5,
          facturasAdded: 2,
          pagosAdded: 2,
          recibosAdded: 1,
          matchesFound: 2,
          errors: 0,
          duration: 1500,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/scan',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.filesProcessed).toBe(5);
      expect(body.facturasAdded).toBe(2);
      expect(body.pagosAdded).toBe(2);
      expect(body.recibosAdded).toBe(1);
      expect(body.matchesFound).toBe(2);
      expect(body.errors).toBe(0);
    });

    it('accepts optional folderId parameter', async () => {
      mockScanFolder.mockResolvedValue({
        ok: true,
        value: {
          filesProcessed: 1,
          facturasAdded: 0,
          pagosAdded: 0,
          recibosAdded: 0,
          matchesFound: 0,
          errors: 0,
          duration: 100,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/scan',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        // Use a valid Google Drive folder ID format (28-44 alphanumeric chars)
        payload: { folderId: '1ABC2defGHIjklMNOpqrSTUvwxyz12' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockScanFolder).toHaveBeenCalledWith('1ABC2defGHIjklMNOpqrSTUvwxyz12');
    });

    it('returns 400 for invalid folderId format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/scan',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        payload: { folderId: 'invalid-short-id' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Invalid folderId format');
      expect(body.details).toContain('valid Google Drive folder ID');
      expect(mockScanFolder).not.toHaveBeenCalled();
    });

    it('extracts folderId from Google Drive URL', async () => {
      mockScanFolder.mockResolvedValue({
        ok: true,
        value: {
          filesProcessed: 1,
          errors: 0,
          facturasAdded: 0,
          pagosAdded: 0,
          recibosAdded: 0,
          retencionesAdded: 0,
          matchesFound: 0,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/scan',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        // Full Google Drive URL with valid ID
        payload: { folderId: 'https://drive.google.com/drive/folders/1ABC2defGHIjklMNOpqrSTUvwxyz12' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockScanFolder).toHaveBeenCalledWith('1ABC2defGHIjklMNOpqrSTUvwxyz12');
    });

    it('returns 500 on scan failure', async () => {
      mockScanFolder.mockResolvedValue({
        ok: false,
        error: new Error('Drive API error'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/scan',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Drive API error');
    });
  });

  describe('POST /api/rematch', () => {
    it('triggers a successful rematch', async () => {
      mockRematch.mockResolvedValue({
        ok: true,
        value: {
          matchesFound: 3,
          duration: 500,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/rematch',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.matchesFound).toBe(3);
      expect(body.duration).toBe(500);
    });

    it('accepts optional documentType parameter', async () => {
      mockRematch.mockResolvedValue({
        ok: true,
        value: {
          matchesFound: 1,
          duration: 200,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/rematch',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        payload: { documentType: 'factura' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 500 on rematch failure', async () => {
      mockRematch.mockResolvedValue({
        ok: false,
        error: new Error('Sheets API error'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/rematch',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Sheets API error');
    });
  });

  describe('POST /api/autofill-bank', () => {
    it('triggers a successful autofill', async () => {
      mockAutoFillBankMovements.mockResolvedValue({
        ok: true,
        value: {
          rowsProcessed: 50,
          rowsFilled: 35,
          bankFeeMatches: 5,
          creditCardPaymentMatches: 2,
          pagoFacturaMatches: 15,
          directFacturaMatches: 3,
          reciboMatches: 0,
          pagoOnlyMatches: 0,
          noMatches: 15,
          errors: 0,
          duration: 2000,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/autofill-bank',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.rowsProcessed).toBe(50);
      expect(body.rowsFilled).toBe(35);
    });

    it('returns 500 on autofill failure', async () => {
      mockAutoFillBankMovements.mockResolvedValue({
        ok: false,
        error: new Error('Bank sheet not found'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/autofill-bank',
        headers: {
          authorization: 'Bearer test-secret-123',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Bank sheet not found');
    });
  });
});
