/**
 * Google Sheets API wrapper
 * Uses googleapis library for Sheets operations
 */

import { google, sheets_v4 } from 'googleapis';
import { getGoogleAuthAsync, getDefaultScopes } from './google-auth.js';
import type { Result, SubdiarioRow, SubdiarioDiff } from '../types/index.js';
import { withQuotaRetry, withLock, withLockResult } from '../utils/concurrency.js';
import { sanitizeForSpreadsheet } from '../utils/spreadsheet.js';
import { debug, warn } from '../utils/logger.js';
import { GOOGLE_API_TIMEOUT_MS } from '../config.js';

/**
 * Slow-call threshold: warn if a Sheets API call exceeds this duration.
 */
const SLOW_CALL_THRESHOLD_MS = 5_000;

/**
 * Wraps an async operation with debug-level duration logging.
 * Emits a WARN if the operation exceeds SLOW_CALL_THRESHOLD_MS.
 */
async function withTiming<T>(apiName: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    debug(apiName, { module: 'sheets', phase: 'api-call', durationMs });
    if (durationMs > SLOW_CALL_THRESHOLD_MS) {
      warn(apiName, { module: 'sheets', phase: 'api-call', slow: true, durationMs });
    }
    return result;
  } catch (e) {
    const durationMs = Date.now() - start;
    debug(apiName, { module: 'sheets', phase: 'api-call', durationMs, failed: true });
    if (durationMs > SLOW_CALL_THRESHOLD_MS) {
      warn(apiName, { module: 'sheets', phase: 'api-call', slow: true, durationMs });
    }
    throw e;
  }
}

/**
 * Converts a column index (1-based) to column letter(s)
 * Supports columns beyond Z (AA, AB, ..., ZZ, AAA, etc.)
 *
 * @param index - Column index (1-based: 1 = A, 26 = Z, 27 = AA)
 * @returns Column letter(s) in A1 notation
 */
export function columnIndexToLetter(index: number): string {
  if (index < 1) {
    throw new Error(`Column index must be >= 1, got ${index}`);
  }

  let result = '';
  let remaining = index;

  while (remaining > 0) {
    // Subtract 1 to convert to 0-based for modulo
    const digit = (remaining - 1) % 26;
    result = String.fromCharCode(65 + digit) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }

  return result;
}

/**
 * Sheets service instance
 */
let sheetsService: sheets_v4.Sheets | null = null;

/**
 * Cache TTL: 24 hours in milliseconds
 */
const TIMEZONE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum number of entries in the timezone cache
 * Prevents unbounded memory growth in long-running processes
 */
const MAX_TIMEZONE_CACHE_SIZE = 100;

/**
 * In-memory cache entry for timezone
 */
interface TimezoneCacheEntry {
  timezone: string;
  timestamp: number;
}

/**
 * Module-level cache for spreadsheet timezones
 */
const timezoneCache = new Map<string, TimezoneCacheEntry>();

/**
 * Gets cached timezone if valid (not expired)
 * Updates timestamp on access for LRU eviction behavior
 */
function getCachedTimezone(spreadsheetId: string): string | null {
  const entry = timezoneCache.get(spreadsheetId);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > TIMEZONE_CACHE_TTL_MS) {
    timezoneCache.delete(spreadsheetId);
    return null;
  }

  // Update timestamp for LRU eviction - recently accessed entries stay in cache
  entry.timestamp = now;
  return entry.timezone;
}

/**
 * Evicts the oldest cache entry when cache is at capacity
 */
function evictOldestCacheEntry(): void {
  let oldestKey: string | null = null;
  let oldestTimestamp = Infinity;

  for (const [key, entry] of timezoneCache.entries()) {
    if (entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
      oldestKey = key;
    }
  }

  if (oldestKey !== null) {
    timezoneCache.delete(oldestKey);
  }
}

/**
 * Sets cached timezone with current timestamp
 * Evicts oldest entries if cache exceeds MAX_TIMEZONE_CACHE_SIZE
 */
function setCachedTimezone(spreadsheetId: string, timezone: string): void {
  // If this is a new entry and we're at capacity, evict the oldest
  if (!timezoneCache.has(spreadsheetId) && timezoneCache.size >= MAX_TIMEZONE_CACHE_SIZE) {
    evictOldestCacheEntry();
  }

  timezoneCache.set(spreadsheetId, {
    timezone,
    timestamp: Date.now(),
  });
}

/**
 * Clears the timezone cache (for testing)
 */
export function clearTimezoneCache(): void {
  timezoneCache.clear();
}

/**
 * Gets or creates the Sheets service
 */
async function getSheetsService(): Promise<sheets_v4.Sheets> {
  if (sheetsService) {
    return sheetsService;
  }

  const auth = await getGoogleAuthAsync(getDefaultScopes());
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
 * Cell formula type - represents an explicit formula value
 * Use this to insert formulas that bypass the security sanitization
 * Only use for trusted, internally-generated formulas (never user input)
 */
export interface CellFormula {
  type: 'formula';
  /** Formula string (must start with =) */
  value: string;
}

/**
 * Cell value or link type
 */
export type CellValueOrLink = CellValue | CellLink | CellDate | CellNumber | CellFormula;

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
  return withTiming('getValues', () => withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    }, { timeout: GOOGLE_API_TIMEOUT_MS });
    return response.data.values || [];
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value as CellValue[][] };
  }));
}

/**
 * Reads `textFormatRuns` link URIs from a sheet range.
 *
 * `spreadsheets.values.get` only returns displayed text — it cannot round-trip
 * `textFormatRuns` link metadata. This helper uses `spreadsheets.get` with a
 * field mask to fetch ONLY the link URI of the first `textFormatRuns` entry on
 * each cell, returning a 2D array of strings (empty when the cell has no link).
 *
 * Used by `readSubdiarioRows` to recover the col D `facturaFileId` (parsed
 * from the Drive viewer URL) so existing rows pick up the col D link on the
 * first sync after a deploy, even when no other displayed-text field changed.
 *
 * Shape: the returned 2D array mirrors the requested range's rows × columns.
 * Rows the API omits entirely come back as `[]`; missing cells inside a row
 * come back as `''`. Cells whose `textFormatRuns[0]` has no link contribute
 * `''` as well.
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation range (e.g., 'Comprobantes!A2:N')
 * @returns 2D array of link URIs (empty string when no link on the cell)
 */
