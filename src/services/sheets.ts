/**
 * Google Sheets API wrapper
 * Uses googleapis library for Sheets operations
 */

import { google, sheets_v4 } from 'googleapis';
import { getGoogleAuth, getDefaultScopes } from './google-auth.js';
import type { Result } from '../types/index.js';

/**
 * Sheets service instance
 */
let sheetsService: sheets_v4.Sheets | null = null;

/**
 * Gets or creates the Sheets service
 */
function getSheetsService(): sheets_v4.Sheets {
  if (sheetsService) {
    return sheetsService;
  }

  const auth = getGoogleAuth(getDefaultScopes());
  sheetsService = google.sheets({ version: 'v4', auth });

  return sheetsService;
}

/**
 * Cell value type
 */
export type CellValue = string | number | boolean | null | undefined | Date;

/**
 * Cell link type - represents a hyperlinked text value
 */
export interface CellLink {
  text: string;
  url: string;
}

/**
 * Cell value or link type
 */
export type CellValueOrLink = CellValue | CellLink;

/**
 * Gets values from a range
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation range (e.g., 'Sheet1!A1:D10')
 * @returns 2D array of cell values
 */
export async function getValues(
  spreadsheetId: string,
  range: string
): Promise<Result<CellValue[][], Error>> {
  try {
    const sheets = getSheetsService();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });

    const values = response.data.values || [];
    return { ok: true, value: values as CellValue[][] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Sets values in a range
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation range
 * @param values - 2D array of values to set
 * @returns Number of updated cells
 */
export async function setValues(
  spreadsheetId: string,
  range: string,
  values: CellValue[][]
): Promise<Result<number, Error>> {
  try {
    const sheets = getSheetsService();

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });

    return { ok: true, value: response.data.updatedCells || 0 };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Appends rows to a sheet
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation for target sheet (e.g., 'Sheet1!A:Z')
 * @param values - 2D array of rows to append
 * @returns Number of updated cells
 */
export async function appendRows(
  spreadsheetId: string,
  range: string,
  values: CellValue[][]
): Promise<Result<number, Error>> {
  try {
    const sheets = getSheetsService();

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });

    return { ok: true, value: response.data.updates?.updatedCells || 0 };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Batch updates multiple ranges
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param updates - Array of { range, values } objects
 * @returns Total updated cells
 */
export async function batchUpdate(
  spreadsheetId: string,
  updates: Array<{ range: string; values: CellValue[][] }>
): Promise<Result<number, Error>> {
  try {
    const sheets = getSheetsService();

    const response = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates.map(u => ({
          range: u.range,
          values: u.values,
        })),
      },
    });

    return { ok: true, value: response.data.totalUpdatedCells || 0 };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Gets sheet metadata (list of sheets in spreadsheet)
 *
 * @param spreadsheetId - Spreadsheet ID
 * @returns Array of sheet names and IDs
 */
