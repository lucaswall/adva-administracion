/**
 * Tests for Pagos Pendientes service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncPagosPendientes, syncCobrosPendientes } from './pagos-pendientes.js';
import * as sheets from './sheets.js';

/** Helper: build a CellDate object for assertions (ADV-290) */
function cd(value: string): { type: 'date'; value: string } {
  return { type: 'date', value };
}

// Mock the sheets service
vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  appendRowsWithLinks: vi.fn(),
  clearSheetData: vi.fn(),
  getSpreadsheetTimezone: vi.fn(),
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

const FACTURAS_RECIBIDAS_HEADERS = [
  'fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
  'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
  'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence',
  'hasCuitMatch', 'pagada',
];

// Facturas Emitidas header row (after pagada column added by worker-1)
const FACTURAS_EMITIDAS_HEADERS = [
  'fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura',
  'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva',
  'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence',
  'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch',
  'pagada', 'tipoDeCambio',
];

function fileLink(fileId: string, fileName: string) {
  return { text: fileName, url: `https://drive.google.com/file/d/${fileId}/view` };
}

function setupSheetsMocks() {
  vi.mocked(sheets.clearSheetData).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(sheets.appendRowsWithLinks).mockResolvedValue({ ok: true, value: 1 });
  vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
}

