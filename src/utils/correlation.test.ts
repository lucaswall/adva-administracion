/**
 * Tests for correlation context management
 * Covers: context creation, updates, and data retrieval
 */

import { describe, it, expect } from 'vitest';
import {
  generateCorrelationId,
  getCorrelationContext,
  getCorrelationId,
  withCorrelation,
  withCorrelationAsync,
  updateCorrelationContext,
  getCorrelationLogData,
} from './correlation.js';

describe('Correlation Context', () => {
  describe('generateCorrelationId', () => {
    it('should generate unique UUIDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('getCorrelationContext/getCorrelationId', () => {
    it('should return undefined outside of correlation context', () => {
      expect(getCorrelationContext()).toBeUndefined();
      expect(getCorrelationId()).toBeUndefined();
    });
  });

  describe('withCorrelation', () => {
    it('should create context with auto-generated correlation ID', () => {
      let capturedContext: ReturnType<typeof getCorrelationContext>;

      withCorrelation(() => {
        capturedContext = getCorrelationContext();
      });

      expect(capturedContext).toBeDefined();
      expect(capturedContext!.correlationId).toMatch(/^[0-9a-f]{8}-/);
      expect(capturedContext!.startTime).toBeLessThanOrEqual(Date.now());
    });

    it('should use provided correlation ID', () => {
      const customId = 'custom-correlation-id';
      let capturedId: string | undefined;

      withCorrelation(() => {
        capturedId = getCorrelationId();
      }, { correlationId: customId });

      expect(capturedId).toBe(customId);
    });

    it('should include optional fileId and fileName', () => {
      let capturedContext: ReturnType<typeof getCorrelationContext>;

      withCorrelation(() => {
        capturedContext = getCorrelationContext();
      }, { fileId: 'file-123', fileName: 'test.pdf' });

      expect(capturedContext!.fileId).toBe('file-123');
      expect(capturedContext!.fileName).toBe('test.pdf');
    });

    it('should return the function result', () => {
      const result = withCorrelation(() => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });
  });

  describe('withCorrelationAsync', () => {
    it('should maintain context through async operations', async () => {
      const capturedIds: (string | undefined)[] = [];

      await withCorrelationAsync(async () => {
        capturedIds.push(getCorrelationId());
        await new Promise(resolve => setTimeout(resolve, 10));
        capturedIds.push(getCorrelationId());
      });

      expect(capturedIds[0]).toBeDefined();
      expect(capturedIds[0]).toBe(capturedIds[1]);
    });

    it('should isolate contexts between concurrent async operations', async () => {
      const capturedIds: string[] = [];

      await Promise.all([
        withCorrelationAsync(async () => {
          const id = getCorrelationId()!;
          await new Promise(resolve => setTimeout(resolve, 10));
          capturedIds.push(`1:${id}:${getCorrelationId()}`);
        }, { correlationId: 'ctx-1' }),
        withCorrelationAsync(async () => {
          const id = getCorrelationId()!;
          await new Promise(resolve => setTimeout(resolve, 5));
          capturedIds.push(`2:${id}:${getCorrelationId()}`);
        }, { correlationId: 'ctx-2' }),
      ]);

      // Each context should maintain its own correlation ID
      expect(capturedIds).toHaveLength(2);
      expect(capturedIds.find(s => s.startsWith('1:'))).toBe('1:ctx-1:ctx-1');
      expect(capturedIds.find(s => s.startsWith('2:'))).toBe('2:ctx-2:ctx-2');
    });
  });

  describe('updateCorrelationContext', () => {
    it('should update fileId within context', () => {
      let capturedContext: ReturnType<typeof getCorrelationContext>;

      withCorrelation(() => {
        updateCorrelationContext({ fileId: 'updated-file-id' });
        capturedContext = getCorrelationContext();
      });

      expect(capturedContext!.fileId).toBe('updated-file-id');
    });

    it('should update fileName within context', () => {
      let capturedContext: ReturnType<typeof getCorrelationContext>;

      withCorrelation(() => {
        updateCorrelationContext({ fileName: 'updated-name.pdf' });
        capturedContext = getCorrelationContext();
      });

      expect(capturedContext!.fileName).toBe('updated-name.pdf');
    });

    it('should update both fileId and fileName atomically', () => {
      let capturedContext: ReturnType<typeof getCorrelationContext>;

      withCorrelation(() => {
        updateCorrelationContext({ fileId: 'file-123', fileName: 'test.pdf' });
        capturedContext = getCorrelationContext();
      });

      expect(capturedContext!.fileId).toBe('file-123');
      expect(capturedContext!.fileName).toBe('test.pdf');
    });

    it('should not throw when called outside context', () => {
      // Should be a no-op, not throw
      expect(() => {
        updateCorrelationContext({ fileId: 'should-be-ignored' });
      }).not.toThrow();
    });

    it('should preserve correlationId and startTime', () => {
      let originalId: string | undefined;
      let originalStartTime: number | undefined;
      let capturedContext: ReturnType<typeof getCorrelationContext>;

      withCorrelation(() => {
        originalId = getCorrelationId();
        originalStartTime = getCorrelationContext()!.startTime;
        updateCorrelationContext({ fileId: 'new-file-id' });
        capturedContext = getCorrelationContext();
      });

      expect(capturedContext!.correlationId).toBe(originalId);
      expect(capturedContext!.startTime).toBe(originalStartTime);
    });
  });

  describe('getCorrelationLogData', () => {
    it('should return empty object outside context', () => {
      const data = getCorrelationLogData();
      expect(data).toEqual({});
    });

    it('should return correlationId and elapsedMs within context', () => {
      let logData: Record<string, unknown>;

      withCorrelation(() => {
        logData = getCorrelationLogData();
      });

      expect(logData!).toHaveProperty('correlationId');
      expect(logData!).toHaveProperty('elapsedMs');
      expect(typeof logData!.elapsedMs).toBe('number');
    });

    it('should include fileId and fileName when set', () => {
      let logData: Record<string, unknown>;

      withCorrelation(() => {
        updateCorrelationContext({ fileId: 'file-123', fileName: 'test.pdf' });
        logData = getCorrelationLogData();
      });

      expect(logData!.fileId).toBe('file-123');
      expect(logData!.fileName).toBe('test.pdf');
    });

    it('should not include undefined fileId or fileName', () => {
      let logData: Record<string, unknown>;

      withCorrelation(() => {
        logData = getCorrelationLogData();
      });

      expect(logData!).not.toHaveProperty('fileId');
      expect(logData!).not.toHaveProperty('fileName');
    });
  });
});
