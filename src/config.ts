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
 * Unified lock for document processing (scan and match)
 * Both scan and match operations use this lock ID to prevent concurrent execution
 */
export const PROCESSING_LOCK_ID = 'document-processing';

/**
 * Processing lock wait-timeout in milliseconds
 * How long a waiter (scan/match/subdiario) blocks before giving up and returning ok:false.
 * Set to 5 minutes to accommodate large batch back-log.
 */
export const PROCESSING_LOCK_TIMEOUT_MS = 300000;  // 5 minutes

/**
 * Processing lock auto-expiry in milliseconds
 * How long a lock can be held before it is considered stale (crash recovery).
 * Must be strictly greater than PROCESSING_LOCK_TIMEOUT_MS so that a slow-but-valid
 * scan running between 5 and 15 minutes is NOT force-acquired by a waiter that times out.
 * Set to 15 minutes to match the inner Comprobantes lock expiry in subdiario-writer.ts.
 * ADV-302: decoupled from PROCESSING_LOCK_TIMEOUT_MS.
 */
export const PROCESSING_LOCK_EXPIRY_MS = 900000;  // 15 minutes

/**
 * Spreadsheet lock timeout in milliseconds
 * Used when creating or accessing Control de Resumenes spreadsheets
 * Set to 30 seconds to handle Google Sheets API quota errors with exponential backoff (15s-65s delays)
 */
export const SPREADSHEET_LOCK_TIMEOUT_MS = 30000;  // 30 seconds

/**
 * File status lock timeout in milliseconds
 * Used for markFileProcessing and updateFileStatus operations
 * Set to 30 seconds to handle Google Sheets API quota errors with exponential backoff (15s-65s delays)
 * ADV-22: Explicit timeout prevents indefinite wait if lock is held
 */
export const FILE_STATUS_LOCK_TIMEOUT_MS = 30000;  // 30 seconds

/**
 * Business-key store lock auto-expiry in milliseconds
 * Used as the 4th argument to withLock for all store operations
 * (factura-store, pago-store, recibo-store, retencion-store, resumen-store, storage/index.ts).
 *
 * Must cover worst-case withQuotaRetry chains (~12 min per the sheet-append rationale in ADV-242).
 * A lock held past this timeout is assumed crashed and may be force-acquired for recovery.
 * Set to 15 minutes — same as PROCESSING_LOCK_EXPIRY_MS and the sheet-append lock expiry.
 * ADV-344: decoupled from the short 10 s / 30 s wait timeouts.
 */
export const STORE_LOCK_AUTO_EXPIRY_MS = 900000;  // 15 minutes

/**
 * Google Sheets batch update limit
 * Maximum number of operations per batchUpdate API call
 */
export const SHEETS_BATCH_UPDATE_LIMIT = 500;

/**
 * Parallel sheet read chunk size
 * Number of sheets to read in parallel (memory-safe)
 */
export const PARALLEL_SHEET_READ_CHUNK_SIZE = 4;

/**
 * Base delay for global quota throttle in milliseconds
 * First backoff step after a quota error is detected
 */
export const QUOTA_THROTTLE_BASE_DELAY_MS = 5000;

/**
 * Maximum delay for global quota throttle in milliseconds
 * Backoff will not exceed this value
 */
export const QUOTA_THROTTLE_MAX_DELAY_MS = 60000;

/**
 * Reset period for global quota throttle in milliseconds
 * If no quota errors occur for this duration, backoff resets to zero
 */
export const QUOTA_THROTTLE_RESET_MS = 60000;

/**
 * Maximum number of retry attempts for transient errors (JSON parse errors)
 * These errors are often caused by temporary Gemini API instability
 */
export const MAX_TRANSIENT_RETRIES = 3;

/**
 * Maximum number of retry attempts for failed files with transient failures
 * Files that fail due to lock timeouts or quota errors will be retried up to this many times
 */
export const MAX_FAILED_FILE_RETRIES = 3;

/**
 * Retry delays in milliseconds for exponential backoff
 * [10s, 30s, 60s] - gives API time to recover from overload
 */
export const RETRY_DELAYS_MS = [10000, 30000, 60000] as const;

/**
 * Google API timeout in milliseconds (ADV-289)
 * Maximum time allowed for a single Google Sheets / Drive API call.
 * Set to 60 seconds — long enough to tolerate network hiccups but short enough
 * to surface stuck API calls before the processing lock expires.
 */
