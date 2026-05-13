/**
 * Tests for Subdiario de Ventas chrome module (ADV-266)
 * Tests ensureSubdiarioChrome and the pure computeChromeBatchUpdate decision function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { sheets_v4 } from 'googleapis';

// ─── Mock sheets.js (must be before imports) ─────────────────────────────────

vi.mock('./sheets.js', () => ({
  getSpreadsheetProperties: vi.fn(),
  executeBatchRequests: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { ensureSubdiarioChrome, computeChromeBatchUpdate } from './subdiario-chrome.js';
import * as sheets from './sheets.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SPREADSHEET_ID = 'spreadsheet-abc123';
const SHEET_ID = 42;

/** Target column pixel widths (A-M, 13 cols) matching the chrome module's TARGET_WIDTHS */
const TARGET_WIDTHS = [90, 50, 50, 130, 240, 110, 180, 110, 320, 100, 110, 110, 380];

const PROTECTED_RANGE_DESCRIPTION = 'Sistema — Subdiario de Ventas auto-sincronizado';

// ─── State builders ───────────────────────────────────────────────────────────

/**
 * Builds a state with nothing configured (new workbook, locale en_US).
 * All chrome requests should be emitted.
 */
function makeEmptyState(sheetId = SHEET_ID): sheets_v4.Schema$Spreadsheet {
  return {
    properties: { locale: 'en_US' },
    sheets: [
      {
        properties: { sheetId },
        data: [{ columnMetadata: [], rowData: [] }],
        bandedRanges: [],
        protectedRanges: [],
      },
    ],
  };
}

/**
 * Builds a fully-aligned state (all chrome already applied correctly).
 * No chrome requests should be emitted.
 */
function makeAlignedState(sheetId = SHEET_ID): sheets_v4.Schema$Spreadsheet {
  return {
    properties: { locale: 'es_AR' },
    sheets: [
      {
        properties: { sheetId },
        data: [
          {
            columnMetadata: TARGET_WIDTHS.map((pixelSize) => ({ pixelSize })),
            rowData: [
              {
                // Row 1: header row — grey background on all 13 cols
                values: Array(13)
                  .fill(null)
                  .map(() => ({
                    effectiveFormat: {
                      backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 },
                    },
                  })),
              },
              {
                // Row 2: first data row — WRAP + correct number formats
                values: [
                  {
                    effectiveFormat: {
                      wrapStrategy: 'WRAP',
                      numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
                    },
                  }, // A: fecha
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // B: cod
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // C: tipo
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // D: nro
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // E: cliente
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // F: cuit
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // G: condicion
                  {
                    effectiveFormat: {
                      wrapStrategy: 'WRAP',
                      numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
                    },
                  }, // H: total
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // I: concepto
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // J: categoria
                  {
                    effectiveFormat: {
                      wrapStrategy: 'WRAP',
                      numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
                    },
                  }, // K: fechaCobro
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // L: recibido
                  { effectiveFormat: { wrapStrategy: 'WRAP' } }, // M: notas
                ],
              },
            ],
          },
        ],
        bandedRanges: [
          {
            bandedRangeId: 1,
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 13,
            },
            rowProperties: {
              headerColor: { red: 0.85, green: 0.85, blue: 0.85 },
              firstBandColor: { red: 1, green: 1, blue: 1 },
              secondBandColor: { red: 0.96, green: 0.96, blue: 0.96 },
            },
          },
        ],
        protectedRanges: [
          {
            protectedRangeId: 1,
            description: PROTECTED_RANGE_DESCRIPTION,
          },
        ],
      },
    ],
  };
}

// ─── computeChromeBatchUpdate pure function tests ─────────────────────────────

