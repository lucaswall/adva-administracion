/**
 * Mercado Pago sync orchestrator [ADV-369]
 *
 * Fetches approved payments from MP API and writes them into the bank account
 * spreadsheets that mirror the structure used by the PDF-based bank statement flow.
 */

import type { Result } from '../types/index.js';
import {
  MP_ACCESS_TOKEN,
  PROCESSING_LOCK_ID,
  PROCESSING_LOCK_TIMEOUT_MS,
  PROCESSING_LOCK_EXPIRY_MS,
} from '../config.js';
import { withLock } from '../utils/concurrency.js';
import { warn, info, error as logError } from '../utils/logger.js';
import { businessDateString } from '../utils/date.js';
import { searchApprovedPayments } from './client.js';
import { paymentsToMovimientos } from './transform.js';
import { writeMpMovimientos } from './movimientos-writer.js';
import { writeMpResumenIfClosed } from './resumen-writer.js';
import {
  getOrCreateBankAccountFolder,
  getOrCreateMovimientosSpreadsheet,
  getOrCreateBankAccountSpreadsheet,
} from '../services/folder-structure.js';
import { matchAllMovimientos } from '../bank/match-movimientos.js';

const BANCO = 'Mercado Pago';
const MONEDA = 'ARS';

/**
 * Statistics from a successful MP sync
 */
export interface MpSyncStats {
  /** Periods that were processed */
  periods: string[];
  /** Total payments fetched across all periods */
  fetched: number;
  /** Total movimientos rows appended across all periods */
  appended: number;
  /** Total movimientos rows skipped (already present) across all periods */
  skippedExisting: number;
  /** Total resumen rows written across all periods */
  resumenesWritten: number;
}

/**
 * Result of a sync operation: aggregated stats or a disabled-indicator
 */
export type MpSyncResult = MpSyncStats | { skipped: true; reason: string };

/**
 * Validates a YYYY-MM period string.
 *
 * Returns false if:
 * - Format is not exactly YYYY-MM
 * - Month is outside 01–12
 * - Period is strictly after the current period in AR timezone
 *
 * @param period  The period string to validate
 * @param today   Optional YYYY-MM-DD override (for unit tests)
 */
export function isValidPeriod(period: string, today?: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  const month = parseInt(period.slice(5, 7), 10);
  if (month < 1 || month > 12) return false;

  const currentPeriod = (today ?? businessDateString()).slice(0, 7);
  if (period > currentPeriod) return false;

  return true;
}

/**
 * Returns the default sync periods: [previousMonth, currentMonth] in AR timezone.
 */
function getDefaultPeriods(): string[] {
  const current = businessDateString().slice(0, 7); // YYYY-MM
  const year = parseInt(current.slice(0, 4), 10);
  const month = parseInt(current.slice(5, 7), 10);

  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear--;
  }

  const previous = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  return [previous, current];
}

/**
 * Async trigger for match-movimientos after lock release.
 * MUST be called OUTSIDE the sync lock — match acquires the same lock (deadlock risk).
 */
