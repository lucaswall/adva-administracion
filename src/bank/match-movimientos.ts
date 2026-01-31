/**
 * Match movimientos orchestration service
 * Matches bank movements against Control de Ingresos/Egresos
 */

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
import { PROCESSING_LOCK_ID, PROCESSING_LOCK_TIMEOUT_MS } from '../config.js';
import { withLock } from '../utils/concurrency.js';
import { info, warn, debug } from '../utils/logger.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { getValues, type CellValue } from '../services/sheets.js';
import { parseNumber } from '../utils/numbers.js';
import { BankMovementMatcher } from './matcher.js';
import { getMovimientosToFill } from '../services/movimientos-reader.js';
import { updateDetalle, type DetalleUpdate } from '../services/movimientos-detalle.js';

/**
 * Quality metrics for match comparison (replacement logic)
 */
export interface MatchQuality {
  fileId: string;
  hasCuitMatch: boolean;
  dateDistance: number;
  isExactAmount: boolean;
  hasLinkedPago: boolean;
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
 * Returns true if candidate match is strictly better than existing match
 * Used for replacement logic
 */
export function isBetterMatch(
  existing: MatchQuality,
  candidate: MatchQuality
): boolean {
  // 1. CUIT match beats no CUIT match
  if (candidate.hasCuitMatch && !existing.hasCuitMatch) return true;
  if (!candidate.hasCuitMatch && existing.hasCuitMatch) return false;

  // 2. Closer date wins (when CUIT match is equal)
  if (candidate.dateDistance < existing.dateDistance) return true;
  if (candidate.dateDistance > existing.dateDistance) return false;

  // 3. Exact amount beats tolerance match
  if (candidate.isExactAmount && !existing.isExactAmount) return true;
  if (!candidate.isExactAmount && existing.isExactAmount) return false;

  // 4. Has linked pago beats no linked pago
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

  const colIndex = {
    fechaEmision: headers.indexOf('fechaemision'),
    fileId: headers.indexOf('fileid'),
    fileName: headers.indexOf('filename'),
    tipoComprobante: headers.indexOf('tipocomprobante'),
    nroFactura: headers.indexOf('nrofactura'),
    cuitEmisor: headers.indexOf('cuitemisor'),
    razonSocialEmisor: headers.indexOf('razonsocialemisor'),
    cuitReceptor: headers.indexOf('cuitreceptor'),
    razonSocialReceptor: headers.indexOf('razonsocialreceptor'),
    importeNeto: headers.indexOf('importeneto'),
    importeIva: headers.indexOf('importeiva'),
    importeTotal: headers.indexOf('importetotal'),
    moneda: headers.indexOf('moneda'),
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

  const colIndex = {
    fechaPago: headers.indexOf('fechapago'),
    fileId: headers.indexOf('fileid'),
    fileName: headers.indexOf('filename'),
    banco: headers.indexOf('banco'),
    importePagado: headers.indexOf('importepagado'),
    moneda: headers.indexOf('moneda'),
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

  const colIndex = {
    fechaPago: headers.indexOf('fechapago'),
    fileId: headers.indexOf('fileid'),
    fileName: headers.indexOf('filename'),
    tipoRecibo: headers.indexOf('tiporecibo'),
    nombreEmpleado: headers.indexOf('nombreempleado'),
    cuilEmpleado: headers.indexOf('cuilempleado'),
    legajo: headers.indexOf('legajo'),
    tareaDesempenada: headers.indexOf('tareadesempenada'),
    cuitEmpleador: headers.indexOf('cuitempleador'),
    periodoAbonado: headers.indexOf('periodoabonado'),
    subtotalRemuneraciones: headers.indexOf('subtotalremuneraciones'),
    subtotalDescuentos: headers.indexOf('subtotaldescuentos'),
    totalNeto: headers.indexOf('totalneto'),
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

  const colIndex = {
    fechaEmision: headers.indexOf('fechaemision'),
    fileId: headers.indexOf('fileid'),
    fileName: headers.indexOf('filename'),
    nroCertificado: headers.indexOf('nrocertificado'),
    cuitAgenteRetencion: headers.indexOf('cuitagenteretencion'),
    razonSocialAgenteRetencion: headers.indexOf('razonsocialagenteretencion'),
    impuesto: headers.indexOf('impuesto'),
    regimen: headers.indexOf('regimen'),
    montoComprobante: headers.indexOf('montocomprobante'),
    montoRetencion: headers.indexOf('montoretencion'),
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
      cuitSujetoRetenido: '30709076783',  // Always ADVA
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
    // Skip if already has match and not force mode
    if (!options.force && mov.matchedFileId) {
      continue;
    }

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

    // Only update if there's a match
    if (matchResult.matchType !== 'no_match' && matchResult.matchedFileId) {
      updates.push({
        sheetName: mov.sheetName,
        rowNumber: mov.rowNumber,
        matchedFileId: matchResult.matchedFileId,
        detalle: matchResult.description,
      });

      if (mov.debito !== null && mov.debito > 0) {
        debitsFilled++;
      } else {
        creditsFilled++;
      }
    } else {
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

      const { controlIngresosId, controlEgresosId, bankSpreadsheets } = folderStructure;

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

      for (const [bankName, spreadsheetId] of bankSpreadsheets) {
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
