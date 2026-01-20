import { schema as geminiAnalyzePdfSchema, analyzePdf } from './gemini_analyze_pdf.js';
import { Tool, GeminiAnalyzePdfInput } from './types.js';

export const tools: [Tool<GeminiAnalyzePdfInput>] = [
  {
    ...geminiAnalyzePdfSchema,
    handler: analyzePdf,
  },
];