export const GOOGLE_API_TIMEOUT_MS = 60_000;

/**
 * Fetch timeout in milliseconds
 * Maximum time allowed for a single fetch request to Gemini API
 * Set to 5 minutes to accommodate large PDF processing (300+ pages can take >3 minutes)
 */
export const FETCH_TIMEOUT_MS = 300000;

/**
 * Exchange rate API fetch timeout in milliseconds
 * Maximum time allowed for a single fetch request to ArgentinaDatos API
 * Set to 30 seconds - reasonable for a simple REST API
 */
export const EXCHANGE_RATE_TIMEOUT_MS = 30000;

/**
 * Mercado Pago API base URL
 */
export const MP_API_BASE_URL = 'https://api.mercadopago.com';

/**
 * Mercado Pago API fetch timeout in milliseconds
 * Set to 30 seconds — same as exchange rate API
 */
export const MP_API_TIMEOUT_MS = 30_000;

/**
 * Mercado Pago API maximum retry attempts on 429 / 5xx / network errors
 */
export const MP_MAX_RETRIES = 3;

/**
 * Mercado Pago API retry delays for exponential backoff (milliseconds)
 * [1s, 2s, 4s] — one entry per retry attempt (MP_MAX_RETRIES must equal length)
 */
export const MP_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/**
 * Returns the Mercado Pago access token from environment, or null when absent.
 * Absence disables the MP sync feature without an error.
 */
export function getMpAccessToken(): string | null {
  return process.env.MP_ACCESS_TOKEN || null;
}

/**
 * Default maximum document size in bytes before Gemini processing.
 * Documents exceeding this limit are routed to Sin Procesar without an API call.
 * Override via MAX_DOCUMENT_BYTES env var (must be a positive integer).
 */
export const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

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
 * Absolute tolerance for USD/USD same-currency matching (e.g. $30 to absorb rounding)
 */
export const USD_SAME_CURRENCY_TOLERANCE = 30;

/**
 * Bank name prefix used to identify Mercado Pago movements.
 * Used in match-movimientos.ts to enable the extended forward factura date window.
 */
export const MERCADO_PAGO_BANK_NAME = 'Mercado Pago';

/**
 * Extended forward factura date window (days) for Mercado Pago accounts (ADV-373).
 *
 * MP charges on ~25th of the month but the factura is issued ~11th of the NEXT month
 * — a gap of up to 17 days. The standard 5-day forward window (FACTURA_DATE_RANGE_BEFORE
 * in matcher.ts) is too narrow; this constant extends it to 25 days for MP credit movements.
 */
export const MP_FACTURA_DATE_RANGE_AFTER_DAYS = 25;

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
  usdMatchDaysAfter: number;
  usdArsTolerancePercent: number;

  // Gemini API
  geminiRpmLimit: number;
  /**
   * Daily Gemini request budget cap (0 = disabled / unlimited).
   * In-memory only — resets on process restart.
   */
  geminiDailyBudget: number;

  // Document processing
  /** Maximum document size in bytes; documents larger than this go to Sin Procesar. */
  maxDocumentBytes: number;

  // Environment identity (which Drive folder this server owns)
  environment: 'staging' | 'production';
}

/**
 * Validates a numeric environment variable
 * @throws Error if value is NaN or outside bounds
 */
