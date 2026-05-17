/**
 * Tests for buildSubdiarioRows — pure Subdiario de Ventas builder.
 *
 * Each test exercises one independent rule. Fixtures are built inline
 * using minimal object shapes; no mocks are needed (pure function, no I/O).
 *
 * ADV-247
 */

import { describe, it, expect } from 'vitest';
import { buildSubdiarioRows } from './subdiario-builder.js';
import type {
  Factura,
  Pago,
  Retencion,
  BankMovimiento,
  FacturadorEntry,
  SubdiarioInput,
} from '../types/index.js';

// ────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────

const ADVA_CUIT = '30709076783';
const CLIENT_CUIT = '20123456786';

const CURRENT_YEAR = 2026;

function makeFc(
  overrides: Partial<Factura> & { fileId: string; nroFactura: string }
): Factura {
  return {
    fileName: `fc-${overrides.fileId}.pdf`,
    tipoComprobante: 'C',
    fechaEmision: `${CURRENT_YEAR}-01-15`,
    cuitEmisor: ADVA_CUIT,
    razonSocialEmisor: 'ADVA SRL',
    cuitReceptor: CLIENT_CUIT,
    razonSocialReceptor: 'Test Client SA',
    importeNeto: 826446,
    importeIva: 173554,
    importeTotal: 1_000_000,
    moneda: 'ARS',
    processedAt: `${CURRENT_YEAR}-01-15T10:00:00Z`,
    confidence: 0.95,
    needsReview: false,
    ...overrides,
  };
}

function makeNc(
  overrides: Partial<Factura> & { fileId: string; nroFactura: string }
): Factura {
  return makeFc({
    tipoComprobante: 'NC C',
    importeNeto: 826446,
    importeIva: 173554,
    importeTotal: 1_000_000,
    ...overrides,
  });
}

let movSeq = 0;
function makeMov(overrides: {
  matchedFileId: string;
  credito: number;
  fecha?: string;
  matchedType?: 'AUTO' | 'MANUAL' | '';
  sourceUrl?: string;
  label?: string;
}): BankMovimiento {
  // Unique default sourceUrl per call so dedupe (which keys on sourceUrl)
  // doesn't collapse multiple movs that didn't explicitly request the same URL.
  movSeq += 1;
  return {
    fecha: `${CURRENT_YEAR}-01-20`,
    debito: null,
    matchedType: 'AUTO',
    concepto: 'Acreditación',
    sourceUrl: `https://docs.google.com/spreadsheets/d/test-bank-id/edit#gid=1&range=A${movSeq + 1}`,
    label: `BBVA ARS 2026-01 #${movSeq + 1}`,
    ...overrides,
  };
}

function makeRetCert(
  overrides: Partial<Retencion> & { fileId: string }
): Retencion {
  return {
    fileName: `ret-${overrides.fileId}.pdf`,
    nroCertificado: '000000009185',
    fechaEmision: `${CURRENT_YEAR}-01-25`,
    cuitAgenteRetencion: CLIENT_CUIT,
    razonSocialAgenteRetencion: 'Test Client SA',
    cuitSujetoRetenido: ADVA_CUIT,
    impuesto: 'Ganancias',
    regimen: 'Reg. General',
    montoComprobante: 1_000_000,
    montoRetencion: 50_000,
    processedAt: `${CURRENT_YEAR}-01-25T10:00:00Z`,
    confidence: 0.95,
    needsReview: false,
    ...overrides,
  };
}

function makePago(
  overrides: Partial<Pago> & { fileId: string; matchedFacturaFileId: string }
): Pago {
  return {
    fileName: `pago-${overrides.fileId}.pdf`,
    banco: 'BBVA',
    fechaPago: `${CURRENT_YEAR}-01-20`,
    importePagado: 0,
    moneda: 'ARS',
    processedAt: `${CURRENT_YEAR}-01-20T10:00:00Z`,
    confidence: 0.95,
    needsReview: false,
    ...overrides,
  };
}

function makeFacturadorEntry(
  overrides: Partial<FacturadorEntry>
): FacturadorEntry {
  return {
    nroSocio: '1003',
    comprobante: '00003-00001955',
    empresa: 'An Otter Game Studio S.R.L.',
    representante: 'Jane Doe',
    email: 'jane@otter.com',
    membresia: 'Micro',
    cobroId: 'COB-001',
    condIVA: 'IVA Responsable Inscripto',
    fecha: `${CURRENT_YEAR}-01-15`,
    importe: 1_000_000,
    pagadoCol: '',
    ...overrides,
  };
}

function makeInput(overrides: Partial<SubdiarioInput> = {}): SubdiarioInput {
  return {
    currentYear: CURRENT_YEAR,
    facturasEmitidas: [],
    pagosRecibidos: [],
    retencionesRecibidas: [],
    movimientos: [],
    facturador: new Map(),
    ...overrides,
  };
}

// ────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────

