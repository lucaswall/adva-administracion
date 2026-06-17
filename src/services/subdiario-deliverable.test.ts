/**
 * Tests for buildSubdiarioDeliverable — pure render model for the deliverable
 * Subdiario de Ventas sheet.
 *
 * ADV-381
 */

import { describe, it, expect } from 'vitest';
import { buildSubdiarioDeliverable } from './subdiario-deliverable.js';
import type { SubdiarioRow } from '../types/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<SubdiarioRow> = {}): SubdiarioRow {
  return {
    fecha: '2026-01-15',
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
    movimiento: '',
    movimientoLabel: '',
    facturaFileId: 'file-abc',
    notas: '',
    ...overrides,
  };
}

const CURRENT_YEAR = 2026;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildSubdiarioDeliverable', () => {
  it('returns empty array for empty input', () => {
    const result = buildSubdiarioDeliverable([], CURRENT_YEAR);
    expect(result).toEqual([]);
  });

  it('produces header → data → subtotal → blank for a single current-year row', () => {
    const row = makeRow({ fecha: '2026-01-15', total: 1500 });
    const result = buildSubdiarioDeliverable([row], CURRENT_YEAR);

    expect(result).toHaveLength(4);

    expect(result[0].type).toBe('header');
    expect(result[0].label).toBe('PERIODO ENERO 2026');

    expect(result[1].type).toBe('data');
    expect(result[1].row).toEqual(row);

    expect(result[2].type).toBe('subtotal');
    expect(result[2].subtotal).toBe(1500);

    expect(result[3].type).toBe('blank');
  });

  it('uses uppercased Spanish month names for current-year headers', () => {
    const months = [
      { date: '2026-01-10', expected: 'PERIODO ENERO 2026' },
      { date: '2026-02-10', expected: 'PERIODO FEBRERO 2026' },
      { date: '2026-03-10', expected: 'PERIODO MARZO 2026' },
      { date: '2026-04-10', expected: 'PERIODO ABRIL 2026' },
      { date: '2026-05-10', expected: 'PERIODO MAYO 2026' },
      { date: '2026-06-10', expected: 'PERIODO JUNIO 2026' },
      { date: '2026-07-10', expected: 'PERIODO JULIO 2026' },
      { date: '2026-08-10', expected: 'PERIODO AGOSTO 2026' },
      { date: '2026-09-10', expected: 'PERIODO SEPTIEMBRE 2026' },
      { date: '2026-10-10', expected: 'PERIODO OCTUBRE 2026' },
      { date: '2026-11-10', expected: 'PERIODO NOVIEMBRE 2026' },
      { date: '2026-12-10', expected: 'PERIODO DICIEMBRE 2026' },
    ];

    for (const { date, expected } of months) {
      const row = makeRow({ fecha: date });
      const result = buildSubdiarioDeliverable([row], CURRENT_YEAR);
      const header = result.find(r => r.type === 'header');
      expect(header?.label).toBe(expected);
    }
  });

  it('uses PERIODO {YEAR} label for prior-year rows', () => {
    const row = makeRow({ fecha: '2025-06-15' });
    const result = buildSubdiarioDeliverable([row], CURRENT_YEAR);

    const header = result.find(r => r.type === 'header');
    expect(header?.label).toBe('PERIODO 2025');
  });

  it('groups prior-year rows by year', () => {
    const row2024 = makeRow({ fecha: '2024-03-10', nro: '00001-00000001', total: 100 });
    const row2025 = makeRow({ fecha: '2025-11-20', nro: '00001-00000002', total: 200 });
    const result = buildSubdiarioDeliverable([row2024, row2025], CURRENT_YEAR);

    // 2024 block: header + data + subtotal + blank = 4
    // 2025 block: header + data + subtotal + blank = 4
    expect(result).toHaveLength(8);

    expect(result[0].type).toBe('header');
    expect(result[0].label).toBe('PERIODO 2024');
    expect(result[1].type).toBe('data');
    expect(result[1].row?.nro).toBe('00001-00000001');
    expect(result[2].type).toBe('subtotal');
    expect(result[2].subtotal).toBe(100);
    expect(result[3].type).toBe('blank');

    expect(result[4].type).toBe('header');
    expect(result[4].label).toBe('PERIODO 2025');
    expect(result[5].type).toBe('data');
    expect(result[5].row?.nro).toBe('00001-00000002');
    expect(result[6].type).toBe('subtotal');
    expect(result[6].subtotal).toBe(200);
    expect(result[7].type).toBe('blank');
  });

  it('groups current-year rows by month in chronological order', () => {
    const rowMarch = makeRow({ fecha: '2026-03-05', nro: '00001-00000001', total: 300 });
    const rowJan = makeRow({ fecha: '2026-01-20', nro: '00001-00000002', total: 100 });
    const rowJan2 = makeRow({ fecha: '2026-01-25', nro: '00001-00000003', total: 150 });
    // Input is already sorted fecha ASC, nro ASC per builder contract
    const rows = [rowJan, rowJan2, rowMarch];
    const result = buildSubdiarioDeliverable(rows, CURRENT_YEAR);

    // Jan block: header + data + data + subtotal + blank = 5
    // March block: header + data + subtotal + blank = 4
    // Total = 9
    expect(result).toHaveLength(9);

    expect(result[0].type).toBe('header');
    expect(result[0].label).toBe('PERIODO ENERO 2026');
    expect(result[1].row?.nro).toBe('00001-00000002');
    expect(result[2].row?.nro).toBe('00001-00000003');
    expect(result[3].type).toBe('subtotal');
    expect(result[3].subtotal).toBe(250);
    expect(result[4].type).toBe('blank');

    expect(result[5].type).toBe('header');
    expect(result[5].label).toBe('PERIODO MARZO 2026');
    expect(result[6].row?.nro).toBe('00001-00000001');
    expect(result[7].type).toBe('subtotal');
    expect(result[7].subtotal).toBe(300);
    expect(result[8].type).toBe('blank');
  });

  it('emits a blank separator after every block', () => {
    const rowJan = makeRow({ fecha: '2026-01-10' });
    const rowFeb = makeRow({ fecha: '2026-02-10', nro: '00001-00000002' });
    const result = buildSubdiarioDeliverable([rowJan, rowFeb], CURRENT_YEAR);

    // Jan: header, data, subtotal, blank  (indices 0-3)
    // Feb: header, data, subtotal, blank  (indices 4-7)
    expect(result).toHaveLength(8);
    expect(result[3].type).toBe('blank');
    expect(result[7].type).toBe('blank');
  });

  it('places prior-year blocks before current-year blocks', () => {
    const rowPrior = makeRow({ fecha: '2025-06-10', nro: '00001-00000001', total: 500 });
    const rowCurrent = makeRow({ fecha: '2026-03-10', nro: '00001-00000002', total: 1000 });
    const result = buildSubdiarioDeliverable([rowPrior, rowCurrent], CURRENT_YEAR);

    expect(result[0].label).toBe('PERIODO 2025');
    // skip to 5th item (after: header, data, subtotal, blank for prior)
    expect(result[4].label).toBe('PERIODO MARZO 2026');
  });

  it('computes signed subtotals (NC rows have negative total, FC positive)', () => {
    const fc = makeRow({ fecha: '2026-01-10', nro: '00001-00000001', tipo: 'FC', total: 2000 });
    const nc = makeRow({
      fecha: '2026-01-15',
      nro: '00001-00000002',
      tipo: 'NC',
      total: -500, // NC total is already negative from builder
    });
    const result = buildSubdiarioDeliverable([fc, nc], CURRENT_YEAR);
    const subtotal = result.find(r => r.type === 'subtotal');
    expect(subtotal?.subtotal).toBe(1500); // 2000 + (-500)
  });

  it('sets isNC flag correctly', () => {
    const fc = makeRow({ tipo: 'FC', nro: '00001-00000001' });
    const nc = makeRow({ tipo: 'NC', nro: '00001-00000002', total: -100 });
    const result = buildSubdiarioDeliverable([fc, nc], CURRENT_YEAR);

    const dataRows = result.filter(r => r.type === 'data');
    expect(dataRows[0].isNC).toBe(false);
    expect(dataRows[1].isNC).toBe(true);
  });

  it('sets isFalta flag for FALTA placeholder rows', () => {
    const falta = makeRow({
      cliente: 'FALTA 00001-00000003',
      nro: '00001-00000003',
      facturaFileId: '',
      total: 0,
    });
    const normal = makeRow({ nro: '00001-00000001' });
    const result = buildSubdiarioDeliverable([normal, falta], CURRENT_YEAR);

    const dataRows = result.filter(r => r.type === 'data');
    expect(dataRows.find(r => r.row?.nro === '00001-00000001')?.isFalta).toBe(false);
    expect(dataRows.find(r => r.row?.nro === '00001-00000003')?.isFalta).toBe(true);
  });

  it('sets isCancelledByNC for FC rows with NC fechaCobro', () => {
    const cancelled = makeRow({
      tipo: 'FC',
      fechaCobro: 'NC 00001-00000002',
      nro: '00001-00000001',
    });
    const normal = makeRow({ nro: '00001-00000002', fechaCobro: '2026-01-20' });
    const result = buildSubdiarioDeliverable([cancelled, normal], CURRENT_YEAR);

    const dataRows = result.filter(r => r.type === 'data');
    expect(dataRows.find(r => r.row?.nro === '00001-00000001')?.isCancelledByNC).toBe(true);
    expect(dataRows.find(r => r.row?.nro === '00001-00000002')?.isCancelledByNC).toBe(false);
  });

  it('isCancelledByNC is false for NC rows (even if fechaCobro starts with NC)', () => {
    const nc = makeRow({
      tipo: 'NC',
      fechaCobro: 'NC 00001-00000005',
      nro: '00001-00000003',
      total: -100,
    });
    const result = buildSubdiarioDeliverable([nc], CURRENT_YEAR);
    const dataRow = result.find(r => r.type === 'data');
    expect(dataRow?.isCancelledByNC).toBe(false);
  });

  it('preserves builder row order within each block', () => {
    // Input is sorted fecha ASC, nro ASC — builder order must be preserved
    const r1 = makeRow({ fecha: '2026-05-01', nro: '00001-00000001', total: 100 });
    const r2 = makeRow({ fecha: '2026-05-05', nro: '00001-00000002', total: 200 });
    const r3 = makeRow({ fecha: '2026-05-10', nro: '00001-00000003', total: 300 });
    const result = buildSubdiarioDeliverable([r1, r2, r3], CURRENT_YEAR);

    const dataRows = result.filter(r => r.type === 'data');
    expect(dataRows[0].row?.nro).toBe('00001-00000001');
    expect(dataRows[1].row?.nro).toBe('00001-00000002');
    expect(dataRows[2].row?.nro).toBe('00001-00000003');
  });

  it('keeps notas verbatim on data rows', () => {
    const row = makeRow({
      notas: 'Socio 1003 - Test SA; Retencion Ganancias $50.000',
    });
    const result = buildSubdiarioDeliverable([row], CURRENT_YEAR);
    const dataRow = result.find(r => r.type === 'data');
    expect(dataRow?.row?.notas).toBe('Socio 1003 - Test SA; Retencion Ganancias $50.000');
  });

  it('includes FALTA placeholder rows in output', () => {
    const falta = makeRow({
      cliente: 'FALTA 00001-00000002',
      nro: '00001-00000002',
      facturaFileId: '',
      total: 0,
    });
    const result = buildSubdiarioDeliverable([falta], CURRENT_YEAR);
    const dataRows = result.filter(r => r.type === 'data');
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0].isFalta).toBe(true);
  });

  it('multiple prior years sorted ascending, then current-year months ascending', () => {
    const r2023 = makeRow({ fecha: '2023-06-01', nro: '00001-00000001', total: 10 });
    const r2024 = makeRow({ fecha: '2024-03-01', nro: '00001-00000002', total: 20 });
    const r2026jan = makeRow({ fecha: '2026-01-01', nro: '00001-00000003', total: 30 });
    const r2026mar = makeRow({ fecha: '2026-03-01', nro: '00001-00000004', total: 40 });
    // Input is already sorted
    const result = buildSubdiarioDeliverable([r2023, r2024, r2026jan, r2026mar], CURRENT_YEAR);

    const headers = result.filter(r => r.type === 'header');
    expect(headers.map(h => h.label)).toEqual([
      'PERIODO 2023',
      'PERIODO 2024',
      'PERIODO ENERO 2026',
      'PERIODO MARZO 2026',
    ]);
  });

  it('carries full SubdiarioRow on data items', () => {
    const row = makeRow({
      fecha: '2026-06-10',
      cod: '001',
      tipo: 'FC',
      nro: '00003-00001234',
      cliente: 'EMPRESA UNO SA',
      cuit: '27234567891',
      condicion: 'IVA Responsable Inscripto',
      total: 9999,
      concepto: 'Cuota',
      categoria: 'Empresa',
      fechaCobro: '2026-06-30',
      recibido: 9999,
      movimiento: 'https://example.com',
      movimientoLabel: 'BBVA 2026-06 #5',
      facturaFileId: 'file-xyz',
      notas: 'Socio 1001 - EMPRESA UNO SA',
    });
    const result = buildSubdiarioDeliverable([row], CURRENT_YEAR);
    const dataRow = result.find(r => r.type === 'data');
    expect(dataRow?.row).toEqual(row);
  });
});
