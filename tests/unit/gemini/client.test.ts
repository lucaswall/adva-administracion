/**
 * Unit tests for Gemini API client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiClient } from '../../../src/gemini/client.js';
import { GeminiError } from '../../../src/types/index.js';

describe('GeminiClient', () => {
  let client: GeminiClient;
  const mockApiKey = 'test-api-key-12345';

  beforeEach(() => {
    client = new GeminiClient(mockApiKey, 60);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates client with default RPM limit', () => {
      const defaultClient = new GeminiClient(mockApiKey);
      expect(defaultClient).toBeDefined();
    });

    it('creates client with custom RPM limit', () => {
      const customClient = new GeminiClient(mockApiKey, 120);
      expect(customClient).toBeDefined();
    });
  });

  describe('analyzeDocument', () => {
    const mockBuffer = Buffer.from('test-pdf-content');
    const mockMimeType = 'application/pdf';
    const mockPrompt = 'Extract data from this document';

    it('returns success result for valid API response', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Extracted data' }]
          }
        }]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Extracted data');
      }
    });

    it('returns error for non-200 status code', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request'
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(GeminiError);
        expect(result.error.message).toContain('400');
      }
    });

    it('returns error for malformed JSON response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'not valid json'
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('parse');
      }
    });

    it('returns error when API response contains error field', async () => {
      const mockErrorResponse = {
        error: {
          message: 'Invalid API key',
          code: 401
        }
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockErrorResponse)
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Invalid API key');
      }
    });

    it('returns error when response has no text content', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: []
          }
        }]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No text');
      }
    });

    it('returns error when response has no candidates', async () => {
      const mockResponse = {
        candidates: []
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No text');
      }
    });

    it('handles fetch network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Network error');
      }
    });

    it('handles non-Error exceptions', async () => {
      global.fetch = vi.fn().mockRejectedValue('String error');

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(GeminiError);
      }
    });
  });

  describe('retry logic', () => {
    const mockBuffer = Buffer.from('test-pdf-content');
    const mockMimeType = 'application/pdf';
    const mockPrompt = 'Extract data';

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries on retryable errors (500)', async () => {
      const successResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success after retry' }]
          }
        }]
      };

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error'
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(successResponse)
        };
      });

      const promise = client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        3
      );

      // Advance timers to skip the retry delay
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.ok).toBe(true);
      expect(callCount).toBe(2);
    });

    it('does not retry on permanent errors (400)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request'
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        3
      );

      expect(result.ok).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry on quota exceeded (429)', async () => {
      const mockErrorResponse = {
        error: {
          message: 'Quota exceeded',
          code: 429
        }
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockErrorResponse)
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        3
      );

      expect(result.ok).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('returns last error after all retries exhausted', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable'
      });

      const promise = client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        3
      );

      // Advance timers to skip all retry delays
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.ok).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('makes at least one attempt even with maxRetries=0', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        0
      );

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate limiting', () => {
    const mockBuffer = Buffer.from('test');
    const mockMimeType = 'application/pdf';
    const mockPrompt = 'Extract';

    it('allows requests under the limit', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      const limitedClient = new GeminiClient(mockApiKey, 5);

      // Make 5 requests (under limit)
      for (let i = 0; i < 5; i++) {
        const result = await limitedClient.analyzeDocument(
          mockBuffer,
          mockMimeType,
          mockPrompt,
          1
        );
        expect(result.ok).toBe(true);
      }

      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it('enforces rate limit correctly', async () => {
      const limitedClient = new GeminiClient(mockApiKey, 2);

      const status = limitedClient.getRateLimitStatus();
      expect(status.requestCount).toBe(0);
      expect(status.timeUntilReset).toBeGreaterThan(0);
    });
  });

  describe('getRateLimitStatus', () => {
    it('returns current rate limit status', () => {
      const status = client.getRateLimitStatus();

      expect(status).toHaveProperty('requestCount');
      expect(status).toHaveProperty('timeUntilReset');
      expect(typeof status.requestCount).toBe('number');
      expect(typeof status.timeUntilReset).toBe('number');
    });

    it('shows zero requests initially', () => {
      const freshClient = new GeminiClient(mockApiKey);
      const status = freshClient.getRateLimitStatus();

      expect(status.requestCount).toBe(0);
    });
  });

  describe('API request building', () => {
    const mockBuffer = Buffer.from('test-content');
    const mockMimeType = 'application/pdf';
    const mockPrompt = 'Extract data';

    it('sends correct request format', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      await client.analyzeDocument(mockBuffer, mockMimeType, mockPrompt, 1);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-goog-api-key': mockApiKey
          })
        })
      );
    });

    it('includes base64-encoded file data in request', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      let requestBody: string = '';
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        requestBody = options?.body as string;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockResponse)
        };
      });

      await client.analyzeDocument(mockBuffer, mockMimeType, mockPrompt, 1);

      const parsedBody = JSON.parse(requestBody);
      expect(parsedBody.contents[0].parts[1].inline_data.data).toBe(
        mockBuffer.toString('base64')
      );
      expect(parsedBody.contents[0].parts[1].inline_data.mime_type).toBe(mockMimeType);
    });

    it('includes prompt in request', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      let requestBody: string = '';
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        requestBody = options?.body as string;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockResponse)
        };
      });

      await client.analyzeDocument(mockBuffer, mockMimeType, mockPrompt, 1);

      const parsedBody = JSON.parse(requestBody);
      expect(parsedBody.contents[0].parts[0].text).toBe(mockPrompt);
    });

    it('includes generation config in request', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      let requestBody: string = '';
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        requestBody = options?.body as string;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockResponse)
        };
      });

      await client.analyzeDocument(mockBuffer, mockMimeType, mockPrompt, 1);

      const parsedBody = JSON.parse(requestBody);
      expect(parsedBody.generationConfig).toEqual({
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 2048
      });
    });
  });
});
