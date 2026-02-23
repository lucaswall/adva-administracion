import { google } from 'googleapis';
import { GDriveRenameFileInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_rename_file',
  description: 'Rename a file in Google Drive.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The ID of the file to rename',
      },
      newName: {
        type: 'string',
        description: 'The new name for the file',
      },
    },
    required: ['fileId', 'newName'],
  },
} as const;

export async function renameFile(
  args: GDriveRenameFileInput,
): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    // Get current name for confirmation
    const current = await drive.files.get({
      fileId: args.fileId,
      fields: 'name',
      supportsAllDrives: true,
    });

    const oldName = current.data.name ?? '(unknown)';

    await drive.files.update({
      fileId: args.fileId,
      requestBody: { name: args.newName },
      supportsAllDrives: true,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Renamed "${oldName}" → "${args.newName}" (${args.fileId})`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error renaming file: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