export async function getCellLinkUris(
  spreadsheetId: string,
  range: string
): Promise<Result<string[][], Error>> {
  return withTiming('getCellLinkUris', () => withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [range],
      fields: 'sheets.data.rowData.values.textFormatRuns.format.link.uri',
    });
    const rowData = response.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    return rowData.map((row) =>
      (row.values ?? []).map((cell) => {
        const runs = cell.textFormatRuns ?? [];
        return runs[0]?.format?.link?.uri ?? '';
      })
    );
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  }));
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
  return withTiming('setValues', () => withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });
    return response.data.updatedCells || 0;
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  }));
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
  return withTiming('appendRows', () => withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });
    return response.data.updates?.updatedCells || 0;
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  }));
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
  return withTiming('batchUpdate', () => withQuotaRetry(async () => {
    const sheets = await getSheetsService();
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
    return response.data.totalUpdatedCells || 0;
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  }));
}

/**
 * Internal: Gets sheet metadata without retry wrapper.
 * Used when caller has own retry logic.
 *
 * @param spreadsheetId - Spreadsheet ID
 * @returns Array of sheet names and IDs
 */
export async function getSheetMetadataInternal(
  spreadsheetId: string
): Promise<Result<Array<{ title: string; sheetId: number; index: number }>, Error>> {
  try {
    const sheets = await getSheetsService();
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheetMetadata = (response.data.sheets || []).map((sheet) => ({
      title: sheet.properties?.title || '',
      sheetId: sheet.properties?.sheetId ?? 0,
      index: sheet.properties?.index ?? 0,
    }));

    return { ok: true, value: sheetMetadata };
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
): Promise<Result<Array<{ title: string; sheetId: number; index: number }>, Error>> {
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title,sheets.properties.sheetId,sheets.properties.index',
    });
    const sheetsList = response.data.sheets || [];
    return sheetsList
      .filter(s => s.properties?.title && s.properties?.sheetId !== undefined)
      .map(s => ({
        title: s.properties!.title!,
        sheetId: s.properties!.sheetId!,
        index: s.properties!.index ?? 0, // Default to 0 if not present (for test compatibility)
      }));
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  });
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
  // Check cache first
  const cachedTimezone = getCachedTimezone(spreadsheetId);
  if (cachedTimezone) {
    return { ok: true, value: cachedTimezone };
  }

  // Fetch from API (already wrapped with withQuotaRetry)
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'properties.timeZone',
    });
    const timeZone = response.data.properties?.timeZone;
    if (!timeZone) {
      throw new Error('Timezone not found in spreadsheet properties');
    }
    // Cache the result
    setCachedTimezone(spreadsheetId, timeZone);
    return timeZone;
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  });
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
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
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
      throw new Error('Failed to create sheet');
    }
    return newSheet.sheetId;
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  });
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
 * @param options.numberFormats - Map of 0-indexed column number to NumberFormat
 * @param options.frozenRows - Number of rows to freeze at top (default: 1)
 * @returns Success or error
 */
export async function formatSheet(
  spreadsheetId: string,
  sheetId: number,
  options: {
    numberFormats?: Map<number, NumberFormat>;
    frozenRows?: number;
  } = {}
): Promise<Result<void, Error>> {
  const { numberFormats, frozenRows = 1 } = options;

  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
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

    // 4. Apply number formatting from numberFormats map
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

    // Execute all formatting requests in a single batch
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests,
      },
    });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
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
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
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
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
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
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();

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
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
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
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
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
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

/**
 * Inserts an empty column at the specified index, shifting existing columns right.
 * Uses the Sheets API insertDimension request.
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Numeric sheet ID (from getSheetMetadata)
 * @param columnIndex - 0-based column index where the new column will be inserted
 * @returns Success or error
 */
export async function insertColumn(
  spreadsheetId: string,
  sheetId: number,
  columnIndex: number
): Promise<Result<void, Error>> {
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: columnIndex,
                endIndex: columnIndex + 1,
              },
              inheritFromBefore: false,
            },
          },
        ],
      },
    });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
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
 * Helper to check if a value is a CellFormula
 */
