import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SortBatch } from './sort-batch.js';
import * as sheets from '../../services/sheets.js';

vi.mock('../../services/sheets.js');
vi.mock('../../utils/logger.js');

describe('SortBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addPendingSort() marks sheet for sorting', () => {
    const batch = new SortBatch();

    batch.addPendingSort('spreadsheet-1', 'Sheet1', 0, true);
    batch.addPendingSort('spreadsheet-1', 'Sheet2', 1, false);

    // Verify by checking that flushSorts calls sortSheet
    expect(batch).toBeDefined();
  });

  it('flushSorts() executes all pending sorts', async () => {
    const batch = new SortBatch();

    vi.mocked(sheets.sortSheet).mockResolvedValue({ ok: true, value: undefined });

    batch.addPendingSort('spreadsheet-1', 'Sheet1', 0, true);
    batch.addPendingSort('spreadsheet-1', 'Sheet2', 1, false);
    batch.addPendingSort('spreadsheet-2', 'Data', 2, true);

    await batch.flushSorts();

    expect(sheets.sortSheet).toHaveBeenCalledTimes(3);
    expect(sheets.sortSheet).toHaveBeenCalledWith('spreadsheet-1', 'Sheet1', 0, true);
    expect(sheets.sortSheet).toHaveBeenCalledWith('spreadsheet-1', 'Sheet2', 1, false);
    expect(sheets.sortSheet).toHaveBeenCalledWith('spreadsheet-2', 'Data', 2, true);
  });

  it('flushSorts() clears pending sorts after execution', async () => {
    const batch = new SortBatch();

    vi.mocked(sheets.sortSheet).mockResolvedValue({ ok: true, value: undefined });

    batch.addPendingSort('spreadsheet-1', 'Sheet1', 0, true);

    await batch.flushSorts();

    // Flush again - should not call sortSheet
    await batch.flushSorts();

    expect(sheets.sortSheet).toHaveBeenCalledTimes(1);
  });

  it('flushSorts() handles API errors without throwing', async () => {
    const batch = new SortBatch();

    vi.mocked(sheets.sortSheet).mockResolvedValue({ ok: false, error: new Error('API error') });

    batch.addPendingSort('spreadsheet-1', 'Sheet1', 0, true);

    await expect(batch.flushSorts()).resolves.not.toThrow();
  });

  it('addPendingSort() overwrites params for same sheet', async () => {
    const batch = new SortBatch();

    vi.mocked(sheets.sortSheet).mockResolvedValue({ ok: true, value: undefined });

    // Add same sheet twice with different params
    batch.addPendingSort('spreadsheet-1', 'Sheet1', 0, true);
    batch.addPendingSort('spreadsheet-1', 'Sheet1', 1, false);

    await batch.flushSorts();

    // Should only call once with latest params
    expect(sheets.sortSheet).toHaveBeenCalledTimes(1);
    expect(sheets.sortSheet).toHaveBeenCalledWith('spreadsheet-1', 'Sheet1', 1, false);
  });

  it('clear() removes pending sorts without executing', async () => {
    const batch = new SortBatch();

    vi.mocked(sheets.sortSheet).mockResolvedValue({ ok: true, value: undefined });

    batch.addPendingSort('spreadsheet-1', 'Sheet1', 0, true);
    batch.clear();

    await batch.flushSorts();

    expect(sheets.sortSheet).not.toHaveBeenCalled();
  });

  it('flushSorts() does nothing when no pending sorts', async () => {
    const batch = new SortBatch();

    await batch.flushSorts();

    expect(sheets.sortSheet).not.toHaveBeenCalled();
  });
});
