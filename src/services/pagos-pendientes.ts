/**
 * Pagos Pendientes service
 * Syncs unpaid invoices from Control de Egresos to Dashboard's Pagos Pendientes sheet
 */

import type { Result } from '../types/index.js';
import { getValues, setValues, clearSheetData } from './sheets.js';
import { info, warn } from '../utils/logger.js';
import { getCorrelationId } from '../utils/correlation.js';

/**
 * Gets the column index for a given header name
 *
 * @param headers - Array of header names from first row
 * @param columnName - Name of the column to find
 * @returns Column index (0-based), or -1 if not found
 */
function getColumnIndex(headers: unknown[], columnName: string): number {
  return headers.findIndex((header) => header === columnName);
}

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

    // Get header row and find column indices
    const headers = rows[0];
    const pagadaIdx = getColumnIndex(headers, 'pagada');

    // Validate required columns exist
    if (pagadaIdx === -1) {
      return {
        ok: false,
        error: new Error('Required column "pagada" not found in Facturas Recibidas sheet'),
      };
    }

    // 2. Filter where pagada !== 'SI' (includes 'NO' and empty)
    // Skip header row (index 0)
    const unpaidFacturas = rows.slice(1).filter((row) => {
      const pagada = row[pagadaIdx];
      return pagada !== 'SI';
    });

    // Find fechaEmision column index early (needed for sorting)
    const fechaEmisionIdx = getColumnIndex(headers, 'fechaEmision');

    // Sort unpaid facturas by fechaEmision ascending (oldest first)
    if (fechaEmisionIdx !== -1) {
      unpaidFacturas.sort((a, b) => {
        const dateA = String(a[fechaEmisionIdx] || '');
        const dateB = String(b[fechaEmisionIdx] || '');
        return dateA.localeCompare(dateB);
      });
    }

    info('Found unpaid facturas', {
      module: 'pagos-pendientes',
      phase: 'filter',
      total: rows.length - 1,
      unpaid: unpaidFacturas.length,
      correlationId,
    });

    // Find remaining required column indices (fechaEmisionIdx already found above)
    const fileIdIdx = getColumnIndex(headers, 'fileId');
    const fileNameIdx = getColumnIndex(headers, 'fileName');
    const tipoComprobanteIdx = getColumnIndex(headers, 'tipoComprobante');
    const nroFacturaIdx = getColumnIndex(headers, 'nroFactura');
    const cuitEmisorIdx = getColumnIndex(headers, 'cuitEmisor');
    const razonSocialEmisorIdx = getColumnIndex(headers, 'razonSocialEmisor');
    const importeTotalIdx = getColumnIndex(headers, 'importeTotal');
    const monedaIdx = getColumnIndex(headers, 'moneda');
    const conceptoIdx = getColumnIndex(headers, 'concepto');

    // Validate all required columns exist
    const requiredColumns = [
      { name: 'fechaEmision', idx: fechaEmisionIdx },
      { name: 'fileId', idx: fileIdIdx },
      { name: 'fileName', idx: fileNameIdx },
      { name: 'tipoComprobante', idx: tipoComprobanteIdx },
      { name: 'nroFactura', idx: nroFacturaIdx },
      { name: 'cuitEmisor', idx: cuitEmisorIdx },
      { name: 'razonSocialEmisor', idx: razonSocialEmisorIdx },
      { name: 'importeTotal', idx: importeTotalIdx },
      { name: 'moneda', idx: monedaIdx },
      { name: 'concepto', idx: conceptoIdx },
    ];

    for (const { name, idx } of requiredColumns) {
      if (idx === -1) {
        return {
          ok: false,
          error: new Error(`Required column "${name}" not found in Facturas Recibidas sheet`),
        };
      }
    }

    // 3. Map to PAGOS_PENDIENTES columns
    // PAGOS_PENDIENTES_HEADERS: fechaEmision, fileId, fileName, tipoComprobante,
    //   nroFactura, cuitEmisor, razonSocialEmisor, importeTotal, moneda, concepto
    const pagosPendientesRows = unpaidFacturas.map((row) => [
      row[fechaEmisionIdx] || '',
      row[fileIdIdx] || '',
      row[fileNameIdx] || '',
      row[tipoComprobanteIdx] || '',
      row[nroFacturaIdx] || '',
      row[cuitEmisorIdx] || '',
      row[razonSocialEmisorIdx] || '',
      row[importeTotalIdx] || '',
      row[monedaIdx] || '',
      row[conceptoIdx] || '',
    ]);

    // 4. Clear existing data rows (preserve header)
    const clearResult = await clearSheetData(dashboardId, 'Pagos Pendientes');
    if (!clearResult.ok) {
      return clearResult;
    }

    // 5. If no data to write, we're done (sheet is cleared)
    if (pagosPendientesRows.length === 0) {
      info('Pagos Pendientes sync complete - no pending payments', {
        module: 'pagos-pendientes',
        phase: 'sync',
        syncedCount: 0,
        correlationId,
      });
      return { ok: true, value: 0 };
    }

    // 6. Write new data
    const setResult = await setValues(
      dashboardId,
      'Pagos Pendientes!A2:J',
      pagosPendientesRows
    );

    if (!setResult.ok) {
      warn('Failed to write pending payments after clearing - data lost', {
        module: 'pagos-pendientes',
        phase: 'sync',
        error: setResult.error.message,
        correlationId,
      });
      return setResult;
    }

    info('Pagos Pendientes sync complete', {
      module: 'pagos-pendientes',
      phase: 'sync',
      syncedCount: unpaidFacturas.length,
      correlationId,
    });

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
