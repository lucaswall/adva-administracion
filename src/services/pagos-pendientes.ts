/**
 * Pagos Pendientes service
 * Syncs unpaid invoices from Control de Egresos to Dashboard's Pagos Pendientes sheet
 */

import type { Result } from '../types/index.js';
import { getValues, setValues, clearSheetData } from './sheets.js';
import { info, warn, error as logError } from '../utils/logger.js';
import { getCorrelationId } from '../utils/correlation.js';
import { normalizeSpreadsheetDate } from '../utils/date.js';

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
        const dateA = normalizeSpreadsheetDate(a[fechaEmisionIdx]);
        const dateB = normalizeSpreadsheetDate(b[fechaEmisionIdx]);
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
      normalizeSpreadsheetDate(row[fechaEmisionIdx]) || '',
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

    // ADV-13: Data loss prevention
    // Pagos Pendientes is a derived view from Control de Egresos.
    // Even if this sync fails, the source data (unpaid invoices) is preserved
    // in Control de Egresos and can be regenerated by re-running the sync.
    //
    // We clear first, then write. If write fails after clear:
    // - The Pagos Pendientes sheet is temporarily empty
    // - The source data in Control de Egresos is intact
    // - Re-running syncPagosPendientes will restore the view

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
      // Write failed after clear - Pagos Pendientes is temporarily empty
      // Source data in Control de Egresos is intact, re-run sync to restore
      warn('Failed to write pending payments - re-run sync to restore', {
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
  } catch (err) {
    logError('Pagos Pendientes sync failed', {
      module: 'pagos-pendientes',
      phase: 'sync',
      error: err instanceof Error ? err.message : String(err),
      correlationId,
    });

    return {
      ok: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Syncs uncollected invoices (facturas emitidas) to Dashboard's Cobros Pendientes sheet
 *
 * @param controlIngresosId - Control de Ingresos spreadsheet ID
 * @param dashboardId - Dashboard Operativo spreadsheet ID
 * @returns Number of pending cobros synced
 */
export async function syncCobrosPendientes(
  controlIngresosId: string,
  dashboardId: string
): Promise<Result<number, Error>> {
  const correlationId = getCorrelationId();

  try {
    info('Starting Cobros Pendientes sync', {
      module: 'pagos-pendientes',
      phase: 'sync',
      controlIngresosId,
      dashboardId,
      correlationId,
    });

    // 1. Read all facturas emitidas (A:T — 20 columns after pagada column added)
    const facturasResult = await getValues(
      controlIngresosId,
      'Facturas Emitidas!A:T'
    );

    if (!facturasResult.ok) {
      return facturasResult;
    }

    const rows = facturasResult.value;

    // Skip if no data (only headers or empty)
    if (rows.length <= 1) {
      info('No facturas emitidas found', {
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
        error: new Error('Required column "pagada" not found in Facturas Emitidas sheet'),
      };
    }

    // Find fechaEmision column index early (needed for sorting)
    const fechaEmisionIdx = getColumnIndex(headers, 'fechaEmision');
    const tipoComprobanteIdx = getColumnIndex(headers, 'tipoComprobante');

    // 2. Filter: pagada !== 'SI' AND exclude NC/ND tipoComprobante
    // Skip header row (index 0)
    const unpaidCobros = rows.slice(1).filter((row) => {
      const pagada = row[pagadaIdx];
      if (pagada === 'SI') return false;

      // Exclude NC (Nota de Crédito) and ND (Nota de Débito)
      if (tipoComprobanteIdx !== -1) {
        const tipoComprobante = String(row[tipoComprobanteIdx] || '');
        if (tipoComprobante.startsWith('NC') || tipoComprobante.startsWith('ND')) {
          return false;
        }
      }

      return true;
    });

    // Sort unpaid cobros by fechaEmision ascending (oldest first)
    if (fechaEmisionIdx !== -1) {
      unpaidCobros.sort((a, b) => {
        const dateA = normalizeSpreadsheetDate(a[fechaEmisionIdx]);
        const dateB = normalizeSpreadsheetDate(b[fechaEmisionIdx]);
        return dateA.localeCompare(dateB);
      });
    }

    info('Found unpaid cobros', {
      module: 'pagos-pendientes',
      phase: 'filter',
      total: rows.length - 1,
      unpaid: unpaidCobros.length,
      correlationId,
    });

    // Find remaining required column indices
    const fileIdIdx = getColumnIndex(headers, 'fileId');
    const fileNameIdx = getColumnIndex(headers, 'fileName');
    const nroFacturaIdx = getColumnIndex(headers, 'nroFactura');
    const cuitReceptorIdx = getColumnIndex(headers, 'cuitReceptor');
    const razonSocialReceptorIdx = getColumnIndex(headers, 'razonSocialReceptor');
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
      { name: 'cuitReceptor', idx: cuitReceptorIdx },
      { name: 'razonSocialReceptor', idx: razonSocialReceptorIdx },
      { name: 'importeTotal', idx: importeTotalIdx },
      { name: 'moneda', idx: monedaIdx },
      { name: 'concepto', idx: conceptoIdx },
    ];

    for (const { name, idx } of requiredColumns) {
      if (idx === -1) {
        return {
          ok: false,
          error: new Error(`Required column "${name}" not found in Facturas Emitidas sheet`),
        };
      }
    }

    // 3. Map to COBROS_PENDIENTES columns
    // COBROS_PENDIENTES_HEADERS: fechaEmision, fileId, fileName, tipoComprobante,
    //   nroFactura, cuitReceptor, razonSocialReceptor, importeTotal, moneda, concepto
    const cobrosPendientesRows = unpaidCobros.map((row) => [
      normalizeSpreadsheetDate(row[fechaEmisionIdx]) || '',
      row[fileIdIdx] || '',
      row[fileNameIdx] || '',
      row[tipoComprobanteIdx] || '',
      row[nroFacturaIdx] || '',
      row[cuitReceptorIdx] || '',
      row[razonSocialReceptorIdx] || '',
      row[importeTotalIdx] || '',
      row[monedaIdx] || '',
      row[conceptoIdx] || '',
    ]);

    // Cobros Pendientes is a derived view from Control de Ingresos.
    // Even if this sync fails, the source data (uncollected invoices) is preserved
    // in Control de Ingresos and can be regenerated by re-running the sync.
    //
    // We clear first, then write. If write fails after clear:
    // - The Cobros Pendientes sheet is temporarily empty
    // - The source data in Control de Ingresos is intact
    // - Re-running syncCobrosPendientes will restore the view

    // 4. Clear existing data rows (preserve header)
    const clearResult = await clearSheetData(dashboardId, 'Cobros Pendientes');
    if (!clearResult.ok) {
      return clearResult;
    }

    // 5. If no data to write, we're done (sheet is cleared)
    if (cobrosPendientesRows.length === 0) {
      info('Cobros Pendientes sync complete - no pending cobros', {
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
      'Cobros Pendientes!A2:J',
      cobrosPendientesRows
    );

    if (!setResult.ok) {
      // Write failed after clear — Cobros Pendientes is temporarily empty
      // Source data in Control de Ingresos is intact, re-run sync to restore
      warn('Failed to write pending cobros - re-run sync to restore', {
        module: 'pagos-pendientes',
        phase: 'sync',
        error: setResult.error.message,
        correlationId,
      });
      return setResult;
    }

    info('Cobros Pendientes sync complete', {
      module: 'pagos-pendientes',
      phase: 'sync',
      syncedCount: unpaidCobros.length,
      correlationId,
    });

    return { ok: true, value: unpaidCobros.length };
  } catch (err) {
    logError('Cobros Pendientes sync failed', {
      module: 'pagos-pendientes',
      phase: 'sync',
      error: err instanceof Error ? err.message : String(err),
      correlationId,
    });

    return {
      ok: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
