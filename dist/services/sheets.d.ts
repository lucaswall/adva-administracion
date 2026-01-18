/**
 * Google Sheets API wrapper
 * Uses googleapis library for Sheets operations
 */
import type { Result } from '../types/index.js';
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
export declare function getValues(spreadsheetId: string, range: string): Promise<Result<CellValue[][], Error>>;
/**
 * Sets values in a range
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation range
 * @param values - 2D array of values to set
 * @returns Number of updated cells
 */
export declare function setValues(spreadsheetId: string, range: string, values: CellValue[][]): Promise<Result<number, Error>>;
/**
 * Appends rows to a sheet
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation for target sheet (e.g., 'Sheet1!A:Z')
 * @param values - 2D array of rows to append
 * @returns Number of updated cells
 */
export declare function appendRows(spreadsheetId: string, range: string, values: CellValue[][]): Promise<Result<number, Error>>;
/**
 * Batch updates multiple ranges
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param updates - Array of { range, values } objects
 * @returns Total updated cells
 */
export declare function batchUpdate(spreadsheetId: string, updates: Array<{
    range: string;
    values: CellValue[][];
}>): Promise<Result<number, Error>>;
/**
 * Gets sheet metadata (list of sheets in spreadsheet)
 *
 * @param spreadsheetId - Spreadsheet ID
 * @returns Array of sheet names and IDs
 */
export declare function getSheetMetadata(spreadsheetId: string): Promise<Result<Array<{
    title: string;
    sheetId: number;
}>, Error>>;
/**
 * Creates a new sheet in a spreadsheet
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param title - Sheet title
 * @returns New sheet ID
 */
export declare function createSheet(spreadsheetId: string, title: string): Promise<Result<number, Error>>;
/**
 * Clears the cached Sheets service (for testing)
 */
export declare function clearSheetsCache(): void;
