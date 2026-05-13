/**
 * Subdiario de Ventas chrome module (ADV-266)
 *
 * Applies one-time idempotent sheet chrome to the Comprobantes sheet:
 * column widths, text wrap, banding, header background, ARS locale,
 * view-only protected range, and number formats.
 *
 * Runs once per server boot. Reads current state via spreadsheets.get
 * and only emits a batchUpdate when state diverges from target.
 * Failures are NOT fatal — the boot hook wraps in try/catch.
 */

import type { sheets_v4 } from 'googleapis';
import type { Result } from '../types/index.js';
import { getSpreadsheetProperties, executeBatchRequests } from './sheets.js';
import { info } from '../utils/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** fields mask for the single state-check read */
const FIELDS_MASK =
  'properties.locale,' +
  'sheets(' +
  'properties(sheetId,title,gridProperties(columnCount,frozenRowCount)),' +
  'data(columnMetadata(pixelSize),rowData(values(effectiveFormat(wrapStrategy,backgroundColor,numberFormat)))),' +
  'bandedRanges,protectedRanges)';

/** Sheet name inside the Subdiario workbook */
const COMPROBANTES_SHEET = 'Comprobantes';

/** Description used to identify our protected range (exact match for idempotency) */
export const PROTECTED_RANGE_DESCRIPTION = 'Sistema — Subdiario de Ventas auto-sincronizado';

/** Target spreadsheet locale */
const TARGET_LOCALE = 'es_AR';

/**
 * Target pixel widths for columns A–M (13 columns, 0-indexed).
 * fecha · cod · tipo · nro · cliente · cuit · condicion · total ·
 * concepto · categoria · fechaCobro · recibido · notas
 */
export const TARGET_WIDTHS = [90, 50, 50, 130, 240, 110, 180, 110, 320, 100, 110, 110, 380];

// ─── Color helpers ────────────────────────────────────────────────────────────

type Color = { red?: number | null; green?: number | null; blue?: number | null };

const GREY_85: Color = { red: 0.85, green: 0.85, blue: 0.85 };
const WHITE: Color = { red: 1, green: 1, blue: 1 };
const GREY_96: Color = { red: 0.96, green: 0.96, blue: 0.96 };

/** Returns true when `actual` is within ε of `target` for all RGB components. */
function colorMatches(actual: Color | null | undefined, target: Color): boolean {
  if (!actual) return false;
  const eps = 0.01;
  return (
    Math.abs((actual.red ?? 0) - (target.red ?? 0)) < eps &&
    Math.abs((actual.green ?? 0) - (target.green ?? 0)) < eps &&
    Math.abs((actual.blue ?? 0) - (target.blue ?? 0)) < eps
  );
}

/** Returns true when `actual` matches `expectedType` and `expectedPattern`. */
function numberFormatMatches(
  actual: { type?: string | null; pattern?: string | null } | null | undefined,
  expectedType: string,
  expectedPattern: string
): boolean {
  if (!actual) return false;
  return actual.type === expectedType && actual.pattern === expectedPattern;
}

// ─── Pure decision function ───────────────────────────────────────────────────

/**
 * Pure function: given the raw spreadsheet state from `spreadsheets.get`
 * and the target `sheetId`, computes the minimal set of batchUpdate requests
 * needed to align the Comprobantes sheet chrome with the target state.
 *
 * Returns an empty array when state already matches (no-op path).
 *
 * @internal exported for testing
 */
