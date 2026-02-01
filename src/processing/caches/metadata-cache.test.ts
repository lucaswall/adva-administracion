import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataCache } from './metadata-cache.js';
import * as sheets from '../../services/sheets.js';

vi.mock('../../services/sheets.js');

describe('MetadataCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached value on second call', async () => {
    const cache = new MetadataCache();
    const mockMetadata = [
      { title: 'Sheet1', sheetId: 0, index: 0 },
      { title: 'Sheet2', sheetId: 1, index: 1 },
    ];

    vi.mocked(sheets.getSheetMetadataInternal).mockResolvedValueOnce({ ok: true, value: mockMetadata });

    const result1 = await cache.get('spreadsheet-id');
    const result2 = await cache.get('spreadsheet-id');

    expect(result1).toEqual({ ok: true, value: mockMetadata });
    expect(result2).toEqual({ ok: true, value: mockMetadata });
    expect(sheets.getSheetMetadataInternal).toHaveBeenCalledTimes(1);
  });

  it('concurrent calls share single API request', async () => {
    const cache = new MetadataCache();
    const mockMetadata = [
      { title: 'Sheet1', sheetId: 0, index: 0 },
    ];

    vi.mocked(sheets.getSheetMetadataInternal).mockResolvedValueOnce({ ok: true, value: mockMetadata });

    const promises = [
      cache.get('spreadsheet-id'),
      cache.get('spreadsheet-id'),
      cache.get('spreadsheet-id'),
    ];

    const results = await Promise.all(promises);

    expect(results[0]).toEqual({ ok: true, value: mockMetadata });
    expect(results[1]).toEqual({ ok: true, value: mockMetadata });
    expect(results[2]).toEqual({ ok: true, value: mockMetadata });
    expect(sheets.getSheetMetadataInternal).toHaveBeenCalledTimes(1);
  });

  it('clear() allows fresh fetch', async () => {
    const cache = new MetadataCache();
    const mockMetadata1 = [{ title: 'Sheet1', sheetId: 0, index: 0 }];
    const mockMetadata2 = [{ title: 'Sheet2', sheetId: 1, index: 0 }];

    vi.mocked(sheets.getSheetMetadataInternal)
      .mockResolvedValueOnce({ ok: true, value: mockMetadata1 })
      .mockResolvedValueOnce({ ok: true, value: mockMetadata2 });

    await cache.get('spreadsheet-id');
    cache.clear();
    await cache.get('spreadsheet-id');

    expect(sheets.getSheetMetadataInternal).toHaveBeenCalledTimes(2);
  });

  it('handles errors from API', async () => {
    const cache = new MetadataCache();
    const mockError = new Error('API error');

    vi.mocked(sheets.getSheetMetadataInternal).mockResolvedValueOnce({ ok: false, error: mockError });

    const result = await cache.get('spreadsheet-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(mockError);
    }
  });

  it('caches different spreadsheets separately', async () => {
    const cache = new MetadataCache();
    const mockMetadata1 = [{ title: 'Sheet1', sheetId: 0, index: 0 }];
    const mockMetadata2 = [{ title: 'Sheet2', sheetId: 1, index: 0 }];

    vi.mocked(sheets.getSheetMetadataInternal)
      .mockResolvedValueOnce({ ok: true, value: mockMetadata1 })
      .mockResolvedValueOnce({ ok: true, value: mockMetadata2 });

    const result1 = await cache.get('spreadsheet-1');
    const result2 = await cache.get('spreadsheet-2');

    expect(result1).toEqual({ ok: true, value: mockMetadata1 });
    expect(result2).toEqual({ ok: true, value: mockMetadata2 });
    expect(sheets.getSheetMetadataInternal).toHaveBeenCalledTimes(2);
    expect(sheets.getSheetMetadataInternal).toHaveBeenCalledWith('spreadsheet-1');
    expect(sheets.getSheetMetadataInternal).toHaveBeenCalledWith('spreadsheet-2');
  });

  describe('Bug #8: Negative cache entries', () => {
    it('should retry after transient failure (not cache rejected promise)', async () => {
      const cache = new MetadataCache();
      const mockMetadata = [{ title: 'Sheet1', sheetId: 0, index: 0 }];

      // First call fails (transient error)
      vi.mocked(sheets.getSheetMetadataInternal)
        .mockResolvedValueOnce({ ok: false, error: new Error('Transient API error') });

      const result1 = await cache.get('spreadsheet-id');
      expect(result1.ok).toBe(false);

      // Second call succeeds (API recovered)
      vi.mocked(sheets.getSheetMetadataInternal)
        .mockResolvedValueOnce({ ok: true, value: mockMetadata });

      const result2 = await cache.get('spreadsheet-id');

      // This will fail with current code because the rejected promise is cached
      // The cache stores the promise directly: this.cache.set(spreadsheetId, getSheetMetadataInternal(spreadsheetId))
      // If the promise rejects, subsequent calls await the same rejected promise
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value).toEqual(mockMetadata);
      }
    });

    it('should make new API call after rejection', async () => {
      const cache = new MetadataCache();

      // First call fails
      vi.mocked(sheets.getSheetMetadataInternal)
        .mockResolvedValueOnce({ ok: false, error: new Error('Error 1') });

      await cache.get('spreadsheet-id');

      // Second call should make new API request
      vi.mocked(sheets.getSheetMetadataInternal)
        .mockResolvedValueOnce({ ok: false, error: new Error('Error 2') });

      await cache.get('spreadsheet-id');

      // With current code, getSheetMetadataInternal is only called once
      // because the failed promise is cached
      expect(sheets.getSheetMetadataInternal).toHaveBeenCalledTimes(2);
    });
  });
});