function isCellFormula(value: CellValueOrLink): value is CellFormula {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'formula'
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

  if (isCellFormula(value)) {
    // Insert as formula (bypasses sanitization for trusted internal formulas)
    return {
      userEnteredValue: { formulaValue: value.value },
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

    // Regular string - sanitize to prevent formula injection
    const sanitizedValue = sanitizeForSpreadsheet(value);
    return {
      userEnteredValue: { stringValue: sanitizedValue },
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
 * Lock wait/expiry tuning for per-sheet append serialization (ADV-242).
 *
 * - Wait timeout = 60 s: a queued caller will give up after this window if the
 *   holder never releases.
 * - Auto-expiry = 900 s (15 min): covers worst-case `withQuotaRetry` chains
 *   under heavy throttling. `SHEETS_QUOTA_RETRY_CONFIG` allows 5 retries with
 *   per-attempt delays up to 65 s plus up to 60 s `waitForClearance` —
 *   ~12 min worst case. The expiry is intentionally generous because the
 *   `appendCells` API is NOT idempotent w.r.t. server-side "end-of-data"
 *   detection: if the lock expires while a slow retry is still in flight, a
 *   second waiter entering could reproduce the original ADV-242 race
 *   (silent overwrite when two requests target the same computed row index).
 *   The expiry exists only to recover from a crashed holder, not to bound
 *   normal slow paths.
 */
const APPEND_LOCK_WAIT_TIMEOUT_MS = 60_000;
const APPEND_LOCK_AUTO_EXPIRY_MS = 900_000;

/**
 * Appends rows to a sheet with support for formatted links.
 *
 * Unlike appendRows which only supports simple values and formulas,
 * this function supports rich text formatting including hyperlinks
 * that appear as formatted text (not HYPERLINK formulas).
 *
 * ISO timestamp strings (e.g., "2026-01-24T18:30:00.000Z") are automatically
 * converted to datetime cells in the spreadsheet's timezone.
 *
 * ## Concurrency (ADV-242)
 *
 * Serializes per-(spreadsheetId, sheetName) via an in-memory lock keyed by
 * `sheet-append:${spreadsheetId}:${sheetName}`. The Google Sheets `appendCells`
 * request is NOT safe under concurrent execution against the same sheet —
 * overlapping requests can race on "current end of data" detection and silently
 * overwrite each other. The lock prevents that. Writes to different sheets,
 * even within the same workbook, are not serialized.
 *
 * The response is validated: a successful `appendCells` request returns
 * `replies[0]` as an empty `{}` (the response schema carries no structured
 * `appendCells` payload). A missing or falsy `replies[0]` indicates the
 * request was not applied and is thrown so `withQuotaRetry` retries.
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
  timeZone?: string,
  metadataCache?: import('../processing/caches/index.js').MetadataCache
): Promise<Result<number, Error>> {
  // Parse sheet name from range (e.g., 'Sheet1!A:Z' -> 'Sheet1') BEFORE
  // acquiring the lock so the lock key reflects the actual target.
  const sheetName = range.split('!')[0];
  const lockKey = `sheet-append:${spreadsheetId}:${sheetName}`;

  // withTiming is placed INSIDE withLockResult so the recorded `durationMs`
  // measures only the actual API operation, not lock-wait time. Otherwise
  // every queued append would emit a SLOW_CALL_THRESHOLD_MS warning during
  // contention, drowning out real API latency signals.
  return withLockResult(
    lockKey,
    () => withTiming('appendRowsWithLinks', () => withQuotaRetry(async () => {
      // Step 1: Get metadata (NO retry wrapper)
      // Use cache if provided, otherwise direct call
      const metadataResult = metadataCache
        ? await metadataCache.get(spreadsheetId)
        : await getSheetMetadataInternal(spreadsheetId);
      if (!metadataResult.ok) {
        throw metadataResult.error; // Convert to exception for retry
      }

      const sheet = metadataResult.value.find(s => s.title === sheetName);
      if (!sheet) {
        throw new Error(`Sheet not found: ${sheetName}`);
      }

      // Convert rows to Sheets API format
      const rows: sheets_v4.Schema$RowData[] = values.map(rowValues => ({
        values: rowValues.map(value => convertToSheetsCellData(value, timeZone)),
      }));

      // Step 2: Append data (in same retry scope)
      const sheets = await getSheetsService();
      const response = await sheets.spreadsheets.batchUpdate({
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
      }, { timeout: GOOGLE_API_TIMEOUT_MS });

      // Step 3: Validate the response — defence in depth against silent
      // partial failures from the Sheets API. A successful appendCells
      // request returns `replies[0]` as `{}` (the response schema has no
      // structured appendCells payload). A missing or falsy entry indicates
      // the request was not applied.
      const replies = response.data?.replies;
      if (!Array.isArray(replies) || replies.length === 0 || !replies[0]) {
        throw new Error(
          `appendCells did not return a confirmation reply for ${sheetName} ` +
          `(spreadsheetId=${spreadsheetId}, rows=${rows.length})`
        );
      }

      // Calculate total cells appended (rows * columns)
      return rows.reduce((total, row) => {
        return total + (row.values?.length || 0);
      }, 0);
    })),
    APPEND_LOCK_WAIT_TIMEOUT_MS,
    APPEND_LOCK_AUTO_EXPIRY_MS,
  );
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
  descending: boolean = true,
  metadataCache?: import('../processing/caches/index.js').MetadataCache
): Promise<Result<void, Error>> {
  // Single retry wrapper for ENTIRE operation
  return withQuotaRetry(async () => {
    // Step 1: Get metadata (NO retry wrapper)
    // Use cache if provided, otherwise direct call
    const metadataResult = metadataCache
      ? await metadataCache.get(spreadsheetId)
      : await getSheetMetadataInternal(spreadsheetId);
    if (!metadataResult.ok) {
      throw metadataResult.error; // Convert to exception for retry
    }

    const sheet = metadataResult.value.find(s => s.title === sheetName);
    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    // Step 2: Sort the sheet (in same retry scope)
    const sheets = await getSheetsService();
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
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
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
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    // Clear all data starting from row 2 (preserves header row)
    const range = `${sheetName}!A2:Z`;
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

// ─── applySubdiarioDiff ──────────────────────────────────────────────────────

/**
 * Date format applied to date cells in Subdiario rows. Matches the pattern
 * emitted by `convertToSheetsCellData` for `CellDate` values, so dates render
 * consistently across all project sheets.
 */
const SUBDIARIO_DATE_FORMAT: sheets_v4.Schema$CellFormat = {
  numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
};

/**
 * Number format applied to money cells (total, recibido). Matches the pattern
 * emitted by `convertToSheetsCellData` for `CellNumber` values.
 */
const SUBDIARIO_NUMBER_FORMAT: sheets_v4.Schema$CellFormat = {
  numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
};

/**
 * Converts a SubdiarioRow into a CellData array for use in `updateCells` requests.
 *
 * Cell emission rules:
 * - fecha (A): serial + DATE `yyyy-mm-dd` format
 * - nro (D): stringValue. When `facturaFileId !== ''`, additionally a
 *   `textFormatRuns` link points at the Drive PDF viewer. FALTA rows have no
 *   link (ADV-282).
 * - total (H): numberValue + NUMBER `#,##0.00` format
 * - fechaCobro (K): serial + DATE format when YYYY-MM-DD, stringValue otherwise
 * - recibido (L): numberValue + NUMBER format when not null; empty userEnteredValue when null (blank cell, NOT 0)
 * - movimiento (M): stringValue (`movimientoLabel`) + `textFormatRuns` link to
 *   the bank movimiento source row. Empty cell when there is no matched
 *   movimiento. ADV-282 replaces the older `=HYPERLINK("url","Mov")` formula.
 * - notas (N): string
 * - All other string fields: stringValue (no number format)
 *
 * Date/number formats are emitted per-cell to mirror the convention used by
 * `convertToSheetsCellData` (i.e. `CellDate`/`CellNumber` wrappers) elsewhere in
 * the project. The caller's `updateCells` field mask MUST include
 * `userEnteredFormat.numberFormat` AND `textFormatRuns` — the latter is what
 * carries the col D and col M link targets.
 */
function rowToCellData(row: SubdiarioRow): sheets_v4.Schema$CellData[] {
  // D: nro — always stringValue. Link the cell to the source factura PDF when
  // we know the fileId. FALTA placeholders leave it bare.
  const nroCell: sheets_v4.Schema$CellData = row.facturaFileId
    ? {
        userEnteredValue: { stringValue: row.nro },
        textFormatRuns: [
          {
            format: {
              link: { uri: `https://drive.google.com/file/d/${row.facturaFileId}/view` },
            },
          },
        ],
      }
    : { userEnteredValue: { stringValue: row.nro } };

  // M: movimiento — display text is `movimientoLabel`; the link URI is the URL.
  // Empty cell when the label is blank (no matched movimiento).
  const movCell: sheets_v4.Schema$CellData =
    row.movimientoLabel && row.movimientoLabel.trim() !== ''
      ? {
          userEnteredValue: { stringValue: row.movimientoLabel },
          textFormatRuns: [
            {
              format: {
                link: { uri: row.movimiento },
              },
            },
          ],
        }
      : { userEnteredValue: {} };

  return [
    // A: fecha → serial number with DATE format
    {
      userEnteredValue: { numberValue: dateStringToSerial(row.fecha) },
      userEnteredFormat: SUBDIARIO_DATE_FORMAT,
    },
    // B: cod → string
    { userEnteredValue: { stringValue: row.cod } },
    // C: tipo → string
    { userEnteredValue: { stringValue: row.tipo } },
    // D: nro — see nroCell above
    nroCell,
    // E: cliente → string
    { userEnteredValue: { stringValue: row.cliente } },
    // F: cuit → string
    { userEnteredValue: { stringValue: row.cuit } },
    // G: condicion → string
    { userEnteredValue: { stringValue: row.condicion } },
    // H: total → number with NUMBER format
    {
      userEnteredValue: { numberValue: row.total },
      userEnteredFormat: SUBDIARIO_NUMBER_FORMAT,
    },
    // I: concepto → string
    { userEnteredValue: { stringValue: row.concepto } },
    // J: categoria → string
    { userEnteredValue: { stringValue: row.categoria } },
    // K: fechaCobro → serial + DATE format when YYYY-MM-DD, stringValue otherwise
    /^\d{4}-\d{2}-\d{2}$/.test(row.fechaCobro)
      ? {
          userEnteredValue: { numberValue: dateStringToSerial(row.fechaCobro) },
          userEnteredFormat: SUBDIARIO_DATE_FORMAT,
        }
      : { userEnteredValue: { stringValue: row.fechaCobro } },
    // L: recibido → numberValue + NUMBER format when not null; empty userEnteredValue when null (blank cell)
    row.recibido !== null
      ? {
          userEnteredValue: { numberValue: row.recibido },
          userEnteredFormat: SUBDIARIO_NUMBER_FORMAT,
        }
      : { userEnteredValue: {} },
    // M: movimiento — see movCell above
    movCell,
    // N: notas → string
    { userEnteredValue: { stringValue: row.notas } },
  ];
}

/**
 * Applies a SubdiarioDiff to the Comprobantes sheet via a single `batchUpdate`.
 *
 * Request order (within the single batch):
 * 1. `deleteDimension` for each `diff.deletes` (already DESC — bottom-up avoids index shift)
 * 2. `insertDimension` + `updateCells` pairs for each `diff.inserts`
 * 3. `updateCells` for each `diff.updates`
 *
 * All rowIndex values in the diff are 0-indexed relative to the first DATA row
 * (header at sheet row 0). Sheet row = diff rowIndex + 1.
 *
 * **IMPORTANT:** The caller (subdiario-writer.ts) MUST hold the
 * `sheet-append:${spreadsheetId}:Comprobantes` lock around the read → diff →
 * applySubdiarioDiff sequence. This function does NOT acquire the lock itself.
 * Calling it outside the lock reproduces the ADV-242 silent-overwrite race.
 *
 * @param spreadsheetId - Subdiario spreadsheet ID
 * @param sheetId       - Numeric sheet ID of the Comprobantes sheet
 * @param diff          - Diff produced by diffSubdiarioRows()
 * @param _desiredRows  - Full desired row set (reserved for future use / logging)
 * @returns Counts of applied operations or error
 */
export async function applySubdiarioDiff(
  spreadsheetId: string,
  sheetId: number,
  diff: SubdiarioDiff,
  _desiredRows: SubdiarioRow[]
): Promise<Result<{ updates: number; inserts: number; deletes: number }, Error>> {
  const requests: sheets_v4.Schema$Request[] = [];

  // 1. Deletions — DESC order so lower rows are deleted first without shifting upper indices
  for (const rowIndex of diff.deletes) {
    const sheetRow = rowIndex + 1; // +1 for header
    requests.push({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: sheetRow,
          endIndex: sheetRow + 1,
        },
      },
    });
  }

  // 2. Insertions — each insert needs a dimension slot + a cell-data write
  for (const { insertAt, row } of diff.inserts) {
    const sheetRow = insertAt + 1; // +1 for header
    requests.push({
      insertDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: sheetRow,
          endIndex: sheetRow + 1,
        },
        inheritFromBefore: false,
      },
    });
    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: sheetRow, columnIndex: 0 },
        rows: [{ values: rowToCellData(row) }],
        fields: 'userEnteredValue,userEnteredFormat.numberFormat,textFormatRuns',
      },
    });
  }

  // 3. Updates — overwrite cells at the row's DESIRED position.
  //
  // By the time this request runs, all deletions (step 1) and insertions (step 2)
  // have already been applied sequentially. The surviving row is now located at
  // its final desired position — desiredIndex in the desired array, which maps
  // directly to sheetRow = desiredIndex + 1 (accounting for the header).
  //
  // Using the original `rowIndex + 1` would be wrong: deletions above it shift
  // the row up, while insertions at positions ≤ desiredIndex shift it back down.
  // The net effect is exactly `desiredIndex + 1` — computing adjustments piecemeal
  // is both fragile and produces incorrect results when both deletes and inserts
  // are present in the same diff.
  for (const { desiredIndex, row } of diff.updates) {
    const sheetRow = desiredIndex + 1; // desired position + 1 for header
    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: sheetRow, columnIndex: 0 },
        rows: [{ values: rowToCellData(row) }],
        fields: 'userEnteredValue,userEnteredFormat.numberFormat,textFormatRuns',
      },
    });
  }

  if (requests.length === 0) {
    return {
      ok: true,
      value: { updates: diff.updates.length, inserts: diff.inserts.length, deletes: diff.deletes.length },
    };
  }

  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
    return {
      updates: diff.updates.length,
      inserts: diff.inserts.length,
      deletes: diff.deletes.length,
    };
  }).then(result => {
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, value: result.value };
  });
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
  sheetName: string,
  metadataCache?: import('../processing/caches/index.js').MetadataCache
): Promise<Result<void, Error>> {
  // Single retry wrapper for ENTIRE operation
  return withQuotaRetry(async () => {
    // Step 1: Get metadata (NO retry wrapper)
    // Use cache if provided, otherwise direct call
    const metadataResult = metadataCache
      ? await metadataCache.get(spreadsheetId)
      : await getSheetMetadataInternal(spreadsheetId);
    if (!metadataResult.ok) {
      throw metadataResult.error; // Convert to exception for retry
    }

    const sheet = metadataResult.value.find(s => s.title === sheetName);
    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    // Step 2: Update sheet properties to move it to index 0 (in same retry scope)
    const sheets = await getSheetsService();
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
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

/**
 * Appends rows with explicit formatting (non-bold text)
 * Use this when appending to sheets with bold headers to prevent new rows from inheriting bold formatting
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation for target sheet (e.g., 'Sheet1!A:Z')
 * @param values - 2D array of rows to append. Date objects and CellFormula objects are supported.
 * @param timeZone - Optional IANA timezone string. When provided, Date objects are converted to this timezone.
 * @returns Number of updated cells
 */
export async function appendRowsWithFormatting(
  spreadsheetId: string,
  range: string,
  values: (CellValue | CellFormula)[][],
  timeZone?: string,
  metadataCache?: import('../processing/caches/index.js').MetadataCache
): Promise<Result<number, Error>> {
  // ADV-288: parse sheet name BEFORE acquiring the lock so the lock key is stable.
  const sheetName = range.split('!')[0];
  const lockKey = `sheet-append:${spreadsheetId}:${sheetName}`;

  return withLockResult(
    lockKey,
    () => withQuotaRetry(async () => {
      // Step 1: Get metadata (NO retry wrapper)
      // Use cache if provided, otherwise direct call
      const metadataResult = metadataCache
        ? await metadataCache.get(spreadsheetId)
        : await getSheetMetadataInternal(spreadsheetId);
      if (!metadataResult.ok) {
        throw metadataResult.error; // Convert to exception for retry
      }

      const sheet = metadataResult.value.find(s => s.title === sheetName);
      if (!sheet) {
        throw new Error(`Sheet not found: ${sheetName}`);
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
          } else if (isCellFormula(value)) {
            // Explicit formula - bypasses sanitization for trusted internal formulas
            cellData.userEnteredValue = { formulaValue: value.value };
          } else if (typeof value === 'string') {
            // Always insert as plain string - prevents formula injection
            cellData.userEnteredValue = { stringValue: value };
          } else if (typeof value === 'number') {
            cellData.userEnteredValue = { numberValue: value };
          } else if (typeof value === 'boolean') {
            cellData.userEnteredValue = { boolValue: value };
          }

          return cellData;
        }),
      }));

      // Step 2: Use batchUpdate with appendCells to support formatting (in same retry scope)
      const sheets = await getSheetsService();
      const response = await sheets.spreadsheets.batchUpdate({
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
      }, { timeout: GOOGLE_API_TIMEOUT_MS });

      // ADV-288: validate the response — defence in depth against silent partial
      // failures. A successful appendCells returns replies[0] as `{}` (no
      // structured payload). A missing or falsy entry means the request was
      // not applied; throw so withQuotaRetry retries.
      const replies = response.data?.replies;
      if (!Array.isArray(replies) || replies.length === 0 || !replies[0]) {
        throw new Error(
          `appendCells did not return a confirmation reply for ${sheetName} ` +
          `(spreadsheetId=${spreadsheetId}, rows=${rows.length})`
        );
      }

      // Calculate total cells appended
      return rows.reduce((total, row) => {
        return total + (row.values?.length || 0);
      }, 0);
    }),
    APPEND_LOCK_WAIT_TIMEOUT_MS,
    APPEND_LOCK_AUTO_EXPIRY_MS,
  );
}

