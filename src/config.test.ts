/**
 * Tests for configuration validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('API_SECRET validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to ensure fresh config loading
    vi.resetModules();
    // Clone environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('throws when API_SECRET is empty in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.API_SECRET = '';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder';

    const { getConfig, resetConfig } = await import('./config.js');
    resetConfig();

    expect(() => getConfig()).toThrow('API_SECRET is required');
  });

  it('throws when API_SECRET is empty in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.API_SECRET = '';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder';

    const { getConfig, resetConfig } = await import('./config.js');
    resetConfig();

    expect(() => getConfig()).toThrow('API_SECRET is required');
  });

  it('throws when API_SECRET is empty in test', async () => {
    process.env.NODE_ENV = 'test';
    process.env.API_SECRET = '';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder';

    const { getConfig, resetConfig } = await import('./config.js');
    resetConfig();

    expect(() => getConfig()).toThrow('API_SECRET is required');
  });

  it('accepts non-empty API_SECRET in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.API_SECRET = 'valid-secret-token';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder';

    const { getConfig, resetConfig } = await import('./config.js');
    resetConfig();

    expect(getConfig().apiSecret).toBe('valid-secret-token');
  });

  it('accepts non-empty API_SECRET in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.API_SECRET = 'dev-secret-token';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder';

    const { getConfig, resetConfig } = await import('./config.js');
    resetConfig();

    expect(getConfig().apiSecret).toBe('dev-secret-token');
  });

  it('accepts non-empty API_SECRET in test', async () => {
    process.env.NODE_ENV = 'test';
    process.env.API_SECRET = 'test-secret-token';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder';

    const { getConfig, resetConfig } = await import('./config.js');
    resetConfig();

    expect(getConfig().apiSecret).toBe('test-secret-token');
  });
});
