/**
 * Tests for diffSubdiarioRows pure function
 */

import { describe, it, expect } from 'vitest';
import { diffSubdiarioRows } from './subdiario-diff.js';
import type { SubdiarioRow, SubdiarioRowWithIndex } from '../types/index.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeRow(overrides: Partial<SubdiarioRow> = {}): SubdiarioRow {
  return {
    fecha: '2025-01-15',
    cod: '006',
    tipo: 'FC',
    nro: '00001-00000001',
    cliente: 'TEST SA',
    cuit: '20123456786',
    condicion: 'IVA Responsable Inscripto',
    total: 1000,
    concepto: 'Servicios',
    categoria: 'Micro',
    fechaCobro: '',
    recibido: null,
    notas: '',
    ...overrides,
  };
}

function withIndex(row: SubdiarioRow, rowIndex: number): SubdiarioRowWithIndex {
  return { ...row, rowIndex };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('diffSubdiarioRows', () => {
  it('empty existing + N desired → all inserts, no updates/deletes, sortInvariantViolated=false', () => {
    const desired = [
      makeRow({ nro: '00001-00000001', fecha: '2025-01-15' }),
      makeRow({ nro: '00001-00000002', fecha: '2025-01-20' }),
    ];

    const result = diffSubdiarioRows([], desired);

    expect(result.sortInvariantViolated).toBe(false);
    expect(result.duplicateKeysDetected).toBe(false);
    expect(result.updates).toHaveLength(0);
    expect(result.deletes).toHaveLength(0);
    expect(result.inserts).toHaveLength(2);
    expect(result.inserts[0]).toMatchObject({ insertAt: 0, row: desired[0] });
    expect(result.inserts[1]).toMatchObject({ insertAt: 1, row: desired[1] });
  });

  it('identical existing + desired → empty diff (no updates, inserts, deletes)', () => {
    const row1 = makeRow({ nro: '00001-00000001', fecha: '2025-01-15' });
    const row2 = makeRow({ nro: '00001-00000002', fecha: '2025-01-20', recibido: 1000 });
    const existing = [withIndex(row1, 0), withIndex(row2, 1)];
    const desired = [{ ...row1 }, { ...row2 }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(0);
    expect(result.inserts).toHaveLength(0);
    expect(result.deletes).toHaveLength(0);
    expect(result.sortInvariantViolated).toBe(false);
    expect(result.duplicateKeysDetected).toBe(false);
  });

  it('one row value change (recibido null→50000) → one update at the correct rowIndex; no inserts/deletes', () => {
    const base = makeRow({ nro: '00001-00000001', fecha: '2025-01-15', recibido: null });
    const existing = [withIndex(base, 0)];
    const desired = [{ ...base, recibido: 50000 }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.rowIndex).toBe(0);
    expect(result.updates[0]!.desiredIndex).toBe(0); // position 0 in the desired array
    expect(result.updates[0]!.row.recibido).toBe(50000);
    expect(result.inserts).toHaveLength(0);
    expect(result.deletes).toHaveLength(0);
  });

  it('one row deleted from desired → one delete with the correct rowIndex; deletes returned descending', () => {
    const row1 = makeRow({ nro: '00001-00000001', fecha: '2025-01-10' });
    const row2 = makeRow({ nro: '00001-00000002', fecha: '2025-01-20' });
    const row3 = makeRow({ nro: '00001-00000003', fecha: '2025-01-30' });
    const existing = [withIndex(row1, 0), withIndex(row2, 1), withIndex(row3, 2)];
    // Remove row2 from desired
    const desired = [{ ...row1 }, { ...row3 }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(0);
    expect(result.inserts).toHaveLength(0);
    expect(result.deletes).toHaveLength(1);
    expect(result.deletes[0]).toBe(1); // rowIndex of row2

    // Test with multiple deletes (verify descending sort)
    const existing2 = [withIndex(row1, 0), withIndex(row2, 1), withIndex(row3, 2)];
    const desired2: SubdiarioRow[] = [{ ...row2 }]; // only keep row2
    const result2 = diffSubdiarioRows(existing2, desired2);
    expect(result2.deletes).toEqual([2, 0]); // descending
  });

  it('two new rows inserted at correct chronological positions → two inserts with insertAt reflecting position in desired', () => {
    const existing = [
      withIndex(makeRow({ nro: '00001-00000001', fecha: '2025-01-10' }), 0),
    ];
    const desired = [
      makeRow({ nro: '00001-00000001', fecha: '2025-01-10' }),
      makeRow({ nro: '00001-00000002', fecha: '2025-01-15' }), // new at position 1
      makeRow({ nro: '00001-00000003', fecha: '2025-01-20' }), // new at position 2
    ];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(0);
    expect(result.deletes).toHaveLength(0);
    expect(result.inserts).toHaveLength(2);
    expect(result.inserts[0]).toMatchObject({ insertAt: 1 });
    expect(result.inserts[1]).toMatchObject({ insertAt: 2 });
  });

  it('mixed: some updates + some inserts + some deletes', () => {
    const row1 = makeRow({ nro: '00001-00000001', fecha: '2025-01-10', total: 1000 });
    const row2 = makeRow({ nro: '00001-00000002', fecha: '2025-01-15' });
    const row3 = makeRow({ nro: '00001-00000003', fecha: '2025-01-20' }); // will be deleted
    const existing = [withIndex(row1, 0), withIndex(row2, 1), withIndex(row3, 2)];

    const desired = [
      { ...row1, total: 2000 }, // update (total changed)
      { ...row2 },              // unchanged
      makeRow({ nro: '00001-00000004', fecha: '2025-01-25' }), // new insert at position 2
    ];
    // row3 no longer in desired → delete

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.rowIndex).toBe(0);
    expect(result.updates[0]!.desiredIndex).toBe(0); // row1 is at position 0 in desired
    expect(result.updates[0]!.row.total).toBe(2000);
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]!.insertAt).toBe(2);
    expect(result.deletes).toEqual([2]); // row3's rowIndex
  });

  it('existing sheet has rows in wrong chronological order → sortInvariantViolated=true', () => {
    const row1 = makeRow({ nro: '00001-00000001', fecha: '2025-01-20' }); // later date first!
    const row2 = makeRow({ nro: '00001-00000002', fecha: '2025-01-10' }); // earlier date second
    const existing = [withIndex(row1, 0), withIndex(row2, 1)];
    const desired = [{ ...row1 }, { ...row2 }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.sortInvariantViolated).toBe(true);
  });

  it('existing sheet has duplicate (cod, nro) → duplicateKeysDetected=true; first wins, second emitted as delete', () => {
    const row1 = makeRow({ nro: '00001-00000001', fecha: '2025-01-10' });
    const row1dup = makeRow({ nro: '00001-00000001', fecha: '2025-01-10', total: 9999 }); // duplicate key
    const existing = [withIndex(row1, 0), withIndex(row1dup, 1)];
    const desired = [{ ...row1 }]; // one copy in desired

    const result = diffSubdiarioRows(existing, desired);

    expect(result.duplicateKeysDetected).toBe(true);
    // Second occurrence (rowIndex=1) should be in deletes
    expect(result.deletes).toContain(1);
    // No update because first existing matches desired
    expect(result.updates).toHaveLength(0);
  });

  it('floating-point round-trip equality: total within epsilon → NO update', () => {
    const base = makeRow({ nro: '00001-00000001', total: 1234.567 });
    const existing = [withIndex(base, 0)];
    // Simulate floating-point round-trip noise
    const desired = [{ ...base, total: 1234.5670000001 }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(0);
  });

  it('recibido floating-point round-trip → NO update', () => {
    const base = makeRow({ nro: '00001-00000001', recibido: 5000.00 });
    const existing = [withIndex(base, 0)];
    const desired = [{ ...base, recibido: 5000.0000000001 }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(0);
  });

  it('NC row (tipo=NC, total<0) treated identically to FC under keyed diff', () => {
    const nc = makeRow({ cod: '003', tipo: 'NC', nro: '00003-00000001', total: -1000 });
    const existing = [withIndex(nc, 0)];
    const desired = [{ ...nc, total: -2000 }]; // total changed

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.row.total).toBe(-2000);
    expect(result.inserts).toHaveLength(0);
    expect(result.deletes).toHaveLength(0);
  });

  it('whitespace-only differences in string fields → no update (post-trim equality)', () => {
    const base = makeRow({ nro: '00001-00000001', cliente: 'TEST SA', concepto: 'Servicios' });
    const existing = [withIndex(base, 0)];
    // Same strings but with extra whitespace
    const desired = [{ ...base, cliente: '  TEST SA  ', concepto: 'Servicios  ' }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.updates).toHaveLength(0);
  });

  // Codex P1 finding: an in-place update at desiredIndex corrupts data when an
  // existing row's sort-key (fecha) changes and swaps relative position with
  // another existing row. Without detection, the writer would overwrite the
  // other row's cells while leaving the original row stale → duplicate + loss.
  // Fix: surface relative-order changes via sortInvariantViolated so the writer
  // falls back to a one-shot rewrite.
  it('common keys reorder between existing and desired → sortInvariantViolated=true (forces rewrite)', () => {
    // Existing: A at row 0 (Jan), B at row 1 (Feb)
    const aOld = makeRow({ cod: '006', nro: '00001-00000001', fecha: '2025-01-10' });
    const b    = makeRow({ cod: '006', nro: '00001-00000002', fecha: '2025-02-10' });
    const existing = [withIndex(aOld, 0), withIndex(b, 1)];

    // Desired: A's fecha corrected to April → now after B in chronological order
    const aNew = { ...aOld, fecha: '2025-04-10' };
    const desired = [{ ...b }, aNew];

    const result = diffSubdiarioRows(existing, desired);

    // Without the fix, this would be a quiet single-update diff that overwrites
    // B's row with A's data and leaves A's old data at row 0.
    expect(result.sortInvariantViolated).toBe(true);
  });

  it('common keys preserve relative order → sortInvariantViolated=false (incremental path OK)', () => {
    // Existing: A row 0, B row 1, C row 2 — all in sort order
    const a = makeRow({ cod: '006', nro: '00001-00000001', fecha: '2025-01-10' });
    const b = makeRow({ cod: '006', nro: '00001-00000002', fecha: '2025-02-10' });
    const c = makeRow({ cod: '006', nro: '00001-00000003', fecha: '2025-03-10' });
    const existing = [withIndex(a, 0), withIndex(b, 1), withIndex(c, 2)];

    // Desired keeps the same relative order; B has a value change (total)
    const desired = [{ ...a }, { ...b, total: 9999 }, { ...c }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.sortInvariantViolated).toBe(false);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.rowIndex).toBe(1);
  });

  it('insert between two common keys does not trigger reorder flag', () => {
    // Existing: A row 0, C row 1
    const a = makeRow({ cod: '006', nro: '00001-00000001', fecha: '2025-01-10' });
    const c = makeRow({ cod: '006', nro: '00001-00000003', fecha: '2025-03-10' });
    const existing = [withIndex(a, 0), withIndex(c, 1)];

    // Desired: A, then a NEW row B, then C — common keys (A, C) still in order
    const bNew = makeRow({ cod: '006', nro: '00001-00000002', fecha: '2025-02-10' });
    const desired = [{ ...a }, bNew, { ...c }];

    const result = diffSubdiarioRows(existing, desired);

    expect(result.sortInvariantViolated).toBe(false);
    expect(result.inserts).toHaveLength(1);
    expect(result.deletes).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
  });
});
