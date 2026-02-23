import { google } from 'googleapis';
import { GDriveMoveFileInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_move_file',
  description:
    'Move a file to a different folder in Google Drive. Gets current parents and replaces them with the new parent folder.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The ID of the file to move',
      },
      newParentFolderId: {
        type: 'string',
        description: 'The ID of the destination folder',
      },
    },
    required: ['fileId', 'newParentFolderId'],
  },
} as const;

export async function moveFile(
  args: GDriveMoveFileInput,
): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    // Get current parents
    const file = await drive.files.get({
      fileId: args.fileId,
      fields: 'id, name, parents',
      supportsAllDrives: true,
    });

    const previousParents = (file.data.parents || []).join(',');

    if (!previousParents) {
      return {
        content: [
          {
            type: 'text',
            text: `Error moving file: cannot determine current parent folder for file ${args.fileId}`,
          },
        ],
        isError: true,
      };
    }

    // Move file to new parent
    const res = await drive.files.update({
      fileId: args.fileId,
      addParents: args.newParentFolderId,
      removeParents: previousParents,
      fields: 'id, name, parents',
      supportsAllDrives: true,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Moved "${res.data.name}" (${res.data.id}) to folder ${args.newParentFolderId}`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error moving file: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
