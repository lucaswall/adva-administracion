import { google } from 'googleapis';
import { GSheetsReadInput, ToolResponse } from './types.js';
import { colIndexToLetter, parseColumnSpecs } from './column-utils.js';

export const schema = {
  name: 'gsheets_read',
  description:
    'Read data from a Google Spreadsheet. Can read entire sheet, specific ranges, or by sheet ID. Supports pagination (offset/limit) and column projection.',
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
      offset: {
        type: 'number',
        description: 'Number of data rows to skip (after header). Default: 0',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of data rows to return. Default: unlimited',
      },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Column letters or ranges to return, e.g. ["A", "B", "G:I"]. Omit for all columns.',
      },
    },
    required: ['spreadsheetId'],
  },
} as const;

function getA1Notation(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row + 1}`;
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

    // Determine column projection indices (0-based)
    const colIndices = args.columns ? parseColumnSpecs(args.columns) : null;

    // Process response into structured format
    const valueRanges = response.data.valueRanges || [response.data];
    const results = [];

    for (const range of valueRanges) {
      const values = range.values || [];
      if (values.length === 0) continue;

      const rangeParts = range.range?.split('!') || [];
      const sheetName = rangeParts[0]?.replace(/'/g, '') || 'Sheet1';

      // Build cells with location info
      const allRows = values.map((row: unknown[], rowIndex: number) =>
        row.map((cell: unknown, colIndex: number) => ({
          value: cell,
          location: `${sheetName}!${getA1Notation(rowIndex, colIndex + 1)}`,
        }))
      );

      const headerRow = allRows[0];
      let dataRows = allRows.slice(1);
      const totalDataRows = dataRows.length;

      // Apply pagination
      const offset = args.offset || 0;
      if (offset > 0) {
        dataRows = dataRows.slice(offset);
      }
      if (args.limit != null && args.limit > 0) {
        dataRows = dataRows.slice(0, args.limit);
      }

      // Apply column projection
      if (colIndices) {
        const projectCells = (row: Array<{ value: unknown; location: string }>) =>
          colIndices.map((ci) => (ci < row.length ? row[ci] : { value: '', location: '' }));

        results.push({
          sheetName,
          data: dataRows.map(projectCells),
          totalRows: totalDataRows + 1, // include header in total
          totalColumns: colIndices.length,
          columnHeaders: projectCells(headerRow),
        });
      } else {
        results.push({
          sheetName,
          data: dataRows,
          totalRows: totalDataRows + 1,
          totalColumns: headerRow?.length || 0,
          columnHeaders: headerRow,
        });
      }
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
