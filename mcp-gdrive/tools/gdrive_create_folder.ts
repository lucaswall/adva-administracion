import { google } from 'googleapis';
import { GDriveCreateFolderInput, ToolResponse } from './types.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const schema = {
  name: 'gdrive_create_folder',
  description:
    'Create a folder in Google Drive under a given parent folder.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the new folder',
      },
      parentFolderId: {
        type: 'string',
        description: 'ID of the parent folder',
      },
    },
    required: ['name', 'parentFolderId'],
  },
} as const;

export async function createFolder(
  args: GDriveCreateFolderInput,
): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    const result = await drive.files.create({
      requestBody: {
        name: args.name,
        mimeType: FOLDER_MIME,
        parents: [args.parentFolderId],
      },
      fields: 'id, name, parents',
      supportsAllDrives: true,
    });

    const newId = result.data.id ?? '(unknown)';
    const newName = result.data.name ?? '(unknown)';

    return {
      content: [
        {
          type: 'text',
          text: `Created folder "${newName}" (${newId}) in ${args.parentFolderId}`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error creating folder: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
