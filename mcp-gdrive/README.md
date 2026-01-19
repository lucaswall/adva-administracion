# MCP Google Drive Server (Service Account)

MCP server for read-only access to Google Drive and Sheets using service account authentication.

## Features

- **Service Account Authentication** - No OAuth browser flow required
- **Shared Drives Support** - Full support for Google Shared Drives
- **Read-Only Access** - Safe for production use with readonly scopes
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

Get a file as PDF. Downloads PDFs directly or exports Google Docs/Sheets/Slides to PDF.

**Input:**
- `fileId` (string, required): ID of the file to get as PDF

**Output:** Base64-encoded PDF content. Note: Google API limits exports to 10MB.

**Example:**
```
fileId: "1x2y3z4a5b6c"
→ Returns PDF as base64-encoded string
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
```

## Environment Variables

This server uses the parent project's `.env` file (automatically loaded from `../`):

```env
GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded-json>
```

The service account must have read access to the Drive files/folders you want to access.

## Claude Code Configuration

**This MCP server is already configured for this project!** 🎉

The MCP server is pre-configured in the project's `.mcp.json` file at the repository root:

```json
{
  "mcpServers": {
    "gdrive": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "mcp-gdrive/index.ts"]
    }
  }
}
```

When you open this project in Claude Code, it automatically discovers the `.mcp.json` file and makes the `gdrive` MCP server available. You'll see an approval prompt the first time you use it - just approve it to enable Google Drive access.

**No manual configuration needed!** The server uses:
- ✅ Relative paths from the project root
- ✅ Automatic `.env` file loading from the parent directory
- ✅ Project-scoped configuration (no global settings to modify)

### For Other Projects

If you want to use this MCP server in a different project, copy the configuration above to that project's `.mcp.json` file (adjusting the path as needed).

## Running Manually

From the repository root:

```bash
cd mcp-gdrive
npm install
npm start
```

## Development

No build process required - TypeScript runs directly via tsx.

```bash
# Install dependencies
npm install

# Run server
npx tsx index.ts
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
