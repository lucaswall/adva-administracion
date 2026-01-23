/**
 * Storage module index - exports all storage functions
 */

import { getValues } from '../../services/sheets.js';

// Re-export storage functions
export { storeFactura } from './factura-store.js';
export { storePago } from './pago-store.js';
export { storeRecibo } from './recibo-store.js';
export { storeRetencion } from './retencion-store.js';

/**
 * Gets list of already processed file IDs from both control spreadsheets
 *
 * @param controlIngresosId - Control de Ingresos spreadsheet ID
 * @param controlEgresosId - Control de Egresos spreadsheet ID
 */
export async function getProcessedFileIds(
  controlIngresosId: string,
  controlEgresosId: string
): Promise<Set<string>> {
  const processedIds = new Set<string>();

  /**
   * Helper to extract file IDs from a sheet's second column (B - fileId)
   */
  const extractFileIds = async (spreadsheetId: string, sheetName: string) => {
    const result = await getValues(spreadsheetId, `${sheetName}!B:B`);
    if (result.ok && result.value.length > 1) {
      for (let i = 1; i < result.value.length; i++) {
        const row = result.value[i];
        if (row && row[0]) {
          processedIds.add(String(row[0]));
        }
      }
    }
  };

  // Get from Control de Ingresos
  await extractFileIds(controlIngresosId, 'Facturas Emitidas');
  await extractFileIds(controlIngresosId, 'Pagos Recibidos');
  await extractFileIds(controlIngresosId, 'Retenciones Recibidas');

  // Get from Control de Egresos
  await extractFileIds(controlEgresosId, 'Facturas Recibidas');
  await extractFileIds(controlEgresosId, 'Pagos Enviados');
  await extractFileIds(controlEgresosId, 'Recibos');

  return processedIds;
}