/**
 * Gets the correct position index for a YYYY-MM sheet to maintain chronological order
 *
 * @param existingSheets - List of existing sheets with title and index
 * @param newMonth - Month name in YYYY-MM format
 * @returns Position index where the new sheet should be inserted
 */
export function getMonthSheetPosition(
  existingSheets: Array<{title: string; index: number}>,
  newMonth: string
): number {
  // Filter for YYYY-MM formatted sheets only, excluding the target month if it already exists
  const monthSheets = existingSheets
    .filter(s => /^\d{4}-\d{2}$/.test(s.title) && s.title !== newMonth);

  if (monthSheets.length === 0) {
    return 0;
  }

  // Sort month sheets by their title (YYYY-MM format sorts chronologically)
  const sortedMonthSheets = monthSheets.sort((a, b) => a.title.localeCompare(b.title));

  // Find position where new month belongs in sorted list
  let positionInSortedList = 0;
  for (let i = 0; i < sortedMonthSheets.length; i++) {
    if (newMonth > sortedMonthSheets[i].title) {
      positionInSortedList = i + 1;
    } else {
      break;
    }
  }

  // If new month should be last, insert after the last month sheet
  if (positionInSortedList === sortedMonthSheets.length) {
    const lastMonthSheet = sortedMonthSheets[sortedMonthSheets.length - 1];
    return lastMonthSheet.index + 1;
  }

  // Otherwise, insert BEFORE the sheet that should come after it chronologically
  return sortedMonthSheets[positionInSortedList].index;
}

