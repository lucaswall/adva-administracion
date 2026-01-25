/**
 * Tests for resumen storage operations (bank accounts, credit cards, brokers)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeResumenBancario } from './resumen-store.js';
import type { ResumenBancario } from '../../types/index.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  appendRowsWithLinks: vi.fn(),
  sortSheet: vi.fn(),
  getValues: vi.fn(),
  getSpreadsheetTimezone: vi.fn(() => Promise.resolve({ ok: true, value: 'America/Argentina/Buenos_Aires' })),
  dateStringToSerial: vi.fn((dateStr: string) => {
    // Mock implementation: simple serial number based on date
    const date = new Date(dateStr + 'T00:00:00Z');
    return Math.floor(date.getTime() / (1000 * 60 * 60 * 24)) + 25569; // Excel epoch offset
  }),
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

vi.mock('../../utils/file-naming.js', () => ({
  generateResumenFileName: vi.fn((resumen: ResumenBancario) =>
    `${resumen.fechaDesde} - Resumen - ${resumen.banco} ${resumen.numeroCuenta}.pdf`
  ),
}));

import { appendRowsWithLinks, sortSheet, getValues } from '../../services/sheets.js';

const createTestResumen = (overrides: Partial<ResumenBancario> = {}): ResumenBancario => ({
  fileId: 'test-file-id',
  fileName: 'test-resumen.pdf',
  banco: 'Santander',
  numeroCuenta: '1234567890',
  fechaDesde: '2024-01-01',
  fechaHasta: '2024-01-31',
  saldoInicial: 10000,
  saldoFinal: 15000,
  moneda: 'ARS',
  cantidadMovimientos: 25,
  processedAt: '2025-01-15T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

describe('storeResumenBancario (bank accounts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('StoreResult return type', () => {
    it('returns { stored: true } when resumen is successfully stored', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

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
          ['fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          [45292, 45322, existingFileId, 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000], // Serial numbers for 2024-01-01 and 2024-01-31
        ],
      });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('returns error when appendRowsWithLinks fails', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({
        ok: false,
        error: new Error('API error'),
      });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('API error');
      }
    });
  });

  describe('duplicate detection', () => {
    it('detects duplicate when all 5 fields match', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
      }
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
    });

    it('does not detect duplicate when banco differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'BBVA', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when fechaDesde differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-02-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when fechaHasta differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-02-29',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when numeroCuenta differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '9876543210',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('does not detect duplicate when moneda differs', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          ['2024-01-01', '2024-01-31', 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'USD',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
      expect(appendRowsWithLinks).toHaveBeenCalled();
    });

    it('handles serial number dates in existing data', async () => {
      // Existing data has serial numbers instead of date strings
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaDesde', 'fechaHasta', 'fileId', 'fileName', 'banco', 'numeroCuenta', 'moneda', 'saldoInicial', 'saldoFinal'],
          [45292, 45322, 'existing-id', 'existing.pdf', 'Santander', '1234567890', 'ARS', 10000, 15000], // Serial numbers
        ],
      });

      const resumen = createTestResumen({
        banco: 'Santander',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
      });

      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false); // Should detect as duplicate
      }
    });
  });

  describe('row formatting', () => {
    it('stores row with correct column order using CellDate and CellNumber types', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        fileId: 'test-id-123',
        banco: 'Santander',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
        saldoInicial: 10000,
        saldoFinal: 15000,
      });

      await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(appendRowsWithLinks).toHaveBeenCalledWith(
        'spreadsheet-id',
        'Resumenes!A:I',
        expect.arrayContaining([
          expect.arrayContaining([
            { type: 'date', value: '2024-01-01' }, // fechaDesde as CellDate
            { type: 'date', value: '2024-01-31' }, // fechaHasta as CellDate
            'test-id-123',
            expect.objectContaining({
              text: expect.stringContaining('2024-01-01'),
              url: 'https://drive.google.com/file/d/test-id-123/view'
            }),
            'Santander',
            '1234567890',
            'ARS',
            { type: 'number', value: 10000 }, // saldoInicial as CellNumber
            { type: 'number', value: 15000 }, // saldoFinal as CellNumber
          ])
        ]),
        'America/Argentina/Buenos_Aires', // Timezone parameter
        undefined // metadataCache parameter
      );
    });

    it('creates hyperlink with correct format', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen({
        fileId: 'abc123',
      });

      await storeResumenBancario(resumen, 'spreadsheet-id');

      const calls = vi.mocked(appendRowsWithLinks).mock.calls;
      expect(calls.length).toBe(1);
      const row = calls[0][2][0];
      expect(row[3]).toEqual(expect.objectContaining({
        text: expect.any(String),
        url: 'https://drive.google.com/file/d/abc123/view',
      }));
    });
  });

  describe('sorting', () => {
    it('sorts by fechaDesde ascending after storing', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const resumen = createTestResumen();
      await storeResumenBancario(resumen, 'spreadsheet-id');

      expect(sortSheet).toHaveBeenCalledWith(
        'spreadsheet-id',
        'Resumenes',
        0, // column index 0 (fechaDesde)
        false // ascending
      );
    });

    it('does not fail when sort fails', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 9 });
      vi.mocked(sortSheet).mockResolvedValue({
        ok: false,
        error: new Error('Sort failed'),
      });

      const resumen = createTestResumen();
      const result = await storeResumenBancario(resumen, 'spreadsheet-id');

      // Should still succeed even if sort fails
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });
  });
});
