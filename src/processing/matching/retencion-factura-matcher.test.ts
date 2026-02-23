/**
 * Tests for Retencion-Factura matcher
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchRetencionesWithFacturas } from './retencion-factura-matcher.js';

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

/**
 * Helper: build a Retenciones Recibidas row (A:O, indices 0-14)
 * 0: fechaEmision, 1: fileId, 2: fileName, 3: nroCertificado,
 * 4: cuitAgenteRetencion, 5: razonSocialAgenteRetencion,
 * 6: impuesto, 7: regimen, 8: montoComprobante, 9: montoRetencion,
 * 10: processedAt, 11: confidence, 12: needsReview,
 * 13: matchedFacturaFileId, 14: matchConfidence
 */
function makeRetencionRow(
  overrides: {
    fechaEmision?: string | number;
    fileId?: string;
    nroCertificado?: string;
    cuitAgenteRetencion?: string;
    montoComprobante?: string;
    matchedFacturaFileId?: string;
    matchConfidence?: string;
  } = {}
): (string | number)[] {
  return [
    overrides.fechaEmision ?? '2025-01-15',        // 0: fechaEmision
    overrides.fileId ?? 'ret-file-1',              // 1: fileId
    'retencion.pdf',                               // 2: fileName
    overrides.nroCertificado ?? '000000009185',    // 3: nroCertificado
    overrides.cuitAgenteRetencion ?? '20123456786', // 4: cuitAgenteRetencion
    'TEST SA',                                     // 5: razonSocialAgenteRetencion
    'Ganancias',                                   // 6: impuesto
    'Régimen general',                             // 7: regimen
    overrides.montoComprobante ?? '10000',         // 8: montoComprobante
    '1000',                                        // 9: montoRetencion
    '2025-01-15T10:00:00Z',                        // 10: processedAt
    '0.95',                                        // 11: confidence
    'NO',                                          // 12: needsReview
    overrides.matchedFacturaFileId ?? '',          // 13: matchedFacturaFileId
    overrides.matchConfidence ?? '',               // 14: matchConfidence
  ];
}

/**
 * Helper: build a Facturas Emitidas row (A:S, indices 0-18)
 * 0: fechaEmision, 1: fileId, 2: fileName, 3: tipoComprobante, 4: nroFactura,
 * 5: cuitReceptor, 6: razonSocialReceptor, 7: importeNeto, 8: importeIva,
 * 9: importeTotal, 10: moneda, 11: concepto, 12: processedAt,
 * 13: confidence, 14: needsReview, 15: matchedPagoFileId,
 * 16: matchConfidence, 17: hasCuitMatch, 18: tipoDeCambio
 */
function makeFacturaRow(
  overrides: {
    fechaEmision?: string | number;
    fileId?: string;
    cuitReceptor?: string;
    importeTotal?: string;
    matchConfidence?: string;
  } = {}
): (string | number)[] {
  return [
    overrides.fechaEmision ?? '2025-01-01',        // 0: fechaEmision
    overrides.fileId ?? 'fact-file-1',             // 1: fileId
    'factura.pdf',                                 // 2: fileName
    'A',                                           // 3: tipoComprobante
    '00003-00001957',                              // 4: nroFactura
    overrides.cuitReceptor ?? '20123456786',       // 5: cuitReceptor
    'TEST SA',                                     // 6: razonSocialReceptor
    '8264.46',                                     // 7: importeNeto
    '1735.54',                                     // 8: importeIva
    overrides.importeTotal ?? '10000',             // 9: importeTotal
    'ARS',                                         // 10: moneda
    'Servicios',                                   // 11: concepto
    '2025-01-01T10:00:00Z',                        // 12: processedAt
    '0.95',                                        // 13: confidence
    'NO',                                          // 14: needsReview
    '',                                            // 15: matchedPagoFileId
    overrides.matchConfidence ?? '',               // 16: matchConfidence
    '',                                            // 17: hasCuitMatch
    '',                                            // 18: tipoDeCambio
  ];
}