/**
 * Moves a sheet to a specific position
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Sheet ID to move
 * @param position - Target position (0-based index)
 * @returns Success/failure result
 */
export async function moveSheetToPosition(
  spreadsheetId: string,
  sheetId: number,
  position: number
): Promise<Result<void, Error>> {
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();

    const requests: sheets_v4.Schema$Request[] = [
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            index: position,
          },
          fields: 'index',
        },
      },
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

/**
 * Gets or creates a month sheet in a spreadsheet
 * If the sheet exists, returns its sheet ID
 * If it doesn't exist, creates it with the provided headers
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param monthName - Name of the month sheet (e.g., '2026-01')
 * @param headers - Headers to use if creating the sheet
 * @param sheetOrderBatch - Optional batch collector to defer sheet reordering
 * @returns Sheet ID
 */
export async function getOrCreateMonthSheet(
  spreadsheetId: string,
  monthName: string,
  headers: string[],
  sheetOrderBatch?: import('../processing/caches/index.js').SheetOrderBatch
): Promise<Result<number, Error>> {
  // First check without lock - fast path for existing sheets
  const metadataResult = await getSheetMetadata(spreadsheetId);
  if (!metadataResult.ok) return metadataResult;

  const existing = metadataResult.value.find(s => s.title === monthName);
  if (existing) {
    return { ok: true, value: existing.sheetId };
  }

  // Sheet doesn't exist - use lock to prevent race condition during creation
  // Lock key is unique per spreadsheet+month combination
  const lockKey = `sheet-create:${spreadsheetId}:${monthName}`;

  return withLock(lockKey, async () => {
    // Re-check after acquiring lock - another request may have created the sheet
    const recheckResult = await getSheetMetadata(spreadsheetId);
    if (!recheckResult.ok) throw recheckResult.error;

    const existingAfterLock = recheckResult.value.find(s => s.title === monthName);
    if (existingAfterLock) {
      return existingAfterLock.sheetId;
    }

    // Sheet still doesn't exist - safe to create now
    const createResult = await createSheet(spreadsheetId, monthName);
    if (!createResult.ok) throw createResult.error;

    const sheetId = createResult.value;

    const range = `${monthName}!A1:${columnIndexToLetter(headers.length)}1`;
    const headerValues = [headers];
    const setResult = await setValues(spreadsheetId, range, headerValues);
    if (!setResult.ok) throw setResult.error;

    const formatResult = await formatSheet(spreadsheetId, sheetId, { frozenRows: 1 });
    if (!formatResult.ok) throw formatResult.error;

    // If batch is provided, defer reordering to avoid race conditions during concurrent processing
    if (sheetOrderBatch) {
      sheetOrderBatch.addPendingReorder(spreadsheetId);
      return sheetId;
    }

    // Immediate ordering mode (standalone calls without batch)
    // Get updated metadata to determine correct position for chronological ordering
    const updatedMetadataResult = await getSheetMetadata(spreadsheetId);
    if (!updatedMetadataResult.ok) throw updatedMetadataResult.error;

    // Calculate correct position for this month sheet
    const targetPosition = getMonthSheetPosition(updatedMetadataResult.value, monthName);

    // Find current position of the newly created sheet
    const currentSheet = updatedMetadataResult.value.find(s => s.sheetId === sheetId);

    // Move sheet to correct position if needed
    if (currentSheet && currentSheet.index !== targetPosition) {
      const moveResult = await moveSheetToPosition(spreadsheetId, sheetId, targetPosition);
      if (!moveResult.ok) throw moveResult.error;
    }

    // Delete Sheet1 if it exists and is the only non-month sheet
    // (This is the default sheet created with new spreadsheets)
    const sheet1 = updatedMetadataResult.value.find(s => s.title === 'Sheet1');
    if (sheet1) {
      // Only delete Sheet1 if all other sheets are month sheets (YYYY-MM format)
      const nonMonthSheets = updatedMetadataResult.value.filter(
        s => s.title !== 'Sheet1' && !/^\d{4}-\d{2}$/.test(s.title)
      );

      if (nonMonthSheets.length === 0) {
        const deleteResult = await deleteSheet(spreadsheetId, sheet1.sheetId);
        if (!deleteResult.ok) throw deleteResult.error;
      }
    }

    return sheetId;
  });
}