describe('computeChromeBatchUpdate', () => {
  // Test 1: Empty / missing state → ALL target requests emitted
  it('empty state (new workbook, locale en_US) → emits all target requests', () => {
    const requests = computeChromeBatchUpdate(makeEmptyState(), SHEET_ID);

    const widthRequests = requests.filter((r) => r.updateDimensionProperties);
    const wrapRequests = requests.filter((r) => r.repeatCell?.fields?.includes('wrapStrategy'));
    const addBandingRequests = requests.filter((r) => r.addBanding);
    const headerBgRequests = requests.filter((r) =>
      r.repeatCell?.fields?.includes('backgroundColor')
    );
    const protectedRangeRequests = requests.filter((r) => r.addProtectedRange);
    const numberFormatRequests = requests.filter((r) =>
      r.repeatCell?.fields?.includes('numberFormat')
    );
    const localeRequests = requests.filter((r) => r.updateSpreadsheetProperties);

    expect(widthRequests).toHaveLength(13);
    expect(wrapRequests).toHaveLength(1);
    expect(addBandingRequests).toHaveLength(1);
    expect(headerBgRequests).toHaveLength(1);
    expect(protectedRangeRequests).toHaveLength(1);
    expect(numberFormatRequests).toHaveLength(3); // fecha (A), total (H), fechaCobro (K)
    expect(localeRequests).toHaveLength(1);
  });

  // Test 2: Fully aligned state → zero requests (no batchUpdate needed)
  it('fully aligned state → zero requests', () => {
    const requests = computeChromeBatchUpdate(makeAlignedState(), SHEET_ID);
    expect(requests).toHaveLength(0);
  });

  // Test 3: Partial divergence — widths match, locale is en_US → only locale request
  it('widths match but locale is en_US → only updateSpreadsheetProperties for locale', () => {
    const state = makeAlignedState();
    state.properties!.locale = 'en_US';

    const requests = computeChromeBatchUpdate(state, SHEET_ID);

    expect(requests).toHaveLength(1);
    expect(requests[0].updateSpreadsheetProperties).toBeDefined();
    expect(requests[0].updateSpreadsheetProperties?.properties?.locale).toBe('es_AR');
    expect(requests[0].updateSpreadsheetProperties?.fields).toBe('locale');
  });

  // Test 4: Existing banding with different colors → updateBanding (NOT addBanding)
  it('existing banding with different colors → updateBanding with adopted bandedRangeId', () => {
    const state = makeAlignedState();
    // Replace banding with one that has wrong header color
    state.sheets![0].bandedRanges = [
      {
        bandedRangeId: 99,
        range: {
          sheetId: SHEET_ID,
          startRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 13,
        },
        rowProperties: {
          headerColor: { red: 0.5, green: 0.5, blue: 0.5 }, // wrong color
          firstBandColor: { red: 1, green: 1, blue: 1 },
          secondBandColor: { red: 0.96, green: 0.96, blue: 0.96 },
        },
      },
    ];

    const requests = computeChromeBatchUpdate(state, SHEET_ID);

    const addBandingRequests = requests.filter((r) => r.addBanding);
    const updateBandingRequests = requests.filter((r) => r.updateBanding);

    expect(addBandingRequests).toHaveLength(0); // must NOT emit addBanding
    expect(updateBandingRequests).toHaveLength(1);
    expect(updateBandingRequests[0].updateBanding?.bandedRange?.bandedRangeId).toBe(99);
  });

  // Test 5: Existing protected range with our description → no addProtectedRange
  it('existing protected range with our description → no addProtectedRange request', () => {
    // Start from empty state (everything diverged) but add the protected range already
    const state = makeEmptyState();
    state.sheets![0].protectedRanges = [
      {
        protectedRangeId: 5,
        description: PROTECTED_RANGE_DESCRIPTION,
      },
    ];

    const requests = computeChromeBatchUpdate(state, SHEET_ID);

    const protectedRangeRequests = requests.filter((r) => r.addProtectedRange);
    expect(protectedRangeRequests).toHaveLength(0);

    // Other requests should still be emitted (widths, wrap, banding, etc.)
    expect(requests.length).toBeGreaterThan(0);
  });

  // Test 9: One column width matches, twelve diverge → 12 updateDimensionProperties
  it('one column width matches (col 0), twelve diverge → 12 updateDimensionProperties not 13', () => {
    const state = makeAlignedState();
    // Set all widths wrong EXCEPT col 0 (fecha = 90px matches)
    state.sheets![0].data![0].columnMetadata = TARGET_WIDTHS.map((w, i) => ({
      pixelSize: i === 0 ? w : 999, // col 0 matches, rest diverge
    }));

    const requests = computeChromeBatchUpdate(state, SHEET_ID);

    const widthRequests = requests.filter((r) => r.updateDimensionProperties);
    expect(widthRequests).toHaveLength(12);

    // Verify col 0 is not in the requests
    const col0Requests = widthRequests.filter(
      (r) => r.updateDimensionProperties?.range?.startIndex === 0
    );
    expect(col0Requests).toHaveLength(0);
  });
});

// ─── ensureSubdiarioChrome orchestration tests ───────────────────────────────

describe('ensureSubdiarioChrome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sheets.executeBatchRequests).mockResolvedValue({ ok: true, value: undefined });
  });

  // Test 6: spreadsheets.get failure → Result.err, no batchUpdate
  it('getSpreadsheetProperties failure → Result.err propagated; no batchUpdate called', async () => {
    vi.mocked(sheets.getSpreadsheetProperties).mockResolvedValue({
      ok: false,
      error: new Error('API unavailable'),
    });

    const result = await ensureSubdiarioChrome(SPREADSHEET_ID, SHEET_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API unavailable');
    }
    expect(sheets.executeBatchRequests).not.toHaveBeenCalled();
  });

  // Test 7: batchUpdate failure → Result.err
  it('batchUpdate failure → Result.err propagated', async () => {
    vi.mocked(sheets.getSpreadsheetProperties).mockResolvedValue({
      ok: true,
      value: makeEmptyState(), // diverged state → batchUpdate will be attempted
    });
    vi.mocked(sheets.executeBatchRequests).mockResolvedValue({
      ok: false,
      error: new Error('BatchUpdate failed'),
    });

    const result = await ensureSubdiarioChrome(SPREADSHEET_ID, SHEET_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('BatchUpdate failed');
    }
  });

  // Test 8: Re-run on identical (aligned) state → no-op both times
  it('re-run on identical aligned state → changesApplied 0 both times; no batchUpdate', async () => {
    vi.mocked(sheets.getSpreadsheetProperties).mockResolvedValue({
      ok: true,
      value: makeAlignedState(),
    });

    const result1 = await ensureSubdiarioChrome(SPREADSHEET_ID, SHEET_ID);
    const result2 = await ensureSubdiarioChrome(SPREADSHEET_ID, SHEET_ID);

    expect(result1).toEqual({ ok: true, value: { changesApplied: 0 } });
    expect(result2).toEqual({ ok: true, value: { changesApplied: 0 } });
    expect(sheets.executeBatchRequests).not.toHaveBeenCalled();
  });
});
