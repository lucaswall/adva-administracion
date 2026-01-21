/**
 * Tests for the logger utility
 * Covers: debug, info, warn, error functions, environment-based configuration, and log level filtering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';

// Mock pino before importing logger
vi.mock('pino', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    default: vi.fn(() => mockLogger),
  };
});

// Mock config
vi.mock('../../../src/config.js', () => ({
  getConfig: vi.fn(() => ({
    logLevel: 'INFO',
  })),
}));

describe('Logger', () => {
  let mockPinoInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mock pino instance
    mockPinoInstance = pino();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('debug()', () => {
    it('should log debug message without context', async () => {
      const { debug } = await import('../../../src/utils/logger.js');

      debug('Test debug message');

      expect(mockPinoInstance.debug).toHaveBeenCalledWith('Test debug message');
      expect(mockPinoInstance.debug).toHaveBeenCalledTimes(1);
    });

    it('should log debug message with context', async () => {
      const { debug } = await import('../../../src/utils/logger.js');

      const context = { userId: 123, action: 'test' };
      debug('Test debug message', context);

      expect(mockPinoInstance.debug).toHaveBeenCalledWith(context, 'Test debug message');
      expect(mockPinoInstance.debug).toHaveBeenCalledTimes(1);
    });
  });

  describe('info()', () => {
    it('should log info message without context', async () => {
      const { info } = await import('../../../src/utils/logger.js');

      info('Test info message');

      expect(mockPinoInstance.info).toHaveBeenCalledWith('Test info message');
      expect(mockPinoInstance.info).toHaveBeenCalledTimes(1);
    });

    it('should log info message with context', async () => {
      const { info } = await import('../../../src/utils/logger.js');

      const context = { requestId: 'abc123', method: 'GET' };
      info('Request received', context);

      expect(mockPinoInstance.info).toHaveBeenCalledWith(context, 'Request received');
      expect(mockPinoInstance.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('warn()', () => {
    it('should log warn message without context', async () => {
      const { warn } = await import('../../../src/utils/logger.js');

      warn('Test warning message');

      expect(mockPinoInstance.warn).toHaveBeenCalledWith('Test warning message');
      expect(mockPinoInstance.warn).toHaveBeenCalledTimes(1);
    });

    it('should log warn message with context', async () => {
      const { warn } = await import('../../../src/utils/logger.js');

      const context = { retryCount: 3, maxRetries: 5 };
      warn('Retry attempt failed', context);

      expect(mockPinoInstance.warn).toHaveBeenCalledWith(context, 'Retry attempt failed');
      expect(mockPinoInstance.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('error()', () => {
    it('should log error message without context', async () => {
      const { error } = await import('../../../src/utils/logger.js');

      error('Test error message');

      expect(mockPinoInstance.error).toHaveBeenCalledWith('Test error message');
      expect(mockPinoInstance.error).toHaveBeenCalledTimes(1);
    });

    it('should log error message with context', async () => {
      const { error } = await import('../../../src/utils/logger.js');

      const context = { errorCode: 'ERR_001', stack: 'Error stack trace' };
      error('Database connection failed', context);

      expect(mockPinoInstance.error).toHaveBeenCalledWith(context, 'Database connection failed');
      expect(mockPinoInstance.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('environment-based configuration', () => {
    it('should use pino-pretty transport in development', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      vi.resetModules();
      const { info } = await import('../../../src/utils/logger.js');

      // Trigger logger initialization by calling a logging function
      info('test');

      expect(pino).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            target: 'pino-pretty',
            options: expect.objectContaining({
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            }),
          }),
        })
      );

      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should not use pino-pretty transport in production', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      vi.resetModules();

      // Re-mock config for this test
      vi.doMock('../../../src/config.js', () => ({
        getConfig: vi.fn(() => ({
          logLevel: 'INFO',
        })),
      }));

      const { info } = await import('../../../src/utils/logger.js');

      // Trigger logger initialization by calling a logging function
      info('test');

      expect(pino).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: undefined,
        })
      );

      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe('log level configuration', () => {
    it('should respect logLevel from config', async () => {
      vi.resetModules();

      // Mock config with DEBUG level
      vi.doMock('../../../src/config.js', () => ({
        getConfig: vi.fn(() => ({
          logLevel: 'DEBUG',
        })),
      }));

      const { info } = await import('../../../src/utils/logger.js');

      // Trigger logger initialization by calling a logging function
      info('test');

      expect(pino).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
        })
      );
    });

    it('should default to INFO when logLevel is not set', async () => {
      vi.resetModules();

      // Mock config without logLevel
      vi.doMock('../../../src/config.js', () => ({
        getConfig: vi.fn(() => ({})),
      }));

      const { info } = await import('../../../src/utils/logger.js');

      // Trigger logger initialization by calling a logging function
      info('test');

      expect(pino).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
        })
      );
    });

    it('should convert log level to lowercase', async () => {
      vi.resetModules();

      // Mock config with uppercase WARN
      vi.doMock('../../../src/config.js', () => ({
        getConfig: vi.fn(() => ({
          logLevel: 'WARN',
        })),
      }));

      const { info } = await import('../../../src/utils/logger.js');

      // Trigger logger initialization by calling a logging function
      info('test');

      expect(pino).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
        })
      );
    });
  });

  describe('context handling', () => {
    it('should handle empty context object', async () => {
      const { info } = await import('../../../src/utils/logger.js');

      info('Test message', {});

      expect(mockPinoInstance.info).toHaveBeenCalledWith({}, 'Test message');
    });

    it('should handle complex context objects', async () => {
      const { error } = await import('../../../src/utils/logger.js');

      const context = {
        user: { id: 123, name: 'Test User' },
        metadata: { timestamp: Date.now(), version: '1.0.0' },
        nested: { deeply: { nested: { value: 'test' } } },
      };

      error('Complex context test', context);

      expect(mockPinoInstance.error).toHaveBeenCalledWith(context, 'Complex context test');
    });
  });

  describe('default export', () => {
    it('should export the getLogger function as default', async () => {
      const loggerModule = await import('../../../src/utils/logger.js');

      expect(loggerModule.default).toBeDefined();
      expect(typeof loggerModule.default).toBe('function');

      // Calling the default export should return the logger instance
      const logger = loggerModule.default();
      expect(logger).toBe(mockPinoInstance);
    });
  });
});
