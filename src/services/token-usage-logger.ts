/**
 * Token Usage Logger Service
 * Logs Gemini API token usage and costs to Dashboard Operativo Contable spreadsheet
 */

import { randomUUID } from 'crypto';
import { GEMINI_PRICING } from '../config.js';
import { appendRowsWithFormatting, getValues, getSpreadsheetTimezone } from './sheets.js';
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
  /** Cost per prompt token at time of request */
  promptCostPerToken: number;
  /** Cost per cached token at time of request */
  cachedCostPerToken: number;
  /** Cost per output token at time of request */
  outputCostPerToken: number;
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
  // Get spreadsheet timezone for proper timestamp formatting
  const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
  if (!timezoneResult.ok) {
    debug('Failed to get spreadsheet timezone, timestamps will default to UTC', {
      module: 'token-usage-logger',
      phase: 'log-usage',
      error: timezoneResult.error.message,
    });
  }
  const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

  // Get current row count to determine next row number for formula
  const valuesResult = await getValues(spreadsheetId, 'Uso de API!A:A');
  if (!valuesResult.ok) {
    return { ok: false, error: valuesResult.error };
  }

  // Next row will be current row count + 1 (accounting for header row)
  const nextRow = valuesResult.value.length + 1;

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
    data.promptCostPerToken,
    data.cachedCostPerToken,
    data.outputCostPerToken,
    // estimatedCostUSD formula: =F*I + G*J + H*K (promptTokens*promptCost + cachedTokens*cachedCost + outputTokens*outputCost)
    `=F${nextRow}*I${nextRow}+G${nextRow}*J${nextRow}+H${nextRow}*K${nextRow}`,
    data.durationMs,
    data.success ? 'YES' : 'NO',
    data.errorMessage,
  ];

  // Append row with explicit formatting to prevent bold inheritance
  // Pass timezone to ensure timestamps are written in spreadsheet's local time
  const result = await appendRowsWithFormatting(spreadsheetId, 'Uso de API', [row], timeZone);

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
    promptCost: data.promptCostPerToken,
    cachedCost: data.cachedCostPerToken,
    outputCost: data.outputCostPerToken
  });

  return { ok: true, value: undefined };
}
