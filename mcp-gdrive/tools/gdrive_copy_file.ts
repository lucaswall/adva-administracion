import { google } from 'googleapis';
import { GDriveCopyFileInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_copy_file',
  description:
    'Copy a file in Google Drive. Optionally set a new name and/or parent folder for the copy.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The ID of the file to copy',
      },
      newName: {
        type: 'string',
        description:
          'Name for the copy. If omitted, keeps the original name.',
      },
      parentFolderId: {
        type: 'string',
        description:
          'Folder ID for the copy. If omitted, copies to the same folder.',
      },
    },
    required: ['fileId'],
  },
} as const;

export async function copyFile(
  args: GDriveCopyFileInput,
): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    const requestBody: { name?: string; parents?: string[] } = {};
    if (args.newName) requestBody.name = args.newName;
    if (args.parentFolderId) requestBody.parents = [args.parentFolderId];

    const result = await drive.files.copy({
      fileId: args.fileId,
      requestBody,
      supportsAllDrives: true,
    });

    const newId = result.data.id ?? '(unknown)';
    const newName = result.data.name ?? '(unknown)';

    return {
      content: [
        {
          type: 'text',
          text: `Copied file → "${newName}" (${newId})`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error copying file: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
