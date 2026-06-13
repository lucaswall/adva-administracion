/**
 * Match movimientos orchestration service
 * Matches bank movements against Control de Ingresos/Egresos
 */

import { createHash } from 'crypto';
import type {
  Result,
  BankMatchTier,
  Factura,
  Pago,
  Recibo,
  Retencion,
} from '../types/index.js';
import { PROCESSING_LOCK_ID, PROCESSING_LOCK_TIMEOUT_MS, PROCESSING_LOCK_EXPIRY_MS, ADVA_CUITS, MERCADO_PAGO_BANK_NAME } from '../config.js';
import { withLock } from '../utils/concurrency.js';
import { info, warn, debug, error as logError } from '../utils/logger.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { getValues, batchUpdate, type CellValue } from '../services/sheets.js';
import { parseNumber } from '../utils/numbers.js';
import { parseArgDate, normalizeSpreadsheetDate, businessYear } from '../utils/date.js';
import { validateMoneda, validateMatchConfidence, validateTipoComprobante, extractCuitFromText, cuitOrDniMatch } from '../utils/validation.js';
import { BankMovementMatcher, calculateKeywordMatchScore, extractReferencia, type MatchQuality } from './matcher.js';
import { getMovimientosToFill } from '../services/movimientos-reader.js';
import { updateDetalle, type DetalleUpdate } from '../services/movimientos-detalle.js';

import { prefetchExchangeRates } from '../utils/exchange-rate.js';
import { syncPagosPendientes, syncCobrosPendientes } from '../services/pagos-pendientes.js';
import { syncSubdiario } from '../services/subdiario-writer.js';

// Re-export MatchQuality for test compatibility
export type { MatchQuality };

/**
 * A matched document entry returned by buildDocumentMap.
 * Discriminated union keyed by type for full type safety.
 */
export type MatchedDocument =
  | { document: Factura & { row: number }; type: 'factura_emitida' }
  | { document: Pago & { row: number }; type: 'pago_recibido' }
  | { document: Factura & { row: number }; type: 'factura_recibida' }
  | { document: Pago & { row: number }; type: 'pago_enviado' }
  | { document: Recibo & { row: number }; type: 'recibo' };

/**
 * A pending pagada='SI' write to a Control factura row.
 * Collected during movimientos processing and batch-written after detalle updates.
 * Only written when the source movimiento's detalle update was actually applied (ADV-343).
 */
export interface PagadaUpdate {
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  columnLetter: string;
  /**
   * Key identifying the bank-movement row that produced this pagada update.
   * Format: "${bankSheetName}:${movimientoRowNumber}" (e.g. "2025-01:5").
   * Used to filter out pagada writes whose corresponding detalle update was
   * version-skipped by updateDetalle (TOCTOU protection, ADV-343).
   */
  sourceMovimientoKey: string;
}

/**
 * Returns the fileId of the linked counterpart document, if any.
 * - For pagos (pago_recibido / pago_enviado): returns matchedFacturaFileId
 * - For facturas (factura_emitida / factura_recibida): returns matchedPagoFileId
 * - For recibosy others: returns undefined
 *
 * Used for symmetric counterpart exclusion — when a document is added to or
 * removed from the exclusion set, its linked counterpart must be treated the
 * same way to prevent the same economic transaction from matching two separate
 * bank movements (ADV-324).
 */
function getCounterpartFileId(doc: MatchedDocument): string | undefined {
  if (doc.type === 'pago_recibido' || doc.type === 'pago_enviado') {
    return doc.document.matchedFacturaFileId || undefined;
  }
  if (doc.type === 'factura_emitida' || doc.type === 'factura_recibida') {
    return doc.document.matchedPagoFileId || undefined;
  }
  return undefined;
}

/**
 * Builds a Map<fileId, MatchedDocument> from the 5 document arrays.
 * Iteration order matches the old findDocumentByFileId search order:
 * facturasEmitidas → pagosRecibidos → facturasRecibidas → pagosEnviados → recibos.
 * First entry wins for duplicate fileIds across arrays.
 *
 * @returns Map keyed by fileId, created once and shared across all bank loops
 */
export function buildDocumentMap(
  facturasEmitidas: Array<Factura & { row: number }>,
  pagosRecibidos: Array<Pago & { row: number }>,
  facturasRecibidas: Array<Factura & { row: number }>,
  pagosEnviados: Array<Pago & { row: number }>,
  recibos: Array<Recibo & { row: number }>
): Map<string, MatchedDocument> {
  const map = new Map<string, MatchedDocument>();

  for (const doc of facturasEmitidas) {
    if (!map.has(doc.fileId)) map.set(doc.fileId, { document: doc, type: 'factura_emitida' });
  }
  for (const doc of pagosRecibidos) {
    if (!map.has(doc.fileId)) map.set(doc.fileId, { document: doc, type: 'pago_recibido' });
  }
  for (const doc of facturasRecibidas) {
    if (!map.has(doc.fileId)) map.set(doc.fileId, { document: doc, type: 'factura_recibida' });
  }
  for (const doc of pagosEnviados) {
    if (!map.has(doc.fileId)) map.set(doc.fileId, { document: doc, type: 'pago_enviado' });
  }
  for (const doc of recibos) {
    if (!map.has(doc.fileId)) map.set(doc.fileId, { document: doc, type: 'recibo' });
  }

  return map;
}

/**
 * Extracts USD document dates for exchange rate prefetching.
 * Collects dates from Pagos Recibidos, Pagos Enviados, Facturas Emitidas, and Facturas Recibidas.
 *
 * @returns Array of unique date strings from USD documents
 */
function extractUsdDocumentDates(
  pagosRecibidos: Array<Pago & { row: number }>,
  facturasEmitidas: Array<Factura & { row: number }>,
  facturasRecibidas: Array<Factura & { row: number }>,
  pagosEnviados: Array<Pago & { row: number }>
): string[] {
  const dates = new Set<string>();

  for (const pago of pagosRecibidos) {
    if (pago.moneda === 'USD' && pago.fechaPago) {
      dates.add(pago.fechaPago);
    }
  }

  for (const pago of pagosEnviados) {
    if (pago.moneda === 'USD' && pago.fechaPago) {
      dates.add(pago.fechaPago);
    }
  }

  for (const factura of facturasEmitidas) {
    if (factura.moneda === 'USD' && factura.fechaEmision) {
      dates.add(factura.fechaEmision);
    }
  }

  for (const factura of facturasRecibidas) {
    if (factura.moneda === 'USD' && factura.fechaEmision) {
      dates.add(factura.fechaEmision);
    }
  }

  return Array.from(dates);
}

/**
 * Gets the column index for a required header, throwing if not found.
 * This prevents silent failures when headers are missing or have case mismatches.
 *
 * @param headers - Array of lowercase header strings
 * @param headerName - The header name to find (should be lowercase)
 * @returns The column index
 * @throws Error if header is not found
 */
export function getRequiredColumnIndex(headers: string[], headerName: string): number {
  const index = headers.indexOf(headerName);
  if (index === -1) {
    throw new Error(
      `Required header '${headerName}' not found in spreadsheet. ` +
      `Available headers: [${headers.join(', ')}]`
    );
  }
  return index;
}

/**
 * Row data used for computing version hash
 * Used for TOCTOU protection - only includes mutable fields that matter for matching
 */
interface VersionableRow {
  /** Transaction date */
  fecha: string;
  /** Origin/concept description */
  concepto: string;
  /** Debit amount */
  debito: number | null;
  /** Credit amount */
  credito: number | null;
  /** Google Drive fileId of matched document */
  matchedFileId: string;
  /** Human-readable match description */
  detalle: string;
  /** Match type: 'AUTO' | 'MANUAL' | '' */
  matchedType: 'AUTO' | 'MANUAL' | '';
}

