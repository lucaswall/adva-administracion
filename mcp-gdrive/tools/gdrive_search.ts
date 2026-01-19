import { google } from 'googleapis';
import { GDriveSearchInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_search',
  description: 'Search for files in Google Drive',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (searches file names)',
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
    required: ['query'],
  },
} as const;

export async function search(args: GDriveSearchInput): Promise<ToolResponse> {
  try {
    const drive = google.drive('v3');
    const userQuery = args.query.trim();
    let searchQuery = '';

    if (!userQuery) {
      searchQuery = 'trashed = false';
    } else {
      const escapedQuery = userQuery.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const conditions = [`name contains '${escapedQuery}'`];

      if (userQuery.toLowerCase().includes('sheet')) {
        conditions.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
      }

      searchQuery = `(${conditions.join(' or ')}) and trashed = false`;
    }

    const res = await drive.files.list({
      q: searchQuery,
      pageSize: Math.min(args.pageSize || 10, 100),
      pageToken: args.pageToken,
      orderBy: 'modifiedTime desc',
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = res.data.files || [];
    const fileList = files
      .map((file) => `${file.id} ${file.name} (${file.mimeType})`)
      .join('\n');

    let response = `Found ${files.length} files:\n${fileList}`;

    if (res.data.nextPageToken) {
      response += `\n\nMore results available. Use pageToken: ${res.data.nextPageToken}`;
    }

    return {
      content: [{ type: 'text', text: response }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error searching: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}
