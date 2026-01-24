/**
 * Tests for pago storage operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storePago } from './pago-store.js';
import type { Pago } from '../../types/index.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  appendRowsWithLinks: vi.fn(),
  sortSheet: vi.fn(),
  getValues: vi.fn(),
  getSpreadsheetTimezone: vi.fn(() => Promise.resolve({ ok: true, value: 'America/Argentina/Buenos_Aires' })),
}));

vi.mock('../../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../utils/correlation.js', () => ({
  getCorrelationId: () => 'test-correlation-id',
}));

import { appendRowsWithLinks, sortSheet, getValues } from '../../services/sheets.js';

const createTestPago = (overrides: Partial<Pago> = {}): Pago => ({
  fileId: 'test-file-id',
  fileName: 'test-pago.pdf',
  banco: 'BBVA',
  fechaPago: '2025-01-15',
  importePagado: 1210,
  moneda: 'ARS',
  referencia: 'REF-001',
  cuitPagador: '27234567891',
  nombrePagador: 'PAGADOR SA',
  cuitBeneficiario: '30709076783',
  nombreBeneficiario: 'ADVA SRL',
  concepto: 'Pago factura',
  processedAt: '2025-01-15T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

describe('storePago', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('StoreResult return type', () => {
    it('returns { stored: true } when pago is successfully stored', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.existingFileId).toBeUndefined();
      }
    });

    it('returns { stored: false, existingFileId } when duplicate is detected', async () => {
      const existingFileId = 'existing-file-id';
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['Header', 'fileId', 'etc', 'etc', 'importePagado', 'etc', 'etc', 'cuit'],
          ['2025-01-15', existingFileId, 'etc', 'etc', '1,210.00', 'etc', 'etc', '27234567891'],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
    });

    it('returns error when appendRowsWithLinks fails', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({
        ok: false,
        error: new Error('API error'),
      });

      const pago = createTestPago();
      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('API error');
      }
    });
  });

  describe('duplicate detection', () => {
    it('detects duplicate when all criteria match', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'etc', 'etc', 'importePagado', 'etc', 'etc', 'cuit'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '1,210.00', 'etc', 'etc', '27234567891'],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('does not detect duplicate when date differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'etc', 'etc', 'importePagado', 'etc', 'etc', 'cuit'],
          ['2025-01-10', 'existing-id', 'etc', 'etc', '1,210.00', 'etc', 'etc', '27234567891'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when amount differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'etc', 'etc', 'importePagado', 'etc', 'etc', 'cuit'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '2,000.00', 'etc', 'etc', '27234567891'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when CUIT differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'etc', 'etc', 'importePagado', 'etc', 'etc', 'cuit'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '1,210.00', 'etc', 'etc', '30709076783'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });
  });

  describe('pago recibido vs enviado', () => {
    it('uses cuitPagador for pago_recibido duplicate check', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'etc', 'etc', 'importePagado', 'etc', 'etc', 'cuit'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '1,210.00', 'etc', 'etc', '27234567891'],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891', // This should be checked for pago_recibido
        cuitBeneficiario: '30709076783',
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Recibidos', 'pago_recibido');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false); // Should detect duplicate
      }
    });

    it('uses cuitBeneficiario for pago_enviado duplicate check', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'etc', 'etc', 'importePagado', 'etc', 'etc', 'cuit'],
          ['2025-01-15', 'existing-id', 'etc', 'etc', '1,210.00', 'etc', 'etc', '30709076783'],
        ],
      });

      const pago = createTestPago({
        fechaPago: '2025-01-15',
        importePagado: 1210,
        cuitPagador: '27234567891',
        cuitBeneficiario: '30709076783', // This should be checked for pago_enviado
      });

      const result = await storePago(pago, 'spreadsheet-id', 'Pagos Enviados', 'pago_enviado');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false); // Should detect duplicate
      }
    });
  });
});
