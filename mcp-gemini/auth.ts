/**
 * Gemini API authentication for MCP server
 * Uses GEMINI_API_KEY env var
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI: GoogleGenerativeAI | null = null;

/**
 * Gets or creates authenticated GoogleGenerativeAI client
 */
export function getGeminiClient(): GoogleGenerativeAI {
  if (genAI) {
    return genAI;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  genAI = new GoogleGenerativeAI(apiKey);
  return genAI;
}

/**
 * Initializes Gemini API client
 */
export function initializeGeminiAPI(): void {
  getGeminiClient();
}