/**
 * Computes a version hash for a movimiento row.
 * Used for TOCTOU protection - if the version changes between read and write,
 * the update should be skipped to avoid overwriting concurrent modifications.
 *
 * The version is based on fields that could change during concurrent updates:
 * - matchedFileId and detalle (the fields we're updating)
 * - fecha, concepto, debito, credito (immutable but included for row identity)
 *
 * @param row - Row data to compute version for
 * @returns Hex string hash of the row data
 */
export function computeRowVersion(row: VersionableRow): string {
  const data = [
    row.fecha,
    row.concepto,
    row.debito?.toString() ?? '',
    row.credito?.toString() ?? '',
    row.matchedFileId,
    row.detalle,
    row.matchedType,
  ].join('|');

  return createHash('md5').update(data).digest('hex').slice(0, 16);
}

/**
 * Options for matching
 */
export interface MatchOptions {
  /** Re-match rows that already have matches (clears existing) */
  force?: boolean;
}

/**
 * Result for a single bank spreadsheet
 */
export interface MatchMovimientosResult {
  skipped: boolean;
  spreadsheetName?: string;
  sheetsProcessed: number;
  movimientosProcessed: number;
  /** Count of AUTO algorithm matches (excludes MANUAL detalle fills) */
  movimientosFilled: number;
  debitsFilled: number;
  creditsFilled: number;
  noMatches: number;
  errors: number;
  /** Count of failures writing pagada=SI to Control sheets. Non-fatal; detalle and pagada are independent. */
  pagadaErrors: number;
  duration: number;
}

/**
 * Result for matching all banks
 */
export interface MatchAllResult {
  skipped: boolean;
  reason?: string;
  results: MatchMovimientosResult[];
  totalProcessed: number;
  totalFilled: number;
  totalDebitsFilled: number;
  totalCreditsFilled: number;
  /** Total count of pagada=SI write failures across all banks. Non-fatal. */
  totalPagadaErrors: number;
  duration: number;
}

/**
 * Control de Ingresos data (facturas emitidas, pagos recibidos, retenciones)
 */
interface IngresosData {
  facturasEmitidas: Array<Factura & { row: number }>;
  pagosRecibidos: Array<Pago & { row: number }>;
  retenciones: Array<Retencion & { row: number }>;
}

/**
 * Control de Egresos data (facturas recibidas, pagos enviados, recibos)
 */
interface EgresosData {
  facturasRecibidas: Array<Factura & { row: number }>;
  pagosEnviados: Array<Pago & { row: number }>;
  recibos: Array<Recibo & { row: number }>;
}

/**
 * Returns true if a movimientos discovery key belongs to a Mercado Pago account.
 *
 * Keys produced by discoverMovimientosSpreadsheets are year-prefixed
 * (`{YYYY}:{folderName}`, e.g. `2026:Mercado Pago 987654 ARS`) to avoid
 * cross-year collisions — the year prefix must be stripped before checking
 * the folder name (ADV-373).
 *
 * @param bankName - Discovery map key (`{YYYY}:{folderName}`) or bare folder name
 */
export function isMercadoPagoAccount(bankName: string): boolean {
  const colonIndex = bankName.indexOf(':');
  const folderName = colonIndex === -1 ? bankName : bankName.slice(colonIndex + 1);
  return folderName.startsWith(MERCADO_PAGO_BANK_NAME);
}

/**
 * Returns true if candidate match is strictly better than existing match.
 * Uses tier-based comparison: lower tier wins, then closer date, then exact amount.
 */
export function isBetterMatch(
  existing: MatchQuality,
  candidate: MatchQuality
): boolean {
  // 1. Lower tier always wins
  if (candidate.tier < existing.tier) return true;
  if (candidate.tier > existing.tier) return false;

  // 2. Closer date wins (same tier)
  if (candidate.dateDistance < existing.dateDistance) return true;
  if (candidate.dateDistance > existing.dateDistance) return false;

  // 3. Exact amount beats tolerance match (same tier and date)
  if (candidate.isExactAmount && !existing.isExactAmount) return true;

  // Equal quality - keep existing (no churn)
  return false;
}


/**
 * Parses Facturas Emitidas from spreadsheet data using header-based lookup.
 * ADVA is the emisor, so counterparty info is cuitReceptor/razonSocialReceptor.
 */
export function parseFacturasEmitidas(
  data: CellValue[][],
  options: { includeNc?: boolean } = {}
): Array<Factura & { row: number }> {
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h || '').toLowerCase());
  const facturas: Array<Factura & { row: number }> = [];

  // Required headers - throw if missing (critical for matching)
  // For Facturas Emitidas, the counterparty is the receptor
  const colIndex = {
    fechaEmision: getRequiredColumnIndex(headers, 'fechaemision'),
    fileId: getRequiredColumnIndex(headers, 'fileid'),
    tipoComprobante: getRequiredColumnIndex(headers, 'tipocomprobante'),
    nroFactura: getRequiredColumnIndex(headers, 'nrofactura'),
    cuitReceptor: getRequiredColumnIndex(headers, 'cuitreceptor'),
    razonSocialReceptor: getRequiredColumnIndex(headers, 'razonsocialreceptor'),
    importeTotal: getRequiredColumnIndex(headers, 'importetotal'),
    moneda: getRequiredColumnIndex(headers, 'moneda'),
    // Optional headers - use indexOf (returns -1 if missing, which is safe)
    fileName: headers.indexOf('filename'),
    importeNeto: headers.indexOf('importeneto'),
    importeIva: headers.indexOf('importeiva'),
    concepto: headers.indexOf('concepto'),
    processedAt: headers.indexOf('processedat'),
    confidence: headers.indexOf('confidence'),
    needsReview: headers.indexOf('needsreview'),
    matchedPagoFileId: headers.indexOf('matchedpagofileid'),
    matchConfidence: headers.indexOf('matchconfidence'),
    hasCuitMatch: headers.indexOf('hascuitmatch'),
    pagada: headers.indexOf('pagada'),
    tipoDeCambio: headers.indexOf('tipodecambio'),
    condicionIVAReceptor: headers.indexOf('condicionivareceptor'),
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colIndex.fileId]) continue;

    // NDs are never useful for downstream consumers (the matcher excludes them
    // and the Subdiario builder does not model them — they have no AFIP_COD
    // entry). Always skip. NCs are gated on the opt-in (Subdiario builder
    // needs them for scope rule c and cancellation lookup).
    const tipo = validateTipoComprobante(row[colIndex.tipoComprobante]);
    if (tipo === 'ND' || tipo.startsWith('ND ')) continue;
    if (!options.includeNc) {
      if (tipo === 'NC' || tipo.startsWith('NC ')) continue;
    }

    facturas.push({
      row: i + 1,
      fechaEmision: normalizeSpreadsheetDate(row[colIndex.fechaEmision]),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      tipoComprobante: tipo,
      nroFactura: String(row[colIndex.nroFactura] || ''),
      // ADVA is emisor, so emisor fields are implicit (not stored)
      cuitEmisor: '',
      razonSocialEmisor: '',
      cuitReceptor: String(row[colIndex.cuitReceptor] || ''),
      razonSocialReceptor: String(row[colIndex.razonSocialReceptor] || ''),
      condicionIVAReceptor:
        colIndex.condicionIVAReceptor >= 0
          ? String(row[colIndex.condicionIVAReceptor] || '') || undefined
          : undefined,
      importeNeto: parseNumber(row[colIndex.importeNeto]) || 0,
      importeIva: parseNumber(row[colIndex.importeIva]) || 0,
      importeTotal: parseNumber(row[colIndex.importeTotal]) || 0,
      moneda: validateMoneda(row[colIndex.moneda]),
      tipoDeCambio: parseNumber(row[colIndex.tipoDeCambio]) || undefined,
      concepto: String(row[colIndex.concepto] || ''),
      processedAt: String(row[colIndex.processedAt] || ''),
      confidence: parseNumber(row[colIndex.confidence]) || 0,
      needsReview: row[colIndex.needsReview] === 'YES',
      matchedPagoFileId: row[colIndex.matchedPagoFileId] ? String(row[colIndex.matchedPagoFileId]) : undefined,
      matchConfidence: validateMatchConfidence(row[colIndex.matchConfidence]),
      pagada:
        colIndex.pagada >= 0 && row[colIndex.pagada]
          ? String(row[colIndex.pagada])
          : undefined,
    });
  }

  return facturas;
}

