/**
 * NC (Nota de Credito) to Factura matching
 * Matches NCs with their original facturas and marks both as paid when amounts match
 */

import type { Result } from '../../types/index.js';
import { getValues, setValues } from '../../services/sheets.js';
import { parseNumber } from '../../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { debug, info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';

/**
 * Represents a row from Facturas Recibidas or Facturas Emitidas sheet
 */
interface FacturaRow {
  /** Row number (1-indexed, including header) */
  rowNumber: number;
  /** Issue date */
  fechaEmision: string;
  /** File ID */
  fileId: string;
  /** Tipo comprobante (A, B, C, NC, ND, etc.) */
  tipoComprobante: string;
  /** Invoice number (e.g., "0002-00003160") */
  nroFactura: string;
  /** CUIT of counterparty — cuitEmisor for Recibidas, cuitReceptor for Emitidas (both at column F/index 5) */
  cuit: string;
  /** Total amount */
  importeTotal: number;
  /** Concepto/description */
  concepto: string;
  /** Whether already marked as paid */
  pagada: string;
  /** Match confidence level — 'MANUAL' means user-locked, must not be re-matched */
  matchConfidence?: string;
}

/**
 * Normalizes a factura number for comparison
 * Handles various formats like "2-3160", "0002-00003160", "00002-3160"
 *
 * @param nroFactura - The factura number to normalize
 * @returns Normalized format "XXXXX-YYYYYYYY" (5 digits - 8 digits)
 */
function normalizeFacturaNumber(nroFactura: string): string {
  // Remove any whitespace
  const cleaned = nroFactura.trim();

  // Split by dash
  const parts = cleaned.split('-');
  if (parts.length !== 2) {
    return cleaned; // Return as-is if not in expected format
  }

  const [punto, numero] = parts;

  // Pad punto to 5 digits and numero to 8 digits
  const normalizedPunto = punto.replace(/^0+/, '').padStart(5, '0');
  const normalizedNumero = numero.replace(/^0+/, '').padStart(8, '0');

  return `${normalizedPunto}-${normalizedNumero}`;
}

/**
 * Extracts referenced factura number from NC concepto
 * Handles patterns like:
 * - "Nota de credito s/ Factura N° 2-3160"
 * - "NC ref. Fact 0002-00003160"
 * - "Anulacion factura 2-3160"
 *
 * @param concepto - The NC concepto text
 * @returns Normalized factura number or null if not found
 */
