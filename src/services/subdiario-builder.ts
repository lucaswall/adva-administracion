/**
 * Subdiario de Ventas — pure builder function.
 *
 * Transforms raw spreadsheet data (facturasEmitidas, movimientos, retenciones,
 * pagosRecibidos, facturador) into a sorted, gap-detected list of SubdiarioRow
 * objects, ready for the writer to push to the workbook.
 *
 * Pure function: no await, no I/O, no logger calls.
 *
 * ADV-247
 */

import type {
  Factura,
  Pago,
  Retencion,
  BankMovimiento,
  FacturadorEntry,
  SubdiarioRow,
  SubdiarioInput,
} from '../types/index.js';
import { extractReferencedFacturaNumber } from '../processing/matching/nc-factura-matcher.js';

// ────────────────────────────────────────────────────────────────────────────
// AFIP cod mapping (tipoComprobante → AFIP 3-digit code)
// ────────────────────────────────────────────────────────────────────────────

const AFIP_COD: Record<string, string> = {
  A: '001',
  B: '006',
  C: '011',
  E: '019',
  'NC A': '003',
  'NC B': '008',
  'NC C': '013',
  'NC E': '021',
  NC: '013', // Plain NC defaults to C
};

// ────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format a number as Argentine-style ARS string with dot thousands separator.
 * Integer amounts only — fractional cents not typical in factura totals.
 */
