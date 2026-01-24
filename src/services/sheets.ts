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
 * Cell date type - represents a date value to be formatted as a proper Date cell
 * Use this instead of raw date strings to get proper date formatting in spreadsheets
 */
export interface CellDate {
  type: 'date';
  /** Date string in ISO format: YYYY-MM-DD */
  value: string;
}

/**
 * Cell number type - represents a numeric value with formatting
 * Use this for monetary values to get proper number formatting (#,##0.00) in spreadsheets
 */
export interface CellNumber {
  type: 'number';
  /** Numeric value */
  value: number;
}

/**
 * Cell value or link type
 */
export type CellValueOrLink = CellValue | CellLink | CellDate | CellNumber;

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
 * Gets the timezone of a spreadsheet
 *
 * @param spreadsheetId - Spreadsheet ID
 * @returns Timezone string (e.g., 'America/Argentina/Buenos_Aires')
 */
export async function getSpreadsheetTimezone(
  spreadsheetId: string
): Promise<Result<string, Error>> {
  try {
    const sheets = getSheetsService();

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'properties.timeZone',
    });

    const timeZone = response.data.properties?.timeZone;
    if (!timeZone) {
      return {
        ok: false,
        error: new Error('Timezone not found in spreadsheet properties'),
      };
    }

    return { ok: true, value: timeZone };
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
 * Converts a Date object to Google Sheets serial number in a specific timezone
 *
 * Google Sheets serial numbers are interpreted in the spreadsheet's local timezone.
 * This function converts the UTC date to the specified timezone, then calculates
 * the serial number for that local date/time.
 *
 * @param date - Date object (in UTC)
 * @param timeZone - IANA timezone string (e.g., 'America/Argentina/Buenos_Aires')
 * @returns Serial number representing the local date/time in the specified timezone
 *
 * @example
 * // 2026-01-24 18:30:00 UTC = 2026-01-24 15:30:00 Argentina time
 * const utcDate = new Date('2026-01-24T18:30:00.000Z');
 * dateToSerialInTimezone(utcDate, 'America/Argentina/Buenos_Aires')
 * // Returns serial number for 2026-01-24 15:30:00 (local time)
 */
export function dateToSerialInTimezone(date: Date, timeZone: string): number {
  // Use Intl.DateTimeFormat to get the date/time components in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const dateParts: Record<string, string> = {};
  for (const part of parts) {
    dateParts[part.type] = part.value;
  }

  // Extract components
  const year = parseInt(dateParts.year);
  const month = parseInt(dateParts.month) - 1; // JavaScript months are 0-indexed
  const day = parseInt(dateParts.day);
  const hour = parseInt(dateParts.hour);
  const minute = parseInt(dateParts.minute);
  const second = parseInt(dateParts.second);

  // Create a date representing this local time (treating it as UTC for calculation purposes)
  // This gives us the "absolute" time that this local time represents
  const localDate = new Date(Date.UTC(year, month, day, hour, minute, second));

  // Calculate serial number from the epoch (Dec 30, 1899 at midnight)
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const serialNumber = (localDate.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24);

  return serialNumber;
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
 * Formats the Status sheet with its unique formatting requirements
 * - Only column A (metric labels) should be bold, not column B
 * - No frozen rows or columns
 * - Conditional formatting for ONLINE/OFFLINE is applied separately
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Sheet ID (not the name, the numeric ID)
 * @returns Success or error
 */
export async function formatStatusSheet(
  spreadsheetId: string,
  sheetId: number
): Promise<Result<void, Error>> {
  try {
    const sheets = getSheetsService();

    const requests: sheets_v4.Schema$Request[] = [];

    // 1. Bold only column A (all rows) - metric labels
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startColumnIndex: 0,  // Column A
          endColumnIndex: 1,    // Only column A
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

    // 2. Column B should be non-bold (values)
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startColumnIndex: 1,  // Column B
          endColumnIndex: 2,    // Only column B
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

    // 3. Ensure no frozen rows (set to 0)
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 0,
            frozenColumnCount: 0,
          },
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
      },
    });

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
 * Conditional format rule for text matching
 */
export interface ConditionalFormatRule {
  /** Sheet ID to apply the rule to */
  sheetId: number;
  /** Starting row index (0-based) */
  startRowIndex: number;
  /** Ending row index (exclusive, 0-based) */
  endRowIndex: number;
  /** Starting column index (0-based) */
  startColumnIndex: number;
  /** Ending column index (exclusive, 0-based) */
  endColumnIndex: number;
  /** Text to match for the condition */
  text: string;
  /** Text color as RGB object */
  textColor: { red: number; green: number; blue: number };
  /** Whether to make text bold */
  bold: boolean;
}

