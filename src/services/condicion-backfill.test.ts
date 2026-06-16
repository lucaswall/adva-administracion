/**
 * Tests for condicionIVA backfill service (ADV-380)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FacturadorEntry } from '../types/index.js';
import { decideSourcing, backfillCondicionIva } from './condicion-backfill.js';
import { getValues, updateRowsWithFormatting, getSpreadsheetTimezone } from './sheets.js';
import type { CellValue } from './sheets.js';
import { readFacturador } from './facturador-reader.js';
import { processFile } from '../processing/extractor.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  updateRowsWithFormatting: vi.fn(),
  getSpreadsheetTimezone: vi.fn(),
}));

vi.mock('./facturador-reader.js', () => ({
  readFacturador: vi.fn(),
  normalizeNroComprobante: vi.fn((raw: string) => {
    // Real implementation so decideSourcing tests get correct normalization
    const trimmed = raw.trim();
    const dashIdx = trimmed.indexOf('-');
    if (dashIdx === -1) return trimmed;
    const pto = trimmed.substring(0, dashIdx);
    const numero = trimmed.substring(dashIdx + 1);
    const normalizedPto = pto.replace(/^0+/, '').padStart(5, '0');
    const normalizedNumero = numero.replace(/^0+/, '').padStart(8, '0');
    return `${normalizedPto}-${normalizedNumero}`;
  }),
}));

vi.mock('../processing/extractor.js', () => ({
  processFile: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFacturadorEntry(override: Partial<FacturadorEntry> = {}): FacturadorEntry {
  return {
    nroSocio: '42',
    comprobante: '00001-00000001',
    empresa: 'TEST SA',
    representante: 'Juan Perez',
    email: 'juan@test.com',
    membresia: 'Empresa',
    cobroId: 'c1',
    condIVA: 'IVA Responsable Inscripto',
    fecha: '2025-01-15',
    importe: 1000,
    pagadoCol: 'SI',
    ...override,
  };
}

// Facturas Emitidas header row (cols A:U)
const HEADER_ROW = [
  'fechaEmision', 'fileId', 'fileName', 'tipoComprobante', 'nroFactura',
  'cuitReceptor', 'razonSocialReceptor', 'condicionIVAReceptor',
  'importeNeto', 'importeIva', 'importeTotal', 'moneda', 'concepto',
  'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId',
  'matchConfidence', 'hasCuitMatch', 'pagada', 'tipoDeCambio',
];

/** Build a data row with the given values at key columns */
function makeRow(opts: {
  fileId?: string;
  fileName?: string;
  nroFactura?: string;
  condicionIVAReceptor?: string;
}): CellValue[] {
  const row: CellValue[] = new Array(21).fill('');
  row[1] = opts.fileId ?? 'file-001';
  row[2] = opts.fileName ?? 'test.pdf';
  row[4] = opts.nroFactura ?? '00001-00000001';
  row[7] = opts.condicionIVAReceptor ?? ''; // blank = needs backfill
  return row;
}

// ---------------------------------------------------------------------------
// Unit tests: decideSourcing (pure, no I/O)
// ---------------------------------------------------------------------------

describe('decideSourcing (pure unit — ADV-380)', () => {
  const mockFacturadorMap = new Map<string, FacturadorEntry>([
    ['00001-00000001', makeFacturadorEntry({ condIVA: 'IVA Responsable Inscripto' })],
  ]);

  it('returns skip when condicionIVAReceptor is already filled', () => {
    const decision = decideSourcing(
      { nroFactura: '00001-00000001', currentCondIVA: 'Responsable Monotributo' },
      mockFacturadorMap
    );
    expect(decision.strategy).toBe('skip');
  });

  it('treats whitespace-only currentCondIVA as blank (not yet filled)', () => {
    // Whitespace-only means no real value was set — treat as blank → needs backfill
    // The nro matches the facturador map, so strategy is 'facturador'
    const decision = decideSourcing(
      { nroFactura: '00001-00000001', currentCondIVA: '  ' },
      mockFacturadorMap
    );
    expect(decision.strategy).toBe('facturador');
  });

  it('returns facturador with condIVA when nro matches facturador map (blank H)', () => {
    const decision = decideSourcing(
      { nroFactura: '00001-00000001', currentCondIVA: '' },
      mockFacturadorMap
    );
    expect(decision.strategy).toBe('facturador');
    expect(decision.condIVA).toBe('IVA Responsable Inscripto');
  });

  it('returns parse when nro does not match facturador (non-socio)', () => {
    const decision = decideSourcing(
      { nroFactura: '00001-00000099', currentCondIVA: '' },
      mockFacturadorMap
    );
    expect(decision.strategy).toBe('parse');
    expect(decision.condIVA).toBeUndefined();
  });

  it('returns parse when facturador entry exists but condIVA is blank', () => {
    const emptyCondIvaMap = new Map<string, FacturadorEntry>([
      ['00001-00000001', makeFacturadorEntry({ condIVA: '' })],
    ]);
    const decision = decideSourcing(
      { nroFactura: '00001-00000001', currentCondIVA: '' },
      emptyCondIvaMap
    );
    expect(decision.strategy).toBe('parse');
  });

  it('normalizes nroFactura before lookup (0001-00001 → 00001-00000001)', () => {
    const shortNroMap = new Map<string, FacturadorEntry>([
      ['00001-00000001', makeFacturadorEntry({ condIVA: 'Responsable Monotributo' })],
    ]);
    // nroFactura '00001-00000001' should normalize to '00001-00000001' and match
    const decision = decideSourcing(
      { nroFactura: '00001-00000001', currentCondIVA: '' },
      shortNroMap
    );
    expect(decision.strategy).toBe('facturador');
    expect(decision.condIVA).toBe('Responsable Monotributo');
  });
});