function formatARS(amount: number): string {
  const rounded = Math.round(amount);
  const str = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${str}`;
}

/**
 * Format ISO date (YYYY-MM-DD) as DD/MM/YYYY for Notas display.
 */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Format an exchange rate with up to 2 decimal places, stripping trailing zeros.
 */
function formatRate(rate: number): string {
  return parseFloat(rate.toFixed(2)).toString();
}

// ────────────────────────────────────────────────────────────────────────────
// Nro normalization (5-digit punto de venta + 8-digit numero)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a comprobante nro to '00003-00001956' canonical form.
 * Handles inputs like '3-1956', '0003-00001956', '00003-1956'.
 */
function normalizeNro(nroFactura: string): string {
  const cleaned = nroFactura.trim();
  const parts = cleaned.split('-');
  if (parts.length !== 2) return cleaned;
  const [punto, numero] = parts;
  const normalizedPunto = punto.replace(/^0+/, '').padStart(5, '0');
  const normalizedNumero = numero.replace(/^0+/, '').padStart(8, '0');
  return `${normalizedPunto}-${normalizedNumero}`;
}

/**
 * Extract the punto de venta (integer) from a normalized nro.
 */
function extractPuntoVenta(nro: string): number {
  const part = nro.split('-')[0] ?? '0';
  return parseInt(part.replace(/^0+/, '') || '0', 10);
}

/**
 * Extract the comprobante numero (integer) from a normalized nro.
 */
function extractNumero(nro: string): number {
  const part = nro.split('-')[1] ?? '0';
  return parseInt(part.replace(/^0+/, '') || '0', 10);
}

// ────────────────────────────────────────────────────────────────────────────
// Core derivation helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derive the AFIP 3-digit cod from tipoComprobante.
 */
function deriveCod(tipoComprobante: string): string {
  return AFIP_COD[tipoComprobante] ?? '';
}

/**
 * Derive 'FC' or 'NC' tipo from tipoComprobante.
 */
function deriveTipo(tipoComprobante: string): 'FC' | 'NC' {
  if (tipoComprobante === 'NC' || tipoComprobante.startsWith('NC ')) return 'NC';
  return 'FC';
}

/**
 * Convert importeTotal to ARS.
 * If moneda='USD' and tipoDeCambio is missing/zero, returns total=0 and revisar=true.
 */
function convertTotalToARS(factura: Factura): { total: number; revisar: boolean } {
  if (factura.moneda === 'ARS') {
    return { total: factura.importeTotal, revisar: false };
  }
  // USD
  const tc = factura.tipoDeCambio;
  if (!tc || tc === 0) {
    return { total: 0, revisar: true };
  }
  return { total: factura.importeTotal * tc, revisar: false };
}

// ────────────────────────────────────────────────────────────────────────────
// Movimientos aggregation
// ────────────────────────────────────────────────────────────────────────────

interface MovimientoAgg {
  /** Sum of all matched credito values (ARS) */
  totalCredito: number;
  /** Latest movement date (YYYY-MM-DD) */
  latestFecha: string;
  /** Individual items sorted by fecha ASC (for multi-cuota notas) */
  items: Array<{ credito: number; fecha: string }>;
}

/**
 * Aggregate bank movimientos matched to a given factura fileId.
 * Returns null when no matching movimientos exist.
 */
function aggregateMovimientos(
  fileId: string,
  movimientos: BankMovimiento[]
): MovimientoAgg | null {
  const matched = movimientos.filter(
    (m) =>
      m.matchedFileId === fileId &&
      m.matchedType !== '' &&
      m.credito !== null &&
      m.credito > 0
  );
  if (matched.length === 0) return null;

  const items = matched
    .map((m) => ({ credito: m.credito as number, fecha: m.fecha }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const totalCredito = items.reduce((sum, item) => sum + item.credito, 0);
  const latestFecha = items[items.length - 1].fecha;

  return { totalCredito, latestFecha, items };
}

// ────────────────────────────────────────────────────────────────────────────
// NC cancellation lookup
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the cancelling-NC map for all FCs in a single pass.
 * Each NC is consumed by AT MOST ONE FC, preventing double-attribution.
 *
 * Two-pass resolution (ADV-253):
 *   Pass 1: NCs with `refNro` in concepto bind to that specific FC (preferred).
 *   Pass 2: NCs without `refNro` (or refNro that matched nothing) bind to the
 *           first unbound FC matching CUIT + amount + date constraints.
 *
 * Matching criteria (all must hold for either pass):
 *   1. NC tipo
 *   2. Same cuitReceptor
 *   3. Same importeTotal (absolute value comparison, tolerance 0.01)
 *   4. NC fechaEmision >= FC fechaEmision
 *
 * @returns Map keyed by FC `fileId` → cancelling Factura (NC).
 */
function computeCancellingNCs(allFacturas: Factura[]): Map<string, Factura> {
  const result = new Map<string, Factura>();
  const consumedNcIds = new Set<string>();

  const fcs = allFacturas.filter((f) => deriveTipo(f.tipoComprobante) === 'FC');
  const ncs = allFacturas.filter((f) => deriveTipo(f.tipoComprobante) === 'NC');

  // Index FCs by normalized nro for refNro lookup
  const fcByNro = new Map<string, Factura>();
  for (const fc of fcs) {
    fcByNro.set(normalizeNro(fc.nroFactura), fc);
  }

  const matches = (nc: Factura, fc: Factura): boolean => {
    if (nc.cuitReceptor !== fc.cuitReceptor) return false;
    if (Math.abs(Math.abs(nc.importeTotal) - fc.importeTotal) > 0.01) return false;
    if (nc.fechaEmision < fc.fechaEmision) return false;
    return true;
  };

  // Pass 1: refNro-anchored NCs claim their referenced FC
  for (const nc of ncs) {
    const refNro = extractReferencedFacturaNumber(nc.concepto ?? '');
    if (refNro === null) continue;
    const fc = fcByNro.get(refNro);
    if (!fc) continue;
    if (!matches(nc, fc)) continue;
    if (result.has(fc.fileId)) continue;
    result.set(fc.fileId, nc);
    consumedNcIds.add(nc.fileId);
  }

  // Pass 2: remaining NCs fall back to CUIT+amount+date match, first unbound FC wins
  for (const nc of ncs) {
    if (consumedNcIds.has(nc.fileId)) continue;
    const refNro = extractReferencedFacturaNumber(nc.concepto ?? '');
    // refNro-bearing NCs that did NOT find their target in pass 1: do not fall back
    // (concepto explicitly names a different FC than any we know — skip).
    if (refNro !== null) continue;

    for (const fc of fcs) {
      if (result.has(fc.fileId)) continue;
      if (!matches(nc, fc)) continue;
      result.set(fc.fileId, nc);
      consumedNcIds.add(nc.fileId);
      break;
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Retencion matching
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find a retencion that matches the given factura.
 *
 * A retencion matches when:
 *   - cuitAgenteRetencion === factura.cuitReceptor (same client withheld)
 *   - montoComprobante ≈ factura.importeTotal (within 1% tolerance)
 *   OR
 *   - recibidoARS + montoRetencion ≈ factura.importeTotal in ARS (within 1)
 */
function findMatchingRetencion(
  factura: Factura,
  retenciones: Retencion[],
  recibidoARS: number | undefined,
  totalARS: number
): Retencion | null {
  for (const ret of retenciones) {
    if (ret.cuitAgenteRetencion !== factura.cuitReceptor) continue;

    // Primary: montoComprobante matches importeTotal (same currency — retenciones are ARS)
    const tolerance = Math.max(1, totalARS * 0.01);
    if (Math.abs(ret.montoComprobante - totalARS) <= tolerance) {
      return ret;
    }

    // Secondary: recibido + retencion ≈ total
    if (recibidoARS !== undefined) {
      if (Math.abs(recibidoARS + ret.montoRetencion - totalARS) <= 1) {
        return ret;
      }
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Scope filter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Determine whether a factura is in scope for the Subdiario.
 *
 * Scope rules:
 *   (a) FC emitted in currentYear → IN
 *   (b) FC from prior year, any matched movimiento.fecha in currentYear → IN
 *   (c) NC emitted in currentYear → IN (prior-year NCs → OUT)
 *   (d) FC from prior year, no payment, no cancelling NC → IN (still pending)
 *   (e) FC from prior year, all payments in prior year → OUT
 *   (f) FC from prior year, cancelled by prior-year NC → OUT
 */
function applyScopeFilter(
  factura: Factura,
  currentYear: number,
  cancellingNCs: Map<string, Factura>,
  movimientos: BankMovimiento[]
): boolean {
  const yearEmision = parseInt(factura.fechaEmision.substring(0, 4), 10);
  const isNC = deriveTipo(factura.tipoComprobante) === 'NC';

  // Rule c: only NCs in currentYear are in scope
  if (isNC) {
    return yearEmision === currentYear;
  }

  // Rule a: FC emitted in currentYear → always in scope
  if (yearEmision === currentYear) return true;

  // Prior-year FC: apply rules b, d, e, f
  const matchedMovs = movimientos.filter(
    (m) => m.matchedFileId === factura.fileId && m.matchedType !== ''
  );

  // Rule b: any payment in currentYear → in scope
  const hasPaymentThisYear = matchedMovs.some(
    (m) => parseInt(m.fecha.substring(0, 4), 10) === currentYear
  );
  if (hasPaymentThisYear) return true;

  // Check for a cancelling NC
  const cancellingNC = cancellingNCs.get(factura.fileId) ?? null;

  if (cancellingNC) {
    const ncYear = parseInt(cancellingNC.fechaEmision.substring(0, 4), 10);
    // Rule f: cancelled by prior-year NC → out of scope
    if (ncYear < currentYear) return false;
    // NC is in currentYear (or later) → FC comes along
    return true;
  }

  // Rule e: all payments in prior years → out of scope
  if (matchedMovs.length > 0) {
    const allPaidBeforeCurrentYear = matchedMovs.every(
      (m) => parseInt(m.fecha.substring(0, 4), 10) < currentYear
    );
    if (allPaidBeforeCurrentYear) return false;
  }

  // Rule d: no payment and no cancelling NC → still pending → in scope
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Notas composition
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compose the Notas string for a FC row.
 * Parts are assembled in order and joined with '; '.
 *
 * Parts:
 *   1. Socio — if in facturador: "Socio 1003 - An Otter Game Studio S.R.L."
 *   2. Export — if moneda='USD': "Pago del exterior - USD 10000 - TC fact 1430 [- TC pago 1428.5]"
 *   3. Retencion — if matched: "Retencion Ganancias $50.000"
 *   4. Multi-cuota — if 2+ movimientos: "Cobrado en N cuotas: $X (DD/MM/YYYY), ..."
 *   5. TC revisar — if USD without TC: "[REVISAR: TC faltante]"
 */
function composeNotas(opts: {
  factura: Factura;
  tipo: 'FC' | 'NC';
  facturadorEntry: FacturadorEntry | undefined;
  movimientoAgg: MovimientoAgg | null;
  pagosRecibidos: Pago[];
  retenciones: Retencion[];
  totalARS: number;
  revisar: boolean;
}): string {
  const { factura, tipo, facturadorEntry, movimientoAgg, pagosRecibidos, retenciones, totalARS, revisar } = opts;

  if (tipo === 'NC') return '';

  const parts: string[] = [];

  // 1. Socio part
  if (facturadorEntry) {
    const empresa = facturadorEntry.empresa || facturadorEntry.representante;
    parts.push(`Socio ${facturadorEntry.nroSocio} - ${empresa}`);
  }

  // 2. Export part (USD invoices)
  if (factura.moneda === 'USD') {
    const tcFact = factura.tipoDeCambio;
    if (tcFact && tcFact > 0) {
      let exportNote = `Pago del exterior - USD ${factura.importeTotal} - TC fact ${formatRate(tcFact)}`;

      if (movimientoAgg) {
        // Try to get TC pago from a matched pagos_recibidos document first
        const matchedPago = pagosRecibidos.find(
          (p) => p.matchedFacturaFileId === factura.fileId && p.tipoDeCambio
        );
        if (matchedPago?.tipoDeCambio) {
          exportNote += ` - TC pago ${formatRate(matchedPago.tipoDeCambio)}`;
        } else if (factura.importeTotal > 0) {
          // Compute from movimiento: credito (ARS) / importeTotal (USD)
          const bankRate = movimientoAgg.totalCredito / factura.importeTotal;
          exportNote += ` - TC pago ${formatRate(bankRate)}`;
        } else {
          exportNote += ` - TC pago ?`;
        }
      }

      parts.push(exportNote);
    } else {
      // Missing TC — include the flag in export note too
      parts.push(`Pago del exterior - USD ${factura.importeTotal} - TC fact ?`);
    }
  }

  // 3. Retencion part
  if (movimientoAgg) {
    const ret = findMatchingRetencion(factura, retenciones, movimientoAgg.totalCredito, totalARS);
    if (ret) {
      parts.push(`Retencion ${ret.impuesto} ${formatARS(ret.montoRetencion)}`);
    }
  } else {
    // Check even without movimientos (retencion matched by amount on invoice)
    const ret = findMatchingRetencion(factura, retenciones, undefined, totalARS);
    if (ret) {
      parts.push(`Retencion ${ret.impuesto} ${formatARS(ret.montoRetencion)}`);
    }
  }

  // 4. Multi-cuota part (only when ≥2 distinct movimientos)
  if (movimientoAgg && movimientoAgg.items.length >= 2) {
    const cuotasDesc = movimientoAgg.items
      .map((item) => `${formatARS(item.credito)} (${formatDate(item.fecha)})`)
      .join(', ');
    parts.push(`Cobrado en ${movimientoAgg.items.length} cuotas: ${cuotasDesc}`);
  }

  // 5. REVISAR flag for missing TC
  if (revisar) {
    parts.push('[REVISAR: TC faltante]');
  }

  return parts.join('; ');
}

// ────────────────────────────────────────────────────────────────────────────
// Gap detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detect gaps in each (puntoVenta, tipo) stream and insert placeholder rows.
 *
 * Placeholders have:
 *   - nro: the missing comprobante number
 *   - cliente: 'FALTA <nro>'
 *   - total: 0
 *   - fecha: the previous row's fecha (so they sort at the right position)
 *   - All other fields: empty/zero defaults
 *
 * The stream floor is the MINIMUM numero observed in that stream (not 1).
 */
function detectGaps(realRows: SubdiarioRow[]): SubdiarioRow[] {
  // Group real rows by (puntoVenta, tipo)
  const streams = new Map<string, SubdiarioRow[]>();

  for (const row of realRows) {
    const pv = extractPuntoVenta(row.nro);
    const key = `${pv}|${row.tipo}`;
    const existing = streams.get(key);
    if (existing) {
      existing.push(row);
    } else {
      streams.set(key, [row]);
    }
  }

  const gapRows: SubdiarioRow[] = [];

  for (const streamRows of streams.values()) {
    // Sort by numero ascending
    const sorted = [...streamRows].sort(
      (a, b) => extractNumero(a.nro) - extractNumero(b.nro)
    );

    const minNum = extractNumero(sorted[0].nro);
    const maxNum = extractNumero(sorted[sorted.length - 1].nro);
    const pvStr = sorted[0].nro.split('-')[0]; // already zero-padded to 5
    const tipo = sorted[0].tipo;
    const cod = sorted[0].cod;

    // Index rows by numero for O(1) lookup (ADV-258)
    const byNumero = new Map<number, SubdiarioRow>();
    for (const r of sorted) byNumero.set(extractNumero(r.nro), r);

    // Iterate from min to max, emitting gaps
    let prevFecha = sorted[0].fecha;
    for (let n = minNum; n <= maxNum; n++) {
      const found = byNumero.get(n);
      if (found) {
        // Update prevFecha to the actual row's fecha
        prevFecha = found.fecha;
      } else {
        const gapNro = `${pvStr}-${String(n).padStart(8, '0')}`;
        gapRows.push({
          fecha: prevFecha,
          cod,
          tipo,
          nro: gapNro,
          cliente: `FALTA ${gapNro}`,
          cuit: '',
          condicion: '',
          total: 0,
          concepto: '',
          categoria: '',
          fechaCobro: '',
          recibido: 0,
          notas: '',
        });
      }
    }
  }

  return gapRows;
}

// ────────────────────────────────────────────────────────────────────────────
// Sort
// ────────────────────────────────────────────────────────────────────────────

/**
 * Sort rows: fecha ASC, then nro ASC (lexicographic — zero-padding ensures order).
 */
function sortRows(rows: SubdiarioRow[]): SubdiarioRow[] {
  return [...rows].sort((a, b) => {
    const dateCmp = a.fecha.localeCompare(b.fecha);
    if (dateCmp !== 0) return dateCmp;
    return a.nro.localeCompare(b.nro);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build all SubdiarioRow entries for the given input.
 *
 * Pure function: no I/O, no side effects, no async.
 *
 * @param input - All data needed to build the subdiario for currentYear
 * @returns Sorted array of SubdiarioRow (including gap placeholders)
 */
export function buildSubdiarioRows(input: SubdiarioInput): SubdiarioRow[] {
  const {
    currentYear,
    facturasEmitidas,
    pagosRecibidos,
    retencionesRecibidas,
    movimientos,
    facturador,
  } = input;

  // Precompute cancelling-NC map (single pass, no double-attribution — ADV-253)
  const cancellingNCs = computeCancellingNCs(facturasEmitidas);

  // Step 1: Apply scope filter — keep only in-scope rows
  const inScope = facturasEmitidas.filter((f) =>
    applyScopeFilter(f, currentYear, cancellingNCs, movimientos)
  );

  // Step 2: Build one SubdiarioRow per in-scope factura
  const rows: SubdiarioRow[] = [];

  for (const factura of inScope) {
    const tipo = deriveTipo(factura.tipoComprobante);
    const cod = deriveCod(factura.tipoComprobante);
    const nro = normalizeNro(factura.nroFactura);
    const { total: totalARS, revisar } = convertTotalToARS(factura);

    // For NC rows, total is negative (represents credit given to client)
    const signedTotal = tipo === 'NC' ? -totalARS : totalARS;

    // Facturador lookup (FC only; NCs don't have categoria)
    const facturadorEntry = tipo === 'FC' ? facturador.get(nro) : undefined;

    // Condicion IVA: prefer PDF-extracted value, fall back to Facturador
    const condicion =
      (factura.condicionIVAReceptor ?? '') ||
      (facturadorEntry?.condIVA ?? '');

    // Categoria: socio membership for FCs, empty for NCs/placeholders
    const categoria =
      tipo === 'NC' ? '' : facturadorEntry ? facturadorEntry.membresia : '-';

    // Movimientos aggregation (for FC only)
    const movAgg = tipo === 'FC' ? aggregateMovimientos(factura.fileId, movimientos) : null;

    // fechaCobro and recibido
    let fechaCobro = '';
    let recibido = 0;

    if (tipo === 'FC') {
      const cancellingNC = cancellingNCs.get(factura.fileId) ?? null;
      if (cancellingNC) {
        // Cancelled by an NC — show NC nro, no cash received
        fechaCobro = `NC ${normalizeNro(cancellingNC.nroFactura)}`;
        recibido = 0;
      } else if (movAgg) {
        fechaCobro = movAgg.latestFecha;
        recibido = movAgg.totalCredito;
      }
    } else {
      // NC row: recibido mirrors total (negative)
      recibido = signedTotal;
    }

    // Notas
    const notas = composeNotas({
      factura,
      tipo,
      facturadorEntry,
      movimientoAgg: movAgg,
      pagosRecibidos,
      retenciones: retencionesRecibidas,
      totalARS,
      revisar,
    });

    rows.push({
      fecha: factura.fechaEmision,
      cod,
      tipo,
      nro,
      cliente: factura.razonSocialReceptor ?? '',
      cuit: factura.cuitReceptor ?? '',
      condicion,
      total: signedTotal,
      concepto: factura.concepto ?? '',
      categoria,
      fechaCobro,
      recibido,
      notas,
    });
  }

  // Step 3: Gap detection — insert placeholders for missing nros in each stream
  const gapRows = detectGaps(rows);
  const allRows = [...rows, ...gapRows];

  // Step 4: Sort
  return sortRows(allRows);
}
