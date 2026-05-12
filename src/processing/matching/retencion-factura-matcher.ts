/**
 * Retencion to Factura Emitida matching
 * Matches tax withholding certificates (retenciones recibidas) with the
 * corresponding facturas emitidas they were withheld against.
 */

import type { Result, MatchConfidence } from '../../types/index.js';
import { getValues, setValues } from '../../services/sheets.js';
import { parseNumber, amountsMatch } from '../../utils/numbers.js';
import { normalizeSpreadsheetDate, parseArgDate, isWithinDays } from '../../utils/date.js';
import { debug, info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

/**
 * Represents a parsed row from Retenciones Recibidas sheet (A:O, 0-indexed)
 */
interface RetencionRow {
  /** Row number (1-indexed, including header) */
  rowNumber: number;
  /** Issue date (ISO format YYYY-MM-DD) */
  fechaEmision: string;
  /** Google Drive file ID */
  fileId: string;
  /** CUIT of withholding agent */
  cuitAgenteRetencion: string;
  /** Original invoice amount (used to match with factura importeTotal) */
  montoComprobante: number;
  /** Already-matched factura file ID (empty if unmatched) */
  matchedFacturaFileId: string;
  /** Match confidence (empty or 'HIGH'|'MEDIUM'|'LOW'|'MANUAL') */
  matchConfidence: string;
}

/**
 * Represents a parsed row from Facturas Emitidas sheet (A:U after ADV-245, 0-indexed)
 */
interface FacturaEmitidaRow {
  /** Row number (1-indexed, including header) */
  rowNumber: number;
  /** Issue date (ISO format YYYY-MM-DD) */
  fechaEmision: string;
  /** Google Drive file ID */
  fileId: string;
  /** Client CUIT */
  cuitReceptor: string;
  /** Total invoice amount */
  importeTotal: number;
  /** Match confidence (empty or 'HIGH'|'MEDIUM'|'LOW'|'MANUAL') */
  matchConfidence: string;
}

/**
 * Parses Retenciones Recibidas sheet rows into typed objects
 *
 * Column layout (0-indexed):
 * 0: fechaEmision, 1: fileId, 2: fileName, 3: nroCertificado,
 * 4: cuitAgenteRetencion, 5: razonSocialAgenteRetencion,
 * 6: impuesto, 7: regimen, 8: montoComprobante, 9: montoRetencion,
 * 10: processedAt, 11: confidence, 12: needsReview,
 * 13: matchedFacturaFileId, 14: matchConfidence
 */
function parseRetencionRows(rows: unknown[][]): RetencionRow[] {
  const result: RetencionRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 9) continue;

    result.push({
      rowNumber: i + 1, // 1-indexed, accounting for header
      fechaEmision: normalizeSpreadsheetDate(row[0]),
      fileId: String(row[1] || ''),
      cuitAgenteRetencion: String(row[4] || ''),
      montoComprobante: parseNumber(String(row[8] || '0')) ?? 0,
      matchedFacturaFileId: String(row[13] || ''),
      matchConfidence: String(row[14] || ''),
    });
  }

  return result;
}

/**
 * Parses Facturas Emitidas sheet rows into typed objects.
 *
 * Post-ADV-245 column layout (21 cols, 0-indexed):
 * 0: fechaEmision, 1: fileId, 2: fileName, 3: tipoComprobante, 4: nroFactura,
 * 5: cuitReceptor, 6: razonSocialReceptor, 7: condicionIVAReceptor,
 * 8: importeNeto, 9: importeIva, 10: importeTotal, 11: moneda,
 * 12: concepto, 13: processedAt, 14: confidence, 15: needsReview,
 * 16: matchedPagoFileId, 17: matchConfidence, 18: hasCuitMatch,
 * 19: pagada, 20: tipoDeCambio
 */
function parseFacturaEmitidaRows(rows: unknown[][]): FacturaEmitidaRow[] {
  const result: FacturaEmitidaRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 11) continue;

    result.push({
      rowNumber: i + 1, // 1-indexed, accounting for header
      fechaEmision: normalizeSpreadsheetDate(row[0]),
      fileId: String(row[1] || ''),
      cuitReceptor: String(row[5] || ''),
      importeTotal: parseNumber(String(row[10] || '0')) ?? 0,
      matchConfidence: String(row[17] || ''),
    });
  }

  return result;
}

/**
 * Matches retenciones recibidas with facturas emitidas
 *
 * Matching criteria:
 * - cuitAgenteRetencion === cuitReceptor (factura)
 * - montoComprobante matches importeTotal within $1 tolerance
 * - retencion fechaEmision is 0-90 days after factura fechaEmision
 *
 * Confidence:
 * - HIGH: date difference ≤ 30 days
 * - MEDIUM: date difference 31-90 days
 *
 * MANUAL lock: retenciones with matchConfidence='MANUAL' are skipped,
 * and facturas with matchConfidence='MANUAL' are not considered as candidates.
 *
 * @param spreadsheetId - Control de Ingresos spreadsheet ID
 * @returns Number of retencion-factura pairs matched
 */
