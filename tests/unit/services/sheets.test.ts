/**
 * Tests for Google Sheets service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { google } from 'googleapis';
import { formatSheet, clearSheetsCache, appendRowsWithLinks, appendRowsWithFormatting, clearSheetData, moveSheetToFirst, dateStringToSerial } from '../../../src/services/sheets.js';

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

  it('should apply custom number formats from numberFormats map', async () => {
    const mockBatchUpdate = vi.fn().mockResolvedValue({});
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const numberFormats = new Map([
      [1, { type: 'number' as const, decimals: 0 }],  // Thousands separator, no decimals
      [5, { type: 'currency' as const, decimals: 2 }], // 2 decimals
      [8, { type: 'currency' as const, decimals: 8 }], // 8 decimals
    ]);

    const result = await formatSheet('spreadsheetId123', 456, {
      numberFormats,
    });

    expect(result.ok).toBe(true);
    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      requestBody: {
        requests: expect.arrayContaining([
          // Check that column 1 has #,##0 format
          expect.objectContaining({
            repeatCell: expect.objectContaining({
              range: expect.objectContaining({
                startColumnIndex: 1,
                endColumnIndex: 2,
              }),
              cell: expect.objectContaining({
                userEnteredFormat: expect.objectContaining({
                  numberFormat: expect.objectContaining({
                    pattern: '#,##0',
                  }),
                }),
              }),
            }),
          }),
          // Check that column 5 has #,##0.00 format
          expect.objectContaining({
            repeatCell: expect.objectContaining({
              range: expect.objectContaining({
                startColumnIndex: 5,
                endColumnIndex: 6,
              }),
              cell: expect.objectContaining({
                userEnteredFormat: expect.objectContaining({
                  numberFormat: expect.objectContaining({
                    pattern: '#,##0.00',
                  }),
                }),
              }),
            }),
          }),
          // Check that column 8 has #,##0.00000000 format
          expect.objectContaining({
            repeatCell: expect.objectContaining({
              range: expect.objectContaining({
                startColumnIndex: 8,
                endColumnIndex: 9,
              }),
              cell: expect.objectContaining({
                userEnteredFormat: expect.objectContaining({
                  numberFormat: expect.objectContaining({
                    pattern: '#,##0.00000000',
                  }),
                }),
              }),
            }),
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

describe('appendRowsWithFormatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSheetsCache();
  });

  it('should append rows with non-bold formatting', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Uso de API',
              sheetId: 789,
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
              updatedCells: 4,
            },
          },
        ],
      },
    });

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const rows = [
      ['value1', 'value2', 123, true],
    ];

    const result = await appendRowsWithFormatting('spreadsheetId123', 'Uso de API!A:D', rows);

    expect(result.ok).toBe(true);
    expect(result.value).toBe(4);

    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheetId123',
      requestBody: {
        requests: [
          {
            appendCells: {
              sheetId: 789,
              rows: [
                {
                  values: [
                    {
                      userEnteredFormat: { textFormat: { bold: false } },
                      userEnteredValue: { stringValue: 'value1' },
                    },
                    {
                      userEnteredFormat: { textFormat: { bold: false } },
                      userEnteredValue: { stringValue: 'value2' },
                    },
                    {
                      userEnteredFormat: { textFormat: { bold: false } },
                      userEnteredValue: { numberValue: 123 },
                    },
                    {
                      userEnteredFormat: { textFormat: { bold: false } },
                      userEnteredValue: { boolValue: true },
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

  it('should handle Date objects with proper datetime formatting', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Uso de API',
              sheetId: 789,
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
              updatedCells: 2,
            },
          },
        ],
      },
    });

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const testDate = new Date('2026-01-21T10:30:00.000Z');
    const rows = [
      [testDate, 'test'],
    ];

    const result = await appendRowsWithFormatting('spreadsheetId123', 'Uso de API!A:B', rows);

    expect(result.ok).toBe(true);
    expect(mockBatchUpdate).toHaveBeenCalled();

    const callArgs = mockBatchUpdate.mock.calls[0][0];
    const cellData = callArgs.requestBody.requests[0].appendCells.rows[0].values[0];

    // Verify Date is converted to serial number
    expect(cellData.userEnteredValue).toHaveProperty('numberValue');
    expect(typeof cellData.userEnteredValue.numberValue).toBe('number');

    // Verify datetime format is applied
    expect(cellData.userEnteredFormat?.numberFormat).toEqual({
      type: 'DATE_TIME',
      pattern: 'yyyy-mm-dd hh:mm:ss',
    });

    // Verify non-bold formatting
    expect(cellData.userEnteredFormat?.textFormat?.bold).toBe(false);
  });

  it('should handle null and undefined values', async () => {
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
              updatedCells: 2,
            },
          },
        ],
      },
    });

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;
    mockSheets.spreadsheets.batchUpdate = mockBatchUpdate;

    const rows = [
      [null, undefined],
    ];

    const result = await appendRowsWithFormatting('spreadsheetId123', 'Sheet1!A:B', rows);

    expect(result.ok).toBe(true);

    const callArgs = mockBatchUpdate.mock.calls[0][0];
    const rowData = callArgs.requestBody.requests[0].appendCells.rows[0].values;

    expect(rowData[0].userEnteredValue).toEqual({ stringValue: '' });
    expect(rowData[1].userEnteredValue).toEqual({ stringValue: '' });
  });

  it('should handle sheet not found error', async () => {
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

    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;

    const rows = [['value1']];

    const result = await appendRowsWithFormatting('spreadsheetId123', 'NonExistentSheet!A:A', rows);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Sheet not found');
    }
  });

  it('should handle API errors', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('API Error'));
    const mockSheets = google.sheets({} as any);
    mockSheets.spreadsheets.get = mockGet;

    const rows = [['value1']];

    const result = await appendRowsWithFormatting('spreadsheetId123', 'Sheet1!A:A', rows);

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

describe('dateStringToSerial', () => {
  it('converts date string to Google Sheets serial number', () => {
    // Jan 1, 1900 should be serial number 2 (day 0 is Dec 30, 1899, day 1 is Dec 31, 1899)
    expect(dateStringToSerial('1900-01-01')).toBe(2);

    // Jan 15, 2024
    const serial2024 = dateStringToSerial('2024-01-15');
    expect(serial2024).toBeGreaterThan(45000); // Rough sanity check

    // Known value: Jan 1, 2020 is serial number 43831
    expect(dateStringToSerial('2020-01-01')).toBe(43831);
  });

  it('handles leap years correctly', () => {
    const feb28_2024 = dateStringToSerial('2024-02-28');
    const feb29_2024 = dateStringToSerial('2024-02-29');
    const mar01_2024 = dateStringToSerial('2024-03-01');

    expect(feb29_2024).toBe(feb28_2024 + 1);
    expect(mar01_2024).toBe(feb29_2024 + 1);
  });

  it('handles dates in different years', () => {
    const jan01_2023 = dateStringToSerial('2023-01-01');
    const jan01_2024 = dateStringToSerial('2024-01-01');

    // 2023 has 365 days
    expect(jan01_2024).toBe(jan01_2023 + 365);
  });
});

describe('appendRowsWithLinks - CellDate handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSheetsCache();
  });

  it('should convert CellDate to serial number with date formatting', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Resumenes',
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

    const rows = [
      [
        { type: 'date' as const, value: '2024-01-15' },
        { type: 'date' as const, value: '2024-01-31' },
        'Other value',
      ],
    ];

    const result = await appendRowsWithLinks('spreadsheetId123', 'Resumenes!A:C', rows);

    expect(result.ok).toBe(true);
    expect(result.value).toBe(3);

    const callArgs = mockBatchUpdate.mock.calls[0][0];
    const rowData = callArgs.requestBody.requests[0].appendCells.rows[0].values;

    // Check first CellDate
    expect(rowData[0].userEnteredValue).toHaveProperty('numberValue');
    expect(typeof rowData[0].userEnteredValue.numberValue).toBe('number');
    expect(rowData[0].userEnteredFormat?.numberFormat).toEqual({
      type: 'DATE',
      pattern: 'yyyy-mm-dd',
    });

    // Check second CellDate
    expect(rowData[1].userEnteredValue).toHaveProperty('numberValue');
    expect(typeof rowData[1].userEnteredValue.numberValue).toBe('number');
    expect(rowData[1].userEnteredFormat?.numberFormat).toEqual({
      type: 'DATE',
      pattern: 'yyyy-mm-dd',
    });

    // Check non-date value
    expect(rowData[2].userEnteredValue).toEqual({ stringValue: 'Other value' });
  });

  it('should handle mixed CellDate, CellLink, and regular values', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: 'Resumenes',
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
              updatedCells: 4,
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
        { type: 'date' as const, value: '2024-01-15' },
        'fileId123',
        { text: 'Document.pdf', url: 'https://drive.google.com/file/d/fileId123/view' },
        1234.56,
      ],
    ];

    const result = await appendRowsWithLinks('spreadsheetId123', 'Resumenes!A:D', rows);

    expect(result.ok).toBe(true);

    const callArgs = mockBatchUpdate.mock.calls[0][0];
    const rowData = callArgs.requestBody.requests[0].appendCells.rows[0].values;

    // CellDate
    expect(rowData[0].userEnteredValue).toHaveProperty('numberValue');
    expect(rowData[0].userEnteredFormat?.numberFormat?.type).toBe('DATE');

    // String
    expect(rowData[1].userEnteredValue).toEqual({ stringValue: 'fileId123' });

    // CellLink
    expect(rowData[2].userEnteredValue).toEqual({ stringValue: 'Document.pdf' });
    expect(rowData[2].textFormatRuns).toBeDefined();

    // Number
    expect(rowData[3].userEnteredValue).toEqual({ numberValue: 1234.56 });
  });
});
