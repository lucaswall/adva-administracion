/**
 * Unit tests for Gemini error classification
 * TDD: Write tests first for error handling logic
 */

import { describe, it, expect } from 'vitest';
import { classifyError } from '../../../src/gemini/errors';
import { GeminiError } from '../../../src/types/index';

describe('classifyError', () => {
  describe('Quota Exceeded Errors (429 with quota message)', () => {
    it('classifies 429 with "quota" in message as quota_exceeded', () => {
      const error = new GeminiError(
        'You exceeded your current quota, please check your plan and billing details',
        429,
        { error: { message: 'quota exceeded' } }
      );

      const category = classifyError(error);
      expect(category).toBe('quota_exceeded');
    });

    it('classifies 429 with "Quota" (capitalized) as quota_exceeded', () => {
      const error = new GeminiError(
        'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests',
        429
      );

      const category = classifyError(error);
      expect(category).toBe('quota_exceeded');
    });

    it('classifies 429 with "QUOTA" (uppercase) as quota_exceeded', () => {
      const error = new GeminiError(
        'QUOTA EXCEEDED',
        429
      );

      const category = classifyError(error);
      expect(category).toBe('quota_exceeded');
    });
  });

  describe('Retryable Rate Limit Errors (429 without quota)', () => {
    it('classifies 429 without quota message as retryable', () => {
      const error = new GeminiError(
        'Rate limit exceeded',
        429
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });

    it('classifies 429 with "rate" in message as retryable', () => {
      const error = new GeminiError(
        'Too many requests, rate limit hit',
        429
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });

    it('classifies 429 with empty message as retryable', () => {
      const error = new GeminiError('', 429);

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });
  });

  describe('Request Timeout (408)', () => {
    it('classifies 408 Request Timeout as retryable', () => {
      const error = new GeminiError(
        'Request Timeout',
        408
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });
  });

  describe('Server Errors (5xx)', () => {
    it('classifies 500 Internal Server Error as retryable', () => {
      const error = new GeminiError(
        'Internal Server Error',
        500
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });

    it('classifies 502 Bad Gateway as retryable', () => {
      const error = new GeminiError(
        'Bad Gateway',
        502
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });

    it('classifies 503 Service Unavailable as retryable', () => {
      const error = new GeminiError(
        'Service Unavailable',
        503
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });

    it('classifies 504 Gateway Timeout as retryable', () => {
      const error = new GeminiError(
        'Gateway Timeout',
        504
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });
  });

  describe('Network Errors (no status code)', () => {
    it('classifies error without status code as retryable', () => {
      const error = new GeminiError(
        'Network connection failed',
        undefined
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });

    it('classifies error with null code as retryable', () => {
      const error = new GeminiError('Connection timeout');
      error.code = undefined;

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });
  });

  describe('Permanent Errors (4xx except 429)', () => {
    it('classifies 400 Bad Request as permanent', () => {
      const error = new GeminiError(
        'Bad Request: Invalid parameters',
        400
      );

      const category = classifyError(error);
      expect(category).toBe('permanent');
    });

    it('classifies 401 Unauthorized as permanent', () => {
      const error = new GeminiError(
        'Unauthorized: Invalid API key',
        401
      );

      const category = classifyError(error);
      expect(category).toBe('permanent');
    });

    it('classifies 403 Forbidden as permanent', () => {
      const error = new GeminiError(
        'Forbidden: Access denied',
        403
      );

      const category = classifyError(error);
      expect(category).toBe('permanent');
    });

    it('classifies 404 Not Found as permanent', () => {
      const error = new GeminiError(
        'Not Found: Model does not exist',
        404
      );

      const category = classifyError(error);
      expect(category).toBe('permanent');
    });

    it('classifies 422 Unprocessable Entity as permanent', () => {
      const error = new GeminiError(
        'Unprocessable Entity: Invalid content',
        422
      );

      const category = classifyError(error);
      expect(category).toBe('permanent');
    });
  });

  describe('Edge Cases', () => {
    it('handles error with quota in details but different status code', () => {
      const error = new GeminiError(
        'Server error',
        500,
        { quotaExceeded: true }
      );

      const category = classifyError(error);
      expect(category).toBe('retryable'); // 500 takes precedence over details
    });

    it('handles error with very long message containing quota', () => {
      const longMessage = 'A'.repeat(1000) + ' quota exceeded ' + 'B'.repeat(1000);
      const error = new GeminiError(longMessage, 429);

      const category = classifyError(error);
      expect(category).toBe('quota_exceeded');
    });

    it('handles error with null message', () => {
      const error = new GeminiError(null as any, 429);

      const category = classifyError(error);
      expect(category).toBe('retryable'); // No quota in message, defaults to retryable
    });

    it('handles error with undefined message', () => {
      const error = new GeminiError(undefined as any, 403);

      const category = classifyError(error);
      expect(category).toBe('permanent');
    });

    it('is case-insensitive for quota detection', () => {
      const error = new GeminiError('QuOtA ExCeEdEd', 429);

      const category = classifyError(error);
      expect(category).toBe('quota_exceeded');
    });

    it('handles 0 as status code', () => {
      const error = new GeminiError('Unknown error', 0);

      const category = classifyError(error);
      expect(category).toBe('permanent'); // Not a recognized retryable code
    });
  });

  describe('Real-World Error Scenarios', () => {
    it('classifies actual Gemini daily quota error', () => {
      const error = new GeminiError(
        'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash-lite\nPlease retry in 50.604409371s.',
        429,
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          "violations": [{
            "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            "quotaValue": "20"
          }]
        }
      );

      const category = classifyError(error);
      expect(category).toBe('quota_exceeded');
    });

    it('classifies per-minute rate limit error', () => {
      const error = new GeminiError(
        'Resource has been exhausted (e.g. check rate limits)',
        429
      );

      const category = classifyError(error);
      expect(category).toBe('retryable');
    });

    it('classifies authentication error', () => {
      const error = new GeminiError(
        'API key not valid. Please pass a valid API key.',
        403
      );

      const category = classifyError(error);
      expect(category).toBe('permanent');
    });
  });
});