const HEADER_RETENCION = ['fechaEmision', 'fileId', 'fileName', 'nroCertificado', 'cuitAgenteRetencion', 'razonSocialAgenteRetencion', 'impuesto', 'regimen', 'montoComprobante', 'montoRetencion', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'];
const HEADER_FACTURA = ['fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura', 'cuitReceptor', 'razonSocialReceptor', 'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch', 'tipoDeCambio'];

describe('matchRetencionesWithFacturas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches retencion with factura when CUIT matches and montoComprobante equals importeTotal (≤30 days → HIGH)', async () => {
    // Retencion date: 2025-01-15, Factura date: 2025-01-01 → 14 days → HIGH
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow()] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow()] });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }

    // Verify setValues was called with correct range and HIGH confidence
    expect(setValues).toHaveBeenCalledTimes(1);
    expect(setValues).toHaveBeenCalledWith(
      'test-spreadsheet-id',
      'Retenciones Recibidas!N2:O2',
      [['fact-file-1', 'HIGH']]
    );
  });

  it('assigns MEDIUM confidence when date difference is >30 days but ≤90 days', async () => {
    // Retencion date: 2025-03-01, Factura date: 2025-01-01 → 59 days → MEDIUM
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow({ fechaEmision: '2025-03-01' })] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow()] });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }

    expect(setValues).toHaveBeenCalledWith(
      'test-spreadsheet-id',
      'Retenciones Recibidas!N2:O2',
      [['fact-file-1', 'MEDIUM']]
    );
  });

  it('does not match when montoComprobante differs from importeTotal by more than $1', async () => {
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow({ montoComprobante: '9000' })] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow({ importeTotal: '10000' })] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('does not match when CUIT of agente differs from cuitReceptor of factura', async () => {
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow({ cuitAgenteRetencion: '27234567891' })] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow({ cuitReceptor: '20123456786' })] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('skips already-matched retencion (non-empty matchedFacturaFileId)', async () => {
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow({ matchedFacturaFileId: 'existing-fact-id' })] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow()] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('skips retencion with matchConfidence=MANUAL (MANUAL lock)', async () => {
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow({ matchConfidence: 'MANUAL' })] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow()] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('skips factura with matchConfidence=MANUAL (MANUAL lock on factura side)', async () => {
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow()] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow({ matchConfidence: 'MANUAL' })] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('does not match when retencion date is more than 90 days after factura date', async () => {
    // Retencion date: 2025-05-01, Factura date: 2025-01-01 → 120 days > 90
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow({ fechaEmision: '2025-05-01' })] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow()] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('does not match when retencion date is before factura date', async () => {
    // Retencion date: 2024-12-15 (before factura 2025-01-01)
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow({ fechaEmision: '2024-12-15' })] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow()] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('returns 0 when no retenciones in spreadsheet', async () => {
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow()] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
  });

  it('returns 0 when no facturas in spreadsheet', async () => {
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow()] })
      .mockResolvedValueOnce({ ok: true, value: [] });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(setValues).not.toHaveBeenCalled();
  });

  it('returns error when getValues fails for retenciones', async () => {
    vi.mocked(getValues).mockResolvedValueOnce({
      ok: false,
      error: new Error('API error retenciones'),
    });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API error retenciones');
    }
  });

  it('returns error when getValues fails for facturas', async () => {
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow()] })
      .mockResolvedValueOnce({ ok: false, error: new Error('API error facturas') });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API error facturas');
    }
  });

  it('normalizes serial number dates from spreadsheet', async () => {
    // Serial 45658 = 2025-01-01, Serial 45672 = 2025-01-15
    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, makeRetencionRow({ fechaEmision: 45672 })] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, makeFacturaRow({ fechaEmision: 45658 })] });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }
    expect(setValues).toHaveBeenCalledTimes(1);
  });

  it('matches multiple retenciones with different facturas', async () => {
    const retencionRows = [
      makeRetencionRow({ fileId: 'ret-1', cuitAgenteRetencion: '20123456786', montoComprobante: '10000' }),
      makeRetencionRow({ fileId: 'ret-2', cuitAgenteRetencion: '27234567891', montoComprobante: '5000', fechaEmision: '2025-01-20' }),
    ];
    const facturaRows = [
      makeFacturaRow({ fileId: 'fact-1', cuitReceptor: '20123456786', importeTotal: '10000' }),
      makeFacturaRow({ fileId: 'fact-2', cuitReceptor: '27234567891', importeTotal: '5000' }),
    ];

    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, ...retencionRows] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, ...facturaRows] });
    vi.mocked(setValues).mockResolvedValue({ ok: true, value: 1 });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(2);
    }
    expect(setValues).toHaveBeenCalledTimes(2);
  });

  it('continues when setValues fails for one retencion', async () => {
    const retencionRows = [
      makeRetencionRow({ fileId: 'ret-1', cuitAgenteRetencion: '20123456786', montoComprobante: '10000' }),
      makeRetencionRow({ fileId: 'ret-2', cuitAgenteRetencion: '27234567891', montoComprobante: '5000', fechaEmision: '2025-01-20' }),
    ];
    const facturaRows = [
      makeFacturaRow({ fileId: 'fact-1', cuitReceptor: '20123456786', importeTotal: '10000' }),
      makeFacturaRow({ fileId: 'fact-2', cuitReceptor: '27234567891', importeTotal: '5000' }),
    ];

    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [HEADER_RETENCION, ...retencionRows] })
      .mockResolvedValueOnce({ ok: true, value: [HEADER_FACTURA, ...facturaRows] });
    vi.mocked(setValues)
      .mockResolvedValueOnce({ ok: false, error: new Error('Update failed') })
      .mockResolvedValueOnce({ ok: true, value: 1 });

    const result = await matchRetencionesWithFacturas('test-spreadsheet-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // First fails, second succeeds
      expect(result.value).toBe(1);
    }
  });
});
