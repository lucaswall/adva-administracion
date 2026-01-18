/**
 * Gemini API Error Classification
 *
 * Classifies Gemini API errors into categories for appropriate retry handling:
 * - retryable: Temporary errors that should be retried (429 rate limit, 5xx)
 * - quota_exceeded: Daily quota exceeded (429 with quota message)
 * - permanent: Errors that won't be fixed by retrying (4xx except 429)
 */
import type { GeminiError } from '../types/index.js';
/**
 * Error categories for handling different types of failures
 */
export type ErrorCategory = 'retryable' | 'permanent' | 'quota_exceeded';
/**
 * Classifies a Gemini API error based on status code and message
 *
 * @param error - The GeminiError to classify
 * @returns The error category determining retry behavior
 */
export declare function classifyError(error: GeminiError): ErrorCategory;
