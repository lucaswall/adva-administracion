/**
 * Configuration management for ADVA Administración Server
 * All configuration is loaded from environment variables
 */

import type { LogLevel } from './types/index.js';

/**
 * ADVA's CUIT numbers
 * ADVA is always the receptor (client) in invoices, never the emisor (issuer)
 */
export const ADVA_CUITS = ['30709076783'] as const;

/**
 * Checks if a CUIT belongs to ADVA
 *
 * @param cuit - CUIT to check (with or without dashes)
 * @returns true if CUIT belongs to ADVA
 */
export function isAdvaCuit(cuit: string): boolean {
  if (!cuit) return false;
  const cleaned = cuit.replace(/[-\s]/g, '');
  return ADVA_CUITS.includes(cleaned as typeof ADVA_CUITS[number]);
}

/**
 * Maximum cascade depth for match displacement
 * Prevents infinite loops in cascading re-matching
 */
export const MAX_CASCADE_DEPTH = 10;

/**
 * Cascade timeout in milliseconds
 * Maximum time allowed for entire cascade operation
 */
export const CASCADE_TIMEOUT_MS = 30000;

/**
 * Gemini API pricing per token
 * Update when pricing changes: https://ai.google.dev/gemini-api/docs/pricing
 */
export const GEMINI_PRICING = {
  'gemini-2.5-flash': {
    inputPerToken: 0.00000015,   // $0.15 per 1M tokens
    outputPerToken: 0.0000006,   // $0.60 per 1M tokens
  }
} as const;

/**
 * Application configuration loaded from environment
 */
export interface Config {
  // Server
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: LogLevel;
  apiSecret: string;

  // Google Auth
  googleServiceAccountKey: string;

  // Gemini
  geminiApiKey: string;

  // Drive
  driveRootFolderId: string;
  controlTemplateId: string;

  // Webhooks
  webhookUrl: string | null;

  // Matching
  matchDaysBefore: number;
  matchDaysAfter: number;
  usdArsTolerancePercent: number;

  // Gemini API
  geminiRpmLimit: number;
}

/**
 * Loads configuration from environment variables
 * Throws if required variables are missing
 */
export function loadConfig(): Config {
  const port = parseInt(process.env.PORT || '3000', 10);
  const nodeEnv = (process.env.NODE_ENV || 'development') as Config['nodeEnv'];
  const logLevel = (process.env.LOG_LEVEL || 'INFO') as LogLevel;

  // API Secret - required for production
  const apiSecret = process.env.API_SECRET || '';
  if (!apiSecret && nodeEnv === 'production') {
    throw new Error('API_SECRET is required');
  }

  // Google Auth - required
  const googleServiceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
  if (!googleServiceAccountKey && nodeEnv === 'production') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is required');
  }

  // Gemini - required
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  if (!geminiApiKey && nodeEnv === 'production') {
    throw new Error('GEMINI_API_KEY is required');
  }

  // Drive - required for production
  const driveRootFolderId = process.env.DRIVE_ROOT_FOLDER_ID || '';
  if (!driveRootFolderId && nodeEnv === 'production') {
    throw new Error('DRIVE_ROOT_FOLDER_ID is required');
  }

  // Template spreadsheet with embedded App Script menu - required
  const controlTemplateId = process.env.CONTROL_TEMPLATE_ID || '';
  if (!controlTemplateId && nodeEnv === 'production') {
    throw new Error('CONTROL_TEMPLATE_ID is required');
  }

  // Webhooks - optional
  const webhookUrl = process.env.WEBHOOK_URL || null;

  // Matching configuration
  const matchDaysBefore = parseInt(process.env.MATCH_DAYS_BEFORE || '10', 10);
  const matchDaysAfter = parseInt(process.env.MATCH_DAYS_AFTER || '60', 10);
  const usdArsTolerancePercent = parseFloat(process.env.USD_ARS_TOLERANCE_PERCENT || '5');

  // Gemini API configuration
  const geminiRpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || '150', 10);

  return {
    port,
    nodeEnv,
    logLevel,
    apiSecret,
    googleServiceAccountKey,
    geminiApiKey,
    driveRootFolderId,
    controlTemplateId,
    webhookUrl,
    matchDaysBefore,
    matchDaysAfter,
    usdArsTolerancePercent,
    geminiRpmLimit,
  };
}

/**
 * Singleton config instance
 */
let configInstance: Config | null = null;

/**
 * Gets the application configuration
 * Loads from environment on first call
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Resets the config instance (for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
