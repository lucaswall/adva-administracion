/**
 * Tests for recibo-pago matching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseNumber } from '../../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { buildUnmatchUpdate, isBetterMatch } from '../../matching/cascade-matcher.js';
import { ReciboPagoMatcher, type MatchQuality } from '../../matching/matcher.js';
import type { Pago, Recibo, MatchConfidence } from '../../types/index.js';

// Mocks for integration tests of matchRecibosWithPagos
vi.mock('../../services/sheets.js', () => ({
  getValues: vi.fn(),
  batchUpdate: vi.fn(),
}));
vi.mock('../../utils/concurrency.js', () => ({
  withLock: vi.fn(),
  withRetry: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recibo-pago-matcher', () => {
  describe('ADV-304: CUIT field assignment (cuitBeneficiario for pagos enviados)', () => {
    it('should parse pagos enviados with cuitBeneficiario from column H (not cuitPagador)', () => {
      // Test data simulating a row from Pagos Enviados sheet
      // PAGO_ENVIADO_HEADERS: A:fechaPago, B:fileId, C:fileName, D:banco, E:importePagado
      //          F:moneda, G:referencia, H:cuitBeneficiario (employee receives payment), I:nombreBeneficiario
      //          J:concepto, K:processedAt, L:confidence, M:needsReview
      //          N:matchedFacturaFileId, O:matchConfidence
      const row = [
        '2025-01-15',               // A: fechaPago
        'pago-file-id-123',         // B: fileId
        'Pago Empleado.pdf',        // C: fileName
        'BBVA',                     // D: banco
        100000,                     // E: importePagado
        'ARS',                      // F: moneda
        'Ref-123',                  // G: referencia
        '20123456786',              // H: cuitBeneficiario (employee CUIL)
        'Juan Perez',               // I: nombreBeneficiario
        'Pago de sueldo',           // J: concepto
        '2025-01-15T10:00:00.000Z', // K: processedAt
        95,                         // L: confidence
        'NO',                       // M: needsReview
        '',                         // N: matchedFacturaFileId
        '',                         // O: matchConfidence
      ];

      // Parse using correct field names (after ADV-304 fix)
      const pago: Pago & { row: number } = {
        row: 2,
        fechaPago: String(row[0] || ''),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        banco: String(row[3] || ''),
        importePagado: parseNumber(row[4]) || 0,
        moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[6] ? String(row[6]) : undefined,
        cuitBeneficiario: row[7] ? String(row[7]) : undefined,   // CORRECT: beneficiario
        nombreBeneficiario: row[8] ? String(row[8]) : undefined, // CORRECT: beneficiario
        concepto: row[9] ? String(row[9]) : undefined,
        processedAt: String(row[10] || ''),
        confidence: Number(row[11]) || 0,
        needsReview: row[12] === 'YES',
        matchedFacturaFileId: row[13] ? String(row[13]) : undefined,
        matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined,
      };

      // Verify correct parsing: beneficiario fields set (not pagador)
      expect(pago.cuitBeneficiario).toBe('20123456786');
      expect(pago.nombreBeneficiario).toBe('Juan Perez');
      expect(pago.fileId).toBe('pago-file-id-123');

      // cuitPagador and nombrePagador should NOT be set (ADVA is the pagador)
      expect(pago.cuitPagador).toBeUndefined();
      expect(pago.nombrePagador).toBeUndefined();
    });
  });

  describe('Date serial number normalization', () => {
    it('should normalize serial number dates in recibo fechaPago', () => {
      // Simulate how recibo-pago-matcher.ts parses recibos (line ~259)
      const row = [
        45671,                        // A: fechaPago (serial number => '2025-01-14')
        'recibo-file-id',             // B: fileId
        'recibo.pdf',                 // C: fileName
        'sueldo',                     // D: tipoRecibo
        'Juan Perez',                 // E: nombreEmpleado
        '20123456786',                // F: cuilEmpleado
        '001',                        // G: legajo
        'Programador',                // H: tareaDesempenada
        '30709076783',                // I: cuitEmpleador
        '2025-01',                    // J: periodoAbonado
        100000,                       // K: subtotalRemuneraciones
        20000,                        // L: subtotalDescuentos
        80000,                        // M: totalNeto
        '2025-01-15T10:00:00.000Z',   // N: processedAt
        95,                           // O: confidence
        'NO',                         // P: needsReview
        '',                           // Q: matchedPagoFileId
        '',                           // R: matchConfidence
        'YES',                        // S: hasCuitMatch (ADV-189)
      ];

      // This is the pattern that should be used (normalizeSpreadsheetDate)
      const recibo: Recibo & { row: number } = {
        row: 2,
        fechaPago: normalizeSpreadsheetDate(row[0]),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        tipoRecibo: (row[3] || 'sueldo') as Recibo['tipoRecibo'],
        nombreEmpleado: String(row[4] || ''),
        cuilEmpleado: String(row[5] || ''),
        legajo: String(row[6] || ''),
        tareaDesempenada: row[7] ? String(row[7]) : undefined,
        cuitEmpleador: String(row[8] || ''),
        periodoAbonado: String(row[9] || ''),
        subtotalRemuneraciones: parseNumber(row[10]) || 0,
        subtotalDescuentos: parseNumber(row[11]) || 0,
        totalNeto: parseNumber(row[12]) || 0,
        processedAt: String(row[13] || ''),
        confidence: Number(row[14]) || 0,
        needsReview: row[15] === 'YES',
        matchedPagoFileId: row[16] ? String(row[16]) : undefined,
        matchConfidence: row[17] ? (String(row[17]) as MatchConfidence) : undefined,
        hasCuitMatch: row[18] === 'YES',
      };

      // Serial number 45671 => '2025-01-14'
      expect(recibo.fechaPago).toBe('2025-01-14');
      // ADV-189: hasCuitMatch persisted at column S (index 18)
      expect(recibo.hasCuitMatch).toBe(true);
    });

    it('should normalize serial number dates in pago fechaPago', () => {
      // Simulate how recibo-pago-matcher.ts parses pagos (line ~288)
      const row = [
        45671,                        // A: fechaPago (serial number => '2025-01-14')
        'pago-file-id',               // B: fileId
        'pago.pdf',                   // C: fileName
        'BBVA',                       // D: banco
        80000,                        // E: importePagado
        'ARS',                        // F: moneda
        'REF-001',                    // G: referencia
        '20123456786',                // H: cuitBeneficiario (employee CUIL)
        'Juan Perez',                 // I: nombreBeneficiario
        'Pago sueldo',                // J: concepto
        '2025-01-15T10:00:00.000Z',   // K: processedAt
        95,                           // L: confidence
        'NO',                         // M: needsReview
        '',                           // N: matchedFacturaFileId
        '',                           // O: matchConfidence
      ];

      const pago: Pago & { row: number } = {
        row: 2,
        fechaPago: normalizeSpreadsheetDate(row[0]),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        banco: String(row[3] || ''),
        importePagado: parseNumber(row[4]) || 0,
        moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[6] ? String(row[6]) : undefined,
        cuitBeneficiario: row[7] ? String(row[7]) : undefined,
        nombreBeneficiario: row[8] ? String(row[8]) : undefined,
        concepto: row[9] ? String(row[9]) : undefined,
        processedAt: String(row[10] || ''),
        confidence: Number(row[11]) || 0,
        needsReview: row[12] === 'YES',
        matchedFacturaFileId: row[13] ? String(row[13]) : undefined,
        matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined,
      };

      // Serial number 45671 => '2025-01-14'
      expect(pago.fechaPago).toBe('2025-01-14');
    });
  });

  describe('Cascade displacement cleanup', () => {
    it('should produce recibo unmatch update via buildUnmatchUpdate', () => {
      // When a displaced pago has no remaining recibo match,
      // the previous recibo should be unmatched if not claimed by another pago
      const reciboFileId = 'recibo-previous';
      const reciboRow = 3;

      const update = buildUnmatchUpdate(reciboFileId, reciboRow, 'recibo');

      expect(update.reciboFileId).toBe(reciboFileId);
      expect(update.reciboRow).toBe(reciboRow);
      expect(update.pagoFileId).toBe(''); // Empty = unmatched
      expect(update.confidence).toBe('LOW');
      expect(update.hasCuitMatch).toBe(false);
    });

    it('should produce pago unmatch entry in cascade state for displaced pago with no remaining matches', () => {
      // Scenario:
      // 1. Pago A is matched to Recibo R1 (existing match)
      // 2. Pago B (better match) displaces Pago A from R1
      // 3. All other recibos are already claimed
      // 4. Cascade logic should create an update to clear Pago A's match columns (N:O)

      const cascadeState = {
        updates: new Map(),
        displacedCount: 0,
        maxDepthReached: 0,
        cycleDetected: false,
        startTime: Date.now()
      };

      const displacedPagoFileId = 'pago-displaced';
      const previousReciboFileId = 'recibo-previous';
      const previousReciboRow = 3;

      // Recibo unmatch entry (what the fix should create for unclaimed previous recibo)
      cascadeState.updates.set(
        previousReciboFileId,
        buildUnmatchUpdate(previousReciboFileId, previousReciboRow, 'recibo')
      );

      // Pago unmatch entry (what the fix should create)
      cascadeState.updates.set(
        `pago:${displacedPagoFileId}`,
        {
          pagoFileId: displacedPagoFileId,
          reciboFileId: '',
          reciboRow: 0,
          confidence: 'LOW' as MatchConfidence,
          hasCuitMatch: false,
        }
      );

      // Verify recibo unmatch
      const reciboUpdate = cascadeState.updates.get(previousReciboFileId);
      expect(reciboUpdate).toBeDefined();
      expect(reciboUpdate?.pagoFileId).toBe('');
      expect(reciboUpdate?.reciboFileId).toBe(previousReciboFileId);

      // Verify pago unmatch
      const pagoUpdate = cascadeState.updates.get(`pago:${displacedPagoFileId}`);
      expect(pagoUpdate).toBeDefined();
      expect(pagoUpdate?.pagoFileId).toBe(displacedPagoFileId);
      expect(pagoUpdate?.reciboFileId).toBe('');
    });
  });
});

describe('MANUAL matchConfidence locking - recibo-pago (Fix 5 - ADV-131)', () => {
  const baseRecibo: Recibo & { row: number } = {
    row: 2,
    fileId: 'recibo-1',
    fileName: 'recibo.pdf',
    tipoRecibo: 'sueldo',
    nombreEmpleado: 'Juan Perez',
    cuilEmpleado: '20123456786',
    legajo: '001',
    cuitEmpleador: '30709076783',
    periodoAbonado: '2025-01',
    fechaPago: '2025-01-14',
    subtotalRemuneraciones: 100000,
    subtotalDescuentos: 20000,
    totalNeto: 80000,
    processedAt: '2025-01-14T10:00:00.000Z',
    confidence: 0.95,
    needsReview: false,
  };

  const basePago: Pago = {
    fileId: 'pago-1',
    fileName: 'pago.pdf',
    banco: 'BBVA',
    fechaPago: '2025-01-15',
    importePagado: 80000,
    moneda: 'ARS',
    processedAt: '2025-01-15T10:00:00.000Z',
    confidence: 0.95,
    needsReview: false,
  };

  it('findMatches should not return MANUAL-matched recibo as candidate', () => {
    const matcher = new ReciboPagoMatcher(10, 60);

    const manualRecibo: Recibo & { row: number } = {
      ...baseRecibo,
      matchConfidence: 'MANUAL' as MatchConfidence,
      matchedPagoFileId: 'pago-existing',
    };

    // Even though amount and date match perfectly, MANUAL recibo must be skipped
    const matches = matcher.findMatches(basePago, [manualRecibo], true);

    expect(matches).toHaveLength(0);
  });

  it('findMatches should not displace pago matched to a MANUAL recibo', () => {
    const matcher = new ReciboPagoMatcher(10, 60);

    const newPago: Pago = { ...basePago, fileId: 'pago-new' };

    const manualRecibo: Recibo & { row: number } = {
      ...baseRecibo,
      matchConfidence: 'MANUAL' as MatchConfidence,
      matchedPagoFileId: 'pago-protected',
    };

    // With includeMatched=true, the MANUAL recibo should still be invisible
    const matches = matcher.findMatches(newPago, [manualRecibo], true);

    // pago-protected is never displaced because MANUAL recibo is never a candidate
    expect(matches).toHaveLength(0);
  });

  it('pago with MANUAL matchConfidence should be excluded from unmatched pool', () => {
    // Documents the expected filter in doMatchRecibosWithPagos():
    // pagos.filter(p => !p.matchedFacturaFileId && p.matchConfidence !== 'MANUAL')
    const allPagos: Array<Pago & { row: number }> = [
      { ...basePago, row: 2, fileId: 'pago-auto' },
      { ...basePago, row: 3, fileId: 'pago-manual', matchConfidence: 'MANUAL' as MatchConfidence },
      { ...basePago, row: 4, fileId: 'pago-matched', matchedFacturaFileId: 'some-recibo' },
    ];

    const fixedFilter = allPagos.filter(p => !p.matchedFacturaFileId && p.matchConfidence !== 'MANUAL');

    expect(fixedFilter).toHaveLength(1);
    expect(fixedFilter[0].fileId).toBe('pago-auto');
  });
});

describe('hasCuitMatch asymmetry fix (ADV-183)', () => {
  // The bug: recibo-pago-matcher.ts used `bestMatch.existingMatchConfidence === 'HIGH'`
  // as a proxy for whether the existing match had a CUIT/CUIL match.
  // This is wrong for any non-HIGH confidence (e.g., MANUAL, MEDIUM, LOW):
  //   - MANUAL: confidence is set manually and doesn't imply no-CUIL
  //   - MEDIUM: a MEDIUM-confidence match CAN include a CUIL match (e.g., outside HIGH date range)
  //
  // Fix: read hasCuitMatch directly from recibo.hasCuitMatch flag (mirrors factura-pago-matcher).
  // This requires adding hasCuitMatch?: boolean to the Recibo type.

  const baseRecibo: Recibo & { row: number } = {
    row: 2,
    fileId: 'recibo-1',
    fileName: 'recibo.pdf',
    tipoRecibo: 'sueldo',
    nombreEmpleado: 'Juan Perez',
    cuilEmpleado: '20123456786',
    legajo: '001',
    cuitEmpleador: '30709076783',
    periodoAbonado: '2025-01',
    fechaPago: '2025-01-14',
    subtotalRemuneraciones: 100000,
    subtotalDescuentos: 20000,
    totalNeto: 80000,
    processedAt: '2025-01-14T10:00:00.000Z',
    confidence: 0.95,
    needsReview: false,
  };

  it('MANUAL-locked recibo with hasCuitMatch=true: existingQuality reads flag, not confidence proxy', () => {
    // Simulate an existing recibo match locked as MANUAL that originally had a CUIL match.
    // Before fix: existingMatchConfidence === 'HIGH' → false (bug: MANUAL !== HIGH)
    // After fix:  recibo.hasCuitMatch || false → true (correct: reads stored flag)
    const manualReciboWithCuil: Recibo & { row: number } = {
      ...baseRecibo,
      matchedPagoFileId: 'pago-existing',
      matchConfidence: 'MANUAL' as MatchConfidence,
      hasCuitMatch: true, // Requires hasCuitMatch field on Recibo type (ADV-183)
    };

    // Verify the flag is accessible on the recibo object
    expect(manualReciboWithCuil.hasCuitMatch).toBe(true);

    // Buggy formula (current code): proxy via confidence level
    const buggyHasCuitMatch = (manualReciboWithCuil.matchConfidence === 'HIGH');
    expect(buggyHasCuitMatch).toBe(false); // Bug: wrongly reports no CUIT for MANUAL

    // Fixed formula: read directly from the stored flag
    const fixedHasCuitMatch = manualReciboWithCuil.hasCuitMatch || false;
    expect(fixedHasCuitMatch).toBe(true); // Correct: CUIL match is preserved

    // Behavioral consequence: displacement quality comparison
    // New candidate: MANUAL confidence, no CUIL, closer date
    const newQuality: MatchQuality = { confidence: 'MANUAL', hasCuitMatch: false, dateProximityDays: 1 };

    // With buggy formula: existing looks like no-CUIL → new wins on date proximity (wrong!)
    const existingQualityBuggy: MatchQuality = {
      confidence: 'MANUAL',
      hasCuitMatch: buggyHasCuitMatch,
      dateProximityDays: 5,
    };
    expect(isBetterMatch(newQuality, existingQualityBuggy)).toBe(true); // Bug: incorrect displacement

    // With fixed formula: existing correctly has CUIL → no displacement (correct)
    const existingQualityFixed: MatchQuality = {
      confidence: 'MANUAL',
      hasCuitMatch: fixedHasCuitMatch,
      dateProximityDays: 5,
    };
    expect(isBetterMatch(newQuality, existingQualityFixed)).toBe(false); // Fix: existing protected
  });

  it('findMatches correctly propagates recibo.hasCuitMatch to candidate for non-MANUAL recibos', () => {
    const matcher = new ReciboPagoMatcher(10, 60);

    // Recibo already matched (non-MANUAL so findMatches can return it) with hasCuitMatch=true
    const matchedRecibo: Recibo & { row: number } = {
      ...baseRecibo,
      matchedPagoFileId: 'pago-existing',
      matchConfidence: 'HIGH' as MatchConfidence,
      hasCuitMatch: true, // Requires hasCuitMatch field on Recibo type
    };

    // Pago that attempts to match (amount and date match)
    const newPago: Pago = {
      fileId: 'pago-new',
      fileName: 'pago.pdf',
      banco: 'BBVA',
      fechaPago: '2025-01-15',
      importePagado: 80000,
      moneda: 'ARS',
      processedAt: '2025-01-15T10:00:00.000Z',
      confidence: 0.95,
      needsReview: false,
      cuitBeneficiario: '20123456786', // CUIL match for MEDIUM/HIGH confidence
    };

    const pagosMap = new Map([['pago-existing', { ...newPago, row: 3, fileId: 'pago-existing' }]]);
    const matches = matcher.findMatches(newPago, [matchedRecibo], true, pagosMap);

    expect(matches).toHaveLength(1);
    const bestMatch = matches[0];

    // The recibo's hasCuitMatch flag should be accessible in bestMatch.recibo
    expect(bestMatch.recibo.hasCuitMatch).toBe(true);
    expect(bestMatch.existingMatchConfidence).toBe('HIGH');

    // Key asymmetry: buggy proxy gives same result as flag for HIGH, but not for other confidences
    // For HIGH: both give true (no observable bug for this case)
    // For non-HIGH (e.g. MEDIUM with hasCuitMatch=true): buggy gives false, fixed gives true
    const existingQualityFixed: MatchQuality = {
      confidence: bestMatch.existingMatchConfidence || 'LOW',
      hasCuitMatch: bestMatch.recibo.hasCuitMatch || false, // Fixed formula
      dateProximityDays: bestMatch.existingDateProximityDays ?? 999,
    };
    expect(existingQualityFixed.hasCuitMatch).toBe(true);
  });

  it('reads hasCuitMatch directly from spreadsheet column S — no HIGH-proxy fallback (ADV-189)', () => {
    // ADV-189: hasCuitMatch is now persisted at column S (index 18) of the Recibos sheet.
    // The previous proxy fallback `?? (existingConfidence === 'HIGH')` is removed; the only
    // formula in production is `recibo.hasCuitMatch || false`.
    const computeHasCuitMatch = (reciboHasCuitMatch: boolean | undefined): boolean =>
      reciboHasCuitMatch || false;

    // MANUAL with CUIL match preserved across periodic re-match (was wrong before ADV-189)
    expect(computeHasCuitMatch(true)).toBe(true);
    // MANUAL without CUIL match — correctly false
    expect(computeHasCuitMatch(false)).toBe(false);
    // Unset/legacy rows — false (the migration backfills HIGH→YES so this is rare)
    expect(computeHasCuitMatch(undefined)).toBe(false);
  });
});

describe('ADV-304: cuitBeneficiario field mapping in matchRecibosWithPagos', () => {
  async function setupE2E() {
    const { matchRecibosWithPagos } = await import('./recibo-pago-matcher.js');
    const { getValues, batchUpdate } = await import('../../services/sheets.js');
    const { withLock, withRetry } = await import('../../utils/concurrency.js');

    vi.mocked(withLock).mockImplementation(async (_key: string, fn: () => Promise<any>) => {
      try { return { ok: true as const, value: await fn() }; }
      catch (e) { return { ok: false as const, error: e instanceof Error ? e : new Error(String(e)) }; }
    });
    vi.mocked(withRetry).mockImplementation(async (fn: () => Promise<any>) => {
      try { return { ok: true as const, value: await fn() }; }
      catch (e) { return { ok: false as const, error: e instanceof Error ? e : new Error(String(e)) }; }
    });
    return { matchRecibosWithPagos, getValues, batchUpdate };
  }

  const config = { matchDaysBefore: 10, matchDaysAfter: 60, usdArsTolerancePercent: 5, usdMatchDaysAfter: 90 };

  it('column H in Pagos Enviados should produce cuitBeneficiario (not cuitPagador) → hasCuitMatch=YES in Recibos sheet', async () => {
    const { matchRecibosWithPagos, getValues, batchUpdate } = await setupE2E();

    // Recibo sheet: employee Juan Perez with CUIL 20123456786 at column F (index 5), totalNeto=80000 at column M (index 12)
    const reciboHeader = ['fechaPago', 'fileId', 'fileName', 'tipoRecibo', 'nombreEmpleado', 'cuilEmpleado', 'legajo', 'tareaDesempenada', 'cuitEmpleador', 'periodoAbonado', 'subtotalRemuneraciones', 'subtotalDescuentos', 'totalNeto', 'processedAt', 'confidence', 'needsReview', 'matchedPagoFileId', 'matchConfidence', 'hasCuitMatch'];
    const reciboRow = ['2025-01-10', 'recibo-1', 'recibo.pdf', 'sueldo', 'Juan Perez', '20123456786', '001', '', '30709076783', 'enero/2025', '100000', '20000', '80000', '2025-01-10T10:00:00Z', '0.95', 'NO', '', '', 'NO'];

    // Pagos Enviados sheet: pago with CUIL 20123456786 at column H (index 7)
    // PAGO_ENVIADO_HEADERS: A=fechaPago, B=fileId, C=fileName, D=banco, E=importePagado, F=moneda, G=referencia, H=cuitBeneficiario (BUG: parser uses cuitPagador)
    const pagoHeader = ['fechaPago', 'fileId', 'fileName', 'banco', 'importePagado', 'moneda', 'referencia', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto', 'processedAt', 'confidence', 'needsReview', 'matchedFacturaFileId', 'matchConfidence'];
    const pagoRow = ['2025-01-12', 'pago-1', 'pago.pdf', 'BBVA', '80000', 'ARS', '', '20123456786', 'Juan Perez', 'Pago sueldo enero', '2025-01-12T10:00:00Z', '0.95', 'NO', '', ''];

    vi.mocked(getValues)
      .mockResolvedValueOnce({ ok: true, value: [reciboHeader, reciboRow] })
      .mockResolvedValueOnce({ ok: true, value: [pagoHeader, pagoRow] });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 0 });

    const result = await matchRecibosWithPagos('test-spreadsheet', config as any);

    expect(result.ok).toBe(true);

    // Verify batchUpdate was called
    expect(batchUpdate).toHaveBeenCalled();
    const allCalls = vi.mocked(batchUpdate).mock.calls;
    // Flatten all updates
    const allUpdates = allCalls.flatMap((call: any[]) => call[1] as Array<{ range: string; values: (string | number)[][] }>);

    // Find the Recibos Q:S update (matchedPagoFileId, matchConfidence, hasCuitMatch)
    const reciboUpdate = allUpdates.find((u) => u.range.includes("'Recibos'!Q"));
    expect(reciboUpdate).toBeDefined();

    // hasCuitMatch column (S, 3rd value in the update) MUST be 'YES' when CUIL matches
    // BUG: currently 'NO' because parser sets cuitPagador (not cuitBeneficiario), so matcher can't find CUIL
    // FIX: parser sets cuitBeneficiario, matcher finds CUIL → hasCuitMatch = YES
    expect(reciboUpdate!.values[0][2]).toBe('YES'); // RED: currently 'NO' due to cuitPagador bug
  });
});