export async function getSheetMetadata(
  spreadsheetId: string
): Promise<Result<Array<{ title: string; sheetId: number }>, Error>> {
  try {
    const sheets = getSheetsService();

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title,sheets.properties.sheetId',
    });

    const sheetsList = response.data.sheets || [];
    const result = sheetsList
      .filter(s => s.properties?.title && s.properties?.sheetId !== undefined)
      .map(s => ({
        title: s.properties!.title!,
        sheetId: s.properties!.sheetId!,
      }));

    return { ok: true, value: result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Creates a new sheet in a spreadsheet
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param title - Sheet title
 * @returns New sheet ID
 */
export async function createSheet(
  spreadsheetId: string,
  title: string
): Promise<Result<number, Error>> {
  try {
    const sheets = getSheetsService();

    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title,
              },
            },
          },
        ],
      },
    });

    const newSheet = response.data.replies?.[0]?.addSheet?.properties;
    if (!newSheet?.sheetId) {
      return { ok: false, error: new Error('Failed to create sheet') };
    }

    return { ok: true, value: newSheet.sheetId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Number format configuration for columns
 */
export type NumberFormat =
  | { type: 'currency'; decimals: 2 }  // e.g., $1,234.56
  | { type: 'currency'; decimals: 8 }  // e.g., 0.00000123 (for cost-per-token)
  | { type: 'number'; decimals: 0 }    // e.g., 1,234 (for counts)
  | { type: 'number'; decimals: 2 }    // e.g., 12.34 (for rates/percentages)
  | { type: 'date' };                  // e.g., yyyy-mm-dd

/**
 * Converts a NumberFormat to a Sheets number format pattern
 */
function getNumberFormatPattern(format: NumberFormat): string {
  if (format.type === 'date') {
    return 'yyyy-mm-dd';
  }
  if (format.decimals === 0) {
    return '#,##0';
  } else if (format.decimals === 2) {
    return '#,##0.00';
  } else if (format.decimals === 8) {
    return '#,##0.00000000';
  }
  // Default fallback
  return '#,##0.00';
}

/**
 * Converts a date string (yyyy-mm-dd) to Google Sheets serial number
 * Google Sheets uses December 30, 1899 as day 0 (epoch)
 *
 * @param dateStr - Date string in yyyy-mm-dd format
 * @returns Serial number for Google Sheets
 *
 * @example
 * dateStringToSerial('2024-01-15') // Returns serial number for Jan 15, 2024
 */
export function dateStringToSerial(dateStr: string): number {
  const date = new Date(dateStr + 'T00:00:00Z');
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return Math.floor((date.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Formats a sheet with bold headers, frozen rows, and number formatting
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Sheet ID (not the name, the numeric ID)
 * @param options - Formatting options
 * @param options.monetaryColumns - 0-indexed columns to format as currency with 2 decimals (backward compatibility)
 * @param options.numberFormats - Map of 0-indexed column number to NumberFormat
 * @param options.frozenRows - Number of rows to freeze at top (default: 1)
 * @returns Success or error
 */
export async function formatSheet(
  spreadsheetId: string,
  sheetId: number,
  options: {
    monetaryColumns?: number[];
    numberFormats?: Map<number, NumberFormat>;
    frozenRows?: number;
  } = {}
): Promise<Result<void, Error>> {
  try {
    const sheets = getSheetsService();
    const { monetaryColumns = [], numberFormats, frozenRows = 1 } = options;

    const requests: sheets_v4.Schema$Request[] = [];

    // 1. Freeze header rows
    if (frozenRows > 0) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              frozenRowCount: frozenRows,
            },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      });
    }

    // 2. Bold the header row (row 0) - explicitly specify column start
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,  // Start from first column
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
    });

    // 3. Explicitly set data rows to non-bold (rows 1+)
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,  // Start from row 1 (after header)
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
    });

    // 4. Apply number formatting from numberFormats map (takes precedence)
    if (numberFormats && numberFormats.size > 0) {
      for (const [columnIndex, format] of numberFormats) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
              startRowIndex: 1, // Skip header row
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: format.type === 'date' ? 'DATE' : 'NUMBER',
                  pattern: getNumberFormatPattern(format),
                },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }
    }
    // 5. Apply legacy monetaryColumns formatting (backward compatibility)
    else if (monetaryColumns.length > 0) {
      for (const columnIndex of monetaryColumns) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
              startRowIndex: 1, // Skip header row
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
        });
      }
    }

    // Execute all formatting requests in a single batch
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests,
      },
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Deletes a sheet from a spreadsheet
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Sheet ID (not the name, the numeric ID)
 * @returns Success or error
 */
export async function deleteSheet(
  spreadsheetId: string,
  sheetId: number
): Promise<Result<void, Error>> {
  try {
    const sheets = getSheetsService();

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteSheet: {
              sheetId,
            },
          },
        ],
      },
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Helper to check if a value is a CellLink
 */
function isCellLink(value: CellValueOrLink): value is CellLink {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    'url' in value
  );
}

/**
 * Converts a CellValueOrLink to a Sheets API cell data object
 */
