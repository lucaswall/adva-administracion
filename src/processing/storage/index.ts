/**
 * Storage module index - exports all storage functions
 */

import { getValues, appendRowsWithLinks, batchUpdate, getSpreadsheetTimezone } from '../../services/sheets.js';
import type { Result, DocumentType } from '../../types/index.js';
import { info as logInfo, error as logError } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withQuotaRetry } from '../../utils/concurrency.js';

/**
 * In-memory cache for file row indexes
 * Key: `${spreadsheetId}:${fileId}`, Value: row index (1-based)
 */
const fileRowIndexCache = new Map<string, number>();

/**
 * Clears the file row index cache (for testing)
 */
export function clearFileStatusCache(): void {
  fileRowIndexCache.clear();
}

// Re-export storage functions
export { storeFactura } from './factura-store.js';
export { storePago } from './pago-store.js';
export { storeRecibo } from './recibo-store.js';
export { storeRetencion } from './retencion-store.js';
export { storeResumenBancario, storeResumenTarjeta, storeResumenBroker } from './resumen-store.js';
export { storeMovimientosBancario, storeMovimientosTarjeta, storeMovimientosBroker } from './movimientos-store.js';

/**
 * Marks a file as processing in the centralized tracking sheet
 * If the file already exists with a non-success status (failed/processing),
 * updates that row instead of creating a duplicate.
 *
 * @param dashboardId - Dashboard Operativo Contable spreadsheet ID
 * @param fileId - Google Drive file ID
 * @param fileName - File name
 * @param documentType - Document type after classification
 */
export async function markFileProcessing(
  dashboardId: string,
  fileId: string,
  fileName: string,
  documentType: DocumentType
): Promise<Result<void, Error>> {
  return withQuotaRetry(async () => {
    const correlationId = getCorrelationId();
    const processedAt = new Date().toISOString();

    // Check if file already exists in tracking sheet (for retry scenarios)
    const existingResult = await getValues(dashboardId, 'Archivos Procesados!A:E');
    if (!existingResult.ok) {
      logError('Failed to read tracking sheet', {
        module: 'storage',
        fileId,
        error: existingResult.error.message,
        correlationId,
      });
      throw existingResult.error;
    }

    // Find existing row for this file
    let existingRowIndex = -1;
    for (let i = 1; i < existingResult.value.length; i++) {
      const row = existingResult.value[i];
      if (row && row[0] === fileId) {
        existingRowIndex = i + 1; // 1-indexed for spreadsheet
        break;
      }
    }

    // Get spreadsheet timezone for proper timestamp formatting
    const timezoneResult = await getSpreadsheetTimezone(dashboardId);
    const timeZone = timezoneResult.ok ? timezoneResult.value : undefined;

    if (existingRowIndex > 0) {
      // File exists - update the existing row (this is a retry)
      logInfo('Updating existing tracking row for retry', {
        module: 'storage',
        fileId,
        fileName,
        rowIndex: existingRowIndex,
        correlationId,
      });

      const updateResult = await batchUpdate(dashboardId, [
        { range: `Archivos Procesados!C${existingRowIndex}:E${existingRowIndex}`, values: [[processedAt, documentType, 'processing']] },
      ]);

      if (!updateResult.ok) {
        logError('Failed to update tracking row for retry', {
          module: 'storage',
          fileId,
          fileName,
          error: updateResult.error.message,
          correlationId,
        });
        throw updateResult.error;
      }

      // Update cache with row index
      const cacheKey = `${dashboardId}:${fileId}`;
      fileRowIndexCache.set(cacheKey, existingRowIndex);
    } else {
      // New file - append a new row
      const result = await appendRowsWithLinks(
        dashboardId,
        'Archivos Procesados',
        [[fileId, fileName, processedAt, documentType, 'processing']],
        timeZone
      );

      if (!result.ok) {
        logError('Failed to mark file as processing', {
          module: 'storage',
          fileId,
          fileName,
          error: result.error.message,
          correlationId,
        });
        throw result.error;
      }
    }

    logInfo('Marked file as processing', {
      module: 'storage',
      fileId,
      fileName,
      documentType,
      isRetry: existingRowIndex > 0,
      correlationId,
    });
  }).then(result => {
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: undefined };
  });
}

/**
 * Updates the status of a file in the centralized tracking sheet
 *
 * @param dashboardId - Dashboard Operativo Contable spreadsheet ID
 * @param fileId - Google Drive file ID
 * @param status - New status ('success' or 'failed')
 * @param errorMessage - Optional error message for failed status
 */
export async function updateFileStatus(
  dashboardId: string,
  fileId: string,
  status: 'success' | 'failed',
  errorMessage?: string
): Promise<Result<void, Error>> {
  const correlationId = getCorrelationId();
  const cacheKey = `${dashboardId}:${fileId}`;
  const cacheHit = fileRowIndexCache.has(cacheKey);

  // Check cache first
  let rowIndex = fileRowIndexCache.get(cacheKey);

  if (rowIndex === undefined) {
    // Cache miss - read column to find row
    const valuesResult = await getValues(dashboardId, 'Archivos Procesados!A:A');

    if (!valuesResult.ok) {
      logError('Failed to read tracking sheet for status update', {
        module: 'storage',
        fileId,
        error: valuesResult.error.message,
        correlationId,
      });
      return { ok: false, error: valuesResult.error };
    }

    // Find row index (skip header)
    let foundIndex = -1;
    for (let i = 1; i < valuesResult.value.length; i++) {
      const row = valuesResult.value[i];
      if (row && row[0] === fileId) {
        foundIndex = i + 1; // 1-indexed
        break;
      }
    }

    if (foundIndex === -1) {
      const error = new Error(`File ${fileId} not found in tracking sheet`);
      logError('File not found in tracking sheet', {
        module: 'storage',
        fileId,
        correlationId,
      });
      return { ok: false, error };
    }

    rowIndex = foundIndex;
    fileRowIndexCache.set(cacheKey, rowIndex);
  }

  // Update status using cached row index
  const statusValue = status === 'failed' && errorMessage
    ? `failed: ${errorMessage}`
    : status;

  const updateResult = await batchUpdate(dashboardId, [
    { range: `Archivos Procesados!E${rowIndex}`, values: [[statusValue]] },
  ]);

  if (!updateResult.ok) {
    logError('Failed to update file status', {
      module: 'storage',
      fileId,
      status,
      error: updateResult.error.message,
      correlationId,
    });
    return { ok: false, error: updateResult.error };
  }

  logInfo('Updated file status', {
    module: 'storage',
    fileId,
    status,
    usedCache: cacheHit,
    correlationId,
  });

  return { ok: true, value: undefined };
}

/**
 * Gets list of successfully processed file IDs from centralized tracking sheet
 * Only returns file IDs with 'success' status - failed files will be retried
 *
 * @param dashboardId - Dashboard Operativo Contable spreadsheet ID
 */
export async function getProcessedFileIds(dashboardId: string): Promise<Result<Set<string>, Error>> {
  const processedIds = new Set<string>();

  // Read columns A (fileId) and E (status)
  const result = await getValues(dashboardId, 'Archivos Procesados!A:E');

  if (!result.ok) {
    return result;
  }

  if (result.value.length > 1) {
    // Skip header row (index 0)
    for (let i = 1; i < result.value.length; i++) {
      const row = result.value[i];
      // Only include files with 'success' status (column E, index 4)
      // Files with 'failed' or 'processing' status will be retried
      if (row && row[0] && row[4] === 'success') {
        processedIds.add(String(row[0]));
      }
    }
  }

  return { ok: true, value: processedIds };
}
