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
        expect(result.value).toEqual([{ title: 'Sheet1', sheetId: 0 }]);
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
  });

  describe('formatEmptyMonthSheet', () => {
    it('should succeed on first attempt', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const resultPromise = formatEmptyMonthSheet('spreadsheet123', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after quota error', async () => {
      mockSheetsApi.spreadsheets.batchUpdate
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: {} });

      const resultPromise = formatEmptyMonthSheet('spreadsheet123', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Quota exceeded'));

      const resultPromise = formatEmptyMonthSheet('spreadsheet123', 0);
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
  });
});
