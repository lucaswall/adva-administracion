import { google } from 'googleapis';
import { writeFile } from 'fs/promises';
import { GDriveGetPdfInput, ToolResponse } from './types.js';
import { ensureCacheDir, getCachedFilePath, generateCacheFilePath } from '../cache.js';

export const schema = {
  name: 'gdrive_get_pdf',
  description: 'Get a file as PDF and save it to disk. Downloads PDFs directly or exports Google Docs/Sheets/Slides to PDF. Returns the file path for the agent to read using the Read tool.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'ID of the file to get as PDF',
      },
    },
    required: ['fileId'],
  },
} as const;

export async function getPdf(args: GDriveGetPdfInput): Promise<ToolResponse> {
  try {
    // Ensure cache directory exists
    await ensureCacheDir();

    // Check if file is already cached
    const cachedPath = await getCachedFilePath(args.fileId);
    if (cachedPath) {
      return {
        content: [
          {
            type: 'text',
            text: `PDF file retrieved from cache.\n\nPath: ${cachedPath}\n\nYou can now read this PDF using the Read tool with the path above.`,
          },
        ],
        isError: false,
      };
    }

    const drive = google.drive('v3');

    // Get file metadata
    const file = await drive.files.get({
      fileId: args.fileId,
      fields: 'mimeType,name',
      supportsAllDrives: true,
    });

    const mimeType = file.data.mimeType || '';
    const fileName = file.data.name || args.fileId;

    let pdfContent: Buffer;

    // Check if it's a Google Workspace file that needs export
    if (mimeType.startsWith('application/vnd.google-apps')) {
      // Export as PDF (10MB limit)
      const res = await drive.files.export(
        { fileId: args.fileId, mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' }
      );

      pdfContent = Buffer.from(res.data as ArrayBuffer);
    } else if (mimeType === 'application/pdf') {
      // Download existing PDF
      const res = await drive.files.get(
        { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
      );

      pdfContent = Buffer.from(res.data as ArrayBuffer);
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Error: Cannot convert file type ${mimeType} to PDF. Only Google Docs, Sheets, Slides, and existing PDFs are supported.`,
          },
        ],
        isError: true,
      };
    }

    // Save PDF to persistent cache directory
    const sizeKB = (pdfContent.length / 1024).toFixed(2);
    const cacheFilePath = generateCacheFilePath(args.fileId, fileName);

    // Write PDF to disk
    await writeFile(cacheFilePath, pdfContent);

    return {
      content: [
        {
          type: 'text',
          text: `PDF file downloaded and cached successfully.\n\nFile: ${fileName}\nSize: ${sizeKB} KB\nPath: ${cacheFilePath}\n\nYou can now read this PDF using the Read tool with the path above. This file will be cached for ${5} days.`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting PDF: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}
