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

function makeMov(overrides: {
  matchedFileId: string;
  credito: number;
  fecha?: string;
  matchedType?: 'AUTO' | 'MANUAL' | '';
}): BankMovimiento {
  return {
    fecha: `${CURRENT_YEAR}-01-20`,
    debito: null,
    matchedType: 'AUTO',
    concepto: 'Acreditación',
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
  it('non-socio FC: categoria = "-", notas empty', () => {
    const fc = makeFc({ fileId: 'fc002', nroFactura: '00003-00001956' });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.categoria).toBe('-');
    expect(row.notas).toBe('');
    expect(row.fechaCobro).toBe('');
    expect(row.recibido).toBe(0);
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
    expect(row.recibido).toBe(0);
  });

  // ── Test 5: NC cancelling current-year FC ────────────────────────────────
  it('NC cancels current-year FC: FC has fechaCobro=NC nro, recibido=0; NC row has negative total', () => {
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
    expect(fcRow!.recibido).toBe(0);

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
    expect(fcRow!.recibido).toBe(0);

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
    expect(rows[0].recibido).toBe(0);
  });

  // ── Test 9: Prior-year FC paid prior year (OUT of scope) ─────────────────
  it('prior-year FC paid in prior year: OUT of scope (rule e)', () => {
    const fc = makeFc({
      fileId: 'fc009',
      nroFactura: '00003-00001300',
      fechaEmision: '2025-05-01',
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
  it('FE not in Facturador: categoria = "-", condicion from PDF', () => {
    const fc = makeFc({
      fileId: 'fc015',
      nroFactura: '00003-00001960',
      condicionIVAReceptor: 'Consumidor Final',
    });

    const rows = buildSubdiarioRows(makeInput({ facturasEmitidas: [fc] }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.categoria).toBe('-');
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
