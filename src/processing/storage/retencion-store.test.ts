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
  batchUpdate: vi.fn(),
  updateRowsWithFormatting: vi.fn(),
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

vi.mock('../../utils/spreadsheet.js', () => ({
  createDriveHyperlink: vi.fn((fileId: string, displayText: string) =>
    `=HYPERLINK("https://drive.google.com/file/d/${fileId}/view", "${displayText}")`
  ),
}));

vi.mock('../../services/status-sheet.js', () => ({
  formatTimestampInTimezone: vi.fn((date: Date, _timeZone: string) => {
    const offset = -3 * 60 * 60 * 1000;
    const local = new Date(date.getTime() + offset);
    const y = local.getUTCFullYear();
    const m = String(local.getUTCMonth() + 1).padStart(2, '0');
    const d = String(local.getUTCDate()).padStart(2, '0');
    const h = String(local.getUTCHours()).padStart(2, '0');
    const min = String(local.getUTCMinutes()).padStart(2, '0');
    const s = String(local.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }),
}));

// Mock concurrency module — transparent withLock that runs callback directly
vi.mock('../../utils/concurrency.js', () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      return { ok: true, value: result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }),
}));

import { appendRowsWithLinks, sortSheet, getValues, batchUpdate, updateRowsWithFormatting } from '../../services/sheets.js';

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

  describe('monetary fields use CellNumber in appendRowsWithLinks path', () => {
    it('stores montoComprobante and montoRetencion as CellNumber', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion({ montoComprobante: 10000, montoRetencion: 500 });
      await storeRetencion(retencion, 'spreadsheet-id');

      const callArgs = vi.mocked(appendRowsWithLinks).mock.calls[0];
      const row = callArgs[2][0];
      // I=8, J=9
      expect(row[8]).toEqual({ type: 'number', value: 10000 });
      expect(row[9]).toEqual({ type: 'number', value: 500 });
    });
  });

  describe('duplicate detection', () => {
    it('returns { stored: true } when retencion is new', async () => {
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({ ok: true, value: [['Header']] });
      // isDuplicateRetencion → A:O: no match
      vi.mocked(getValues).mockResolvedValueOnce({ ok: true, value: [['Header']] });
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
      // findRowByFileId → B:B: no match (different fileId)
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], [existingFileId]],
      });
      // isDuplicateRetencion → A:O: match on business key
      vi.mocked(getValues).mockResolvedValueOnce({
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
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['existing-file-id']],
      });
      // isDuplicateRetencion → A:O: no match (different cuitAgenteRetencion)
      vi.mocked(getValues).mockResolvedValueOnce({
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
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['existing-file-id']],
      });
      // isDuplicateRetencion → A:O: no match (different nroCertificado)
      vi.mocked(getValues).mockResolvedValueOnce({
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
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['existing-file-id']],
      });
      // isDuplicateRetencion → A:O: no match (different fechaEmision)
      vi.mocked(getValues).mockResolvedValueOnce({
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
      // findRowByFileId → B:B: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['existing-file-id']],
      });
      // isDuplicateRetencion → A:O: no match (different montoRetencion)
      vi.mocked(getValues).mockResolvedValueOnce({
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

  describe('reprocessing (same fileId already in sheet)', () => {
    it('updates existing row when fileId already exists in sheet', async () => {
      // First getValues call (findRowByFileId → B:B): fileId found at row 2
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [
          ['fileId'],
          ['test-file-id'], // matching fileId
        ],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion();
      const result = await storeRetencion(retencion, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBe(true);
      }
      expect(updateRowsWithFormatting).toHaveBeenCalledWith(
        'spreadsheet-id',
        expect.arrayContaining([
          expect.objectContaining({ range: expect.stringContaining('Retenciones Recibidas!A2') }),
        ]),
        expect.anything(),
        undefined
      );
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
      expect(batchUpdate).not.toHaveBeenCalled();
    });

    it('uses CellNumber for monetary fields in reprocessing row', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion({ montoComprobante: 10000, montoRetencion: 500 });
      await storeRetencion(retencion, 'spreadsheet-id');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // I=8, J=9 — should be CellNumber objects
      expect(row[8]).toEqual({ type: 'number', value: 10000 });
      expect(row[9]).toEqual({ type: 'number', value: 500 });
    });

    it('uses CellLink for fileName in reprocessing row', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion();
      await storeRetencion(retencion, 'spreadsheet-id');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // C=2 — should be CellLink object
      expect(row[2]).toMatchObject({ text: expect.any(String), url: expect.stringContaining('test-file-id') });
    });

    it('passes raw ISO processedAt in reprocessing row', async () => {
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['test-file-id']],
      });
      vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion({ processedAt: '2025-01-15T15:00:00Z' });
      await storeRetencion(retencion, 'spreadsheet-id');

      const callArgs = vi.mocked(updateRowsWithFormatting).mock.calls[0];
      const row = callArgs[1][0].values;
      // K=10 — should be raw ISO string
      expect(row[10]).toBe('2025-01-15T15:00:00Z');
    });

    it('does normal insert when fileId is NOT in sheet', async () => {
      // findRowByFileId: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['fileId'], ['other-file-id']],
      });
      // isDuplicateRetencion: no match
      vi.mocked(getValues).mockResolvedValueOnce({
        ok: true,
        value: [['Header']],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const retencion = createTestRetencion();
      const result = await storeRetencion(retencion, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
        expect(result.value.updated).toBeUndefined();
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
      expect(updateRowsWithFormatting).not.toHaveBeenCalled();
      expect(batchUpdate).not.toHaveBeenCalled();
    });
  });
});
