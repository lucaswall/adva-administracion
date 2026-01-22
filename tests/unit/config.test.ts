/**
 * Unit tests for configuration management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ADVA_CUITS,
  isAdvaCuit,
  loadConfig,
  getConfig,
  resetConfig
} from '../../src/config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
    resetConfig();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    resetConfig();
  });

  describe('ADVA_CUITS', () => {
    it('contains the ADVA CUIT', () => {
      expect(ADVA_CUITS).toContain('30709076783');
    });

    it('is a readonly array', () => {
      expect(Array.isArray(ADVA_CUITS)).toBe(true);
    });
  });

  describe('isAdvaCuit', () => {
    it('returns true for ADVA CUIT', () => {
      expect(isAdvaCuit('30709076783')).toBe(true);
    });

    it('returns true for ADVA CUIT with dashes', () => {
      expect(isAdvaCuit('30-70907678-3')).toBe(true);
    });

    it('returns true for ADVA CUIT with spaces', () => {
      expect(isAdvaCuit('30 70907678 3')).toBe(true);
    });

    it('returns false for non-ADVA CUIT', () => {
      expect(isAdvaCuit('20123456786')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isAdvaCuit('')).toBe(false);
    });

    it('returns false for whitespace-only string', () => {
      expect(isAdvaCuit('   ')).toBe(false);
    });
  });

  describe('loadConfig', () => {
    it('loads default values for development', () => {
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = loadConfig();

      expect(config.port).toBe(3000);
      expect(config.nodeEnv).toBe('development');
      expect(config.logLevel).toBe('INFO');
      expect(config.matchDaysBefore).toBe(10);
      expect(config.matchDaysAfter).toBe(60);
      expect(config.usdArsTolerancePercent).toBe(5);
      expect(config.geminiRpmLimit).toBe(150);
    });

    it('loads custom PORT value', () => {
      process.env.PORT = '8080';
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = loadConfig();

      expect(config.port).toBe(8080);
    });

    it('loads custom LOG_LEVEL value', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = loadConfig();

      expect(config.logLevel).toBe('DEBUG');
    });

    it('loads custom matching configuration', () => {
      process.env.MATCH_DAYS_BEFORE = '20';
      process.env.MATCH_DAYS_AFTER = '90';
      process.env.USD_ARS_TOLERANCE_PERCENT = '10';
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = loadConfig();

      expect(config.matchDaysBefore).toBe(20);
      expect(config.matchDaysAfter).toBe(90);
      expect(config.usdArsTolerancePercent).toBe(10);
    });

    it('loads custom GEMINI_RPM_LIMIT value', () => {
      process.env.GEMINI_RPM_LIMIT = '300';
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = loadConfig();

      expect(config.geminiRpmLimit).toBe(300);
    });

    it('allows missing keys in development', () => {
      process.env.NODE_ENV = 'development';

      const config = loadConfig();

      expect(config.googleServiceAccountKey).toBe('');
      expect(config.geminiApiKey).toBe('');
      expect(config.driveRootFolderId).toBe('');
    });

    it('allows missing keys in test', () => {
      process.env.NODE_ENV = 'test';

      const config = loadConfig();

      expect(config.googleServiceAccountKey).toBe('');
      expect(config.geminiApiKey).toBe('');
      expect(config.driveRootFolderId).toBe('');
    });

    it('throws for missing API_SECRET in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      expect(() => loadConfig()).toThrow('API_SECRET is required');
    });

    it('throws for missing GOOGLE_SERVICE_ACCOUNT_KEY in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.API_SECRET = 'test-secret';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      expect(() => loadConfig()).toThrow('GOOGLE_SERVICE_ACCOUNT_KEY is required');
    });

    it('throws for missing GEMINI_API_KEY in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.API_SECRET = 'test-secret';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      expect(() => loadConfig()).toThrow('GEMINI_API_KEY is required');
    });

    it('throws for missing DRIVE_ROOT_FOLDER_ID in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.API_SECRET = 'test-secret';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';

      expect(() => loadConfig()).toThrow('DRIVE_ROOT_FOLDER_ID is required');
    });

    it('loads successfully with all required keys in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.API_SECRET = 'test-secret';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = loadConfig();

      expect(config.nodeEnv).toBe('production');
      expect(config.apiSecret).toBe('test-secret');
      expect(config.googleServiceAccountKey).toBe('test-key');
      expect(config.geminiApiKey).toBe('test-gemini-key');
      expect(config.driveRootFolderId).toBe('test-folder-id');
    });

    it('loads WEBHOOK_URL when provided', () => {
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';
      process.env.WEBHOOK_URL = 'https://example.com/webhooks/drive';

      const config = loadConfig();

      expect(config.webhookUrl).toBe('https://example.com/webhooks/drive');
    });

    it('returns null for WEBHOOK_URL when not provided', () => {
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = loadConfig();

      expect(config.webhookUrl).toBeNull();
    });

    it('allows missing WEBHOOK_URL in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.API_SECRET = 'test-secret';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = loadConfig();

      expect(config.webhookUrl).toBeNull();
    });
  });

  describe('getConfig', () => {
    it('returns config instance', () => {
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config = getConfig();

      expect(config).toBeDefined();
      expect(config.nodeEnv).toBe('development');
    });

    it('returns same instance on multiple calls', () => {
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config1 = getConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2);
    });

    it('returns new instance after reset', () => {
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      const config1 = getConfig();
      resetConfig();
      const config2 = getConfig();

      expect(config1).not.toBe(config2);
    });
  });

  describe('resetConfig', () => {
    it('clears the config instance', () => {
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      process.env.DRIVE_ROOT_FOLDER_ID = 'test-folder-id';

      getConfig(); // Load config
      resetConfig();

      // After reset, next getConfig should load fresh config
      const config = getConfig();
      expect(config).toBeDefined();
    });
  });
});
