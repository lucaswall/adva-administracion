/**
 * MP resumen row writer for closed periods
 *
 * Writes a synthetic ResumenBancario row to the Control de Resumenes spreadsheet
 * for a completed MercadoPago period.  The saldo values are computed from the
 * actual Movimientos rows (credito/debito columns), so balanceDiff is 0 by
 * construction.
 *
 * Open periods (current month) are silently skipped: we never write a partial
 * resumen for an ongoing month.
 */

import type { Result, MovimientoBancario, ResumenBancario } from '../types/index.js';
import { getValues } from '../services/sheets.js';
import { readMovimientosForPeriod } from '../services/movimientos-reader.js';
import { storeResumenBancario } from '../processing/storage/resumen-store.js';
import { info, error as logError } from '../utils/logger.js';


/** Account information for the MP account */
export interface MpAccountInfo {
  collectorId: string;
}

/**
 * Returns the previous YYYY-MM period string.
 * Handles year boundaries: '2026-01' → '2025-12'.
 */
function getPreviousPeriodo(periodo: string): string {
  const year = parseInt(periodo.substring(0, 4), 10);
  const month = parseInt(periodo.substring(5, 7), 10);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

/**
 * Returns the last day of a month in YYYY-MM-DD format.
 *
 * @param year - Full year (e.g., 2026)
 * @param month - 1-indexed month (1–12)
 */
function lastDayOfMonth(year: number, month: number): string {
  // new Date(year, month, 0) = day 0 of the NEXT month = last day of current month
  const d = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Looks up the saldoFinal of the previous period's Mercado Pago resumen row.
 * Returns 0 when the row does not exist or the read fails.
 *
 * @param controlSpreadsheetId - Control de Resumenes spreadsheet ID
 * @param prevPeriodo - YYYY-MM of the previous period
 * @param collectorId - MP collector/account ID (numeroCuenta)
 */
async function getPrevSaldoFinal(
  controlSpreadsheetId: string,
  prevPeriodo: string,
  collectorId: string
): Promise<number> {
  const result = await getValues(controlSpreadsheetId, 'Resumenes!A:L');
  if (!result.ok || result.value.length <= 1) return 0;

  // Columns (bancario schema): [0]=periodo, [5]=banco, [6]=numeroCuenta, [9]=saldoFinal
  for (let i = 1; i < result.value.length; i++) {
    const row = result.value[i];
    if (!row || row.length < 10) continue;
    const rowPeriodo = String(row[0] || '');
    const rowBanco = String(row[5] || '');
    const rowNumeroCuenta = String(row[6] || '');
    if (rowPeriodo === prevPeriodo &&
        rowBanco === 'Mercado Pago' &&
        rowNumeroCuenta === collectorId) {
      const saldoFinalRaw = row[9];
      const parsed = typeof saldoFinalRaw === 'number'
        ? saldoFinalRaw
        : parseFloat(String(saldoFinalRaw || '0'));
      return isNaN(parsed) ? 0 : parsed;
    }
  }
  return 0;
}

/**
 * Writes a ResumenBancario row for a closed MP period if not already present.
 *
 * - Closed period (today's YYYY-MM !== periodo): reads movimientos, computes
 *   balances, stores a synthetic resumen row via storeResumenBancario.
 * - Open period (current month): returns { written: false } without side-effects.
 * - Zero transaction rows in the movimientos tab: returns { written: false }
 *   and logs an info message.
 * - Already stored period: storeResumenBancario's dedupe path returns
 *   { stored: false }, which propagates as { written: false }.
 *
 * @param controlSpreadsheetId - ID of the Control de Resumenes spreadsheet
 * @param movimientosSpreadsheetId - ID of the Movimientos spreadsheet (used as fileId)
 * @param periodo - Target period in YYYY-MM format
 * @param accountInfo - MP account metadata
 * @param today - Current date as YYYY-MM-DD (used for open/closed check)
 */
export async function writeMpResumenIfClosed(
  controlSpreadsheetId: string,
  movimientosSpreadsheetId: string,
  periodo: string,
  accountInfo: MpAccountInfo,
  today: string
): Promise<Result<{ written: boolean }, Error>> {
  try {
    // Open period guard — do not write a partial resumen for the current month
    const currentMonth = today.substring(0, 7);
    if (periodo === currentMonth) {
      return { ok: true, value: { written: false } };
    }

    const year = parseInt(periodo.substring(0, 4), 10);
    const month = parseInt(periodo.substring(5, 7), 10);
    const { collectorId } = accountInfo;

    // Get saldoInicial from previous period's resumen (0 if none found)
    const prevPeriodo = getPreviousPeriodo(periodo);
    const saldoInicial = await getPrevSaldoFinal(controlSpreadsheetId, prevPeriodo, collectorId);

    // Read all transaction rows for this period
    const movimientosResult = await readMovimientosForPeriod(movimientosSpreadsheetId, periodo);
    if (!movimientosResult.ok) return movimientosResult;

    const movimientoRows = movimientosResult.value;

    // Skip periods with no transactions — nothing to summarise
    if (movimientoRows.length === 0) {
      info('writeMpResumenIfClosed: no transactions for period, skipping', {
        module: 'mercadopago/resumen-writer',
        periodo,
      });
      return { ok: true, value: { written: false } };
    }

    // Compute saldoFinal = saldoInicial + Σcredito - Σdebito
    let saldoFinal = saldoInicial;
    for (const row of movimientoRows) {
      saldoFinal += (row.credito ?? 0) - (row.debito ?? 0);
    }

    // Convert MovimientoRow[] → MovimientoBancario[] for storeResumenBancario
    const movimientos: MovimientoBancario[] = movimientoRows.map(row => ({
      fecha: row.fecha,
      concepto: row.concepto,
      debito: row.debito,
      credito: row.credito,
      saldo: row.saldo ?? 0,
    }));

    // Build the synthetic ResumenBancario
    // fileId = movimientosSpreadsheetId → hyperlink resolves via Drive redirect
    // URL in hyperlink: https://drive.google.com/file/d/{movimientosSpreadsheetId}/view
    const fechaDesde = `${year}-${String(month).padStart(2, '0')}-01`;
    const fechaHasta = lastDayOfMonth(year, month);

    const resumen: ResumenBancario = {
      fileId: movimientosSpreadsheetId,
      fileName: `${periodo} - Resumen - Mercado Pago - ${collectorId} ARS`,
      banco: 'Mercado Pago',
      numeroCuenta: collectorId,
      fechaDesde,
      fechaHasta,
      saldoInicial,
      saldoFinal,
      moneda: 'ARS',
      cantidadMovimientos: movimientos.length,
      movimientos,
      processedAt: new Date().toISOString(),
      confidence: 1,
      needsReview: false,
    };

    // Delegate storage (and dedupe) to storeResumenBancario
    const storeResult = await storeResumenBancario(resumen, controlSpreadsheetId);
    if (!storeResult.ok) return storeResult;

    const written = storeResult.value.stored;

    info('writeMpResumenIfClosed: result', {
      module: 'mercadopago/resumen-writer',
      periodo,
      collectorId,
      written,
    });

    return { ok: true, value: { written } };
  } catch (error) {
    logError('writeMpResumenIfClosed: unexpected error', {
      module: 'mercadopago/resumen-writer',
      periodo,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
