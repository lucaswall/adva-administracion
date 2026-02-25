import { google } from 'googleapis';
import { GSheetsDeleteRowsInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gsheets_delete_rows',
  description:
    'Delete one or more rows from a Google Spreadsheet sheet. Row numbers are 1-indexed (row 1 is the header). Both startRow and endRow are inclusive.',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'The ID of the spreadsheet',
      },
      sheetName: {
        type: 'string',
        description:
          'The name of the sheet (tab) to delete rows from (e.g., "Pagos Recibidos")',
      },
      startRow: {
        type: 'number',
        description: 'First row to delete (1-indexed, inclusive)',
      },
      endRow: {
        type: 'number',
        description:
          'Last row to delete (1-indexed, inclusive). If omitted, only startRow is deleted.',
      },
    },
    required: ['spreadsheetId', 'sheetName', 'startRow'],
  },
} as const;

export async function deleteRows(
  args: GSheetsDeleteRowsInput,
): Promise<ToolResponse> {
  try {
    const sheets = google.sheets('v4');
    const endRow = args.endRow ?? args.startRow;

    if (args.startRow < 1 || endRow < args.startRow) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid row range: startRow=${args.startRow}, endRow=${endRow}. Rows are 1-indexed and endRow must be >= startRow.`,
          },
        ],
        isError: true,
      };
    }

    // Resolve sheetName to sheetId
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: args.spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheet = metadata.data.sheets?.find(
      (s) => s.properties?.title === args.sheetName,
    );

    if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
      return {
        content: [
          {
            type: 'text',
            text: `Sheet "${args.sheetName}" not found in spreadsheet ${args.spreadsheetId}`,
          },
        ],
        isError: true,
      };
    }

    const sheetId = sheet.properties.sheetId;

    // deleteDimension uses 0-indexed, exclusive end
    const startIndex = args.startRow - 1;
    const endIndex = endRow;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex,
                endIndex,
              },
            },
          },
        ],
      },
    });

    const count = endRow - args.startRow + 1;
    const rowDesc =
      count === 1
        ? `row ${args.startRow}`
        : `rows ${args.startRow}-${endRow}`;

    return {
      content: [
        {
          type: 'text',
          text: `Deleted ${rowDesc} (${count} row${count > 1 ? 's' : ''}) from sheet "${args.sheetName}"`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error deleting rows: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
