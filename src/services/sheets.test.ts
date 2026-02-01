/**
 * Tests for Google Sheets API wrapper - quota retry behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';
import {
  getValues,
  setValues,
  appendRows,
  batchUpdate,
  getSheetMetadata,
  getSpreadsheetTimezone,
  createSheet,
  formatSheet,
  formatStatusSheet,
  applyConditionalFormat,
  deleteSheet,
  clearSheetData,
  appendRowsWithLinks,
  sortSheet,
  moveSheetToFirst,
  appendRowsWithFormatting,
  formatEmptyMonthSheet,
  clearSheetsCache,
  clearTimezoneCache,
  getMonthSheetPosition,
  moveSheetToPosition,
  getOrCreateMonthSheet,
  reorderMonthSheets,
} from './sheets.js';

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(),
  },
}));

// Mock google-auth
vi.mock('./google-auth.js', () => ({
  getGoogleAuth: vi.fn(() => ({})),
  getGoogleAuthAsync: vi.fn(async () => ({})),
  getDefaultScopes: vi.fn(() => []),
}));

describe('Google Sheets API wrapper - quota retry tests', () => {
  let mockSheetsApi: {
    spreadsheets: {
      values: {
        get: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        append: ReturnType<typeof vi.fn>;
        batchUpdate: ReturnType<typeof vi.fn>;
        clear: ReturnType<typeof vi.fn>;
      };
      get: ReturnType<typeof vi.fn>;
      batchUpdate: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearSheetsCache();
    clearTimezoneCache();

    // Create mock API
    mockSheetsApi = {
      spreadsheets: {
        values: {
          get: vi.fn(),
          update: vi.fn(),
          append: vi.fn(),
          batchUpdate: vi.fn(),
          clear: vi.fn(),
        },
        get: vi.fn(),
        batchUpdate: vi.fn(),
      },
    };

    // Mock google.sheets to return our mock API
    vi.mocked(google.sheets).mockReturnValue(mockSheetsApi as unknown as sheets_v4.Sheets);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getValues', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['A1', 'B1'], ['A2', 'B2']] },
      });

      const resultPromise = getValues('spreadsheet123', 'Sheet1!A1:B2');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([['A1', 'B1'], ['A2', 'B2']]);
      }
      expect(mockSheetsApi.spreadsheets.values.get).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.values.get
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: { values: [['A1', 'B1']] },
        });

      const resultPromise = getValues('spreadsheet123', 'Sheet1!A1:B1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([['A1', 'B1']]);
      }
      expect(mockSheetsApi.spreadsheets.values.get).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.values.get.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = getValues('spreadsheet123', 'Sheet1!A1:B1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Quota exceeded');
      }
    });
  });

  describe('setValues', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.values.update.mockResolvedValue({
        data: { updatedCells: 2 },
      });

      const resultPromise = setValues('spreadsheet123', 'Sheet1!A1:B1', [['A1', 'B1']]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(2);
      }
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.values.update
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({
          data: { updatedCells: 2 },
        });

      const resultPromise = setValues('spreadsheet123', 'Sheet1!A1:B1', [['A1', 'B1']]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(2);
      }
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.values.update.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = setValues('spreadsheet123', 'Sheet1!A1:B1', [['A1', 'B1']]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('appendRows', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.values.append.mockResolvedValue({
        data: { updates: { updatedCells: 3 } },
      });

      const resultPromise = appendRows('spreadsheet123', 'Sheet1!A:C', [['A1', 'B1', 'C1']]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(3);
      }
      expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.values.append
        .mockRejectedValueOnce(new Error('Too many requests'))
        .mockResolvedValueOnce({
          data: { updates: { updatedCells: 3 } },
        });

      const resultPromise = appendRows('spreadsheet123', 'Sheet1!A:C', [['A1', 'B1', 'C1']]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.values.append.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = appendRows('spreadsheet123', 'Sheet1!A:C', [['A1', 'B1', 'C1']]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('batchUpdate', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.values.batchUpdate.mockResolvedValue({
        data: { totalUpdatedCells: 5 },
      });

      const resultPromise = batchUpdate('spreadsheet123', [
        { range: 'Sheet1!A1', values: [['A1']] },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(5);
      }
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.values.batchUpdate
        .mockRejectedValueOnce(new Error('HTTP 429: Too Many Requests'))
        .mockResolvedValueOnce({
          data: { totalUpdatedCells: 5 },
        });

      const resultPromise = batchUpdate('spreadsheet123', [
        { range: 'Sheet1!A1', values: [['A1']] },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.values.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = batchUpdate('spreadsheet123', [
        { range: 'Sheet1!A1', values: [['A1']] },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('getSheetMetadata', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });

      const resultPromise = getSheetMetadata('spreadsheet123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([{ title: 'Sheet1', sheetId: 0, index: 0 }]);
      }
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.get
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: {
            sheets: [
              { properties: { title: 'Sheet1', sheetId: 0 } },
            ],
          },
        });

      const resultPromise = getSheetMetadata('spreadsheet123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.get.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = getSheetMetadata('spreadsheet123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('getSheetMetadataInternal', () => {
    it('should return metadata without retry wrapper', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
            { properties: { title: 'Sheet2', sheetId: 1, index: 1 } },
          ],
        },
      });

      // Import the internal function - will need to export it
      const { getSheetMetadataInternal } = await import('./sheets.js');
      const result = await getSheetMetadataInternal('spreadsheet123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { title: 'Sheet1', sheetId: 0, index: 0 },
          { title: 'Sheet2', sheetId: 1, index: 1 },
        ]);
      }
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors as Result without retrying', async () => {
      mockSheetsApi.spreadsheets.get.mockRejectedValue(new Error('Quota exceeded'));

      const { getSheetMetadataInternal } = await import('./sheets.js');
      const result = await getSheetMetadataInternal('spreadsheet123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Quota exceeded');
      }
      // Should NOT retry - only called once
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should handle missing sheets gracefully', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {},
      });

      const { getSheetMetadataInternal } = await import('./sheets.js');
      const result = await getSheetMetadataInternal('spreadsheet123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('getSpreadsheetTimezone', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          properties: { timeZone: 'America/Argentina/Buenos_Aires' },
        },
      });

      const resultPromise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('America/Argentina/Buenos_Aires');
      }
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.get
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({
          data: {
            properties: { timeZone: 'America/Argentina/Buenos_Aires' },
          },
        });

      const resultPromise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.get.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('createSheet', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
        data: {
          replies: [
            { addSheet: { properties: { sheetId: 123 } } },
          ],
        },
      });

      const resultPromise = createSheet('spreadsheet123', 'NewSheet');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(123);
      }
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: {
            replies: [
              { addSheet: { properties: { sheetId: 123 } } },
            ],
          },
        });

      const resultPromise = createSheet('spreadsheet123', 'NewSheet');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = createSheet('spreadsheet123', 'NewSheet');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('formatSheet', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = formatSheet('spreadsheet123', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Too many requests'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = formatSheet('spreadsheet123', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = formatSheet('spreadsheet123', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('formatStatusSheet', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = formatStatusSheet('spreadsheet123', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('HTTP 429'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = formatStatusSheet('spreadsheet123', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = formatStatusSheet('spreadsheet123', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('applyConditionalFormat', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = applyConditionalFormat('spreadsheet123', [
        {
          sheetId: 0,
          startRowIndex: 0,
          endRowIndex: 10,
          startColumnIndex: 0,
          endColumnIndex: 1,
          text: 'ONLINE',
          textColor: { red: 0, green: 1, blue: 0 },
          bold: true,
        },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = applyConditionalFormat('spreadsheet123', [
        {
          sheetId: 0,
          startRowIndex: 0,
          endRowIndex: 10,
          startColumnIndex: 0,
          endColumnIndex: 1,
          text: 'ONLINE',
          textColor: { red: 0, green: 1, blue: 0 },
          bold: true,
        },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = applyConditionalFormat('spreadsheet123', [
        {
          sheetId: 0,
          startRowIndex: 0,
          endRowIndex: 10,
          startColumnIndex: 0,
          endColumnIndex: 1,
          text: 'ONLINE',
          textColor: { red: 0, green: 1, blue: 0 },
          bold: true,
        },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('deleteSheet', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = deleteSheet('spreadsheet123', 123);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = deleteSheet('spreadsheet123', 123);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = deleteSheet('spreadsheet123', 123);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('clearSheetData', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.values.clear.mockResolvedValue({ data: {} });

      const resultPromise = clearSheetData('spreadsheet123', 'Sheet1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.values.clear).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.values.clear
        .mockRejectedValueOnce(new Error('Too many requests'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = clearSheetData('spreadsheet123', 'Sheet1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.values.clear).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.values.clear.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = clearSheetData('spreadsheet123', 'Sheet1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('appendRowsWithLinks', () => {
    it('should succeed on first attempt', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = appendRowsWithLinks(
        'spreadsheet123',
        'Sheet1!A:C',
        [[{ text: 'Link', url: 'https://example.com' }, 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = appendRowsWithLinks(
        'spreadsheet123',
        'Sheet1!A:C',
        [[{ text: 'Link', url: 'https://example.com' }, 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = appendRowsWithLinks(
        'spreadsheet123',
        'Sheet1!A:C',
        [[{ text: 'Link', url: 'https://example.com' }, 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });

    it('should retry entire operation when metadata fetch fails with quota error', async () => {
      // First call to spreadsheets.get fails, second succeeds
      mockSheetsApi.spreadsheets.get
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: {
            sheets: [
              { properties: { title: 'Sheet1', sheetId: 0 } },
            ],
          },
        });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = appendRowsWithLinks(
        'spreadsheet123',
        'Sheet1!A:C',
        [[{ text: 'Link', url: 'https://example.com' }, 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      // Both metadata and append should have been called (retry includes both steps)
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry entire operation when append fails after successful metadata fetch', async () => {
      // Metadata succeeds twice, but first append fails
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = appendRowsWithLinks(
        'spreadsheet123',
        'Sheet1!A:C',
        [[{ text: 'Link', url: 'https://example.com' }, 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      // Metadata should be called twice (once per attempt)
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('sortSheet', () => {
    it('should succeed on first attempt', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = sortSheet('spreadsheet123', 'Sheet1', 0, true);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('HTTP 429'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = sortSheet('spreadsheet123', 'Sheet1', 0, true);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = sortSheet('spreadsheet123', 'Sheet1', 0, true);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });

    it('should retry entire operation when metadata fetch fails with quota error', async () => {
      mockSheetsApi.spreadsheets.get
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: {
            sheets: [
              { properties: { title: 'Sheet1', sheetId: 0 } },
            ],
          },
        });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = sortSheet('spreadsheet123', 'Sheet1', 0, true);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry entire operation when sort fails after successful metadata fetch', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = sortSheet('spreadsheet123', 'Sheet1', 0, true);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('moveSheetToFirst', () => {
    it('should succeed on first attempt', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = moveSheetToFirst('spreadsheet123', 'Sheet1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = moveSheetToFirst('spreadsheet123', 'Sheet1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = moveSheetToFirst('spreadsheet123', 'Sheet1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });

    it('should retry entire operation when metadata fetch fails with quota error', async () => {
      mockSheetsApi.spreadsheets.get
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: {
            sheets: [
              { properties: { title: 'Sheet1', sheetId: 0 } },
            ],
          },
        });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = moveSheetToFirst('spreadsheet123', 'Sheet1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry entire operation when move fails after successful metadata fetch', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = moveSheetToFirst('spreadsheet123', 'Sheet1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('appendRowsWithFormatting', () => {
    it('should succeed on first attempt', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = appendRowsWithFormatting(
        'spreadsheet123',
        'Sheet1!A:C',
        [['A', 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Too many requests'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = appendRowsWithFormatting(
        'spreadsheet123',
        'Sheet1!A:C',
        [['A', 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      // Mock getSheetMetadata
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = appendRowsWithFormatting(
        'spreadsheet123',
        'Sheet1!A:C',
        [['A', 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });

    it('should retry entire operation when metadata fetch fails with quota error', async () => {
      // First call to spreadsheets.get fails, second succeeds
      mockSheetsApi.spreadsheets.get
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: {
            sheets: [
              { properties: { title: 'Sheet1', sheetId: 0 } },
            ],
          },
        });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = appendRowsWithFormatting(
        'spreadsheet123',
        'Sheet1!A:C',
        [['A', 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry entire operation when append fails after successful metadata fetch', async () => {
      // Metadata succeeds twice, but first append fails
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Sheet1', sheetId: 0 } },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = appendRowsWithFormatting(
        'spreadsheet123',
        'Sheet1!A:C',
        [['A', 'B', 'C']]
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('formatEmptyMonthSheet', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = formatEmptyMonthSheet('spreadsheet123', 0, 5);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = formatEmptyMonthSheet('spreadsheet123', 0, 5);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = formatEmptyMonthSheet('spreadsheet123', 0, 5);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
    });
  });

  describe('getSpreadsheetTimezone with cache', () => {
    it('should fetch from API on first call', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          properties: { timeZone: 'America/Argentina/Buenos_Aires' },
        },
      });

      const resultPromise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('America/Argentina/Buenos_Aires');
      }
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should return cached value on second call', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          properties: { timeZone: 'America/Argentina/Buenos_Aires' },
        },
      });

      // First call
      const result1Promise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      const result1 = await result1Promise;

      expect(result1.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2Promise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      const result2 = await result2Promise;

      expect(result2.ok).toBe(true);
      if (result2.ok && result1.ok) {
        expect(result2.value).toBe(result1.value);
      }
      // API should still only be called once
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should fetch for different spreadsheetId', async () => {
      mockSheetsApi.spreadsheets.get
        .mockResolvedValueOnce({
          data: {
            properties: { timeZone: 'America/Argentina/Buenos_Aires' },
          },
        })
        .mockResolvedValueOnce({
          data: {
            properties: { timeZone: 'America/New_York' },
          },
        });

      // Call with first spreadsheet
      const result1Promise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      const result1 = await result1Promise;

      expect(result1.ok).toBe(true);

      // Call with different spreadsheet
      const result2Promise = getSpreadsheetTimezone('spreadsheet456');
      await vi.runAllTimersAsync();
      const result2 = await result2Promise;

      expect(result2.ok).toBe(true);

      // API should be called for each different spreadsheet
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });

    it('should clear cache with clearTimezoneCache()', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          properties: { timeZone: 'America/Argentina/Buenos_Aires' },
        },
      });

      // First call
      const result1Promise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      await result1Promise;

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);

      // Clear cache
      clearTimezoneCache();

      // Second call after clearing cache
      const result2Promise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      await result2Promise;

      // API should be called again after cache clear
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });

    it('should expire cache after 24h', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          properties: { timeZone: 'America/Argentina/Buenos_Aires' },
        },
      });

      // First call
      const result1Promise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      await result1Promise;

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);

      // Advance time by 24 hours + 1 second
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);

      // Second call after cache expiration
      const result2Promise = getSpreadsheetTimezone('spreadsheet123');
      await vi.runAllTimersAsync();
      await result2Promise;

      // API should be called again after expiration
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });

    it('should evict oldest entries when cache exceeds MAX_TIMEZONE_CACHE_SIZE', async () => {
      // MAX_TIMEZONE_CACHE_SIZE is 100
      // Mock enough responses for all expected API calls
      mockSheetsApi.spreadsheets.get.mockImplementation(({ spreadsheetId }) => {
        const id = spreadsheetId as string;
        return Promise.resolve({
          data: {
            properties: { timeZone: `America/Zone_${id}` },
          },
        });
      });

      // Fill cache with 100 entries (0-99)
      for (let i = 0; i < 100; i++) {
        const resultPromise = getSpreadsheetTimezone(`spreadsheet${i}`);
        await vi.runAllTimersAsync();
        const result = await resultPromise;
        expect(result.ok).toBe(true);

        // Advance time by 1ms to ensure different timestamps
        vi.advanceTimersByTime(1);
      }

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(100);
      // Cache state: entries 0-99 (size 100)

      // Add one more entry - should evict the oldest (spreadsheet0)
      const result100Promise = getSpreadsheetTimezone('spreadsheet100');
      await vi.runAllTimersAsync();
      const result100 = await result100Promise;
      expect(result100.ok).toBe(true);

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(101);
      // Cache state: entries 1-100 (size 100, entry 0 evicted)

      // Now accessing spreadsheet0 should require a new API call (was evicted)
      // This will evict spreadsheet1 (now the oldest)
      const result0Promise = getSpreadsheetTimezone('spreadsheet0');
      await vi.runAllTimersAsync();
      const result0 = await result0Promise;

      expect(result0.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(102);
      // Cache state: entries 2-100,0 (size 100, entry 1 evicted)

      // spreadsheet99 should still be in cache (was not evicted)
      const result99Promise = getSpreadsheetTimezone('spreadsheet99');
      await vi.runAllTimersAsync();
      await result99Promise;

      // No additional API call - still cached
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(102);

      // spreadsheet100 should also still be in cache
      const result100BPromise = getSpreadsheetTimezone('spreadsheet100');
      await vi.runAllTimersAsync();
      await result100BPromise;

      // No additional API call - still cached
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(102);
    });

    it('should maintain cache at or below MAX_TIMEZONE_CACHE_SIZE', async () => {
      // Mock all responses
      mockSheetsApi.spreadsheets.get.mockImplementation(({ spreadsheetId }) => {
        const id = spreadsheetId as string;
        return Promise.resolve({
          data: {
            properties: { timeZone: `America/Zone_${id}` },
          },
        });
      });

      // Add 150 entries
      for (let i = 0; i < 150; i++) {
        const resultPromise = getSpreadsheetTimezone(`spreadsheet${i}`);
        await vi.runAllTimersAsync();
        await resultPromise;

        // Advance time to ensure different timestamps
        vi.advanceTimersByTime(1);
      }

      // All 150 entries required API calls
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(150);

      // The last 100 entries (50-149) should still be cached
      // Verify by accessing spreadsheet149 (should be cached)
      const result149Promise = getSpreadsheetTimezone('spreadsheet149');
      await vi.runAllTimersAsync();
      await result149Promise;

      // No additional API call
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(150);
    });
  });

  describe('Sheet chronological ordering', () => {
    describe('getMonthSheetPosition', () => {
      it('should return 0 for first sheet when no sheets exist', () => {
        const existingSheets: Array<{title: string; index: number}> = [];
        const position = getMonthSheetPosition(existingSheets, '2025-01');
        expect(position).toBe(0);
      });

      it('should place Jan before Mar when Mar exists', () => {
        const existingSheets = [
          { title: '2025-03', index: 0 },
        ];
        const position = getMonthSheetPosition(existingSheets, '2025-01');
        expect(position).toBe(0);
      });

      it('should place Mar after Jan when Jan exists', () => {
        const existingSheets = [
          { title: '2025-01', index: 0 },
        ];
        const position = getMonthSheetPosition(existingSheets, '2025-03');
        expect(position).toBe(1);
      });

      it('should place Feb between Jan and Mar', () => {
        const existingSheets = [
          { title: '2025-01', index: 0 },
          { title: '2025-03', index: 1 },
        ];
        const position = getMonthSheetPosition(existingSheets, '2025-02');
        expect(position).toBe(1);
      });

      it('should place Dec after all other months', () => {
        const existingSheets = [
          { title: '2025-01', index: 0 },
          { title: '2025-03', index: 1 },
          { title: '2025-07', index: 2 },
        ];
        const position = getMonthSheetPosition(existingSheets, '2025-12');
        expect(position).toBe(3);
      });

      it('should handle sheets out of order', () => {
        const existingSheets = [
          { title: '2025-12', index: 0 },
          { title: '2025-01', index: 1 },
          { title: '2025-03', index: 2 },
        ];
        const position = getMonthSheetPosition(existingSheets, '2025-02');
        // Should be placed after 01 (index 1) and before 03 (index 2)
        expect(position).toBe(2);
      });

      it('should ignore non-YYYY-MM formatted sheets', () => {
        const existingSheets = [
          { title: 'Summary', index: 0 },
          { title: '2025-01', index: 1 },
          { title: 'Other Sheet', index: 2 },
          { title: '2025-03', index: 3 },
        ];
        const position = getMonthSheetPosition(existingSheets, '2025-02');
        // Should insert before 2025-03 (index 3), leaving Other Sheet in place
        expect(position).toBe(3);
      });

      it('should handle multi-year sheets correctly', () => {
        const existingSheets = [
          { title: '2024-11', index: 0 },
          { title: '2024-12', index: 1 },
          { title: '2025-02', index: 2 },
        ];
        const position = getMonthSheetPosition(existingSheets, '2025-01');
        expect(position).toBe(2); // After 2024 sheets, before 2025-02
      });
    });

    describe('moveSheetToPosition', () => {
      it('should move sheet to specified position', async () => {
        mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

        const resultPromise = moveSheetToPosition('spreadsheet123', 456, 2);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'spreadsheet123',
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: 456,
                    index: 2,
                  },
                  fields: 'index',
                },
              },
            ],
          },
        });
      });

      it('should retry and succeed after quota error', async () => {
        mockSheetsApi.spreadsheets.batchUpdate
          .mockRejectedValueOnce(new Error('Quota exceeded'))
          .mockResolvedValueOnce({ data: {} });

        const resultPromise = moveSheetToPosition('spreadsheet123', 456, 1);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
      });

      it('should return error after exhausting retries', async () => {
        mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

        const resultPromise = moveSheetToPosition('spreadsheet123', 456, 1);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(false);
      });
    });

    describe('reorderMonthSheets', () => {
      it('should do nothing when no month sheets exist', async () => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: 'Summary', sheetId: 0, index: 0 } },
            ],
          },
        });

        const resultPromise = reorderMonthSheets('spreadsheet123');
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        // No move calls should be made
        expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });

      it('should do nothing when only one month sheet exists', async () => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: '2025-01', sheetId: 100, index: 0 } },
            ],
          },
        });

        const resultPromise = reorderMonthSheets('spreadsheet123');
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        // No move calls should be made
        expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });

      it('should reorder month sheets chronologically', async () => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: '2025-03', sheetId: 102, index: 0 } },
              { properties: { title: '2025-01', sheetId: 100, index: 1 } },
              { properties: { title: '2025-02', sheetId: 101, index: 2 } },
            ],
          },
        });
        mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

        const resultPromise = reorderMonthSheets('spreadsheet123');
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        // Should call moveSheetToPosition 3 times (once per month sheet)
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(3);
        // First call should move 2025-01 to position 0
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenNthCalledWith(1,
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  updateSheetProperties: expect.objectContaining({
                    properties: { sheetId: 100, index: 0 },
                  }),
                }),
              ],
            }),
          })
        );
      });

      it('should ignore non-YYYY-MM formatted sheets', async () => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: 'Summary', sheetId: 0, index: 0 } },
              { properties: { title: '2025-02', sheetId: 101, index: 1 } },
              { properties: { title: '2025-01', sheetId: 100, index: 2 } },
            ],
          },
        });
        mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

        const resultPromise = reorderMonthSheets('spreadsheet123');
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        // Should call moveSheetToPosition only for month sheets (2 times)
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
      });

      it('should handle API errors during reordering', async () => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: '2025-02', sheetId: 101, index: 0 } },
              { properties: { title: '2025-01', sheetId: 100, index: 1 } },
            ],
          },
        });
        mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

        const resultPromise = reorderMonthSheets('spreadsheet123');
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Quota exceeded');
        }
      });

      it('should delete Sheet1 if it exists and only month sheets remain', async () => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
              { properties: { title: '2025-02', sheetId: 101, index: 1 } },
              { properties: { title: '2025-01', sheetId: 100, index: 2 } },
            ],
          },
        });
        mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

        const resultPromise = reorderMonthSheets('spreadsheet123');
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        // Should call batchUpdate: 1 delete for Sheet1 + 2 moves for month sheets
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(3);
        // Verify first call was delete Sheet1
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenNthCalledWith(1,
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  deleteSheet: { sheetId: 0 },
                }),
              ],
            }),
          })
        );
      });

      it('should delete Sheet1 even with only one month sheet', async () => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
              { properties: { title: '2025-01', sheetId: 100, index: 1 } },
            ],
          },
        });
        mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

        const resultPromise = reorderMonthSheets('spreadsheet123');
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        // Should call batchUpdate only 1 time for deleting Sheet1
        // No reordering needed with only 1 month sheet
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  deleteSheet: { sheetId: 0 },
                }),
              ],
            }),
          })
        );
      });

      it('should not delete Sheet1 if non-month sheets exist', async () => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
              { properties: { title: 'Summary', sheetId: 50, index: 1 } },
              { properties: { title: '2025-02', sheetId: 101, index: 2 } },
              { properties: { title: '2025-01', sheetId: 100, index: 3 } },
            ],
          },
        });
        mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

        const resultPromise = reorderMonthSheets('spreadsheet123');
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        // Should call batchUpdate only 2 times for moving the month sheets
        // Sheet1 should NOT be deleted because 'Summary' is a non-month sheet
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
        // Verify no deleteSheet call was made
        const calls = mockSheetsApi.spreadsheets.batchUpdate.mock.calls;
        for (const call of calls) {
          const requests = call[0]?.requestBody?.requests || [];
          for (const req of requests) {
            expect(req).not.toHaveProperty('deleteSheet');
          }
        }
      });
    });

    describe('getOrCreateMonthSheet - chronological ordering integration', () => {
      it('should create sheet and move to correct position', async () => {
        // Mock getSheetMetadata to return existing sheets
        mockSheetsApi.spreadsheets.get
          .mockResolvedValueOnce({
            // First call to getSheetMetadata in getOrCreateMonthSheet
            data: {
              sheets: [
                { properties: { title: '2025-01', sheetId: 100, index: 0 } },
                { properties: { title: '2025-03', sheetId: 102, index: 1 } },
              ],
            },
          })
          .mockResolvedValueOnce({
            // Second call after createSheet to get updated metadata with index
            data: {
              sheets: [
                { properties: { title: '2025-01', sheetId: 100, index: 0 } },
                { properties: { title: '2025-03', sheetId: 102, index: 1 } },
                { properties: { title: '2025-02', sheetId: 101, index: 2 } },
              ],
            },
          });

        // Mock createSheet
        mockSheetsApi.spreadsheets.batchUpdate
          .mockResolvedValueOnce({
            data: {
              replies: [{ addSheet: { properties: { sheetId: 101 } } }],
            },
          })
          // Mock formatSheet
          .mockResolvedValueOnce({ data: {} })
          // Mock moveSheetToPosition
          .mockResolvedValueOnce({ data: {} });

        mockSheetsApi.spreadsheets.values.update.mockResolvedValue({ data: {} });

        const resultPromise = getOrCreateMonthSheet(
          'spreadsheet123',
          '2025-02',
          ['fecha', 'descripcion', 'monto']
        );
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(101);
        }

        // Verify moveSheetToPosition was called with correct position (1, between Jan and Mar)
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  updateSheetProperties: expect.objectContaining({
                    properties: expect.objectContaining({
                      sheetId: 101,
                      index: 1,
                    }),
                  }),
                }),
              ]),
            }),
          })
        );
      });

      it('should not move sheet if it already exists', async () => {
        // Mock getSheetMetadata to return sheet that already exists
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: '2025-01', sheetId: 100, index: 0 } },
              { properties: { title: '2025-02', sheetId: 101, index: 1 } },
            ],
          },
        });

        const resultPromise = getOrCreateMonthSheet(
          'spreadsheet123',
          '2025-02',
          ['fecha', 'descripcion', 'monto']
        );
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(101);
        }

        // Should not call createSheet or moveSheetToPosition
        expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });

      it('should delete Sheet1 when creating first month sheet', async () => {
        // Mock getSheetMetadata to return only Sheet1 (default sheet in new spreadsheets)
        mockSheetsApi.spreadsheets.get
          .mockResolvedValueOnce({
            // First call to getSheetMetadata in getOrCreateMonthSheet
            data: {
              sheets: [
                { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
              ],
            },
          })
          .mockResolvedValueOnce({
            // Second call after createSheet to get updated metadata with index
            data: {
              sheets: [
                { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
                { properties: { title: '2025-01', sheetId: 101, index: 1 } },
              ],
            },
          });

        // Mock createSheet, formatSheet, moveSheetToPosition, and deleteSheet
        mockSheetsApi.spreadsheets.batchUpdate
          .mockResolvedValueOnce({
            // Mock createSheet
            data: {
              replies: [{ addSheet: { properties: { sheetId: 101 } } }],
            },
          })
          .mockResolvedValueOnce({ data: {} }) // Mock formatSheet
          .mockResolvedValueOnce({ data: {} }) // Mock moveSheetToPosition
          .mockResolvedValueOnce({ data: {} }); // Mock deleteSheet

        mockSheetsApi.spreadsheets.values.update.mockResolvedValue({ data: {} });

        const resultPromise = getOrCreateMonthSheet(
          'spreadsheet123',
          '2025-01',
          ['fecha', 'descripcion', 'monto']
        );
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(101);
        }

        // Verify deleteSheet was called with Sheet1's sheetId
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  deleteSheet: expect.objectContaining({
                    sheetId: 0,
                  }),
                }),
              ]),
            }),
          })
        );
      });

      it('should delete Sheet1 even if other month sheets exist', async () => {
        // Mock getSheetMetadata to return Sheet1 + existing month sheet
        mockSheetsApi.spreadsheets.get
          .mockResolvedValueOnce({
            // First call to getSheetMetadata in getOrCreateMonthSheet
            data: {
              sheets: [
                { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
                { properties: { title: '2025-01', sheetId: 100, index: 1 } },
              ],
            },
          })
          .mockResolvedValueOnce({
            // Second call after createSheet to get updated metadata with index
            data: {
              sheets: [
                { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
                { properties: { title: '2025-01', sheetId: 100, index: 1 } },
                { properties: { title: '2025-02', sheetId: 101, index: 2 } },
              ],
            },
          });

        // Mock createSheet, formatSheet, moveSheetToPosition, and deleteSheet
        mockSheetsApi.spreadsheets.batchUpdate
          .mockResolvedValueOnce({
            // Mock createSheet
            data: {
              replies: [{ addSheet: { properties: { sheetId: 101 } } }],
            },
          })
          .mockResolvedValueOnce({ data: {} }) // Mock formatSheet
          .mockResolvedValueOnce({ data: {} }) // Mock moveSheetToPosition
          .mockResolvedValueOnce({ data: {} }); // Mock deleteSheet

        mockSheetsApi.spreadsheets.values.update.mockResolvedValue({ data: {} });

        const resultPromise = getOrCreateMonthSheet(
          'spreadsheet123',
          '2025-02',
          ['fecha', 'descripcion', 'monto']
        );
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(101);
        }

        // Verify deleteSheet WAS called to remove Sheet1
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  deleteSheet: expect.objectContaining({
                    sheetId: 0,
                  }),
                }),
              ]),
            }),
          })
        );
      });

      it('should not delete Sheet1 if non-month sheets exist', async () => {
        // Mock getSheetMetadata to return Sheet1 + non-month sheet (e.g., "Summary")
        mockSheetsApi.spreadsheets.get
          .mockResolvedValueOnce({
            // First call to getSheetMetadata in getOrCreateMonthSheet
            data: {
              sheets: [
                { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
                { properties: { title: 'Summary', sheetId: 50, index: 1 } },
              ],
            },
          })
          .mockResolvedValueOnce({
            // Second call after createSheet to get updated metadata with index
            data: {
              sheets: [
                { properties: { title: 'Sheet1', sheetId: 0, index: 0 } },
                { properties: { title: 'Summary', sheetId: 50, index: 1 } },
                { properties: { title: '2025-01', sheetId: 101, index: 2 } },
              ],
            },
          });

        // Mock createSheet, formatSheet, and moveSheetToPosition (no deleteSheet)
        mockSheetsApi.spreadsheets.batchUpdate
          .mockResolvedValueOnce({
            // Mock createSheet
            data: {
              replies: [{ addSheet: { properties: { sheetId: 101 } } }],
            },
          })
          .mockResolvedValueOnce({ data: {} }) // Mock formatSheet
          .mockResolvedValueOnce({ data: {} }); // Mock moveSheetToPosition

        mockSheetsApi.spreadsheets.values.update.mockResolvedValue({ data: {} });

        const resultPromise = getOrCreateMonthSheet(
          'spreadsheet123',
          '2025-01',
          ['fecha', 'descripcion', 'monto']
        );
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(101);
        }

        // Verify deleteSheet was NOT called (only 3 batchUpdate calls: create, format, move)
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(3);
        expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  deleteSheet: expect.anything(),
                }),
              ]),
            }),
          })
        );
      });
    });
  });

  describe('Formula injection sanitization', () => {
    describe('appendRowsWithLinks', () => {
      beforeEach(() => {
        mockSheetsApi.spreadsheets.get.mockResolvedValue({
          data: {
            sheets: [
              { properties: { sheetId: 123, title: 'TestSheet' } },
            ],
          },
        });
        mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });
      });

      it('should insert CellFormula values as formulaValue (not sanitized)', async () => {
        const resultPromise = appendRowsWithLinks('spreadsheet123', 'TestSheet!A:C', [
          [
            'Normal text',
            { type: 'formula', value: '=F2+D3-C3' },  // CellFormula
            'Safe',
          ],
        ]);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  appendCells: expect.objectContaining({
                    rows: [
                      {
                        values: [
                          { userEnteredValue: { stringValue: 'Normal text' } },
                          { userEnteredValue: { formulaValue: '=F2+D3-C3' } },
                          { userEnteredValue: { stringValue: 'Safe' } },
                        ],
                      },
                    ],
                  }),
                }),
              ]),
            }),
          })
        );
      });

      it('should sanitize strings starting with = in cell values', async () => {
        const resultPromise = appendRowsWithLinks('spreadsheet123', 'TestSheet!A:C', [
          ['Normal', '=SUM(A1:A10)', 'Safe'],
        ]);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  appendCells: expect.objectContaining({
                    rows: [
                      {
                        values: [
                          { userEnteredValue: { stringValue: 'Normal' } },
                          { userEnteredValue: { stringValue: "'=SUM(A1:A10)" } },
                          { userEnteredValue: { stringValue: 'Safe' } },
                        ],
                      },
                    ],
                  }),
                }),
              ]),
            }),
          })
        );
      });

      it('should sanitize strings starting with +, -, @', async () => {
        const resultPromise = appendRowsWithLinks('spreadsheet123', 'TestSheet!A:D', [
          ['+123', '-456', '@username', 'normal'],
        ]);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  appendCells: expect.objectContaining({
                    rows: [
                      {
                        values: [
                          { userEnteredValue: { stringValue: "'+123" } },
                          { userEnteredValue: { stringValue: "'-456" } },
                          { userEnteredValue: { stringValue: "'@username" } },
                          { userEnteredValue: { stringValue: 'normal' } },
                        ],
                      },
                    ],
                  }),
                }),
              ]),
            }),
          })
        );
      });

      it('should not sanitize CellLink values', async () => {
        const resultPromise = appendRowsWithLinks('spreadsheet123', 'TestSheet!A:B', [
          [
            { text: '=DANGEROUS', url: 'https://example.com' },
            'normal',
          ],
        ]);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  appendCells: expect.objectContaining({
                    rows: [
                      {
                        values: [
                          {
                            userEnteredValue: { stringValue: '=DANGEROUS' },
                            textFormatRuns: [
                              {
                                format: {
                                  link: {
                                    uri: 'https://example.com',
                                  },
                                },
                              },
                            ],
                          },
                          { userEnteredValue: { stringValue: 'normal' } },
                        ],
                      },
                    ],
                  }),
                }),
              ]),
            }),
          })
        );
      });

      it('should not sanitize CellDate values', async () => {
        const resultPromise = appendRowsWithLinks('spreadsheet123', 'TestSheet!A:B', [
          [
            { type: 'date', value: '2025-01-27' },
            'normal',
          ],
        ]);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.ok).toBe(true);
        // CellDate is converted to number, not string, so no sanitization needed
        expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  appendCells: expect.objectContaining({
                    rows: [
                      {
                        values: [
                          {
                            userEnteredValue: expect.objectContaining({
                              numberValue: expect.any(Number),
                            }),
                            userEnteredFormat: expect.any(Object),
                          },
                          { userEnteredValue: { stringValue: 'normal' } },
                        ],
                      },
                    ],
                  }),
                }),
              ]),
            }),
          })
        );
      });
    });
  });
});
