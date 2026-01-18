/**
 * Gemini API client with rate limiting and retry logic
 * Uses native fetch for Node.js environment
 */
import type { Result } from '../types/index.js';
import { GeminiError } from '../types/index.js';
/**
 * Gemini API client with built-in rate limiting
 */
export declare class GeminiClient {
    private apiKey;
    private requestCount;
    private windowStart;
    private readonly rpmLimit;
    private readonly MODEL;
    private readonly ENDPOINT;
    /**
     * Creates a new Gemini client
     *
     * @param apiKey - Gemini API key
     * @param rpmLimit - Requests per minute limit (default: 60)
     */
    constructor(apiKey: string, rpmLimit?: number);
    /**
     * Analyzes a document (PDF or image) using Gemini with automatic retry
     *
     * @param fileBuffer - File buffer to analyze
     * @param mimeType - MIME type of the file (e.g., 'application/pdf', 'image/png')
     * @param prompt - Extraction prompt
     * @param maxRetries - Maximum number of retry attempts (default: 3)
     * @returns API response text or error
     */
    analyzeDocument(fileBuffer: Buffer, mimeType: string, prompt: string, maxRetries?: number): Promise<Result<string, GeminiError>>;
    /**
     * Internal method to perform a single API call attempt
     *
     * @param fileBuffer - File buffer to analyze
     * @param mimeType - MIME type of the file
     * @param prompt - Extraction prompt
     * @returns API response text or error
     */
    private doAnalyzeDocument;
    /**
     * Builds the API request payload
     *
     * @param prompt - Extraction prompt
     * @param base64Data - Base64-encoded file data
     * @param mimeType - MIME type of the file
     * @returns Request payload object
     */
    private buildApiRequest;
    /**
     * Parses the API response
     *
     * @param responseText - Response body text
     * @param statusCode - HTTP status code
     * @returns Extracted text or error
     */
    private parseApiResponse;
    /**
     * Enforces rate limiting
     * Sleeps if needed to stay under limit
     */
    private enforceRateLimit;
    /**
     * Gets current rate limit status
     *
     * @returns Object with request count and time until reset
     */
    getRateLimitStatus(): {
        requestCount: number;
        timeUntilReset: number;
    };
}
