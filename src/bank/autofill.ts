/**
 * Bank movement auto-fill functionality
 * Automatically fills descriptions for bank movements based on matched documents
 */

import type {
  Result,
  BankAutoFillResult,
  BankMovement,
  Factura,
  Pago,
  Recibo,
  MatchConfidence,
} from '../types/index.js';
import { getValues, batchUpdate, type CellValue } from '../services/sheets.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { BankMovementMatcher } from './matcher.js';
import { parseNumber } from '../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../utils/date.js';
import { getConfig } from '../config.js';
import { warn } from '../utils/logger.js';

/** Minimum number of columns required for a valid movement row */
const MIN_MOVEMENT_COLUMNS = 9;

/**
 * Parses a row from the bank movements sheet into a BankMovement object
 */
export function parseMovementRow(row: CellValue[], rowNumber: number): BankMovement | null {
  // Columns: Fecha, FechaValor, Concepto, Codigo, Oficina, AreaADVA, Credito, Debito, Detalle
  // Ensure row has enough elements before accessing indices
  if (row.length < MIN_MOVEMENT_COLUMNS) return null;
  if (!row[0] || !row[2]) return null; // Need at least date and concepto

  return {
    row: rowNumber,
    fecha: normalizeSpreadsheetDate(row[0]),
    fechaValor: normalizeSpreadsheetDate(row[1]),
    concepto: String(row[2] || ''),
    codigo: String(row[3] || ''),
    oficina: String(row[4] || ''),
    areaAdva: String(row[5] || ''),
    credito: row[6] !== null && row[6] !== undefined && row[6] !== '' ? Number(row[6]) : null,
    debito: row[7] !== null && row[7] !== undefined && row[7] !== '' ? Number(row[7]) : null,
    detalle: String(row[8] || ''),
  };
}

/**
 * Parses facturas from sheet data
 */
function parseFacturas(data: CellValue[][]): Array<Factura & { row: number }> {
  const facturas: Array<Factura & { row: number }> = [];

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    facturas.push({
      row: i + 1,
      fechaEmision: normalizeSpreadsheetDate(row[0]),
      fileId: String(row[1] || ''),
      fileName: String(row[2] || ''),
      tipoComprobante: (row[3] || 'A') as Factura['tipoComprobante'],
      nroFactura: String(row[4] || ''),
      cuitEmisor: String(row[5] || ''),
      razonSocialEmisor: String(row[6] || ''),
      cuitReceptor: row[7] ? String(row[7]) : undefined,
      importeNeto: parseNumber(row[8]) || 0,
      importeIva: parseNumber(row[9]) || 0,
      importeTotal: parseNumber(row[10]) || 0,
      moneda: (row[11] || 'ARS') as Factura['moneda'],
      concepto: row[12] ? String(row[12]) : undefined,
      processedAt: String(row[13] || ''),
      confidence: Number(row[14]) || 0,
      needsReview: row[15] === 'YES',
      matchedPagoFileId: row[16] ? String(row[16]) : undefined,
      matchConfidence: row[17] ? (String(row[17]) as MatchConfidence) : undefined,
      hasCuitMatch: row[18] === 'YES',
    });
  }

  return facturas;
}

/**
 * Parses pagos from sheet data
 */
function parsePagos(data: CellValue[][]): Array<Pago & { row: number }> {
  const pagos: Array<Pago & { row: number }> = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    pagos.push({
      row: i + 1,
      fechaPago: normalizeSpreadsheetDate(row[0]),
      fileId: String(row[1] || ''),
      fileName: String(row[2] || ''),
      banco: String(row[3] || ''),
      importePagado: parseNumber(row[4]) || 0,
      moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
      referencia: row[6] ? String(row[6]) : undefined,
      cuitPagador: row[7] ? String(row[7]) : undefined,
      nombrePagador: row[8] ? String(row[8]) : undefined,
      cuitBeneficiario: row[9] ? String(row[9]) : undefined,
      nombreBeneficiario: row[10] ? String(row[10]) : undefined,
      concepto: row[11] ? String(row[11]) : undefined,
      processedAt: String(row[12] || ''),
      confidence: Number(row[13]) || 0,
      needsReview: row[14] === 'YES',
      matchedFacturaFileId: row[15] ? String(row[15]) : undefined,
      matchConfidence: row[16] ? (String(row[16]) as MatchConfidence) : undefined,
    });
  }

  return pagos;
}

/**
 * Parses recibos from sheet data
 */
function parseRecibos(data: CellValue[][]): Array<Recibo & { row: number }> {
  const recibos: Array<Recibo & { row: number }> = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    recibos.push({
      row: i + 1,
      fechaPago: normalizeSpreadsheetDate(row[0]),
      fileId: String(row[1] || ''),
      fileName: String(row[2] || ''),
      tipoRecibo: (row[3] || 'sueldo') as Recibo['tipoRecibo'],
      nombreEmpleado: String(row[4] || ''),
      cuilEmpleado: String(row[5] || ''),
      legajo: String(row[6] || ''),
      tareaDesempenada: row[7] ? String(row[7]) : undefined,
      cuitEmpleador: String(row[8] || ''),
      periodoAbonado: String(row[9] || ''),
      subtotalRemuneraciones: parseNumber(row[10]) || 0,
      subtotalDescuentos: parseNumber(row[11]) || 0,
      totalNeto: parseNumber(row[12]) || 0,
      processedAt: String(row[13] || ''),
      confidence: Number(row[14]) || 0,
      needsReview: row[15] === 'YES',
      matchedPagoFileId: row[16] ? String(row[16]) : undefined,
      matchConfidence: row[17] ? (String(row[17]) as MatchConfidence) : undefined,
    });
  }

  return recibos;
}

