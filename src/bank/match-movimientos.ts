/**
 * Match movimientos orchestration service
 * Matches bank movements against Control de Ingresos/Egresos
 */

import { createHash } from 'crypto';
import type {
  Result,
  Factura,
  Pago,
  Recibo,
  Retencion,
  MovimientoRow,
  BankMovement,
  MatchConfidence,
} from '../types/index.js';
import { PROCESSING_LOCK_ID, PROCESSING_LOCK_TIMEOUT_MS, ADVA_CUITS } from '../config.js';
import { withLock } from '../utils/concurrency.js';
import { info, warn, debug } from '../utils/logger.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { getValues, type CellValue } from '../services/sheets.js';
import { parseNumber } from '../utils/numbers.js';
import { parseArgDate } from '../utils/date.js';
import { BankMovementMatcher, type MatchQuality } from './matcher.js';
import { getMovimientosToFill } from '../services/movimientos-reader.js';
import { updateDetalle, type DetalleUpdate } from '../services/movimientos-detalle.js';

// Re-export MatchQuality for test compatibility
export type { MatchQuality };

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
  origenConcepto: string;
  /** Debit amount */
  debito: number | null;
  /** Credit amount */
  credito: number | null;
  /** Google Drive fileId of matched document */
  matchedFileId: string;
  /** Human-readable match description */
  detalle: string;
}

/**
 * Computes a version hash for a movimiento row.
 * Used for TOCTOU protection - if the version changes between read and write,
 * the update should be skipped to avoid overwriting concurrent modifications.
 *
 * The version is based on fields that could change during concurrent updates:
 * - matchedFileId and detalle (the fields we're updating)
 * - fecha, origenConcepto, debito, credito (immutable but included for row identity)
 *
 * @param row - Row data to compute version for
 * @returns Hex string hash of the row data
 */
export function computeRowVersion(row: VersionableRow): string {
  const data = [
    row.fecha,
    row.origenConcepto,
    row.debito?.toString() ?? '',
    row.credito?.toString() ?? '',
    row.matchedFileId,
    row.detalle,
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
  movimientosFilled: number;
  debitsFilled: number;
  creditsFilled: number;
  noMatches: number;
  errors: number;
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
 * Numeric value for confidence levels (higher is better)
 */
const CONFIDENCE_RANK: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Returns true if candidate match is strictly better than existing match
 * Used for replacement logic
 */
export function isBetterMatch(
  existing: MatchQuality,
  candidate: MatchQuality
): boolean {
  // 1. Compare confidence levels first (ADV-34: prevents LOW replacing HIGH)
  const existingConfRank = CONFIDENCE_RANK[existing.confidence];
  const candidateConfRank = CONFIDENCE_RANK[candidate.confidence];
  if (candidateConfRank > existingConfRank) return true;
  if (candidateConfRank < existingConfRank) return false;

  // 2. CUIT match beats no CUIT match (when confidence is equal)
  if (candidate.hasCuitMatch && !existing.hasCuitMatch) return true;
  if (!candidate.hasCuitMatch && existing.hasCuitMatch) return false;

  // 3. Closer date wins (when CUIT match is equal)
  if (candidate.dateDistance < existing.dateDistance) return true;
  if (candidate.dateDistance > existing.dateDistance) return false;

  // 4. Exact amount beats tolerance match
  if (candidate.isExactAmount && !existing.isExactAmount) return true;
  if (!candidate.isExactAmount && existing.isExactAmount) return false;

  // 5. Has linked pago beats no linked pago
  if (candidate.hasLinkedPago && !existing.hasLinkedPago) return true;

  // Equal quality - keep existing (no churn)
  return false;
}

/**
 * Converts MovimientoRow to BankMovement for matcher compatibility
 */
function movimientoRowToBankMovement(mov: MovimientoRow): BankMovement {
  return {
    row: mov.rowNumber,
    fecha: mov.fecha,
    fechaValor: mov.fecha,
    concepto: mov.origenConcepto,
    codigo: '',
    oficina: '',
    areaAdva: '',
    credito: mov.credito,
    debito: mov.debito,
    detalle: mov.detalle,
  };
}

/**
 * Parses Facturas from spreadsheet data using header-based lookup
 */
function parseFacturas(data: CellValue[][]): Array<Factura & { row: number }> {
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h || '').toLowerCase());
  const facturas: Array<Factura & { row: number }> = [];

  // Required headers - throw if missing (critical for matching)
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
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colIndex.fileId]) continue;

    facturas.push({
      row: i + 1,
      fechaEmision: String(row[colIndex.fechaEmision] || ''),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      tipoComprobante: String(row[colIndex.tipoComprobante] || 'A') as any,
      nroFactura: String(row[colIndex.nroFactura] || ''),
      cuitEmisor: String(row[colIndex.cuitEmisor] || ''),
      razonSocialEmisor: String(row[colIndex.razonSocialEmisor] || ''),
      cuitReceptor: String(row[colIndex.cuitReceptor] || ''),
      razonSocialReceptor: String(row[colIndex.razonSocialReceptor] || ''),
      importeNeto: parseNumber(row[colIndex.importeNeto]) || 0,
      importeIva: parseNumber(row[colIndex.importeIva]) || 0,
      importeTotal: parseNumber(row[colIndex.importeTotal]) || 0,
      moneda: (String(row[colIndex.moneda] || 'ARS') as 'ARS' | 'USD'),
      concepto: String(row[colIndex.concepto] || ''),
      processedAt: String(row[colIndex.processedAt] || ''),
      confidence: parseNumber(row[colIndex.confidence]) || 0,
      needsReview: row[colIndex.needsReview] === 'YES',
      matchedPagoFileId: row[colIndex.matchedPagoFileId] ? String(row[colIndex.matchedPagoFileId]) : undefined,
      matchConfidence: row[colIndex.matchConfidence] ? (String(row[colIndex.matchConfidence]) as MatchConfidence) : undefined,
    });
  }

  return facturas;
}