describe('syncPagosPendientes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSheetsMocks();
  });

  it('should sync unpaid facturas to Pagos Pendientes', async () => {
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ['2024-01-20', 'file456', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
       'EMPRESA UNO SA', '2000', '420', '2420', 'USD', 'Productos',
       '2024-01-21T10:00:00Z', '0.98', 'NO', 'pago123', 'HIGH', 'YES', 'SI'],
      ['2024-01-25', 'file789', 'Factura-003.pdf', 'A', '00001-00000003', '20111111119',
       'Juan Perez', '500', '105', '605', 'ARS', 'Consultoría',
       '2024-01-26T10:00:00Z', '0.92', 'YES', '', '', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(2);
    }

    expect(sheets.getValues).toHaveBeenCalledWith('egresos123', 'Facturas Recibidas!A:S');
    expect(sheets.clearSheetData).toHaveBeenCalledWith('dashboard456', 'Pagos Pendientes');
    expect(sheets.appendRowsWithLinks).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A:J',
      [
        [cd('2024-01-15'), 'file123', fileLink('file123', 'Factura-001.pdf'), 'A', '00001-00000001',
         '20123456786', 'TEST SA', '1210', 'ARS', 'Servicios'],
        [cd('2024-01-25'), 'file789', fileLink('file789', 'Factura-003.pdf'), 'A', '00001-00000003',
         '20111111119', 'Juan Perez', '605', 'ARS', 'Consultoría'],
      ],
      'America/Argentina/Buenos_Aires',
    );
  });

  it('should handle empty facturas recibidas', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: [['header1', 'header2']],
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }

    expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
  });

  it('should handle all facturas paid', async () => {
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-20', 'file456', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
       'EMPRESA UNO SA', '2000', '420', '2420', 'USD', 'Productos',
       '2024-01-21T10:00:00Z', '0.98', 'NO', 'pago123', 'HIGH', 'YES', 'SI'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }

    expect(sheets.clearSheetData).toHaveBeenCalledWith('dashboard456', 'Pagos Pendientes');
    expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
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
        FACTURAS_RECIBIDAS_HEADERS,
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

  it('should handle errors when writing values', async () => {
    vi.mocked(sheets.getValues).mockResolvedValue({
      ok: true,
      value: [
        FACTURAS_RECIBIDAS_HEADERS,
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
         'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
         '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ],
    });

    vi.mocked(sheets.appendRowsWithLinks).mockResolvedValue({
      ok: false,
      error: new Error('Failed to write values'),
    });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to write values');
    }
  });

  it('should map columns correctly', async () => {
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios de consultoría',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    await syncPagosPendientes('egresos123', 'dashboard456');

    expect(sheets.appendRowsWithLinks).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A:J',
      [
        [
          cd('2024-01-15'),
          'file123',
          fileLink('file123', 'Factura-001.pdf'),
          'A',
          '00001-00000001',
          '20123456786',
          'TEST SA',
          '1210',
          'ARS',
          'Servicios de consultoría',
        ],
      ],
      'America/Argentina/Buenos_Aires',
    );
  });

  it('should find columns by header name (bug #1)', async () => {
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    expect(sheets.appendRowsWithLinks).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A:J',
      expect.arrayContaining([
        expect.arrayContaining([cd('2024-01-15'), 'file123']),
      ]),
      'America/Argentina/Buenos_Aires',
    );
  });

  it('should handle reordered columns (bug #1)', async () => {
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'pagada',
       'cuitEmisor', 'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal',
       'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview',
       'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'],
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', 'NO',
       '20123456786', 'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }
  });

  it('should sort unpaid facturas by fechaEmision ascending (oldest first)', async () => {
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-25', 'file789', 'Factura-003.pdf', 'A', '00001-00000003', '20111111119',
       'PROVEEDOR C', '500', '105', '605', 'ARS', 'Third',
       '2024-01-26T10:00:00Z', '0.92', 'NO', '', '', 'NO', 'NO'],
      ['2024-01-10', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'PROVEEDOR A', '1000', '210', '1210', 'ARS', 'First',
       '2024-01-11T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ['2024-01-18', 'file456', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
       'PROVEEDOR B', '2000', '420', '2420', 'ARS', 'Second',
       '2024-01-19T10:00:00Z', '0.98', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(3);
    }

    expect(sheets.appendRowsWithLinks).toHaveBeenCalledWith(
      'dashboard456',
      'Pagos Pendientes!A:J',
      [
        [cd('2024-01-10'), 'file123', fileLink('file123', 'Factura-001.pdf'), 'A', '00001-00000001',
         '20123456786', 'PROVEEDOR A', '1210', 'ARS', 'First'],
        [cd('2024-01-18'), 'file456', fileLink('file456', 'Factura-002.pdf'), 'B', '00001-00000002',
         '27234567891', 'PROVEEDOR B', '2420', 'ARS', 'Second'],
        [cd('2024-01-25'), 'file789', fileLink('file789', 'Factura-003.pdf'), 'A', '00001-00000003',
         '20111111119', 'PROVEEDOR C', '605', 'ARS', 'Third'],
      ],
      'America/Argentina/Buenos_Aires',
    );
  });

  it('should return error when required column missing (bug #1)', async () => {
    const facturasData = [
      ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitEmisor',
       'razonSocialEmisor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto'],
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('pagada');
    }
  });

  it('should sort serial number fechaEmision values correctly', async () => {
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      [45659, 'file3', 'Factura-003.pdf', 'A', '00001-00000003', '20111111119',
       'PROVEEDOR C', '500', '105', '605', 'ARS', 'Third',
       '2025-01-03T10:00:00Z', '0.92', 'NO', '', '', 'NO', 'NO'],
      [45598, 'file1', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'PROVEEDOR A', '1000', '210', '1210', 'ARS', 'First',
       '2024-11-03T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      [45628, 'file2', 'Factura-002.pdf', 'B', '00001-00000002', '27234567891',
       'PROVEEDOR B', '2000', '420', '2420', 'ARS', 'Second',
       '2024-12-03T10:00:00Z', '0.98', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    const writtenRows = writeCall[2];
    expect(writtenRows[0][0]).toEqual(cd('2024-11-02'));
    expect(writtenRows[1][0]).toEqual(cd('2024-12-02'));
    expect(writtenRows[2][0]).toEqual(cd('2025-01-02'));
  });

  it('should convert serial number fechaEmision to date string before writing', async () => {
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      [45993, 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2025-12-02T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    const writtenRow = writeCall[2][0];
    expect(writtenRow[0]).toEqual(cd('2025-12-02'));
  });

  it('should skip empty rows in source (blank-row leak fix)', async () => {
    // Defensive guard: orphan empty rows in Facturas Recibidas must not
    // propagate into Pagos Pendientes as blank dashboard rows
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      // Empty/orphan row — fileId and fechaEmision blank
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      // Row with fileId but no fechaEmision — also skipped
      ['', 'fileX', 'X.pdf', 'A', 'XXX', '', '', '', '', '', 'ARS', '', '', '', '', '', '', '', ''],
      // Row with fechaEmision but no fileId — also skipped
      ['2024-01-20', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1); // only the one valid row
    }

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    expect(writeCall[2]).toHaveLength(1);
    expect(writeCall[2][0][1]).toBe('file123');
  });

  it('should write fileName as a hyperlink object (link injection fix)', async () => {
    const facturasData = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'fileABC', 'Factura-Test.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    const writtenRow = writeCall[2][0];
    expect(writtenRow[2]).toEqual({
      text: 'Factura-Test.pdf',
      url: 'https://drive.google.com/file/d/fileABC/view',
    });
  });

  describe('ADV-13: Data loss prevention (pagos)', () => {
    it('should clear old data before writing new data', async () => {
      const operationOrder: string[] = [];

      const facturasData = [
        FACTURAS_RECIBIDAS_HEADERS,
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
         'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
         '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

      vi.mocked(sheets.clearSheetData).mockImplementation(async () => {
        operationOrder.push('clear');
        return { ok: true, value: undefined };
      });

      vi.mocked(sheets.appendRowsWithLinks).mockImplementation(async () => {
        operationOrder.push('append');
        return { ok: true, value: 10 };
      });

      await syncPagosPendientes('egresos123', 'dashboard456');

      expect(operationOrder).toEqual(['clear', 'append']);
    });

    it('should return error if write fails after clear', async () => {
      const facturasData = [
        FACTURAS_RECIBIDAS_HEADERS,
        ['2024-01-15', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
         'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
         '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ];

      vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
      vi.mocked(sheets.appendRowsWithLinks).mockResolvedValue({
        ok: false,
        error: new Error('Network error during write'),
      });

      const result = await syncPagosPendientes('egresos123', 'dashboard456');

      expect(result.ok).toBe(false);
      expect(sheets.clearSheetData).toHaveBeenCalled();
      expect(sheets.appendRowsWithLinks).toHaveBeenCalled();
    });
  });
});

describe('syncCobrosPendientes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSheetsMocks();
  });

  it('should sync unpaid facturas emitidas to Cobros Pendientes', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      ['2024-01-20', 'file456', 'Factura-002.pdf', 'FA', '00001-00000002', '27234567891',
       'EMPRESA UNO SA', '2000', '420', '2420', 'USD', 'Productos',
       '2024-01-21T10:00:00Z', '0.98', 'NO', 'pago123', 'HIGH', 'YES', 'SI', ''],
      ['2024-01-25', 'file789', 'Factura-003.pdf', 'FA', '00001-00000003', '20111111119',
       'Juan Perez', '500', '105', '605', 'ARS', 'Consultoría',
       '2024-01-26T10:00:00Z', '0.92', 'YES', '', '', 'NO', '', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(2);
    }

    expect(sheets.getValues).toHaveBeenCalledWith('ingresos123', 'Facturas Emitidas!A:T');
    expect(sheets.clearSheetData).toHaveBeenCalledWith('dashboard456', 'Cobros Pendientes');
    expect(sheets.appendRowsWithLinks).toHaveBeenCalledWith(
      'dashboard456',
      'Cobros Pendientes!A:J',
      [
        [cd('2024-01-15'), 'file123', fileLink('file123', 'Factura-001.pdf'), 'FA', '00001-00000001',
         '20123456786', 'TEST SA', '1210', 'ARS', 'Servicios'],
        [cd('2024-01-25'), 'file789', fileLink('file789', 'Factura-003.pdf'), 'FA', '00001-00000003',
         '20111111119', 'Juan Perez', '605', 'ARS', 'Consultoría'],
      ],
      'America/Argentina/Buenos_Aires',
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

    await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(sheets.appendRowsWithLinks).toHaveBeenCalledWith(
      'dashboard456',
      'Cobros Pendientes!A:J',
      [
        [
          cd('2024-01-15'),
          'file123',
          fileLink('file123', 'Factura-001.pdf'),
          'FA',
          '00001-00000001',
          '20123456786',
          'TEST SA',
          '1210',
          'ARS',
          'Servicios',
        ],
      ],
      'America/Argentina/Buenos_Aires',
    );
  });

  it('should exclude facturas with pagada=SI', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-20', 'file456', 'Factura-002.pdf', 'FA', '00001-00000002', '27234567891',
       'EMPRESA UNO SA', '2000', '420', '2420', 'USD', 'Productos',
       '2024-01-21T10:00:00Z', '0.98', 'NO', 'pago123', 'HIGH', 'YES', 'SI', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }

    expect(sheets.clearSheetData).toHaveBeenCalledWith('dashboard456', 'Cobros Pendientes');
    expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
  });

  it('should exclude NC and ND tipoComprobante', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-10', 'file001', 'Factura-FA.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-11T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      ['2024-01-12', 'file002', 'NC-A.pdf', 'NC A', '00001-00000002', '20123456786',
       'TEST SA', '-100', '-21', '-121', 'ARS', 'Nota crédito',
       '2024-01-13T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      ['2024-01-13', 'file003', 'NC-B.pdf', 'NC B', '00001-00000003', '20123456786',
       'TEST SA', '-200', '-42', '-242', 'ARS', 'Nota crédito',
       '2024-01-14T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      ['2024-01-14', 'file004', 'ND-A.pdf', 'ND A', '00001-00000004', '20123456786',
       'TEST SA', '50', '10.5', '60.5', 'ARS', 'Nota débito',
       '2024-01-15T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      ['2024-01-15', 'file005', 'Factura-FB.pdf', 'FB', '00001-00000005', '27234567891',
       'EMPRESA UNO SA', '500', '0', '500', 'ARS', 'Honorarios',
       '2024-01-16T10:00:00Z', '0.97', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(2);
    }

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    const writtenRows = writeCall[2];
    expect(writtenRows).toHaveLength(2);
    expect(writtenRows[0][3]).toBe('FA');
    expect(writtenRows[1][3]).toBe('FB');
  });

  it('should sort unpaid facturas emitidas by fechaEmision ascending', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-25', 'file789', 'Factura-003.pdf', 'FA', '00001-00000003', '20111111119',
       'CLIENTE C', '500', '105', '605', 'ARS', 'Third',
       '2024-01-26T10:00:00Z', '0.92', 'NO', '', '', 'NO', 'NO', ''],
      ['2024-01-10', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'CLIENTE A', '1000', '210', '1210', 'ARS', 'First',
       '2024-01-11T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      ['2024-01-18', 'file456', 'Factura-002.pdf', 'FB', '00001-00000002', '27234567891',
       'CLIENTE B', '2000', '420', '2420', 'ARS', 'Second',
       '2024-01-19T10:00:00Z', '0.98', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(3);
    }

    expect(sheets.appendRowsWithLinks).toHaveBeenCalledWith(
      'dashboard456',
      'Cobros Pendientes!A:J',
      [
        [cd('2024-01-10'), 'file123', fileLink('file123', 'Factura-001.pdf'), 'FA', '00001-00000001',
         '20123456786', 'CLIENTE A', '1210', 'ARS', 'First'],
        [cd('2024-01-18'), 'file456', fileLink('file456', 'Factura-002.pdf'), 'FB', '00001-00000002',
         '27234567891', 'CLIENTE B', '2420', 'ARS', 'Second'],
        [cd('2024-01-25'), 'file789', fileLink('file789', 'Factura-003.pdf'), 'FA', '00001-00000003',
         '20111111119', 'CLIENTE C', '605', 'ARS', 'Third'],
      ],
      'America/Argentina/Buenos_Aires',
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
    expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
  });

  it('should return error when pagada column is missing', async () => {
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

  it('should handle errors when writing values', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });
    vi.mocked(sheets.appendRowsWithLinks).mockResolvedValue({
      ok: false,
      error: new Error('Failed to write values'),
    });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to write values');
    }
  });

  it('should skip empty rows in source (blank-row leak fix)', async () => {
    // Defensive guard: orphan empty rows in Facturas Emitidas must not
    // propagate into Cobros Pendientes as blank dashboard rows
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-15', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
      // Empty/orphan row
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      // Row with fileId but no fechaEmision
      ['', 'fileX', 'X.pdf', 'FA', 'XXX', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    expect(writeCall[2]).toHaveLength(1);
    expect(writeCall[2][0][1]).toBe('file123');
  });

  it('should write fileName as a hyperlink object (link injection fix)', async () => {
    const facturasData = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2024-01-15', 'fileXYZ', 'Cobro-Test.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
    ];

    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: facturasData });

    const result = await syncCobrosPendientes('ingresos123', 'dashboard456');

    expect(result.ok).toBe(true);

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    const writtenRow = writeCall[2][0];
    expect(writtenRow[2]).toEqual({
      text: 'Cobro-Test.pdf',
      url: 'https://drive.google.com/file/d/fileXYZ/view',
    });
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

      vi.mocked(sheets.appendRowsWithLinks).mockImplementation(async () => {
        operationOrder.push('append');
        return { ok: true, value: 10 };
      });

      await syncCobrosPendientes('ingresos123', 'dashboard456');

      expect(operationOrder).toEqual(['clear', 'append']);
    });
  });
});

