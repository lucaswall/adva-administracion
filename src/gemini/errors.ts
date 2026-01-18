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
export function classifyError(error: GeminiError): ErrorCategory {
  const code = error.code;
  const message = error.message?.toLowerCase() || '';
  const details = typeof error.details === 'string' ? error.details.toLowerCase() : '';

  // Daily quota exceeded - special handling (retry on next run)
  // Check for "quota" in message or details to distinguish from per-minute rate limits
  if (code === 429 && (message.includes('quota') || details.includes('quota'))) {
    return 'quota_exceeded';
  }

  // Retryable errors - temporary issues that should be retried
  if (code === 429) return 'retryable';  // Per-minute rate limit
  if (code === 500 || code === 502 || code === 503 || code === 504) {
    return 'retryable';  // Server errors
  }
  if (code === undefined) return 'retryable';  // Network errors

  // Permanent errors - won't be fixed by retrying
  // Includes: 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden),
  //           404 (Not Found), 422 (Unprocessable Entity), etc.
  return 'permanent';
}
