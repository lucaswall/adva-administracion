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

describe('Numeric env var validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Set required vars to valid values
    process.env.API_SECRET = 'test-secret';
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('PORT validation', () => {
    it('throws when PORT is negative', async () => {
      process.env.PORT = '-1';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('PORT must be between 1 and 65535');
    });

    it('throws when PORT is zero', async () => {
      process.env.PORT = '0';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('PORT must be between 1 and 65535');
    });

    it('throws when PORT is greater than 65535', async () => {
      process.env.PORT = '65536';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('PORT must be between 1 and 65535');
    });

    it('throws when PORT is NaN', async () => {
      process.env.PORT = 'not-a-number';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('PORT must be between 1 and 65535');
    });

    it('accepts valid PORT', async () => {
      process.env.PORT = '3000';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().port).toBe(3000);
    });

    it('accepts PORT at boundaries', async () => {
      process.env.PORT = '1';
      const { loadConfig: loadConfig1 } = await import('./config.js');
      expect(loadConfig1().port).toBe(1);

      vi.resetModules();
      process.env.PORT = '65535';
      const { loadConfig: loadConfig2 } = await import('./config.js');
      expect(loadConfig2().port).toBe(65535);
    });
  });

  describe('MATCH_DAYS_BEFORE validation', () => {
    it('throws when MATCH_DAYS_BEFORE is negative', async () => {
      process.env.MATCH_DAYS_BEFORE = '-1';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('MATCH_DAYS_BEFORE must be >= 0');
    });

    it('throws when MATCH_DAYS_BEFORE is NaN', async () => {
      process.env.MATCH_DAYS_BEFORE = 'invalid';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('MATCH_DAYS_BEFORE must be >= 0');
    });

    it('accepts zero MATCH_DAYS_BEFORE', async () => {
      process.env.MATCH_DAYS_BEFORE = '0';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().matchDaysBefore).toBe(0);
    });

    it('accepts positive MATCH_DAYS_BEFORE', async () => {
      process.env.MATCH_DAYS_BEFORE = '30';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().matchDaysBefore).toBe(30);
    });
  });

  describe('MATCH_DAYS_AFTER validation', () => {
    it('throws when MATCH_DAYS_AFTER is negative', async () => {
      process.env.MATCH_DAYS_AFTER = '-5';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('MATCH_DAYS_AFTER must be >= 0');
    });

    it('throws when MATCH_DAYS_AFTER is NaN', async () => {
      process.env.MATCH_DAYS_AFTER = 'abc';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('MATCH_DAYS_AFTER must be >= 0');
    });

    it('accepts zero MATCH_DAYS_AFTER', async () => {
      process.env.MATCH_DAYS_AFTER = '0';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().matchDaysAfter).toBe(0);
    });

    it('accepts positive MATCH_DAYS_AFTER', async () => {
      process.env.MATCH_DAYS_AFTER = '90';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().matchDaysAfter).toBe(90);
    });
  });

  describe('GEMINI_RPM_LIMIT validation', () => {
    it('throws when GEMINI_RPM_LIMIT is negative', async () => {
      process.env.GEMINI_RPM_LIMIT = '-10';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('GEMINI_RPM_LIMIT must be >= 1');
    });

    it('throws when GEMINI_RPM_LIMIT is zero', async () => {
      process.env.GEMINI_RPM_LIMIT = '0';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('GEMINI_RPM_LIMIT must be >= 1');
    });

    it('throws when GEMINI_RPM_LIMIT is NaN', async () => {
      process.env.GEMINI_RPM_LIMIT = 'fast';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('GEMINI_RPM_LIMIT must be >= 1');
    });

    it('accepts valid GEMINI_RPM_LIMIT', async () => {
      process.env.GEMINI_RPM_LIMIT = '100';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().geminiRpmLimit).toBe(100);
    });

    it('accepts GEMINI_RPM_LIMIT of 1', async () => {
      process.env.GEMINI_RPM_LIMIT = '1';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().geminiRpmLimit).toBe(1);
    });
  });

  describe('USD_ARS_TOLERANCE_PERCENT validation', () => {
    it('throws when USD_ARS_TOLERANCE_PERCENT is negative', async () => {
      process.env.USD_ARS_TOLERANCE_PERCENT = '-5';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('USD_ARS_TOLERANCE_PERCENT must be >= 0');
    });

    it('throws when USD_ARS_TOLERANCE_PERCENT is NaN', async () => {
      process.env.USD_ARS_TOLERANCE_PERCENT = 'high';
      const { loadConfig } = await import('./config.js');
      expect(() => loadConfig()).toThrow('USD_ARS_TOLERANCE_PERCENT must be >= 0');
    });

    it('accepts zero USD_ARS_TOLERANCE_PERCENT', async () => {
      process.env.USD_ARS_TOLERANCE_PERCENT = '0';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().usdArsTolerancePercent).toBe(0);
    });

    it('accepts positive USD_ARS_TOLERANCE_PERCENT', async () => {
      process.env.USD_ARS_TOLERANCE_PERCENT = '10.5';
      const { loadConfig } = await import('./config.js');
      expect(loadConfig().usdArsTolerancePercent).toBe(10.5);
    });
  });
});