function convertToSheetsCellData(
  value: CellValueOrLink
): sheets_v4.Schema$CellData {
  if (value === null || value === undefined) {
    return {
      userEnteredValue: { stringValue: '' },
    };
  }

  if (isCellLink(value)) {
    return {
      userEnteredValue: { stringValue: value.text },
      textFormatRuns: [
        {
          format: {
            link: {
              uri: value.url,
            },
          },
        },
      ],
    };
  }

  if (typeof value === 'string') {
    return {
      userEnteredValue: { stringValue: value },
    };
  }

  if (typeof value === 'number') {
    return {
      userEnteredValue: { numberValue: value },
    };
  }

  if (typeof value === 'boolean') {
    return {
      userEnteredValue: { boolValue: value },
    };
  }

  return {
    userEnteredValue: { stringValue: '' },
  };
}

/**
 * Appends rows to a sheet with support for formatted links
 *
 * Unlike appendRows which only supports simple values and formulas,
 * this function supports rich text formatting including hyperlinks
 * that appear as formatted text (not HYPERLINK formulas).
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation for target sheet (e.g., 'Sheet1!A:Z')
 * @param values - 2D array of rows to append. Cells can be values or {text, url} objects for links
 * @returns Number of updated cells
 *
 * @example
 * await appendRowsWithLinks('abc123', 'Sheet1!A:C', [
 *   [
 *     'fileId123',
 *     { text: 'Document.pdf', url: 'https://drive.google.com/...' },
 *     'Path'
 *   ]
 * ]);
 */
export async function appendRowsWithLinks(
  spreadsheetId: string,
  range: string,
  values: CellValueOrLink[][]
): Promise<Result<number, Error>> {
  try {
    const sheets = getSheetsService();

    // Parse sheet name from range (e.g., 'Sheet1!A:Z' -> 'Sheet1')
    const sheetName = range.split('!')[0];

    // Get sheet metadata to find the sheet ID
    const metadataResult = await getSheetMetadata(spreadsheetId);
    if (!metadataResult.ok) {
      return metadataResult;
    }

    const sheet = metadataResult.value.find(s => s.title === sheetName);
    if (!sheet) {
      return {
        ok: false,
        error: new Error(`Sheet not found: ${sheetName}`),
      };
    }

    // Convert rows to Sheets API format
    const rows: sheets_v4.Schema$RowData[] = values.map(rowValues => ({
      values: rowValues.map(convertToSheetsCellData),
    }));

    // Use batchUpdate with appendCells to support rich formatting
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            appendCells: {
              sheetId: sheet.sheetId,
              rows,
              fields: '*',
            },
          },
        ],
      },
    });

    // Calculate total cells appended (rows * columns)
    const cellsAppended = rows.reduce((total, row) => {
      return total + (row.values?.length || 0);
    }, 0);

    return { ok: true, value: cellsAppended };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Sorts a sheet by a specific column
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetName - Sheet name
 * @param columnIndex - 0-based column index to sort by
 * @param descending - Sort order (true = descending/newest first, false = ascending)
 * @returns Success result
 */
export async function sortSheet(
  spreadsheetId: string,
  sheetName: string,
  columnIndex: number = 0,
  descending: boolean = true
): Promise<Result<void, Error>> {
  try {
    const sheets = getSheetsService();

    // First, get the sheet ID from the sheet name
    const metadataResult = await getSheetMetadata(spreadsheetId);
    if (!metadataResult.ok) {
      return metadataResult;
    }

    const sheet = metadataResult.value.find(s => s.title === sheetName);
    if (!sheet) {
      return {
        ok: false,
        error: new Error(`Sheet "${sheetName}" not found`),
      };
    }

    // Sort the sheet (excluding header row)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            sortRange: {
              range: {
                sheetId: sheet.sheetId,
                startRowIndex: 1, // Skip header row
                startColumnIndex: 0,
              },
              sortSpecs: [
                {
                  dimensionIndex: columnIndex,
                  sortOrder: descending ? 'DESCENDING' : 'ASCENDING',
                },
              ],
            },
          },
        ],
      },
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Clears data from a sheet while preserving the header row
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetName - Sheet name
 * @returns Success or error
 */
