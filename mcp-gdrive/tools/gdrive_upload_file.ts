import { google } from 'googleapis';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { GDriveUploadFileInput, ToolResponse } from './types.js';

/**
 * MIME types inferred from file extension. Streamed uploads need an explicit
 * MIME type — Drive falls back to application/octet-stream otherwise, which
 * disables thumbnails and previews for images.
 */
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
};

function inferMime(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export const schema = {
  name: 'gdrive_upload_file',
  description:
    'Upload a local file from disk to a Google Drive folder. Streamed upload (memory-efficient for files of any size). Returns the new Drive fileId.',
  inputSchema: {
    type: 'object',
    properties: {
      localPath: {
        type: 'string',
        description: 'Absolute path to the file on local disk',
      },
      parentFolderId: {
        type: 'string',
        description: 'ID of the destination Drive folder',
      },
      newName: {
        type: 'string',
        description:
          'Optional override for the filename in Drive. Defaults to the basename of localPath.',
      },
      mimeType: {
        type: 'string',
        description:
          'Optional MIME type override. If omitted, inferred from the file extension (.pdf/.jpg/.png/etc), falling back to application/octet-stream.',
      },
    },
    required: ['localPath', 'parentFolderId'],
  },
} as const;

export async function uploadFile(
  args: GDriveUploadFileInput,
): Promise<ToolResponse> {
  try {
    if (!existsSync(args.localPath)) {
      return {
        content: [{ type: 'text', text: `Error: file not found: ${args.localPath}` }],
        isError: true,
      };
    }
    const stat = statSync(args.localPath);
    if (!stat.isFile()) {
      return {
        content: [{ type: 'text', text: `Error: not a regular file: ${args.localPath}` }],
        isError: true,
      };
    }

    const name = args.newName ?? basename(args.localPath);
    const mimeType = args.mimeType ?? inferMime(name);
    const drive = google.drive('v3');

    const res = await drive.files.create({
      requestBody: {
        name,
        parents: [args.parentFolderId],
        mimeType,
      },
      media: {
        mimeType,
        body: createReadStream(args.localPath),
      },
      fields: 'id, name, size, parents',
      supportsAllDrives: true,
    });

    const id = res.data.id ?? '(unknown)';
    const finalName = res.data.name ?? name;
    const size = res.data.size ?? String(stat.size);
    const parent = (res.data.parents || [])[0] ?? args.parentFolderId;

    return {
      content: [
        {
          type: 'text',
          text: `Uploaded "${finalName}" (${id}) — ${size} bytes — to folder ${parent}`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error uploading file: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
