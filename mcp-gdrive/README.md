# MCP Google Drive Server

Model Context Protocol (MCP) server providing read-only access to Google Drive with service account authentication.

## Features

- **Service Account Authentication** - No OAuth browser flow required
- **Shared Drives Support** - Full support for Google Shared Drives
- **Read-Only Access** - Safe for production use with readonly scopes
- **PDF Caching** - Persistent cache with automatic cleanup
- **Pure TypeScript** - No build process, runs directly with tsx

## Tools

### gdrive_search

Search for files in Google Drive by name.

**Input:**
- `query` (string, required): Search query (searches file names)
- `pageToken` (string, optional): Token for pagination
- `pageSize` (number, optional): Results per page (max 100, default 10)

**Output:** List of files with IDs, names, and MIME types.

**Example:**
```
query: "invoice"
→ Returns all files with "invoice" in the name
```

### gdrive_read_file

Read contents of a file from Google Drive.

**Input:**
- `fileId` (string, required): ID of the file to read

**Output:** File contents. Google Docs export as Markdown, Sheets as CSV, regular files as text or base64.

**Supported File Types:**
- Google Docs → Markdown
- Google Sheets → CSV
- Google Slides → Plain text
- Text files → Plain text
- JSON → Plain text
- Binary files → Base64 (truncated)

**Example:**
```
fileId: "1a2b3c4d5e6f"
→ Returns file contents
```

### gdrive_list_folder

List files and folders in a Google Drive folder.

**Input:**
- `folderId` (string, required): ID of the folder to list
- `pageToken` (string, optional): Token for pagination
- `pageSize` (number, optional): Results per page (max 100, default 10)

**Output:** List of files AND folders (subfolders) with ID, name, mimeType, size. Folders are identified by `mimeType: 'application/vnd.google-apps.folder'`.

**Example:**
```
folderId: "1rC3eH-Z2TPZrjktLF9xn93WxlY-ZPU4m"
→ Returns all files and folders in the folder
```

### gdrive_get_pdf

Download a file as PDF and save to disk with persistent caching.

**Input:**
- `fileId` (string, required): ID of the file to get as PDF

**Output:** File path to the downloaded PDF on disk.

**Supported File Types:**
- Google Docs → Export as PDF
- Google Sheets → Export as PDF
- Google Slides → Export as PDF
- PDF files → Direct download
- Other types → Error

**Caching:** Files are cached persistently for 5 days. Subsequent requests for the same file return immediately without re-downloading.

**Limitations:** Google API limits exports to 10MB.

**Example:**
```
fileId: "1x2y3z4a5b6c"
→ Returns path like "../.cache/mcp-gdrive/pdfs/1234567890_1x2y3z4a5b6c_filename.pdf"
```

### gsheets_read

Read data from a Google Spreadsheet.

**Input:**
- `spreadsheetId` (string, required): The spreadsheet ID
- `ranges` (string[], optional): A1 notation ranges like `['Sheet1!A1:B10']`
- `sheetId` (number, optional): Specific sheet ID to read

**Output:** Structured JSON with cell data, locations (A1 notation), and column headers.

**Example:**
```
spreadsheetId: "1a2b3c4d5e6f"
→ Returns all sheet data with cell locations

# Read specific range
spreadsheetId: "1a2b3c4d5e6f"
ranges: ["Sheet1!A1:D10"]
→ Returns only the specified range
```

## PDF Caching

Downloaded PDFs are cached persistently to improve performance and reduce API calls.

### Cache Location

PDFs are stored in: `../.cache/mcp-gdrive/pdfs/` (relative to parent directory)

Files are named: `{timestamp}_{fileId}_{sanitizedFileName}.pdf`

### Cache Behavior

- **Automatic deduplication**: Same file ID won't be downloaded twice
- **Persistent across sessions**: Cache survives MCP server restarts
- **Automatic cleanup**: Files older than 5 days are deleted on server startup
- **Gitignored**: Cache directory should be excluded from version control

### Cache Management