function triggerMatchAsync(): void {
  void matchAllMovimientos()
    .then(result => {
      if (result.ok) {
        if (result.value.skipped) {
          info('Match movimientos skipped after MP sync', { module: 'mp-sync' });
        } else {
          info('Match movimientos completed after MP sync', {
            module: 'mp-sync',
            filled: result.value.totalFilled,
          });
        }
      } else {
        logError('Match movimientos failed after MP sync', {
          module: 'mp-sync',
          error: result.error.message,
        });
      }
    })
    .catch(err => {
      logError('Match movimientos crashed after MP sync', {
        module: 'mp-sync',
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Syncs Mercado Pago approved payments into the bank account spreadsheets.
 *
 * Behaviour:
 * - If MP_ACCESS_TOKEN is unset: returns skipped result (no API calls, no lock).
 * - Acquires the shared PROCESSING_LOCK before writing to avoid concurrent scans.
 * - For each period with zero payments: skips folder / workbook creation.
 * - For a failing period: logs the error and continues with remaining periods.
 *   The overall result is ok:false when any period fails.
 * - After a fully-successful sync with appended > 0: triggers matchAllMovimientos
 *   OUTSIDE the lock (avoids deadlock — match uses the same lock).
 *
 * @param periods  YYYY-MM period strings to sync.
 *                 Defaults to [previousMonth, currentMonth] in AR timezone.
 */
export async function syncMercadopago(
  periods?: string[]
): Promise<Result<MpSyncResult, Error>> {
  // Fast-path: token not configured
  if (!MP_ACCESS_TOKEN) {
    warn('MP_ACCESS_TOKEN not set, skipping Mercado Pago sync', { module: 'mp-sync' });
    return { ok: true, value: { skipped: true, reason: 'mp_disabled' } };
  }

  const resolvedPeriods = periods ?? getDefaultPeriods();

  // Validate all periods up-front before acquiring the lock
  for (const p of resolvedPeriods) {
    if (!isValidPeriod(p)) {
      return {
        ok: false,
        error: new Error(
          `Invalid period: "${p}" — must be YYYY-MM, month 01-12, not in the future`
        ),
      };
    }
  }

  // Acquire the shared processing lock (serialises with scan and match-movimientos)
  const lockResult = await withLock(
    PROCESSING_LOCK_ID,
    async (): Promise<Result<MpSyncStats, Error>> => {
      const stats: MpSyncStats = {
        periods: resolvedPeriods,
        fetched: 0,
        appended: 0,
        skippedExisting: 0,
        resumenesWritten: 0,
      };
      let firstError: Error | undefined;

      for (const periodo of resolvedPeriods) {
        info(`Syncing MP period ${periodo}`, { module: 'mp-sync', periodo });

        // --- Fetch ---
        const fetchResult = await searchApprovedPayments(periodo);
        if (!fetchResult.ok) {
          logError(`Failed to fetch MP payments for ${periodo}`, {
            module: 'mp-sync',
            periodo,
            error: fetchResult.error.message,
          });
          if (!firstError) firstError = fetchResult.error;
          continue;
        }

        const payments = fetchResult.value;
        stats.fetched += payments.length;

        // Skip workbook creation for empty periods
        if (payments.length === 0) {
          info(`No payments for period ${periodo}, skipping writes`, { module: 'mp-sync', periodo });
          continue;
        }

        // --- Transform ---
        const { movimientos, skipped } = paymentsToMovimientos(payments);
        if (skipped > 0) {
          warn('Non-ARS MP payments skipped by transform', { module: 'mp-sync', periodo, skipped });
        }

        // Account info from the first payment (all payments share the same collector)
        const collectorId = String(payments[0].collector_id ?? '');
        const year = periodo.slice(0, 4);
        const folderName = `${BANCO} ${collectorId} ${MONEDA}`;

        // --- Folder ---
        const folderResult = await getOrCreateBankAccountFolder(year, BANCO, collectorId, MONEDA);
        if (!folderResult.ok) {
          logError(`Failed to create MP bank folder for ${periodo}`, {
            module: 'mp-sync',
            periodo,
            error: folderResult.error.message,
          });
          if (!firstError) firstError = folderResult.error;
          continue;
        }
        const folderId = folderResult.value;

        // --- Movimientos spreadsheet ---
        const movimientosResult = await getOrCreateMovimientosSpreadsheet(
          folderId, year, folderName, 'bancario'
        );
        if (!movimientosResult.ok) {
          logError(`Failed to create MP movimientos spreadsheet for ${periodo}`, {
            module: 'mp-sync',
            periodo,
            error: movimientosResult.error.message,
          });
          if (!firstError) firstError = movimientosResult.error;
          continue;
        }
        const movimientosSpreadsheetId = movimientosResult.value;

        // --- Control (Resumen) spreadsheet ---
        const controlResult = await getOrCreateBankAccountSpreadsheet(
          folderId, year, BANCO, collectorId, MONEDA
        );
        if (!controlResult.ok) {
          logError(`Failed to create MP control spreadsheet for ${periodo}`, {
            module: 'mp-sync',
            periodo,
            error: controlResult.error.message,
          });
          if (!firstError) firstError = controlResult.error;
          continue;
        }
        const controlSpreadsheetId = controlResult.value;

        // --- Write movimientos ---
        const writeResult = await writeMpMovimientos(
          movimientosSpreadsheetId, periodo, movimientos, 0
        );
        if (!writeResult.ok) {
          logError(`Failed to write MP movimientos for ${periodo}`, {
            module: 'mp-sync',
            periodo,
            error: writeResult.error.message,
          });
          if (!firstError) firstError = writeResult.error;
          continue;
        }
        stats.appended += writeResult.value.appended;
        stats.skippedExisting += writeResult.value.skippedExisting;

        // --- Write resumen (non-critical — don't halt on failure) ---
        const resumenResult = await writeMpResumenIfClosed(
          controlSpreadsheetId,
          movimientosSpreadsheetId,
          periodo,
          { collectorId },
          businessDateString()
        );
        if (!resumenResult.ok) {
          logError(`Failed to write MP resumen for ${periodo}`, {
            module: 'mp-sync',
            periodo,
            error: resumenResult.error.message,
          });
          // Intentionally not setting firstError — resumen write failure is non-critical
        } else if (resumenResult.value.written) {
          stats.resumenesWritten++;
        }

        info(`Completed MP period ${periodo}`, {
          module: 'mp-sync',
          periodo,
          appended: writeResult.value.appended,
          skippedExisting: writeResult.value.skippedExisting,
        });
      }

      if (firstError) {
        return { ok: false, error: firstError };
      }
      return { ok: true, value: stats };
    },
    PROCESSING_LOCK_TIMEOUT_MS,
    PROCESSING_LOCK_EXPIRY_MS
  );

  // Outer failure: lock-acquisition timeout, or (defensively) a throw escaping the callback
  if (!lockResult.ok) {
    const isLockTimeout = lockResult.error.message.includes('Failed to acquire lock');
    logError(
      isLockTimeout
        ? 'MP sync failed to acquire processing lock'
        : 'MP sync failed unexpectedly under processing lock',
      {
        module: 'mp-sync',
        error: lockResult.error.message,
      }
    );
    return { ok: false, error: lockResult.error };
  }

  // Unwrap the inner Result (withLock wraps our callback return in an outer ok:true)
  const syncResult = lockResult.value as Result<MpSyncStats, Error>;

  // Lock is released — trigger match async OUTSIDE the lock (same lock → would deadlock inside)
  if (syncResult.ok && syncResult.value.appended > 0) {
    triggerMatchAsync();
  }

  return syncResult;
}
