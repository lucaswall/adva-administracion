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
 * Application configuration loaded from environment
 */
export interface Config {
  // Server
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: LogLevel;

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
}

/**
 * Loads configuration from environment variables
 * Throws if required variables are missing
 */
export function loadConfig(): Config {
  const port = parseInt(process.env.PORT || '3000', 10);
  const nodeEnv = (process.env.NODE_ENV || 'development') as Config['nodeEnv'];
  const logLevel = (process.env.LOG_LEVEL || 'INFO') as LogLevel;

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

  // Template spreadsheet with embedded App Script menu
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

  return {
    port,
    nodeEnv,
    logLevel,
    googleServiceAccountKey,
    geminiApiKey,
    driveRootFolderId,
    controlTemplateId,
    webhookUrl,
    matchDaysBefore,
    matchDaysAfter,
    usdArsTolerancePercent,
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