export function extractReferencedFacturaNumber(concepto: string): string | null {
  if (!concepto) return null;

  const patterns = [
    // "Factura N° 2-3160" or "Factura Nro 2-3160"
    /[Ff]actura\s*N[°ºro.]*\s*(\d+[-]\d+)/i,
    // "Fact. 2-3160" or "Fact 2-3160"
    /[Ff]act\.?\s*(\d+[-]\d+)/i,
    // "ref. 2-3160"
    /ref\.?\s*(\d+[-]\d+)/i,
    // Just a number pattern at the end like "s/ 2-3160"
    /s\/\s*(\d+[-]\d+)/i,
    // Anulacion factura 2-3160
    /anulaci[oó]n\s+(?:factura\s+)?(\d+[-]\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = concepto.match(pattern);
    if (match && match[1]) {
      return normalizeFacturaNumber(match[1]);
    }
  }

  return null;
}

/**
 * Matches NC documents with their original facturas
 * When an NC fully cancels a factura (same CUIT, same amount), marks both as paid
 *
 * @param spreadsheetId - Spreadsheet ID (Control de Egresos or Control de Ingresos)
 * @param sheetName - Sheet to match against ('Facturas Recibidas' or 'Facturas Emitidas')
 * @param _cuitField - CUIT field label ('cuitEmisor' for Recibidas, 'cuitReceptor' for Emitidas) — documentation only, both sheets store counterparty CUIT at column F/index 5
 * @param readRange - Column range to read ('A:S' for Recibidas with pagada last, 'A:T' for Emitidas with tipoDeCambio after pagada)
 * @param pagadaColumnLetter - Spreadsheet column letter for pagada ('S' for both sheet types)
 * @returns Number of NC-Factura pairs matched
 */
export async function matchNCsWithFacturas(
  spreadsheetId: string,
  sheetName: 'Facturas Recibidas' | 'Facturas Emitidas' = 'Facturas Recibidas',
  _cuitField: 'cuitEmisor' | 'cuitReceptor' = 'cuitEmisor',
  readRange: string = 'A:S',
  pagadaColumnLetter: string = 'S'
): Promise<Result<number, Error>> {
  const correlationId = getCorrelationId();

  debug('Starting NC-Factura matching', {
    module: 'nc-matcher',
    phase: 'start',
    spreadsheetId,
    sheetName,
    correlationId,
  });

  // Read all rows from the sheet
  // Columns: A=fechaEmision, B=fileId, C=fileName, D=tipoComprobante, E=nroFactura,
  //          F=cuit (cuitEmisor for Recibidas, cuitReceptor for Emitidas), G=razonSocial,
  //          H=importeNeto, I=importeIva, J=importeTotal, K=moneda, L=concepto,
  //          M=processedAt, N=confidence, O=needsReview, P=matchedPagoFileId,
  //          Q=matchConfidence, R=hasCuitMatch, S=pagada (+ T=tipoDeCambio for Emitidas)
  const rowsResult = await getValues(spreadsheetId, `${sheetName}!${readRange}`);
  if (!rowsResult.ok) {
    return { ok: false, error: rowsResult.error };
  }

  if (rowsResult.value.length <= 1) {
    debug('No facturas to match', {
      module: 'nc-matcher',
      phase: 'start',
      correlationId,
    });
    return { ok: true, value: 0 };
  }

  // Parse rows into typed objects
  const facturas: FacturaRow[] = [];
  for (let i = 1; i < rowsResult.value.length; i++) {
    const row = rowsResult.value[i];
    if (!row || row.length < 10) continue;

    const factura: FacturaRow = {
      rowNumber: i + 1, // 1-indexed, accounting for header
      fechaEmision: normalizeSpreadsheetDate(row[0]),
      fileId: String(row[1] || ''),
      tipoComprobante: String(row[3] || '').toUpperCase(),
      nroFactura: String(row[4] || ''),
      cuit: String(row[5] || ''),
      importeTotal: parseNumber(String(row[9] || '0')) ?? 0,
      concepto: String(row[11] || ''),
      matchConfidence: row[16] ? String(row[16]).toUpperCase() : undefined,
      pagada: String(row[18] || '').toUpperCase(),
    };

    facturas.push(factura);
  }

  // Separate NCs and regular facturas
  // Match both plain 'NC'/'ND' and compound 'NC A'/'ND B' etc.
  const isNC = (tc: string) => tc === 'NC' || tc.startsWith('NC ');
  const isND = (tc: string) => tc === 'ND' || tc.startsWith('ND ');
  // Exclude MANUAL NCs — they have a user-defined match and must not be re-matched
  const ncs = facturas.filter(f => isNC(f.tipoComprobante) && f.matchConfidence !== 'MANUAL');
  const regularFacturas = facturas.filter(f =>
    !isNC(f.tipoComprobante) &&
    !isND(f.tipoComprobante) && // Exclude notas de debito
    f.pagada !== 'SI' && // Only unpaid facturas
    f.matchConfidence !== 'MANUAL' // Exclude MANUAL facturas — they are user-locked
  );

  debug('Found facturas for NC matching', {
    module: 'nc-matcher',
    phase: 'analyze',
    totalFacturas: facturas.length,
    ncs: ncs.length,
    unpaidFacturas: regularFacturas.length,
    correlationId,
  });

  if (ncs.length === 0 || regularFacturas.length === 0) {
    debug('No NCs or unpaid facturas to match', {
      module: 'nc-matcher',
      phase: 'complete',
      correlationId,
    });
    return { ok: true, value: 0 };
  }

  let matchCount = 0;

  // For each NC, try to find a matching factura
  for (const nc of ncs) {
    // Skip NCs already marked as paid (already matched)
    if (nc.pagada === 'SI') {
      continue;
    }

    // Try to extract referenced factura number from NC concepto
    const referencedNumber = extractReferencedFacturaNumber(nc.concepto);

    // Find matching factura: same CUIT + same amount (or referenced number if available)
    for (const factura of regularFacturas) {
      // Must be same supplier (CUIT)
      if (nc.cuit !== factura.cuit) {
        continue;
      }

      // Must have exact amount match (full cancellation)
      if (Math.abs(nc.importeTotal - factura.importeTotal) > 0.01) {
        continue;
      }

      // If we have a referenced number, it must match
      if (referencedNumber) {
        const normalizedFacturaNumber = normalizeFacturaNumber(factura.nroFactura);
        if (referencedNumber !== normalizedFacturaNumber) {
          continue;
        }
      }

      // NC date must be after or equal to factura date
      if (nc.fechaEmision < factura.fechaEmision) {
        continue;
      }

      // Found a match! Mark both as paid
      info('NC-Factura match found', {
        module: 'nc-matcher',
        phase: 'match',
        ncFileId: nc.fileId,
        ncNro: nc.nroFactura,
        facturaFileId: factura.fileId,
        facturaNro: factura.nroFactura,
        cuit: nc.cuit,
        importeTotal: nc.importeTotal,
        correlationId,
      });

      // Update factura pagada = 'SI'
      const updateFacturaResult = await setValues(
        spreadsheetId,
        `${sheetName}!${pagadaColumnLetter}${factura.rowNumber}`,
        [['SI']]
      );
      if (!updateFacturaResult.ok) {
        warn('Failed to update factura pagada', {
          module: 'nc-matcher',
          phase: 'match',
          facturaFileId: factura.fileId,
          error: updateFacturaResult.error.message,
          correlationId,
        });
        continue;
      }

      // Update NC pagada = 'SI'
      const updateNCResult = await setValues(
        spreadsheetId,
        `${sheetName}!${pagadaColumnLetter}${nc.rowNumber}`,
        [['SI']]
      );
      if (!updateNCResult.ok) {
        warn('Failed to update NC pagada', {
          module: 'nc-matcher',
          phase: 'match',
          ncFileId: nc.fileId,
          error: updateNCResult.error.message,
          correlationId,
        });
        continue;
      }

      matchCount++;

      // Mark factura as matched so it won't be matched again
      factura.pagada = 'SI';

      // Break inner loop - this NC is now matched
      break;
    }
  }

  info('NC-Factura matching complete', {
    module: 'nc-matcher',
    phase: 'complete',
    matchCount,
    correlationId,
  });

  return { ok: true, value: matchCount };
}
