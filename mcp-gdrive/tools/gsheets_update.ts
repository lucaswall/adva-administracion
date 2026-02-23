import { google } from 'googleapis';
import { GSheetsUpdateInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gsheets_update',
  description:
    'Update cells in a Google Spreadsheet. Takes an array of {range, value} pairs in A1 notation.',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'The ID of the spreadsheet to update',
      },
      updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            range: {
              type: 'string',
              description:
                "Cell range in A1 notation (e.g., \"'Facturas Emitidas'!P5\")",
            },
            value: {
              type: 'string',
              description: 'Value to write to the cell',
            },
          },
          required: ['range', 'value'],
        },
        description: 'Array of {range, value} pairs to update',
      },
    },
    required: ['spreadsheetId', 'updates'],
  },
} as const;

export async function updateSheet(
  args: GSheetsUpdateInput,
): Promise<ToolResponse> {
  try {
    if (!args.updates || args.updates.length === 0) {
      return {
        content: [{ type: 'text', text: 'No updates provided' }],
        isError: true,
      };
    }

    const sheets = google.sheets('v4');

    const data = args.updates.map((u) => ({
      range: u.range,
      values: [[u.value]],
    }));

    const res = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });

    const totalUpdated = res.data.totalUpdatedCells ?? 0;
    const responseCount = res.data.responses?.length ?? 0;

    return {
      content: [
        {
          type: 'text',
          text: `Updated ${totalUpdated} cell(s) across ${responseCount}/${args.updates.length} ranges in spreadsheet ${args.spreadsheetId}`,
        },
      ],
      isError: responseCount !== args.updates.length,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error updating spreadsheet: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
