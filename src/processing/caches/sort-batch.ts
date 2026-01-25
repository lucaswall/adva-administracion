import { sortSheet } from '../../services/sheets.js';
import { warn } from '../../utils/logger.js';

/**
 * Sort parameters for a sheet
 */
interface SortParams {
  columnIndex: number;
  descending: boolean;
}

/**
 * Collects pending sorts and executes them once at end of scan.
 * Reduces N sorts to ~5 sorts (one per unique sheet).
 */
export class SortBatch {
  // Map<`${spreadsheetId}:${sheetName}`, SortParams>
  private pendingSorts = new Map<string, SortParams>();

  /**
   * Marks a sheet as needing sorting.
   */
  addPendingSort(spreadsheetId: string, sheetName: string, columnIndex: number, descending: boolean): void {
    const key = `${spreadsheetId}:${sheetName}`;
    this.pendingSorts.set(key, { columnIndex, descending });
  }

  /**
   * Executes all pending sorts. Call after scan completes.
   */
  async flushSorts(): Promise<void> {
    for (const [key, params] of this.pendingSorts) {
      const [spreadsheetId, sheetName] = key.split(':');
      const result = await sortSheet(spreadsheetId, sheetName, params.columnIndex, params.descending);
      if (!result.ok) {
        warn('Failed to sort sheet during flush', {
          module: 'sort-batch',
          spreadsheetId,
          sheetName,
          error: result.error.message,
        });
      }
    }
    this.pendingSorts.clear();
  }

  /**
   * Clears pending sorts without executing them.
   */
  clear(): void {
    this.pendingSorts.clear();
  }
}