/**
 * Parses Facturas Recibidas from spreadsheet data using header-based lookup.
 * ADVA is the receptor, so counterparty info is cuitEmisor/razonSocialEmisor.
 */
export function parseFacturasRecibidas(data: CellValue[][]): Array<Factura & { row: number }> {
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h || '').toLowerCase());
  const facturas: Array<Factura & { row: number }> = [];

  // Required headers - throw if missing (critical for matching)
  // For Facturas Recibidas, the counterparty is the emisor
  const colIndex = {
    fechaEmision: getRequiredColumnIndex(headers, 'fechaemision'),
    fileId: getRequiredColumnIndex(headers, 'fileid'),
    tipoComprobante: getRequiredColumnIndex(headers, 'tipocomprobante'),
    nroFactura: getRequiredColumnIndex(headers, 'nrofactura'),
    cuitEmisor: getRequiredColumnIndex(headers, 'cuitemisor'),
    razonSocialEmisor: getRequiredColumnIndex(headers, 'razonsocialemisor'),
    importeTotal: getRequiredColumnIndex(headers, 'importetotal'),
    moneda: getRequiredColumnIndex(headers, 'moneda'),
    // Optional headers - use indexOf (returns -1 if missing, which is safe)
    fileName: headers.indexOf('filename'),
    cuitReceptor: headers.indexOf('cuitreceptor'),
    razonSocialReceptor: headers.indexOf('razonsocialreceptor'),
    importeNeto: headers.indexOf('importeneto'),
    importeIva: headers.indexOf('importeiva'),
    concepto: headers.indexOf('concepto'),
    processedAt: headers.indexOf('processedat'),
    confidence: headers.indexOf('confidence'),
    needsReview: headers.indexOf('needsreview'),
    matchedPagoFileId: headers.indexOf('matchedpagofileid'),
    matchConfidence: headers.indexOf('matchconfidence'),
    hasCuitMatch: headers.indexOf('hascuitmatch'),
    pagada: headers.indexOf('pagada'),
    tipoDeCambio: headers.indexOf('tipodecambio'),
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colIndex.fileId]) continue;

    // Skip NCs and NDs — they have their own matching pipeline (nc-factura-matcher)
    const tipo = validateTipoComprobante(row[colIndex.tipoComprobante]);
    if (tipo === 'NC' || tipo.startsWith('NC ') || tipo === 'ND' || tipo.startsWith('ND ')) continue;

    facturas.push({
      row: i + 1,
      fechaEmision: normalizeSpreadsheetDate(row[colIndex.fechaEmision]),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      tipoComprobante: tipo,
      nroFactura: String(row[colIndex.nroFactura] || ''),
      cuitEmisor: String(row[colIndex.cuitEmisor] || ''),
      razonSocialEmisor: String(row[colIndex.razonSocialEmisor] || ''),
      cuitReceptor: String(row[colIndex.cuitReceptor] || ''),
      razonSocialReceptor: String(row[colIndex.razonSocialReceptor] || ''),
      importeNeto: parseNumber(row[colIndex.importeNeto]) || 0,
      importeIva: parseNumber(row[colIndex.importeIva]) || 0,
      importeTotal: parseNumber(row[colIndex.importeTotal]) || 0,
      moneda: validateMoneda(row[colIndex.moneda]),
      tipoDeCambio: parseNumber(row[colIndex.tipoDeCambio]) || undefined,
      concepto: String(row[colIndex.concepto] || ''),
      processedAt: String(row[colIndex.processedAt] || ''),
      confidence: parseNumber(row[colIndex.confidence]) || 0,
      needsReview: row[colIndex.needsReview] === 'YES',
      matchedPagoFileId: row[colIndex.matchedPagoFileId] ? String(row[colIndex.matchedPagoFileId]) : undefined,
      matchConfidence: validateMatchConfidence(row[colIndex.matchConfidence]),
    });
  }

  return facturas;
}

/**
 * Parses Pagos from spreadsheet data using header-based lookup
 */
export function parsePagos(data: CellValue[][]): Array<Pago & { row: number }> {
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h || '').toLowerCase());
  const pagos: Array<Pago & { row: number }> = [];

  // Required headers - throw if missing (critical for matching)
  const colIndex = {
    fechaPago: getRequiredColumnIndex(headers, 'fechapago'),
    fileId: getRequiredColumnIndex(headers, 'fileid'),
    banco: getRequiredColumnIndex(headers, 'banco'),
    importePagado: getRequiredColumnIndex(headers, 'importepagado'),
    moneda: getRequiredColumnIndex(headers, 'moneda'),
    // Optional headers - use indexOf (returns -1 if missing, which is safe)
    fileName: headers.indexOf('filename'),
    referencia: headers.indexOf('referencia'),
    cuitPagador: headers.indexOf('cuitpagador'),
    nombrePagador: headers.indexOf('nombrepagador'),
    cuitBeneficiario: headers.indexOf('cuitbeneficiario'),
    nombreBeneficiario: headers.indexOf('nombrebeneficiario'),
    concepto: headers.indexOf('concepto'),
    processedAt: headers.indexOf('processedat'),
    confidence: headers.indexOf('confidence'),
    needsReview: headers.indexOf('needsreview'),
    matchedFacturaFileId: headers.indexOf('matchedfacturafileid'),
    matchConfidence: headers.indexOf('matchconfidence'),
    tipoDeCambio: headers.indexOf('tipodecambio'),
    importeEnPesos: headers.indexOf('importeenpesos'),
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colIndex.fileId]) continue;

    pagos.push({
      row: i + 1,
      fechaPago: normalizeSpreadsheetDate(row[colIndex.fechaPago]),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      banco: String(row[colIndex.banco] || ''),
      importePagado: parseNumber(row[colIndex.importePagado]) || 0,
      moneda: validateMoneda(row[colIndex.moneda]),
      referencia: String(row[colIndex.referencia] || ''),
      cuitPagador: String(row[colIndex.cuitPagador] || ''),
      nombrePagador: String(row[colIndex.nombrePagador] || ''),
      cuitBeneficiario: String(row[colIndex.cuitBeneficiario] || ''),
      nombreBeneficiario: String(row[colIndex.nombreBeneficiario] || ''),
      concepto: String(row[colIndex.concepto] || ''),
      processedAt: String(row[colIndex.processedAt] || ''),
      confidence: parseNumber(row[colIndex.confidence]) || 0,
      needsReview: row[colIndex.needsReview] === 'YES',
      matchedFacturaFileId: row[colIndex.matchedFacturaFileId] ? String(row[colIndex.matchedFacturaFileId]) : undefined,
      matchConfidence: validateMatchConfidence(row[colIndex.matchConfidence]),
      tipoDeCambio: parseNumber(row[colIndex.tipoDeCambio]) || undefined,
      importeEnPesos: parseNumber(row[colIndex.importeEnPesos]) || undefined,
    });
  }

  return pagos;
}

/**
 * Parses Recibos from spreadsheet data using header-based lookup
 */
