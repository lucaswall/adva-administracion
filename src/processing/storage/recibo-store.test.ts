/**
 * Tests for recibo storage operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeRecibo } from './recibo-store.js';
import type { Recibo } from '../../types/index.js';

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

const createTestRecibo = (overrides: Partial<Recibo> = {}): Recibo => ({
  fileId: 'test-file-id',
  fileName: 'test-recibo.pdf',
  tipoRecibo: 'sueldo',
  nombreEmpleado: 'Juan Perez',
  cuilEmpleado: '20123456789',
  legajo: '001',
  tareaDesempenada: 'Desarrollador',
  cuitEmpleador: '30709076783',
  periodoAbonado: '2025-01',
  subtotalRemuneraciones: 500000,
  subtotalDescuentos: 100000,
  totalNeto: 400000,
  fechaPago: '2025-01-31',
  processedAt: '2025-01-31T10:00:00Z',
  confidence: 0.95,
  needsReview: false,
  ...overrides,
});

describe('storeRecibo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Duplicate detection', () => {
    it('returns { stored: true } when recibo is new', async () => {
      vi.mocked(getValues).mockResolvedValue({ ok: true, value: [['Header']] });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo();
      const result = await storeRecibo(recibo, 'spreadsheet-id');

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
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto'],
          ['2025-01-31', existingFileId, 'old.pdf', 'Mensual', 'Juan Perez', '20123456789', '001', 'Desarrollador', '30709076783', '2025-01', '500,000.00', '100,000.00', '400,000.00'],
        ],
      });

      const recibo = createTestRecibo(); // Same cuilEmpleado, periodoAbonado, totalNeto
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(false);
        expect(result.value.existingFileId).toBe(existingFileId);
      }
    });

    it('allows same employee, different period', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto'],
          ['2025-01-31', 'existing-file-id', 'old.pdf', 'Mensual', 'Juan Perez', '20123456789', '001', 'Desarrollador', '30709076783', '2025-01', '500,000.00', '100,000.00', '400,000.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({ periodoAbonado: '2025-02' }); // Different period
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });

    it('allows same employee, same period, different amount', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto'],
          ['2025-01-31', 'existing-file-id', 'old.pdf', 'Mensual', 'Juan Perez', '20123456789', '001', 'Desarrollador', '30709076783', '2025-01', '500,000.00', '100,000.00', '400,000.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({ totalNeto: 450000 }); // Different amount
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });

    it('allows different employee, same period', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto'],
          ['2025-01-31', 'existing-file-id', 'old.pdf', 'Mensual', 'Juan Perez', '20123456789', '001', 'Desarrollador', '30709076783', '2025-01', '500,000.00', '100,000.00', '400,000.00'],
        ],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(sortSheet).mockResolvedValue({ ok: true, value: undefined });

      const recibo = createTestRecibo({ cuilEmpleado: '20987654321', nombreEmpleado: 'Maria Gomez' }); // Different employee
      const result = await storeRecibo(recibo, 'spreadsheet-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stored).toBe(true);
      }
    });
  });
});
