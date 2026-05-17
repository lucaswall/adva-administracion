/**
 * Pure diff function for the Subdiario de Ventas incremental sync.
 *
 * No I/O, no Result<T,E> — sort-invariant violations and duplicate keys are
 * signaled via fields on the returned SubdiarioDiff, not as errors.
 */

import type { SubdiarioRow, SubdiarioRowWithIndex, SubdiarioDiff } from '../types/index.js';

/**
 * Epsilon for floating-point equality checks on monetary fields.
 * ARS amounts are 2-decimal; this threshold protects against floating-point
 * round-trip noise on the first sync after deploy.
 */
const MONEY_EPSILON = 0.005;

/**
 * Compares two nullable numeric fields using epsilon equality.
 * - null === null → no difference
 * - null vs number → difference
 * - number vs number → |a - b| < MONEY_EPSILON → no difference
 */
function numericNullableDiffers(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return Math.abs(a - b) >= MONEY_EPSILON;
}

/**
 * Returns true when two SubdiarioRows differ by at least one field.
 *
 * Equality semantics:
 * - `total`: epsilon 0.005 (ARS floating-point round-trip protection)
 * - `recibido`: null===null → no diff; null vs number → diff; number vs number: same epsilon
 * - `movimientoLabel` (ADV-281): strict equality after `.trim()`. The label is
 *   the displayed text of the col M textFormatRuns link and round-trips through
 *   `getValues`, so exact equality is safe (no perpetual-update risk).
 * - `movimiento` URL: EXCLUDED from the diff. The read side cannot recover the
 *   URL (only the displayed text); comparing strictly would loop forever. The
 *   builder rewrites it whenever `movimientoLabel` changes, which is sufficient.
 * - `facturaFileId` (ADV-280): EXCLUDED for the same reason — unknowable from a
 *   cell read.
 * - All other string fields: strict equality after `.trim()`.
 */
function rowsDiffer(a: SubdiarioRow, b: SubdiarioRow): boolean {
  // Numeric fields with epsilon
  if (Math.abs(a.total - b.total) >= MONEY_EPSILON) return true;
  if (numericNullableDiffers(a.recibido, b.recibido)) return true;

  // String fields — trim before comparing. `movimiento` URL and `facturaFileId`
  // are intentionally absent (see header).
  const stringFields: (keyof SubdiarioRow)[] = [
    'fecha', 'cod', 'tipo', 'nro', 'cliente', 'cuit',
    'condicion', 'concepto', 'categoria', 'fechaCobro', 'movimientoLabel', 'notas',
  ];
  for (const field of stringFields) {
    const av = String(a[field] ?? '').trim();
    const bv = String(b[field] ?? '').trim();
    if (av !== bv) return true;
  }

  return false;
}

/**
 * Builds the composite key for a SubdiarioRow.
 * PK is deterministic from the AFIP comprobante: (cod, nro).
 */
function rowKey(row: Pick<SubdiarioRow, 'cod' | 'nro'>): string {
  return `${row.cod}|${row.nro}`;
}

/**
 * Diffs existing sheet rows against a desired row set, producing a set of
 * atomic operations needed to make the sheet match `desired`.
 *
 * The diff is keyed on `(cod, nro)` — the AFIP comprobante primary key.
 *
 * @param existing - Current sheet rows with their 0-indexed sheet positions
 * @param desired  - Target rows produced by buildSubdiarioRows()
 * @returns Structured diff: updates, inserts, deletes, and invariant flags
 */
export function diffSubdiarioRows(
  existing: SubdiarioRowWithIndex[],
  desired: SubdiarioRow[]
): SubdiarioDiff {
  // ── 1. Check sort invariant (fecha ASC, nro ASC) pairwise ────────────────
  let sortInvariantViolated = false;
  for (let i = 0; i < existing.length - 1; i++) {
    const a = existing[i]!;
    const b = existing[i + 1]!;
    if (a.fecha > b.fecha || (a.fecha === b.fecha && a.nro > b.nro)) {
      sortInvariantViolated = true;
      break;
    }
  }

  // ── 2. Build existing map; first occurrence wins, duplicates go to deletes ─
  const existingMap = new Map<string, SubdiarioRowWithIndex>();
  const duplicateRowIndices: number[] = [];
  let duplicateKeysDetected = false;

  for (const row of existing) {
    const key = rowKey(row);
    if (existingMap.has(key)) {
      duplicateKeysDetected = true;
      duplicateRowIndices.push(row.rowIndex);
    } else {
      existingMap.set(key, row);
    }
  }

  // ── 3. Walk desired to classify inserts vs updates ───────────────────────
  const desiredKeys = new Set<string>();
  const updates: SubdiarioDiff['updates'] = [];
  const inserts: SubdiarioDiff['inserts'] = [];

  // Track relative-order changes of common keys. The writer's in-place
  // update at `desiredIndex` is only safe when surviving existing rows
  // appear in desired in the same relative order as in existing. A row whose
  // sort-key (fecha) changes can swap positions with another existing row,
  // which would silently overwrite one row and leave the other stale.
  let lastExistingRowIndex = -1;
  let commonKeyReordered = false;

  for (let i = 0; i < desired.length; i++) {
    const row = desired[i]!;
    const key = rowKey(row);
    desiredKeys.add(key);

    const existingRow = existingMap.get(key);
    if (existingRow !== undefined) {
      if (existingRow.rowIndex < lastExistingRowIndex) {
        commonKeyReordered = true;
      }
      lastExistingRowIndex = existingRow.rowIndex;
      if (rowsDiffer(existingRow, row)) {
        updates.push({ rowIndex: existingRow.rowIndex, desiredIndex: i, row });
      }
    } else {
      inserts.push({ insertAt: i, row });
    }
  }

  if (commonKeyReordered) sortInvariantViolated = true;

  // ── 4. Walk existing to find rows no longer in desired ───────────────────
  const deleteIndices: number[] = [];
  for (const [key, row] of existingMap) {
    if (!desiredKeys.has(key)) {
      deleteIndices.push(row.rowIndex);
    }
  }

  // Merge duplicate indices into deletes and sort DESCENDING
  const deletes = [...deleteIndices, ...duplicateRowIndices].sort((a, b) => b - a);

  return { updates, inserts, deletes, sortInvariantViolated, duplicateKeysDetected };
}
