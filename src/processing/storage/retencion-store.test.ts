/**
 * Tests for retencion storage operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeRetencion } from './retencion-store.js';
import type { Retencion } from '../../types/index.js';

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

const createTestRetencion = (overrides: Partial<Retencion> = {}): Retencion => ({
  fileId: 'test-file-id',
  fileName: 'test-retencion.pdf',
  nroCertificado: 'CERT-001-2025',
  cuitAgenteRetencion: '20123456786',
  razonSocialAgenteRetencion: 'EMPRESA SA',
  cuitSujetoRetenido: '30709076783',
  impuesto: 'IIBB',
  regimen: 'RG 830',
  montoComprobante: 10000,
  montoRetencion: 500,
  fechaEmision: '2025-01-15',
  processedAt: '2025-01-15T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

describe('storeRetencion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Duplicate detection', () => {
    it('returns { stored: true } when retencion is new', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion();
      const result = await storeRetencion(retencion, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.existingFileId).toBeUndefined();
      }
    });

    it('returns { stored: false, existingFileId } when duplicate is detected by exact key', async () => {
      const existingFileId = 'existing-file-id';
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'nroCertificado', 'cuitAgenteRetencion', 'razonSocialAgenteRetencion', 'impuesto', 'regimen', 'montoComprobante', 'montoRetencion'],
          ['2025-01-15', existingFileId, 'old.pdf', 'CERT-001-2025', '20123456786', 'EMPRESA SA', 'IIBB', 'RG 830', '10,000.00', '500.00'],
        ],
      });

      const retencion = createTestRetencion(); // Same nroCertificado, cuitAgenteRetencion, fechaEmision, montoRetencion
      const result = await storeRetencion(retencion, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
    });

    it('allows same nroCertificado from different issuer', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'nroCertificado', 'cuitAgenteRetencion', 'razonSocialAgenteRetencion', 'impuesto', 'regimen', 'montoComprobante', 'montoRetencion'],
          ['2025-01-15', 'existing-file-id', 'old.pdf', 'CERT-001-2025', '20123456786', 'EMPRESA SA', 'IIBB', 'RG 830', '10,000.00', '500.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion({ cuitAgenteRetencion: '20999999999' }); // Different issuer
      const result = await storeRetencion(retencion, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });

    it('allows same issuer, different certificate number', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'nroCertificado', 'cuitAgenteRetencion', 'razonSocialAgenteRetencion', 'impuesto', 'regimen', 'montoComprobante', 'montoRetencion'],
          ['2025-01-15', 'existing-file-id', 'old.pdf', 'CERT-001-2025', '20123456786', 'EMPRESA SA', 'IIBB', 'RG 830', '10,000.00', '500.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion({ nroCertificado: 'CERT-002-2025' }); // Different certificate
      const result = await storeRetencion(retencion, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });

    it('allows same certificate + issuer, different date', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'nroCertificado', 'cuitAgenteRetencion', 'razonSocialAgenteRetencion', 'impuesto', 'regimen', 'montoComprobante', 'montoRetencion'],
          ['2025-01-15', 'existing-file-id', 'old.pdf', 'CERT-001-2025', '20123456786', 'EMPRESA SA', 'IIBB', 'RG 830', '10,000.00', '500.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion({ fechaEmision: '2025-02-15' }); // Different date
      const result = await storeRetencion(retencion, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });

    it('allows same certificate + issuer + date, different amount', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaEmision', 'fileId', 'fileName', 'nroCertificado', 'cuitAgenteRetencion', 'razonSocialAgenteRetencion', 'impuesto', 'regimen', 'montoComprobante', 'montoRetencion'],
          ['2025-01-15', 'existing-file-id', 'old.pdf', 'CERT-001-2025', '20123456786', 'EMPRESA SA', 'IIBB', 'RG 830', '10,000.00', '500.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion({ montoRetencion: 600 }); // Different amount
      const result = await storeRetencion(retencion, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });
  });
});
