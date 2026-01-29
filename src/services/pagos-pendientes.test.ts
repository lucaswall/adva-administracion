/**
 * Tests for Pagos Pendientes service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncPagosPendientes } from './pagos-pendientes.js';
import * as sheets from './sheets.js';

// Mock the sheets service
vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  clearSheetData: vi.fn(),
  appendRowsWithFormatting: vi.fn(),
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

    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({
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

    // Should clear Pagos Pendientes
    expect(sheets.clearSheetData).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes'
    );

    // Should append only unpaid facturas with correct columns
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A:J',
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

    // Should not clear or append
    expect(sheets.clearSheetData).not.toHaveBeenCalled();
    expect(sheets.appendRowsWithFormatting).not.toHaveBeenCalled();
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

    // Should clear but not append
    expect(sheets.clearSheetData).toHaveBeenCalled();
    expect(sheets.appendRowsWithFormatting).not.toHaveBeenCalled();
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
        ['header'],
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

  it('should handle errors when appending rows', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: [
        ['header'],
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
         'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
         '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ],
    });

    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({
      ok: false,
      error: new Error('Failed to append rows'),
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to append rows');
    }
  });

  it('should map columns correctly', async () => {
    const facturasData = [
      ['header'],
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

    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({
      ok: true,
      value: 10,
    });

    await syncPagosPendientes('egresos123', 'dashboard456');

    // Verify column mapping: fechaEmision, fileId, fileName, tipoComprobante,
    // nroFactura, cuitEmisor, razonSocialEmisor, importeTotal, moneda, concepto
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A:J',
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
});
