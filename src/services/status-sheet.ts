/**
 * Status Sheet Service
 * Updates the Status sheet in Dashboard Operativo Contable with server health metrics
 */

import type { Result } from '../types/index.js';
import { getServerStartTime, formatUptime } from '../routes/status.js';
import { getProcessingQueue } from '../processing/queue.js';
import { getWatchManagerStatus } from './watch-manager.js';
import { getConfig } from '../config.js';
import { setValues, getSheetMetadata, applyConditionalFormat, getSpreadsheetTimezone } from './sheets.js';
import { debug, info, error as logError } from '../utils/logger.js';

/**
 * Status metrics collected from the system
 */
export interface StatusMetrics {
  lastPing: Date;
  uptime: string;
  version: string;
  environment: string;
  queueCompleted: number;
  queueFailed: number;
  queuePending: number;
  heapUsed: string;
  heapTotal: string;
  rss: string;
  watchEnabled: boolean;
  activeChannels: number;
  lastScan: Date | null;
}

/**
 * Collects current system status metrics
 *
 * @returns StatusMetrics object with all system health data
 */
export function collectStatusMetrics(): StatusMetrics {
  const config = getConfig();
  const queue = getProcessingQueue();
  const queueStats = queue.getStats();
  const watchStatus = getWatchManagerStatus();
  const memUsage = process.memoryUsage();
  const startTime = getServerStartTime();

  return {
    lastPing: new Date(),
    uptime: startTime ? formatUptime(startTime) : '0s',
    version: '1.0.0',
    environment: config.nodeEnv,
    queueCompleted: queueStats.completed,
    queueFailed: queueStats.failed,
    queuePending: queueStats.pending + queueStats.running,
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    watchEnabled: watchStatus.enabled,
    activeChannels: watchStatus.activeChannels,
    lastScan: watchStatus.lastScan,
  };
}

/**
 * Formats a date for display in the spreadsheet, in the spreadsheet's timezone
 *
 * @param date - Date to format (or null)
 * @param timeZone - IANA timezone string (e.g., 'America/Argentina/Buenos_Aires')
 * @returns Formatted timestamp string (YYYY-MM-DD HH:MM:SS) in the specified timezone
 */
export function formatTimestampInTimezone(date: Date | null, timeZone: string): string {
  if (!date) return '';

  // Use Intl.DateTimeFormat to convert to the spreadsheet's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const dateParts: Record<string, string> = {};
  for (const part of parts) {
    dateParts[part.type] = part.value;
  }

  return `${dateParts.year}-${dateParts.month}-${dateParts.day} ${dateParts.hour}:${dateParts.minute}:${dateParts.second}`;
}

/**
 * Track if conditional formatting has been applied to avoid redundant API calls
 */
let conditionalFormattingApplied = false;

/**
 * Applies conditional formatting to the Status sheet
 * - ONLINE: Green text, non-bold
 * - OFFLINE: Red text, bold
 *
 * @param spreadsheetId - Dashboard Operativo Contable spreadsheet ID
 * @returns Success or error
 */
