import { google } from 'googleapis';
import { GDriveTrashFileInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_trash_file',
  description:
    'Move a file or folder to the Drive trash. Reversible from the Drive UI for 30 days. For folders, all contents move to trash with the folder.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The ID of the file or folder to trash',
      },
    },
    required: ['fileId'],
  },
} as const;

export async function trashFile(
  args: GDriveTrashFileInput,
): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    const current = await drive.files.get({
      fileId: args.fileId,
      fields: 'name, mimeType',
      supportsAllDrives: true,
    });
    const name = current.data.name ?? '(unknown)';

    await drive.files.update({
      fileId: args.fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Trashed "${name}" (${args.fileId})`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error trashing file: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
