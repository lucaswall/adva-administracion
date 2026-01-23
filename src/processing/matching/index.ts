/**
 * Matching module index - exports all matching functions
 */

import type { Result } from '../../types/index.js';
import { getConfig } from '../../config.js';
import { getCachedFolderStructure } from '../../services/folder-structure.js';
import { syncPagosPendientes } from '../../services/pagos-pendientes.js';
import { debug, info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

// Re-export matching functions
export { matchFacturasWithPagos } from './factura-pago-matcher.js';
export { matchRecibosWithPagos } from './recibo-pago-matcher.js';

// Import for internal use
import { matchFacturasWithPagos } from './factura-pago-matcher.js';
import { matchRecibosWithPagos } from './recibo-pago-matcher.js';

/**
 * Runs matching on unmatched documents across all spreadsheets
 *
 * @param folderStructure - Cached folder structure with spreadsheet IDs
 * @param config - Config with matching parameters (date ranges, tolerances)
 * @returns Total number of matches found
 */
export async function runMatching(
  folderStructure: ReturnType<typeof getCachedFolderStructure>,
  config: ReturnType<typeof getConfig>
): Promise<Result<number, Error>> {
  const correlationId = getCorrelationId();

  if (!folderStructure) {
    return { ok: false, error: new Error('Folder structure not initialized') };
  }

  info('Starting comprehensive matching', {
    module: 'matching',
    phase: 'auto-match',
    controlIngresosId: folderStructure.controlIngresosId,
    controlEgresosId: folderStructure.controlEgresosId,
    correlationId,
  });

  let totalMatches = 0;

  // Match Egresos: Facturas Recibidas ↔ Pagos Enviados
  debug('Matching Facturas Recibidas with Pagos Enviados', {
    module: 'matching',
    phase: 'auto-match',
    correlationId,
  });

  const egresosFacturaMatches = await matchFacturasWithPagos(
    folderStructure.controlEgresosId,
    'Facturas Recibidas',
    'Pagos Enviados',
    'cuitEmisor',       // Factura field to match
    'cuitBeneficiario', // Pago field to match
    config
  );

  if (!egresosFacturaMatches.ok) {
    return egresosFacturaMatches;
  }

  totalMatches += egresosFacturaMatches.value;
  debug('Egresos factura matches complete', {
    module: 'matching',
    phase: 'auto-match',
    matchesFound: egresosFacturaMatches.value,
    correlationId,
  });

  // Match Ingresos: Facturas Emitidas ↔ Pagos Recibidos
  debug('Matching Facturas Emitidas with Pagos Recibidos', {
    module: 'matching',
    phase: 'auto-match',
    correlationId,
  });

  const ingresosMatches = await matchFacturasWithPagos(
    folderStructure.controlIngresosId,
    'Facturas Emitidas',
    'Pagos Recibidos',
    'cuitReceptor',  // Factura field to match
    'cuitPagador',   // Pago field to match
    config
  );

  if (!ingresosMatches.ok) {
    return ingresosMatches;
  }

  totalMatches += ingresosMatches.value;
  debug('Ingresos matches complete', {
    module: 'matching',
    phase: 'auto-match',
    matchesFound: ingresosMatches.value,
    correlationId,
  });

  // Match Egresos: Recibos ↔ Pagos Enviados
  debug('Matching Recibos with Pagos Enviados', {
    module: 'matching',
    phase: 'auto-match',
    correlationId,
  });

  const recibosMatches = await matchRecibosWithPagos(
    folderStructure.controlEgresosId,
    config
  );

  if (!recibosMatches.ok) {
    return recibosMatches;
  }

  totalMatches += recibosMatches.value;
  debug('Recibo matches complete', {
    module: 'matching',
    phase: 'auto-match',
    matchesFound: recibosMatches.value,
    correlationId,
  });

  // Sync unpaid facturas to Dashboard's Pagos Pendientes sheet
  debug('Syncing Pagos Pendientes', {
    module: 'matching',
    phase: 'pagos-pendientes',
    correlationId,
  });

  const syncResult = await syncPagosPendientes(
    folderStructure.controlEgresosId,
    folderStructure.dashboardOperativoId
  );

  if (!syncResult.ok) {
    warn('Failed to sync Pagos Pendientes', {
      module: 'matching',
      phase: 'pagos-pendientes',
      error: syncResult.error.message,
      correlationId,
    });
    // Don't fail matching if sync fails - this is not critical
  } else {
    debug('Pagos Pendientes sync complete', {
      module: 'matching',
      phase: 'pagos-pendientes',
      pendingPayments: syncResult.value,
      correlationId,
    });
  }

  info('Comprehensive matching complete', {
    module: 'matching',
    phase: 'auto-match',
    totalMatches,
    correlationId,
  });

  return { ok: true, value: totalMatches };
}
