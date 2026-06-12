/**
 * Mercado Pago monthly cron scheduler + boot-time catch-up [ADV-371]
 *
 * Registers a monthly cron job (06:00 on the 1st of each month) and fires one
 * immediate async sync on server boot so that any month that closed while the
 * server was down is re-covered.  All runs are idempotent: existing rows are
 * skipped by writeMpMovimientos.
 */

import * as cron from 'node-cron';
import { MP_ACCESS_TOKEN } from '../config.js';
import { syncMercadopago } from './sync.js';
import { info, error as logError } from '../utils/logger.js';

/** Module-level handle — null when scheduler is disabled or stopped */
let scheduledJob: cron.ScheduledTask | null = null;

/**
 * Runs a single syncMercadopago() call and logs the outcome.
 * Errors are caught so they never propagate to unhandled-rejection territory.
 *
 * @param phase  Label for log messages ('boot' | 'cron')
 */
function runSync(phase: string): void {
  void syncMercadopago()
    .then(result => {
      if (!result.ok) {
        logError(`MP sync (${phase}) failed`, {
          module: 'mp-scheduler',
          phase,
          error: result.error.message,
        });
      } else {
        info(`MP sync (${phase}) completed`, { module: 'mp-scheduler', phase });
      }
    })
    .catch(err => {
      logError(`MP sync (${phase}) crashed`, {
        module: 'mp-scheduler',
        phase,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Initialises the MP scheduler:
 * 1. If MP_ACCESS_TOKEN is unset → logs info and returns (no cron, no boot sync).
 * 2. Registers a monthly cron (06:00 on the 1st) that calls syncMercadopago().
 * 3. Fires one immediate async boot sync (idempotent catch-up across deploys).
 *
 * Call once at server startup, after watch-manager init.
 */
export function initMpScheduler(): void {
  if (!MP_ACCESS_TOKEN) {
    info('MP_ACCESS_TOKEN not set — MP scheduler disabled', { module: 'mp-scheduler' });
    return;
  }

  // Monthly cron: 0 6 1 * *  →  06:00 on the 1st of every month (server local time)
  scheduledJob = cron.schedule('0 6 1 * *', () => {
    runSync('cron');
  });

  // Boot catch-up: fire immediately so a missed month is synced on next deploy
  runSync('boot');
}

/**
 * Stops the scheduled MP cron job (if running).
 * Safe to call multiple times or before initMpScheduler.
 * Wire into the server shutdown handler for symmetry with watch-manager.
 */
export function stopMpScheduler(): void {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
  }
}
