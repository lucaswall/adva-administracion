/**
 * Facturador de Socios reader service
 * Reads the Facturador spreadsheet and returns a map of entries keyed by normalized comprobante
 */

import type { Result, FacturadorEntry } from '../types/index.js';
import { getValues } from './sheets.js';
import { parseNumber } from '../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../utils/date.js';
import { warn, debug } from '../utils/logger.js';

/**
 * Source sheet columns (0-indexed):
 * 0: Nro Socio
 * 1: Comprobante
 * 2: Empresa
 * 3: Representante
 * 4: Email
 * 5: Membresia
 * 6: Cobro Id
 * 7: Cond IVA
 * 8: Fecha
 * 9: Importe
 * 10: Enviado?
 * 11: Pagado?
 * 12: Status
 */
const COL = {
  NRO_SOCIO: 0,
  COMPROBANTE: 1,
  EMPRESA: 2,
  REPRESENTANTE: 3,
  EMAIL: 4,
  MEMBRESIA: 5,
  COBRO_ID: 6,
  COND_IVA: 7,
  FECHA: 8,
  IMPORTE: 9,
  PAGADO: 11,
} as const;

/**
 * Normalizes a comprobante number to 5-digit punto de venta + 8-digit numero.
 * Handles both "0005-00000057" (4-digit pto) and "00005-00000057" (already normalized).
 *
 * @param raw - Raw comprobante string from the sheet
 * @returns Normalized string like "00005-00000057"
 */
export function normalizeNroComprobante(raw: string): string {
  const trimmed = raw.trim();
  const dashIdx = trimmed.indexOf('-');
  if (dashIdx === -1) {
    // No dash — just return as-is, cannot normalize
    return trimmed;
  }
  const pto = trimmed.substring(0, dashIdx);
  const numero = trimmed.substring(dashIdx + 1);
  return `${pto.padStart(5, '0')}-${numero.padStart(8, '0')}`;
}

/**
 * Reads the Facturador de Socios spreadsheet for the given year.
 * Returns a Map<normalizedComprobante, FacturadorEntry>.
 *
 * If FACTURADOR_SPREADSHEET_ID env var is not set, returns an empty Map and logs a warn.
 * If the year tab does not exist, returns an empty Map and logs a warn.
 * Never throws — returns Result.ok with empty Map on all error conditions.
 *
 * @param currentYear - The year tab to read (e.g. 2026)
 * @returns Result wrapping a Map keyed by normalized comprobante
 */
export async function readFacturador(
  currentYear: number
): Promise<Result<Map<string, FacturadorEntry>, Error>> {
  const spreadsheetId = process.env.FACTURADOR_SPREADSHEET_ID;

  if (!spreadsheetId) {
    warn('FACTURADOR_SPREADSHEET_ID env var is not set — skipping Facturador read', {
      module: 'facturador-reader',
    });
    return { ok: true, value: new Map() };
  }

  const tabName = String(currentYear);
  const range = `'${tabName}'!A:M`;

  const valuesResult = await getValues(spreadsheetId, range);
  if (!valuesResult.ok) {
    warn(`Facturador tab "${tabName}" not found or unreadable — skipping Facturador read`, {
      module: 'facturador-reader',
      spreadsheetId,
      tab: tabName,
      error: valuesResult.error.message,
    });
    return { ok: true, value: new Map() };
  }

  const data = valuesResult.value;

  // Header-only or empty sheet
  if (data.length < 2) {
    debug('Facturador sheet has no data rows', {
      module: 'facturador-reader',
      tab: tabName,
    });
    return { ok: true, value: new Map() };
  }

  const entries = new Map<string, FacturadorEntry>();

  // Start from row 1 (skip header at row 0)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const rawComprobante = String(row[COL.COMPROBANTE] || '').trim();
    if (!rawComprobante) continue;

    const comprobante = normalizeNroComprobante(rawComprobante);
    const rawImporte = row[COL.IMPORTE];
    const importe = parseNumber(rawImporte) ?? 0;

    const entry: FacturadorEntry = {
      nroSocio: String(row[COL.NRO_SOCIO] || ''),
      comprobante,
      empresa: String(row[COL.EMPRESA] || ''),
      representante: String(row[COL.REPRESENTANTE] || ''),
      email: String(row[COL.EMAIL] || ''),
      membresia: String(row[COL.MEMBRESIA] || ''),
      cobroId: String(row[COL.COBRO_ID] || ''),
      condIVA: String(row[COL.COND_IVA] || ''),
      fecha: normalizeSpreadsheetDate(row[COL.FECHA]),
      importe,
      pagadoCol: String(row[COL.PAGADO] || ''),
    };

    entries.set(comprobante, entry);
  }

  debug('Read Facturador entries', {
    module: 'facturador-reader',
    tab: tabName,
    entries: entries.size,
  });

  return { ok: true, value: entries };
}
