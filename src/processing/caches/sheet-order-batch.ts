/**
 * Batch collector for deferred month sheet reordering
 * Collects spreadsheet IDs during processing, reorders all at scan end
 */

import { reorderMonthSheets } from '../../services/sheets.js';
import { warn } from '../../utils/logger.js';

/**
 * Collects pending sheet reorder operations and executes them once at end of scan.
 * This prevents race conditions when multiple resúmenes are processed concurrently.
 */
export class SheetOrderBatch {
  private pendingSpreadsheets = new Set<string>();

  /**
   * Marks a spreadsheet as needing month sheet reordering.
   *
   * @param spreadsheetId - Spreadsheet ID that needs reordering
   */
  addPendingReorder(spreadsheetId: string): void {
    this.pendingSpreadsheets.add(spreadsheetId);
  }

  /**
   * Executes all pending reorders. Call after scan completes.
   */
  async flushReorders(): Promise<void> {
    for (const spreadsheetId of this.pendingSpreadsheets) {
      const result = await reorderMonthSheets(spreadsheetId);
      if (!result.ok) {
        warn('Failed to reorder month sheets during flush', {
          module: 'sheet-order-batch',
          spreadsheetId,
          error: result.error.message,
        });
      }
    }
    this.pendingSpreadsheets.clear();
  }

  /**
   * Clears pending reorders without executing them.
   */
  clear(): void {
    this.pendingSpreadsheets.clear();
  }
}
