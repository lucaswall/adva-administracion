/**
 * Tests for Pagos Pendientes service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncPagosPendientes } from './pagos-pendientes.js';
import * as sheets from './sheets.js';

// Mock the sheets service
vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  setValues: vi.fn(),
  clearSheetData: vi.fn(),
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Mock correlation
vi.mock('../utils/correlation.js', () => ({
  getCorrelationId: vi.fn(() => 'test-correlation-id'),
}));

describe('syncPagosPendientes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should sync unpaid facturas to Pagos Pendientes', async () => {
    // Mock facturas recibidas data
    const facturasData = [
      // Header row
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
       'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
       'hasCuitMatch', 'pagada'],
      // Unpaid factura (pagada = NO)
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      // Paid factura (pagada = SI)
      ['2024-01-20', 'file456', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
       'EMPRESA UNO SA', '2000', '420', '2420', 'USD', 'Productos',
       '2024-01-21T10:00:00Z', '0.98', 'NO', 'pago123', 'HIGH', 'YES', 'SI'],
      // Unpaid factura (pagada = empty)
      ['2024-01-25', 'file789', 'Factura-003.pdf', 'A', '00001-00000003', '20111111119',
       'Juan Perez', '500', '105', '605', 'ARS', 'Consultoría',
       '2024-01-26T10:00:00Z', '0.92', 'YES', '', '', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: facturasData,
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    vi.mocked(sheets.setValues).mockResolvedValue({
      ok: true,
      value: 20, // 2 rows * 10 columns
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(2); // 2 unpaid facturas
    }

    // Should read facturas recibidas
    expect(sheets.getValues).toHaveBeenCalledWith(
      'egresos123',
      'Facturas Recibidas!A:S'
    );

    // Should clear old data first
    expect(sheets.clearSheetData).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes'
    );

    // Should write new values
    expect(sheets.setValues).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A2:J',
      [
        // First unpaid factura
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
         'TEST SA', '1210', 'ARS', 'Servicios'],
        // Third unpaid factura
        ['2024-01-25', 'file789', 'Factura-003.pdf', 'A', '00001-00000003', '20111111119',
         'Juan Perez', '605', 'ARS', 'Consultoría'],
      ]
    );
  });

  it('should handle empty facturas recibidas', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: [['header1', 'header2']], // Only header row
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }

    // Should not set values
    expect(sheets.setValues).not.toHaveBeenCalled();
  });

  it('should handle all facturas paid', async () => {
    const facturasData = [
      // Header row
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
       'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
       'hasCuitMatch', 'pagada'],
      // Paid factura
      ['2024-01-20', 'file456', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
       'EMPRESA UNO SA', '2000', '420', '2420', 'USD', 'Productos',
       '2024-01-21T10:00:00Z', '0.98', 'NO', 'pago123', 'HIGH', 'YES', 'SI'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: facturasData,
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }

    // Should clear the sheet (no data to write)
    expect(sheets.clearSheetData).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes'
    );

    // Should not write any values when no unpaid facturas
    expect(sheets.setValues).not.toHaveBeenCalled();
  });

  it('should handle errors when reading facturas', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: false,
      error: new Error('Failed to read sheet'),
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to read sheet');
    }
  });

  it('should handle errors when clearing sheet', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
         'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
         'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
         'hasCuitMatch', 'pagada'],
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
         'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
         '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ],
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: false,
      error: new Error('Failed to clear sheet'),
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to clear sheet');
    }
  });

  it('should handle errors when setting values', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
         'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
         'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
         'hasCuitMatch', 'pagada'],
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
         'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
         '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ],
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    vi.mocked(sheets.setValues).mockResolvedValue({
      ok: false,
      error: new Error('Failed to set values'),
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to set values');
    }
  });

  it('should map columns correctly', async () => {
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
       'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
       'hasCuitMatch', 'pagada'],
      // Full row with all fields populated
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios de consultoría',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: facturasData,
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    vi.mocked(sheets.setValues).mockResolvedValue({
      ok: true,
      value: 10,
    });

    await syncPagosPendientes('egresos123', 'dashboard456');

    // Verify column mapping: fechaEmision, fileId, fileName, tipoComprobante,
    // nroFactura, cuitEmisor, razonSocialEmisor, importeTotal, moneda, concepto
    expect(sheets.setValues).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A2:J',
      [
        [
          '2024-01-15',              // fechaEmision (A)
          'file123',                 // fileId (B)
          'Factura-001.pdf',         // fileName (C)
          'A',                       // tipoComprobante (D)
          '00001-00000001',          // nroFactura (E)
          '20123456786',             // cuitEmisor (F)
          'TEST SA',                 // razonSocialEmisor (G)
          '1210',                    // importeTotal (J) - not importeNeto
          'ARS',                     // moneda (K)
          'Servicios de consultoría' // concepto (L)
        ],
      ]
    );
  });

  it('should warn but continue if setValues fails after clear (bug #2)', async () => {
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
       'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
       'hasCuitMatch', 'pagada'],
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: facturasData,
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    // Mock setValues to fail
    vi.mocked(sheets.setValues).mockResolvedValue({
      ok: false,
      error: new Error('Failed to set values'),
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    // Should return error
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to set values');
    }

    // Note: This is acceptable because the source data (Control de Egresos) is intact
    // The Pagos Pendientes sheet can be regenerated by re-running the sync
  });

  it('should find columns by header name (bug #1)', async () => {
    // Use actual header names from SPREADSHEET_HEADERS
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
       'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
       'hasCuitMatch', 'pagada'],
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: facturasData,
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    vi.mocked(sheets.setValues).mockResolvedValue({
      ok: true,
      value: 10,
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    // Should correctly find 'pagada' column at index 18
    expect(sheets.setValues).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A2:J',
      expect.arrayContaining([
        expect.arrayContaining(['2024-01-15', 'file123']),
      ])
    );
  });

  it('should handle reordered columns (bug #1)', async () => {
    // Put 'pagada' column at different position (index 5 instead of 18)
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'pagada',
       'cuitEmisor', 'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal',
       'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview',
       'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', 'NO',
       '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: facturasData,
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    vi.mocked(sheets.setValues).mockResolvedValue({
      ok: true,
      value: 10,
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1); // Should still find the unpaid factura
    }
  });

  it('should return error when required column missing (bug #1)', async () => {
    // Header row missing 'pagada' column
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto'],
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: facturasData,
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('pagada');
    }
  });
});
