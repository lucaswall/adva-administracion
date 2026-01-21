/**
 * Gemini API client with rate limiting and retry logic
 * Uses native fetch for Node.js environment
 */

import type { GeminiResponse, GeminiUsageMetadata, Result } from '../types/index.js';
import { GeminiError } from '../types/index.js';
import { classifyError } from './errors.js';
import { debug, warn, error as logError } from '../utils/logger.js';

/**
 * Usage callback data structure
 */
export interface UsageCallbackData {
  /** Whether the request succeeded */
  success: boolean;
  /** Model used */
  model: 'gemini-2.5-flash';
  /** Number of prompt tokens */
  promptTokens: number;
  /** Number of output tokens */
  outputTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Request duration in milliseconds */
  durationMs: number;
  /** File ID being processed */
  fileId: string;
  /** File name being processed */
  fileName: string;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Optional callback for tracking token usage
 */
export type UsageCallback = (data: UsageCallbackData) => void;

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
  private readonly usageCallback?: UsageCallback;

  /**
   * Creates a new Gemini client
   *
   * @param apiKey - Gemini API key
   * @param rpmLimit - Requests per minute limit (default: 60)
   * @param usageCallback - Optional callback for tracking token usage
   */
  constructor(apiKey: string, rpmLimit: number = 60, usageCallback?: UsageCallback) {
    this.apiKey = apiKey;
    this.rpmLimit = rpmLimit;
    this.usageCallback = usageCallback;
    this.ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent`;
  }

  /**
   * Analyzes a document (PDF or image) using Gemini with automatic retry
   *
   * @param fileBuffer - File buffer to analyze
   * @param mimeType - MIME type of the file (e.g., 'application/pdf', 'image/png')
   * @param prompt - Extraction prompt
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @param fileId - Optional Drive file ID for usage tracking
   * @param fileName - Optional file name for usage tracking
   * @returns API response text or error
   */
  async analyzeDocument(
    fileBuffer: Buffer,
    mimeType: string,
    prompt: string,
    maxRetries: number = 3,
    fileId: string = '',
    fileName: string = ''
  ): Promise<Result<string, GeminiError>> {
    // Ensure at least one attempt
    const attempts = Math.max(1, maxRetries);
    let lastResult: Result<string, GeminiError> = {
      ok: false,
      error: new GeminiError('No attempts made', 500)
    };

    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Attempt the API call
      lastResult = await this.doAnalyzeDocument(fileBuffer, mimeType, prompt, fileId, fileName);

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
        warn('Rate limit enforced, sleeping', {
          module: 'gemini-client',
          phase: 'rate-limit',
          sleepMs: delay,
          attempt: attempt
        });
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
   * @param fileId - Drive file ID for usage tracking
   * @param fileName - File name for usage tracking
   * @returns API response text or error
   */
  private async doAnalyzeDocument(
    fileBuffer: Buffer,
    mimeType: string,
    prompt: string,
    fileId: string,
    fileName: string
  ): Promise<Result<string, GeminiError>> {
    const startTime = Date.now();
    let usageMetadata: GeminiUsageMetadata | undefined;

    try {
      await this.enforceRateLimit();

      const base64Data = fileBuffer.toString('base64');

      if (!mimeType) {
        const error = new GeminiError('Unable to determine file MIME type', 400);
        this.callUsageCallback(false, usageMetadata, Date.now() - startTime, fileId, fileName, error.message);
        return { ok: false, error };
      }

      const payload = this.buildApiRequest(prompt, base64Data, mimeType);

      debug('Gemini API request', {
        module: 'gemini-client',
        phase: 'api-call',
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 200) + '...'
      });

      const response = await fetch(this.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      const parseResult = this.parseApiResponse(responseText, response.status);

      // Extract usage metadata from parse result
      if (parseResult.ok && 'usageMetadata' in parseResult) {
        usageMetadata = (parseResult as any).usageMetadata;
      }

      const duration = Date.now() - startTime;

      if (parseResult.ok) {
        debug('Gemini API response', {
          module: 'gemini-client',
          phase: 'api-call',
          responseLength: parseResult.value.length,
          responsePreview: parseResult.value.substring(0, 500) + '...'
        });
        this.requestCount++;
        this.callUsageCallback(true, usageMetadata, duration, fileId, fileName);
        return { ok: true, value: parseResult.value };
      } else {
        this.callUsageCallback(false, usageMetadata, duration, fileId, fileName, parseResult.error.message);
        return parseResult;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      const duration = Date.now() - startTime;

      logError('Gemini API error', {
        module: 'gemini-client',
        phase: 'api-call',
        error: err.message,
        details: error
      });

      this.callUsageCallback(false, usageMetadata, duration, fileId, fileName, err.message);

      return {
        ok: false,
        error: new GeminiError(
          err.message,
          undefined,
          error
        )
      };
    }
  }

  /**
   * Calls the usage callback if provided
   */
  private callUsageCallback(
    success: boolean,
    usageMetadata: GeminiUsageMetadata | undefined,
    durationMs: number,
    fileId: string,
    fileName: string,
    errorMessage?: string
  ): void {
    if (!this.usageCallback) return;

    this.usageCallback({
      success,
      model: this.MODEL,
      promptTokens: usageMetadata?.promptTokenCount || 0,
      outputTokens: usageMetadata?.candidatesTokenCount || 0,
      totalTokens: usageMetadata?.totalTokenCount || 0,
      durationMs,
      fileId,
      fileName,
      errorMessage,
    });
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
        maxOutputTokens: 8192 // Increased from 2048 to prevent truncation of verbose responses
      }
    };
  }

  /**
   * Parses the API response
   *
   * @param responseText - Response body text
   * @param statusCode - HTTP status code
   * @returns Extracted text with usage metadata or error
   */
  private parseApiResponse(
    responseText: string,
    statusCode: number
  ): Result<string, GeminiError> & { usageMetadata?: GeminiUsageMetadata } {
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
      value: text,
      usageMetadata: parsedResponse.usageMetadata
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
