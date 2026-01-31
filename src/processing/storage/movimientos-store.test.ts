/**
 * Tests for movimientos storage operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeMovimientosBancario, storeMovimientosTarjeta, storeMovimientosBroker } from './movimientos-store.js';
import type { MovimientoBancario, MovimientoTarjeta, MovimientoBroker } from '../../types/index.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  getOrCreateMonthSheet: vi.fn(),
  formatEmptyMonthSheet: vi.fn(),
  appendRowsWithLinks: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../constants/spreadsheet-headers.js', () => ({
  MOVIMIENTOS_BANCARIO_SHEET: {
    headers: ['fecha', 'origenConcepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
  },
  MOVIMIENTOS_TARJETA_SHEET: {
    headers: ['fecha', 'descripcion', 'nroCupon', 'pesos', 'dolares'],
  },
  MOVIMIENTOS_BROKER_SHEET: {
    headers: ['descripcion', 'cantidadVN', 'saldo', 'precio', 'bruto', 'arancel', 'iva', 'neto', 'fechaConcertacion', 'fechaLiquidacion'],
  },
}));

import { getOrCreateMonthSheet, formatEmptyMonthSheet, appendRowsWithLinks } from '../../services/sheets.js';

const createTestMovimientoBancario = (overrides: Partial<MovimientoBancario> = {}): MovimientoBancario => ({
  fecha: '2025-01-15',
  origenConcepto: 'Test transaction',
  debito: 1000,
  credito: null,
  saldo: 5000,
  ...overrides,
});

const createTestMovimientoTarjeta = (overrides: Partial<MovimientoTarjeta> = {}): MovimientoTarjeta => ({
  fecha: '2025-01-15',
  descripcion: 'Test purchase',
  nroCupon: '123456',
  pesos: 1000,
  dolares: null,
  ...overrides,
});

const createTestMovimientoBroker = (overrides: Partial<MovimientoBroker> = {}): MovimientoBroker => ({
  descripcion: 'Test trade',
  cantidadVN: 100,
  saldo: 5000,
  precio: 50,
  bruto: 5000,
  arancel: 25,
  iva: 5.25,
  neto: 4969.75,
  fechaConcertacion: '2025-01-15',
  fechaLiquidacion: '2025-01-17',
  ...overrides,
});

describe('storeMovimientosBancario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store all movimientos in the resumen month (from fechaHasta), not by individual fecha', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2024-12-30', origenConcepto: 'Dec transaction', saldo: 1000 }),
      createTestMovimientoBancario({ fecha: '2025-01-05', origenConcepto: 'Early Jan transaction', saldo: 2000 }),
      createTestMovimientoBancario({ fecha: '2025-01-15', origenConcepto: 'Mid-Jan transaction', saldo: 3000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    const result = await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2024-12-30', fechaHasta: '2025-01-31' },
      5000  // saldoInicial
    );

    expect(result.ok).toBe(true);

    // Only one sheet created - the resumen's month
    expect(getOrCreateMonthSheet).toHaveBeenCalledTimes(1);
    expect(getOrCreateMonthSheet).toHaveBeenCalledWith(
      'spreadsheet-id',
      '2025-01',  // fechaHasta month, not individual fecha months
      expect.any(Array),
      undefined  // sheetOrderBatch is optional
    );

    // All movimientos in single append
    expect(appendRowsWithLinks).toHaveBeenCalledTimes(1);

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // 3 movimientos + SALDO INICIAL + SALDO FINAL = 5 rows
    expect(rows).toHaveLength(5);

    // First row is SALDO INICIAL
    expect(rows[0][1]).toBe('SALDO INICIAL');

    // Transaction rows (1, 2, 3) have original fechas preserved (sorted order)
    expect(rows[1][0]).toEqual({ type: 'date', value: '2024-12-30' });
    expect(rows[2][0]).toEqual({ type: 'date', value: '2025-01-05' });
    expect(rows[3][0]).toEqual({ type: 'date', value: '2025-01-15' });

    // Last row is SALDO FINAL
    expect(rows[4][1]).toBe('SALDO FINAL');
  });

  it('should sort movimientos by date within each month', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-20', origenConcepto: 'Second' }),
      createTestMovimientoBancario({ fecha: '2025-01-10', origenConcepto: 'First' }),
      createTestMovimientoBancario({ fecha: '2025-01-15', origenConcepto: 'Middle' }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      5000  // saldoInicial
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // Row 0: SALDO INICIAL
    expect(rows[0][1]).toBe('SALDO INICIAL');
    // Rows 1-3: transactions in sorted order
    expect(rows[1][1]).toBe('First');
    expect(rows[2][1]).toBe('Middle');
    expect(rows[3][1]).toBe('Second');
    // Row 4: SALDO FINAL
    expect(rows[4][1]).toBe('SALDO FINAL');
  });

  it('should handle empty movimientos array by creating empty sheet', async () => {
    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(formatEmptyMonthSheet).mockResolvedValue({ ok: true, value: undefined });

    const result = await storeMovimientosBancario(
      [],
      'spreadsheet-id',
      { fechaDesde: '2024-12-30', fechaHasta: '2025-01-31' },
      5000  // saldoInicial
    );

    expect(result.ok).toBe(true);
    expect(getOrCreateMonthSheet).toHaveBeenCalledWith(
      'spreadsheet-id',
      '2025-01',  // Should use fechaHasta month, not fechaDesde
      expect.any(Array),
      undefined  // sheetOrderBatch is optional
    );
    expect(formatEmptyMonthSheet).toHaveBeenCalledWith('spreadsheet-id', 123, 8);
    expect(appendRowsWithLinks).not.toHaveBeenCalled();
  });

  it('should format cells correctly for debito, credito, and saldo', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ debito: 1000, credito: null, saldo: 4000 }),
      createTestMovimientoBancario({ debito: null, credito: 2000, saldo: 6000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      5000  // saldoInicial
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // Row 0: SALDO INICIAL
    // Row 1: First transaction - debito has value, credito is null
    expect(rows[1][2]).toEqual({ type: 'number', value: 1000 });
    expect(rows[1][3]).toBeNull();
    expect(rows[1][4]).toEqual({ type: 'number', value: 4000 });

    // Row 2: Second transaction - debito is null, credito has value
    expect(rows[2][2]).toBeNull();
    expect(rows[2][3]).toEqual({ type: 'number', value: 2000 });
    expect(rows[2][4]).toEqual({ type: 'number', value: 6000 });
  });

  it('should return error when getOrCreateMonthSheet fails', async () => {
    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({
      ok: false,
      error: new Error('Sheet creation failed')
    });

    const result = await storeMovimientosBancario(
      [createTestMovimientoBancario()],
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      5000  // saldoInicial
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(new Error('Sheet creation failed'));
    }
  });

  it('should return error when appendRowsWithLinks fails', async () => {
    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({
      ok: false,
      error: new Error('Append failed')
    });

    const result = await storeMovimientosBancario(
      [createTestMovimientoBancario()],
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      5000  // saldoInicial
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(new Error('Append failed'));
    }
  });

  it('should insert initial balance row first with saldoInicial value', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-15', saldo: 11000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      10000  // saldoInicial
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // First row should be SALDO INICIAL
    expect(rows[0][1]).toBe('SALDO INICIAL');
    expect(rows[0][5]).toBe(10000);  // saldoCalculado column has initial balance value
  });

  it('should generate formula in saldoCalculado column for each transaction', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-15', debito: 1000, credito: null, saldo: 9000 }),
      createTestMovimientoBancario({ fecha: '2025-01-20', debito: null, credito: 5000, saldo: 14000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      10000  // saldoInicial
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // Row mapping with header row:
    // - Sheet row 1: Headers
    // - Sheet row 2: SALDO INICIAL (array index 0)
    // - Sheet row 3: First transaction (array index 1) - formula references row 2
    // - Sheet row 4: Second transaction (array index 2) - formula references row 3
    expect(rows[1][5]).toEqual({ type: 'formula', value: '=F2+D3-C3' });
    expect(rows[2][5]).toEqual({ type: 'formula', value: '=F3+D4-C4' });
  });

  it('should insert final balance row last referencing last transaction', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-15', saldo: 9000 }),
      createTestMovimientoBancario({ fecha: '2025-01-20', saldo: 14000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      10000  // saldoInicial
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // Last row should be SALDO FINAL
    const lastRow = rows[rows.length - 1];
    expect(lastRow[1]).toBe('SALDO FINAL');
    // Row mapping with header row:
    // - Sheet row 1: Headers
    // - Sheet row 2: SALDO INICIAL (array index 0)
    // - Sheet row 3-4: transactions (array index 1-2)
    // - Last transaction at array index 2 → sheet row 4
    expect(lastRow[5]).toEqual({ type: 'formula', value: '=F4' });
  });

  it('should keep original saldo column for comparison alongside saldoCalculado', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-15', debito: 1000, credito: null, saldo: 9000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      10000  // saldoInicial
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // Transaction row (row 1, after SALDO INICIAL)
    const txRow = rows[1];
    expect(txRow[4]).toEqual({ type: 'number', value: 9000 }); // saldo (parsed from PDF)
    // Array index 1 → sheet row 3, previous row 2
    expect(txRow[5]).toEqual({ type: 'formula', value: '=F2+D3-C3' });  // saldoCalculado (CellFormula)
  });

  it('should use range A:H for 8-column sheet', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario(),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      10000
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const range = appendCall[1];

    expect(range).toBe('2025-01!A:H');
  });

  it('should store rows with 8 columns (includes empty matchedFileId and detalle)', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-15', origenConcepto: 'Test', saldo: 9000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      10000
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // Each row should have 8 columns
    expect(rows[0]).toHaveLength(8); // SALDO INICIAL
    expect(rows[1]).toHaveLength(8); // Transaction
    expect(rows[2]).toHaveLength(8); // SALDO FINAL
  });

  it('should include empty matchedFileId (column G index 6) for new movimientos', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-15', saldo: 9000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      10000
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // SALDO INICIAL row
    expect(rows[0][6]).toBe('');  // matchedFileId empty
    // Transaction row
    expect(rows[1][6]).toBe('');  // matchedFileId empty
    // SALDO FINAL row
    expect(rows[2][6]).toBe('');  // matchedFileId empty
  });

  it('should include empty detalle (column H index 7) for new movimientos', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-15', saldo: 9000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' },
      10000
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // SALDO INICIAL row
    expect(rows[0][7]).toBe('');  // detalle empty
    // Transaction row
    expect(rows[1][7]).toBe('');  // detalle empty
    // SALDO FINAL row
    expect(rows[2][7]).toBe('');  // detalle empty
  });
});

describe('storeMovimientosTarjeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store all movimientos in the resumen month (from fechaHasta)', async () => {
    const movimientos: MovimientoTarjeta[] = [
      createTestMovimientoTarjeta({ fecha: '2024-12-30', descripcion: 'Dec purchase' }),
      createTestMovimientoTarjeta({ fecha: '2025-01-15', descripcion: 'Jan purchase' }),
      createTestMovimientoTarjeta({ fecha: '2025-01-20', descripcion: 'Late Jan purchase' }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    const result = await storeMovimientosTarjeta(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2024-12-30', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(true);

    // Only one sheet created - the resumen's month
    expect(getOrCreateMonthSheet).toHaveBeenCalledTimes(1);
    expect(getOrCreateMonthSheet).toHaveBeenCalledWith(
      'spreadsheet-id',
      '2025-01',  // fechaHasta month
      expect.any(Array),
      undefined  // sheetOrderBatch is optional
    );

    // All movimientos in single append
    expect(appendRowsWithLinks).toHaveBeenCalledTimes(1);

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // All 3 movimientos stored together
    expect(rows).toHaveLength(3);

    // Original fechas preserved (sorted order)
    expect(rows[0][0]).toEqual({ type: 'date', value: '2024-12-30' });
    expect(rows[1][0]).toEqual({ type: 'date', value: '2025-01-15' });
    expect(rows[2][0]).toEqual({ type: 'date', value: '2025-01-20' });
  });

  it('should sort movimientos by date within each month', async () => {
    const movimientos: MovimientoTarjeta[] = [
      createTestMovimientoTarjeta({ fecha: '2025-01-20', descripcion: 'Second' }),
      createTestMovimientoTarjeta({ fecha: '2025-01-10', descripcion: 'First' }),
      createTestMovimientoTarjeta({ fecha: '2025-01-15', descripcion: 'Middle' }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosTarjeta(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    expect(rows[0][1]).toBe('First');
    expect(rows[1][1]).toBe('Middle');
    expect(rows[2][1]).toBe('Second');
  });

  it('should handle empty movimientos array by creating empty sheet', async () => {
    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(formatEmptyMonthSheet).mockResolvedValue({ ok: true, value: undefined });

    const result = await storeMovimientosTarjeta(
      [],
      'spreadsheet-id',
      { fechaDesde: '2024-12-30', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(true);
    expect(getOrCreateMonthSheet).toHaveBeenCalledWith(
      'spreadsheet-id',
      '2025-01',  // Should use fechaHasta month
      expect.any(Array),
      undefined  // sheetOrderBatch is optional
    );
    expect(formatEmptyMonthSheet).toHaveBeenCalledWith('spreadsheet-id', 123, 5);
    expect(appendRowsWithLinks).not.toHaveBeenCalled();
  });

  it('should format cells correctly for pesos and dolares', async () => {
    const movimientos: MovimientoTarjeta[] = [
      createTestMovimientoTarjeta({ pesos: 1000, dolares: null }),
      createTestMovimientoTarjeta({ pesos: null, dolares: 50 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosTarjeta(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // First row: pesos has value, dolares is null
    expect(rows[0][3]).toEqual({ type: 'number', value: 1000 });
    expect(rows[0][4]).toBeNull();

    // Second row: pesos is null, dolares has value
    expect(rows[1][3]).toBeNull();
    expect(rows[1][4]).toEqual({ type: 'number', value: 50 });
  });

  it('should return error when getOrCreateMonthSheet fails', async () => {
    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({
      ok: false,
      error: new Error('Sheet creation failed')
    });

    const result = await storeMovimientosTarjeta(
      [createTestMovimientoTarjeta()],
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(new Error('Sheet creation failed'));
    }
  });
});

describe('storeMovimientosBroker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store all movimientos in the resumen month (from fechaHasta)', async () => {
    const movimientos: MovimientoBroker[] = [
      createTestMovimientoBroker({ fechaConcertacion: '2024-12-30', fechaLiquidacion: '2025-01-02', descripcion: 'Dec trade' }),
      createTestMovimientoBroker({ fechaConcertacion: '2025-01-15', fechaLiquidacion: '2025-01-17', descripcion: 'Jan trade' }),
      createTestMovimientoBroker({ fechaConcertacion: '2025-01-20', fechaLiquidacion: '2025-01-22', descripcion: 'Late Jan trade' }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    const result = await storeMovimientosBroker(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2024-12-30', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(true);

    // Only one sheet created - the resumen's month
    expect(getOrCreateMonthSheet).toHaveBeenCalledTimes(1);
    expect(getOrCreateMonthSheet).toHaveBeenCalledWith(
      'spreadsheet-id',
      '2025-01',  // fechaHasta month
      expect.any(Array),
      undefined  // sheetOrderBatch is optional
    );

    // All movimientos in single append
    expect(appendRowsWithLinks).toHaveBeenCalledTimes(1);

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // All 3 movimientos stored together
    expect(rows).toHaveLength(3);

    // Original fechaConcertacion preserved (sorted order)
    expect(rows[0][8]).toEqual({ type: 'date', value: '2024-12-30' });
    expect(rows[1][8]).toEqual({ type: 'date', value: '2025-01-15' });
    expect(rows[2][8]).toEqual({ type: 'date', value: '2025-01-20' });
  });

  it('should sort movimientos by fechaConcertacion within each month', async () => {
    const movimientos: MovimientoBroker[] = [
      createTestMovimientoBroker({ fechaConcertacion: '2025-01-20', descripcion: 'Second' }),
      createTestMovimientoBroker({ fechaConcertacion: '2025-01-10', descripcion: 'First' }),
      createTestMovimientoBroker({ fechaConcertacion: '2025-01-15', descripcion: 'Middle' }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBroker(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    expect(rows[0][0]).toBe('First');
    expect(rows[1][0]).toBe('Middle');
    expect(rows[2][0]).toBe('Second');
  });

  it('should handle empty movimientos array by creating empty sheet', async () => {
    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(formatEmptyMonthSheet).mockResolvedValue({ ok: true, value: undefined });

    const result = await storeMovimientosBroker(
      [],
      'spreadsheet-id',
      { fechaDesde: '2024-12-30', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(true);
    expect(getOrCreateMonthSheet).toHaveBeenCalledWith(
      'spreadsheet-id',
      '2025-01',  // Should use fechaHasta month
      expect.any(Array),
      undefined  // sheetOrderBatch is optional
    );
    expect(formatEmptyMonthSheet).toHaveBeenCalledWith('spreadsheet-id', 123, 10);
    expect(appendRowsWithLinks).not.toHaveBeenCalled();
  });

  it('should format cells correctly with nullable fields', async () => {
    const movimientos: MovimientoBroker[] = [
      createTestMovimientoBroker({
        cantidadVN: null,
        precio: null,
        bruto: null,
        arancel: null,
        iva: null,
        neto: null
      }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    await storeMovimientosBroker(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    expect(rows[0][1]).toBeNull(); // cantidadVN
    expect(rows[0][3]).toBeNull(); // precio
    expect(rows[0][4]).toBeNull(); // bruto
    expect(rows[0][5]).toBeNull(); // arancel
    expect(rows[0][6]).toBeNull(); // iva
    expect(rows[0][7]).toBeNull(); // neto

    // saldo and dates should always have values
    expect(rows[0][2]).toEqual({ type: 'number', value: 5000 });
    expect(rows[0][8]).toEqual({ type: 'date', value: '2025-01-15' });
    expect(rows[0][9]).toEqual({ type: 'date', value: '2025-01-17' });
  });

  it('should return error when appendRowsWithLinks fails', async () => {
    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({
      ok: false,
      error: new Error('Append failed')
    });

    const result = await storeMovimientosBroker(
      [createTestMovimientoBroker()],
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(new Error('Append failed'));
    }
  });
});
