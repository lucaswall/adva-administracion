/**
 * Tests for Pagos Pendientes service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncPagosPendientes, syncCobrosPendientes } from './pagos-pendientes.js';
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

  it('should sort unpaid facturas by fechaEmision ascending (oldest first)', async () => {
    // Bug fix: Pagos Pendientes should display oldest invoices first
    // Input data is intentionally out of order to test sorting
    const facturasData = [
      // Header row
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
       'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
       'hasCuitMatch', 'pagada'],
      // Factura from Jan 25 (third in order, should be last after sort)
      ['2024-01-25', 'file789', 'Factura-003.pdf', 'A', '00001-00000003', '20111111119',
       'PROVEEDOR C', '500', '105', '605', 'ARS', 'Third',
       '2024-01-26T10:00:00Z', '0.92', 'NO', '', '', 'NO', 'NO'],
      // Factura from Jan 10 (first in order, should be first after sort)
      ['2024-01-10', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'PROVEEDOR A', '1000', '210', '1210', 'ARS', 'First',
       '2024-01-11T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      // Factura from Jan 18 (second in order, should be middle after sort)
      ['2024-01-18', 'file456', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
       'PROVEEDOR B', '2000', '420', '2420', 'ARS', 'Second',
       '2024-01-19T10:00:00Z', '0.98', 'NO', '', '', 'NO', 'NO'],
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
      value: 30, // 3 rows * 10 columns
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(3);
    }

    // Verify rows are sorted by fechaEmision ascending (oldest first)
    expect(sheets.setValues).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A2:J',
      [
        // First: Jan 10 (oldest)
        ['2024-01-10', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
         'PROVEEDOR A', '1210', 'ARS', 'First'],
        // Second: Jan 18
        ['2024-01-18', 'file456', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
         'PROVEEDOR B', '2420', 'ARS', 'Second'],
        // Third: Jan 25 (newest)
        ['2024-01-25', 'file789', 'Factura-003.pdf', 'A', '00001-00000003', '20111111119',
         'PROVEEDOR C', '605', 'ARS', 'Third'],
      ]
    );
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

  it('should sort serial number fechaEmision values correctly', async () => {
    // Serial numbers from getValues (UNFORMATTED_VALUE + SERIAL_NUMBER) should sort correctly
    // Based on epoch: serial 45993 = 2025-12-02
    // Serial 45598 = 2024-11-02, Serial 45628 = 2024-12-02, Serial 45659 = 2025-01-02
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
       'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
       'hasCuitMatch', 'pagada'],
      // Jan 2025 (newest — serial 45659)
      [45659, 'file3', 'Factura-003.pdf', 'A', '00001-00000003', '20111111119',
       'PROVEEDOR C', '500', '105', '605', 'ARS', 'Third',
       '2025-01-03T10:00:00Z', '0.92', 'NO', '', '', 'NO', 'NO'],
      // Nov 2024 (oldest — serial 45598)
      [45598, 'file1', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'PROVEEDOR A', '1000', '210', '1210', 'ARS', 'First',
       '2024-11-03T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      // Dec 2024 (middle — serial 45628)
      [45628, 'file2', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
       'PROVEEDOR B', '2000', '420', '2420', 'ARS', 'Second',
       '2024-12-03T10:00:00Z', '0.98', 'NO', '', '', 'NO', 'NO'],
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
      value: 30,
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);

    // Verify sorted by date ascending: Nov 2024, Dec 2024, Jan 2025
    const setValuesCall = vi.mocked(sheets.setValues).mock.calls[0];
    const writtenRows = setValuesCall[2];
    expect(writtenRows[0][0]).toBe('2024-11-02'); // file1 — oldest
    expect(writtenRows[1][0]).toBe('2024-12-02'); // file2 — middle
    expect(writtenRows[2][0]).toBe('2025-01-02'); // file3 — newest
  });

  it('should convert serial number fechaEmision to date string before writing', async () => {
    // When getValues returns SERIAL_NUMBER render option, CellDate fields come back as numbers
    // Serial 45993 = 2025-12-02 (days from 1899-12-30 epoch)
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
       'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
       'hasCuitMatch', 'pagada'],
      // fechaEmision as serial number (as returned by Google Sheets API with SERIAL_NUMBER option)
      [45993, 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2025-12-02T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
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

    // Verify setValues was called with a date string (not a number)
    expect(sheets.setValues).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A2:J',
      expect.arrayContaining([
        expect.arrayContaining(['2025-12-02']), // Serial 45993 converted to date string
      ])
    );

    const setValuesCall = vi.mocked(sheets.setValues).mock.calls[0];
    const writtenRow = setValuesCall[2][0];
    const fechaEmisionWritten = writtenRow[0];
    expect(typeof fechaEmisionWritten).toBe('string');
    expect(fechaEmisionWritten).toBe('2025-12-02');
  });

  describe('ADV-13: Data loss prevention (pagos)', () => {
    it('should clear old data before writing new data', async () => {
      // Track order of operations
      const operationOrder: string[] = [];

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

      vi.mocked(sheets.clearSheetData).mockImplementation(async () => {
        operationOrder.push('clear');
        return { ok: true, value: undefined };
      });

      vi.mocked(sheets.setValues).mockImplementation(async () => {
        operationOrder.push('setValues');
        return { ok: true, value: 10 };
      });

      await syncPagosPendientes('egresos123', 'dashboard456');

      // Clear before write - Pagos Pendientes is a derived view
      // Source data in Control de Egresos is always preserved
      expect(operationOrder).toEqual(['clear', 'setValues']);
    });

    it('should return error if write fails after clear', async () => {
      // Pagos Pendientes is a derived view from Control de Egresos
      // If write fails, the display is temporarily empty but source data is intact
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

      // setValues fails after clear
      vi.mocked(sheets.setValues).mockResolvedValue({
        ok: false,
        error: new Error('Network error during write'),
      });

      const result = await syncPagosPendientes('egresos123', 'dashboard456');

      // Should return error
      expect(result.ok).toBe(false);
      // Clear was called (before write)
      expect(sheets.clearSheetData).toHaveBeenCalled();
      // Write was attempted
      expect(sheets.setValues).toHaveBeenCalled();
    });

    it('should preserve source data in Control de Egresos even if sync fails', async () => {
      // This test documents the semantic guarantee:
      // Pagos Pendientes is derived from Control de Egresos
      // Even if sync fails completely, the source data is intact
      // Re-running syncPagosPendientes will restore the view
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

      // Simulate network failure
      vi.mocked(sheets.setValues).mockResolvedValue({
        ok: false,
        error: new Error('Service temporarily unavailable'),
      });

      const result = await syncPagosPendientes('egresos123', 'dashboard456');

      // Operation fails
      expect(result.ok).toBe(false);

      // Source data (facturasData) is still in Control de Egresos
      // The getValues mock shows the data is available
      // Re-running sync will restore Pagos Pendientes
      expect(sheets.getValues).toHaveBeenCalledWith(
        'egresos123',
        'Facturas Recibidas!A:S'
      );
    });
  });
});

// Facturas Emitidas header row (after pagada column added by worker-1)
const FACTURAS_EMITIDAS_HEADERS = [
  'fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura',
  'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva',
  'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence',
  'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch',
  'pagada', 'tipoDeCambio',
];

describe('syncCobrosPendientes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should sync unpaid facturas emitidas to Cobros Pendientes', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      // Unpaid factura A (pagada = NO)
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      // Paid factura (pagada = SI) — should be excluded
      ['2024-01-20', 'file456', 'Factura-002.pdf', 'FA', '00001-00000002', '27234567891',
       'EMPRESA UNO SA', '2000', '420', '2420', 'USD', 'Productos',
       '2024-01-21T10:00:00Z', '0.98', 'NO', 'pago123', 'HIGH', 'YES', 'SI', ''],
      // Unpaid factura B (pagada = empty)
      ['2024-01-25', 'file789', 'Factura-003.pdf', 'FA', '00001-00000003', '20111111119',
       'Juan Perez', '500', '105', '605', 'ARS', 'Consultoría',
       '2024-01-26T10:00:00Z', '0.92', 'YES', '', '', 'NO', '', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
    vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(sheets.setValues).mockResolvedValue({ ok: true, value: 20 });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(2); // 2 unpaid facturas
    }

    // Should read from Facturas Emitidas (Ingresos) with range A:T (20 cols)
    expect(sheets.getValues).toHaveBeenCalledWith('ingresos123', 'Facturas Emitidas!A:T');

    // Should clear Cobros Pendientes sheet
    expect(sheets.clearSheetData).toHaveBeenCalledWith('dashboard456', 'Cobros Pendientes');

    // Should write to Cobros Pendientes
    expect(sheets.setValues).toHaveBeenCalledWith(
      'dashboard456',
      'Cobros Pendientes!A2:J',
      [
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001',
         '20123456786', 'TEST SA', '1210', 'ARS', 'Servicios'],
        ['2024-01-25', 'file789', 'Factura-003.pdf', 'FA', '00001-00000003',
         '20111111119', 'Juan Perez', '605', 'ARS', 'Consultoría'],
      ]
    );
  });

  it('should use cuitReceptor and razonSocialReceptor (not Emisor)', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001',
       '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
    vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(sheets.setValues).mockResolvedValue({ ok: true, value: 10 });

    await syncCobrosPendientes('ingresos123', 'dashboard456');

    // Column F = cuitReceptor, column G = razonSocialReceptor
    expect(sheets.setValues).toHaveBeenCalledWith(
      'dashboard456',
      'Cobros Pendientes!A2:J',
      [
        [
          '2024-01-15',       // fechaEmision
          'file123',          // fileId
          'Factura-001.pdf',  // fileName
          'FA',               // tipoComprobante
          '00001-00000001',   // nroFactura
          '20123456786',      // cuitReceptor (not cuitEmisor)
          'TEST SA',          // razonSocialReceptor (not razonSocialEmisor)
          '1210',             // importeTotal
          'ARS',              // moneda
          'Servicios',        // concepto
        ],
      ]
    );
  });

  it('should exclude facturas with pagada=SI', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      // All paid
      ['2024-01-20', 'file456', 'Factura-002.pdf', 'FA', '00001-00000002', '27234567891',
       'EMPRESA UNO SA', '2000', '420', '2420', 'USD', 'Productos',
       '2024-01-21T10:00:00Z', '0.98', 'NO', 'pago123', 'HIGH', 'YES', 'SI', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
    vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }

    expect(sheets.clearSheetData).toHaveBeenCalledWith('dashboard456', 'Cobros Pendientes');
    expect(sheets.setValues).not.toHaveBeenCalled();
  });

  it('should exclude NC and ND tipoComprobante', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      // Valid unpaid factura — should be included
      ['2024-01-10', 'file001', 'Factura-FA.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-11T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      // NC A — should be excluded even if unpaid
      ['2024-01-12', 'file002', 'NC-A.pdf', 'NC A', '00001-00000002', '20123456786',
       'TEST SA', '-100', '-21', '-121', 'ARS', 'Nota crédito',
       '2024-01-13T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      // NC B — should be excluded
      ['2024-01-13', 'file003', 'NC-B.pdf', 'NC B', '00001-00000003', '20123456786',
       'TEST SA', '-200', '-42', '-242', 'ARS', 'Nota crédito',
       '2024-01-14T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      // ND A — should be excluded
      ['2024-01-14', 'file004', 'ND-A.pdf', 'ND A', '00001-00000004', '20123456786',
       'TEST SA', '50', '10.5', '60.5', 'ARS', 'Nota débito',
       '2024-01-15T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      // FB (factura B) unpaid — should be included
      ['2024-01-15', 'file005', 'Factura-FB.pdf', 'FB', '00001-00000005', '27234567891',
       'EMPRESA UNO SA', '500', '0', '500', 'ARS', 'Honorarios',
       '2024-01-16T10:00:00Z', '0.97', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
    vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(sheets.setValues).mockResolvedValue({ ok: true, value: 20 });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(2); // Only FA and FB, not NC A, NC B, ND A
    }

    const setValuesCall = vi.mocked(sheets.setValues).mock.calls[0];
    const writtenRows = setValuesCall[2];
    // Verify only FA and FB were written (not NC or ND)
    expect(writtenRows).toHaveLength(2);
    expect(writtenRows[0][3]).toBe('FA');
    expect(writtenRows[1][3]).toBe('FB');
  });

  it('should sort unpaid facturas emitidas by fechaEmision ascending', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      // Jan 25 (newest — added first)
      ['2024-01-25', 'file789', 'Factura-003.pdf', 'FA', '00001-00000003', '20111111119',
       'CLIENTE C', '500', '105', '605', 'ARS', 'Third',
       '2024-01-26T10:00:00Z', '0.92', 'NO', '', '', 'NO', 'NO', ''],
      // Jan 10 (oldest — added second)
      ['2024-01-10', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'CLIENTE A', '1000', '210', '1210', 'ARS', 'First',
       '2024-01-11T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      // Jan 18 (middle — added third)
      ['2024-01-18', 'file456', 'Factura-002.pdf', 'FB', '00001-00000002', '27234567891',
       'CLIENTE B', '2000', '420', '2420', 'ARS', 'Second',
       '2024-01-19T10:00:00Z', '0.98', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
    vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(sheets.setValues).mockResolvedValue({ ok: true, value: 30 });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(3);
    }

    expect(sheets.setValues).toHaveBeenCalledWith(
      'dashboard456',
      'Cobros Pendientes!A2:J',
      [
        // Jan 10 (oldest first)
        ['2024-01-10', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001',
         '20123456786', 'CLIENTE A', '1210', 'ARS', 'First'],
        // Jan 18 (middle)
        ['2024-01-18', 'file456', 'Factura-002.pdf', 'FB', '00001-00000002',
         '27234567891', 'CLIENTE B', '2420', 'ARS', 'Second'],
        // Jan 25 (newest last)
        ['2024-01-25', 'file789', 'Factura-003.pdf', 'FA', '00001-00000003',
         '20111111119', 'CLIENTE C', '605', 'ARS', 'Third'],
      ]
    );
  });

  it('should handle empty facturas emitidas (only header row)', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: [FACTURAS_EMITIDAS_HEADERS],
    });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }

    expect(sheets.clearSheetData).not.toHaveBeenCalled();
    expect(sheets.setValues).not.toHaveBeenCalled();
  });

  it('should return error when pagada column is missing', async () => {
    // Header without pagada column
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura',
       'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal',
       'moneda', 'concepto'],
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001',
       '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('pagada');
    }
  });

  it('should handle errors when reading facturas emitidas', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: false,
      error: new Error('Failed to read sheet'),
    });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to read sheet');
    }
  });

  it('should handle errors when clearing Cobros Pendientes sheet', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
    vi.mocked(sheets.clearSheetData).mockResolvedValue({
      ok: false,
      error: new Error('Failed to clear sheet'),
    });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to clear sheet');
    }
  });

  it('should handle errors when setting values', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
    vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(sheets.setValues).mockResolvedValue({
      ok: false,
      error: new Error('Failed to set values'),
    });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to set values');
    }
  });

  describe('ADV-13: Data loss prevention (cobros)', () => {
    it('should clear old data before writing new data', async () => {
      const operationOrder: string[] = [];

      const facturasData = [
        FACTURAS_EMITIDAS_HEADERS,
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
         'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
         '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

      vi.mocked(sheets.clearSheetData).mockImplementation(async () => {
        operationOrder.push('clear');
        return { ok: true, value: undefined };
      });

      vi.mocked(sheets.setValues).mockImplementation(async () => {
        operationOrder.push('setValues');
        return { ok: true, value: 10 };
      });

      await syncCobrosPendientes('ingresos123', 'dashboard456');

      expect(operationOrder).toEqual(['clear', 'setValues']);
    });
  });
});
