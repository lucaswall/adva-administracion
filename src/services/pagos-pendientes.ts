/**
 * Pagos Pendientes service
 * Syncs unpaid invoices from Control de Egresos to Dashboard's Pagos Pendientes sheet
 */

import type { Result } from '../types/index.js';
import {
  getValues,
  appendRowsWithLinks,
  clearSheetData,
  getSpreadsheetTimezone,
  type CellValueOrLink,
} from './sheets.js';
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
 * Builds a Drive web view URL for a given fileId.
 */
function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
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

    // Get header row and find all required column indices upfront
    const headers = rows[0];
    const pagadaIdx = getColumnIndex(headers, 'pagada');
    const fechaEmisionIdx = getColumnIndex(headers, 'fechaEmision');
    const fileIdIdx = getColumnIndex(headers, 'fileId');
    const fileNameIdx = getColumnIndex(headers, 'fileName');
    const tipoComprobanteIdx = getColumnIndex(headers, 'tipoComprobante');
    const nroFacturaIdx = getColumnIndex(headers, 'nroFactura');
    const cuitEmisorIdx = getColumnIndex(headers, 'cuitEmisor');
    const razonSocialEmisorIdx = getColumnIndex(headers, 'razonSocialEmisor');
    const importeTotalIdx = getColumnIndex(headers, 'importeTotal');
    const monedaIdx = getColumnIndex(headers, 'moneda');
    const conceptoIdx = getColumnIndex(headers, 'concepto');

    const requiredColumns = [
      { name: 'pagada', idx: pagadaIdx },
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

    // 2. Filter: skip orphan/empty rows (defensive — empty rows in source must
    // not propagate as blank lines in the dashboard) AND skip rows where
    // pagada === 'SI' (paid invoices). Trim before checking so whitespace-only
    // cells are also rejected.
    const unpaidFacturas = rows.slice(1).filter((row) => {
      if (!String(row[fileIdIdx] ?? '').trim()) return false;
      if (!String(row[fechaEmisionIdx] ?? '').trim()) return false;
      const pagada = row[pagadaIdx];
      return pagada !== 'SI';
    });

    // Sort unpaid facturas by fechaEmision ascending (oldest first)
    unpaidFacturas.sort((a, b) => {
      const dateA = normalizeSpreadsheetDate(a[fechaEmisionIdx]);
      const dateB = normalizeSpreadsheetDate(b[fechaEmisionIdx]);
      return dateA.localeCompare(dateB);
    });

    info('Found unpaid facturas', {
      module: 'pagos-pendientes',
      phase: 'filter',
      total: rows.length - 1,
      unpaid: unpaidFacturas.length,
      correlationId,
    });

    // 3. Map to PAGOS_PENDIENTES columns. fileName is written as a {text, url}
    // hyperlink so it remains clickable in the dashboard.
    const pagosPendientesRows: CellValueOrLink[][] = unpaidFacturas.map((row) => {
      const fileId = String(row[fileIdIdx] ?? '');
      const fileName = String(row[fileNameIdx] ?? '');
      return [
        normalizeSpreadsheetDate(row[fechaEmisionIdx]) || '',
        fileId,
        { text: fileName, url: driveViewUrl(fileId) },
        row[tipoComprobanteIdx] ?? '',
        row[nroFacturaIdx] ?? '',
        row[cuitEmisorIdx] ?? '',
        row[razonSocialEmisorIdx] ?? '',
        row[importeTotalIdx] ?? '',
        row[monedaIdx] ?? '',
        row[conceptoIdx] ?? '',
      ] as CellValueOrLink[];
    });

    // ADV-13: Data loss prevention.
    // Pagos Pendientes is a derived view from Control de Egresos. Even if this
    // sync fails, the source data is preserved and the view can be regenerated
    // by re-running the sync.

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

    // 6. Write new data with hyperlinked fileName cells. appendRowsWithLinks
    // appends after the last filled row (which is the preserved header).
    const tzResult = await getSpreadsheetTimezone(dashboardId);
    if (!tzResult.ok) {
      warn('Failed to get spreadsheet timezone — timestamps may be in UTC', {
        module: 'pagos-pendientes',
        phase: 'sync',
        error: tzResult.error.message,
        correlationId,
      });
    }
    const timeZone = tzResult.ok ? tzResult.value : undefined;

    const writeResult = await appendRowsWithLinks(
      dashboardId,
      'Pagos Pendientes!A:J',
      pagosPendientesRows,
      timeZone,
    );

    if (!writeResult.ok) {
      warn('Failed to write pending payments - re-run sync to restore', {
        module: 'pagos-pendientes',
        phase: 'sync',
        error: writeResult.error.message,
        correlationId,
      });
      return writeResult;
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

    // Get header row and find all required column indices upfront
    const headers = rows[0];
    const pagadaIdx = getColumnIndex(headers, 'pagada');
    const fechaEmisionIdx = getColumnIndex(headers, 'fechaEmision');
    const fileIdIdx = getColumnIndex(headers, 'fileId');
    const fileNameIdx = getColumnIndex(headers, 'fileName');
    const tipoComprobanteIdx = getColumnIndex(headers, 'tipoComprobante');
    const nroFacturaIdx = getColumnIndex(headers, 'nroFactura');
    const cuitReceptorIdx = getColumnIndex(headers, 'cuitReceptor');
    const razonSocialReceptorIdx = getColumnIndex(headers, 'razonSocialReceptor');
    const importeTotalIdx = getColumnIndex(headers, 'importeTotal');
    const monedaIdx = getColumnIndex(headers, 'moneda');
    const conceptoIdx = getColumnIndex(headers, 'concepto');

    const requiredColumns = [
      { name: 'pagada', idx: pagadaIdx },
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

    // 2. Filter: skip orphan/empty rows (defensive — empty rows in source must
    // not propagate as blank lines in the dashboard); skip pagada=SI; exclude
    // NC/ND tipoComprobante. Trim before checking so whitespace-only cells
    // are also rejected.
    const unpaidCobros = rows.slice(1).filter((row) => {
      if (!String(row[fileIdIdx] ?? '').trim()) return false;
      if (!String(row[fechaEmisionIdx] ?? '').trim()) return false;

      const pagada = row[pagadaIdx];
      if (pagada === 'SI') return false;

      const tipoComprobante = String(row[tipoComprobanteIdx] || '');
      if (tipoComprobante.startsWith('NC') || tipoComprobante.startsWith('ND')) {
        return false;
      }

      return true;
    });

    // Sort unpaid cobros by fechaEmision ascending (oldest first)
    unpaidCobros.sort((a, b) => {
      const dateA = normalizeSpreadsheetDate(a[fechaEmisionIdx]);
      const dateB = normalizeSpreadsheetDate(b[fechaEmisionIdx]);
      return dateA.localeCompare(dateB);
    });

    info('Found unpaid cobros', {
      module: 'pagos-pendientes',
      phase: 'filter',
      total: rows.length - 1,
      unpaid: unpaidCobros.length,
      correlationId,
    });

    // 3. Map to COBROS_PENDIENTES columns with hyperlinked fileName.
    const cobrosPendientesRows: CellValueOrLink[][] = unpaidCobros.map((row) => {
      const fileId = String(row[fileIdIdx] ?? '');
      const fileName = String(row[fileNameIdx] ?? '');
      return [
        normalizeSpreadsheetDate(row[fechaEmisionIdx]) || '',
        fileId,
        { text: fileName, url: driveViewUrl(fileId) },
        row[tipoComprobanteIdx] ?? '',
        row[nroFacturaIdx] ?? '',
        row[cuitReceptorIdx] ?? '',
        row[razonSocialReceptorIdx] ?? '',
        row[importeTotalIdx] ?? '',
        row[monedaIdx] ?? '',
        row[conceptoIdx] ?? '',
      ] as CellValueOrLink[];
    });

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

    // 6. Write new data with hyperlinked fileName cells.
    const tzResult = await getSpreadsheetTimezone(dashboardId);
    if (!tzResult.ok) {
      warn('Failed to get spreadsheet timezone — timestamps may be in UTC', {
        module: 'pagos-pendientes',
        phase: 'sync',
        error: tzResult.error.message,
        correlationId,
      });
    }
    const timeZone = tzResult.ok ? tzResult.value : undefined;

    const writeResult = await appendRowsWithLinks(
      dashboardId,
      'Cobros Pendientes!A:J',
      cobrosPendientesRows,
      timeZone,
    );

    if (!writeResult.ok) {
      warn('Failed to write pending cobros - re-run sync to restore', {
        module: 'pagos-pendientes',
        phase: 'sync',
        error: writeResult.error.message,
        correlationId,
      });
      return writeResult;
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
