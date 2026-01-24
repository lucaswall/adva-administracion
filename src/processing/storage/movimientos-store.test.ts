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
    headers: ['Fecha', 'Origen/Concepto', 'Débito', 'Crédito', 'Saldo'],
  },
  MOVIMIENTOS_TARJETA_SHEET: {
    headers: ['Fecha', 'Descripción', 'Nro. Cupón', 'Pesos', 'Dólares'],
  },
  MOVIMIENTOS_BROKER_SHEET: {
    headers: ['Descripción', 'Cantidad/VN', 'Saldo', 'Precio', 'Bruto', 'Arancel', 'IVA', 'Neto', 'Fecha Concertación', 'Fecha Liquidación'],
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

  it('should store bank account movimientos grouped by month', async () => {
    const movimientos: MovimientoBancario[] = [
      createTestMovimientoBancario({ fecha: '2025-01-15', saldo: 1000 }),
      createTestMovimientoBancario({ fecha: '2025-01-20', saldo: 2000 }),
      createTestMovimientoBancario({ fecha: '2025-02-05', saldo: 3000 }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    const result = await storeMovimientosBancario(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-02-28' }
    );

    expect(result.ok).toBe(true);
    expect(getOrCreateMonthSheet).toHaveBeenCalledTimes(2); // 2025-01 and 2025-02
    expect(appendRowsWithLinks).toHaveBeenCalledTimes(2);
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

    const result = await storeMovimientosBancario(
      [],
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(true);
    expect(getOrCreateMonthSheet).toHaveBeenCalledWith(
      'spreadsheet-id',
      '2025-01',
      expect.any(Array)
    );
    expect(formatEmptyMonthSheet).toHaveBeenCalledWith('spreadsheet-id', 123);
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
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2] as any[];

    // First row: debito has value, credito is null
    expect(rows[0][2]).toEqual({ type: 'number', value: 1000 });
    expect(rows[0][3]).toBeNull();
    expect(rows[0][4]).toEqual({ type: 'number', value: 4000 });

    // Second row: debito is null, credito has value
    expect(rows[1][2]).toBeNull();
    expect(rows[1][3]).toEqual({ type: 'number', value: 2000 });
    expect(rows[1][4]).toEqual({ type: 'number', value: 6000 });
  });

  it('should return error when getOrCreateMonthSheet fails', async () => {
    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({
      ok: false,
      error: new Error('Sheet creation failed')
    });

    const result = await storeMovimientosBancario(
      [createTestMovimientoBancario()],
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
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
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(new Error('Append failed'));
    }
  });
});

describe('storeMovimientosTarjeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store credit card movimientos grouped by month', async () => {
    const movimientos: MovimientoTarjeta[] = [
      createTestMovimientoTarjeta({ fecha: '2025-01-15' }),
      createTestMovimientoTarjeta({ fecha: '2025-01-20' }),
      createTestMovimientoTarjeta({ fecha: '2025-02-05' }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    const result = await storeMovimientosTarjeta(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-02-28' }
    );

    expect(result.ok).toBe(true);
    expect(getOrCreateMonthSheet).toHaveBeenCalledTimes(2);
    expect(appendRowsWithLinks).toHaveBeenCalledTimes(2);
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
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(true);
    expect(formatEmptyMonthSheet).toHaveBeenCalledWith('spreadsheet-id', 123);
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

  it('should store broker movimientos grouped by fechaConcertacion month', async () => {
    const movimientos: MovimientoBroker[] = [
      createTestMovimientoBroker({ fechaConcertacion: '2025-01-15', fechaLiquidacion: '2025-01-17' }),
      createTestMovimientoBroker({ fechaConcertacion: '2025-01-20', fechaLiquidacion: '2025-01-22' }),
      createTestMovimientoBroker({ fechaConcertacion: '2025-02-05', fechaLiquidacion: '2025-02-07' }),
    ];

    vi.mocked(getOrCreateMonthSheet).mockResolvedValue({ ok: true, value: 123 });
    vi.mocked(appendRowsWithLinks).mockResolvedValue({ ok: true, value: 0 });

    const result = await storeMovimientosBroker(
      movimientos,
      'spreadsheet-id',
      { fechaDesde: '2025-01-01', fechaHasta: '2025-02-28' }
    );

    expect(result.ok).toBe(true);
    expect(getOrCreateMonthSheet).toHaveBeenCalledTimes(2);
    expect(appendRowsWithLinks).toHaveBeenCalledTimes(2);
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
      { fechaDesde: '2025-01-01', fechaHasta: '2025-01-31' }
    );

    expect(result.ok).toBe(true);
    expect(formatEmptyMonthSheet).toHaveBeenCalledWith('spreadsheet-id', 123);
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
