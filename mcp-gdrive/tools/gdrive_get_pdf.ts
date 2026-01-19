import { google } from 'googleapis';
import { GDriveGetPdfInput, ToolResponse } from './types.js';

export const schema = {
  name: 'gdrive_get_pdf',
  description: 'Get a file as PDF. Downloads PDFs directly or exports Google Docs/Sheets/Slides to PDF (10MB limit for exports).',
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

    const base64Pdf = pdfContent.toString('base64');
    const sizeKB = (pdfContent.length / 1024).toFixed(2);

    return {
      content: [
        {
          type: 'text',
          text: `PDF file: ${fileName}\nSize: ${sizeKB} KB\n\nBase64-encoded PDF:\n${base64Pdf}`,
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