async function applyStatusConditionalFormatting(
  spreadsheetId: string
): Promise<Result<void, Error>> {
  try {
    // Get sheet metadata to find Status sheet ID
    const metadataResult = await getSheetMetadata(spreadsheetId);
    if (!metadataResult.ok) {
      return metadataResult;
    }

    const statusSheet = metadataResult.value.find(s => s.title === 'Status');
    if (!statusSheet) {
      return {
        ok: false,
        error: new Error('Status sheet not found'),
      };
    }

    // Apply conditional formatting for ONLINE (green) and OFFLINE (red/bold)
    const result = await applyConditionalFormat(spreadsheetId, [
      {
        sheetId: statusSheet.sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 1, // Column B (Estado value)
        endColumnIndex: 2,
        text: 'ONLINE',
        textColor: { red: 0, green: 0.6, blue: 0 }, // Green
        bold: false,
      },
      {
        sheetId: statusSheet.sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 1, // Column B (Estado value)
        endColumnIndex: 2,
        text: 'OFFLINE',
        textColor: { red: 0.8, green: 0, blue: 0 }, // Red
        bold: true,
      },
    ]);

    if (result.ok) {
      info('Conditional formatting applied to Status sheet', {
        module: 'status-sheet',
        phase: 'format',
      });
    }

    return result;
  } catch (error) {
    logError('Error applying conditional formatting', {
      module: 'status-sheet',
      phase: 'format',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Updates the Status sheet with current system metrics
 *
 * @param spreadsheetId - Dashboard Operativo Contable spreadsheet ID
 * @returns Success or error
 */
export async function updateStatusSheet(
  spreadsheetId: string
): Promise<Result<void, Error>> {
  try {
    const metrics = collectStatusMetrics();

    debug('Updating status sheet', {
      module: 'status-sheet',
      phase: 'update',
      spreadsheetId,
    });

    // Get the spreadsheet's timezone to format timestamps correctly
    const timezoneResult = await getSpreadsheetTimezone(spreadsheetId);
    if (!timezoneResult.ok) {
      logError('Failed to get spreadsheet timezone, defaulting to UTC', {
        module: 'status-sheet',
        phase: 'update',
        error: timezoneResult.error.message,
      });
    }
    const timeZone = timezoneResult.ok ? timezoneResult.value : 'UTC';

    // Build the status data rows (Metrica, Valor)
    // Row 1 has a formula for ONLINE/OFFLINE status
    // Rows 2-13 have metric values
    const statusData = [
      // Row 1: Estado - formula based on B2 (Ultimo Ping)
      ['Estado', '=IF((NOW()-B2)*24*60>6,"OFFLINE","ONLINE")'],
      // Row 2: Ultimo Ping - timestamp
      ['Ultimo Ping', formatTimestampInTimezone(metrics.lastPing, timeZone)],
      // Row 3: Uptime
      ['Uptime', metrics.uptime],
      // Row 4: Version
      ['Version', metrics.version],
      // Row 5: Entorno
      ['Entorno', metrics.environment],
      // Row 6: Archivos Procesados
      ['Archivos Procesados', metrics.queueCompleted.toString()],
      // Row 7: Errores
      ['Errores', metrics.queueFailed.toString()],
      // Row 8: En Cola
      ['En Cola', metrics.queuePending.toString()],
      // Row 9: Memoria Heap
      ['Memoria Heap', `${metrics.heapUsed} / ${metrics.heapTotal}`],
      // Row 10: Memoria RSS
      ['Memoria RSS', metrics.rss],
      // Row 11: Watch Activo
      ['Watch Activo', metrics.watchEnabled ? 'SI' : 'NO'],
      // Row 12: Canales Activos
      ['Canales Activos', metrics.activeChannels.toString()],
      // Row 13: Ultimo Escaneo
      ['Ultimo Escaneo', formatTimestampInTimezone(metrics.lastScan, timeZone)],
    ];

    // Write to Status sheet starting from A1
    const result = await setValues(
      spreadsheetId,
      'Status!A1:B13',
      statusData
    );

    if (!result.ok) {
      logError('Failed to update status sheet', {
        module: 'status-sheet',
        phase: 'update',
        error: result.error.message,
      });
      return result;
    }

    debug('Status sheet updated', {
      module: 'status-sheet',
      phase: 'update',
      cellsUpdated: result.value,
    });

    // Apply conditional formatting on first update
    // Atomic check-and-set: no yield between read and write
    if (!conditionalFormattingApplied) {
      conditionalFormattingApplied = true; // Set BEFORE async call
      const formatResult = await applyStatusConditionalFormatting(spreadsheetId);
      if (!formatResult.ok) {
        // Note: We don't reset to false because:
        // 1. Error is already logged (below)
        // 2. Re-attempting on next call would likely fail again
        // 3. Non-fatal - status sheet works without formatting
        logError('Failed to apply conditional formatting (non-fatal)', {
          module: 'status-sheet',
          phase: 'update',
          error: formatResult.error.message,
        });
      }
    }

    return { ok: true, value: undefined };
  } catch (error) {
    logError('Error updating status sheet', {
      module: 'status-sheet',
      phase: 'update',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