// ─── ADV-326: Exclude NC/ND from Pagos Pendientes ────────────────────────────

describe('syncPagosPendientes — ADV-326: NC/ND exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSheetsMocks();
  });

  it('NC A unpaid row does not appear in Pagos Pendientes', async () => {
    const data = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'file-nc', 'NC-001.pdf', 'NC A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de Crédito',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
      ['2024-01-20', 'file-fa', 'Factura-001.pdf', 'A', '00001-00000002', '20123456786',
       'TEST SA', '2000', '420', '2420', 'ARS', 'Servicios',
       '2024-01-21T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: data });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    expect(writeCall[2]).toHaveLength(1);
    expect(writeCall[2][0][1]).toBe('file-fa');
  });

  it('ND B unpaid row does not appear in Pagos Pendientes', async () => {
    const data = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'file-nd', 'ND-001.pdf', 'ND B', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Nota de Débito',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: data });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
    expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
  });

  it('regular A unpaid row still appears', async () => {
    const data = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'file-a', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: data });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
  });

  it('empty tipoComprobante cell → row still included', async () => {
    const data = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2024-01-15', 'file-empty', 'Factura-001.pdf', '', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2024-01-16T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: data });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
  });
});

// ─── ADV-290: fechaEmision written as CellDate ────────────────────────────────

