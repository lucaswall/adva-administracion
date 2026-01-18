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
export type CellValue = string | number | boolean | null | undefined;

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
 * Clears the cached Sheets service (for testing)
 */
export function clearSheetsCache(): void {
  sheetsService = null;
}
