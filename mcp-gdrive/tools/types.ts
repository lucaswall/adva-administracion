/**
 * Tool system types for MCP server
 */

export interface Tool<T> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: readonly string[];
  };
  handler: (args: T) => Promise<ToolResponse>;
}

export interface ToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError: boolean;
}

// Input types for each tool
export interface GDriveSearchInput {
  query: string;
  pageToken?: string;
  pageSize?: number;
}

export interface GDriveReadFileInput {
  fileId: string;
}

export interface GDriveListFolderInput {
  folderId: string;
  pageToken?: string;
  pageSize?: number;
}

export interface GDriveGetPdfInput {
  fileId: string;
}

export interface GSheetsReadInput {
  spreadsheetId: string;
  ranges?: string[];
  sheetId?: number;
}
