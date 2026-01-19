/**
 * Tests for Google Sheets service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { google } from 'googleapis';
import { formatSheet, clearSheetsCache } from '../../../src/services/sheets.js';

// Mock googleapis
vi.mock('googleapis', () => {
  const mockBatchUpdate = vi.fn();
  const mockSheets = {
    spreadsheets: {
      values: {
        get: vi.fn(),
        update: vi.fn(),
        append: vi.fn(),
        batchUpdate: vi.fn(),
      },
      get: vi.fn(),
      batchUpdate: mockBatchUpdate,
    },
  };

  return {
    google: {
      sheets: vi.fn(() => mockSheets),
    },
  };
});

// Mock google-auth
vi.mock('../../../src/services/google-auth.js', () => ({
  getGoogleAuth: vi.fn(() => ({})),
  getDefaultScopes: vi.fn(() => []),
}));

describe('formatSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSheetsCache();
  });

  it('should format a sheet with bold headers and frozen rows', async () => {
    const mockBatchUpdate = vi.fn().mockResolvedValue({});
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const result = await formatSheet('spreadsheetId123', 456, {
      frozenRows: 1,
      monetaryColumns: [],
    });

    expect(result.ok).toBe(true);
    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      requestBody: {
        requests: expect.arrayContaining([
          // Frozen rows request
          expect.objectContaining({
            updateSheetProperties: {
              properties: {
                sheetId: 456,
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
              fields: 'gridProperties.frozenRowCount',
            },
          }),
          // Bold headers request - should only apply to row 0, all columns
          expect.objectContaining({
            repeatCell: {
              range: {
                sheetId: 456,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,  // Explicitly start from first column
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    bold: true,
                  },
                },
              },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          }),
        ]),
      },
    });
  });

  it('should apply number formatting to monetary columns', async () => {
    const mockBatchUpdate = vi.fn().mockResolvedValue({});
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const result = await formatSheet('spreadsheetId123', 456, {
      monetaryColumns: [12, 13, 14],
    });

    expect(result.ok).toBe(true);
    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      requestBody: {
        requests: expect.arrayContaining([
          // Number formatting for column 12
          expect.objectContaining({
            repeatCell: {
              range: {
                sheetId: 456,
                startColumnIndex: 12,
                endColumnIndex: 13,
                startRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: 'NUMBER',
                    pattern: '#,##0.00',
                  },
                },
              },
              fields: 'userEnteredFormat.numberFormat',
            },
          }),
          // Number formatting for column 13
          expect.objectContaining({
            repeatCell: {
              range: {
                sheetId: 456,
                startColumnIndex: 13,
                endColumnIndex: 14,
                startRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: 'NUMBER',
                    pattern: '#,##0.00',
                  },
                },
              },
              fields: 'userEnteredFormat.numberFormat',
            },
          }),
          // Number formatting for column 14
          expect.objectContaining({
            repeatCell: {
              range: {
                sheetId: 456,
                startColumnIndex: 14,
                endColumnIndex: 15,
                startRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: 'NUMBER',
                    pattern: '#,##0.00',
                  },
                },
              },
              fields: 'userEnteredFormat.numberFormat',
            },
          }),
        ]),
      },
    });
  });

  it('should handle errors from the Sheets API', async () => {
    const mockBatchUpdate = vi
      .fn()
      .mockRejectedValue(new Error('Sheets API error'));
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const result = await formatSheet('spreadsheetId123', 456, {
      monetaryColumns: [12],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Sheets API error');
    }
  });
});
