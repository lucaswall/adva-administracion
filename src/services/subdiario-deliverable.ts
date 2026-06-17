/**
 * Subdiario de Ventas Deliverable — pure render model.
 *
 * Transforms a sorted list of SubdiarioRow objects into a sequence of
 * DeliverableRenderRow items ready for the writer to push to the deliverable
 * Google Sheet.
 *
 * Pure function: no await, no I/O, no logger calls.
 *
 * ADV-381
 */

import type { SubdiarioRow } from '../types/index.js';
import { SPANISH_MONTHS } from '../utils/spanish-date.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

/**
 * A single row in the deliverable render model.
 *
 * - 'blank'    → empty row separator after a period block
 * - 'header'   → period section label row (e.g. 'PERIODO MAYO 2026')
 * - 'data'     → projected SubdiarioRow with derived style flags
 * - 'subtotal' → signed sum of `total` for the preceding period block (NC negative)
 */
export interface DeliverableRenderRow {
  type: 'blank' | 'header' | 'data' | 'subtotal';
  /** For 'header': period label, e.g. 'PERIODO 2025' or 'PERIODO MAYO 2026' */
  label?: string;
  /** For 'data': the source SubdiarioRow */
  row?: SubdiarioRow;
  /** For 'data': true when row.tipo === 'NC' */
  isNC?: boolean;
  /** For 'data': true when row.cliente starts with 'FALTA ' */
  isFalta?: boolean;
  /** For 'data': true when row is FC and row.fechaCobro starts with 'NC ' */
  isCancelledByNC?: boolean;
  /** For 'subtotal': signed sum of period total (NC negative) */
  subtotal?: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Extract the year (YYYY as number) from an ISO date string (YYYY-MM-DD).
 */
function rowYear(fecha: string): number {
  return parseInt(fecha.substring(0, 4), 10);
}

/**
 * Extract the month (1-based integer) from an ISO date string (YYYY-MM-DD).
 */
function rowMonth(fecha: string): number {
  return parseInt(fecha.substring(5, 7), 10);
}

/**
 * Build the header label for a prior-year block: 'PERIODO {YEAR}'.
 */
function priorYearLabel(year: number): string {
  return `PERIODO ${year}`;
}

/**
 * Build the header label for a current-year monthly block:
 * 'PERIODO {UPPERCASE_SPANISH_MONTH} {YEAR}'.
 */
function currentYearMonthLabel(month: number, year: number): string {
  // SPANISH_MONTHS is 0-indexed
  const monthName = SPANISH_MONTHS[month - 1];
  return `PERIODO ${monthName.toUpperCase()} ${year}`;
}

/**
 * Derive the three style flags from a SubdiarioRow.
 */
function deriveFlags(row: SubdiarioRow): {
  isNC: boolean;
  isFalta: boolean;
  isCancelledByNC: boolean;
} {
  return {
    isNC: row.tipo === 'NC',
    isFalta: row.cliente.startsWith('FALTA '),
    isCancelledByNC: row.tipo === 'FC' && row.fechaCobro.startsWith('NC '),
  };
}

/**
 * Build the render rows for a single period block.
 * Emits: header → data rows → subtotal → blank.
 */
function buildBlock(label: string, rows: SubdiarioRow[]): DeliverableRenderRow[] {
  const output: DeliverableRenderRow[] = [];

  // Header
  output.push({ type: 'header', label });

  // Data rows (with flags)
  let blockTotal = 0;
  for (const row of rows) {
    const flags = deriveFlags(row);
    output.push({
      type: 'data',
      row,
      ...flags,
    });
    blockTotal += row.total;
  }

  // Subtotal
  output.push({ type: 'subtotal', subtotal: blockTotal });

  // Blank separator
  output.push({ type: 'blank' });

  return output;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the deliverable render model for the Subdiario de Ventas sheet.
 *
 * Input rows MUST already be sorted by fecha ASC then nro ASC (the builder
 * contract). This function preserves that order within each period block.
 *
 * Grouping rules:
 *   - Rows whose year < currentYear → one block per prior year (ascending)
 *   - Rows whose year === currentYear → one block per month (Jan→Dec)
 *   - All prior-year blocks precede all current-year blocks
 *   - Each block: header → data rows → subtotal → blank separator
 *
 * @param rows        - Sorted SubdiarioRow array from buildSubdiarioRows()
 * @param currentYear - The fiscal year being presented (e.g. 2026)
 * @returns           - Flat array of DeliverableRenderRow ready for the writer
 */
export function buildSubdiarioDeliverable(
  rows: SubdiarioRow[],
  currentYear: number
): DeliverableRenderRow[] {
  if (rows.length === 0) return [];

  // ── Step 1: Partition into prior-year groups and current-year month groups ──

  // Prior-year groups keyed by year (number)
  const priorYearGroups = new Map<number, SubdiarioRow[]>();
  // Current-year groups keyed by month (1-12)
  const currentYearMonthGroups = new Map<number, SubdiarioRow[]>();

  for (const row of rows) {
    const year = rowYear(row.fecha);
    if (year < currentYear) {
      // Prior year
      const existing = priorYearGroups.get(year);
      if (existing) {
        existing.push(row);
      } else {
        priorYearGroups.set(year, [row]);
      }
    } else {
      // Current year — group by month
      const month = rowMonth(row.fecha);
      const existing = currentYearMonthGroups.get(month);
      if (existing) {
        existing.push(row);
      } else {
        currentYearMonthGroups.set(month, [row]);
      }
    }
  }

  // ── Step 2: Emit blocks in chronological order ──────────────────────────────

  const output: DeliverableRenderRow[] = [];

  // Prior-year blocks: sorted ascending by year
  const sortedPriorYears = [...priorYearGroups.keys()].sort((a, b) => a - b);
  for (const year of sortedPriorYears) {
    const groupRows = priorYearGroups.get(year)!;
    output.push(...buildBlock(priorYearLabel(year), groupRows));
  }

  // Current-year monthly blocks: sorted ascending by month (1→12)
  const sortedMonths = [...currentYearMonthGroups.keys()].sort((a, b) => a - b);
  for (const month of sortedMonths) {
    const groupRows = currentYearMonthGroups.get(month)!;
    output.push(...buildBlock(currentYearMonthLabel(month, currentYear), groupRows));
  }

  return output;
}
