/**
 * Google Sheets API wrapper
 * Uses googleapis library for Sheets operations
 */
import { google } from 'googleapis';
import { getGoogleAuth, getDefaultScopes } from './google-auth.js';
/**
 * Sheets service instance
 */
let sheetsService = null;
/**
 * Gets or creates the Sheets service
 */
function getSheetsService() {
    if (sheetsService) {
        return sheetsService;
    }
    const auth = getGoogleAuth(getDefaultScopes());
    sheetsService = google.sheets({ version: 'v4', auth });
    return sheetsService;
}
/**
 * Gets values from a range
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation range (e.g., 'Sheet1!A1:D10')
 * @returns 2D array of cell values
 */
export async function getValues(spreadsheetId, range) {
    try {
        const sheets = getSheetsService();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'SERIAL_NUMBER',
        });
        const values = response.data.values || [];
        return { ok: true, value: values };
    }
    catch (error) {
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
export async function setValues(spreadsheetId, range, values) {
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
    }
    catch (error) {
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
export async function appendRows(spreadsheetId, range, values) {
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
    }
    catch (error) {
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
export async function batchUpdate(spreadsheetId, updates) {
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
    }
    catch (error) {
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
export async function getSheetMetadata(spreadsheetId) {
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
            title: s.properties.title,
            sheetId: s.properties.sheetId,
        }));
        return { ok: true, value: result };
    }
    catch (error) {
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
export async function createSheet(spreadsheetId, title) {
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
    }
    catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
/**
 * Formats a sheet with bold headers, frozen rows, and number formatting
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Sheet ID (not the name, the numeric ID)
 * @param options - Formatting options
 * @param options.monetaryColumns - 0-indexed columns to format as currency (e.g., [12, 13, 14])
 * @param options.frozenRows - Number of rows to freeze at top (default: 1)
 * @returns Success or error
 */
export async function formatSheet(spreadsheetId, sheetId, options = {}) {
    try {
        const sheets = getSheetsService();
        const { monetaryColumns = [], frozenRows = 1 } = options;
        const requests = [];
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
                    startColumnIndex: 0, // Start from first column
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
        // 3. Apply number formatting to monetary columns
        if (monetaryColumns.length > 0) {
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
    }
    catch (error) {
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
export async function deleteSheet(spreadsheetId, sheetId) {
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
    }
    catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
/**
 * Clears the cached Sheets service (for testing)
 */
export function clearSheetsCache() {
    sheetsService = null;
}