/**
 * Auto-fills bank movement descriptions based on matched documents
 *
 * @param bankName - Optional bank name to filter (if not provided, processes all banks)
 * @returns Auto-fill result with statistics
 *
 * Note: Returns ok:true for partial success (some rows processed successfully).
 * Check result.errors count to determine if any errors occurred during processing.
 * Only returns ok:false for complete failures (e.g., cannot read spreadsheets).
 */
export async function autoFillBankMovements(
  bankName?: string
): Promise<Result<BankAutoFillResult, Error>> {
  const startTime = Date.now();
  const folderStructure = getCachedFolderStructure();

  if (!folderStructure) {
    return {
      ok: false,
      error: new Error('Folder structure not initialized'),
    };
  }

  const config = getConfig();
  const matcher = new BankMovementMatcher(config.usdArsTolerancePercent);
  const controlIngresosId = folderStructure.controlIngresosId;
  const controlEgresosId = folderStructure.controlEgresosId;

  // Get all document data from both control spreadsheets
  // Control de Ingresos: Facturas Emitidas (issued by ADVA), Pagos Recibidos (received by ADVA)
  // Control de Egresos: Facturas Recibidas (received by ADVA), Pagos Enviados (sent by ADVA), Recibos
  const facturasEmitidasResult = await getValues(controlIngresosId, 'Facturas Emitidas!A:W');
  if (!facturasEmitidasResult.ok) return facturasEmitidasResult;

  const facturasRecibidasResult = await getValues(controlEgresosId, 'Facturas Recibidas!A:W');
  if (!facturasRecibidasResult.ok) return facturasRecibidasResult;

  const pagosRecibidosResult = await getValues(controlIngresosId, 'Pagos Recibidos!A:R');
  if (!pagosRecibidosResult.ok) return pagosRecibidosResult;

  const pagosEnviadosResult = await getValues(controlEgresosId, 'Pagos Enviados!A:R');
  if (!pagosEnviadosResult.ok) return pagosEnviadosResult;

  const recibosResult = await getValues(controlEgresosId, 'Recibos!A:S');
  if (!recibosResult.ok) return recibosResult;

  // Combine facturas from both spreadsheets for matching
  const facturasEmitidas = parseFacturas(facturasEmitidasResult.value);
  const facturasRecibidas = parseFacturas(facturasRecibidasResult.value);
  const facturas = [...facturasEmitidas, ...facturasRecibidas];

  // Combine pagos from both spreadsheets for matching
  const pagosRecibidos = parsePagos(pagosRecibidosResult.value);
  const pagosEnviados = parsePagos(pagosEnviadosResult.value);
  const pagos = [...pagosRecibidos, ...pagosEnviados];

  const recibos = parseRecibos(recibosResult.value);

  const result: BankAutoFillResult = {
    rowsProcessed: 0,
    rowsFilled: 0,
    bankFeeMatches: 0,
    creditCardPaymentMatches: 0,
    pagoFacturaMatches: 0,
    directFacturaMatches: 0,
    reciboMatches: 0,
    pagoOnlyMatches: 0,
    noMatches: 0,
    errors: 0,
    failedBanks: [],
    duration: 0,
  };

  // Get bank spreadsheets to process
  const banksToProcess: Array<[string, string | undefined]> = bankName
    ? [[bankName, folderStructure.bankSpreadsheets.get(bankName)]]
    : Array.from(folderStructure.bankSpreadsheets.entries());

  for (const [bName, spreadsheetId] of banksToProcess) {
    if (!spreadsheetId) {
      warn('Bank spreadsheet ID not found', { bankName: bName });
      result.errors++;
      result.failedBanks.push(bName);
      continue;
    }

    // Get bank movements
    const movementsResult = await getValues(spreadsheetId, 'Movimientos!A:I');
    if (!movementsResult.ok) {
      warn('Bank movement loading failed', { bankName: bName, error: movementsResult.error });
      result.errors++;
      result.failedBanks.push(bName);
      continue;
    }

    const movements: BankMovement[] = [];

    // Skip header row
    for (let i = 1; i < movementsResult.value.length; i++) {
      const row = movementsResult.value[i];
      if (!row) continue;

      const movement = parseMovementRow(row, i + 1);
      if (movement && !movement.detalle) { // Only process rows without existing details
        movements.push(movement);
      }
    }

    result.rowsProcessed += movements.length;

    // Match each movement and collect updates
    const updates: Array<{ range: string; values: (string | number)[][] }> = [];

    for (const movement of movements) {
      const matchResult = matcher.matchMovement(movement, facturas, recibos, pagos);

      if (matchResult.matchType !== 'no_match' && matchResult.description) {
        updates.push({
          range: `Movimientos!I${movement.row}`,
          values: [[matchResult.description]],
        });
        result.rowsFilled++;

        // Update statistics
        switch (matchResult.matchType) {
          case 'bank_fee':
            result.bankFeeMatches++;
            break;
          case 'credit_card_payment':
            result.creditCardPaymentMatches++;
            break;
          case 'pago_factura':
            result.pagoFacturaMatches++;
            break;
          case 'direct_factura':
            result.directFacturaMatches++;
            break;
          case 'recibo':
            result.reciboMatches++;
            break;
          case 'pago_only':
            result.pagoOnlyMatches++;
            break;
        }
      } else {
        result.noMatches++;
      }
    }

    // Apply all updates in batch
    if (updates.length > 0) {
      const updateResult = await batchUpdate(spreadsheetId, updates);
      if (!updateResult.ok) {
        warn('Bank update failed', { bankName: bName, error: updateResult.error });
        result.errors++;
        result.failedBanks.push(bName);
      }
    }
  }

  result.duration = Date.now() - startTime;
  return { ok: true, value: result };
}
