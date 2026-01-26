/**
 * Tests for SheetOrderBatch class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetOrderBatch } from './sheet-order-batch.js';

// Mock the sheets service
vi.mock('../../services/sheets.js', () => ({
  reorderMonthSheets: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
}));

import { reorderMonthSheets } from '../../services/sheets.js';

describe('SheetOrderBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addPendingReorder', () => {
    it('should add spreadsheet ID to pending set', () => {
      const batch = new SheetOrderBatch();
      batch.addPendingReorder('spreadsheet-1');

      // After flush, should call reorderMonthSheets with the spreadsheet
      batch.flushReorders();
      expect(reorderMonthSheets).toHaveBeenCalledWith('spreadsheet-1');
    });

    it('should deduplicate multiple adds for same spreadsheet', async () => {
      const batch = new SheetOrderBatch();
      batch.addPendingReorder('spreadsheet-1');
      batch.addPendingReorder('spreadsheet-1');
      batch.addPendingReorder('spreadsheet-1');

      await batch.flushReorders();

      // Should only call once despite adding three times
      expect(reorderMonthSheets).toHaveBeenCalledTimes(1);
      expect(reorderMonthSheets).toHaveBeenCalledWith('spreadsheet-1');
    });

    it('should track multiple different spreadsheets', async () => {
      const batch = new SheetOrderBatch();
      batch.addPendingReorder('spreadsheet-1');
      batch.addPendingReorder('spreadsheet-2');
      batch.addPendingReorder('spreadsheet-3');

      await batch.flushReorders();

      expect(reorderMonthSheets).toHaveBeenCalledTimes(3);
      expect(reorderMonthSheets).toHaveBeenCalledWith('spreadsheet-1');
      expect(reorderMonthSheets).toHaveBeenCalledWith('spreadsheet-2');
      expect(reorderMonthSheets).toHaveBeenCalledWith('spreadsheet-3');
    });
  });

  describe('flushReorders', () => {
    it('should do nothing when no pending reorders', async () => {
      const batch = new SheetOrderBatch();
      await batch.flushReorders();

      expect(reorderMonthSheets).not.toHaveBeenCalled();
    });

    it('should clear pending set after flush', async () => {
      const batch = new SheetOrderBatch();
      batch.addPendingReorder('spreadsheet-1');

      await batch.flushReorders();
      expect(reorderMonthSheets).toHaveBeenCalledTimes(1);

      // Second flush should not call again
      await batch.flushReorders();
      expect(reorderMonthSheets).toHaveBeenCalledTimes(1);
    });

    it('should continue processing if one spreadsheet fails', async () => {
      vi.mocked(reorderMonthSheets)
        .mockResolvedValueOnce({ ok: false, error: new Error('API error') })
        .mockResolvedValueOnce({ ok: true, value: undefined });

      const batch = new SheetOrderBatch();
      batch.addPendingReorder('spreadsheet-1');
      batch.addPendingReorder('spreadsheet-2');

      // Should not throw
      await batch.flushReorders();

      expect(reorderMonthSheets).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear', () => {
    it('should clear pending reorders without executing them', async () => {
      const batch = new SheetOrderBatch();
      batch.addPendingReorder('spreadsheet-1');
      batch.addPendingReorder('spreadsheet-2');

      batch.clear();

      await batch.flushReorders();
      expect(reorderMonthSheets).not.toHaveBeenCalled();
    });
  });
});
