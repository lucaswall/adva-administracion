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
});
