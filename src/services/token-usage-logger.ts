/**
 * Token Usage Logger Service
 * Logs Gemini API token usage and costs to Dashboard Operativo Contable spreadsheet
 */

import { randomUUID } from 'crypto';
import { GEMINI_PRICING } from '../config.js';
import { appendRows } from './sheets.js';
import type { Result } from '../types/index.js';
import { debug, error as logError } from '../utils/logger.js';

/**
 * Data structure for token usage log entry
 */
export interface TokenUsageData {
  /** ISO timestamp of the request */
  timestamp: string;
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
 * @param promptTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Estimated cost in USD
 */
export function calculateCost(
  model: 'gemini-2.5-flash',
  promptTokens: number,
  outputTokens: number
): number {
  const pricing = GEMINI_PRICING[model];
  const promptCost = promptTokens * pricing.inputPerToken;
  const outputCost = outputTokens * pricing.outputPerToken;
  return promptCost + outputCost;
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
  // Format data as spreadsheet row
  const row = [
    data.timestamp,
    data.requestId,
    data.fileId,
    data.fileName,
    data.model,
    data.promptTokens,
    data.outputTokens,
    data.totalTokens,
    data.estimatedCostUSD,
    data.durationMs,
    data.success ? 'YES' : 'NO',
    data.errorMessage,
  ];

  // Append row to "Uso de API" sheet
  const result = await appendRows(spreadsheetId, 'Uso de API', [row]);

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
