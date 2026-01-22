/**
 * Tests for Google Sheets service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { google } from 'googleapis';
import { formatSheet, clearSheetsCache, appendRowsWithLinks, clearSheetData, moveSheetToFirst } from '../../../src/services/sheets.js';

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
        clear: vi.fn(),
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

  it('should explicitly set data rows to non-bold', async () => {
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
          // Bold headers request for row 0
          expect.objectContaining({
            repeatCell: {
              range: {
                sheetId: 456,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
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
          // Non-bold data rows request for rows 1+
          expect.objectContaining({
            repeatCell: {
              range: {
                sheetId: 456,
                startRowIndex: 1,
                startColumnIndex: 0,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    bold: false,
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

describe('appendRowsWithLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSheetsCache();
  });

  it('should append rows with formatted links', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Sheet1',
              sheetId: 123,
            },
          },
        ],
      },
    });

    const mockBatchUpdate = vi.fn().mockResolvedValue({
      data: {
        replies: [
          {
            appendCells: {
              updatedCells: 6,
            },
          },
        ],
      },
    });

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const rows = [
      [
        'fileId123',
        { text: 'Document Name.pdf', url: 'https://drive.google.com/file/d/fileId123/view' },
        'Folder/Path',
      ],
      [
        'fileId456',
        { text: 'Another Doc.pdf', url: 'https://drive.google.com/file/d/fileId456/view' },
        'Other/Path',
      ],
    ];

    const result = await appendRowsWithLinks('spreadsheetId123', 'Sheet1!A:C', rows);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(6);
    }

    expect(mockGet).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      fields: 'sheets.properties.title,sheets.properties.sheetId',
    });

    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      requestBody: {
        requests: [
          {
            appendCells: {
              sheetId: 123,
              rows: [
                {
                  values: [
                    {
                      userEnteredValue: { stringValue: 'fileId123' },
                    },
                    {
                      userEnteredValue: { stringValue: 'Document Name.pdf' },
                      textFormatRuns: [
                        {
                          format: {
                            link: {
                              uri: 'https://drive.google.com/file/d/fileId123/view',
                            },
                          },
                        },
                      ],
                    },
                    {
                      userEnteredValue: { stringValue: 'Folder/Path' },
                    },
                  ],
                },
                {
                  values: [
                    {
                      userEnteredValue: { stringValue: 'fileId456' },
                    },
                    {
                      userEnteredValue: { stringValue: 'Another Doc.pdf' },
                      textFormatRuns: [
                        {
                          format: {
                            link: {
                              uri: 'https://drive.google.com/file/d/fileId456/view',
                            },
                          },
                        },
                      ],
                    },
                    {
                      userEnteredValue: { stringValue: 'Other/Path' },
                    },
                  ],
                },
              ],
              fields: '*',
            },
          },
        ],
      },
    });
  });

  it('should handle rows with no links', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Sheet1',
              sheetId: 123,
            },
          },
        ],
      },
    });

    const mockBatchUpdate = vi.fn().mockResolvedValue({
      data: {
        replies: [
          {
            appendCells: {
              updatedCells: 3,
            },
          },
        ],
      },
    });

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const rows = [['value1', 'value2', 'value3']];

    const result = await appendRowsWithLinks('spreadsheetId123', 'Sheet1!A:C', rows);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(3);
    }
  });

  it('should handle numeric and boolean values', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Sheet1',
              sheetId: 123,
            },
          },
        ],
      },
    });

    const mockBatchUpdate = vi.fn().mockResolvedValue({
      data: {
        replies: [
          {
            appendCells: {
              updatedCells: 3,
            },
          },
        ],
      },
    });

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const rows = [[123, true, 'text']];

    const result = await appendRowsWithLinks('spreadsheetId123', 'Sheet1!A:C', rows);

    expect(result.ok).toBe(true);
    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      requestBody: {
        requests: [
          {
            appendCells: {
              sheetId: 123,
              rows: [
                {
                  values: [
                    {
                      userEnteredValue: { numberValue: 123 },
                    },
                    {
                      userEnteredValue: { boolValue: true },
                    },
                    {
                      userEnteredValue: { stringValue: 'text' },
                    },
                  ],
                },
              ],
              fields: '*',
            },
          },
        ],
      },
    });
  });

  it('should handle errors when sheet is not found', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'OtherSheet',
              sheetId: 999,
            },
          },
        ],
      },
    });

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;

    const rows = [['value1', 'value2']];

    const result = await appendRowsWithLinks('spreadsheetId123', 'Sheet1!A:B', rows);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Sheet not found');
    }
  });

  it('should handle API errors', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('API Error'));
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;

    const rows = [['value1', 'value2']];

    const result = await appendRowsWithLinks('spreadsheetId123', 'Sheet1!A:B', rows);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API Error');
    }
  });
});

describe('clearSheetData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSheetsCache();
  });

  it('should clear data from a sheet while preserving header row', async () => {
    const mockClear = vi.fn().mockResolvedValue({});
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.values.clear = mockClear;

    const result = await clearSheetData('spreadsheetId123', 'Pagos Pendientes');

    expect(result.ok).toBe(true);
    expect(mockClear).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      range: 'Pagos Pendientes!A2:Z',
    });
  });

  it('should handle errors from the Sheets API', async () => {
    const mockClear = vi.fn().mockRejectedValue(new Error('Sheets API error'));
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.values.clear = mockClear;

    const result = await clearSheetData('spreadsheetId123', 'Pagos Pendientes');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Sheets API error');
    }
  });
});

describe('moveSheetToFirst', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSheetsCache();
  });

  it('should move a sheet to the first position', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Resumen Mensual',
              sheetId: 0,
            },
          },
          {
            properties: {
              title: 'Pagos Pendientes',
              sheetId: 123,
            },
          },
        ],
      },
    });

    const mockBatchUpdate = vi.fn().mockResolvedValue({});
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const result = await moveSheetToFirst('spreadsheetId123', 'Pagos Pendientes');

    expect(result.ok).toBe(true);
    expect(mockGet).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      fields: 'sheets.properties.title,sheets.properties.sheetId',
    });
    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: 123,
                index: 0,
              },
              fields: 'index',
            },
          },
        ],
      },
    });
  });

  it('should handle errors when sheet is not found', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Other Sheet',
              sheetId: 456,
            },
          },
        ],
      },
    });

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;

    const result = await moveSheetToFirst('spreadsheetId123', 'Pagos Pendientes');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Sheet "Pagos Pendientes" not found');
    }
  });

  it('should handle errors from the Sheets API', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('API Error'));
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;

    const result = await moveSheetToFirst('spreadsheetId123', 'Pagos Pendientes');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API Error');
    }
  });
});