function validateNumericEnv(name: string, value: number, min?: number, max?: number): void {
  if (Number.isNaN(value)) {
    if (min !== undefined && max !== undefined) {
      throw new Error(`${name} must be between ${min} and ${max}`);
    } else if (min !== undefined) {
      throw new Error(`${name} must be >= ${min}`);
    } else {
      throw new Error(`${name} must be a valid number`);
    }
  }
  if (min !== undefined && value < min) {
    if (max !== undefined) {
      throw new Error(`${name} must be between ${min} and ${max}`);
    } else {
      throw new Error(`${name} must be >= ${min}`);
    }
  }
  if (max !== undefined && value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
}

/**
 * Loads configuration from environment variables
 * Throws if required variables are missing or invalid
 */
export function loadConfig(): Config {
  const port = parseInt(process.env.PORT || '3000', 10);
  validateNumericEnv('PORT', port, 1, 65535);

  // Validate NODE_ENV — only known values are accepted; unknown values could
  // silently bypass the credential gate or the ENVIRONMENT default logic.
  const rawNodeEnv = process.env.NODE_ENV || 'development';
  const validNodeEnvs = ['development', 'production', 'test'] as const;
  if (!validNodeEnvs.includes(rawNodeEnv as typeof validNodeEnvs[number])) {
    throw new Error(
      `NODE_ENV must be "development", "production", or "test", got "${rawNodeEnv}"`
    );
  }
  const nodeEnv = rawNodeEnv as Config['nodeEnv'];
  const logLevel = (process.env.LOG_LEVEL || 'INFO') as LogLevel;

  // API Secret - required in all environments
  const apiSecret = process.env.API_SECRET || '';
  if (!apiSecret) {
    throw new Error('API_SECRET is required');
  }

  // Google Auth - required in all non-test environments
  const googleServiceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
  if (!googleServiceAccountKey && nodeEnv !== 'test') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is required');
  }

  // Gemini - required in all non-test environments
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  if (!geminiApiKey && nodeEnv !== 'test') {
    throw new Error('GEMINI_API_KEY is required');
  }

  // Drive - required in all non-test environments
  const driveRootFolderId = process.env.DRIVE_ROOT_FOLDER_ID || '';
  if (!driveRootFolderId && nodeEnv !== 'test') {
    throw new Error('DRIVE_ROOT_FOLDER_ID is required');
  }

  // Environment identity - which Drive folder this server owns.
  // Railway sets ENVIRONMENT explicitly in both staging and production envs.
  // When unset (local dev / test runs) we default to 'staging' so that
  // checkEnvironmentMarker runs the full marker check — fail-closed by design.
  // Production requires ENVIRONMENT to be set explicitly; omitting it throws.
  const validEnvironments = ['staging', 'production'] as const;
  const rawEnvironment = process.env.ENVIRONMENT;
  let environment: Config['environment'];
  if (!rawEnvironment) {
    if (nodeEnv === 'production') {
      throw new Error('ENVIRONMENT is required in production (must be "staging" or "production")');
    }
    environment = 'staging';
  } else if (!validEnvironments.includes(rawEnvironment as typeof validEnvironments[number])) {
    throw new Error(`ENVIRONMENT must be "staging" or "production", got "${rawEnvironment}"`);
  } else {
    environment = rawEnvironment as 'staging' | 'production';
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
  validateNumericEnv('MATCH_DAYS_BEFORE', matchDaysBefore, 0);
  const matchDaysAfter = parseInt(process.env.MATCH_DAYS_AFTER || '60', 10);
  validateNumericEnv('MATCH_DAYS_AFTER', matchDaysAfter, 0);
  const usdMatchDaysAfter = parseInt(process.env.MATCH_DAYS_AFTER_USD || '90', 10);
  validateNumericEnv('MATCH_DAYS_AFTER_USD', usdMatchDaysAfter, 0);
  const usdArsTolerancePercent = parseFloat(process.env.USD_ARS_TOLERANCE_PERCENT || '5');
  validateNumericEnv('USD_ARS_TOLERANCE_PERCENT', usdArsTolerancePercent, 0);

  // Gemini API configuration
  const geminiRpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || '150', 10);
  validateNumericEnv('GEMINI_RPM_LIMIT', geminiRpmLimit, 1);

  // Daily Gemini budget (0 = disabled)
  const geminiDailyBudget = parseInt(process.env.GEMINI_DAILY_BUDGET || '0', 10);
  validateNumericEnv('GEMINI_DAILY_BUDGET', geminiDailyBudget, 0);

  // Document size limit
  const maxDocumentBytes = parseInt(
    process.env.MAX_DOCUMENT_BYTES || String(DEFAULT_MAX_DOCUMENT_BYTES),
    10
  );
  validateNumericEnv('MAX_DOCUMENT_BYTES', maxDocumentBytes, 1);

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
    usdMatchDaysAfter,
    usdArsTolerancePercent,
    geminiRpmLimit,
    geminiDailyBudget,
    maxDocumentBytes,
    environment,
  };
}

/**
 * Mercado Pago access token, captured at module load (Railway sets env before boot).
 * Optional — if unset, MP sync/scheduler are disabled (reason 'mp_disabled').
 * The client reads the env dynamically via getMpAccessToken() instead.
 * NEVER log this value.
 */
export const MP_ACCESS_TOKEN: string | undefined = process.env.MP_ACCESS_TOKEN;

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
