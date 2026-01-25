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
});
