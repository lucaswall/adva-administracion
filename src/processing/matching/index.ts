/**
 * Matching module index - exports all matching functions
 */

import type { Result } from '../../types/index.js';
import { getConfig } from '../../config.js';
import { getCachedFolderStructure } from '../../services/folder-structure.js';
import { debug, info } from '../../utils/logger.js';
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
    controlCreditosId: folderStructure.controlCreditosId,
    controlDebitosId: folderStructure.controlDebitosId,
    correlationId,
  });

  let totalMatches = 0;

  // Match Debitos: Facturas Recibidas ↔ Pagos Enviados
  debug('Matching Facturas Recibidas with Pagos Enviados', {
    module: 'matching',
    phase: 'auto-match',
    correlationId,
  });

  const debitosFacturaMatches = await matchFacturasWithPagos(
    folderStructure.controlDebitosId,
    'Facturas Recibidas',
    'Pagos Enviados',
    'cuitEmisor',       // Factura field to match
    'cuitBeneficiario', // Pago field to match
    config
  );

  if (!debitosFacturaMatches.ok) {
    return debitosFacturaMatches;
  }

  totalMatches += debitosFacturaMatches.value;
  debug('Debitos factura matches complete', {
    module: 'matching',
    phase: 'auto-match',
    matchesFound: debitosFacturaMatches.value,
    correlationId,
  });

  // Match Creditos: Facturas Emitidas ↔ Pagos Recibidos
  debug('Matching Facturas Emitidas with Pagos Recibidos', {
    module: 'matching',
    phase: 'auto-match',
    correlationId,
  });

  const creditosMatches = await matchFacturasWithPagos(
    folderStructure.controlCreditosId,
    'Facturas Emitidas',
    'Pagos Recibidos',
    'cuitReceptor',  // Factura field to match
    'cuitPagador',   // Pago field to match
    config
  );

  if (!creditosMatches.ok) {
    return creditosMatches;
  }

  totalMatches += creditosMatches.value;
  debug('Creditos matches complete', {
    module: 'matching',
    phase: 'auto-match',
    matchesFound: creditosMatches.value,
    correlationId,
  });

  // Match Debitos: Recibos ↔ Pagos Enviados
  debug('Matching Recibos with Pagos Enviados', {
    module: 'matching',
    phase: 'auto-match',
    correlationId,
  });

  const recibosMatches = await matchRecibosWithPagos(
    folderStructure.controlDebitosId,
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

  info('Comprehensive matching complete', {
    module: 'matching',
    phase: 'auto-match',
    totalMatches,
    correlationId,
  });

  return { ok: true, value: totalMatches };
}
