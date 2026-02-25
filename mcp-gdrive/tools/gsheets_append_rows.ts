import { google } from 'googleapis';
import { GSheetsAppendRowsInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gsheets_append_rows',
  description:
    'Append one or more rows to the end of a Google Spreadsheet sheet. Values are entered in USER_ENTERED mode (formulas supported).',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'The ID of the spreadsheet to append to',
      },
      sheetName: {
        type: 'string',
        description:
          'The name of the sheet (tab) to append to (e.g., "Pagos Enviados")',
      },
      rows: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'string' },
        },
        description:
          'Array of rows to append. Each row is an array of cell values (strings).',
      },
    },
    required: ['spreadsheetId', 'sheetName', 'rows'],
  },
} as const;

export async function appendRows(
  args: GSheetsAppendRowsInput,
): Promise<ToolResponse> {
  try {
    if (!args.rows || args.rows.length === 0) {
      return {
        content: [{ type: 'text', text: 'No rows provided' }],
        isError: true,
      };
    }

    const sheets = google.sheets('v4');

    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: args.spreadsheetId,
      range: `'${args.sheetName}'!A:A`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: args.rows,
      },
    });

    const updatedRange = res.data.updates?.updatedRange ?? 'unknown range';
    const updatedRows = res.data.updates?.updatedRows ?? 0;

    return {
      content: [
        {
          type: 'text',
          text: `Appended ${updatedRows} row${updatedRows !== 1 ? 's' : ''} to sheet "${args.sheetName}" at ${updatedRange}`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error appending rows: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
