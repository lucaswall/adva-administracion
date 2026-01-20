#!/usr/bin/env npx tsx

/**
 * MCP Server for Gemini API Document Analysis
 * Allows agents to test PDF parsing with Gemini models
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from parent directory (adva-administracion)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { initializeGeminiAPI } from './auth.js';
import { tools } from './tools/index.js';

// Initialize server
const server = new Server(
  {
    name: 'mcp-gemini',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);

  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const result = await tool.handler(request.params.arguments as any);
  return {
    content: result.content,
    isError: result.isError,
  };
});

// Start server
async function main() {
  try {
    // Initialize Gemini API
    initializeGeminiAPI();
    console.error('Gemini API initialized');

    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP server running on stdio');
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();