/**
 * Formats an empty month sheet with "SIN MOVIMIENTOS" message
 * Sets row 3 with "===== SIN MOVIMIENTOS =====" in cell B3
 * Red background extends from column A to the last header column
 * Text is bold and white
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Sheet ID
 * @param numColumns - Number of columns with headers (determines red background extent)
 * @returns Success/failure result
 */
export async function formatEmptyMonthSheet(
  spreadsheetId: string,
  sheetId: number,
  numColumns: number
): Promise<Result<void, Error>> {
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();

    // Create row cells with red background
    const cells: sheets_v4.Schema$CellData[] = [];
    for (let i = 0; i < numColumns; i++) {
      const cell: sheets_v4.Schema$CellData = {
        userEnteredFormat: {
          backgroundColor: {
            red: 1.0,
            green: 0.0,
            blue: 0.0,
          },
          textFormat: {
            bold: true,
            foregroundColor: {
              red: 1.0,
              green: 1.0,
              blue: 1.0,
            },
          },
        },
      };

      // Add text to cell B (index 1)
      if (i === 1) {
        cell.userEnteredValue = {
          stringValue: '===== SIN MOVIMIENTOS =====',
        };
      }

      cells.push(cell);
    }

    const requests: sheets_v4.Schema$Request[] = [
      {
        updateCells: {
          range: {
            sheetId,
            startRowIndex: 2,
            endRowIndex: 3,
            startColumnIndex: 0,
            endColumnIndex: numColumns,
          },
          rows: [{ values: cells }],
          fields: 'userEnteredValue,userEnteredFormat',
        },
      },
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

/**
 * Reorders all month sheets (YYYY-MM format) in a spreadsheet to be chronologically sorted.
 * Call this at the end of batch processing to ensure correct ordering.
 *
 * @param spreadsheetId - Spreadsheet ID to reorder
 * @returns Success/failure result
 */
export async function reorderMonthSheets(
  spreadsheetId: string
): Promise<Result<void, Error>> {
  // Get all sheet metadata
  const metadataResult = await getSheetMetadata(spreadsheetId);
  if (!metadataResult.ok) return metadataResult;

  // Delete Sheet1 if it exists and is the only non-month sheet
  // (This is the default sheet created with new spreadsheets)
  // This cleanup is done here because getOrCreateMonthSheet skips it when using batch mode
  const sheet1 = metadataResult.value.find(s => s.title === 'Sheet1');
  if (sheet1) {
    // Only delete Sheet1 if all other sheets are month sheets (YYYY-MM format)
    const nonMonthSheets = metadataResult.value.filter(
      s => s.title !== 'Sheet1' && !/^\d{4}-\d{2}$/.test(s.title)
    );

    if (nonMonthSheets.length === 0) {
      const deleteResult = await deleteSheet(spreadsheetId, sheet1.sheetId);
      if (!deleteResult.ok) return deleteResult;
    }
  }

  // Filter for YYYY-MM formatted sheets only
  const monthSheets = metadataResult.value.filter(s => /^\d{4}-\d{2}$/.test(s.title));

  if (monthSheets.length <= 1) {
    // Nothing to reorder
    return { ok: true, value: undefined };
  }

  // Sort by title (YYYY-MM format sorts chronologically)
  const sortedSheets = [...monthSheets].sort((a, b) => a.title.localeCompare(b.title));

  // Move sheets to correct positions in order
  for (let i = 0; i < sortedSheets.length; i++) {
    const sheet = sortedSheets[i];
    const moveResult = await moveSheetToPosition(spreadsheetId, sheet.sheetId, i);
    if (!moveResult.ok) return moveResult;
  }

  return { ok: true, value: undefined };
}

/**
 * Converts a column letter(s) to 1-based index.
 * Reverse of columnIndexToLetter.
 *
 * @param letter - Column letter(s) (e.g., 'A', 'Z', 'AA')
 * @returns 1-based column index
 *
 * @example
 * columnLetterToIndex('A')  // 1
 * columnLetterToIndex('Z')  // 26
 * columnLetterToIndex('AA') // 27
 * columnLetterToIndex('AZ') // 52
 */
export function columnLetterToIndex(letter: string): number {
  let result = 0;
  for (const char of letter.toUpperCase()) {
    result = result * 26 + (char.charCodeAt(0) - 65 + 1);
  }
  return result;
}

/**
 * Parses an A1 notation range string into 0-indexed inclusive grid coordinates.
 * Handles quoted sheet names (single quotes, with '' as escaped single quote).
 *
 * Returns inclusive 0-based coordinates. When building a GridRange for the Sheets API,
 * add +1 to endRow and endCol to make them exclusive.
 *
 * @param range - A1 notation range (e.g., 'Sheet1'!A5:S5 or Sheet1!A5)
 * @returns Parsed coordinates with 0-indexed inclusive startRow, endRow, startCol, endCol
 */
export function parseA1Range(range: string): {
  sheetName: string;
  startCol: number;
  endCol: number;
  startRow: number;
  endRow: number;
} {
  let sheetName: string;
  let cellRange: string;

  if (range.startsWith("'")) {
    // Quoted sheet name — handle doubled-quote escapes ('')
    let i = 1;
    let name = '';
    let closingFound = false;
    while (i < range.length) {
      if (range[i] === "'") {
        if (i + 1 < range.length && range[i + 1] === "'") {
          // Doubled quote = escaped single quote
          name += "'";
          i += 2;
        } else {
          // Closing quote — next char must be '!'
          closingFound = true;
          sheetName = name;
          cellRange = range.slice(i + 2); // Skip closing ' and !
          break;
        }
      } else {
        name += range[i];
        i++;
      }
    }
    if (!closingFound) {
      throw new Error(`Invalid quoted range (unclosed quote): ${range}`);
    }
  } else {
    // Unquoted sheet name — split on first !
    const bangIdx = range.indexOf('!');
    if (bangIdx === -1) {
      throw new Error(`Invalid A1 range (missing !): ${range}`);
    }
    sheetName = range.slice(0, bangIdx);
    cellRange = range.slice(bangIdx + 1);
  }

  // Parse cell range (e.g., A5:S5 or A5)
  const resolvedRange = cellRange!;
  const colonIdx = resolvedRange.indexOf(':');
  const startCellStr = colonIdx === -1 ? resolvedRange : resolvedRange.slice(0, colonIdx);
  const endCellStr = colonIdx === -1 ? resolvedRange : resolvedRange.slice(colonIdx + 1);

  function parseCellRef(ref: string): { col: number; row: number } {
    const match = ref.match(/^([A-Za-z]+)(\d+)$/);
    if (!match) {
      throw new Error(`Invalid cell reference: ${ref}`);
    }
    return {
      col: columnLetterToIndex(match[1]) - 1, // 0-indexed
      row: parseInt(match[2], 10) - 1,         // 0-indexed
    };
  }

  const start = parseCellRef(startCellStr);
  const end = parseCellRef(endCellStr);

  return {
    sheetName: sheetName!,
    startCol: start.col,
    endCol: end.col,
    startRow: start.row,
    endRow: end.row,
  };
}

/**
 * Updates specific rows in a spreadsheet with rich cell formatting.
 *
 * Unlike batchUpdate (which uses USER_ENTERED values and loses rich types),
 * this function preserves CellDate, CellNumber, and CellLink formatting during row updates.
 *
 * ISO timestamp strings are automatically converted to DATE_TIME cells in the
 * spreadsheet's timezone when timeZone is provided.
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param updates - Array of { range, values } — each entry is a single row in A1 notation
 * @param timeZone - Optional IANA timezone for ISO timestamp conversion
 * @param metadataCache - Optional scan-scoped cache for sheet metadata
 * @returns Success or error
 *
 * @example
 * await updateRowsWithFormatting('abc123', [
 *   { range: 'Sheet1!A5:S5', values: row },
 * ], 'America/Argentina/Buenos_Aires', metadataCache);
 */
export async function updateRowsWithFormatting(
  spreadsheetId: string,
  updates: Array<{ range: string; values: CellValueOrLink[] }>,
  timeZone?: string,
  metadataCache?: import('../processing/caches/index.js').MetadataCache
): Promise<Result<void, Error>> {
  return withQuotaRetry(async () => {
    // Get sheet metadata once (use cache if provided)
    const metadataResult = metadataCache
      ? await metadataCache.get(spreadsheetId)
      : await getSheetMetadataInternal(spreadsheetId);
    if (!metadataResult.ok) {
      throw metadataResult.error;
    }

    const sheetsByTitle = new Map(metadataResult.value.map(s => [s.title, s]));

    // Build one updateCells request per update entry
    const requests: sheets_v4.Schema$Request[] = updates.map(({ range, values }) => {
      const parsed = parseA1Range(range);
      const sheet = sheetsByTitle.get(parsed.sheetName);
      if (!sheet) {
        throw new Error(`Sheet not found: ${parsed.sheetName}`);
      }

      const rowValues = values.map(value => convertToSheetsCellData(value, timeZone));

      return {
        updateCells: {
          range: {
            sheetId: sheet.sheetId,
            startRowIndex: parsed.startRow,
            endRowIndex: parsed.endRow + 1,     // GridRange end is exclusive
            startColumnIndex: parsed.startCol,
            endColumnIndex: parsed.endCol + 1,  // GridRange end is exclusive
          },
          rows: [{ values: rowValues }],
          fields: 'userEnteredValue,userEnteredFormat,textFormatRuns',
        },
      };
    });

    const sheets = await getSheetsService();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

/**
 * Renames a sheet tab by its numeric sheet ID
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Numeric sheet ID (from getSheetMetadata)
 * @param newTitle - New title for the sheet
 * @returns Success or error
 */
export async function renameSheet(
  spreadsheetId: string,
  sheetId: number,
  newTitle: string
): Promise<Result<void, Error>> {
  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                title: newTitle,
              },
              fields: 'title',
            },
          },
        ],
      },
    });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

