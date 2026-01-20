/**
 * Gemini API client with rate limiting and retry logic
 * Uses native fetch for Node.js environment
 */

import type { GeminiResponse, Result } from '../types/index.js';
import { GeminiError } from '../types/index.js';
import { classifyError } from './errors.js';

/**
 * Sleeps for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gemini API client with built-in rate limiting
 */
export class GeminiClient {
  private apiKey: string;
  private requestCount: number = 0;
  private windowStart: number = Date.now();
  private readonly rpmLimit: number;
  private readonly MODEL = 'gemini-2.5-flash';
  private readonly ENDPOINT: string;

  /**
   * Creates a new Gemini client
   *
   * @param apiKey - Gemini API key
   * @param rpmLimit - Requests per minute limit (default: 60)
   */
  constructor(apiKey: string, rpmLimit: number = 60) {
    this.apiKey = apiKey;
    this.rpmLimit = rpmLimit;
    this.ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent`;
  }

  /**
   * Analyzes a document (PDF or image) using Gemini with automatic retry
   *
   * @param fileBuffer - File buffer to analyze
   * @param mimeType - MIME type of the file (e.g., 'application/pdf', 'image/png')
   * @param prompt - Extraction prompt
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @returns API response text or error
   */
  async analyzeDocument(
    fileBuffer: Buffer,
    mimeType: string,
    prompt: string,
    maxRetries: number = 3
  ): Promise<Result<string, GeminiError>> {
    // Ensure at least one attempt
    const attempts = Math.max(1, maxRetries);
    let lastResult: Result<string, GeminiError> = {
      ok: false,
      error: new GeminiError('No attempts made', 500)
    };

    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Attempt the API call
      lastResult = await this.doAnalyzeDocument(fileBuffer, mimeType, prompt);

      // If successful, return immediately
      if (lastResult.ok) {
        return lastResult;
      }

      // Classify the error to determine if we should retry
      const category = classifyError(lastResult.error);

      // Don't retry permanent or quota exceeded errors
      if (category !== 'retryable') {
        return lastResult;
      }

      // If we have more attempts, sleep with exponential backoff
      if (attempt < attempts) {
        // Exponential backoff: 2^attempt * 1000ms, capped at 30s
        const delay = Math.min(Math.pow(2, attempt) * 1000, 30000);
        await sleep(delay);
      }
    }

    // Return the last error after all retries exhausted
    return lastResult;
  }

  /**
   * Internal method to perform a single API call attempt
   *
   * @param fileBuffer - File buffer to analyze
   * @param mimeType - MIME type of the file
   * @param prompt - Extraction prompt
   * @returns API response text or error
   */
  private async doAnalyzeDocument(
    fileBuffer: Buffer,
    mimeType: string,
    prompt: string
  ): Promise<Result<string, GeminiError>> {
    try {
      await this.enforceRateLimit();

      const base64Data = fileBuffer.toString('base64');

      if (!mimeType) {
        return {
          ok: false,
          error: new GeminiError('Unable to determine file MIME type', 400)
        };
      }

      const payload = this.buildApiRequest(prompt, base64Data, mimeType);

      const response = await fetch(this.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      const result = this.parseApiResponse(responseText, response.status);

      if (result.ok) {
        this.requestCount++;
      }

      return result;
    } catch (error) {
      return {
        ok: false,
        error: new GeminiError(
          error instanceof Error ? error.message : 'Unknown error',
          undefined,
          error
        )
      };
    }
  }

  /**
   * Builds the API request payload
   *
   * @param prompt - Extraction prompt
   * @param base64Data - Base64-encoded file data
   * @param mimeType - MIME type of the file
   * @returns Request payload object
   */
  private buildApiRequest(prompt: string, base64Data: string, mimeType: string) {
    return {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1, // Low temperature for factual extraction
        topP: 0.8,
        maxOutputTokens: 2048
      }
    };
  }

  /**
   * Parses the API response
   *
   * @param responseText - Response body text
   * @param statusCode - HTTP status code
   * @returns Extracted text or error
   */
  private parseApiResponse(
    responseText: string,
    statusCode: number
  ): Result<string, GeminiError> {
    if (statusCode !== 200) {
      return {
        ok: false,
        error: new GeminiError(
          `API returned status ${statusCode}`,
          statusCode,
          responseText
        )
      };
    }

    let parsedResponse: GeminiResponse;
    try {
      parsedResponse = JSON.parse(responseText) as GeminiResponse;
    } catch (parseError) {
      return {
        ok: false,
        error: new GeminiError(
          'Failed to parse API response as JSON',
          undefined,
          responseText
        )
      };
    }

    if (parsedResponse.error) {
      return {
        ok: false,
        error: new GeminiError(
          parsedResponse.error.message,
          parsedResponse.error.code,
          parsedResponse.error
        )
      };
    }

    const candidate = parsedResponse.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      return {
        ok: false,
        error: new GeminiError('No text in API response', undefined, parsedResponse)
      };
    }

    return {
      ok: true,
      value: text
    };
  }

  /**
   * Enforces rate limiting
   * Sleeps if needed to stay under limit
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.windowStart;

    // Reset counter if window has passed (1 minute)
    if (elapsed >= 60000) {
      this.requestCount = 0;
      this.windowStart = now;
      return;
    }

    // If at limit, sleep until window resets
    if (this.requestCount >= this.rpmLimit) {
      const sleepTime = 60000 - elapsed;
      if (sleepTime > 0) {
        await sleep(sleepTime);
        // Reset after sleeping
        this.requestCount = 0;
        this.windowStart = Date.now();
      }
    }
  }

  /**
   * Gets current rate limit status
   *
   * @returns Object with request count and time until reset
   */
  getRateLimitStatus(): { requestCount: number; timeUntilReset: number } {
    const now = Date.now();
    const elapsed = now - this.windowStart;
    const timeUntilReset = Math.max(0, 60000 - elapsed);

    return {
      requestCount: this.requestCount,
      timeUntilReset
    };
  }
}