describe('buildSubdiarioRows', () => {
  // ── Test 1: Plain socio FC paid same year ────────────────────────────────
  it('socio FC paid same year: joins facturador, sets categoria and notas', () => {
    const fc = makeFc({ fileId: 'fc001', nroFactura: '00003-00001955' });
    const mov = makeMov({ matchedFileId: 'fc001', credito: 1_000_000 });
    const entry = makeFacturadorEntry({});
    const facturador = new Map([['00003-00001955', entry]]);

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov], facturador })
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.tipo).toBe('FC');
    expect(row.nro).toBe('00003-00001955');
    expect(row.categoria).toBe('Micro');
    expect(row.fechaCobro).toBe(`${CURRENT_YEAR}-01-20`);
    expect(row.recibido).toBe(1_000_000);
    expect(row.notas).toBe('Socio 1003 - An Otter Game Studio S.R.L.');
  });

  // ── Test 2: Non-socio FC ─────────────────────────────────────────────────
  it('non-socio FC: categoria blank, notas empty, recibido null when unpaid', () => {
    const fc = makeFc({ fileId: 'fc002', nroFactura: '00003-00001956' });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.categoria).toBe('');
    expect(row.notas).toBe('');
    expect(row.fechaCobro).toBe('');
    expect(row.recibido).toBeNull();
  });

  // ── Test 3: FC E export with USD, paid ───────────────────────────────────
  it('FC E export USD paid: total = USD * TC, notas show TC fact and TC pago', () => {
    const fc = makeFc({
      fileId: 'fc003',
      nroFactura: '00004-00000020',
      tipoComprobante: 'E',
      moneda: 'USD',
      tipoDeCambio: 1430,
      importeTotal: 10_000,
      importeNeto: 10_000,
      importeIva: 0,
    });
    // movimiento.credito / importeTotal = 14285000 / 10000 = 1428.5
    const mov = makeMov({ matchedFileId: 'fc003', credito: 14_285_000 });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc], movimientos: [mov] }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.cod).toBe('019');
    expect(row.tipo).toBe('FC');
    expect(row.total).toBe(14_300_000); // 10000 * 1430
    expect(row.recibido).toBe(14_285_000);
    expect(row.notas).toBe(
      'Pago del exterior - USD 10000 - TC fact 1430 - TC pago 1428.5'
    );
  });

  // ── Test 4: FC E export, unpaid ──────────────────────────────────────────
  it('FC E export USD unpaid: notas show TC fact only, no TC pago', () => {
    const fc = makeFc({
      fileId: 'fc004',
      nroFactura: '00004-00000021',
      tipoComprobante: 'E',
      moneda: 'USD',
      tipoDeCambio: 1430,
      importeTotal: 10_000,
      importeNeto: 10_000,
      importeIva: 0,
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.total).toBe(14_300_000);
    expect(row.notas).toBe('Pago del exterior - USD 10000 - TC fact 1430');
    expect(row.fechaCobro).toBe('');
    expect(row.recibido).toBeNull();
  });

  // ── Test 5: NC cancelling current-year FC ────────────────────────────────
  it('NC cancels current-year FC: FC has fechaCobro=NC nro, recibido=null; NC row has negative total', () => {
    const fc = makeFc({
      fileId: 'fc005',
      nroFactura: '00003-00001957',
      importeTotal: 500_000,
    });
    const nc = makeNc({
      fileId: 'nc005',
      nroFactura: '00003-00000140',
      importeTotal: 500_000,
      fechaEmision: `${CURRENT_YEAR}-02-10`,
      concepto: 'Nota de credito s/ Factura N° 3-1957',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc, nc] })
    );

    // Expect 2 rows: one FC, one NC
    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00003-00001957');
    const ncRow = rows.find((r) => r.tipo === 'NC' && r.nro === '00003-00000140');

    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe('NC 00003-00000140');
    expect(fcRow!.recibido).toBeNull();

    expect(ncRow).toBeDefined();
    expect(ncRow!.total).toBeLessThan(0);
    expect(ncRow!.total).toBe(-500_000);
  });

  // ── Test 6: NC cancelling prior-year FC ──────────────────────────────────
  it('NC in currentYear cancels prior-year FC: both rows in scope', () => {
    const fc = makeFc({
      fileId: 'fc006',
      nroFactura: '00003-00001800',
      fechaEmision: '2025-09-15',
      importeTotal: 800_000,
    });
    const nc = makeNc({
      fileId: 'nc006',
      nroFactura: '00003-00000200',
      importeTotal: 800_000,
      fechaEmision: `${CURRENT_YEAR}-01-05`,
      concepto: 'NC ref. Fact 3-1800',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc, nc] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00003-00001800');
    const ncRow = rows.find((r) => r.tipo === 'NC' && r.nro === '00003-00000200');

    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe('NC 00003-00000200');
    expect(fcRow!.recibido).toBeNull();

    expect(ncRow).toBeDefined();
    expect(ncRow!.total).toBe(-800_000);
  });

  // ── Test 7: Prior-year FC paid this year ─────────────────────────────────
  it('prior-year FC paid in currentYear: in scope (rule b)', () => {
    const fc = makeFc({
      fileId: 'fc007',
      nroFactura: '00003-00001500',
      fechaEmision: '2025-06-15',
      importeTotal: 600_000,
    });
    const mov = makeMov({
      matchedFileId: 'fc007',
      credito: 600_000,
      fecha: `${CURRENT_YEAR}-01-20`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov] })
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.nro).toBe('00003-00001500');
    expect(row.recibido).toBe(600_000);
    expect(row.fechaCobro).toBe(`${CURRENT_YEAR}-01-20`);
  });

  // ── Test 8: Prior-year FC still unpaid ───────────────────────────────────
  it('prior-year FC still unpaid: in scope (rule d)', () => {
    const fc = makeFc({
      fileId: 'fc008',
      nroFactura: '00003-00001400',
      fechaEmision: '2025-08-01',
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows).toHaveLength(1);
    expect(rows[0].nro).toBe('00003-00001400');
    expect(rows[0].fechaCobro).toBe('');
    expect(rows[0].recibido).toBeNull();
  });

  // ── Test 9: Prior-year FC marked pagada=SI with no currentYear event ─────
  // Soft-drop scope rule (e — ADV-270): `pagada='SI'` AND no currentYear event → OUT.
  it('prior-year FC pagada=SI, no currentYear event: OUT of scope (rule e)', () => {
    const fc = makeFc({
      fileId: 'fc009',
      nroFactura: '00003-00001300',
      fechaEmision: '2025-05-01',
      pagada: 'SI',
    });
    const mov = makeMov({
      matchedFileId: 'fc009',
      credito: 1_000_000,
      fecha: '2025-06-01',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov] })
    );

    expect(rows).toHaveLength(0);
  });

  // ── Test 10: Prior-year FC cancelled by prior-year NC (OUT of scope) ─────
  it('prior-year FC cancelled by prior-year NC: OUT of scope (rule f)', () => {
    const fc = makeFc({
      fileId: 'fc010',
      nroFactura: '00003-00001200',
      fechaEmision: '2025-03-01',
      importeTotal: 400_000,
    });
    const nc = makeNc({
      fileId: 'nc010',
      nroFactura: '00003-00000100',
      importeTotal: 400_000,
      fechaEmision: '2025-04-01',
      concepto: 'Anulacion factura 3-1200',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc, nc] })
    );

    // Both FC and NC are from prior year — neither should appear
    expect(rows).toHaveLength(0);
  });

  // ── Test 11: Multi-installment ───────────────────────────────────────────
  it('multi-installment: recibido = sum, fechaCobro = latest, notas shows cuotas', () => {
    const fc = makeFc({
      fileId: 'fc011',
      nroFactura: '00003-00001958',
      importeTotal: 1_800_000,
    });
    const mov1 = makeMov({
      matchedFileId: 'fc011',
      credito: 1_000_000,
      fecha: `${CURRENT_YEAR}-03-15`,
    });
    const mov2 = makeMov({
      matchedFileId: 'fc011',
      credito: 800_000,
      fecha: `${CURRENT_YEAR}-03-22`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov1, mov2] })
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.recibido).toBe(1_800_000);
    expect(row.fechaCobro).toBe(`${CURRENT_YEAR}-03-22`);
    expect(row.notas).toBe(
      'Cobrado en 2 cuotas: $1.000.000 (15/03/2026), $800.000 (22/03/2026)'
    );
  });

  // ── Test 12: Retencion-adjusted recibido ─────────────────────────────────
  it('retencion-adjusted: notas includes retencion info', () => {
    const fc = makeFc({
      fileId: 'fc012',
      nroFactura: '00003-00001959',
      importeTotal: 1_000_000,
    });
    const mov = makeMov({
      matchedFileId: 'fc012',
      credito: 950_000,
    });
    const ret = makeRetCert({
      fileId: 'ret012',
      montoComprobante: 1_000_000,
      montoRetencion: 50_000,
      cuitAgenteRetencion: CLIENT_CUIT,
      impuesto: 'Ganancias',
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        movimientos: [mov],
        retencionesRecibidas: [ret],
      })
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.recibido).toBe(950_000);
    expect(row.notas).toContain('Retencion Ganancias $50.000');
  });

  // ── Test 13: Numbering gap mid-stream ────────────────────────────────────
  it('gap mid-stream: inserts placeholder row for missing nro', () => {
    const fc1 = makeFc({
      fileId: 'fc013a',
      nroFactura: '00003-00001955',
      fechaEmision: `${CURRENT_YEAR}-01-10`,
    });
    const fc2 = makeFc({
      fileId: 'fc013b',
      nroFactura: '00003-00001957',
      fechaEmision: `${CURRENT_YEAR}-01-20`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc1, fc2] })
    );

    expect(rows).toHaveLength(3);
    const gap = rows.find((r) => r.cliente.startsWith('FALTA'));
    expect(gap).toBeDefined();
    expect(gap!.nro).toBe('00003-00001956');
    expect(gap!.cliente).toBe('FALTA 00003-00001956');
    expect(gap!.total).toBe(0);
  });

  // ── Test 14: Independent gaps across streams ─────────────────────────────
  it('gap in one stream does not affect another stream', () => {
    // FC stream (00003/FC): 1955 and 1957 — gap at 1956
    const fc1 = makeFc({
      fileId: 'fc014a',
      nroFactura: '00003-00001955',
      fechaEmision: `${CURRENT_YEAR}-01-10`,
    });
    const fc2 = makeFc({
      fileId: 'fc014b',
      nroFactura: '00003-00001957',
      fechaEmision: `${CURRENT_YEAR}-01-20`,
    });
    // NC stream (00005/NC): 10 and 12 — gap at 11
    const nc1 = makeNc({
      fileId: 'nc014a',
      nroFactura: '00005-00000010',
      tipoComprobante: 'NC C',
      fechaEmision: `${CURRENT_YEAR}-01-15`,
    });
    const nc2 = makeNc({
      fileId: 'nc014b',
      nroFactura: '00005-00000012',
      tipoComprobante: 'NC C',
      fechaEmision: `${CURRENT_YEAR}-01-25`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc1, fc2, nc1, nc2] })
    );

    const fcGaps = rows.filter(
      (r) => r.tipo === 'FC' && r.cliente.startsWith('FALTA')
    );
    const ncGaps = rows.filter(
      (r) => r.tipo === 'NC' && r.cliente.startsWith('FALTA')
    );

    // Exactly one gap per stream
    expect(fcGaps).toHaveLength(1);
    expect(fcGaps[0].nro).toBe('00003-00001956');

    expect(ncGaps).toHaveLength(1);
    expect(ncGaps[0].nro).toBe('00005-00000011');
  });

  // ── Test 14g: Multiple retenciones on the same FC are all included ───────
  // retencion-factura-matcher explicitly allows multiple certificates per FC
  // (different tax types — Ganancias + IIBB). The Subdiario row's notas must
  // include all of them. Codex P2 finding on PR 116.
  it('multiple retenciones matched to same factura: notas includes all', () => {
    const fc = makeFc({
      fileId: 'fc-multi-ret',
      nroFactura: '00010-00000001',
      importeTotal: 1_000_000,
      fechaEmision: `${CURRENT_YEAR}-03-01`,
    });
    const retGanancias = makeRetCert({
      fileId: 'ret-gan',
      impuesto: 'Ganancias',
      montoRetencion: 50_000,
      matchedFacturaFileId: 'fc-multi-ret',
    });
    const retIIBB = makeRetCert({
      fileId: 'ret-iibb',
      impuesto: 'IIBB',
      montoRetencion: 30_000,
      matchedFacturaFileId: 'fc-multi-ret',
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        retencionesRecibidas: [retGanancias, retIIBB],
      })
    );

    const row = rows.find((r) => r.nro === '00010-00000001');
    expect(row?.notas).toContain('Retencion Ganancias $50.000');
    expect(row?.notas).toContain('Retencion IIBB $30.000');
  });

  // ── Test 14f: Retencion respects authoritative matchedFacturaFileId ──────
  // When two facturas share CUIT + importeTotal and a single retencion is
  // already matched (via retencion-factura-matcher) to one of them, the
  // builder must not reuse it for the other factura. Codex P2 finding on PR 116.
  it('retencion claimed by another factura is not reused by an amount-only match', () => {
    const fcA = makeFc({
      fileId: 'fcA-ret',
      nroFactura: '00009-00000001',
      importeTotal: 1_000_000,
      fechaEmision: `${CURRENT_YEAR}-02-01`,
    });
    const fcB = makeFc({
      fileId: 'fcB-ret',
      nroFactura: '00009-00000002',
      importeTotal: 1_000_000, // same client, same total
      fechaEmision: `${CURRENT_YEAR}-02-02`,
    });
    // Retencion is authoritatively matched to fcA (by retencion-factura-matcher)
    const ret = makeRetCert({
      fileId: 'ret-1',
      montoComprobante: 1_000_000,
      montoRetencion: 50_000,
      matchedFacturaFileId: 'fcA-ret',
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fcA, fcB],
        retencionesRecibidas: [ret],
      })
    );

    const rowA = rows.find((r) => r.nro === '00009-00000001');
    const rowB = rows.find((r) => r.nro === '00009-00000002');

    // fcA (claimed by ret): notas mentions the retencion
    expect(rowA?.notas).toContain('Retencion Ganancias');
    // fcB (not claimed): notas does NOT mention retencion — no double-use
    expect(rowB?.notas).not.toContain('Retencion');
  });

  // ── Test 14e: Partially paid prior-year FC stays in scope ────────────────
  // Rule (e) drops a prior-year FC when all matched movimientos are in prior
  // years. But that's only correct if those movimientos COVER the total.
  // A 2025 FC of $1M with a single 2025 credit of $200K still has $800K
  // outstanding — it must remain in the 2026 scope as a receivable.
  // Codex P2 finding on PR 116.
  it('prior-year FC with partial prior-year payment stays in scope', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fcPartial = makeFc({
      fileId: 'fc-partial',
      nroFactura: '00007-00000050',
      importeTotal: 1_000_000,
      fechaEmision: `${PRIOR_YEAR}-08-01`,
    });
    // Only a single prior-year movimiento, paying $200K of the $1M total.
    const partialPayment = makeMov({
      matchedFileId: 'fc-partial',
      credito: 200_000,
      fecha: `${PRIOR_YEAR}-08-10`,
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fcPartial],
        movimientos: [partialPayment],
      })
    );

    // FC should remain in scope as an unsettled receivable.
    const realRows = rows.filter((r) => !r.cliente.startsWith('FALTA'));
    expect(realRows).toHaveLength(1);
    expect(realRows[0].nro).toBe('00007-00000050');
  });

  // ── Soft-drop scope filter (ADV-270) ─────────────────────────────────────
  // The new rule (e): prior-year FC with `pagada='SI'` is DROPPED, UNLESS a
  // currentYear event (matched movimiento, cancelling NC, or matched
  // pago_recibido) pulls it back so the 2026-side event has a partner row.

  it('soft-drop: prior-year FC pagada=SI, zero currentYear events → dropped', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fc = makeFc({
      fileId: 'fc-softdrop-1',
      nroFactura: '00010-00000001',
      fechaEmision: `${PRIOR_YEAR}-04-01`,
      pagada: 'SI',
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows.filter((r) => !r.cliente.startsWith('FALTA'))).toHaveLength(0);
  });

  it('soft-drop: prior-year FC pagada=SI kept when a currentYear movimiento matches', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fc = makeFc({
      fileId: 'fc-softdrop-2',
      nroFactura: '00010-00000002',
      fechaEmision: `${PRIOR_YEAR}-04-01`,
      pagada: 'SI',
      importeTotal: 1_000_000,
    });
    const mov = makeMov({
      matchedFileId: 'fc-softdrop-2',
      credito: 1_000_000,
      fecha: `${CURRENT_YEAR}-02-05`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov] })
    );

    const real = rows.filter((r) => !r.cliente.startsWith('FALTA'));
    expect(real).toHaveLength(1);
    expect(real[0].nro).toBe('00010-00000002');
  });

  it('soft-drop: prior-year FC pagada=SI kept when a cancelling NC is issued in currentYear', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fc = makeFc({
      fileId: 'fc-softdrop-3',
      nroFactura: '00010-00000003',
      fechaEmision: `${PRIOR_YEAR}-04-01`,
      importeTotal: 500_000,
      pagada: 'SI',
    });
    const nc = makeNc({
      fileId: 'nc-softdrop-3',
      nroFactura: '00010-00000900',
      fechaEmision: `${CURRENT_YEAR}-03-01`,
      importeTotal: 500_000,
      concepto: 'Nota de credito s/ Factura N° 10-3',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc, nc] })
    );

    const real = rows.filter((r) => !r.cliente.startsWith('FALTA'));
    expect(real.map((r) => r.nro).sort()).toEqual([
      '00010-00000003',
      '00010-00000900',
    ]);
  });

  it('soft-drop: prior-year FC pagada=SI kept when a matched pago_recibido is in currentYear', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fc = makeFc({
      fileId: 'fc-softdrop-4',
      nroFactura: '00010-00000004',
      fechaEmision: `${PRIOR_YEAR}-04-01`,
      pagada: 'SI',
      importeTotal: 750_000,
    });
    const pago = makePago({
      fileId: 'pago-softdrop-4',
      matchedFacturaFileId: 'fc-softdrop-4',
      fechaPago: `${CURRENT_YEAR}-02-15`,
      importePagado: 750_000,
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        pagosRecibidos: [pago],
      })
    );

    const real = rows.filter((r) => !r.cliente.startsWith('FALTA'));
    expect(real).toHaveLength(1);
    expect(real[0].nro).toBe('00010-00000004');
  });

  // Codex PR #119 follow-up: scope filter rule (b) must use the same one-hop
  // indirection that `aggregateMovimientos` uses. Without it, a prior-year
  // pagada='SI' FC whose currentYear bank credit is matched to a pago (not
  // directly to the factura) is silently dropped from scope — even though
  // there IS a currentYear payment, just one hop away.
  it('soft-drop: prior-year FC pagada=SI kept when currentYear movimiento is matched via pago (one-hop)', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fc = makeFc({
      fileId: 'fc-softdrop-onehop',
      nroFactura: '00010-00000040',
      fechaEmision: `${PRIOR_YEAR}-11-15`,
      pagada: 'SI',
      importeTotal: 500_000,
    });
    const pago = makePago({
      fileId: 'pago-onehop',
      matchedFacturaFileId: 'fc-softdrop-onehop',
      // Pago's own fechaPago is prior-year — so rule (b-via-pago) at line 469
      // does NOT save us. Only the one-hop scope rule does.
      fechaPago: `${PRIOR_YEAR}-12-20`,
      importePagado: 500_000,
    });
    const mov = makeMov({
      matchedFileId: 'pago-onehop', // matched to pago, NOT directly to fc
      credito: 500_000,
      fecha: `${CURRENT_YEAR}-01-10`,
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        pagosRecibidos: [pago],
        movimientos: [mov],
      })
    );

    const real = rows.filter((r) => !r.cliente.startsWith('FALTA'));
    expect(real).toHaveLength(1);
    expect(real[0].nro).toBe('00010-00000040');
    // Hard-paid (movAgg wins) — uses currentYear bank fecha.
    expect(real[0].fechaCobro).toBe(`${CURRENT_YEAR}-01-10`);
  });

  it('soft-drop: prior-year FC without pagada, no movimiento, no NC → kept (rule d unchanged)', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fc = makeFc({
      fileId: 'fc-softdrop-5',
      nroFactura: '00010-00000005',
      fechaEmision: `${PRIOR_YEAR}-04-01`,
      // pagada intentionally undefined
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    const real = rows.filter((r) => !r.cliente.startsWith('FALTA'));
    expect(real).toHaveLength(1);
    expect(real[0].nro).toBe('00010-00000005');
  });

  it('soft-drop: prior-year FC pagada=SI, all matched movimientos in prior year → dropped', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fc = makeFc({
      fileId: 'fc-softdrop-6',
      nroFactura: '00010-00000006',
      fechaEmision: `${PRIOR_YEAR}-04-01`,
      pagada: 'SI',
      importeTotal: 1_000_000,
    });
    const mov = makeMov({
      matchedFileId: 'fc-softdrop-6',
      credito: 1_000_000,
      fecha: `${PRIOR_YEAR}-05-10`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov] })
    );

    expect(rows.filter((r) => !r.cliente.startsWith('FALTA'))).toHaveLength(0);
  });

  it('soft-drop: currentYear FC always kept regardless of pagada (rule a unchanged)', () => {
    const fc = makeFc({
      fileId: 'fc-softdrop-7',
      nroFactura: '00010-00000007',
      fechaEmision: `${CURRENT_YEAR}-03-01`,
      pagada: 'SI',
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    const real = rows.filter((r) => !r.cliente.startsWith('FALTA'));
    expect(real).toHaveLength(1);
    expect(real[0].nro).toBe('00010-00000007');
  });

  it('soft-drop: pagada whitespace/casing is normalized (" si " trims+uppercases to SI)', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fc = makeFc({
      fileId: 'fc-softdrop-8',
      nroFactura: '00010-00000008',
      fechaEmision: `${PRIOR_YEAR}-04-01`,
      pagada: ' si ',
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows.filter((r) => !r.cliente.startsWith('FALTA'))).toHaveLength(0);
  });

  // ── Soft-paid intermediate status (ADV-271) ──────────────────────────────
  // A pago_recibido matched to an FC without a confirming bank movimiento
  // counts as soft-paid: fechaCobro and recibido come from the pago, and
  // notas prepends "Pendiente confirmación bancaria". Movimiento overrides
  // soft (hard paid); NC cancellation overrides everything.

  it('soft-paid: matched pago_recibido only → fechaCobro=pago.fechaPago, recibido=importePagado, notas prepends marker', () => {
    const fc = makeFc({
      fileId: 'fc-softpaid-1',
      nroFactura: '00020-00000001',
      importeTotal: 500_000,
    });
    const pago = makePago({
      fileId: 'pago-softpaid-1',
      matchedFacturaFileId: 'fc-softpaid-1',
      fechaPago: `${CURRENT_YEAR}-02-10`,
      importePagado: 500_000,
      moneda: 'ARS',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], pagosRecibidos: [pago] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00020-00000001');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe(`${CURRENT_YEAR}-02-10`);
    expect(fcRow!.recibido).toBe(500_000);
    expect(fcRow!.notas.startsWith('Pendiente confirmación bancaria')).toBe(true);
  });

  it('soft-paid: USD pago uses importeEnPesos when present', () => {
    const fc = makeFc({
      fileId: 'fc-softpaid-2',
      nroFactura: '00020-00000002',
      tipoComprobante: 'E',
      moneda: 'USD',
      tipoDeCambio: 1430,
      importeTotal: 10_000,
      importeNeto: 10_000,
      importeIva: 0,
    });
    const pago = makePago({
      fileId: 'pago-softpaid-2',
      matchedFacturaFileId: 'fc-softpaid-2',
      fechaPago: `${CURRENT_YEAR}-02-15`,
      importePagado: 10_000,
      moneda: 'USD',
      importeEnPesos: 14_285_000,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], pagosRecibidos: [pago] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00020-00000002');
    expect(fcRow).toBeDefined();
    expect(fcRow!.recibido).toBe(14_285_000);
    expect(fcRow!.notas.startsWith('Pendiente confirmación bancaria')).toBe(true);
  });

  it('soft-paid: USD pago falls back to importePagado * factura.tipoDeCambio when importeEnPesos missing', () => {
    const fc = makeFc({
      fileId: 'fc-softpaid-3',
      nroFactura: '00020-00000003',
      tipoComprobante: 'E',
      moneda: 'USD',
      tipoDeCambio: 1400,
      importeTotal: 10_000,
      importeNeto: 10_000,
      importeIva: 0,
    });
    const pago = makePago({
      fileId: 'pago-softpaid-3',
      matchedFacturaFileId: 'fc-softpaid-3',
      fechaPago: `${CURRENT_YEAR}-02-20`,
      importePagado: 10_000,
      moneda: 'USD',
      // importeEnPesos intentionally missing
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], pagosRecibidos: [pago] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00020-00000003');
    expect(fcRow).toBeDefined();
    expect(fcRow!.recibido).toBe(14_000_000);
    expect(fcRow!.notas.startsWith('Pendiente confirmación bancaria')).toBe(true);
  });

  // ADV-274: USD pago with neither importeEnPesos nor factura.tipoDeCambio must
  // leave the recibido cell BLANK (null) instead of rendering 0.00. The row
  // still displays as soft-paid via fechaCobro + the "Pendiente confirmación
  // bancaria" notas marker — but a missing conversion rate should not be
  // confused with "paid 0 ARS".
  it('soft-paid: USD pago with no importeEnPesos and no tipoDeCambio → recibido=null (not 0)', () => {
    const fc = makeFc({
      fileId: 'fc-softpaid-adv274',
      nroFactura: '00020-00000274',
      tipoComprobante: 'E',
      moneda: 'USD',
      tipoDeCambio: undefined,
      importeTotal: 10_000,
      importeNeto: 10_000,
      importeIva: 0,
    });
    const pago = makePago({
      fileId: 'pago-softpaid-adv274',
      matchedFacturaFileId: 'fc-softpaid-adv274',
      fechaPago: `${CURRENT_YEAR}-02-20`,
      importePagado: 10_000,
      moneda: 'USD',
      // importeEnPesos intentionally missing → totalARS contributes 0
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], pagosRecibidos: [pago] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00020-00000274');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe(`${CURRENT_YEAR}-02-20`);
    expect(fcRow!.recibido).toBeNull();
    expect(fcRow!.notas.startsWith('Pendiente confirmación bancaria')).toBe(true);
  });

  it('hard paid silences soft: FC with movimiento AND pago_recibido has no marker', () => {
    const fc = makeFc({
      fileId: 'fc-softpaid-4',
      nroFactura: '00020-00000004',
      importeTotal: 800_000,
    });
    const mov = makeMov({
      matchedFileId: 'fc-softpaid-4',
      credito: 800_000,
      fecha: `${CURRENT_YEAR}-02-25`,
    });
    const pago = makePago({
      fileId: 'pago-softpaid-4',
      matchedFacturaFileId: 'fc-softpaid-4',
      fechaPago: `${CURRENT_YEAR}-02-20`,
      importePagado: 800_000,
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        movimientos: [mov],
        pagosRecibidos: [pago],
      })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00020-00000004');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe(`${CURRENT_YEAR}-02-25`);
    expect(fcRow!.recibido).toBe(800_000);
    expect(fcRow!.notas).not.toContain('Pendiente confirmación bancaria');
  });

  it('NC cancellation overrides soft-paid: fechaCobro shows NC nro, no marker', () => {
    const fc = makeFc({
      fileId: 'fc-softpaid-5',
      nroFactura: '00020-00000005',
      importeTotal: 600_000,
    });
    const nc = makeNc({
      fileId: 'nc-softpaid-5',
      nroFactura: '00020-00000950',
      importeTotal: 600_000,
      fechaEmision: `${CURRENT_YEAR}-03-01`,
      concepto: 'Nota de credito s/ Factura N° 20-5',
    });
    const pago = makePago({
      fileId: 'pago-softpaid-5',
      matchedFacturaFileId: 'fc-softpaid-5',
      fechaPago: `${CURRENT_YEAR}-02-25`,
      importePagado: 600_000,
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc, nc],
        pagosRecibidos: [pago],
      })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00020-00000005');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe('NC 00020-00000950');
    expect(fcRow!.recibido).toBeNull();
    expect(fcRow!.notas).not.toContain('Pendiente confirmación bancaria');
  });

  it('soft-paid: multi-pago aggregation — recibido=sum, fechaCobro=latest fechaPago', () => {
    const fc = makeFc({
      fileId: 'fc-softpaid-6',
      nroFactura: '00020-00000006',
      importeTotal: 1_500_000,
    });
    const pago1 = makePago({
      fileId: 'pago-softpaid-6a',
      matchedFacturaFileId: 'fc-softpaid-6',
      fechaPago: `${CURRENT_YEAR}-02-05`,
      importePagado: 700_000,
    });
    const pago2 = makePago({
      fileId: 'pago-softpaid-6b',
      matchedFacturaFileId: 'fc-softpaid-6',
      fechaPago: `${CURRENT_YEAR}-02-22`,
      importePagado: 800_000,
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        pagosRecibidos: [pago1, pago2],
      })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00020-00000006');
    expect(fcRow).toBeDefined();
    expect(fcRow!.recibido).toBe(1_500_000);
    expect(fcRow!.fechaCobro).toBe(`${CURRENT_YEAR}-02-22`);
    expect(fcRow!.notas.startsWith('Pendiente confirmación bancaria')).toBe(true);
  });

  it('FC with neither movimiento nor pago_recibido stays unpaid (no marker)', () => {
    const fc = makeFc({
      fileId: 'fc-softpaid-7',
      nroFactura: '00020-00000007',
      importeTotal: 100_000,
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00020-00000007');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe('');
    expect(fcRow!.recibido).toBeNull();
    expect(fcRow!.notas).not.toContain('Pendiente confirmación bancaria');
  });

  // ── One-hop pago→factura traversal in aggregateMovimientos (ADV-279) ──────
  // The bank matcher prefers pago_recibido candidates (tier 1) over direct
  // factura candidates, so most member cuotas land with m.matchedFileId ===
  // pago.fileId. Without one-hop traversal these silently misclassify as
  // soft-paid. After the fix, hard-paid covers BOTH direct (m → factura) AND
  // indirect (m → pago → factura) matches.

  it('one-hop: m → pago → factura counts as hard-paid', () => {
    const fc = makeFc({
      fileId: 'fc-onehop-1',
      nroFactura: '00040-00000001',
      importeTotal: 100_000,
    });
    const pago = makePago({
      fileId: 'pago-onehop-1',
      matchedFacturaFileId: 'fc-onehop-1',
      fechaPago: `${CURRENT_YEAR}-03-10`,
      importePagado: 100_000,
    });
    const mov = makeMov({
      matchedFileId: 'pago-onehop-1',
      credito: 100_000,
      fecha: `${CURRENT_YEAR}-03-15`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank/edit#gid=1&range=A10',
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        pagosRecibidos: [pago],
        movimientos: [mov],
      })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00040-00000001');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe(`${CURRENT_YEAR}-03-15`);
    expect(fcRow!.recibido).toBe(100_000);
    expect(fcRow!.notas.startsWith('Pendiente confirmación bancaria')).toBe(false);
    expect(fcRow!.movimiento).toBe(
      'https://docs.google.com/spreadsheets/d/bank/edit#gid=1&range=A10'
    );
  });

  it('one-hop: direct match still works (regression guard)', () => {
    const fc = makeFc({
      fileId: 'fc-onehop-2',
      nroFactura: '00040-00000002',
      importeTotal: 50_000,
    });
    const mov = makeMov({
      matchedFileId: 'fc-onehop-2',
      credito: 50_000,
      fecha: `${CURRENT_YEAR}-03-20`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank/edit#gid=1&range=A11',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00040-00000002');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe(`${CURRENT_YEAR}-03-20`);
    expect(fcRow!.recibido).toBe(50_000);
    expect(fcRow!.movimiento).toBe(
      'https://docs.google.com/spreadsheets/d/bank/edit#gid=1&range=A11'
    );
  });

  it('one-hop: pago with no matched factura is ignored — factura stays unpaid', () => {
    const fc = makeFc({
      fileId: 'fc-onehop-3',
      nroFactura: '00040-00000003',
      importeTotal: 75_000,
    });
    const orphanPago = makePago({
      fileId: 'pago-onehop-3',
      matchedFacturaFileId: '',
      fechaPago: `${CURRENT_YEAR}-03-25`,
      importePagado: 75_000,
    });
    const mov = makeMov({
      matchedFileId: 'pago-onehop-3',
      credito: 75_000,
      fecha: `${CURRENT_YEAR}-03-26`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank/edit#gid=1&range=A12',
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        pagosRecibidos: [orphanPago],
        movimientos: [mov],
      })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00040-00000003');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe('');
    expect(fcRow!.recibido).toBeNull();
    expect(fcRow!.movimiento).toBe('');
  });

  it('one-hop: direct and indirect on same movimiento dedupes (no double-count)', () => {
    const fc = makeFc({
      fileId: 'fc-onehop-4',
      nroFactura: '00040-00000004',
      importeTotal: 200_000,
    });
    const pago = makePago({
      fileId: 'pago-onehop-4',
      matchedFacturaFileId: 'fc-onehop-4',
      fechaPago: `${CURRENT_YEAR}-04-01`,
      importePagado: 100_000,
    });
    const sharedUrl = 'https://docs.google.com/spreadsheets/d/bank/edit#gid=1&range=A20';
    // One movimiento credit=100k, simultaneously a direct match to FC and an
    // indirect match via pago. Should be counted ONCE.
    const direct = makeMov({
      matchedFileId: 'fc-onehop-4',
      credito: 100_000,
      fecha: `${CURRENT_YEAR}-04-05`,
      sourceUrl: sharedUrl,
    });
    const indirect = makeMov({
      matchedFileId: 'pago-onehop-4',
      credito: 100_000,
      fecha: `${CURRENT_YEAR}-04-05`,
      sourceUrl: sharedUrl, // same source row — dedupe
    });
    // Plus a second distinct movimiento for the rest of the importe
    const other = makeMov({
      matchedFileId: 'fc-onehop-4',
      credito: 100_000,
      fecha: `${CURRENT_YEAR}-04-10`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank/edit#gid=1&range=A30',
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        pagosRecibidos: [pago],
        movimientos: [direct, indirect, other],
      })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00040-00000004');
    expect(fcRow).toBeDefined();
    // 100k + 100k (dedupe drops the duplicate), NOT 300k
    expect(fcRow!.recibido).toBe(200_000);
  });

  it('one-hop: soft-paid only fires when no movimiento reachable (direct or via pago)', () => {
    const fc = makeFc({
      fileId: 'fc-onehop-5',
      nroFactura: '00040-00000005',
      importeTotal: 60_000,
    });
    const pago = makePago({
      fileId: 'pago-onehop-5',
      matchedFacturaFileId: 'fc-onehop-5',
      fechaPago: `${CURRENT_YEAR}-04-15`,
      importePagado: 60_000,
    });
    // No movimiento pointing at fc OR pago → soft-paid branch is preserved

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fc],
        pagosRecibidos: [pago],
        movimientos: [],
      })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00040-00000005');
    expect(fcRow).toBeDefined();
    expect(fcRow!.fechaCobro).toBe(`${CURRENT_YEAR}-04-15`);
    expect(fcRow!.recibido).toBe(60_000);
    expect(fcRow!.notas.startsWith('Pendiente confirmación bancaria')).toBe(true);
    expect(fcRow!.movimiento).toBe('');
  });

  // ── Movimiento column (ADV-272) ──────────────────────────────────────────
  // The new `movimiento` column carries a Sheets URL pointing at the source
  // bank row. Only hard-paid FCs (movimiento aggregate present) populate it;
  // soft-paid, unpaid, NC-cancelled, NC, and gap rows leave it blank — the
  // column's semantic is "authoritative bank movement, nothing else".

  it('movimiento column: hard-paid FC uses LATEST matched movimiento sourceUrl', () => {
    const fc = makeFc({
      fileId: 'fc-movcol-1',
      nroFactura: '00030-00000001',
      importeTotal: 100_000,
    });
    const mov = makeMov({
      matchedFileId: 'fc-movcol-1',
      credito: 100_000,
      fecha: `${CURRENT_YEAR}-02-10`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank1/edit#gid=10&range=A5',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00030-00000001');
    expect(fcRow).toBeDefined();
    expect(fcRow!.movimiento).toBe(
      'https://docs.google.com/spreadsheets/d/bank1/edit#gid=10&range=A5'
    );
  });

  it('movimiento column: multi-cuota uses LATEST cuota sourceUrl', () => {
    const fc = makeFc({
      fileId: 'fc-movcol-2',
      nroFactura: '00030-00000002',
      importeTotal: 1_800_000,
    });
    const mov1 = makeMov({
      matchedFileId: 'fc-movcol-2',
      credito: 1_000_000,
      fecha: `${CURRENT_YEAR}-03-15`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank2/edit#gid=10&range=A5',
    });
    const mov2 = makeMov({
      matchedFileId: 'fc-movcol-2',
      credito: 800_000,
      fecha: `${CURRENT_YEAR}-03-22`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank2/edit#gid=10&range=A12',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov1, mov2] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00030-00000002');
    expect(fcRow).toBeDefined();
    expect(fcRow!.movimiento).toBe(
      'https://docs.google.com/spreadsheets/d/bank2/edit#gid=10&range=A12'
    );
  });

  it('movimiento column: soft-paid FC has empty movimiento', () => {
    const fc = makeFc({
      fileId: 'fc-movcol-3',
      nroFactura: '00030-00000003',
      importeTotal: 100_000,
    });
    const pago = makePago({
      fileId: 'pago-movcol-3',
      matchedFacturaFileId: 'fc-movcol-3',
      fechaPago: `${CURRENT_YEAR}-02-10`,
      importePagado: 100_000,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], pagosRecibidos: [pago] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00030-00000003');
    expect(fcRow).toBeDefined();
    expect(fcRow!.movimiento).toBe('');
  });

  it('movimiento column: unpaid FC has empty movimiento', () => {
    const fc = makeFc({
      fileId: 'fc-movcol-4',
      nroFactura: '00030-00000004',
      importeTotal: 100_000,
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00030-00000004');
    expect(fcRow).toBeDefined();
    expect(fcRow!.movimiento).toBe('');
  });

  it('movimiento column: NC-cancelled FC has empty movimiento', () => {
    const fc = makeFc({
      fileId: 'fc-movcol-5',
      nroFactura: '00030-00000005',
      importeTotal: 100_000,
    });
    const nc = makeNc({
      fileId: 'nc-movcol-5',
      nroFactura: '00030-00000900',
      importeTotal: 100_000,
      fechaEmision: `${CURRENT_YEAR}-02-10`,
      concepto: 'Nota de credito s/ Factura N° 30-5',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc, nc] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00030-00000005');
    const ncRow = rows.find((r) => r.tipo === 'NC' && r.nro === '00030-00000900');
    expect(fcRow!.movimiento).toBe('');
    expect(ncRow!.movimiento).toBe('');
  });

  it('movimiento column: gap placeholder has empty movimiento', () => {
    const fc1 = makeFc({
      fileId: 'fc-movcol-6a',
      nroFactura: '00030-00000010',
      fechaEmision: `${CURRENT_YEAR}-01-10`,
    });
    const fc2 = makeFc({
      fileId: 'fc-movcol-6b',
      nroFactura: '00030-00000012',
      fechaEmision: `${CURRENT_YEAR}-01-20`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc1, fc2] })
    );

    const gap = rows.find((r) => r.cliente.startsWith('FALTA'));
    expect(gap).toBeDefined();
    expect(gap!.movimiento).toBe('');
  });

  // ── facturaFileId plumbing (ADV-280) ─────────────────────────────────────
  // SubdiarioRow.facturaFileId carries the source factura's Drive fileId so the
  // writer can render col D (nro) as a link to the PDF. FC and NC rows populate
  // it from the source factura; FALTA placeholders leave it blank.

  it('facturaFileId: FC row carries factura.fileId', () => {
    const fc = makeFc({
      fileId: 'fc-link-1',
      nroFactura: '00050-00000001',
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00050-00000001');
    expect(fcRow).toBeDefined();
    expect(fcRow!.facturaFileId).toBe('fc-link-1');
  });

  it('facturaFileId: NC row carries the NC factura.fileId', () => {
    const fc = makeFc({
      fileId: 'fc-link-2',
      nroFactura: '00050-00000002',
      importeTotal: 100_000,
    });
    const nc = makeNc({
      fileId: 'nc-link-2',
      nroFactura: '00050-00000900',
      importeTotal: 100_000,
      fechaEmision: `${CURRENT_YEAR}-02-10`,
      concepto: 'Nota de credito s/ Factura N° 50-2',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc, nc] })
    );

    const ncRow = rows.find((r) => r.tipo === 'NC' && r.nro === '00050-00000900');
    expect(ncRow).toBeDefined();
    expect(ncRow!.facturaFileId).toBe('nc-link-2');
  });

  // ── movimientoLabel population (ADV-281) ─────────────────────────────────
  // The label is the displayed cell text; the URL is what the link points at.
  // Builder sources the label from the latest cuota's BankMovimiento.label.

  it('movimientoLabel: hard-paid FC carries the latest cuota label', () => {
    const fc = makeFc({
      fileId: 'fc-label-1',
      nroFactura: '00060-00000001',
      importeTotal: 100_000,
    });
    const mov = makeMov({
      matchedFileId: 'fc-label-1',
      credito: 100_000,
      fecha: `${CURRENT_YEAR}-02-10`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank/edit#gid=10&range=A5',
      label: 'BBVA ARS 2026-02 #5',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00060-00000001');
    expect(fcRow).toBeDefined();
    expect(fcRow!.movimientoLabel).toBe('BBVA ARS 2026-02 #5');
    expect(fcRow!.movimiento).toBe(
      'https://docs.google.com/spreadsheets/d/bank/edit#gid=10&range=A5'
    );
  });

  it('movimientoLabel: multi-cuota uses LATEST cuota label', () => {
    const fc = makeFc({
      fileId: 'fc-label-2',
      nroFactura: '00060-00000002',
      importeTotal: 1_800_000,
    });
    const mov1 = makeMov({
      matchedFileId: 'fc-label-2',
      credito: 1_000_000,
      fecha: `${CURRENT_YEAR}-03-15`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank/edit#gid=10&range=A5',
      label: 'BBVA ARS 2026-03 #5',
    });
    const mov2 = makeMov({
      matchedFileId: 'fc-label-2',
      credito: 800_000,
      fecha: `${CURRENT_YEAR}-03-22`,
      sourceUrl: 'https://docs.google.com/spreadsheets/d/bank/edit#gid=10&range=A12',
      label: 'BBVA ARS 2026-03 #12',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], movimientos: [mov1, mov2] })
    );

    const fcRow = rows.find((r) => r.tipo === 'FC' && r.nro === '00060-00000002');
    expect(fcRow).toBeDefined();
    expect(fcRow!.movimientoLabel).toBe('BBVA ARS 2026-03 #12');
  });

  it('movimientoLabel: unpaid/soft-paid/NC-cancelled/FALTA rows leave it empty', () => {
    const fcUnpaid = makeFc({
      fileId: 'fc-label-unpaid',
      nroFactura: '00060-00000010',
      fechaEmision: `${CURRENT_YEAR}-01-05`,
    });
    const fcSoft = makeFc({
      fileId: 'fc-label-soft',
      nroFactura: '00060-00000011',
      fechaEmision: `${CURRENT_YEAR}-01-10`,
      importeTotal: 50_000,
    });
    const softPago = makePago({
      fileId: 'pago-label-soft',
      matchedFacturaFileId: 'fc-label-soft',
      fechaPago: `${CURRENT_YEAR}-01-15`,
      importePagado: 50_000,
    });
    const fc2 = makeFc({
      fileId: 'fc-label-cancelled',
      nroFactura: '00060-00000013',
      fechaEmision: `${CURRENT_YEAR}-01-20`,
      importeTotal: 70_000,
    });
    const nc = makeNc({
      fileId: 'nc-label',
      nroFactura: '00060-00000900',
      importeTotal: 70_000,
      fechaEmision: `${CURRENT_YEAR}-01-25`,
      concepto: 'Nota de credito s/ Factura N° 60-13',
    });

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fcUnpaid, fcSoft, fc2, nc],
        pagosRecibidos: [softPago],
      })
    );

    // Unpaid
    expect(rows.find((r) => r.nro === '00060-00000010')!.movimientoLabel).toBe('');
    // Soft-paid
    expect(rows.find((r) => r.nro === '00060-00000011')!.movimientoLabel).toBe('');
    // NC-cancelled FC + the NC itself
    expect(rows.find((r) => r.nro === '00060-00000013')!.movimientoLabel).toBe('');
    expect(rows.find((r) => r.nro === '00060-00000900')!.movimientoLabel).toBe('');
    // FALTA placeholder (gap between 11 and 13)
    const gap = rows.find((r) => r.cliente.startsWith('FALTA'));
    expect(gap).toBeDefined();
    expect(gap!.movimientoLabel).toBe('');
  });

  it('facturaFileId: FALTA placeholder has empty facturaFileId', () => {
    const fc1 = makeFc({
      fileId: 'fc-link-3a',
      nroFactura: '00050-00000010',
      fechaEmision: `${CURRENT_YEAR}-01-10`,
    });
    const fc2 = makeFc({
      fileId: 'fc-link-3b',
      nroFactura: '00050-00000012',
      fechaEmision: `${CURRENT_YEAR}-01-20`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc1, fc2] })
    );

    const gap = rows.find((r) => r.cliente.startsWith('FALTA'));
    expect(gap).toBeDefined();
    expect(gap!.facturaFileId).toBe('');
  });

  // ── Test 14d: Don't emit FALTA for filtered-out source rows ──────────────
  // Gap detection must consult the FULL source history when deciding what is
  // truly missing. An out-of-scope prior-year FC (paid before currentYear) is
  // not a gap — it exists in the source, just outside the Subdiario scope.
  // Codex P2 finding on PR 116.
  it('FALTA is not emitted for prior-year FCs that are in source but out of scope', () => {
    const PRIOR_YEAR = CURRENT_YEAR - 1;
    const fcPaid1 = makeFc({
      fileId: 'fc-paid-1',
      nroFactura: '00001-00000001',
      fechaEmision: `${PRIOR_YEAR}-06-01`,
      pagada: 'SI',
    });
    const fcPaid2 = makeFc({
      fileId: 'fc-paid-2',
      nroFactura: '00001-00000002',
      fechaEmision: `${PRIOR_YEAR}-06-02`,
      pagada: 'SI',
    });
    // FC #3 is the prior-year unpaid FC kept by scope rule (d)
    const fcUnpaid = makeFc({
      fileId: 'fc-unpaid',
      nroFactura: '00001-00000003',
      fechaEmision: `${PRIOR_YEAR}-06-10`,
    });
    const fcPaid4 = makeFc({
      fileId: 'fc-paid-4',
      nroFactura: '00001-00000004',
      fechaEmision: `${PRIOR_YEAR}-06-15`,
      pagada: 'SI',
    });
    // FC #5 is the current-year FC kept by scope rule (a)
    const fcCurrent = makeFc({
      fileId: 'fc-current',
      nroFactura: '00001-00000005',
      fechaEmision: `${CURRENT_YEAR}-01-10`,
    });

    // Match the prior-year FCs to prior-year movimientos so rule (e) drops them
    const movs = [
      makeMov({
        matchedFileId: 'fc-paid-1',
        credito: 1_000_000,
        fecha: `${PRIOR_YEAR}-06-05`,
      }),
      makeMov({
        matchedFileId: 'fc-paid-2',
        credito: 1_000_000,
        fecha: `${PRIOR_YEAR}-06-06`,
      }),
      makeMov({
        matchedFileId: 'fc-paid-4',
        credito: 1_000_000,
        fecha: `${PRIOR_YEAR}-06-20`,
      }),
    ];

    const rows = buildSubdiarioRows(
      makeInput({
        facturasEmitidas: [fcPaid1, fcPaid2, fcUnpaid, fcPaid4, fcCurrent],
        movimientos: movs,
      })
    );

    // The scope keeps fc-unpaid (#3, rule d) and fc-current (#5, rule a). Naive
    // gap detection on {#3, #5} would emit FALTA #4 — but #4 is in the source.
    const gaps = rows.filter((r) => r.cliente.startsWith('FALTA'));
    expect(gaps).toHaveLength(0);
  });

  // ── Test 14c: NC class must match FC class for cancellation ──────────────
  // An NC B must NOT cancel an FC A even if CUIT/amount/date overlap. AFIP
  // numbering and cancellation legality are per-cod. Codex P2 finding on PR 116.
  it('NC class must match FC class for cancellation (no refNro path)', () => {
    // Two FCs of different classes (A and B) at the same CUIT + amount + year.
    // Without a class check, the NC's CUIT+amount+date predicate matches both,
    // and the first FC in iteration order is incorrectly marked cancelled.
    const fcA = makeFc({
      fileId: 'fcA-class',
      tipoComprobante: 'A',
      nroFactura: '00001-00000001',
      importeTotal: 500_000,
      fechaEmision: `${CURRENT_YEAR}-01-10`,
    });
    const fcB = makeFc({
      fileId: 'fcB-class',
      tipoComprobante: 'B',
      nroFactura: '00002-00000001',
      importeTotal: 500_000,
      fechaEmision: `${CURRENT_YEAR}-01-12`,
    });
    // NC B (cod 008) with no refNro in concepto — same CUIT, same amount.
    const ncB = makeNc({
      fileId: 'ncB-class',
      tipoComprobante: 'NC B',
      nroFactura: '00002-00000050',
      importeTotal: 500_000,
      fechaEmision: `${CURRENT_YEAR}-01-20`,
      concepto: 'Anulación',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fcA, fcB, ncB] })
    );

    const rowB = rows.find((r) => r.nro === '00002-00000001');
    const rowA = rows.find((r) => r.nro === '00001-00000001');

    // FC B is cancelled (same class as NC B)
    expect(rowB?.fechaCobro.startsWith('NC ')).toBe(true);
    // FC A is NOT cancelled — class mismatch
    expect(rowA?.fechaCobro).toBe('');
  });

  // ── Test 14b: Same PV, different AFIP cods are independent streams ────────
  // AFIP numbering is independent per cod, not per (pv, tipo). A single punto
  // de venta MAY emit multiple cods (e.g. FC A + FC B). The gap-detection key
  // must include `cod` to avoid merging unrelated sequences.
  it('same PV with different cods are independent streams (no false FALTA)', () => {
    // FC A (cod 001) at PV 00003: nros 1, 2, 3
    const fcA1 = makeFc({
      fileId: 'fcA1',
      tipoComprobante: 'A',
      nroFactura: '00003-00000001',
      fechaEmision: `${CURRENT_YEAR}-01-10`,
    });
    const fcA2 = makeFc({
      fileId: 'fcA2',
      tipoComprobante: 'A',
      nroFactura: '00003-00000002',
      fechaEmision: `${CURRENT_YEAR}-01-11`,
    });
    const fcA3 = makeFc({
      fileId: 'fcA3',
      tipoComprobante: 'A',
      nroFactura: '00003-00000003',
      fechaEmision: `${CURRENT_YEAR}-01-12`,
    });
    // FC B (cod 006) at the SAME PV 00003: nros 5, 6, 7
    const fcB5 = makeFc({
      fileId: 'fcB5',
      tipoComprobante: 'B',
      nroFactura: '00003-00000005',
      fechaEmision: `${CURRENT_YEAR}-01-15`,
    });
    const fcB6 = makeFc({
      fileId: 'fcB6',
      tipoComprobante: 'B',
      nroFactura: '00003-00000006',
      fechaEmision: `${CURRENT_YEAR}-01-16`,
    });
    const fcB7 = makeFc({
      fileId: 'fcB7',
      tipoComprobante: 'B',
      nroFactura: '00003-00000007',
      fechaEmision: `${CURRENT_YEAR}-01-17`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fcA1, fcA2, fcA3, fcB5, fcB6, fcB7] })
    );

    // No FALTA should be inserted at numero 4 — it's only "missing" if you
    // mistakenly merge cod 001 and cod 006 into a single 1..7 sequence.
    const gaps = rows.filter((r) => r.cliente.startsWith('FALTA'));
    expect(gaps).toHaveLength(0);
  });

  // ── Test 15: FE missing from Facturador ──────────────────────────────────
  it('FE not in Facturador: categoria blank, condicion from PDF', () => {
    const fc = makeFc({
      fileId: 'fc015',
      nroFactura: '00003-00001960',
      condicionIVAReceptor: 'Consumidor Final',
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.categoria).toBe('');
    expect(row.condicion).toBe('Consumidor Final');
  });

  // ── Test 16: FE missing condicionIVAReceptor, Facturador has condIVA ─────
  it('FE without condicionIVAReceptor: uses Facturador condIVA as fallback', () => {
    const fc = makeFc({
      fileId: 'fc016',
      nroFactura: '00003-00001961',
      // No condicionIVAReceptor set
    });
    const entry = makeFacturadorEntry({
      comprobante: '00003-00001961',
      condIVA: 'IVA Responsable Inscripto',
    });
    const facturador = new Map([['00003-00001961', entry]]);

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], facturador })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].condicion).toBe('IVA Responsable Inscripto');
  });

  // ── Test 17: Combined Notas (socio + export) ─────────────────────────────
  it('socio FC E: notas combines socio and export pieces with "; "', () => {
    const fc = makeFc({
      fileId: 'fc017',
      nroFactura: '00004-00000030',
      tipoComprobante: 'E',
      moneda: 'USD',
      tipoDeCambio: 1430,
      importeTotal: 10_000,
      importeNeto: 10_000,
      importeIva: 0,
    });
    const entry = makeFacturadorEntry({
      nroSocio: '1029',
      comprobante: '00004-00000030',
      empresa: 'UNRaf',
    });
    const facturador = new Map([['00004-00000030', entry]]);

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], facturador })
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.notas).toBe(
      'Socio 1029 - UNRaf; Pago del exterior - USD 10000 - TC fact 1430'
    );
  });

  // ── Test 18: Sort verification ────────────────────────────────────────────
  it('rows sorted by fecha ASC then nro ASC; cross-stream interleaves', () => {
    const fcEarly = makeFc({
      fileId: 'fc018a',
      nroFactura: '00003-00000001',
      fechaEmision: `${CURRENT_YEAR}-01-10`,
    });
    // Same date — different nros: 00003 < 00005 lexicographically
    const fcSameDate1 = makeFc({
      fileId: 'fc018b',
      nroFactura: '00003-00000002',
      fechaEmision: `${CURRENT_YEAR}-01-15`,
    });
    const ncSameDate = makeNc({
      fileId: 'nc018',
      nroFactura: '00005-00000001',
      fechaEmision: `${CURRENT_YEAR}-01-15`,
      tipoComprobante: 'NC C',
    });
    const fcLate = makeFc({
      fileId: 'fc018c',
      nroFactura: '00003-00000003',
      fechaEmision: `${CURRENT_YEAR}-01-20`,
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fcLate, ncSameDate, fcSameDate1, fcEarly] })
    );

    // Remove gap rows (if any) for sort verification
    const realRows = rows.filter((r) => !r.cliente.startsWith('FALTA'));

    expect(realRows[0].nro).toBe('00003-00000001'); // earliest date
    expect(realRows[1].nro).toBe('00003-00000002'); // same date as [2], nro 00003 < 00005
    expect(realRows[2].nro).toBe('00005-00000001'); // same date as [1], nro 00005
    expect(realRows[3].nro).toBe('00003-00000003'); // latest date
  });

  // ── Test 19: AFIP cod mapping ─────────────────────────────────────────────
  it('derives correct AFIP cod for all comprobante types', () => {
    const types: Array<[string, string, 'FC' | 'NC']> = [
      ['A', '001', 'FC'],
      ['B', '006', 'FC'],
      ['C', '011', 'FC'],
      ['E', '019', 'FC'],
      ['NC A', '003', 'NC'],
      ['NC B', '008', 'NC'],
      ['NC C', '013', 'NC'],
      ['NC E', '021', 'NC'],
    ];

    for (const [tipoComprobante, expectedCod, expectedTipo] of types) {
      const fc = makeFc({
        fileId: `fc-cod-${tipoComprobante.replace(' ', '')}`,
        nroFactura: '00003-00001962',
        tipoComprobante: tipoComprobante as Factura['tipoComprobante'],
        fechaEmision: `${CURRENT_YEAR}-01-15`,
      });

      const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));
      // NC rows: only in scope if emitted in currentYear (already done above)
      const row = rows.find((r) => !r.cliente.startsWith('FALTA'));
      expect(row?.cod, `cod for ${tipoComprobante}`).toBe(expectedCod);
      expect(row?.tipo, `tipo for ${tipoComprobante}`).toBe(expectedTipo);
    }
  });

  // ── Test 20: USD FC with missing TC emits REVISAR note ────────────────────
  it('USD FC with missing tipoDeCambio: total=0, notas has [REVISAR: TC faltante]', () => {
    const fc = makeFc({
      fileId: 'fc020',
      nroFactura: '00004-00000040',
      tipoComprobante: 'E',
      moneda: 'USD',
      tipoDeCambio: undefined,
      importeTotal: 5_000,
      importeNeto: 5_000,
      importeIva: 0,
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.total).toBe(0);
    expect(row.notas).toContain('[REVISAR: TC faltante]');
  });

  // ── Test 22: NC consumed by first matching FC, second FC remains active (ADV-253) ──
  it('generic NC matches only one of two same-CUIT same-amount FCs (no double-attribution)', () => {
    const fc1 = makeFc({
      fileId: 'fc022a',
      nroFactura: '00003-00002001',
      fechaEmision: `${CURRENT_YEAR}-02-01`,
      importeTotal: 250_000,
    });
    const fc2 = makeFc({
      fileId: 'fc022b',
      nroFactura: '00003-00002002',
      fechaEmision: `${CURRENT_YEAR}-02-02`,
      importeTotal: 250_000,
    });
    // Generic NC with no refNro in concepto, same CUIT, same amount
    const nc = makeNc({
      fileId: 'nc022',
      nroFactura: '00003-00000300',
      importeTotal: 250_000,
      fechaEmision: `${CURRENT_YEAR}-02-15`,
      concepto: 'Ajuste comercial',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc1, fc2, nc] })
    );

    const fc1Row = rows.find((r) => r.tipo === 'FC' && r.nro === '00003-00002001');
    const fc2Row = rows.find((r) => r.tipo === 'FC' && r.nro === '00003-00002002');

    expect(fc1Row).toBeDefined();
    expect(fc2Row).toBeDefined();

    // Exactly one FC should be marked as cancelled by NC
    const cancelledRows = [fc1Row, fc2Row].filter(
      (r) => r!.fechaCobro === 'NC 00003-00000300'
    );
    expect(cancelledRows).toHaveLength(1);

    // The other FC must remain active (empty fechaCobro)
    const activeRows = [fc1Row, fc2Row].filter((r) => r!.fechaCobro === '');
    expect(activeRows).toHaveLength(1);
  });

  // ── Test 23: refNro match wins over generic match (ADV-253 priority) ──
  it('NC with refNro is attributed to that specific FC, not a same-amount sibling', () => {
    const fc1 = makeFc({
      fileId: 'fc023a',
      nroFactura: '00003-00002101',
      fechaEmision: `${CURRENT_YEAR}-02-01`,
      importeTotal: 300_000,
    });
    const fc2 = makeFc({
      fileId: 'fc023b',
      nroFactura: '00003-00002102',
      fechaEmision: `${CURRENT_YEAR}-02-02`,
      importeTotal: 300_000,
    });
    // NC concepto references fc2 explicitly. Even though fc1 appears first in array order,
    // the refNro match must win.
    const nc = makeNc({
      fileId: 'nc023',
      nroFactura: '00003-00000310',
      importeTotal: 300_000,
      fechaEmision: `${CURRENT_YEAR}-02-15`,
      concepto: 'NC s/ Factura N° 3-2102',
    });

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc1, fc2, nc] })
    );

    const fc1Row = rows.find((r) => r.tipo === 'FC' && r.nro === '00003-00002101');
    const fc2Row = rows.find((r) => r.tipo === 'FC' && r.nro === '00003-00002102');

    // fc1 must remain active; fc2 must be cancelled
    expect(fc1Row!.fechaCobro).toBe('');
    expect(fc2Row!.fechaCobro).toBe('NC 00003-00000310');
  });

  // ── Test 21: USD FC with importeTotal=0 must not produce "Infinity" (ADV-252) ──
  it('USD FC with importeTotal=0 and matched movimiento: notas does not contain Infinity', () => {
    const fc = makeFc({
      fileId: 'fc021',
      nroFactura: '00004-00000050',
      tipoComprobante: 'E',
      moneda: 'USD',
      tipoDeCambio: 1430,
      importeTotal: 0,
      importeNeto: 0,
      importeIva: 0,
    });
    const mov = makeMov({ matchedFileId: 'fc021', credito: 1_000_000 });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc], movimientos: [mov] }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.notas).not.toContain('Infinity');
    // TC pago segment must be omitted or use the '?' placeholder
    expect(row.notas).toBe('Pago del exterior - USD 0 - TC fact 1430 - TC pago ?');
  });

  // ── Test 24: NC recibido mirrors total (ADV-259 invariant) ────────────────
  it('NC row: recibido mirrors total (both negative)', () => {
    const fc = makeFc({
      fileId: 'fc024',
      nroFactura: '00003-00002500',
      importeTotal: 500_000,
    });
    const nc = makeNc({
      fileId: 'nc024',
      nroFactura: '00003-00000400',
      importeTotal: 500_000,
      fechaEmision: `${CURRENT_YEAR}-03-10`,
      concepto: 'NC s/ Factura N° 3-2500',
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc, nc] }));

    const ncRow = rows.find((r) => r.tipo === 'NC' && r.nro === '00003-00000400');
    expect(ncRow).toBeDefined();
    expect(ncRow!.total).toBe(-500_000);
    expect(ncRow!.recibido).toBe(-500_000);
  });

  // ── Test 25: Plain tipoComprobante 'NC' maps to cod 013 (ADV-259 invariant) ──
  it('plain tipoComprobante "NC" (no class suffix): cod=013, tipo=NC', () => {
    const nc = makeNc({
      fileId: 'nc025',
      nroFactura: '00003-00000500',
      tipoComprobante: 'NC',
      fechaEmision: `${CURRENT_YEAR}-04-01`,
      importeTotal: 100_000,
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [nc] }));

    const ncRow = rows.find((r) => r.nro === '00003-00000500');
    expect(ncRow).toBeDefined();
    expect(ncRow!.tipo).toBe('NC');
    expect(ncRow!.cod).toBe('013');
  });

  // ── Test 26: PDF-extracted condicionIVAReceptor wins over Facturador condIVA (ADV-259) ──
  it('condicionIVAReceptor (PDF) takes priority over Facturador condIVA when both present', () => {
    const fc = makeFc({
      fileId: 'fc026',
      nroFactura: '00003-00002600',
      condicionIVAReceptor: 'IVA Responsable Inscripto',
    });
    const entry = makeFacturadorEntry({
      comprobante: '00003-00002600',
      condIVA: 'Consumidor Final',
    });
    const facturador = new Map([['00003-00002600', entry]]);

    const rows = buildSubdiarioRows(
      makeInput({ facturasEmitidas: [fc], facturador })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].condicion).toBe('IVA Responsable Inscripto');
  });
});
