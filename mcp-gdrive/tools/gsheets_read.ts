import { google } from 'googleapis';
import { GSheetsReadInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gsheets_read',
  description: 'Read data from a Google Spreadsheet. Can read entire sheet, specific ranges, or by sheet ID.',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'The ID of the spreadsheet to read',
      },
      ranges: {
        type: 'array',
        items: { type: 'string' },
        description: "Optional array of A1 notation ranges like ['Sheet1!A1:B10']",
      },
      sheetId: {
        type: 'number',
        description: 'Optional specific sheet ID to read (numeric)',
      },
    },
    required: ['spreadsheetId'],
  },
} as const;

function getA1Notation(row: number, col: number): string {
  let a1 = '';
  let c = col;
  while (c > 0) {
    c--;
    a1 = String.fromCharCode(65 + (c % 26)) + a1;
    c = Math.floor(c / 26);
  }
  return `${a1}${row + 1}`;
}

export async function readSheet(args: GSheetsReadInput): Promise<ToolResponse> {
  try {
    const sheets = google.sheets('v4');
    let response;

    if (args.ranges) {
      response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: args.spreadsheetId,
        ranges: args.ranges,
      });
    } else if (args.sheetId !== undefined) {
      const metadata = await sheets.spreadsheets.get({
        spreadsheetId: args.spreadsheetId,
        fields: 'sheets.properties',
      });

      const sheet = metadata.data.sheets?.find(
        (s) => s.properties?.sheetId === args.sheetId
      );

      if (!sheet?.properties?.title) {
        throw new Error(`Sheet ID ${args.sheetId} not found`);
      }

      response = await sheets.spreadsheets.values.get({
        spreadsheetId: args.spreadsheetId,
        range: sheet.properties.title,
      });
    } else {
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: args.spreadsheetId,
        range: 'A:ZZ',
      });
    }

    // Process response into structured format
    const valueRanges = response.data.valueRanges || [response.data];
    const results = [];

    for (const range of valueRanges) {
      const values = range.values || [];
      if (values.length === 0) continue;

      const rangeParts = range.range?.split('!') || [];
      const sheetName = rangeParts[0]?.replace(/'/g, '') || 'Sheet1';

      const processedValues = values.map((row: unknown[], rowIndex: number) =>
        row.map((cell: unknown, colIndex: number) => ({
          value: cell,
          location: `${sheetName}!${getA1Notation(rowIndex, colIndex + 1)}`,
        }))
      );

      results.push({
        sheetName,
        data: processedValues.slice(1),
        totalRows: values.length,
        totalColumns: processedValues[0]?.length || 0,
        columnHeaders: processedValues[0],
      });
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error reading spreadsheet: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}
