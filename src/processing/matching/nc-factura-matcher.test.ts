/**
 * Tests for NC-Factura matcher
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractReferencedFacturaNumber, matchNCsWithFacturas } from './nc-factura-matcher.js';

// Mock dependencies
vi.mock('../../services/sheets.js', () => ({
  getValues: vi.fn(),
  setValues: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../utils/correlation.js', () => ({
  getCorrelationId: () => 'test-correlation-id',
}));

import { getValues, setValues } from '../../services/sheets.js';

describe('extractReferencedFacturaNumber', () => {
  it('extracts factura number from "Factura N° 2-3160" pattern', () => {
    const result = extractReferencedFacturaNumber('Nota de credito s/ Factura N° 2-3160');
    expect(result).toBe('00002-00003160');
  });

  it('extracts factura number from "Factura Nro 0002-00003160" pattern', () => {
    const result = extractReferencedFacturaNumber('NC ref Factura Nro 0002-00003160');
    expect(result).toBe('00002-00003160');
  });

  it('extracts factura number from "Fact. 2-3160" pattern', () => {
    const result = extractReferencedFacturaNumber('Anulacion Fact. 2-3160');
    expect(result).toBe('00002-00003160');
  });

  it('extracts factura number from "ref. 2-3160" pattern', () => {
    const result = extractReferencedFacturaNumber('Descuento ref. 2-3160 por devolucion');
    expect(result).toBe('00002-00003160');
  });

  it('extracts factura number from "s/ 2-3160" pattern', () => {
    const result = extractReferencedFacturaNumber('Nota de credito s/ 2-3160');
    expect(result).toBe('00002-00003160');
  });

  it('extracts factura number from "anulacion factura 2-3160" pattern', () => {
    const result = extractReferencedFacturaNumber('anulacion factura 2-3160');
    expect(result).toBe('00002-00003160');
  });

  it('normalizes various number formats', () => {
    expect(extractReferencedFacturaNumber('Factura N° 0002-00003160')).toBe('00002-00003160');
    expect(extractReferencedFacturaNumber('Factura N° 2-3160')).toBe('00002-00003160');
    expect(extractReferencedFacturaNumber('Factura N° 00002-3160')).toBe('00002-00003160');
  });

  it('returns null when no factura reference found', () => {
    expect(extractReferencedFacturaNumber('Some random text without reference')).toBeNull();
    expect(extractReferencedFacturaNumber('')).toBeNull();
    expect(extractReferencedFacturaNumber('Nota de credito general')).toBeNull();
  });

  it('handles null and undefined input', () => {
    expect(extractReferencedFacturaNumber(null as unknown as string)).toBeNull();
    expect(extractReferencedFacturaNumber(undefined as unknown as string)).toBeNull();
  });
});

describe('matchNCsWithFacturas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when no rows in spreadsheet', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [] });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
  });

  it('returns 0 when only header row exists', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [['Header1', 'Header2']],
    });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
  });

  it('matches NC with factura when same CUIT and exact amount', async () => {
    const mockRows = [
      // Header row
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Regular factura - row 2
      ['2025-01-01', 'file-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      // NC that cancels the factura - row 3
      ['2025-01-15', 'file-2', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }

    // Verify both factura and NC were marked as paid
    expect(setValues).toHaveBeenCalledTimes(2);
    expect(setValues).toHaveBeenCalledWith(
      'test-spreadsheet-id',
      'Facturas Recibidas!S2',
      [['SI']]
    );
    expect(setValues).toHaveBeenCalledWith(
      'test-spreadsheet-id',
      'Facturas Recibidas!S3',
      [['SI']]
    );
  });

  it('does not match NC when amounts differ', async () => {
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Regular factura with amount 1210
      ['2025-01-01', 'file-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      // NC with different amount (1000 instead of 1210)
      ['2025-01-15', 'file-2', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '826.45', '173.55', '1000', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('does not match NC when CUIT differs', async () => {
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Regular factura from supplier A
      ['2025-01-01', 'file-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      // NC from different supplier B
      ['2025-01-15', 'file-2', 'nc.pdf', 'NC', '0002-00000001', '27234567891', 'OTRO SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('does not match NC when factura is already paid', async () => {
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Regular factura already marked as paid
      ['2025-01-01', 'file-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', 'SI'],
      // NC that would match
      ['2025-01-15', 'file-2', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('skips NC that is already marked as paid', async () => {
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Regular factura
      ['2025-01-01', 'file-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      // NC already marked as paid
      ['2025-01-15', 'file-2', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', 'SI'],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('does not match NC with date before factura date', async () => {
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Regular factura dated 2025-01-15
      ['2025-01-15', 'file-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-15', '0.95', 'NO', '', '', '', ''],
      // NC dated before factura (2025-01-01)
      ['2025-01-01', 'file-2', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-01', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('returns error when getValues fails', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: false,
      error: new Error('API error'),
    });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API error');
    }
  });

  it('continues matching when setValues fails for one pair', async () => {
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // First factura-NC pair
      ['2025-01-01', 'file-1', 'factura1.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      ['2025-01-15', 'file-2', 'nc1.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'NC s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', ''],
      // Second factura-NC pair
      ['2025-02-01', 'file-3', 'factura2.pdf', 'A', '0002-00004000', '27234567891', 'OTRO SA', '2000', '420', '2420', 'ARS', 'Servicios', '2025-02-01', '0.95', 'NO', '', '', '', ''],
      ['2025-02-15', 'file-4', 'nc2.pdf', 'NC', '0002-00000002', '27234567891', 'OTRO SA', '2000', '420', '2420', 'ARS', 'NC s/ Factura N° 2-4000', '2025-02-15', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });
    // First pair fails, second pair succeeds
    vi.mocked(setValues)
      .mockResolvedValueOnce({ ok: false, error: new Error('Update failed') })
      .mockResolvedValueOnce({ ok: true, value: 1 })
      .mockResolvedValueOnce({ ok: true, value: 1 });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    // Should still report 1 successful match (the second pair)
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }
  });

  it('normalizes serial number dates in fechaEmision when matching', async () => {
    // Serial 45658 => 2025-01-01, Serial 45672 => 2025-01-15
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Regular factura with serial number date
      [45658, 'file-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      // NC with serial number date
      [45672, 'file-2', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should match even with serial number dates
      expect(result.value).toBe(1);
    }

    // Both factura and NC should be marked as paid
    expect(setValues).toHaveBeenCalledTimes(2);
  });

  it('should skip NC with MANUAL matchConfidence — not match it to any factura (Fix 5 - ADV-131)', async () => {
    // NC at row[16]='MANUAL' is locked — skip it even though it would otherwise match
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Regular unpaid factura
      ['2025-01-01', 'factura-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      // NC with MANUAL matchConfidence — must be skipped
      ['2025-01-15', 'nc-manual', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', 'MANUAL', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    // MANUAL NC must not trigger any setValues calls
    expect(setValues).not.toHaveBeenCalled();
  });

  it('matches NC Emitida with Factura Emitida by cuitReceptor, sets pagada=SI (ADV-171)', async () => {
    // A:T range with 20 columns — pagada at index 18 (column S), tipoDeCambio at index 19 (column T)
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada', 'tipoDeCambio'],
      // Factura Emitida - row 2 — cuitReceptor='20123456786' at column F (index 5)
      ['2025-01-01', 'fact-emit-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', '', ''],
      // NC Emitida - row 3 — same cuitReceptor
      ['2025-01-15', 'nc-emit-1', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await matchNCsWithFacturas('test-spreadsheet-id', 'Facturas Emitidas', 'cuitReceptor', 'A:T', 'S');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }

    expect(setValues).toHaveBeenCalledTimes(2);
    // Factura Emitida at row 2 → Facturas Emitidas!S2
    expect(setValues).toHaveBeenCalledWith('test-spreadsheet-id', 'Facturas Emitidas!S2', [['SI']]);
    // NC at row 3 → Facturas Emitidas!S3
    expect(setValues).toHaveBeenCalledWith('test-spreadsheet-id', 'Facturas Emitidas!S3', [['SI']]);
  });

  it('skips MANUAL NC in Facturas Emitidas (ADV-171)', async () => {
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada', 'tipoDeCambio'],
      // Regular factura emitida
      ['2025-01-01', 'fact-emit-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', '', ''],
      // NC Emitida with MANUAL — must be skipped
      ['2025-01-15', 'nc-emit-manual', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', 'MANUAL', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id', 'Facturas Emitidas', 'cuitReceptor', 'A:T', 'S');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('excludes MANUAL Facturas Emitidas from NC matching (ADV-171)', async () => {
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada', 'tipoDeCambio'],
      // Factura Emitida with MANUAL — excluded from match targets
      ['2025-01-01', 'fact-emit-manual', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', 'MANUAL', '', '', ''],
      // NC Emitida that would match
      ['2025-01-15', 'nc-emit-1', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id', 'Facturas Emitidas', 'cuitReceptor', 'A:T', 'S');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('should skip factura with MANUAL matchConfidence as a match target (Fix 5 - ADV-131)', async () => {
    // Factura at row[16]='MANUAL' is locked — cannot be targeted by any NC
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Factura with MANUAL matchConfidence — must not be targeted
      ['2025-01-01', 'factura-manual', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', 'MANUAL', '', ''],
      // NC that would match (same cuit, same amount, later date)
      ['2025-01-15', 'nc-1', 'nc.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de credito s/ Factura N° 2-3160', '2025-01-15', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    // MANUAL factura excluded — no setValues calls
    expect(setValues).not.toHaveBeenCalled();
  });

  it('should update factura.pagada in memory even when NC write fails, preventing double-match (ADV-178)', async () => {
    // Two NCs with same CUIT and amount as the factura — second NC should NOT match same factura
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // Factura: unpaid, no match
      ['2025-01-01', 'factura-1', 'factura.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      // NC1: matches factura by CUIT and amount
      ['2025-01-15', 'nc-1', 'nc1.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', '', '2025-01-15', '0.95', 'NO', '', '', '', ''],
      // NC2: same CUIT and amount — would match factura-1 if it weren't already matched
      ['2025-01-20', 'nc-2', 'nc2.pdf', 'NC', '0002-00000002', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', '', '2025-01-20', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    // Factura write succeeds, NC1 write FAILS
    // If the bug is present, NC2 will try to match the same factura (calls 3 & 4)
    vi.mocked(setValues)
      .mockResolvedValueOnce({ ok: true, value: 0 })   // factura pagada=SI (success) for NC1
      .mockResolvedValueOnce({ ok: false, error: new Error('API Error') })  // NC1 pagada=SI (fail)
      .mockResolvedValueOnce({ ok: true, value: 0 })   // factura pagada=SI for NC2 (bug path)
      .mockResolvedValueOnce({ ok: true, value: 0 })   // NC2 pagada=SI (bug path)
    ;

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    // Only NC1's factura write should happen — NC2 should NOT match the same factura
    // because factura.pagada was updated in memory after the factura write
    // setValues called exactly 2 times: factura pagada=SI (success) + NC1 pagada=SI (fail)
    expect(setValues).toHaveBeenCalledTimes(2);
  });

  it('should not search for second factura after NC write failure (ADV-178)', async () => {
    // NC1 matches factura-1, but NC write fails. NC1 must NOT then try factura-2.
    const mockRows = [
      ['fechaEmision', 'fileId', 'fileName', 'tipo', 'nro', 'cuit', 'razon', 'neto', 'iva', 'total', 'moneda', 'concepto', 'processed', 'conf', 'review', 'matchedPago', 'matchConf', 'cuitMatch', 'pagada'],
      // factura-1: unpaid, same CUIT and amount as NC
      ['2025-01-01', 'factura-1', 'factura1.pdf', 'A', '0002-00003160', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-01', '0.95', 'NO', '', '', '', ''],
      // factura-2: unpaid, same CUIT and amount — would match NC if it kept searching
      ['2025-01-02', 'factura-2', 'factura2.pdf', 'A', '0002-00003161', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios', '2025-01-02', '0.95', 'NO', '', '', '', ''],
      // NC: matches both facturas by CUIT and amount
      ['2025-01-15', 'nc-1', 'nc1.pdf', 'NC', '0002-00000001', '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', '', '2025-01-15', '0.95', 'NO', '', '', '', ''],
    ];

    vi.mocked(getValues).mockResolvedValue({ ok: true, value: mockRows });

    // factura-1 write succeeds, NC write fails
    vi.mocked(setValues)
      .mockResolvedValueOnce({ ok: true, value: 0 })   // factura-1 pagada=SI (success)
      .mockResolvedValueOnce({ ok: false, error: new Error('API Error') })  // NC pagada=SI (fail)
      .mockResolvedValueOnce({ ok: true, value: 0 })   // factura-2 (should NOT be called)
      .mockResolvedValueOnce({ ok: true, value: 0 })   // NC (should NOT be called)
    ;

    const result = await matchNCsWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    // NC consumed its match with factura-1 — must NOT try factura-2
    expect(setValues).toHaveBeenCalledTimes(2);
  });
});
