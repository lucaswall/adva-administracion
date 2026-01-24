/**
 * Tests for storage index module - file tracking functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { markFileProcessing, updateFileStatus, getProcessedFileIds } from './index.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  appendRowsWithLinks: vi.fn(),
  getValues: vi.fn(),
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

import { appendRowsWithLinks, getValues } from '../../services/sheets.js';

describe('File Tracking Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('markFileProcessing', () => {
    it('marks a file as processing in the Archivos Procesados sheet', async () => {
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });

      const result = await markFileProcessing(
        'dashboard-id',
        'test-file-id',
        'test-document.pdf',
        'factura_emitida'
      );

      expect(result.ok).toBe(true);
      expect(appendRowsWithLinks).toHaveBeenCalledWith(
        'dashboard-id',
        'Archivos Procesados',
        [
          [
            'test-file-id',
            'test-document.pdf',
            expect.any(String), // processedAt timestamp
            'factura_emitida',
            'processing',
          ],
        ]
      );
    });

    it('returns error when appendRowsWithLinks fails', async () => {
      vi.mocked(appendRowsWithLinks).mockResolvedValue({
        ok: false,
        error: new Error('Sheets API error'),
      });

      const result = await markFileProcessing(
        'dashboard-id',
        'test-file-id',
        'test-document.pdf',
        'factura_emitida'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Sheets API error');
      }
    });
  });

  describe('updateFileStatus', () => {
    it('updates file status to success in the Archivos Procesados sheet', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
          ['other-file-id', 'other.pdf', '2025-01-15T09:00:00Z', 'pago_enviado', 'success'],
        ],
      });

      const mockBatchUpdate = vi.fn().mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(await import('../../services/sheets.js')).batchUpdate = mockBatchUpdate;

      const result = await updateFileStatus('dashboard-id', 'test-file-id', 'success');

      expect(result.ok).toBe(true);
      expect(mockBatchUpdate).toHaveBeenCalledWith('dashboard-id', [
        {
          range: 'Archivos Procesados!E2',
          values: [['success']],
        },
      ]);
    });

    it('updates file status to failed with error message', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
        ],
      });

      const mockBatchUpdate = vi.fn().mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(await import('../../services/sheets.js')).batchUpdate = mockBatchUpdate;

      const result = await updateFileStatus('dashboard-id', 'test-file-id', 'failed', 'Extraction error');

      expect(result.ok).toBe(true);
      expect(mockBatchUpdate).toHaveBeenCalledWith('dashboard-id', [
        {
          range: 'Archivos Procesados!E2',
          values: [['failed: Extraction error']],
        },
      ]);
    });

    it('returns error when file is not found in tracking sheet', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['other-file-id', 'other.pdf', '2025-01-15T09:00:00Z', 'pago_enviado', 'success'],
        ],
      });

      const result = await updateFileStatus('dashboard-id', 'nonexistent-file-id', 'success');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not found in tracking sheet');
      }
    });

    it('returns error when getValues fails', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: false,
        error: new Error('Sheets API error'),
      });

      const result = await updateFileStatus('dashboard-id', 'test-file-id', 'success');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Sheets API error');
      }
    });
  });

  describe('getProcessedFileIds', () => {
    it('returns file IDs from Archivos Procesados sheet', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['file-1', 'doc1.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'success'],
          ['file-2', 'doc2.pdf', '2025-01-15T11:00:00Z', 'pago_enviado', 'success'],
          ['file-3', 'doc3.pdf', '2025-01-15T12:00:00Z', 'factura_recibida', 'processing'],
        ],
      });

      const result = await getProcessedFileIds('dashboard-id');

      expect(result.has('file-1')).toBe(true);
      expect(result.has('file-2')).toBe(true);
      expect(result.has('file-3')).toBe(true);
      expect(result.size).toBe(3);
      expect(getValues).toHaveBeenCalledWith('dashboard-id', 'Archivos Procesados!A:A');
    });

    it('returns empty set when sheet has only headers', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
      });

      const result = await getProcessedFileIds('dashboard-id');

      expect(result.size).toBe(0);
    });

    it('returns empty set when getValues fails', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: false,
        error: new Error('Sheets API error'),
      });

      const result = await getProcessedFileIds('dashboard-id');

      expect(result.size).toBe(0);
    });

    it('skips rows with empty fileId', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['file-1', 'doc1.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'success'],
          ['', 'doc2.pdf', '2025-01-15T11:00:00Z', 'pago_enviado', 'success'],
          ['file-3', 'doc3.pdf', '2025-01-15T12:00:00Z', 'factura_recibida', 'processing'],
        ],
      });

      const result = await getProcessedFileIds('dashboard-id');

      expect(result.has('file-1')).toBe(true);
      expect(result.has('file-3')).toBe(true);
      expect(result.has('')).toBe(false);
      expect(result.size).toBe(2);
    });
  });
});
