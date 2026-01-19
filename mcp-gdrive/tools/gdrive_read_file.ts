import { google } from 'googleapis';
import { GDriveReadFileInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_read_file',
  description: 'Read contents of a file from Google Drive. Google Docs export as Markdown, Sheets as CSV.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'ID of the file to read',
      },
    },
    required: ['fileId'],
  },
} as const;

export async function readFile(args: GDriveReadFileInput): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    // Get file metadata
    const file = await drive.files.get({
      fileId: args.fileId,
      fields: 'mimeType,name',
      supportsAllDrives: true,
    });

    const mimeType = file.data.mimeType || '';
    const fileName = file.data.name || args.fileId;

    // Handle Google Workspace files (export)
    if (mimeType.startsWith('application/vnd.google-apps')) {
      let exportMimeType: string;
      switch (mimeType) {
        case 'application/vnd.google-apps.document':
          exportMimeType = 'text/markdown';
          break;
        case 'application/vnd.google-apps.spreadsheet':
          exportMimeType = 'text/csv';
          break;
        case 'application/vnd.google-apps.presentation':
          exportMimeType = 'text/plain';
          break;
        default:
          exportMimeType = 'text/plain';
      }

      const res = await drive.files.export(
        { fileId: args.fileId, mimeType: exportMimeType },
        { responseType: 'text' }
      );

      return {
        content: [{ type: 'text', text: `Contents of ${fileName}:\n\n${res.data}` }],
        isError: false,
      };
    }

    // Handle regular files (download)
    const res = await drive.files.get(
      { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );

    const content = Buffer.from(res.data as ArrayBuffer);
    const isText = mimeType.startsWith('text/') || mimeType === 'application/json';

    const text = isText
      ? content.toString('utf-8')
      : `[Binary file: ${content.length} bytes, base64: ${content.toString('base64').substring(0, 100)}...]`;

    return {
      content: [{ type: 'text', text: `Contents of ${fileName}:\n\n${text}` }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error reading file: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}