export function computeChromeBatchUpdate(
  state: sheets_v4.Schema$Spreadsheet,
  sheetId: number
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];

  // Locate the target sheet
  const sheet = state.sheets?.find((s) => s.properties?.sheetId === sheetId);
  const data = sheet?.data?.[0];
  const columnMetadata = data?.columnMetadata ?? [];
  const rowData = data?.rowData ?? [];
  const headerRow = rowData[0]?.values ?? [];
  const dataRow = rowData[1]?.values ?? [];
  const bandedRanges = sheet?.bandedRanges ?? [];
  const protectedRanges = sheet?.protectedRanges ?? [];
  const locale = state.properties?.locale;

  // ── 1. Column widths (emit updateDimensionProperties per divergent column) ──
  for (let i = 0; i < TARGET_WIDTHS.length; i++) {
    const current = columnMetadata[i]?.pixelSize;
    const target = TARGET_WIDTHS[i];
    if (current !== target) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: i,
            endIndex: i + 1,
          },
          properties: { pixelSize: target },
          fields: 'pixelSize',
        },
      });
    }
  }

  // ── 2. Text wrap on data range A2:M (check wrapStrategy from data row col A) ──
  const wrapStrategy = dataRow[0]?.effectiveFormat?.wrapStrategy;
  if (wrapStrategy !== 'WRAP') {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1, // row 2 (0-indexed)
          startColumnIndex: 0,
          endColumnIndex: 13,
          // endRowIndex omitted → open-ended (applies to all data rows)
        },
        cell: {
          userEnteredFormat: { wrapStrategy: 'WRAP' },
        },
        fields: 'userEnteredFormat.wrapStrategy',
      },
    });
  }

  // ── 3. Banding on Comprobantes!A2:M ──────────────────────────────────────────
  const bandingRange: sheets_v4.Schema$GridRange = {
    sheetId,
    startRowIndex: 1,
    startColumnIndex: 0,
    endColumnIndex: 13,
  };
  const existingBanding = bandedRanges[0];
  if (!existingBanding) {
    // No banding exists → addBanding
    requests.push({
      addBanding: {
        bandedRange: {
          range: bandingRange,
          rowProperties: {
            headerColor: GREY_85,
            firstBandColor: WHITE,
            secondBandColor: GREY_96,
          },
        },
      },
    });
  } else {
    // Banding exists → check colors; updateBanding only if different
    const rp = existingBanding.rowProperties;
    const headerMatches = colorMatches(rp?.headerColor, GREY_85);
    const firstMatches = colorMatches(rp?.firstBandColor, WHITE);
    const secondMatches = colorMatches(rp?.secondBandColor, GREY_96);
    if (!headerMatches || !firstMatches || !secondMatches) {
      requests.push({
        updateBanding: {
          bandedRange: {
            bandedRangeId: existingBanding.bandedRangeId,
            range: existingBanding.range ?? bandingRange,
            rowProperties: {
              headerColor: GREY_85,
              firstBandColor: WHITE,
              secondBandColor: GREY_96,
            },
          },
          fields: 'rowProperties',
        },
      });
    }
  }

  // ── 4. Header background grey on row 1, cols A-M ─────────────────────────────
  const headerBg = headerRow[0]?.effectiveFormat?.backgroundColor;
  if (!colorMatches(headerBg, GREY_85)) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 13,
        },
        cell: {
          userEnteredFormat: { backgroundColor: GREY_85 },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  // ── 5. Protected range (warningOnly) on Comprobantes!A2:M ───────────────────
  const alreadyProtected = protectedRanges.some(
    (pr) => pr.description === PROTECTED_RANGE_DESCRIPTION
  );
  if (!alreadyProtected) {
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 13,
          },
          description: PROTECTED_RANGE_DESCRIPTION,
          warningOnly: true,
        },
      },
    });
  }

  // ── 6. total (col H = index 7) number format: #,##0.00 ──────────────────────
  const totalFmt = dataRow[7]?.effectiveFormat?.numberFormat;
  if (!numberFormatMatches(totalFmt, 'NUMBER', '#,##0.00')) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 7,
          endColumnIndex: 8,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  // ── 7a. fecha (col A = index 0) date format: yyyy-mm-dd ──────────────────────
  const fechaFmt = dataRow[0]?.effectiveFormat?.numberFormat;
  if (!numberFormatMatches(fechaFmt, 'DATE', 'yyyy-mm-dd')) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  // ── 7b. fechaCobro (col K = index 10) date format: yyyy-mm-dd ────────────────
  const fechaCobroFmt = dataRow[10]?.effectiveFormat?.numberFormat;
  if (!numberFormatMatches(fechaCobroFmt, 'DATE', 'yyyy-mm-dd')) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 10,
          endColumnIndex: 11,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  // ── 8. Spreadsheet locale ─────────────────────────────────────────────────────
  if (locale !== TARGET_LOCALE) {
    requests.push({
      updateSpreadsheetProperties: {
        properties: { locale: TARGET_LOCALE },
        fields: 'locale',
      },
    });
  }

  return requests;
}

// ─── Orchestration layer ──────────────────────────────────────────────────────

/**
 * Ensures the Subdiario de Ventas Comprobantes sheet has the correct visual chrome:
 * column widths, text wrap, alternating-row banding, header background, protected range,
 * number/date formats, and spreadsheet locale (es_AR).
 *
 * Runs once per server boot (called from `initializeSubdiarioChrome` in server.ts).
 * Reads current state via a single `spreadsheets.get` call, then emits ONE `batchUpdate`
 * containing only the requests that diverge from the target state.
 *
 * Returns `{ changesApplied: 0 }` when state already matches — no API write issued.
 *
 * **FAILURES ARE NOT FATAL** — the boot hook must wrap in try/catch and log at warn.
 *
 * @param spreadsheetId - Subdiario de Ventas spreadsheet ID
 * @param sheetId - Numeric ID of the Comprobantes sheet (from getSheetMetadata)
 * @returns changesApplied count or error
 */
export async function ensureSubdiarioChrome(
  spreadsheetId: string,
  sheetId: number
): Promise<Result<{ changesApplied: number }, Error>> {
  // Single state-check read
  const stateResult = await getSpreadsheetProperties(spreadsheetId, FIELDS_MASK, [
    `${COMPROBANTES_SHEET}!A1:M2`,
  ]);
  if (!stateResult.ok) return stateResult;

  // Compute divergent requests (pure)
  const requests = computeChromeBatchUpdate(stateResult.value, sheetId);

  if (requests.length === 0) {
    return { ok: true, value: { changesApplied: 0 } };
  }

  // Emit single batchUpdate with only divergent requests
  const updateResult = await executeBatchRequests(spreadsheetId, requests);
  if (!updateResult.ok) return updateResult;

  info('Subdiario chrome applied', {
    module: 'subdiario-chrome',
    phase: 'ensure-chrome',
    spreadsheetId,
    changesApplied: requests.length,
  });

  return { ok: true, value: { changesApplied: requests.length } };
}
