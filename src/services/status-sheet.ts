/**
 * Status Sheet Service
 * Updates the Status sheet in Dashboard Operativo Contable with server health metrics
 */

import type { Result } from '../types/index.js';
import { getServerStartTime, formatUptime } from '../routes/status.js';
import { getProcessingQueue } from '../processing/queue.js';
import { getWatchManagerStatus } from './watch-manager.js';
import { getConfig } from '../config.js';
import { setValues } from './sheets.js';
import { debug, error as logError } from '../utils/logger.js';

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
 * Formats a date for display in the spreadsheet
 * Uses ISO format without milliseconds for readability
 */
function formatTimestamp(date: Date | null): string {
  if (!date) return '';
  return date.toISOString().replace('T', ' ').split('.')[0];
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

    // Build the status data rows (Metrica, Valor)
    // Row 1 has a formula for ONLINE/OFFLINE status
    // Rows 2-13 have metric values
    const statusData = [
      // Row 1: Estado - formula based on B2 (Ultimo Ping)
      ['Estado', '=IF((NOW()-B2)*24*60>6,"OFFLINE","ONLINE")'],
      // Row 2: Ultimo Ping - timestamp
      ['Ultimo Ping', formatTimestamp(metrics.lastPing)],
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
      ['Ultimo Escaneo', formatTimestamp(metrics.lastScan)],
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
