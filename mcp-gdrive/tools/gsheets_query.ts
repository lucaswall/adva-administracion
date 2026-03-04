import { google } from 'googleapis';
import { GSheetsQueryInput, ToolResponse } from './types.js';
import { colIndexToLetter, colLetterToIndex, parseColumnSpecs, projectRow } from './column-utils.js';

export const schema = {
  name: 'gsheets_query',
  description:
    'Query a Google Spreadsheet with row-level filtering. Fetches sheet data and applies WHERE conditions server-side, returning only matching rows. More efficient than gsheets_read when you need a subset of rows.',
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'The ID of the spreadsheet to query',
      },
      sheetName: {
        type: 'string',
        description: 'The name of the sheet (tab) to query (e.g., "2025-11", "Facturas Emitidas")',
      },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Column letters or ranges to return, e.g. ["A", "B", "G:I"]. Omit for all columns.',
      },
      where: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            column: {
              type: 'string',
              description: 'Column letter (e.g. "G")',
            },
            operator: {
              type: 'string',
              enum: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'empty', 'not_empty'],
              description: 'Comparison operator',
            },
            value: {
              type: 'string',
              description: 'Value to compare against (not needed for empty/not_empty)',
            },
          },
          required: ['column', 'operator'],
        },
        description: 'Filter conditions (AND logic). Each condition specifies a column, operator, and optional value.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of matching rows to return',
      },
      offset: {
        type: 'number',
        description: 'Number of matching rows to skip before returning results',
      },
    },
    required: ['spreadsheetId', 'sheetName'],
  },
} as const;

function evaluateCondition(
  cellValue: unknown,
  operator: string,
  compareValue?: string
): boolean {
  const str = cellValue == null ? '' : String(cellValue);

  switch (operator) {
    case 'empty':
      return str.trim() === '';
    case 'not_empty':
      return str.trim() !== '';
    case 'eq':
      return str === (compareValue ?? '');
    case 'neq':
      return str !== (compareValue ?? '');
    case 'contains':
      return str.toLowerCase().includes((compareValue ?? '').toLowerCase());
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const numCell = Number(str);
      const numCompare = Number(compareValue);
      if (isNaN(numCell) || isNaN(numCompare)) {
        // Fall back to string comparison
        if (operator === 'gt') return str > (compareValue ?? '');
        if (operator === 'lt') return str < (compareValue ?? '');
        if (operator === 'gte') return str >= (compareValue ?? '');
        return str <= (compareValue ?? '');
      }
      if (operator === 'gt') return numCell > numCompare;
      if (operator === 'lt') return numCell < numCompare;
      if (operator === 'gte') return numCell >= numCompare;
      return numCell <= numCompare;
    }
    default:
      return true;
  }
}

export async function querySheet(args: GSheetsQueryInput): Promise<ToolResponse> {
  try {
    const sheets = google.sheets('v4');

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: args.spreadsheetId,
      range: `'${args.sheetName}'`,
    });

    const values = response.data.values || [];
    if (values.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify([{ sheetName: args.sheetName, data: [], totalRows: 0, totalColumns: 0, matchingRows: 0, columnHeaders: [] }], null, 2) }],
        isError: false,
      };
    }

    const headerRow = values[0] as unknown[];
    const dataRows = values.slice(1);

    // Build column index map for WHERE conditions
    const conditions = (args.where || []).map((cond) => ({
      colIndex: colLetterToIndex(cond.column.toUpperCase()),
      operator: cond.operator,
      value: cond.value,
    }));

    // Filter rows
    let matchingRows: { rowIndex: number; row: unknown[] }[] = [];
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const matches = conditions.every((cond) => {
        const cellValue = cond.colIndex < row.length ? row[cond.colIndex] : '';
        return evaluateCondition(cellValue, cond.operator, cond.value);
      });
      if (matches) {
        matchingRows.push({ rowIndex: i, row });
      }
    }

    const totalMatching = matchingRows.length;

    // Apply offset and limit
    const offset = args.offset || 0;
    if (offset > 0) {
      matchingRows = matchingRows.slice(offset);
    }
    if (args.limit != null && args.limit > 0) {
      matchingRows = matchingRows.slice(0, args.limit);
    }

    // Determine column projection
    const colIndices = args.columns ? parseColumnSpecs(args.columns) : null;

    // Build A1-notation cell references
    const sheetName = args.sheetName;

    function buildCell(value: unknown, rowNum: number, colIdx: number) {
      return {
        value: value == null ? '' : value,
        location: `${sheetName}!${colIndexToLetter(colIdx + 1)}${rowNum}`,
      };
    }

    // Build header
    const projectedHeader = colIndices
      ? colIndices.map((ci) => buildCell(ci < headerRow.length ? headerRow[ci] : '', 1, ci))
      : headerRow.map((val, ci) => buildCell(val, 1, ci));

    // Build data rows
    const projectedData = matchingRows.map(({ rowIndex, row }) => {
      const spreadsheetRow = rowIndex + 2; // +1 for header, +1 for 1-based
      if (colIndices) {
        return colIndices.map((ci) =>
          buildCell(ci < row.length ? row[ci] : '', spreadsheetRow, ci)
        );
      }
      return row.map((val, ci) => buildCell(val, spreadsheetRow, ci));
    });

    const result = {
      sheetName,
      data: projectedData,
      totalRows: values.length,
      totalColumns: colIndices ? colIndices.length : (headerRow.length || 0),
      matchingRows: totalMatching,
      columnHeaders: projectedHeader,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify([result], null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error querying spreadsheet: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
