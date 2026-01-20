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
export interface GeminiAnalyzePdfInput {
  pdfPath: string;
  prompt: string;
  model?: string;
}
