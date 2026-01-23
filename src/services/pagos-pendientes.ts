/**
 * Pagos Pendientes service
 * Syncs unpaid invoices from Control de Egresos to Dashboard's Pagos Pendientes sheet
 */

import type { Result } from '../types/index.js';
import { getValues, clearSheetData, appendRowsWithFormatting } from './sheets.js';
import { info, warn } from '../utils/logger.js';
import { getCorrelationId } from '../utils/correlation.js';

/**
 * Syncs unpaid invoices (facturas recibidas) to Dashboard's Pagos Pendientes sheet
 *
 * @param controlEgresosId - Control de Egresos spreadsheet ID
 * @param dashboardId - Dashboard Operativo spreadsheet ID
 * @returns Number of pending payments synced
 */
export async function syncPagosPendientes(
  controlEgresosId: string,
  dashboardId: string
): Promise<Result<number, Error>> {
  const correlationId = getCorrelationId();

  try {
    info('Starting Pagos Pendientes sync', {
      module: 'pagos-pendientes',
      phase: 'sync',
      controlEgresosId,
      dashboardId,
      correlationId,
    });

    // 1. Read all facturas recibidas (A:S)
    const facturasResult = await getValues(
      controlEgresosId,
      'Facturas Recibidas!A:S'
    );

    if (!facturasResult.ok) {
      return facturasResult;
    }

    const rows = facturasResult.value;

    // Skip if no data (only headers or empty)
    if (rows.length <= 1) {
      info('No facturas recibidas found', {
        module: 'pagos-pendientes',
        phase: 'sync',
        correlationId,
      });
      return { ok: true, value: 0 };
    }

    // 2. Filter where pagada !== 'SI' (includes 'NO' and empty)
    // Skip header row (index 0)
    const unpaidFacturas = rows.slice(1).filter((row) => {
      const pagada = row[18]; // Column S (index 18)
      return pagada !== 'SI';
    });

    info('Found unpaid facturas', {
      module: 'pagos-pendientes',
      phase: 'filter',
      total: rows.length - 1,
      unpaid: unpaidFacturas.length,
      correlationId,
    });

    // 3. Clear Pagos Pendientes sheet data (preserve header)
    const clearResult = await clearSheetData(dashboardId, 'Pagos Pendientes');
    if (!clearResult.ok) {
      return clearResult;
    }

    // If no unpaid facturas, we're done (sheet is already cleared)
    if (unpaidFacturas.length === 0) {
      info('No pending payments to sync', {
        module: 'pagos-pendientes',
        phase: 'sync',
        correlationId,
      });
      return { ok: true, value: 0 };
    }

    // 4. Map to PAGOS_PENDIENTES columns
    // PAGOS_PENDIENTES_HEADERS: fechaEmision, fileId, fileName, tipoComprobante,
    //   nroFactura, cuitEmisor, razonSocialEmisor, importeTotal, moneda, concepto
    const pagosPendientesRows = unpaidFacturas.map((row) => [
      row[0] || '',  // fechaEmision (A)
      row[1] || '',  // fileId (B)
      row[2] || '',  // fileName (C)
      row[3] || '',  // tipoComprobante (D)
      row[4] || '',  // nroFactura (E)
      row[5] || '',  // cuitEmisor (F)
      row[6] || '',  // razonSocialEmisor (G)
      row[9] || '',  // importeTotal (J)
      row[10] || '', // moneda (K)
      row[11] || '', // concepto (L)
    ]);

    // 5. Write filtered rows to Pagos Pendientes
    const appendResult = await appendRowsWithFormatting(
      dashboardId,
      'Pagos Pendientes!A:J',
      pagosPendientesRows
    );

    if (!appendResult.ok) {
      return appendResult;
    }

    info('Pagos Pendientes sync complete', {
      module: 'pagos-pendientes',
      phase: 'sync',
      syncedCount: unpaidFacturas.length,
      correlationId,
    });

    // 6. Return count
    return { ok: true, value: unpaidFacturas.length };
  } catch (error) {
    warn('Pagos Pendientes sync failed', {
      module: 'pagos-pendientes',
      phase: 'sync',
      error: error instanceof Error ? error.message : String(error),
      correlationId,
    });

    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
