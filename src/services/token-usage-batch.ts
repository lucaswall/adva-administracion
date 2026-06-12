import { appendRowsWithFormatting } from './sheets.js';
import { getSpreadsheetTimezone } from './sheets.js';
import { calculateCost } from './token-usage-logger.js';
import type { CellValue } from './sheets.js';
import type { Result } from '../types/index.js';
import { warn as logWarn } from '../utils/logger.js';

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
  private timezoneFetchFailed: boolean = false;

  /**
   * Maximum batch size before auto-flush
   */
  private static readonly MAX_BATCH_SIZE = 100;

  /**
   * Adds a token usage entry to the batch.
   * Auto-flushes when MAX_BATCH_SIZE is reached if dashboardId is provided.
   * @param entry - Token usage entry to add
   * @param dashboardId - Optional dashboard ID for auto-flush
   */
  async add(entry: TokenUsageEntry, dashboardId?: string): Promise<void> {
    this.entries.push(entry);

    // Auto-flush if we've reached MAX_BATCH_SIZE and dashboardId provided
    if (dashboardId && this.entries.length >= TokenUsageBatch.MAX_BATCH_SIZE) {
      await this.flush(dashboardId);
    }
  }

  /**
   * Writes all accumulated entries to the spreadsheet.
   *
   * The pending entries are snapshotted and cleared SYNCHRONOUSLY (no await
   * between read and clear) so that concurrent flushes — possible when
   * auto-flush fires from parallel queue workers (Codex PR-120 finding) —
   * can never write the same entries twice or wipe entries added while a
   * flush is awaiting the Sheets append. On write failure the snapshot is
   * re-queued ahead of any entries added in the meantime.
   * @returns Result indicating success or failure
   */
  async flush(dashboardId: string): Promise<Result<void, Error>> {
    if (this.entries.length === 0) {
      return { ok: true, value: undefined };
    }

    // Atomic snapshot-and-clear: a concurrent flush sees an empty (or
    // only-newer-entries) array instead of re-reading this snapshot.
    const snapshot = this.entries;
    this.entries = [];

    // Get timezone once (skip if previous fetch failed)
    if (!this.timezone && !this.timezoneFetchFailed) {
      const tzResult = await getSpreadsheetTimezone(dashboardId);
      if (tzResult.ok) {
        this.timezone = tzResult.value;
      } else {
        this.timezoneFetchFailed = true;
      }
    }

    // Build all rows - must match logTokenUsage column structure exactly
    const rows: CellValue[][] = snapshot.map((entry) => {
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
    const writeResult = await appendRowsWithFormatting(dashboardId, 'Uso de API', rows, this.timezone);

    if (!writeResult.ok) {
      // Re-queue the snapshot (ahead of entries added mid-flight) for retry
      this.entries = [...snapshot, ...this.entries];
      logWarn('Token usage batch write failed, entries preserved for retry', {
        module: 'token-usage-batch',
        error: writeResult.error.message,
        entryCount: this.entries.length
      });
      return { ok: false, error: writeResult.error };
    }

    // Snapshot was already removed from the pending list; nothing to clear.
    return { ok: true, value: undefined };
  }

  /**
   * Returns count of pending entries.
   */
  get pendingCount(): number {
    return this.entries.length;
  }
}
