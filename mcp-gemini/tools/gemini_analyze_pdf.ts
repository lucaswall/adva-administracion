import { getGeminiClient } from '../auth.js';
import { GeminiAnalyzePdfInput, ToolResponse } from './types.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export const schema = {
  name: 'gemini_analyze_pdf',
  description: 'Analyze a PDF file using Gemini API. Send a prompt and PDF file path to get structured output. Useful for testing and optimizing document parsing prompts.',
  inputSchema: {
    type: 'object',
    properties: {
      pdfPath: {
        type: 'string',
        description: 'Absolute path to the PDF file to analyze',
      },
      prompt: {
        type: 'string',
        description: 'The prompt to send to Gemini for document analysis',
      },
      model: {
        type: 'string',
        description: 'Gemini model to use (default: gemini-2.5-flash). Options: gemini-2.5-flash, gemini-1.5-flash, gemini-1.5-pro',
        default: 'gemini-2.5-flash',
      },
    },
    required: ['pdfPath', 'prompt'],
  },
} as const;

export async function analyzePdf(args: GeminiAnalyzePdfInput): Promise<ToolResponse> {
  try {
    // Validate PDF file exists
    if (!existsSync(args.pdfPath)) {
      return {
        content: [{ type: 'text', text: `Error: PDF file not found at path: ${args.pdfPath}` }],
        isError: true,
      };
    }

    // Read PDF file
    const pdfBuffer = await readFile(args.pdfPath);

    // Get Gemini client
    const genAI = getGeminiClient();
    const modelName = args.model || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });

    // Convert buffer to base64
    const base64Data = pdfBuffer.toString('base64');

    // Prepare request with inline PDF data
    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Data,
          mimeType: 'application/pdf',
        },
      },
      args.prompt,
    ]);

    const response = result.response;
    const text = response.text();

    if (!text) {
      return {
        content: [{ type: 'text', text: 'Error: No text returned from Gemini API' }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Analysis completed successfully.\n\nModel: ${modelName}\nPDF: ${args.pdfPath}\n\n=== GEMINI RESPONSE ===\n\n${text}`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error analyzing PDF: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
