import { appendRowsWithFormatting } from './sheets.js';
import { getSpreadsheetTimezone } from './sheets.js';
import { calculateCost } from './token-usage-logger.js';
import type { CellValue } from './sheets.js';

export interface TokenUsageEntry {
  timestamp: Date;
  requestId: string;
  fileId: string;
  fileName: string;
  model: string;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalTokens: number;
  promptCostPerToken: number;
  cachedCostPerToken: number;
  outputCostPerToken: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Batches token usage entries for single write at scan end.
 */
export class TokenUsageBatch {
  private entries: TokenUsageEntry[] = [];
  private timezone?: string;

  /**
   * Adds a token usage entry to the batch.
   */
  add(entry: TokenUsageEntry): void {
    this.entries.push(entry);
  }

  /**
   * Writes all accumulated entries to the spreadsheet.
   */
  async flush(dashboardId: string): Promise<void> {
    if (this.entries.length === 0) return;

    // Get timezone once
    if (!this.timezone) {
      const tzResult = await getSpreadsheetTimezone(dashboardId);
      this.timezone = tzResult.ok ? tzResult.value : undefined;
    }

    // Build all rows - must match logTokenUsage column structure exactly
    const rows: CellValue[][] = this.entries.map((entry) => {
      // Calculate cost directly (cannot use formulas in batch mode)
      const estimatedCost = calculateCost(
        entry.model as 'gemini-2.5-flash',
        entry.promptTokens,
        entry.cachedTokens,
        entry.outputTokens
      );

      return [
        entry.timestamp,                    // A
        entry.requestId,                    // B
        entry.fileId,                       // C
        entry.fileName,                     // D
        entry.model,                        // E
        entry.promptTokens,                 // F
        entry.cachedTokens,                 // G
        entry.outputTokens,                 // H
        entry.promptCostPerToken,           // I
        entry.cachedCostPerToken,           // J
        entry.outputCostPerToken,           // K
        estimatedCost,                      // L (calculated instead of formula)
        entry.durationMs,                   // M
        entry.success ? 'YES' : 'NO',       // N (match logTokenUsage format)
        entry.errorMessage || '',           // O
      ];
    });

    // Single batch write
    await appendRowsWithFormatting(dashboardId, 'Uso de API', rows, this.timezone);

    this.entries = [];
  }

  /**
   * Returns count of pending entries.
   */
  get pendingCount(): number {
    return this.entries.length;
  }
}
