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
 * Fetch timeout in milliseconds
 * Maximum time allowed for a single fetch request to Gemini API
 * Set to 5 minutes to accommodate large PDF processing (300+ pages can take >3 minutes)
 */
export const FETCH_TIMEOUT_MS = 300000;

/**
 * Gemini API pricing per token (Standard tier)
 * Source: https://ai.google.dev/gemini-api/docs/pricing
 * Last updated: 2026-01-23
 */
export const GEMINI_PRICING = {
  'gemini-2.5-flash': {
    inputPerToken: 0.0000003,     // $0.30 per 1M tokens (new prompt tokens)
    cachedPerToken: 0.00000003,   // $0.03 per 1M tokens (cached content, 90% discount)
    outputPerToken: 0.0000025,    // $2.50 per 1M tokens
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
  apiBaseUrl: string | null;

  // Google Auth
  googleServiceAccountKey: string;

  // Gemini
  geminiApiKey: string;

  // Drive
  driveRootFolderId: string;

  // Webhooks (derived from apiBaseUrl)
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

  // API Secret - required in all environments
  const apiSecret = process.env.API_SECRET || '';
  if (!apiSecret) {
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

  // API Base URL - optional (required for webhooks and Apps Script)
  const apiBaseUrl = process.env.API_BASE_URL || null;

  // Webhooks - derived from API_BASE_URL
  let webhookUrl: string | null = null;
  if (apiBaseUrl) {
    // Ensure apiBaseUrl has a protocol
    const baseUrl = apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://')
      ? apiBaseUrl
      : `https://${apiBaseUrl}`;
    webhookUrl = `${baseUrl.replace(/\/$/, '')}/webhooks/drive`;
  }

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
    apiBaseUrl,
    googleServiceAccountKey,
    geminiApiKey,
    driveRootFolderId,
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
