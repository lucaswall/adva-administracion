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
 * @param controlCreditosId - Control de Creditos spreadsheet ID
 * @param controlDebitosId - Control de Debitos spreadsheet ID
 */
export async function getProcessedFileIds(
  controlCreditosId: string,
  controlDebitosId: string
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

  // Get from Control de Creditos
  await extractFileIds(controlCreditosId, 'Facturas Emitidas');
  await extractFileIds(controlCreditosId, 'Pagos Recibidos');
  await extractFileIds(controlCreditosId, 'Retenciones Recibidas');

  // Get from Control de Debitos
  await extractFileIds(controlDebitosId, 'Facturas Recibidas');
  await extractFileIds(controlDebitosId, 'Pagos Enviados');
  await extractFileIds(controlDebitosId, 'Recibos');

  return processedIds;
}
