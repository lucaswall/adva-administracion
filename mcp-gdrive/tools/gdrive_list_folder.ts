import { google } from 'googleapis';
import { GDriveListFolderInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_list_folder',
  description: 'List files and folders in a Google Drive folder',
  inputSchema: {
    type: 'object',
    properties: {
      folderId: {
        type: 'string',
        description: 'ID of the folder to list contents from',
      },
      pageToken: {
        type: 'string',
        description: 'Token for the next page of results',
      },
      pageSize: {
        type: 'number',
        description: 'Number of results per page (max 100, default 10)',
      },
    },
    required: ['folderId'],
  },
} as const;

export async function listFolder(args: GDriveListFolderInput): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    const res = await drive.files.list({
      q: `'${args.folderId}' in parents and trashed = false`,
      pageSize: Math.min(args.pageSize || 10, 100),
      pageToken: args.pageToken,
      orderBy: 'folder,name',
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const items = res.data.files || [];

    if (items.length === 0) {
      return {
        content: [{ type: 'text', text: 'Folder is empty' }],
        isError: false,
      };
    }

    const folders = items.filter((item) => item.mimeType === 'application/vnd.google-apps.folder');
    const files = items.filter((item) => item.mimeType !== 'application/vnd.google-apps.folder');

    let response = `Found ${items.length} items (${folders.length} folders, ${files.length} files):\n\n`;

    if (folders.length > 0) {
      response += 'FOLDERS:\n';
      folders.forEach((folder) => {
        response += `📁 ${folder.id} ${folder.name}\n`;
      });
      response += '\n';
    }

    if (files.length > 0) {
      response += 'FILES:\n';
      files.forEach((file) => {
        const size = file.size ? ` (${file.size} bytes)` : '';
        response += `📄 ${file.id} ${file.name} (${file.mimeType})${size}\n`;
      });
    }

    if (res.data.nextPageToken) {
      response += `\n\nMore results available. Use pageToken: ${res.data.nextPageToken}`;
    }

    return {
      content: [{ type: 'text', text: response }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error listing folder: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}