The cache is managed automatically:
- **On startup**: Old files (>5 days) are removed
- **On download**: Existing cached files are returned immediately
- **Cache cleanup logs**: Printed to stderr on startup

## Environment Variables

Create a `.env` file in the **parent directory** of this MCP server:

```env
GOOGLE_SERVICE_ACCOUNT_KEY=/path/to/service-account-key.json
```

The service account must have read access to the Drive files/folders you want to access.

### Setting Up Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > Service Account**
5. Download the JSON key file
6. Enable **Google Drive API** and **Google Sheets API**
7. Share folders/files with the service account email (found in JSON as `client_email`)

## Installation

```bash
npm install
```

## Configuration

### Option 1: Claude Desktop Global Config

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-gdrive/index.ts"]
    }
  }
}
```

### Option 2: Project-Local Config (Recommended)

Create `.claude/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npm",
      "args": ["start"],
      "cwd": "mcp-gdrive"
    }
  }
}
```

Or with absolute path:

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": ["tsx", "mcp-gdrive/index.ts"]
    }
  }
}
```

## Running Manually

```bash
cd mcp-gdrive
npm install
npm start
```

The server uses stdio transport and communicates via standard input/output.

## Project Structure

```
mcp-gdrive/
├── index.ts              # MCP server entry point
├── auth.ts               # Google service account authentication
├── cache.ts              # PDF caching utilities
├── package.json          # Dependencies and scripts
├── README.md             # This file
└── tools/
    ├── index.ts          # Tool registry
    ├── types.ts          # TypeScript type definitions
    ├── gdrive_search.ts
    ├── gdrive_list_folder.ts
    ├── gdrive_read_file.ts
    ├── gdrive_get_pdf.ts # PDF download with caching
    └── gsheets_read.ts
```

## Shared Drives Support

All API calls include proper Shared Drives support:
- `supportsAllDrives: true`
- `includeItemsFromAllDrives: true`

This ensures the server works seamlessly with both My Drive and Shared Drives.

## Read-Only Scopes

The server uses these OAuth scopes:
- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/spreadsheets.readonly`

This ensures the server cannot modify or delete any files.

## Security Notes

- ⚠️ **Never commit** the service account key file
- The `.env` file should be in `.gitignore`
- Service account email should have minimal necessary permissions
- This server is **read-only** and cannot modify Drive files

## Gitignore Configuration

Add to your project's root `.gitignore`:

```gitignore
# MCP Google Drive cache
.cache/

# Environment variables
.env
```

## Error Handling

All tools return structured responses:

```typescript
{
  content: [{ type: 'text', text: 'Response message' }],
  isError: boolean
}
```

Common errors:
- `404`: File not found or no access
- `403`: Insufficient permissions
- `400`: Invalid file ID or parameters
- `Export limit exceeded`: File larger than 10MB for PDF export

## Troubleshooting

### "Failed to initialize Google APIs"

- Verify `GOOGLE_SERVICE_ACCOUNT_KEY` path in `.env`
- Check that the JSON key file is valid
- Ensure APIs are enabled in Google Cloud Console

### "File not found" or "403 Forbidden"

- Verify the service account has access to the file/folder
- Share the file/folder with the service account email
- Check that Drive API and Sheets API are enabled

### "Cache cleanup failed"

- Verify parent directory is writable
- Check disk space
- Ensure no permission issues with `.cache/` directory

### PDF Cache Not Working

- Check that `../.cache/mcp-gdrive/pdfs/` is writable
- Verify cleanup logs on server startup
- Old files (>5 days) are removed automatically

## Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `googleapis` - Google Drive/Sheets API client
- `dotenv` - Environment variable management
- `tsx` - TypeScript execution for Node.js

## License

MIT

## Portability

This MCP server is designed to be portable:
- Copy the entire `mcp-gdrive/` folder to any project
- Create `.env` in the parent directory with `GOOGLE_SERVICE_ACCOUNT_KEY`
- Configure MCP in `.claude/mcp.json` or Claude Desktop config
- Run `npm install` in the `mcp-gdrive/` folder

No other setup required!