export async function matchRetencionesWithFacturas(
  spreadsheetId: string
): Promise<Result<number, Error>> {
  const correlationId = getCorrelationId();

  debug('Starting Retencion-Factura matching', {
    module: 'retencion-factura-matcher',
    phase: 'start',
    spreadsheetId,
    correlationId,
  });

  // Read Retenciones Recibidas (A:O)
  const retencionesResult = await getValues(spreadsheetId, 'Retenciones Recibidas!A:O');
  if (!retencionesResult.ok) {
    return { ok: false, error: retencionesResult.error };
  }

  // Read Facturas Emitidas (A:U after ADV-245 — 21 cols)
  const facturasResult = await getValues(spreadsheetId, 'Facturas Emitidas!A:U');
  if (!facturasResult.ok) {
    return { ok: false, error: facturasResult.error };
  }

  if (retencionesResult.value.length <= 1) {
    debug('No retenciones to match', {
      module: 'retencion-factura-matcher',
      phase: 'start',
      correlationId,
    });
    return { ok: true, value: 0 };
  }

  if (facturasResult.value.length <= 1) {
    debug('No facturas to match', {
      module: 'retencion-factura-matcher',
      phase: 'start',
      correlationId,
    });
    return { ok: true, value: 0 };
  }

  const retenciones = parseRetencionRows(retencionesResult.value as unknown[][]);
  const facturas = parseFacturaEmitidaRows(facturasResult.value as unknown[][]);

  debug('Found documents for retencion-factura matching', {
    module: 'retencion-factura-matcher',
    phase: 'analyze',
    retenciones: retenciones.length,
    facturas: facturas.length,
    correlationId,
  });

  let matchCount = 0;

  // NOTE: Multiple retenciones CAN match the same factura — this is by design.
  // Different tax types (IVA, Ganancias, IIBB) produce separate retention certificates
  // for the same invoice. We do NOT track "claimed" facturas here.
  for (const retencion of retenciones) {
    // Skip already matched retenciones
    if (retencion.matchedFacturaFileId) {
      continue;
    }

    // MANUAL lock: skip retenciones with MANUAL confidence
    if (retencion.matchConfidence === 'MANUAL') {
      continue;
    }

    // Parse retencion date once
    const retDate = parseArgDate(retencion.fechaEmision);
    if (!retDate) {
      warn('Invalid retencion fechaEmision', {
        module: 'retencion-factura-matcher',
        phase: 'match',
        fileId: retencion.fileId,
        fechaEmision: retencion.fechaEmision,
        correlationId,
      });
      continue;
    }

    for (const factura of facturas) {
      // MANUAL lock: skip facturas with MANUAL confidence
      if (factura.matchConfidence === 'MANUAL') {
        continue;
      }

      // CUIT must match: withholding agent = invoice client
      if (retencion.cuitAgenteRetencion !== factura.cuitReceptor) {
        continue;
      }

      // Amount must match within $1 tolerance
      // retenciones are always ARS - no cross-currency needed
      if (!amountsMatch(retencion.montoComprobante, factura.importeTotal, 1)) {
        continue;
      }

      // Parse factura date
      const factDate = parseArgDate(factura.fechaEmision);
      if (!factDate) {
        continue;
      }

      // Retencion must be 0-90 days after factura
      // isWithinDays(date1, date2, daysBefore, daysAfter)
      // We want: factDate ≤ retDate ≤ factDate + 90
      // i.e. retDate is 0-90 days AFTER factDate
      // => isWithinDays(factDate, retDate, 0, 90)
      if (!isWithinDays(factDate, retDate, 0, 90)) {
        continue;
      }

      // Calculate date difference in days for confidence determination
      const diffDays = Math.floor(
        (retDate.getTime() - factDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const confidence: MatchConfidence = diffDays <= 30 ? 'HIGH' : 'MEDIUM';

      info('Retencion-Factura match found', {
        module: 'retencion-factura-matcher',
        phase: 'match',
        retencionFileId: retencion.fileId,
        facturaFileId: factura.fileId,
        cuit: retencion.cuitAgenteRetencion,
        montoComprobante: retencion.montoComprobante,
        importeTotal: factura.importeTotal,
        diffDays,
        confidence,
        correlationId,
      });

      // Write matchedFacturaFileId and matchConfidence to Retenciones!N:O
      const updateResult = await setValues(
        spreadsheetId,
        `Retenciones Recibidas!N${retencion.rowNumber}:O${retencion.rowNumber}`,
        [[factura.fileId, confidence]]
      );

      if (!updateResult.ok) {
        warn('Failed to update retencion match', {
          module: 'retencion-factura-matcher',
          phase: 'match',
          retencionFileId: retencion.fileId,
          error: updateResult.error.message,
          correlationId,
        });
        continue;
      }

      matchCount++;

      // Mark retencion as matched to prevent re-matching
      retencion.matchedFacturaFileId = factura.fileId;

      // First match wins
      break;
    }
  }

  info('Retencion-Factura matching complete', {
    module: 'retencion-factura-matcher',
    phase: 'complete',
    matchCount,
    correlationId,
  });

  return { ok: true, value: matchCount };
}
