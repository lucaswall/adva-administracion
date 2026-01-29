/**
 * Unit tests for Gemini API client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiClient } from './client.js';
import { GeminiError } from '../types/index.js';

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

    it('aborts fetch after timeout', async () => {
      vi.useFakeTimers();

      global.fetch = vi.fn().mockImplementation((_url, options) =>
        new Promise((resolve, reject) => {
          const signal = options?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }

          // Simulate long-running request
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'data' }] } }] })
            });
          }, 350000); // 350 seconds, longer than 5 minute timeout
        })
      );

      const promise = client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(300000); // 5 minutes

      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('timeout');
      }

      vi.useRealTimers();
    });

    it('completes successfully when fetch finishes before timeout', async () => {
      vi.useFakeTimers();

      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Extracted data' }]
          }
        }]
      };

      global.fetch = vi.fn().mockImplementation((_url, options) =>
        new Promise((resolve, reject) => {
          const signal = options?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }

          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify(mockResponse)
            });
          }, 1000); // 1 second, well within timeout
        })
      );

      const promise = client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Extracted data');
      }

      vi.useRealTimers();
    });

    it('distinguishes timeout error from network error', async () => {
      vi.useFakeTimers();

      global.fetch = vi.fn().mockImplementation((_url, options) =>
        new Promise((resolve, reject) => {
          const signal = options?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }

          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'data' }] } }] })
            });
          }, 350000); // 350 seconds, longer than 5 minute timeout
        })
      );

      const promise = client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      await vi.advanceTimersByTimeAsync(300000); // 5 minutes

      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('timeout');
        expect(result.error.message).not.toContain('network');
      }

      vi.useRealTimers();
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

    it('handles concurrent requests without exceeding rate limit', async () => {
      vi.useFakeTimers();

      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockResponse)
        };
      });

      const limitedClient = new GeminiClient(mockApiKey, 3);

      // Launch 5 concurrent requests with limit of 3
      const promises = Array.from({ length: 5 }, () =>
        limitedClient.analyzeDocument(mockBuffer, mockMimeType, mockPrompt, 1)
      );

      // Advance timers to allow first batch to complete
      await vi.runAllTimersAsync();

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every(r => r.ok)).toBe(true);

      // Should have made exactly 5 fetch calls
      expect(fetchCount).toBe(5);

      vi.useRealTimers();
    });

    it('concurrent requests at limit all wait properly', async () => {
      vi.useFakeTimers();

      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      const fetchTimes: number[] = [];
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchTimes.push(Date.now());
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockResponse)
        };
      });

      const limitedClient = new GeminiClient(mockApiKey, 2);

      // Launch 4 concurrent requests with limit of 2
      const promises = Array.from({ length: 4 }, () =>
        limitedClient.analyzeDocument(mockBuffer, mockMimeType, mockPrompt, 1)
      );

      await vi.runAllTimersAsync();

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every(r => r.ok)).toBe(true);

      // Should have made exactly 4 fetch calls
      expect(fetchTimes.length).toBe(4);

      // First 2 should be at same time, next 2 should be 60s later
      const firstBatchTime = fetchTimes[0];
      expect(fetchTimes[1]).toBe(firstBatchTime);
      expect(fetchTimes[2]).toBeGreaterThanOrEqual(firstBatchTime + 60000);
      expect(fetchTimes[3]).toBeGreaterThanOrEqual(firstBatchTime + 60000);

      vi.useRealTimers();
    });

    it('verifies correct number of requests within time window', async () => {
      vi.useFakeTimers();

      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockResponse)
        };
      });

      const limitedClient = new GeminiClient(mockApiKey, 3);

      // Launch 6 concurrent requests with limit of 3
      const promises = Array.from({ length: 6 }, () =>
        limitedClient.analyzeDocument(mockBuffer, mockMimeType, mockPrompt, 1)
      );

      await vi.runAllTimersAsync();

      await Promise.all(promises);

      // Should have made exactly 6 fetch calls
      expect(fetchCount).toBe(6);

      // Verify rate limiter state is correct
      const status = limitedClient.getRateLimitStatus();
      // After processing 6 requests in 2 windows (3 per window), count should be 3 (in second window)
      expect(status.requestCount).toBe(3);

      vi.useRealTimers();
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
        maxOutputTokens: 65536,
        responseMimeType: 'application/json'
      });
    });
  });

  describe('usage tracking', () => {
    const mockBuffer = Buffer.from('test-content');
    const mockMimeType = 'application/pdf';
    const mockPrompt = 'Extract data';

    it('accepts usage callback in constructor', () => {
      const callback = vi.fn();
      const clientWithCallback = new GeminiClient(mockApiKey, 60, callback);
      expect(clientWithCallback).toBeDefined();
    });

    it('calls usage callback on successful API call with usage metadata', async () => {
      const callback = vi.fn();
      const clientWithCallback = new GeminiClient(mockApiKey, 60, callback);

      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Extracted data' }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 500,
          totalTokenCount: 1500
        }
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      const result = await clientWithCallback.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(true);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          model: 'gemini-2.5-flash',
          promptTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          durationMs: expect.any(Number),
          fileId: '',
          fileName: ''
        })
      );
    });

    it('calls usage callback on failed API call with zero tokens', async () => {
      const callback = vi.fn();
      const clientWithCallback = new GeminiClient(mockApiKey, 60, callback);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request'
      });

      const result = await clientWithCallback.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(false);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          model: 'gemini-2.5-flash',
          promptTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: expect.any(Number),
          errorMessage: expect.stringContaining('400'),
          fileId: '',
          fileName: ''
        })
      );
    });

    it('calls usage callback with file context when provided', async () => {
      const callback = vi.fn();
      const clientWithCallback = new GeminiClient(mockApiKey, 60, callback);

      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150
        }
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      const result = await clientWithCallback.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1,
        'file-id-123',
        'invoice.pdf'
      );

      expect(result.ok).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'file-id-123',
          fileName: 'invoice.pdf'
        })
      );
    });

    it('handles missing usageMetadata gracefully', async () => {
      const callback = vi.fn();
      const clientWithCallback = new GeminiClient(mockApiKey, 60, callback);

      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
        // usageMetadata missing
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      const result = await clientWithCallback.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          promptTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        })
      );
    });

    it('does not call callback if not provided', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150
        }
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse)
      });

      // No callback provided - should not throw error
      const result = await client.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(true);
    });

    it('tracks request duration accurately', async () => {
      const callback = vi.fn();
      const clientWithCallback = new GeminiClient(mockApiKey, 60, callback);

      const mockResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Success' }]
          }
        }]
      };

      // Simulate slow API response
      global.fetch = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockResponse)
        };
      });

      const result = await clientWithCallback.analyzeDocument(
        mockBuffer,
        mockMimeType,
        mockPrompt,
        1
      );

      expect(result.ok).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: expect.any(Number)
        })
      );

      const callArgs = callback.mock.calls[0][0];
      expect(callArgs.durationMs).toBeGreaterThan(0);
      expect(callArgs.durationMs).toBeLessThan(5000); // Sanity check
    });
  });
});
