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
import { getValues, batchUpdate } from '../services/sheets.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { BankMovementMatcher } from './matcher.js';
import { getConfig } from '../config.js';

/**
 * Parses a row from the bank movements sheet into a BankMovement object
 */
function parseMovementRow(row: (string | number | boolean | null | undefined)[], rowNumber: number): BankMovement | null {
  // Columns: Fecha, FechaValor, Concepto, Codigo, Oficina, AreaADVA, Credito, Debito, Detalle
  if (!row[0] || !row[2]) return null; // Need at least date and concepto

  return {
    row: rowNumber,
    fecha: String(row[0] || ''),
    fechaValor: String(row[1] || ''),
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
function parseFacturas(data: (string | number | boolean | null | undefined)[][]): Array<Factura & { row: number }> {
  const facturas: Array<Factura & { row: number }> = [];

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    facturas.push({
      row: i + 1,
      fileId: String(row[0] || ''),
      fileName: String(row[1] || ''),
      folderPath: String(row[2] || ''),
      tipoComprobante: (row[3] || 'A') as Factura['tipoComprobante'],
      puntoVenta: String(row[4] || ''),
      numeroComprobante: String(row[5] || ''),
      fechaEmision: String(row[6] || ''),
      fechaVtoCae: String(row[7] || ''),
      cuitEmisor: String(row[8] || ''),
      razonSocialEmisor: String(row[9] || ''),
      cuitReceptor: row[10] ? String(row[10]) : undefined,
      cae: String(row[11] || ''),
      importeNeto: Number(row[12]) || 0,
      importeIva: Number(row[13]) || 0,
      importeTotal: Number(row[14]) || 0,
      moneda: (row[15] || 'ARS') as Factura['moneda'],
      concepto: row[16] ? String(row[16]) : undefined,
      processedAt: String(row[17] || ''),
      confidence: Number(row[18]) || 0,
      needsReview: row[19] === 'YES',
      matchedPagoFileId: row[20] ? String(row[20]) : undefined,
      matchConfidence: row[21] ? (String(row[21]) as MatchConfidence) : undefined,
      hasCuitMatch: row[22] === 'YES',
    });
  }

  return facturas;
}

/**
 * Parses pagos from sheet data
 */
function parsePagos(data: (string | number | boolean | null | undefined)[][]): Array<Pago & { row: number }> {
  const pagos: Array<Pago & { row: number }> = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    pagos.push({
      row: i + 1,
      fileId: String(row[0] || ''),
      fileName: String(row[1] || ''),
      folderPath: String(row[2] || ''),
      banco: String(row[3] || ''),
      fechaPago: String(row[4] || ''),
      importePagado: Number(row[5]) || 0,
      moneda: (String(row[6]) as 'ARS' | 'USD') || 'ARS',
      referencia: row[7] ? String(row[7]) : undefined,
      cuitPagador: row[8] ? String(row[8]) : undefined,
      nombrePagador: row[9] ? String(row[9]) : undefined,
      cuitBeneficiario: row[10] ? String(row[10]) : undefined,
      nombreBeneficiario: row[11] ? String(row[11]) : undefined,
      concepto: row[12] ? String(row[12]) : undefined,
      processedAt: String(row[13] || ''),
      confidence: Number(row[14]) || 0,
      needsReview: row[15] === 'YES',
      matchedFacturaFileId: row[16] ? String(row[16]) : undefined,
      matchConfidence: row[17] ? (String(row[17]) as MatchConfidence) : undefined,
    });
  }

  return pagos;
}

/**
 * Parses recibos from sheet data
 */
function parseRecibos(data: (string | number | boolean | null | undefined)[][]): Array<Recibo & { row: number }> {
  const recibos: Array<Recibo & { row: number }> = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    recibos.push({
      row: i + 1,
      fileId: String(row[0] || ''),
      fileName: String(row[1] || ''),
      folderPath: String(row[2] || ''),
      tipoRecibo: (row[3] || 'sueldo') as Recibo['tipoRecibo'],
      nombreEmpleado: String(row[4] || ''),
      cuilEmpleado: String(row[5] || ''),
      legajo: String(row[6] || ''),
      tareaDesempenada: row[7] ? String(row[7]) : undefined,
      cuitEmpleador: String(row[8] || ''),
      periodoAbonado: String(row[9] || ''),
      fechaPago: String(row[10] || ''),
      subtotalRemuneraciones: Number(row[11]) || 0,
      subtotalDescuentos: Number(row[12]) || 0,
      totalNeto: Number(row[13]) || 0,
      processedAt: String(row[14] || ''),
      confidence: Number(row[15]) || 0,
      needsReview: row[16] === 'YES',
      matchedPagoFileId: row[17] ? String(row[17]) : undefined,
      matchConfidence: row[18] ? (String(row[18]) as MatchConfidence) : undefined,
    });
  }

  return recibos;
}

/**
 * Auto-fills bank movement descriptions based on matched documents
 *
 * @param bankName - Optional bank name to filter (if not provided, processes all banks)
 * @returns Auto-fill result with statistics
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
  const controlCreditosId = folderStructure.controlCreditosId;
  const controlDebitosId = folderStructure.controlDebitosId;

  // Get all document data from both control spreadsheets
  // Control de Creditos: Facturas Emitidas (issued by ADVA), Pagos Recibidos (received by ADVA)
  // Control de Debitos: Facturas Recibidas (received by ADVA), Pagos Enviados (sent by ADVA), Recibos
  const facturasEmitidasResult = await getValues(controlCreditosId, 'Facturas Emitidas!A:W');
  if (!facturasEmitidasResult.ok) return facturasEmitidasResult;

  const facturasRecibidasResult = await getValues(controlDebitosId, 'Facturas Recibidas!A:W');
  if (!facturasRecibidasResult.ok) return facturasRecibidasResult;

  const pagosRecibidosResult = await getValues(controlCreditosId, 'Pagos Recibidos!A:Q');
  if (!pagosRecibidosResult.ok) return pagosRecibidosResult;

  const pagosEnviadosResult = await getValues(controlDebitosId, 'Pagos Enviados!A:Q');
  if (!pagosEnviadosResult.ok) return pagosEnviadosResult;

  const recibosResult = await getValues(controlDebitosId, 'Recibos!A:S');
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
    subdiarioCobroMatches: 0,
    pagoFacturaMatches: 0,
    directFacturaMatches: 0,
    reciboMatches: 0,
    pagoOnlyMatches: 0,
    noMatches: 0,
    errors: 0,
    duration: 0,
  };

  // Get bank spreadsheets to process
  const banksToProcess = bankName
    ? [[bankName, folderStructure.bankSpreadsheets.get(bankName)]]
    : Array.from(folderStructure.bankSpreadsheets.entries());

  for (const [_name, spreadsheetId] of banksToProcess) {
    if (!spreadsheetId) {
      result.errors++;
      continue;
    }

    // Get bank movements
    const movementsResult = await getValues(spreadsheetId, 'Movimientos!A:I');
    if (!movementsResult.ok) {
      result.errors++;
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
          case 'subdiario_cobro':
            result.subdiarioCobroMatches++;
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
        result.errors++;
      }
    }
  }

  result.duration = Date.now() - startTime;
  return { ok: true, value: result };
}
