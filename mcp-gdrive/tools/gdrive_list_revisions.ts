import { google } from 'googleapis';
import { GDriveListRevisionsInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_list_revisions',
  description:
    'List the revision history of a Drive file: id, modifiedTime, lastModifyingUser (name + email), size, and keepForever flag. Useful for forensic timelines (who/when changed a file). NOTE: Google Drive\'s revisions API only returns content for binary files (PDFs, images, uploads); for native Google Docs/Sheets/Slides, this lists revision metadata but the actual snapshot content is only viewable through the Docs/Sheets UI Version history.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The ID of the file to list revisions for',
      },
      pageSize: {
        type: 'number',
        description: 'Max revisions per page (1-1000, default 200)',
      },
      pageToken: {
        type: 'string',
        description: 'Token for the next page of results',
      },
    },
    required: ['fileId'],
  },
} as const;

export async function listRevisions(
  args: GDriveListRevisionsInput,
): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');

    const result = await drive.revisions.list({
      fileId: args.fileId,
      pageSize: args.pageSize ?? 200,
      pageToken: args.pageToken,
      fields:
        'nextPageToken,revisions(id,modifiedTime,keepForever,size,mimeType,lastModifyingUser(displayName,emailAddress),exportLinks)',
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
          text: `Error listing revisions: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
