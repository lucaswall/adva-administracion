/**
 * Token Usage Logger Service
 * Logs Gemini API token usage and costs to Dashboard Operativo Contable spreadsheet
 */

import { randomUUID } from 'crypto';
import { GEMINI_PRICING } from '../config.js';
import { appendRowsWithFormatting } from './sheets.js';
import type { Result } from '../types/index.js';
import { debug, error as logError } from '../utils/logger.js';

/**
 * Data structure for token usage log entry
 */
export interface TokenUsageData {
  /** Timestamp of the request (Date object or ISO string) */
  timestamp: Date | string;
  /** Unique request ID (UUID) */
  requestId: string;
  /** Google Drive file ID being processed */
  fileId: string;
  /** File name being processed */
  fileName: string;
  /** Gemini model used */
  model: 'gemini-2.5-flash';
  /** Number of input/prompt tokens */
  promptTokens: number;
  /** Number of cached content tokens */
  cachedTokens: number;
  /** Number of output/candidate tokens */
  outputTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Estimated cost in USD */
  estimatedCostUSD: number;
  /** Request duration in milliseconds */
  durationMs: number;
  /** Whether the request succeeded */
  success: boolean;
  /** Error message if failed */
  errorMessage: string;
}

/**
 * Calculate cost for Gemini API usage
 *
 * @param model - Gemini model name
 * @param promptTokens - Number of new input tokens
 * @param cachedTokens - Number of cached content tokens (cheaper)
 * @param outputTokens - Number of output tokens
 * @returns Estimated cost in USD
 */
export function calculateCost(
  model: 'gemini-2.5-flash',
  promptTokens: number,
  cachedTokens: number,
  outputTokens: number
): number {
  const pricing = GEMINI_PRICING[model];
  const promptCost = promptTokens * pricing.inputPerToken;
  const cachedCost = cachedTokens * pricing.cachedPerToken;
  const outputCost = outputTokens * pricing.outputPerToken;
  return promptCost + cachedCost + outputCost;
}

/**
 * Generate a unique request ID (UUID v4)
 *
 * @returns UUID string
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Log token usage to Dashboard Operativo Contable spreadsheet
 *
 * @param spreadsheetId - ID of Dashboard Operativo Contable spreadsheet
 * @param data - Token usage data to log
 * @returns Result with void on success or Error on failure
 */
export async function logTokenUsage(
  spreadsheetId: string,
  data: TokenUsageData
): Promise<Result<void, Error>> {
  // Convert timestamp to Date object if it's a string
  const timestamp = typeof data.timestamp === 'string'
    ? new Date(data.timestamp)
    : data.timestamp;

  // Format data as spreadsheet row with Date object for proper datetime formatting
  const row = [
    timestamp,
    data.requestId,
    data.fileId,
    data.fileName,
    data.model,
    data.promptTokens,
    data.cachedTokens,
    data.outputTokens,
    data.totalTokens,
    data.estimatedCostUSD,
    data.durationMs,
    data.success ? 'YES' : 'NO',
    data.errorMessage,
  ];

  // Append row with explicit formatting to prevent bold inheritance
  const result = await appendRowsWithFormatting(spreadsheetId, 'Uso de API', [row]);

  if (!result.ok) {
    logError('Failed to log token usage', {
      module: 'token-usage-logger',
      phase: 'log-usage',
      requestId: data.requestId,
      fileId: data.fileId,
      error: result.error.message
    });
    return { ok: false, error: result.error };
  }

  debug('Token usage logged', {
    module: 'token-usage-logger',
    phase: 'log-usage',
    requestId: data.requestId,
    fileId: data.fileId,
    model: data.model,
    totalTokens: data.totalTokens,
    cost: data.estimatedCostUSD
  });

  return { ok: true, value: undefined };
}