/**
 * Specification for styling a row range in a sheet.
 * All style fields are optional — only provided fields are set.
 */
export interface RowStyleSpec {
  /** 0-based starting row index (inclusive) */
  startRowIndex: number;
  /** 0-based ending row index (exclusive) */
  endRowIndex: number;
  /** Background color as RGB (0–1 each channel) */
  backgroundColor?: { red: number; green: number; blue: number };
  /** Text foreground color as RGB (0–1 each channel) */
  foregroundColor?: { red: number; green: number; blue: number };
  /** Whether to make text bold */
  bold?: boolean;
}

/**
 * Applies per-row background/foreground/bold styles to a sheet.
 *
 * Builds one `repeatCell` request per style spec and sends them as a single
 * `batchUpdate`. Skips specs where no style fields are provided.
 *
 * Wraps in `withQuotaRetry` to handle transient quota errors consistently with
 * other sheets helpers.
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId       - Numeric sheet ID (from getSheetMetadata)
 * @param styles        - Array of row style specs
 * @returns Success or error
 */
export async function applyRowStyles(
  spreadsheetId: string,
  sheetId: number,
  styles: RowStyleSpec[]
): Promise<Result<void, Error>> {
  // Filter out specs with no style fields
  const activeStyles = styles.filter(
    s => s.backgroundColor !== undefined || s.foregroundColor !== undefined || s.bold !== undefined
  );
  if (activeStyles.length === 0) {
    return { ok: true, value: undefined };
  }

  return withQuotaRetry(async () => {
    const sheets = await getSheetsService();

    const requests: sheets_v4.Schema$Request[] = activeStyles.map(spec => {
      const userEnteredFormat: sheets_v4.Schema$CellFormat = {};
      const fields: string[] = [];

      if (spec.backgroundColor !== undefined) {
        userEnteredFormat.backgroundColor = spec.backgroundColor;
        fields.push('userEnteredFormat.backgroundColor');
      }

      const textFormat: sheets_v4.Schema$TextFormat = {};
      if (spec.foregroundColor !== undefined) {
        textFormat.foregroundColor = spec.foregroundColor;
        fields.push('userEnteredFormat.textFormat.foregroundColor');
      }
      if (spec.bold !== undefined) {
        textFormat.bold = spec.bold;
        fields.push('userEnteredFormat.textFormat.bold');
      }
      if (Object.keys(textFormat).length > 0) {
        userEnteredFormat.textFormat = textFormat;
      }

      return {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: spec.startRowIndex,
            endRowIndex: spec.endRowIndex,
            startColumnIndex: 0,
          },
          cell: {
            userEnteredFormat,
          },
          fields: fields.join(','),
        },
      };
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    }, { timeout: GOOGLE_API_TIMEOUT_MS });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

/**
 * Clears the cached Sheets service (for testing)
 */
export function clearSheetsCache(): void {
  sheetsService = null;
}

