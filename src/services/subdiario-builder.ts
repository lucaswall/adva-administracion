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

/**
 * Soft-paid marker: shown in `notas` when a matched pago_recibido covers an FC
 * but no Resumen Bancario row has confirmed the credit yet. The marker is
 * suppressed once a movimiento aggregate exists (hard paid silences soft).
 */
const SOFT_PAID_NOTE = 'Pendiente confirmación bancaria';

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
  /** Individual items sorted by fecha ASC (for multi-cuota notas + last-item hyperlink) */
  items: Array<{ credito: number; fecha: string; sourceUrl: string }>;
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
    .map((m) => ({
      credito: m.credito as number,
      fecha: m.fecha,
      sourceUrl: m.sourceUrl,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const totalCredito = items.reduce((sum, item) => sum + item.credito, 0);
  const latestFecha = items[items.length - 1].fecha;

  return { totalCredito, latestFecha, items };
}

interface PagoAgg {
  /** Sum of ARS-equivalent amounts across all matched pagos */
  totalARS: number;
  /** Latest `fechaPago` (YYYY-MM-DD) — used as the FC's fechaCobro under soft-paid */
  latestFecha: string;
  /** Number of matched pagos */
  count: number;
}

/**
 * Aggregate matched pago_recibido documents for a given factura (ADV-271).
 *
 * Contributes `importeEnPesos` for USD pagos (when present), else falls back
 * to `importePagado * factura.tipoDeCambio` for USD pagos with a known invoice
 * rate. ARS pagos contribute `importePagado` directly. Returns null when no
 * pago is matched.
 */
function aggregatePagosRecibidos(
  factura: Factura,
  pagos: Pago[]
): PagoAgg | null {
  const matched = pagos.filter((p) => p.matchedFacturaFileId === factura.fileId);
  if (matched.length === 0) return null;

  let totalARS = 0;
  let latestFecha = matched[0].fechaPago;
  for (const p of matched) {
    if (p.moneda === 'USD') {
      if (p.importeEnPesos && p.importeEnPesos > 0) {
        totalARS += p.importeEnPesos;
      } else if (factura.tipoDeCambio && factura.tipoDeCambio > 0) {
        totalARS += p.importePagado * factura.tipoDeCambio;
      }
      // else: contribute 0 (leave row visibly soft) — no crash on missing TC
    } else {
      totalARS += p.importePagado;
    }
    if (p.fechaPago.localeCompare(latestFecha) > 0) {
      latestFecha = p.fechaPago;
    }
  }

  return { totalARS, latestFecha, count: matched.length };
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

  // Index FCs by normalized nro. Same nro can appear in multiple AFIP class
  // streams (e.g. PV 00001 emits both A and B with nro 00001-00000001), so
  // store an array per key and disambiguate at lookup time via class match.
  const fcsByNro = new Map<string, Factura[]>();
  for (const fc of fcs) {
    const key = normalizeNro(fc.nroFactura);
    const existing = fcsByNro.get(key);
    if (existing) existing.push(fc);
    else fcsByNro.set(key, [fc]);
  }

  // Extract the AFIP class letter ('A' | 'B' | 'C' | 'E') from a tipoComprobante.
  // Returns null for bare 'NC' / 'ND' (class unknown — legacy data).
  const classLetter = (t: string): string | null => {
    if (t === 'A' || t === 'B' || t === 'C' || t === 'E') return t;
    if (t.startsWith('NC ') || t.startsWith('ND ')) {
      const suffix = t.slice(3);
      if (suffix === 'A' || suffix === 'B' || suffix === 'C' || suffix === 'E') return suffix;
    }
    return null;
  };

  const matches = (nc: Factura, fc: Factura): boolean => {
    if (nc.cuitReceptor !== fc.cuitReceptor) return false;
    if (Math.abs(Math.abs(nc.importeTotal) - fc.importeTotal) > 0.01) return false;
    if (nc.fechaEmision < fc.fechaEmision) return false;
    // AFIP class must match when both sides have a class letter. An NC B
    // cannot legally cancel an FC A. When either side is bare 'NC' (no
    // suffix in legacy data), allow the match.
    const ncClass = classLetter(nc.tipoComprobante);
    const fcClass = classLetter(fc.tipoComprobante);
    if (ncClass !== null && fcClass !== null && ncClass !== fcClass) return false;
    return true;
  };

  // Pass 1: refNro-anchored NCs claim their referenced FC (disambiguated by class)
  for (const nc of ncs) {
    const refNro = extractReferencedFacturaNumber(nc.concepto ?? '');
    if (refNro === null) continue;
    const candidates = fcsByNro.get(refNro);
    if (!candidates) continue;
    const fc = candidates.find((c) => matches(nc, c));
    if (!fc) continue;
    if (result.has(fc.fileId)) continue;
    result.set(fc.fileId, nc);
    consumedNcIds.add(nc.fileId);
  }

  // Pass 2: remaining NCs fall back to CUIT+amount+date+class match, first unbound FC wins
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
function findMatchingRetenciones(
  factura: Factura,
  retenciones: Retencion[],
  recibidoARS: number | undefined,
  totalARS: number
): Retencion[] {
  // Pass 1: authoritative matches. retencion-factura-matcher writes
  // matchedFacturaFileId on every retencion it links, and explicitly allows
  // multiple certificates per factura (different tax types — Ganancias + IIBB
  // on the same invoice). Collect them all.
  const claimed = retenciones.filter((r) => r.matchedFacturaFileId === factura.fileId);
  if (claimed.length > 0) return claimed;

  // Pass 2: amount predicate against unclaimed retenciones only. A retencion
  // already linked to a DIFFERENT factura must not be reused here, even when
  // CUIT + total coincide — that would attach the same Retencion note to two
  // invoices for the same client with the same total.
  const tolerance = Math.max(1, totalARS * 0.01);
  for (const ret of retenciones) {
    if (ret.matchedFacturaFileId && ret.matchedFacturaFileId !== factura.fileId) continue;
    if (ret.cuitAgenteRetencion !== factura.cuitReceptor) continue;

    // Primary: montoComprobante matches importeTotal (same currency — retenciones are ARS)
    if (Math.abs(ret.montoComprobante - totalARS) <= tolerance) {
      return [ret];
    }

    // Secondary: recibido + retencion ≈ total
    if (recibidoARS !== undefined) {
      if (Math.abs(recibidoARS + ret.montoRetencion - totalARS) <= 1) {
        return [ret];
      }
    }
  }
  return [];
}

// ────────────────────────────────────────────────────────────────────────────
// Scope filter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Determine whether a factura is in scope for the Subdiario.
 *
 * Scope rules (ADV-270):
 *   (a) FC emitted in currentYear → IN
 *   (b) FC from prior year, any matched movimiento.fecha in currentYear → IN
 *   (c) NC emitted in currentYear → IN (prior-year NCs → OUT)
 *   (d) FC from prior year, pagada != 'SI' → IN (still pending in Cobros)
 *   (e) FC from prior year, pagada='SI', no currentYear event → OUT (soft-drop)
 *   (f) FC from prior year, cancelled by prior-year NC → OUT
 *
 * A "currentYear event" pulls a prior-year `pagada='SI'` FC back into scope so
 * the 2026-side event has a visible partner row:
 *   - matched movimiento with fecha in currentYear,
 *   - cancelling NC with fechaEmision in currentYear (rule c/f already cover),
 *   - matched pago_recibido with fechaPago in currentYear.
 */
function applyScopeFilter(
  factura: Factura,
  currentYear: number,
  cancellingNCs: Map<string, Factura>,
  movimientos: BankMovimiento[],
  pagosRecibidos: Pago[]
): boolean {
  const yearEmision = parseInt(factura.fechaEmision.substring(0, 4), 10);
  const isNC = deriveTipo(factura.tipoComprobante) === 'NC';

  // Rule c: only NCs in currentYear are in scope
  if (isNC) {
    return yearEmision === currentYear;
  }

  // Rule a: FC emitted in currentYear → always in scope
  if (yearEmision === currentYear) return true;

  // Prior-year FC: evaluate currentYear events for rules (b), (e), (f).
  const matchedMovs = movimientos.filter(
    (m) => m.matchedFileId === factura.fileId && m.matchedType !== ''
  );

  // Rule b: any matched movimiento in currentYear → in scope
  const hasPaymentThisYear = matchedMovs.some(
    (m) => parseInt(m.fecha.substring(0, 4), 10) === currentYear
  );
  if (hasPaymentThisYear) return true;

  // Cancelling NC handling (rules c/f)
  const cancellingNC = cancellingNCs.get(factura.fileId) ?? null;
  if (cancellingNC) {
    const ncYear = parseInt(cancellingNC.fechaEmision.substring(0, 4), 10);
    // Rule f: cancelled by prior-year NC → out of scope
    if (ncYear < currentYear) return false;
    // NC issued in currentYear (or later) → FC comes along
    return true;
  }

  // Soft-paid currentYear event: matched pago_recibido with fechaPago in currentYear
  const hasPagoRecibidoThisYear = pagosRecibidos.some(
    (p) =>
      p.matchedFacturaFileId === factura.fileId &&
      parseInt(p.fechaPago.substring(0, 4), 10) === currentYear
  );
  if (hasPagoRecibidoThisYear) return true;

  // Rule e (soft-drop, ADV-270): prior-year FC with pagada='SI' and no
  // currentYear event → OUT. Trim+uppercase to mirror pagos-pendientes.ts.
  const pagadaNorm = (factura.pagada ?? '').trim().toUpperCase();
  if (pagadaNorm === 'SI') return false;

  // Rule d: prior-year FC without pagada='SI' → still pending → in scope
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
  softPaid: boolean;
  pagosRecibidos: Pago[];
  retenciones: Retencion[];
  totalARS: number;
  revisar: boolean;
}): string {
  const { factura, tipo, facturadorEntry, movimientoAgg, softPaid, pagosRecibidos, retenciones, totalARS, revisar } = opts;

  if (tipo === 'NC') return '';

  const parts: string[] = [];

  // 0. Soft-paid marker (ADV-271): prepend when a pago_recibido matched the FC
  // but no movimiento confirmed it. Hard paid silences soft (movimientoAgg wins).
  if (softPaid && !movimientoAgg) {
    parts.push(SOFT_PAID_NOTE);
  }

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

  // 3. Retencion part — a factura can have multiple certificates (Ganancias +
  // IIBB on the same invoice). Append one note per matched retencion.
  const recibidoForMatch = movimientoAgg ? movimientoAgg.totalCredito : undefined;
  const matchedRets = findMatchingRetenciones(factura, retenciones, recibidoForMatch, totalARS);
  for (const ret of matchedRets) {
    parts.push(`Retencion ${ret.impuesto} ${formatARS(ret.montoRetencion)}`);
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
function detectGaps(
  realRows: SubdiarioRow[],
  allFacturas: Factura[]
): SubdiarioRow[] {
  // Group real rows by (puntoVenta, cod) — AFIP numbering is independent per
  // cod, so a single PV emitting multiple cods (e.g. FC A + FC B) must yield
  // separate streams.
  const streams = new Map<string, SubdiarioRow[]>();

  for (const row of realRows) {
    const pv = extractPuntoVenta(row.nro);
    const key = `${pv}|${row.cod}`;
    const existing = streams.get(key);
    if (existing) {
      existing.push(row);
    } else {
      streams.set(key, [row]);
    }
  }

  // Build a set of known numeros per stream from the FULL source history.
  // Out-of-scope rows are not gaps — they exist, just outside the Subdiario.
  // Without this, a kept prior-year unpaid FC + a kept current-year FC will
  // emit false FALTA placeholders for every paid prior-year FC in between.
  const knownNumeros = new Map<string, Set<number>>();
  for (const f of allFacturas) {
    const nro = normalizeNro(f.nroFactura);
    const pv = extractPuntoVenta(nro);
    const cod = deriveCod(f.tipoComprobante);
    const key = `${pv}|${cod}`;
    const num = extractNumero(nro);
    if (!Number.isFinite(num)) continue;
    let set = knownNumeros.get(key);
    if (!set) {
      set = new Set();
      knownNumeros.set(key, set);
    }
    set.add(num);
  }

  const gapRows: SubdiarioRow[] = [];

  for (const [streamKey, streamRows] of streams) {
    // Sort by numero ascending
    const sorted = [...streamRows].sort(
      (a, b) => extractNumero(a.nro) - extractNumero(b.nro)
    );

    const minNum = extractNumero(sorted[0].nro);
    const maxNum = extractNumero(sorted[sorted.length - 1].nro);
    const pvStr = sorted[0].nro.split('-')[0]; // already zero-padded to 5
    const tipo = sorted[0].tipo;
    const cod = sorted[0].cod;
    const knownInStream = knownNumeros.get(streamKey) ?? new Set<number>();

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
      } else if (knownInStream.has(n)) {
        // Source has this numero, but it is filtered out of scope (e.g. paid
        // in a prior year). Not a gap — skip without emitting a placeholder.
        continue;
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
          recibido: null,
          movimiento: '',
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
    applyScopeFilter(f, currentYear, cancellingNCs, movimientos, pagosRecibidos)
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

    // Categoria: socio membership for FCs; blank for NCs and FCs not in Facturador
    const categoria =
      tipo === 'NC' ? '' : facturadorEntry ? facturadorEntry.membresia : '';

    // Movimientos aggregation (for FC only)
    const movAgg = tipo === 'FC' ? aggregateMovimientos(factura.fileId, movimientos) : null;
    // Pago_recibido aggregation (FC only — soft-paid tier, ADV-271)
    const pagoAgg = tipo === 'FC' ? aggregatePagosRecibidos(factura, pagosRecibidos) : null;

    // fechaCobro and recibido — recibido is `null` (blank cell) when nothing
    // was received: unpaid FC, FC cancelled by NC, or placeholder.
    let fechaCobro = '';
    let recibido: number | null = null;
    let softPaid = false;

    if (tipo === 'FC') {
      const cancellingNC = cancellingNCs.get(factura.fileId) ?? null;
      if (cancellingNC) {
        // Cancelled by an NC — show NC nro, no cash received → leave recibido null
        fechaCobro = `NC ${normalizeNro(cancellingNC.nroFactura)}`;
      } else if (movAgg) {
        // Hard paid: bank movimiento confirms credit
        fechaCobro = movAgg.latestFecha;
        recibido = movAgg.totalCredito;
      } else if (pagoAgg) {
        // Soft paid: pago_recibido matched but no Resumen Bancario row yet.
        // ADV-274: leave `recibido` blank when the pago couldn't be converted
        // to ARS (USD pago with no importeEnPesos and no factura.tipoDeCambio).
        // Rendering `0.00` would falsely read as "paid 0 ARS" — blank is honest.
        fechaCobro = pagoAgg.latestFecha;
        recibido = pagoAgg.totalARS > 0 ? pagoAgg.totalARS : null;
        softPaid = true;
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
      softPaid,
      pagosRecibidos,
      retenciones: retencionesRecibidas,
      totalARS,
      revisar,
    });

    // Movimiento HYPERLINK target (ADV-272): only hard-paid FCs get a URL — soft-paid,
    // unpaid, NC-cancelled, and NC rows leave the column blank (Resumen Bancario is
    // the only authoritative target for this column).
    const movimientoUrl =
      tipo === 'FC' && movAgg ? movAgg.items[movAgg.items.length - 1]!.sourceUrl : '';

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
      movimiento: movimientoUrl,
      notas,
    });
  }

  // Step 3: Gap detection — insert placeholders for missing nros in each
  // stream. Use the FULL facturasEmitidas (not just scoped rows) as the
  // known-numero set, so out-of-scope source rows are not flagged as gaps.
  const gapRows = detectGaps(rows, facturasEmitidas);
  const allRows = [...rows, ...gapRows];

  // Step 4: Sort
  return sortRows(allRows);
}
