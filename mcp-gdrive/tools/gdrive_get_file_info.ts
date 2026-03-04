import { google } from 'googleapis';
import { GDriveGetFileInfoInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_get_file_info',
  description:
    'Get file metadata by ID: name, MIME type, parent folder IDs, size, created/modified dates, and web link. Does not read file content.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The ID of the file to get info for',
      },
    },
    required: ['fileId'],
  },
} as const;

export async function getFileInfo(
  args: GDriveGetFileInfoInput,
): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    const result = await drive.files.get({
      fileId: args.fileId,
      fields:
        'id,name,mimeType,parents,size,createdTime,modifiedTime,webViewLink,trashed',
      supportsAllDrives: true,
    });

    return {
      content: [
        { type: 'text', text: JSON.stringify(result.data, null, 2) },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting file info: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