function parseRecibos(data: CellValue[][]): Array<Recibo & { row: number }> {
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h || '').toLowerCase());
  const recibos: Array<Recibo & { row: number }> = [];

  // Required headers - throw if missing (critical for matching)
  const colIndex = {
    fechaPago: getRequiredColumnIndex(headers, 'fechapago'),
    fileId: getRequiredColumnIndex(headers, 'fileid'),
    nombreEmpleado: getRequiredColumnIndex(headers, 'nombreempleado'),
    cuilEmpleado: getRequiredColumnIndex(headers, 'cuilempleado'),
    totalNeto: getRequiredColumnIndex(headers, 'totalneto'),
    // Optional headers - use indexOf (returns -1 if missing, which is safe)
    fileName: headers.indexOf('filename'),
    tipoRecibo: headers.indexOf('tiporecibo'),
    legajo: headers.indexOf('legajo'),
    tareaDesempenada: headers.indexOf('tareadesempenada'),
    cuitEmpleador: headers.indexOf('cuitempleador'),
    periodoAbonado: headers.indexOf('periodoabonado'),
    subtotalRemuneraciones: headers.indexOf('subtotalremuneraciones'),
    subtotalDescuentos: headers.indexOf('subtotaldescuentos'),
    processedAt: headers.indexOf('processedat'),
    confidence: headers.indexOf('confidence'),
    needsReview: headers.indexOf('needsreview'),
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colIndex.fileId]) continue;

    recibos.push({
      row: i + 1,
      fechaPago: normalizeSpreadsheetDate(row[colIndex.fechaPago]),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      tipoRecibo: (row[colIndex.tipoRecibo] === 'liquidacion_final' ? 'liquidacion_final' : 'sueldo'),
      nombreEmpleado: String(row[colIndex.nombreEmpleado] || ''),
      cuilEmpleado: String(row[colIndex.cuilEmpleado] || ''),
      legajo: String(row[colIndex.legajo] || ''),
      tareaDesempenada: String(row[colIndex.tareaDesempenada] || ''),
      cuitEmpleador: String(row[colIndex.cuitEmpleador] || ''),
      periodoAbonado: String(row[colIndex.periodoAbonado] || ''),
      subtotalRemuneraciones: parseNumber(row[colIndex.subtotalRemuneraciones]) || 0,
      subtotalDescuentos: parseNumber(row[colIndex.subtotalDescuentos]) || 0,
      totalNeto: parseNumber(row[colIndex.totalNeto]) || 0,
      processedAt: String(row[colIndex.processedAt] || ''),
      confidence: parseNumber(row[colIndex.confidence]) || 0,
      needsReview: row[colIndex.needsReview] === 'YES',
    });
  }

  return recibos;
}

/**
 * Parses Retenciones from spreadsheet data using header-based lookup
 */
export function parseRetenciones(data: CellValue[][]): Array<Retencion & { row: number }> {
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h || '').toLowerCase());
  const retenciones: Array<Retencion & { row: number }> = [];

  // Required headers - throw if missing (critical for matching)
  const colIndex = {
    fechaEmision: getRequiredColumnIndex(headers, 'fechaemision'),
    fileId: getRequiredColumnIndex(headers, 'fileid'),
    montoRetencion: getRequiredColumnIndex(headers, 'montoretencion'),
    // Optional headers - use indexOf (returns -1 if missing, which is safe)
    fileName: headers.indexOf('filename'),
    nroCertificado: headers.indexOf('nrocertificado'),
    cuitAgenteRetencion: headers.indexOf('cuitagenteretencion'),
    razonSocialAgenteRetencion: headers.indexOf('razonsocialagenteretencion'),
    impuesto: headers.indexOf('impuesto'),
    regimen: headers.indexOf('regimen'),
    montoComprobante: headers.indexOf('montocomprobante'),
    processedAt: headers.indexOf('processedat'),
    confidence: headers.indexOf('confidence'),
    needsReview: headers.indexOf('needsreview'),
    matchedFacturaFileId: headers.indexOf('matchedfacturafileid'),
    matchConfidence: headers.indexOf('matchconfidence'),
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colIndex.fileId]) continue;

    retenciones.push({
      row: i + 1,
      fechaEmision: normalizeSpreadsheetDate(row[colIndex.fechaEmision]),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      nroCertificado: String(row[colIndex.nroCertificado] || ''),
      cuitAgenteRetencion: String(row[colIndex.cuitAgenteRetencion] || ''),
      razonSocialAgenteRetencion: String(row[colIndex.razonSocialAgenteRetencion] || ''),
      cuitSujetoRetenido: ADVA_CUITS[0],  // Always ADVA
      impuesto: String(row[colIndex.impuesto] || ''),
      regimen: String(row[colIndex.regimen] || ''),
      montoComprobante: parseNumber(row[colIndex.montoComprobante]) || 0,
      montoRetencion: parseNumber(row[colIndex.montoRetencion]) || 0,
      processedAt: String(row[colIndex.processedAt] || ''),
      confidence: parseNumber(row[colIndex.confidence]) || 0,
      needsReview: row[colIndex.needsReview] === 'YES',
      matchedFacturaFileId: row[colIndex.matchedFacturaFileId] ? String(row[colIndex.matchedFacturaFileId]) : undefined,
      matchConfidence: validateMatchConfidence(row[colIndex.matchConfidence]),
    });
  }

  return retenciones;
}

/**
 * Loads Control de Ingresos data
 */