describe('syncPagosPendientes — ADV-290: fechaEmision as CellDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSheetsMocks();
  });

  it('row[0] equals CellDate form of parsed string date', async () => {
    const data = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['2025-12-02', 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2025-12-02T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: data });

    await syncPagosPendientes('egresos123', 'dashboard456');

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    expect(writeCall[2][0][0]).toEqual(cd('2025-12-02'));
  });

  it('row[0] equals CellDate form of serial number fechaEmision', async () => {
    const data = [
      FACTURAS_RECIBIDAS_HEADERS,
      [45993, 'file123', 'Factura-001.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2025-12-02T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: data });

    await syncPagosPendientes('egresos123', 'dashboard456');

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    expect(writeCall[2][0][0]).toEqual(cd('2025-12-02'));
  });

  it('row whose fechaEmision normalizes to empty is filtered out (never a malformed CellDate)', async () => {
    // Rows with empty fechaEmision are filtered out entirely — no '' CellDate is emitted.
    const data = [
      FACTURAS_RECIBIDAS_HEADERS,
      ['', 'file-blank', 'Factura.pdf', 'A', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2025-12-02T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO'],
    ];
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: data });

    const result = await syncPagosPendientes('egresos123', 'dashboard456');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
    expect(sheets.appendRowsWithLinks).not.toHaveBeenCalled();
  });
});

describe('syncCobrosPendientes — ADV-290: fechaEmision as CellDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSheetsMocks();
  });

  it('row[0] equals CellDate form of parsed date (cobros dashboard)', async () => {
    const data = [
      FACTURAS_EMITIDAS_HEADERS,
      ['2025-12-02', 'file123', 'Factura-001.pdf', 'FA', '00001-00000001', '20123456786',
       'TEST SA', '1000', '210', '1210', 'ARS', 'Servicios',
       '2025-12-02T10:00:00Z', '0.95', 'NO', '', '', 'NO', 'NO', ''],
    ];
    vi.mocked(sheets.getValues).mockResolvedValue({ ok: true, value: data });

    await syncCobrosPendientes('ingresos123', 'dashboard456');

    const writeCall = vi.mocked(sheets.appendRowsWithLinks).mock.calls[0];
    expect(writeCall[2][0][0]).toEqual(cd('2025-12-02'));
  });
});
