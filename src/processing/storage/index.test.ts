/**
 * Tests for storage index module - file tracking functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { markFileProcessing, updateFileStatus, getProcessedFileIds, clearFileStatusCache } from './index.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  appendRowsWithLinks: vi.fn(),
  getValues: vi.fn(),
  batchUpdate: vi.fn(),
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

import { appendRowsWithLinks, getValues, batchUpdate, getSpreadsheetTimezone } from '../../services/sheets.js';

describe('File Tracking Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('markFileProcessing', () => {
    beforeEach(() => {
      clearFileStatusCache();
    });

    it('marks a new file as processing in the Archivos Procesados sheet', async () => {
      // Mock no existing entry for this file
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
      });
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
        ],
        'America/Argentina/Buenos_Aires' // timezone
      );
    });

    it('updates existing row when file already exists (retry scenario)', async () => {
      // Mock existing failed entry for this file
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'failed: Lock timeout'],
        ],
      });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      const result = await markFileProcessing(
        'dashboard-id',
        'test-file-id',
        'test-document.pdf',
        'factura_emitida'
      );

      expect(result.ok).toBe(true);
      // Should update existing row, not append
      expect(appendRowsWithLinks).not.toHaveBeenCalled();
      expect(batchUpdate).toHaveBeenCalledWith('dashboard-id', [
        {
          range: 'Archivos Procesados!C2:E2',
          values: [[expect.any(String), 'factura_emitida', 'processing']],
        },
      ]);
    });

    it('fetches spreadsheet timezone for proper timestamp formatting', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });

      await markFileProcessing(
        'dashboard-id',
        'test-file-id',
        'test-document.pdf',
        'factura_emitida'
      );

      expect(getSpreadsheetTimezone).toHaveBeenCalledWith('dashboard-id');
      expect(appendRowsWithLinks).toHaveBeenCalledWith(
        'dashboard-id',
        'Archivos Procesados',
        expect.any(Array),
        'America/Argentina/Buenos_Aires'
      );
    });

    it('handles timezone fetch failure gracefully by passing undefined', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
      });
      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(getSpreadsheetTimezone).mockResolvedValue({ ok: false, error: new Error('Timezone fetch failed') });

      await markFileProcessing(
        'dashboard-id',
        'test-file-id',
        'test-document.pdf',
        'factura_emitida'
      );

      expect(appendRowsWithLinks).toHaveBeenCalledWith(
        'dashboard-id',
        'Archivos Procesados',
        expect.any(Array),
        undefined // Falls back to undefined on timezone fetch error
      );
    });

    it('returns error when appendRowsWithLinks fails', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
      });
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

    it('returns error when getValues fails', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: false,
        error: new Error('Failed to read tracking sheet'),
      });

      const result = await markFileProcessing(
        'dashboard-id',
        'test-file-id',
        'test-document.pdf',
        'factura_emitida'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to read tracking sheet');
      }
    });
  });

  describe('updateFileStatus', () => {
    beforeEach(() => {
      clearFileStatusCache();
    });

    it('updates file status to success in the Archivos Procesados sheet', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
          ['other-file-id', 'other.pdf', '2025-01-15T09:00:00Z', 'pago_enviado', 'success'],
        ],
      });

      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      const result = await updateFileStatus('dashboard-id', 'test-file-id', 'success');

      expect(result.ok).toBe(true);
      expect(batchUpdate).toHaveBeenCalledWith('dashboard-id', [
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

      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      const result = await updateFileStatus('dashboard-id', 'test-file-id', 'failed', 'Extraction error');

      expect(result.ok).toBe(true);
      expect(batchUpdate).toHaveBeenCalledWith('dashboard-id', [
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

    it('should read column on first status update', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
        ],
      });

      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      const result = await updateFileStatus('dashboard-id', 'test-file-id', 'success');

      expect(result.ok).toBe(true);
      expect(getValues).toHaveBeenCalledTimes(1);
      expect(getValues).toHaveBeenCalledWith('dashboard-id', 'Archivos Procesados!A:A');
    });

    it('should use cached index on second update', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
        ],
      });

      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      // First update
      const result1 = await updateFileStatus('dashboard-id', 'test-file-id', 'success');
      expect(result1.ok).toBe(true);
      expect(getValues).toHaveBeenCalledTimes(1);

      // Second update should use cache
      const result2 = await updateFileStatus('dashboard-id', 'test-file-id', 'failed', 'Test error');
      expect(result2.ok).toBe(true);
      // getValues should still only be called once (from first update)
      expect(getValues).toHaveBeenCalledTimes(1);
    });

    it('should read for different file', async () => {
      vi.mocked(getValues)
        .mockResolvedValueOnce({
          ok: true,
          value: [
            ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
            ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          value: [
            ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
            ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
            ['other-file-id', 'other.pdf', '2025-01-15T11:00:00Z', 'pago_enviado', 'processing'],
          ],
        });

      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      // Update first file
      const result1 = await updateFileStatus('dashboard-id', 'test-file-id', 'success');
      expect(result1.ok).toBe(true);
      expect(getValues).toHaveBeenCalledTimes(1);

      // Update different file
      const result2 = await updateFileStatus('dashboard-id', 'other-file-id', 'success');
      expect(result2.ok).toBe(true);
      // getValues should be called again for different file
      expect(getValues).toHaveBeenCalledTimes(2);
    });

    it('should clear cache with clearFileStatusCache()', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['test-file-id', 'test-document.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
        ],
      });

      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      // First update
      const result1 = await updateFileStatus('dashboard-id', 'test-file-id', 'success');
      expect(result1.ok).toBe(true);
      expect(getValues).toHaveBeenCalledTimes(1);

      // Clear cache
      clearFileStatusCache();

      // Second update after clearing cache
      const result2 = await updateFileStatus('dashboard-id', 'test-file-id', 'failed', 'Test error');
      expect(result2.ok).toBe(true);
      // getValues should be called again after cache clear
      expect(getValues).toHaveBeenCalledTimes(2);
    });
  });

  describe('Race Condition Prevention', () => {
    beforeEach(() => {
      clearFileStatusCache();
    });

    it('handles concurrent file processing correctly', async () => {
      // Simulate concurrent scenario: two new files being processed
      vi.mocked(getValues)
        .mockResolvedValueOnce({
          // markFileProcessing for file A - no existing entry
          ok: true,
          value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
        })
        .mockResolvedValueOnce({
          // markFileProcessing for file B - no existing entry (file A now exists)
          ok: true,
          value: [
            ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
            ['file-a', 'doc-a.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
          ],
        })
        .mockResolvedValueOnce({
          // updateFileStatus for file A - should find it in row 2
          ok: true,
          value: [
            ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
            ['file-a', 'doc-a.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
            ['file-b', 'doc-b.pdf', '2025-01-15T10:00:01Z', 'pago_enviado', 'processing'],
          ],
        })
        .mockResolvedValueOnce({
          // updateFileStatus for file B - should find it in row 3
          ok: true,
          value: [
            ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
            ['file-a', 'doc-a.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
            ['file-b', 'doc-b.pdf', '2025-01-15T10:00:01Z', 'pago_enviado', 'processing'],
          ],
        });

      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      // Mark both files as processing (simulating concurrent processing)
      await markFileProcessing('dashboard-id', 'file-a', 'doc-a.pdf', 'factura_emitida');
      await markFileProcessing('dashboard-id', 'file-b', 'doc-b.pdf', 'pago_enviado');

      // Update file A status - should look up and find row 2
      await updateFileStatus('dashboard-id', 'file-a', 'success');
      expect(batchUpdate).toHaveBeenNthCalledWith(1, 'dashboard-id', [
        { range: 'Archivos Procesados!E2', values: [['success']] },
      ]);

      // Update file B status - should look up and find row 3 (not row 2!)
      await updateFileStatus('dashboard-id', 'file-b', 'success');
      expect(batchUpdate).toHaveBeenNthCalledWith(2, 'dashboard-id', [
        { range: 'Archivos Procesados!E3', values: [['success']] },
      ]);

      // Verify getValues was called for both markFileProcessing and updateFileStatus
      expect(getValues).toHaveBeenCalledTimes(4); // 2 for mark + 2 for update
    });

    it('looks up row index on updateFileStatus after markFileProcessing', async () => {
      vi.mocked(getValues)
        .mockResolvedValueOnce({
          // markFileProcessing - no existing entry
          ok: true,
          value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
        })
        .mockResolvedValueOnce({
          // updateFileStatus lookup
          ok: true,
          value: [
            ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
            ['test-file', 'test.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'processing'],
          ],
        });

      vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
      vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

      // Mark file as processing
      await markFileProcessing('dashboard-id', 'test-file', 'test.pdf', 'factura_emitida');

      // Update status - should always look up row index
      await updateFileStatus('dashboard-id', 'test-file', 'success');

      // Verify getValues was called for both operations
      expect(getValues).toHaveBeenCalledTimes(2); // 1 for mark + 1 for update
      expect(batchUpdate).toHaveBeenCalledWith('dashboard-id', [
        { range: 'Archivos Procesados!E2', values: [['success']] },
      ]);
    });
  });

  describe('getProcessedFileIds', () => {
    it('returns only successful file IDs from Archivos Procesados sheet', async () => {
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only success files are returned
        expect(result.value.has('file-1')).toBe(true);
        expect(result.value.has('file-2')).toBe(true);
        // Processing files are NOT included (so they can be retried)
        expect(result.value.has('file-3')).toBe(false);
        expect(result.value.size).toBe(2);
      }
      // Reads columns A:E to check status
      expect(getValues).toHaveBeenCalledWith('dashboard-id', 'Archivos Procesados!A:E');
    });

    it('excludes failed files so they can be retried', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['file-1', 'doc1.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'success'],
          ['file-2', 'doc2.pdf', '2025-01-15T11:00:00Z', 'pago_enviado', 'failed: Lock timeout'],
          ['file-3', 'doc3.pdf', '2025-01-15T12:00:00Z', 'factura_recibida', 'failed: Extraction error'],
        ],
      });

      const result = await getProcessedFileIds('dashboard-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only success files are returned
        expect(result.value.has('file-1')).toBe(true);
        // Failed files are NOT included (so they can be retried)
        expect(result.value.has('file-2')).toBe(false);
        expect(result.value.has('file-3')).toBe(false);
        expect(result.value.size).toBe(1);
      }
    });

    it('returns empty set when sheet has only headers', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [['fileId', 'fileName', 'processedAt', 'documentType', 'status']],
      });

      const result = await getProcessedFileIds('dashboard-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(0);
      }
    });

    it('returns error when getValues fails', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: false,
        error: new Error('Sheets API error'),
      });

      const result = await getProcessedFileIds('dashboard-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Sheets API error');
      }
    });

    it('skips rows with empty fileId', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          ['fileId', 'fileName', 'processedAt', 'documentType', 'status'],
          ['file-1', 'doc1.pdf', '2025-01-15T10:00:00Z', 'factura_emitida', 'success'],
          ['', 'doc2.pdf', '2025-01-15T11:00:00Z', 'pago_enviado', 'success'],
          ['file-3', 'doc3.pdf', '2025-01-15T12:00:00Z', 'factura_recibida', 'success'],
        ],
      });

      const result = await getProcessedFileIds('dashboard-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.has('file-1')).toBe(true);
        expect(result.value.has('file-3')).toBe(true);
        expect(result.value.has('')).toBe(false);
        expect(result.value.size).toBe(2);
      }
    });
  });
});
