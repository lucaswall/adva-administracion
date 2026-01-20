import { google } from 'googleapis';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { GDriveGetPdfInput, ToolResponse } from './types.js';

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

    // Save PDF to temporary directory
    const sizeKB = (pdfContent.length / 1024).toFixed(2);
    const tempDir = join(tmpdir(), 'mcp-gdrive-pdfs');

    // Ensure temp directory exists
    await mkdir(tempDir, { recursive: true });

    // Create a safe filename (sanitize the original name)
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    const tempFilePath = join(tempDir, `${timestamp}_${sanitizedFileName}.pdf`);

    // Write PDF to disk
    await writeFile(tempFilePath, pdfContent);

    return {
      content: [
        {
          type: 'text',
          text: `PDF file saved successfully.\n\nFile: ${fileName}\nSize: ${sizeKB} KB\nPath: ${tempFilePath}\n\nYou can now read this PDF using the Read tool with the path above.`,
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