export async function clearSheetData(
  spreadsheetId: string,
  sheetName: string
): Promise<Result<void, Error>> {
  try {
    const sheets = getSheetsService();

    // Clear all data starting from row 2 (preserves header row)
    const range = `${sheetName}!A2:Z`;

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Moves a sheet to the first position (leftmost tab)
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetName - Sheet name to move
 * @returns Success or error
 */
export async function moveSheetToFirst(
  spreadsheetId: string,
  sheetName: string
): Promise<Result<void, Error>> {
  try {
    const sheets = getSheetsService();

    // Get sheet metadata to find the sheet ID
    const metadataResult = await getSheetMetadata(spreadsheetId);
    if (!metadataResult.ok) {
      return metadataResult;
    }

    const sheet = metadataResult.value.find(s => s.title === sheetName);
    if (!sheet) {
      return {
        ok: false,
        error: new Error(`Sheet "${sheetName}" not found`),
      };
    }

    // Update sheet properties to move it to index 0
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheet.sheetId,
                index: 0,
              },
              fields: 'index',
            },
          },
        ],
      },
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Appends rows with explicit formatting (non-bold text)
 * Use this when appending to sheets with bold headers to prevent new rows from inheriting bold formatting
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation for target sheet (e.g., 'Sheet1!A:Z')
 * @param values - 2D array of rows to append. Date objects are supported.
 * @returns Number of updated cells
 */
export async function appendRowsWithFormatting(
  spreadsheetId: string,
  range: string,
  values: CellValue[][]
): Promise<Result<number, Error>> {
  try {
    const sheets = getSheetsService();

    // Parse sheet name from range (e.g., 'Sheet1!A:Z' -> 'Sheet1')
    const sheetName = range.split('!')[0];

    // Get sheet metadata to find the sheet ID
    const metadataResult = await getSheetMetadata(spreadsheetId);
    if (!metadataResult.ok) {
      return metadataResult;
    }

    const sheet = metadataResult.value.find(s => s.title === sheetName);
    if (!sheet) {
      return {
        ok: false,
        error: new Error(`Sheet not found: ${sheetName}`),
      };
    }

    // Convert rows to Sheets API format with explicit non-bold formatting
    const rows: sheets_v4.Schema$RowData[] = values.map(rowValues => ({
      values: rowValues.map(value => {
        const cellData: sheets_v4.Schema$CellData = {
          userEnteredFormat: {
            textFormat: {
              bold: false,
            },
          },
        };

        if (value === null || value === undefined) {
          cellData.userEnteredValue = { stringValue: '' };
        } else if (value instanceof Date) {
          // Convert Date to serial number for Sheets
          // Google Sheets uses Dec 30, 1899 as day 0
          const baseDate = new Date(Date.UTC(1899, 11, 30));
          const serialNumber = (value.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24);
          cellData.userEnteredValue = { numberValue: serialNumber };
          cellData.userEnteredFormat!.numberFormat = {
            type: 'DATE_TIME',
            pattern: 'yyyy-mm-dd hh:mm:ss',
          };
        } else if (typeof value === 'string') {
          // If string starts with =, it's a formula - use formulaValue instead of stringValue
          if (value.startsWith('=')) {
            cellData.userEnteredValue = { formulaValue: value };
          } else {
            cellData.userEnteredValue = { stringValue: value };
          }
        } else if (typeof value === 'number') {
          cellData.userEnteredValue = { numberValue: value };
        } else if (typeof value === 'boolean') {
          cellData.userEnteredValue = { boolValue: value };
        }

        return cellData;
      }),
    }));

    // Use batchUpdate with appendCells to support formatting
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            appendCells: {
              sheetId: sheet.sheetId,
              rows,
              fields: '*',
            },
          },
        ],
      },
    });

    // Calculate total cells appended
    const cellsAppended = rows.reduce((total, row) => {
      return total + (row.values?.length || 0);
    }, 0);

    return { ok: true, value: cellsAppended };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Clears the cached Sheets service (for testing)
 */
export function clearSheetsCache(): void {
  sheetsService = null;
}
