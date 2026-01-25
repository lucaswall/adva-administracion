import type { Result } from '../../types/index.js';
import { getSheetMetadataInternal } from '../../services/sheets.js';

type SheetMetadata = Array<{ title: string; sheetId: number; index: number }>;

/**
 * Scan-scoped metadata cache with promise-caching to prevent thundering herd.
 * Multiple concurrent requests for same spreadsheet share single API call.
 */
export class MetadataCache {
  // Store promises, not values - prevents thundering herd
  private cache = new Map<string, Promise<Result<SheetMetadata, Error>>>();

  /**
   * Gets metadata, using cache if available.
   * Concurrent calls share the same in-flight request.
   */
  get(spreadsheetId: string): Promise<Result<SheetMetadata, Error>> {
    if (!this.cache.has(spreadsheetId)) {
      // Store the PROMISE immediately (before await)
      // This ensures concurrent callers get same promise
      this.cache.set(spreadsheetId, getSheetMetadataInternal(spreadsheetId));
    }
    return this.cache.get(spreadsheetId)!;
  }

  /**
   * Clears the cache. Call after scan completes.
   */
  clear(): void {
    this.cache.clear();
  }
}