/**
 * Applies conditional formatting rules to a sheet
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param rules - Array of conditional format rules
 * @returns Success or error
 */
export async function applyConditionalFormat(
  spreadsheetId: string,
  rules: ConditionalFormatRule[]
): Promise<Result<void, Error>> {
  try {
    const sheets = getSheetsService();

    const requests: sheets_v4.Schema$Request[] = rules.map(rule => ({
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: rule.sheetId,
              startRowIndex: rule.startRowIndex,
              endRowIndex: rule.endRowIndex,
              startColumnIndex: rule.startColumnIndex,
              endColumnIndex: rule.endColumnIndex,
            },
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_EQ',
              values: [{ userEnteredValue: rule.text }],
            },
            format: {
              textFormat: {
                foregroundColor: rule.textColor,
                bold: rule.bold,
              },
            },
          },
        },
        index: 0,
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
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
 * Helper to check if a value is a CellDate
 */
function isCellDate(value: CellValueOrLink): value is CellDate {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'date'
  );
}

/**
 * Helper to check if a value is a CellNumber
 */
function isCellNumber(value: CellValueOrLink): value is CellNumber {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'number'
  );
}

/**
 * Checks if a string is an ISO 8601 timestamp
 * Matches formats like: 2026-01-24T18:30:00.000Z or 2026-01-24T18:30:00Z
 */
function isISOTimestamp(value: string): boolean {
  // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DDTHH:mm:ssZ
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
  return isoRegex.test(value);
}

/**
 * Converts a CellValueOrLink to a Sheets API cell data object
 *
 * @param value - Cell value to convert
 * @param timeZone - Optional IANA timezone for ISO timestamp conversion
 */
function convertToSheetsCellData(
  value: CellValueOrLink,
  timeZone?: string
): sheets_v4.Schema$CellData {
  if (value === null || value === undefined) {
    return {
      userEnteredValue: { stringValue: '' },
    };
  }

  if (isCellDate(value)) {
    // Convert date string to sheets serial number and apply date format
    const serial = dateStringToSerial(value.value);
    return {
      userEnteredValue: { numberValue: serial },
      userEnteredFormat: {
        numberFormat: {
          type: 'DATE',
          pattern: 'yyyy-mm-dd',
        },
      },
    };
  }

  if (isCellNumber(value)) {
    // Apply number format for monetary values
    return {
      userEnteredValue: { numberValue: value.value },
      userEnteredFormat: {
        numberFormat: {
          type: 'NUMBER',
          pattern: '#,##0.00',
        },
      },
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
    // Check if string is an ISO timestamp and convert to datetime cell
    if (isISOTimestamp(value)) {
      const date = new Date(value);
      const serialNumber = timeZone
        ? dateToSerialInTimezone(date, timeZone)
        : (date.getTime() - new Date(Date.UTC(1899, 11, 30)).getTime()) / (1000 * 60 * 60 * 24);

      return {
        userEnteredValue: { numberValue: serialNumber },
        userEnteredFormat: {
          numberFormat: {
            type: 'DATE_TIME',
            pattern: 'yyyy-mm-dd hh:mm:ss',
          },
        },
      };
    }

    // Regular string
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
 * ISO timestamp strings (e.g., "2026-01-24T18:30:00.000Z") are automatically
 * converted to datetime cells in the spreadsheet's timezone.
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation for target sheet (e.g., 'Sheet1!A:Z')
 * @param values - 2D array of rows to append. Cells can be values or {text, url} objects for links
 * @param timeZone - Optional IANA timezone string for ISO timestamp conversion
 * @returns Number of updated cells
 *
 * @example
 * await appendRowsWithLinks('abc123', 'Sheet1!A:C', [
 *   [
 *     'fileId123',
 *     { text: 'Document.pdf', url: 'https://drive.google.com/...' },
 *     'Path'
 *   ]
 * ], 'America/Argentina/Buenos_Aires');
 */
export async function appendRowsWithLinks(
  spreadsheetId: string,
  range: string,
  values: CellValueOrLink[][],
  timeZone?: string
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
      values: rowValues.map(value => convertToSheetsCellData(value, timeZone)),
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
 * @param timeZone - Optional IANA timezone string. When provided, Date objects are converted to this timezone.
 * @returns Number of updated cells
 */
export async function appendRowsWithFormatting(
  spreadsheetId: string,
  range: string,
  values: CellValue[][],
  timeZone?: string
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
          // If timezone is provided, convert to that timezone first
          const serialNumber = timeZone
            ? dateToSerialInTimezone(value, timeZone)
            : (value.getTime() - new Date(Date.UTC(1899, 11, 30)).getTime()) / (1000 * 60 * 60 * 24);
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