// ---------------------------------------------------------------------------
// Integration tests: backfillCondicionIva orchestrator
// ---------------------------------------------------------------------------

describe('backfillCondicionIva orchestrator (ADV-380)', () => {
  const CONTROL_INGRESOS_ID = 'spreadsheet-abc';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: getSpreadsheetTimezone returns ok
    vi.mocked(getSpreadsheetTimezone).mockResolvedValue({
      ok: true,
      value: 'America/Argentina/Buenos_Aires',
    });

    // Default: facturador returns empty map
    vi.mocked(readFacturador).mockResolvedValue({ ok: true, value: new Map() });

    // Default: updateRowsWithFormatting succeeds
    vi.mocked(updateRowsWithFormatting).mockResolvedValue({ ok: true, value: undefined });
  });

  it('returns scanned=0 when sheet has only header row', async () => {
    vi.mocked(getValues).mockResolvedValue({ ok: true, value: [HEADER_ROW] });

    const result = await backfillCondicionIva({ controlIngresosId: CONTROL_INGRESOS_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({
      scanned: 0, filledFromFacturador: 0, filledFromParse: 0, skipped: 0, failed: 0,
    });
    expect(vi.mocked(updateRowsWithFormatting)).not.toHaveBeenCalled();
  });

  it('skips rows where col H (condicionIVAReceptor) is already filled', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        HEADER_ROW,
        makeRow({ fileId: 'f1', nroFactura: '00001-00000001', condicionIVAReceptor: 'Responsable Monotributo' }),
        makeRow({ fileId: 'f2', nroFactura: '00001-00000002', condicionIVAReceptor: 'IVA Responsable Inscripto' }),
      ],
    });

    const result = await backfillCondicionIva({ controlIngresosId: CONTROL_INGRESOS_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.scanned).toBe(2);
    expect(result.value.skipped).toBe(2);
    expect(result.value.filledFromFacturador).toBe(0);
    expect(result.value.filledFromParse).toBe(0);
    expect(vi.mocked(updateRowsWithFormatting)).not.toHaveBeenCalled();
  });

  it('fills from facturador when nro matches socio (no Gemini call)', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        HEADER_ROW,
        makeRow({ fileId: 'f1', nroFactura: '00001-00000001', condicionIVAReceptor: '' }),
      ],
    });

    const facturadorMap = new Map<string, FacturadorEntry>([
      ['00001-00000001', makeFacturadorEntry({ condIVA: 'IVA Responsable Inscripto' })],
    ]);
    vi.mocked(readFacturador).mockResolvedValue({ ok: true, value: facturadorMap });

    const result = await backfillCondicionIva({ controlIngresosId: CONTROL_INGRESOS_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.scanned).toBe(1);
    expect(result.value.filledFromFacturador).toBe(1);
    expect(result.value.filledFromParse).toBe(0);
    expect(vi.mocked(processFile)).not.toHaveBeenCalled();

    // Verify the write: col H row 2 (header=row1, first data row=row2)
    expect(vi.mocked(updateRowsWithFormatting)).toHaveBeenCalledWith(
      CONTROL_INGRESOS_ID,
      [{ range: 'Facturas Emitidas!H2:H2', values: ['IVA Responsable Inscripto'] }],
      'America/Argentina/Buenos_Aires'
    );
  });

  it('fills from parse (Gemini re-extract) for non-socio with blank H', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        HEADER_ROW,
        makeRow({ fileId: 'f-non-socio', fileName: 'invoice.pdf', nroFactura: '00001-00000099', condicionIVAReceptor: '' }),
      ],
    });
    // Facturador has no entry for this nro
    vi.mocked(readFacturador).mockResolvedValue({ ok: true, value: new Map() });
    // processFile returns a factura with condicionIVAReceptor
    vi.mocked(processFile).mockResolvedValue({
      ok: true,
      value: {
        documentType: 'factura_emitida',
        document: {
          fileId: 'f-non-socio',
          fileName: 'invoice.pdf',
          tipoComprobante: 'A',
          nroFactura: '00001-00000099',
          fechaEmision: '2025-01-15',
          cuitEmisor: '30709076783',
          razonSocialEmisor: 'ADVA',
          condicionIVAReceptor: 'Responsable Monotributo',
          importeNeto: 1000,
          importeIva: 210,
          importeTotal: 1210,
          moneda: 'ARS',
          processedAt: '2025-01-15T00:00:00.000Z',
          confidence: 0.9,
          needsReview: false,
        },
      },
    });

    const result = await backfillCondicionIva({ controlIngresosId: CONTROL_INGRESOS_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.scanned).toBe(1);
    expect(result.value.filledFromParse).toBe(1);
    expect(result.value.filledFromFacturador).toBe(0);
    expect(vi.mocked(processFile)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'f-non-socio',
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
      })
    );
    expect(vi.mocked(updateRowsWithFormatting)).toHaveBeenCalledWith(
      CONTROL_INGRESOS_ID,
      [{ range: 'Facturas Emitidas!H2:H2', values: ['Responsable Monotributo'] }],
      'America/Argentina/Buenos_Aires'
    );
  });

  it('counts as failed when processFile returns not-ok', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        HEADER_ROW,
        makeRow({ fileId: 'f-fail', nroFactura: '00001-00000099', condicionIVAReceptor: '' }),
      ],
    });
    vi.mocked(readFacturador).mockResolvedValue({ ok: true, value: new Map() });
    vi.mocked(processFile).mockResolvedValue({
      ok: false,
      error: new Error('Gemini timeout'),
    });

    const result = await backfillCondicionIva({ controlIngresosId: CONTROL_INGRESOS_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.failed).toBe(1);
    expect(result.value.filledFromParse).toBe(0);
    expect(vi.mocked(updateRowsWithFormatting)).not.toHaveBeenCalled();
  });

  it('respects ?limit and processes only N blank-H rows', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        HEADER_ROW,
        makeRow({ fileId: 'f1', nroFactura: '00001-00000001', condicionIVAReceptor: '' }),
        makeRow({ fileId: 'f2', nroFactura: '00001-00000002', condicionIVAReceptor: '' }),
        makeRow({ fileId: 'f3', nroFactura: '00001-00000003', condicionIVAReceptor: '' }),
      ],
    });
    const facturadorMap = new Map<string, FacturadorEntry>([
      ['00001-00000001', makeFacturadorEntry({ condIVA: 'Responsable Monotributo' })],
      ['00001-00000002', makeFacturadorEntry({ condIVA: 'IVA Responsable Inscripto' })],
      ['00001-00000003', makeFacturadorEntry({ condIVA: 'Responsable Monotributo' })],
    ]);
    vi.mocked(readFacturador).mockResolvedValue({ ok: true, value: facturadorMap });

    const result = await backfillCondicionIva({ controlIngresosId: CONTROL_INGRESOS_ID, limit: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.scanned).toBe(2);
    expect(result.value.filledFromFacturador).toBe(2);
    // Third row not processed due to limit
    expect(vi.mocked(updateRowsWithFormatting)).toHaveBeenCalledTimes(2);
  });

  it('returns error when getValues fails', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: false,
      error: new Error('Sheets quota exceeded'),
    });

    const result = await backfillCondicionIva({ controlIngresosId: CONTROL_INGRESOS_ID });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('Sheets quota exceeded');
  });

  it('returns error when readFacturador fails', async () => {
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [HEADER_ROW, makeRow({})],
    });
    vi.mocked(readFacturador).mockResolvedValue({
      ok: false,
      error: new Error('Facturador spreadsheet not found'),
    });

    const result = await backfillCondicionIva({ controlIngresosId: CONTROL_INGRESOS_ID });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('Facturador spreadsheet not found');
  });
});