async function loadControlIngresos(spreadsheetId: string): Promise<Result<IngresosData, Error>> {
  try {
    const [facturasResult, pagosResult, retencionesResult] = await Promise.all([
      getValues(spreadsheetId, 'Facturas Emitidas!A:U'),  // 21 cols after ADV-245 added condicionIVAReceptor at H
      getValues(spreadsheetId, 'Pagos Recibidos!A:Q'),
      getValues(spreadsheetId, 'Retenciones Recibidas!A:O'),
    ]);

    if (!facturasResult.ok) return facturasResult;
    if (!pagosResult.ok) return pagosResult;
    if (!retencionesResult.ok) return retencionesResult;

    return {
      ok: true,
      value: {
        facturasEmitidas: parseFacturasEmitidas(facturasResult.value),
        pagosRecibidos: parsePagos(pagosResult.value),
        retenciones: parseRetenciones(retencionesResult.value),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Loads Control de Egresos data
 */
async function loadControlEgresos(spreadsheetId: string): Promise<Result<EgresosData, Error>> {
  try {
    const [facturasResult, pagosResult, recibosResult] = await Promise.all([
      getValues(spreadsheetId, 'Facturas Recibidas!A:T'),
      getValues(spreadsheetId, 'Pagos Enviados!A:Q'),
      getValues(spreadsheetId, 'Recibos!A:S'),
    ]);

    if (!facturasResult.ok) return facturasResult;
    if (!pagosResult.ok) return pagosResult;
    if (!recibosResult.ok) return recibosResult;

    return {
      ok: true,
      value: {
        facturasRecibidas: parseFacturasRecibidas(facturasResult.value),
        pagosEnviados: parsePagos(pagosResult.value),
        recibos: parseRecibos(recibosResult.value),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Builds MatchQuality from a document and movement context.
 * Computes tier based on document type, CUIT match, and linked pago status.
 */
function buildMatchQuality(
  fileId: string,
  fechaDocumento: string,
  fechaMovimiento: string,
  cuitDocumento: string,
  conceptoMovimiento: string,
  hasLinkedPago: boolean,
  isExactAmount: boolean,
  matched?: MatchedDocument
): MatchQuality {
  // Calculate date distance in days using parseArgDate for Argentine format support
  const docDate = parseArgDate(fechaDocumento);
  const movDate = parseArgDate(fechaMovimiento);

  // Handle invalid dates - use Infinity for worst possible score
  const dateDistance = (docDate && movDate)
    ? Math.abs(Math.floor((docDate.getTime() - movDate.getTime()) / (1000 * 60 * 60 * 24)))
    : Infinity;

  // Compute tier from context
  // Use extractCuitFromText to handle dashed/separated CUIT formats (e.g. "20-12345678-6")
  const extractedCuit = extractCuitFromText(conceptoMovimiento);
  const hasCuitMatch = !!(cuitDocumento && extractedCuit && cuitOrDniMatch(extractedCuit, cuitDocumento));
  let tier: BankMatchTier;
  // Tier 1 only for pagos (pago_recibido / pago_enviado) with a linked factura —
  // a factura_recibida/emitida that merely has matchedPagoFileId set does NOT qualify
  if (hasLinkedPago && (matched?.type === 'pago_recibido' || matched?.type === 'pago_enviado')) {
    tier = 1; // Genuine pago with linked factura
  } else if (hasCuitMatch) {
    tier = 2; // CUIT match
  } else if (matched && (matched.type === 'pago_recibido' || matched.type === 'pago_enviado') && matched.document.referencia) {
    // Tier 3: Check if concepto contains a referencia pattern matching the document's referencia
    const extractedRef = extractReferencia(conceptoMovimiento);
    if (extractedRef && extractedRef === matched.document.referencia) {
      tier = 3;
    } else {
      tier = 5;
    }
  } else if (matched) {
    // Tier 4: Check for keyword matches using available matching logic
    let counterpartyName: string;
    let concepto: string;
    if (matched.type === 'factura_emitida') {
      counterpartyName = matched.document.razonSocialReceptor || '';
      concepto = matched.document.concepto || '';
    } else if (matched.type === 'factura_recibida') {
      counterpartyName = matched.document.razonSocialEmisor || '';
      concepto = matched.document.concepto || '';
    } else if (matched.type === 'pago_recibido') {
      counterpartyName = matched.document.nombrePagador || '';
      concepto = matched.document.concepto || '';
    } else if (matched.type === 'pago_enviado') {
      counterpartyName = matched.document.nombreBeneficiario || '';
      concepto = matched.document.concepto || '';
    } else {
      // recibo — no obvious counterparty name for keyword matching
      counterpartyName = '';
      concepto = '';
    }
    const score = calculateKeywordMatchScore(conceptoMovimiento, counterpartyName, concepto);
    tier = score >= 2 ? 4 : 5;
  } else {
    tier = 5; // Amount + date only (can't determine keyword/referencia from existing data)
  }

  return {
    fileId,
    tier,
    dateDistance,
    isExactAmount,
  };
}

/**
 * Builds MatchQuality for an existing match by looking up the document via Map
 */
function buildMatchQualityFromFileId(
  fileId: string,
  fechaMovimiento: string,
  conceptoMovimiento: string,
  documentMap: Map<string, MatchedDocument>
): MatchQuality | null {
  const found = documentMap.get(fileId);

  if (!found) {
    return null;
  }

  const { document, type } = found;

  // Extract relevant fields based on document type
  let fechaDocumento: string;
  let cuitDocumento: string;
  let hasLinkedPago = false;

  if (type === 'factura_emitida') {
    fechaDocumento = document.fechaEmision;
    cuitDocumento = document.cuitReceptor || '';
    hasLinkedPago = !!document.matchedPagoFileId;
  } else if (type === 'factura_recibida') {
    fechaDocumento = document.fechaEmision;
    cuitDocumento = document.cuitEmisor;
    hasLinkedPago = !!document.matchedPagoFileId;
  } else if (type === 'pago_recibido') {
    fechaDocumento = document.fechaPago;
    cuitDocumento = document.cuitPagador || '';
    hasLinkedPago = !!document.matchedFacturaFileId;
  } else if (type === 'pago_enviado') {
    fechaDocumento = document.fechaPago;
    cuitDocumento = document.cuitBeneficiario || '';
    hasLinkedPago = !!document.matchedFacturaFileId;
  } else {
    // recibo
    fechaDocumento = document.fechaPago;
    cuitDocumento = document.cuilEmpleado;
    hasLinkedPago = false;
  }

  // For isExactAmount, we can't determine this without re-running the match
  // Set to true for both existing and candidate to ensure fair comparison on other dimensions
  return buildMatchQuality(
    fileId,
    fechaDocumento,
    fechaMovimiento,
    cuitDocumento,
    conceptoMovimiento,
    hasLinkedPago,
    true,  // Set to true for both to ensure fair comparison on other dimensions
    found
  );
}

/**
 * Builds a human-readable detalle string for a matched document
 * Used for auto-generating detalle for MANUAL rows with blank detalle
 */
function buildDetalleForDocument(matched: MatchedDocument): string {
  const { document, type } = matched;
  if (type === 'factura_emitida') {
    const razonSocial = document.razonSocialReceptor || 'Cliente';
    const concepto = document.concepto || '';
    const facturaId = document.tipoComprobante && document.nroFactura
      ? `${document.tipoComprobante} ${document.nroFactura} `
      : '';
    if (concepto) {
      return `Factura Emitida ${facturaId}a ${razonSocial} - ${concepto}`;
    }
    return `Factura Emitida ${facturaId}a ${razonSocial}`;
  } else if (type === 'factura_recibida') {
    const razonSocial = document.razonSocialEmisor || 'Proveedor';
    const concepto = document.concepto || '';
    const facturaId = document.tipoComprobante && document.nroFactura
      ? `${document.tipoComprobante} ${document.nroFactura} `
      : '';
    if (concepto) {
      return `Factura Recibida ${facturaId}de ${razonSocial} - ${concepto}`;
    }
    return `Factura Recibida ${facturaId}de ${razonSocial}`;
  } else if (type === 'pago_recibido') {
    const nombrePagador = document.nombrePagador || 'Pagador';
    const concepto = document.concepto || '';
    if (concepto) {
      return `Pago de ${nombrePagador} - ${concepto}`;
    }
    return `Pago de ${nombrePagador}`;
  } else if (type === 'pago_enviado') {
    const nombreBeneficiario = document.nombreBeneficiario || 'Beneficiario';
    const concepto = document.concepto || '';
    if (concepto) {
      return `Pago a ${nombreBeneficiario} - ${concepto}`;
    }
    return `Pago a ${nombreBeneficiario}`;
  } else {
    // recibo
    const nombreEmpleado = document.nombreEmpleado || 'Empleado';
    return `Recibo de ${nombreEmpleado}`;
  }
}

/**
 * Matches all movimientos for a single bank spreadsheet
 */
async function matchBankMovimientos(
  bankName: string,
  spreadsheetId: string,
  matcher: BankMovementMatcher,
  ingresosData: IngresosData,
  egresosData: EgresosData,
  options: MatchOptions,
  currentYear: number,
  documentMap: Map<string, MatchedDocument>,
  controlIngresosId: string,
  controlEgresosId: string,
  globalExcludeFileIds?: Set<string>
): Promise<MatchMovimientosResult> {
  const startTime = Date.now();

  // Load movimientos for this bank
  const movimientosResult = await getMovimientosToFill(spreadsheetId, currentYear);
  if (!movimientosResult.ok) {
    warn('Failed to load movimientos for bank', {
      module: 'match-movimientos',
      bankName,
      error: movimientosResult.error.message,
    });
    return {
      skipped: false,
      spreadsheetName: bankName,
      sheetsProcessed: 0,
      movimientosProcessed: 0,
      movimientosFilled: 0,
      debitsFilled: 0,
      creditsFilled: 0,
      noMatches: 0,
      errors: 1,
      pagadaErrors: 0,
      duration: Date.now() - startTime,
    };
  }

  const movimientos = movimientosResult.value;
  const updates: DetalleUpdate[] = [];
  const pagadaUpdates: PagadaUpdate[] = [];
  /** Tracks which factura fileIds have pagada='SI' queued in this run (for revert skip check). */
  const pagadaSetFileIds = new Set<string>();
  /**
   * Facturas whose pagada='SI' may need reverting because their sole movimiento justification
   * was cleared or replaced in this run. Keyed by factura fileId. Filtered at write time.
   */
  const pagadaRevertCandidates = new Map<string, { spreadsheetId: string; sheetName: 'Facturas Recibidas' | 'Facturas Emitidas'; rowNumber: number; columnLetter: string; sourceMovimientoKey: string }>();
  let debitsFilled = 0;
  let creditsFilled = 0;
  let noMatches = 0;

  // Pre-seed excludeFileIds with ALL existing matchedFileIds (MANUAL and AUTO)
  // This prevents the same document from being assigned to multiple movements.
  // Each movement temporarily removes its own fileId before calling the matcher,
  // so it can still re-evaluate its current match.
  // Also seed from globalExcludeFileIds to prevent cross-bank double-assignment.
  // ADV-324: also exclude each matched document's linked counterpart (matchedFacturaFileId for pagos,
  // matchedPagoFileId for facturas) so the same economic transaction cannot match two movements.
  const excludeFileIds = new Set<string>();
  for (const mov of movimientos) {
    if (mov.matchedFileId) {
      excludeFileIds.add(mov.matchedFileId);
      const doc = documentMap.get(mov.matchedFileId);
      if (doc) {
        const counterpartId = getCounterpartFileId(doc);
        if (counterpartId) excludeFileIds.add(counterpartId);
      }
    }
  }
  if (globalExcludeFileIds) {
    for (const id of globalExcludeFileIds) {
      excludeFileIds.add(id);
    }
  }

  // Process each movimiento
  for (const mov of movimientos) {
    // Skip MANUAL rows from matching (but may need detalle generation)
    if (mov.matchedType === 'MANUAL') {
      // If MANUAL row has blank detalle, generate it from the matched document
      if (!mov.detalle && mov.matchedFileId) {
        const matchedDoc = documentMap.get(mov.matchedFileId);

        if (matchedDoc) {
          const detalle = buildDetalleForDocument(matchedDoc);
          const expectedVersion = computeRowVersion(mov);

          updates.push({
            sheetName: mov.sheetName,
            rowNumber: mov.rowNumber,
            matchedFileId: mov.matchedFileId,
            detalle,
            matchedType: 'MANUAL',
            expectedVersion,
          });
        }
      }
      continue;
    }

    let matchResult;

    // Temporarily remove this movement's own fileId (and its linked counterpart) from
    // excludeFileIds so the matcher can re-evaluate the current match or find a replacement.
    // ADV-324: freeing both primary and counterpart ensures that a replacement also liberates
    // the counterpart (kept consistent by symmetric re-add on no-update below).
    const ownFileId = mov.matchedFileId;
    const ownDoc = ownFileId ? documentMap.get(ownFileId) : undefined;
    const ownCounterpartId = ownDoc ? getCounterpartFileId(ownDoc) : undefined;
    if (ownFileId && !globalExcludeFileIds?.has(ownFileId)) {
      excludeFileIds.delete(ownFileId);
    }
    if (ownCounterpartId && !globalExcludeFileIds?.has(ownCounterpartId)) {
      excludeFileIds.delete(ownCounterpartId);
    }

    // Snapshot after temporary removal — each matcher call gets an immutable view
    const currentExcludeFileIds = new Set(excludeFileIds);

    // Route to appropriate matcher based on debit/credit
    const isMercadoPago = isMercadoPagoAccount(bankName);
    if (mov.debito !== null && mov.debito > 0) {
      matchResult = matcher.matchMovement(
        mov,
        egresosData.facturasRecibidas,
        egresosData.recibos,
        egresosData.pagosEnviados,
        currentExcludeFileIds,
        isMercadoPago
      );
    } else if (mov.credito !== null && mov.credito > 0) {
      matchResult = matcher.matchCreditMovement(
        mov,
        ingresosData.facturasEmitidas,
        ingresosData.pagosRecibidos,
        ingresosData.retenciones,
        currentExcludeFileIds,
        isMercadoPago
      );
    } else {
      // No amount - skip, but restore ownFileId that was temporarily removed
      if (ownFileId) {
        excludeFileIds.add(ownFileId);
      }
      continue;
    }

    // Handle match result with replacement logic
    const isFileIdMatch = matchResult.matchType !== 'no_match' && matchResult.matchedFileId;
    const isAutoLabelMatch = matchResult.matchType === 'bank_fee' || matchResult.matchType === 'credit_card_payment' || matchResult.matchType === 'own_transfer';
    if (isFileIdMatch || isAutoLabelMatch) {
      // Found a new candidate match
      let shouldUpdate = false;

      if (isAutoLabelMatch) {
        // Auto-label matches (bank fees, credit card payments) have no fileId to compare
        // Update if: force mode, no existing detalle, or no existing matchedFileId
        shouldUpdate = options.force || !mov.detalle;
      } else if (options.force || !mov.matchedFileId) {
        // Force mode OR no existing match - always update
        shouldUpdate = true;
      } else {
        // Has existing match - compare quality
        const existingQuality = buildMatchQualityFromFileId(
          mov.matchedFileId,
          mov.fecha,
          mov.concepto,
          documentMap
        );

        if (!existingQuality) {
          // Couldn't find existing document - can't compare quality, keep existing match
          warn(
            'Existing matched document no longer exists in Control sheets, keeping orphaned match',
            { matchedFileId: mov.matchedFileId, bankName, fecha: mov.fecha }
          );
          shouldUpdate = false;
        } else {
          // Build candidate quality via Map lookup
          const candidateMatched = documentMap.get(matchResult.matchedFileId!);

          if (candidateMatched) {
            const { document, type } = candidateMatched;
            let fechaDocumento: string;
            let cuitDocumento: string;
            let hasLinkedPago = false;

            if (type === 'factura_emitida') {
              fechaDocumento = document.fechaEmision;
              cuitDocumento = document.cuitReceptor || '';
              hasLinkedPago = !!document.matchedPagoFileId;
            } else if (type === 'factura_recibida') {
              fechaDocumento = document.fechaEmision;
              cuitDocumento = document.cuitEmisor;
              hasLinkedPago = !!document.matchedPagoFileId;
            } else if (type === 'pago_recibido') {
              fechaDocumento = document.fechaPago;
              cuitDocumento = document.cuitPagador || '';
              hasLinkedPago = !!document.matchedFacturaFileId;
            } else if (type === 'pago_enviado') {
              fechaDocumento = document.fechaPago;
              cuitDocumento = document.cuitBeneficiario || '';
              hasLinkedPago = !!document.matchedFacturaFileId;
            } else {
              // recibo
              fechaDocumento = document.fechaPago;
              cuitDocumento = document.cuilEmpleado;
              hasLinkedPago = false;
            }

            if (fechaDocumento) {
              // For isExactAmount, we can't reliably determine this without re-running complex matching
              // Use the same value for both (true) so they compare equally on this dimension
              // This ensures the comparison focuses on confidence, CUIT match, and date proximity
              const candidateQuality = buildMatchQuality(
                matchResult.matchedFileId!,
                fechaDocumento,
                mov.fecha,
                cuitDocumento,
                mov.concepto,
                hasLinkedPago,
                true,  // Consistent with existing for fair comparison
                candidateMatched
              );

              // Compare: replace if candidate is better
              // Note: Both qualities use isExactAmount=true for fair comparison on other dimensions
              shouldUpdate = isBetterMatch(existingQuality, candidateQuality);
            }
          } else {
            // Couldn't find candidate document - keep existing
            shouldUpdate = false;
          }
        }
      }

      if (shouldUpdate) {
        // Compute version from the row's current state for TOCTOU protection
        // If row changes between now and write, update will be skipped
        const expectedVersion = computeRowVersion(mov);

        updates.push({
          sheetName: mov.sheetName,
          rowNumber: mov.rowNumber,
          matchedFileId: matchResult.matchedFileId ?? '',
          detalle: matchResult.description,
          matchedType: 'AUTO',
          expectedVersion,
        });

        if (mov.debito !== null && mov.debito > 0) {
          debitsFilled++;
        } else {
          creditsFilled++;
        }

        // Collect pagada=SI update for matched facturas (not auto-labels, not MANUAL)
        if (isFileIdMatch && matchResult.matchedFileId) {
          const matchedDoc = documentMap.get(matchResult.matchedFileId);
          if (matchedDoc && (matchedDoc.type === 'factura_emitida' || matchedDoc.type === 'factura_recibida')) {
            if (matchedDoc.document.matchConfidence !== 'MANUAL') {
              const ssId = matchedDoc.type === 'factura_emitida' ? controlIngresosId : controlEgresosId;
              const sheetName = matchedDoc.type === 'factura_emitida' ? 'Facturas Emitidas' : 'Facturas Recibidas';
              // pagada column: T for Facturas Emitidas (21 cols, ADV-245), S for Facturas Recibidas (20 cols)
              const pagadaCol = matchedDoc.type === 'factura_emitida' ? 'T' : 'S';
              pagadaUpdates.push({
                spreadsheetId: ssId,
                sheetName,
                rowNumber: matchedDoc.document.row,
                columnLetter: pagadaCol,
                sourceMovimientoKey: `${mov.sheetName}:${mov.rowNumber}`,
              });
              // Track fileId so the revert pass knows not to clear this factura's pagada (ADV-320)
              pagadaSetFileIds.add(matchResult.matchedFileId);
            }
          }
        }

        // Collect OLD matched factura as revert candidate if being replaced (ADV-320)
        if (ownFileId) {
          const ownDocForRevert = documentMap.get(ownFileId);
          if (ownDocForRevert && (ownDocForRevert.type === 'factura_emitida' || ownDocForRevert.type === 'factura_recibida')) {
            const revertSsId = ownDocForRevert.type === 'factura_emitida' ? controlIngresosId : controlEgresosId;
            const revertShName: 'Facturas Emitidas' | 'Facturas Recibidas' = ownDocForRevert.type === 'factura_emitida' ? 'Facturas Emitidas' : 'Facturas Recibidas';
            const revertCol = ownDocForRevert.type === 'factura_emitida' ? 'T' : 'S';
            pagadaRevertCandidates.set(ownFileId, {
              spreadsheetId: revertSsId,
              sheetName: revertShName,
              rowNumber: ownDocForRevert.document.row,
              columnLetter: revertCol,
              sourceMovimientoKey: `${mov.sheetName}:${mov.rowNumber}`,
            });
          }
        }

        // Add new matched fileId (and its counterpart) to excludeFileIds.
        // The old ownFileId and its counterpart stay removed = freed for other movements (ADV-324).
        if (isFileIdMatch && matchResult.matchedFileId) {
          excludeFileIds.add(matchResult.matchedFileId);
          const newDoc = documentMap.get(matchResult.matchedFileId);
          if (newDoc) {
            const newCounterpartId = getCounterpartFileId(newDoc);
            if (newCounterpartId) excludeFileIds.add(newCounterpartId);
          }
        }
      } else {
        // Not updating — re-add the old fileId and its counterpart back to excludeFileIds (ADV-324)
        if (ownFileId) {
          excludeFileIds.add(ownFileId);
        }
        if (ownCounterpartId) {
          excludeFileIds.add(ownCounterpartId);
        }
      }
    } else {
      // No match found
      if (options.force && ownFileId) {
        // Force mode: clear the stale AUTO match and free the document for other movements
        const expectedVersion = computeRowVersion(mov);
        updates.push({
          sheetName: mov.sheetName,
          rowNumber: mov.rowNumber,
          matchedFileId: '',
          detalle: '',
          matchedType: '',
          expectedVersion,
        });
        // Do NOT re-add ownFileId or its counterpart — both are freed for other movements (ADV-324)
        // Collect old matched factura as revert candidate (ADV-320)
        if (ownFileId) {
          const ownDocForRevert = documentMap.get(ownFileId);
          if (ownDocForRevert && (ownDocForRevert.type === 'factura_emitida' || ownDocForRevert.type === 'factura_recibida')) {
            const revertSsId = ownDocForRevert.type === 'factura_emitida' ? controlIngresosId : controlEgresosId;
            const revertShName: 'Facturas Emitidas' | 'Facturas Recibidas' = ownDocForRevert.type === 'factura_emitida' ? 'Facturas Emitidas' : 'Facturas Recibidas';
            const revertCol = ownDocForRevert.type === 'factura_emitida' ? 'T' : 'S';
            pagadaRevertCandidates.set(ownFileId, {
              spreadsheetId: revertSsId,
              sheetName: revertShName,
              rowNumber: ownDocForRevert.document.row,
              columnLetter: revertCol,
              sourceMovimientoKey: `${mov.sheetName}:${mov.rowNumber}`,
            });
          }
        }
      } else {
        // Non-force mode: preserve existing match, re-add fileId and counterpart to excluded set (ADV-324)
        if (ownFileId) {
          excludeFileIds.add(ownFileId);
        }
        if (ownCounterpartId) {
          excludeFileIds.add(ownCounterpartId);
        }
        noMatches++;
      }
    }
  }

  // Propagate this bank's final exclusion set to the global set so subsequent
  // banks cannot claim the same documents.
  if (globalExcludeFileIds) {
    for (const id of excludeFileIds) {
      globalExcludeFileIds.add(id);
    }
  }

  // Write updates
  const updateResult = await updateDetalle(spreadsheetId, updates);
  if (!updateResult.ok) {
    warn('Failed to write detalle updates', {
      module: 'match-movimientos',
      bankName,
      error: updateResult.error.message,
    });
  }

  // Write pagada=SI for matched facturas, batched by spreadsheet
  // Only if detalle updates succeeded — keeps movimiento match and pagada flag in sync.
  // Only for facturas whose source movimiento detalle update was actually applied (ADV-343).
  let pagadaErrors = 0;
  if (updateResult.ok && pagadaUpdates.length > 0) {
    const appliedKeys = updateResult.value.appliedKeys;
    // Filter to only the pagada writes whose movimiento row was actually written
    const applicablePagada = pagadaUpdates.filter(u => appliedKeys.has(u.sourceMovimientoKey));

    if (applicablePagada.length > 0) {
      const bySpreadsheet = new Map<string, Array<{ range: string; values: CellValue[][] }>>();
      for (const update of applicablePagada) {
        const range = `${update.sheetName}!${update.columnLetter}${update.rowNumber}`;
        if (!bySpreadsheet.has(update.spreadsheetId)) {
          bySpreadsheet.set(update.spreadsheetId, []);
        }
        bySpreadsheet.get(update.spreadsheetId)!.push({ range, values: [['SI']] });
      }
      for (const [ssId, cellUpdates] of bySpreadsheet) {
        const pagadaResult = await batchUpdate(ssId, cellUpdates);
        if (!pagadaResult.ok) {
          pagadaErrors++;
          logError('Failed to write pagada updates', {
            module: 'match-movimientos',
            phase: 'pagada-sync',
            bankName,
            error: pagadaResult.error.message,
          });
        }
      }
    }
  }

  // Revert pagada='' for facturas whose sole movimiento justification was cleared/replaced (ADV-320)
  // Gated on updateResult.ok — consistent with pagada='SI' gate above.
  if (updateResult.ok && pagadaRevertCandidates.size > 0) {
    const revertBySpreadsheet = new Map<string, Array<{ range: string; values: CellValue[][] }>>();

    for (const [fileId, candidate] of pagadaRevertCandidates) {
      // Skip if the movimiento row that justified this revert was version-skipped —
      // its matchedFileId still points at the factura in the sheet, so clearing
      // pagada would desynchronize them (same gate as pagada='SI', ADV-343).
      if (!updateResult.value.appliedKeys.has(candidate.sourceMovimientoKey)) continue;
      // Skip if a new movement in this run is setting pagada='SI' for this same factura
      if (pagadaSetFileIds.has(fileId)) continue;
      // Skip if the factura still has a linked pago that justifies pagada='SI'
      const doc = documentMap.get(fileId);
      if (doc && (doc.type === 'factura_emitida' || doc.type === 'factura_recibida')) {
        if (doc.document.matchedPagoFileId) continue;
      }

      const range = `${candidate.sheetName}!${candidate.columnLetter}${candidate.rowNumber}`;
      if (!revertBySpreadsheet.has(candidate.spreadsheetId)) {
        revertBySpreadsheet.set(candidate.spreadsheetId, []);
      }
      revertBySpreadsheet.get(candidate.spreadsheetId)!.push({ range, values: [['']] });
    }

    for (const [ssId, cellUpdates] of revertBySpreadsheet) {
      const revertResult = await batchUpdate(ssId, cellUpdates);
      if (!revertResult.ok) {
        warn('Failed to revert pagada for cleared facturas', {
          module: 'match-movimientos',
          phase: 'pagada-revert',
          bankName,
          error: revertResult.error.message,
        });
      }
    }
  }

  // Get unique sheets processed
  const sheetsProcessed = new Set(movimientos.map(m => m.sheetName)).size;

  return {
    skipped: false,
    spreadsheetName: bankName,
    sheetsProcessed,
    movimientosProcessed: movimientos.length,
    movimientosFilled: debitsFilled + creditsFilled,
    debitsFilled,
    creditsFilled,
    noMatches,
    errors: updateResult.ok ? 0 : 1,
    pagadaErrors,
    duration: Date.now() - startTime,
  };
}

export async function matchAllMovimientos(
  options: MatchOptions = {}
): Promise<Result<MatchAllResult, Error>> {
  const lockResult = await withLock(
    PROCESSING_LOCK_ID,
    async () => {
      const startTime = Date.now();
      const currentYear = businessYear(); // Argentina business timezone (ADV-353)

      // Get folder structure
      const folderStructure = getCachedFolderStructure();
      if (!folderStructure) {
        return { ok: false, error: new Error('Folder structure not cached. Run scan first.') };
      }

      const { controlIngresosId, controlEgresosId, movimientosSpreadsheets } = folderStructure;

      // Load Control data ONCE
      debug('Loading Control de Ingresos data', { module: 'match-movimientos' });
      const ingresosResult = await loadControlIngresos(controlIngresosId);
      if (!ingresosResult.ok) {
        return ingresosResult;
      }

      debug('Loading Control de Egresos data', { module: 'match-movimientos' });
      const egresosResult = await loadControlEgresos(controlEgresosId);
      if (!egresosResult.ok) {
        return egresosResult;
      }

      // Prefetch exchange rates for USD documents before matching
      const usdDates = extractUsdDocumentDates(
        ingresosResult.value.pagosRecibidos,
        ingresosResult.value.facturasEmitidas,
        egresosResult.value.facturasRecibidas,
        egresosResult.value.pagosEnviados
      );
      if (usdDates.length > 0) {
        try {
          await prefetchExchangeRates(usdDates);
        } catch (err) {
          warn('Failed to prefetch exchange rates, continuing without pre-cached rates', {
            module: 'match-movimientos',
            action: 'prefetchExchangeRates',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Create matcher instance
      const matcher = new BankMovementMatcher();

      // Build document Map once — O(N) lookup instead of O(N) per movement
      const documentMap = buildDocumentMap(
        ingresosResult.value.facturasEmitidas,
        ingresosResult.value.pagosRecibidos,
        egresosResult.value.facturasRecibidas,
        egresosResult.value.pagosEnviados,
        egresosResult.value.recibos
      );

      // Global exclusion set grows as banks are processed sequentially.
      // Prevents the same document from being matched across different banks.
      const globalExcludeFileIds = new Set<string>();

      // Process banks SEQUENTIALLY for memory efficiency
      const results: MatchMovimientosResult[] = [];

      for (const [bankName, spreadsheetId] of movimientosSpreadsheets) {
        // Allow GC between banks
        await new Promise(resolve => setImmediate(resolve));

        debug('Processing bank movimientos', {
          module: 'match-movimientos',
          bankName,
        });

        const result = await matchBankMovimientos(
          bankName,
          spreadsheetId,
          matcher,
          ingresosResult.value,
          egresosResult.value,
          options,
          currentYear,
          documentMap,
          controlIngresosId,
          controlEgresosId,
          globalExcludeFileIds
        );

        results.push(result);

        info('Completed bank movimientos matching', {
          module: 'match-movimientos',
          bankName,
          filled: result.movimientosFilled,
          noMatches: result.noMatches,
          duration: result.duration,
        });
      }

      // Sync Pagos Pendientes and Cobros Pendientes dashboards after pagada writes
      const { dashboardOperativoId, rootId } = folderStructure;
      if (dashboardOperativoId) {
        await syncPagosPendientes(controlEgresosId, dashboardOperativoId);
        await syncCobrosPendientes(controlIngresosId, dashboardOperativoId);
      }

      // Sync Subdiario de Ventas — runs unconditionally; errors are caught and logged
      try {
        const subdiarioResult = await syncSubdiario(
          rootId,
          controlIngresosId,
          controlEgresosId,
          currentYear,
          movimientosSpreadsheets
        );
        if (subdiarioResult.ok) {
          info('Subdiario de Ventas sync completed', {
            module: 'match-movimientos',
            phase: 'sync-subdiario',
            rowsWritten: subdiarioResult.value.rowsWritten,
            gapsDetected: subdiarioResult.value.gapsDetected,
            inserts: subdiarioResult.value.inserts,
            updates: subdiarioResult.value.updates,
            deletes: subdiarioResult.value.deletes,
            sortInvariantFallback: subdiarioResult.value.sortInvariantFallback,
          });
        }
        // ok:false: writer already logged the cause at lib layer; caller does not re-log.
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logError('Subdiario de Ventas sync threw unexpectedly', {
          module: 'match-movimientos',
          phase: 'sync-subdiario',
          error: error.message,
        });
      }

      // Calculate totals
      const totalProcessed = results.reduce((sum, r) => sum + r.movimientosProcessed, 0);
      const totalFilled = results.reduce((sum, r) => sum + r.movimientosFilled, 0);
      const totalDebitsFilled = results.reduce((sum, r) => sum + r.debitsFilled, 0);
      const totalCreditsFilled = results.reduce((sum, r) => sum + r.creditsFilled, 0);
      const totalPagadaErrors = results.reduce((sum, r) => sum + r.pagadaErrors, 0);

      return {
        ok: true as const,
        value: {
          skipped: false,
          results,
          totalProcessed,
          totalFilled,
          totalDebitsFilled,
          totalCreditsFilled,
          totalPagadaErrors,
          duration: Date.now() - startTime,
        },
      };
    },
    PROCESSING_LOCK_TIMEOUT_MS,
    PROCESSING_LOCK_EXPIRY_MS   // ADV-302
  );

  // `withLock` returns ok:false for two distinct cases:
  //   1. Lock acquisition timeout — concurrent scan/match already running.
  //   2. The locked callback itself threw — a real production failure.
  // Only case (1) should be reported as `skipped/already_running`. Case (2)
  // must surface to the caller so it appears in logs and the HTTP response
  // (Codex P2 review on PR 112).
  if (!lockResult.ok) {
    const isLockAcquisitionTimeout = lockResult.error.message.startsWith(
      `Failed to acquire lock for ${PROCESSING_LOCK_ID}`,
    );
    if (isLockAcquisitionTimeout) {
      info('Match movimientos skipped - scan or match already running', {
        module: 'match-movimientos',
      });
      return {
        ok: true,
        value: {
          skipped: true,
          reason: 'already_running',
          results: [],
          totalProcessed: 0,
          totalFilled: 0,
          totalDebitsFilled: 0,
          totalCreditsFilled: 0,
          totalPagadaErrors: 0,
          duration: 0,
        },
      };
    }
    // Unexpected exception inside the locked callback — propagate so the
    // caller (route handler, logs, monitoring) can react.
    logError('Match movimientos failed unexpectedly inside lock', {
      module: 'match-movimientos',
      error: lockResult.error.message,
    });
    return { ok: false, error: lockResult.error };
  }

  // Unwrap the nested result - callback returns Result<MatchAllResult, Error>
  const innerResult = lockResult.value as Result<MatchAllResult, Error>;
  return innerResult;
}