/**
 * Parses Pagos from spreadsheet data using header-based lookup
 */
function parsePagos(data: CellValue[][]): Array<Pago & { row: number }> {
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
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colIndex.fileId]) continue;

    pagos.push({
      row: i + 1,
      fechaPago: String(row[colIndex.fechaPago] || ''),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      banco: String(row[colIndex.banco] || ''),
      importePagado: parseNumber(row[colIndex.importePagado]) || 0,
      moneda: (String(row[colIndex.moneda] || 'ARS') as 'ARS' | 'USD'),
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
      matchConfidence: row[colIndex.matchConfidence] ? (String(row[colIndex.matchConfidence]) as MatchConfidence) : undefined,
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
      fechaPago: String(row[colIndex.fechaPago] || ''),
      fileId: String(row[colIndex.fileId] || ''),
      fileName: String(row[colIndex.fileName] || ''),
      tipoRecibo: (String(row[colIndex.tipoRecibo] || 'sueldo') as 'sueldo' | 'liquidacion_final'),
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
function parseRetenciones(data: CellValue[][]): Array<Retencion & { row: number }> {
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
      fechaEmision: String(row[colIndex.fechaEmision] || ''),
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
      matchConfidence: row[colIndex.matchConfidence] ? (String(row[colIndex.matchConfidence]) as MatchConfidence) : undefined,
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
      getValues(spreadsheetId, 'Facturas Emitidas!A:R'),
      getValues(spreadsheetId, 'Pagos Recibidos!A:O'),
      getValues(spreadsheetId, 'Retenciones Recibidas!A:O'),
    ]);

    if (!facturasResult.ok) return facturasResult;
    if (!pagosResult.ok) return pagosResult;
    if (!retencionesResult.ok) return retencionesResult;

    return {
      ok: true,
      value: {
        facturasEmitidas: parseFacturas(facturasResult.value),
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
      getValues(spreadsheetId, 'Facturas Recibidas!A:S'),
      getValues(spreadsheetId, 'Pagos Enviados!A:O'),
      getValues(spreadsheetId, 'Recibos!A:R'),
    ]);

    if (!facturasResult.ok) return facturasResult;
    if (!pagosResult.ok) return pagosResult;
    if (!recibosResult.ok) return recibosResult;

    return {
      ok: true,
      value: {
        facturasRecibidas: parseFacturas(facturasResult.value),
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
 * Builds MatchQuality from a document (Factura, Pago, or Recibo) and movement
 */
function buildMatchQuality(
  fileId: string,
  confidence: 'HIGH' | 'MEDIUM' | 'LOW',
  fechaDocumento: string,
  fechaMovimiento: string,
  cuitDocumento: string,
  conceptoMovimiento: string,
  hasLinkedPago: boolean,
  isExactAmount: boolean
): MatchQuality {
  // Calculate date distance in days using parseArgDate for Argentine format support
  const docDate = parseArgDate(fechaDocumento);
  const movDate = parseArgDate(fechaMovimiento);

  // Handle invalid dates - use Infinity for worst possible score
  const dateDistance = (docDate && movDate)
    ? Math.abs(Math.floor((docDate.getTime() - movDate.getTime()) / (1000 * 60 * 60 * 24)))
    : Infinity;

  // Check for CUIT match in concepto
  const hasCuitMatch = conceptoMovimiento.includes(cuitDocumento);

  return {
    fileId,
    confidence,
    hasCuitMatch,
    dateDistance,
    isExactAmount,
    hasLinkedPago,
  };
}

/**
 * Finds a document by fileId in the provided arrays
 * Returns the document and its type for building MatchQuality
 */
function findDocumentByFileId(
  fileId: string,
  facturasEmitidas: Array<Factura & { row: number }>,
  pagosRecibidos: Array<Pago & { row: number }>,
  facturasRecibidas: Array<Factura & { row: number }>,
  pagosEnviados: Array<Pago & { row: number }>,
  recibos: Array<Recibo & { row: number }>
): { document: any; type: 'factura_emitida' | 'pago_recibido' | 'factura_recibida' | 'pago_enviado' | 'recibo' } | null {
  // Search in facturas emitidas
  const facturaEmitida = facturasEmitidas.find(f => f.fileId === fileId);
  if (facturaEmitida) {
    return { document: facturaEmitida, type: 'factura_emitida' };
  }

  // Search in pagos recibidos
  const pagoRecibido = pagosRecibidos.find(p => p.fileId === fileId);
  if (pagoRecibido) {
    return { document: pagoRecibido, type: 'pago_recibido' };
  }

  // Search in facturas recibidas
  const facturaRecibida = facturasRecibidas.find(f => f.fileId === fileId);
  if (facturaRecibida) {
    return { document: facturaRecibida, type: 'factura_recibida' };
  }

  // Search in pagos enviados
  const pagoEnviado = pagosEnviados.find(p => p.fileId === fileId);
  if (pagoEnviado) {
    return { document: pagoEnviado, type: 'pago_enviado' };
  }

  // Search in recibos
  const recibo = recibos.find(r => r.fileId === fileId);
  if (recibo) {
    return { document: recibo, type: 'recibo' };
  }

  return null;
}

/**
 * Builds MatchQuality for an existing match by looking up the document
 */
function buildMatchQualityFromFileId(
  fileId: string,
  fechaMovimiento: string,
  conceptoMovimiento: string,
  ingresosData: IngresosData,
  egresosData: EgresosData
): MatchQuality | null {
  const found = findDocumentByFileId(
    fileId,
    ingresosData.facturasEmitidas,
    ingresosData.pagosRecibidos,
    egresosData.facturasRecibidas,
    egresosData.pagosEnviados,
    egresosData.recibos
  );

  if (!found) {
    return null;
  }

  const { document, type } = found;

  // Extract relevant fields based on document type
  let fechaDocumento: string;
  let cuitDocumento: string;
  let hasLinkedPago = false;
  // Use document's matchConfidence if available, default to HIGH for existing matches
  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = document.matchConfidence || 'HIGH';

  if (type === 'factura_emitida' || type === 'factura_recibida') {
    fechaDocumento = document.fechaEmision;
    cuitDocumento = type === 'factura_emitida' ? document.cuitReceptor : document.cuitEmisor;
    hasLinkedPago = !!document.matchedPagoFileId;
  } else if (type === 'pago_recibido' || type === 'pago_enviado') {
    fechaDocumento = document.fechaPago;
    cuitDocumento = type === 'pago_recibido' ? document.cuitPagador : document.cuitBeneficiario;
    hasLinkedPago = !!document.matchedFacturaFileId;
  } else if (type === 'recibo') {
    fechaDocumento = document.fechaPago;
    cuitDocumento = document.cuilEmpleado;
    hasLinkedPago = false;
  } else {
    return null;
  }

  // For isExactAmount, we can't determine this without re-running the match
  // Set to true for both existing and candidate to ensure fair comparison on other dimensions
  return buildMatchQuality(
    fileId,
    confidence,
    fechaDocumento,
    fechaMovimiento,
    cuitDocumento,
    conceptoMovimiento,
    hasLinkedPago,
    true  // Set to true for both to ensure fair comparison on other dimensions
  );
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
  currentYear: number
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
      duration: Date.now() - startTime,
    };
  }

  const movimientos = movimientosResult.value;
  const updates: DetalleUpdate[] = [];
  let debitsFilled = 0;
  let creditsFilled = 0;
  let noMatches = 0;

  // Process each movimiento
  for (const mov of movimientos) {
    const bankMovement = movimientoRowToBankMovement(mov);
    let matchResult;

    // Route to appropriate matcher based on debit/credit
    if (mov.debito !== null && mov.debito > 0) {
      // Debit movement - use existing matchMovement
      // Signature: matchMovement(movement, facturas, recibos, pagos)
      matchResult = matcher.matchMovement(
        bankMovement,
        egresosData.facturasRecibidas,
        egresosData.recibos,
        egresosData.pagosEnviados
      );
    } else if (mov.credito !== null && mov.credito > 0) {
      // Credit movement - use new matchCreditMovement
      matchResult = matcher.matchCreditMovement(
        bankMovement,
        ingresosData.facturasEmitidas,
        ingresosData.pagosRecibidos,
        ingresosData.retenciones
      );
    } else {
      // No amount - skip
      continue;
    }

    // Handle match result with replacement logic
    if (matchResult.matchType !== 'no_match' && matchResult.matchedFileId) {
      // Found a new candidate match
      let shouldUpdate = false;

      if (options.force || !mov.matchedFileId) {
        // Force mode OR no existing match - always update
        shouldUpdate = true;
      } else {
        // Has existing match - compare quality
        const existingQuality = buildMatchQualityFromFileId(
          mov.matchedFileId,
          mov.fecha,
          mov.origenConcepto,
          ingresosData,
          egresosData
        );

        if (!existingQuality) {
          // Couldn't find existing document - can't compare quality, keep existing match
          warn(
            'Existing matched document no longer exists in Control sheets, keeping orphaned match',
            { matchedFileId: mov.matchedFileId, bankName, fecha: mov.fecha }
          );
          shouldUpdate = false;
        } else {
          // Build candidate quality
          // Note: matchResult doesn't provide all fields we need, so we need to look up the document
          const candidateDoc = findDocumentByFileId(
            matchResult.matchedFileId,
            ingresosData.facturasEmitidas,
            ingresosData.pagosRecibidos,
            egresosData.facturasRecibidas,
            egresosData.pagosEnviados,
            egresosData.recibos
          );

          if (candidateDoc) {
            const { document, type } = candidateDoc;
            let fechaDocumento: string;
            let cuitDocumento: string;
            let hasLinkedPago = false;

            if (type === 'factura_emitida' || type === 'factura_recibida') {
              fechaDocumento = document.fechaEmision;
              cuitDocumento = type === 'factura_emitida' ? document.cuitReceptor : document.cuitEmisor;
              hasLinkedPago = !!document.matchedPagoFileId;
            } else if (type === 'pago_recibido' || type === 'pago_enviado') {
              fechaDocumento = document.fechaPago;
              cuitDocumento = type === 'pago_recibido' ? document.cuitPagador : document.cuitBeneficiario;
              hasLinkedPago = !!document.matchedFacturaFileId;
            } else if (type === 'recibo') {
              fechaDocumento = document.fechaPago;
              cuitDocumento = document.cuilEmpleado;
              hasLinkedPago = false;
            } else {
              // Unknown type - replace with new match
              shouldUpdate = true;
              fechaDocumento = '';
              cuitDocumento = '';
            }

            if (fechaDocumento && cuitDocumento) {
              // For isExactAmount, we can't reliably determine this without re-running complex matching
              // Use the same value for both (true) so they compare equally on this dimension
              // This ensures the comparison focuses on confidence, CUIT match, and date proximity
              const candidateQuality = buildMatchQuality(
                matchResult.matchedFileId,
                matchResult.confidence,  // Use confidence from matcher result (ADV-34)
                fechaDocumento,
                mov.fecha,
                cuitDocumento,
                mov.origenConcepto,
                hasLinkedPago,
                true  // Consistent with existing for fair comparison
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
          matchedFileId: matchResult.matchedFileId,
          detalle: matchResult.description,
          expectedVersion,
        });

        if (mov.debito !== null && mov.debito > 0) {
          debitsFilled++;
        } else {
          creditsFilled++;
        }
      }
    } else {
      // No match found
      noMatches++;
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

  // Get unique sheets processed
  const sheetsProcessed = new Set(movimientos.map(m => m.sheetName)).size;

  return {
    skipped: false,
    spreadsheetName: bankName,
    sheetsProcessed,
    movimientosProcessed: movimientos.length,
    movimientosFilled: updates.length,
    debitsFilled,
    creditsFilled,
    noMatches,
    errors: updateResult.ok ? 0 : 1,
    duration: Date.now() - startTime,
  };
}

/**
 * Matches all movimientos across all banks
 * Uses unified lock to prevent concurrent execution with scanner
 */
export async function matchAllMovimientos(
  options: MatchOptions = {}
): Promise<Result<MatchAllResult, Error>> {
  const lockResult = await withLock(
    PROCESSING_LOCK_ID,
    async () => {
      const startTime = Date.now();
      const currentYear = new Date().getFullYear();

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

      // Create matcher instance
      const matcher = new BankMovementMatcher();

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
          currentYear
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

      // Calculate totals
      const totalProcessed = results.reduce((sum, r) => sum + r.movimientosProcessed, 0);
      const totalFilled = results.reduce((sum, r) => sum + r.movimientosFilled, 0);
      const totalDebitsFilled = results.reduce((sum, r) => sum + r.debitsFilled, 0);
      const totalCreditsFilled = results.reduce((sum, r) => sum + r.creditsFilled, 0);

      return {
        ok: true as const,
        value: {
          skipped: false,
          results,
          totalProcessed,
          totalFilled,
          totalDebitsFilled,
          totalCreditsFilled,
          duration: Date.now() - startTime,
        },
      };
    },
    PROCESSING_LOCK_TIMEOUT_MS,
    PROCESSING_LOCK_TIMEOUT_MS
  );

  // Handle lock acquisition failure
  if (!lockResult.ok) {
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
        duration: 0,
      },
    };
  }

  // Unwrap the nested result - callback returns Result<MatchAllResult, Error>
  const innerResult = lockResult.value as Result<MatchAllResult, Error>;
  return innerResult;
}
