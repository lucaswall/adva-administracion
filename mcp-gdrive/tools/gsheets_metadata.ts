import { google } from 'googleapis';
import { GSheetsMetadataInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gsheets_metadata',
  description:
    'Get spreadsheet structure: title, locale, timezone, and per-sheet info (name, ID, row/column counts, frozen rows/columns, hidden status). Also returns the first N rows of each visible sheet (N = max(1, frozenRowCount)) for structural context.',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'The ID of the spreadsheet',
      },
    },
    required: ['spreadsheetId'],
  },
} as const;

export async function getMetadata(
  args: GSheetsMetadataInput,
): Promise<ToolResponse> {
  try {
    const sheets = google.sheets('v4');

    // Get spreadsheet metadata without cell data
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: args.spreadsheetId,
      fields:
        'properties.title,properties.locale,properties.timeZone,' +
        'sheets.properties.sheetId,sheets.properties.title,sheets.properties.index,' +
        'sheets.properties.sheetType,sheets.properties.hidden,' +
        'sheets.properties.gridProperties',
    });

    const spreadsheet = meta.data;

    // Build ranges to fetch first rows of each visible grid sheet
    const visibleSheets = (spreadsheet.sheets ?? []).filter(
      (s) =>
        !s.properties?.hidden &&
        s.properties?.sheetType === 'GRID' &&
        s.properties?.title,
    );

    const rangeRequests: { title: string; rowCount: number }[] = [];
    for (const s of visibleSheets) {
      const frozen = s.properties?.gridProperties?.frozenRowCount ?? 0;
      const rowsToFetch = Math.max(1, frozen);
      rangeRequests.push({
        title: s.properties!.title!,
        rowCount: rowsToFetch,
      });
    }

    // Fetch first rows in a single batch call
    let firstRowsMap: Record<string, unknown[][]> = {};
    if (rangeRequests.length > 0) {
      const ranges = rangeRequests.map(
        (r) => `'${r.title}'!1:${r.rowCount}`,
      );
      const batchResult = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: args.spreadsheetId,
        ranges,
      });
      for (const vr of batchResult.data.valueRanges ?? []) {
        const sheetName =
          vr.range?.split('!')[0]?.replace(/'/g, '') ?? '';
        firstRowsMap[sheetName] = vr.values ?? [];
      }
    }

    // Assemble output
    const result = {
      spreadsheetId: args.spreadsheetId,
      title: spreadsheet.properties?.title,
      locale: spreadsheet.properties?.locale,
      timeZone: spreadsheet.properties?.timeZone,
      sheets: (spreadsheet.sheets ?? []).map((s) => {
        const props = s.properties!;
        const grid = props.gridProperties;
        const entry: Record<string, unknown> = {
          sheetId: props.sheetId,
          title: props.title,
          index: props.index,
          type: props.sheetType,
          hidden: props.hidden ?? false,
          rowCount: grid?.rowCount,
          columnCount: grid?.columnCount,
          frozenRowCount: grid?.frozenRowCount ?? 0,
          frozenColumnCount: grid?.frozenColumnCount ?? 0,
        };
        const rows = firstRowsMap[props.title!];
        if (rows) {
          entry.firstRows = rows;
        }
        return entry;
      }),
    };

    return {
      content: [
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error reading spreadsheet metadata: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
