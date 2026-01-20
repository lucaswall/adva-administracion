# MCP Gemini

MCP server for Gemini API document analysis. Allows agents to test PDF parsing prompts with different Gemini models.

## Purpose

This MCP server enables agents to:
- Send PDF files and prompts to Gemini API
- Test and optimize document parsing prompts
- Compare results across different Gemini models
- Iterate on prompt engineering with known test PDFs

## Installation

```bash
cd mcp-gemini
npm install
```

## Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gemini": {
      "command": "npx",
      "args": [
        "tsx",
        "/Users/lucaswall/Projects/adva-administracion/mcp-gemini/index.ts"
      ]
    }
  }
}
```

**Environment Variables:**
- `GEMINI_API_KEY` - Required. Get from [Google AI Studio](https://aistudio.google.com/app/apikey)

The server loads `.env` from the parent `adva-administracion` directory.

## Available Tools

### `gemini_analyze_pdf`

Analyze a PDF file using Gemini API.

**Parameters:**
- `pdfPath` (required): Absolute path to the PDF file
- `prompt` (required): The analysis prompt to send to Gemini
- `model` (optional): Gemini model to use (default: `gemini-2.5-flash`)
  - Available models: `gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-1.5-pro`

**Example Usage:**

```typescript
// Analyze a test invoice
{
  "pdfPath": "/tmp/test-invoice.pdf",
  "prompt": "Extract the invoice number, date, and total amount from this invoice.",
  "model": "gemini-2.5-flash"
}
```

**Response:**
Returns the Gemini API response text with the analysis results.

## Use Cases

1. **Prompt Testing**: Test different extraction prompts against known PDFs
2. **Model Comparison**: Compare results from different Gemini models
3. **Prompt Optimization**: Iterate on prompts to improve extraction accuracy
4. **Debugging**: Analyze specific documents that failed in production

## Notes

- The server uses the same `GEMINI_API_KEY` as the main ADVA application
- PDFs must be accessible via absolute file paths
- The tool follows MCP conventions for error handling and response formatting
