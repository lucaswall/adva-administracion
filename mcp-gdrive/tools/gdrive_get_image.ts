import { google } from 'googleapis';
import { writeFile } from 'fs/promises';
import { GDriveGetImageInput, ToolResponse } from './types.js';
import { ensureCacheDir, getCachedFilePath, generateCacheFilePath } from '../cache.js';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export const schema = {
  name: 'gdrive_get_image',
  description: 'Download an image file from Google Drive and save it to disk. Returns the file path so the Read tool can display the image. Supports JPEG, PNG, GIF, WebP, TIFF, BMP, HEIC, HEIF. Use this when a file has an image/* MIME type (e.g. a photo of a check, a scanned comprobante, a screenshot) — gdrive_get_pdf rejects non-PDFs.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'ID of the image file to download',
      },
    },
    required: ['fileId'],
  },
} as const;

export async function getImage(args: GDriveGetImageInput): Promise<ToolResponse> {
  try {
    await ensureCacheDir();

    const drive = google.drive('v3');

    const file = await drive.files.get({
      fileId: args.fileId,
      fields: 'mimeType,name',
      supportsAllDrives: true,
    });

    const mimeType = file.data.mimeType || '';
    const fileName = file.data.name || args.fileId;

    if (!mimeType.startsWith('image/')) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: File mime type is ${mimeType}, not an image. Use gdrive_get_pdf for PDFs/Google Docs/Sheets/Slides, or gdrive_read_file for text.`,
          },
        ],
        isError: true,
      };
    }

    const extension = MIME_TO_EXT[mimeType] ?? mimeType.split('/')[1] ?? 'bin';

    const cachedPath = await getCachedFilePath(args.fileId, extension);
    if (cachedPath) {
      return {
        content: [
          {
            type: 'text',
            text: `Image file retrieved from cache.\n\nPath: ${cachedPath}\n\nYou can now read this image using the Read tool with the path above.`,
          },
        ],
        isError: false,
      };
    }

    const res = await drive.files.get(
      { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );

    const content = Buffer.from(res.data as ArrayBuffer);
    const sizeKB = (content.length / 1024).toFixed(2);
    const cacheFilePath = generateCacheFilePath(args.fileId, fileName, extension);

    await writeFile(cacheFilePath, content);

    return {
      content: [
        {
          type: 'text',
          text: `Image file downloaded and cached successfully.\n\nFile: ${fileName}\nMime: ${mimeType}\nSize: ${sizeKB} KB\nPath: ${cacheFilePath}\n\nYou can now read this image using the Read tool with the path above. This file will be cached for 5 days.`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting image: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}
