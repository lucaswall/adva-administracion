/**
 * Movimientos reader service
 * Reads bank movements from per-month sheets for matching
 */

import type { Result, MovimientoRow } from '../types/index.js';
import { PARALLEL_SHEET_READ_CHUNK_SIZE } from '../config.js';
import { getSheetMetadata, getValues, type CellValue } from './sheets.js';
import { parseNumber } from '../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../utils/date.js';
import { warn, debug } from '../utils/logger.js';
import { buildHeaderIndex, MOVIMIENTOS_BANCARIO_SHEET } from '../constants/spreadsheet-headers.js';

/**
 * Labels to skip (special rows, not transactions)
 */
const SKIP_LABELS = ['SALDO INICIAL', 'SALDO FINAL'];

/**
 * Pattern for YYYY-MM format sheet names
 */
const YYYY_MM_PATTERN = /^\d{4}-\d{2}$/;

/**
 * Checks if a row is a special row (SALDO INICIAL, SALDO FINAL, etc.)
 * These rows should be skipped when processing transactions
 *
 * @param concepto - The concepto field value
 * @returns True if the row is a special row that should be skipped
 */
export function isSpecialRow(concepto: string): boolean {
  if (!concepto) return false;
  const normalized = concepto.trim().toUpperCase();
  return SKIP_LABELS.some(label => normalized.startsWith(label));
}

/**
 * Checks if a header row is the bank movimientos schema.
 * Bank (9-col): fecha, concepto, debito, credito, saldo, saldoCalculado, matchedFileId, matchedType, detalle
 * Bank (8-col legacy): same minus matchedType
 * Card (6-col): fecha, descripcion, nroCupon, pesos, dolares, detalle
 * Broker (10-col): descripcion, cantidadVN, saldo, precio, bruto, arancel, iva, neto, fechaConcertacion, fechaLiquidacion
 *
 * The matcher writes to columns G/H/I (matchedFileId, matchedType, detalle).
 * Index 6 = matchedFileId is the unique-to-bank invariant across both
 * 9-col (current) and 8-col (legacy) bank schemas, while card/broker schemas
 * have something else (or nothing) at that index. Skipping when this
 * invariant is missing prevents the matcher from writing rogue cells into
 * card/broker sheets where columns G/H/I belong to a different schema.
 *
 * @param header - First row of the sheet (header)
 * @returns True if the header matches the bank schema
 */
export function isBankMovimientosHeader(header: CellValue[]): boolean {
  if (!header || header.length < 7) return false;
  const norm = (v: CellValue): string => String(v || '').trim().toLowerCase();
  return norm(header[6]) === 'matchedfileid';
}

/**
 * Normalizes a raw matchedType value from the spreadsheet.
 * Handles case-insensitive input (e.g., 'manual' → 'MANUAL').
 *
 * @param raw - Raw cell value from the spreadsheet
 * @returns Normalized matchedType: 'AUTO', 'MANUAL', or ''
 */
function parseMatchedType(raw: unknown): MovimientoRow['matchedType'] {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'AUTO') return 'AUTO';
  if (s === 'MANUAL') return 'MANUAL';
  return '';
}

// Header-derived indices for bank movimientos rows (ADV-332)
const movCol = buildHeaderIndex(MOVIMIENTOS_BANCARIO_SHEET.headers);

/**
 * Parses a single row into a MovimientoRow object using header-derived indices.
 *
 * @param row - Raw cell values from the spreadsheet
 * @param sheetName - Name of the sheet (e.g., "2025-01")
 * @param rowNumber - 1-indexed row number in the sheet
 * @returns MovimientoRow or null if the row should be skipped
 */
function parseMovimientoRow(
  row: CellValue[],
  sheetName: string,
  rowNumber: number
): MovimientoRow | null {
  const concepto = String(row[movCol('concepto')] || '');
  if (isSpecialRow(concepto)) return null;

  return {
    sheetName,
    rowNumber,
    fecha: normalizeSpreadsheetDate(row[movCol('fecha')]),
    concepto,
    debito: parseNumber(row[movCol('debito')]),
    credito: parseNumber(row[movCol('credito')]),
    saldo: parseNumber(row[movCol('saldo')]),
    saldoCalculado: parseNumber(row[movCol('saldoCalculado')]),
    matchedFileId: String(row[movCol('matchedFileId')] || ''),
    matchedType: parseMatchedType(row[movCol('matchedType')]),
    detalle: String(row[movCol('detalle')] || ''),
  };
}

/**
 * Gets sheet names matching YYYY-MM pattern for current and previous year
 * Uses getSheetMetadata() - 1 API call to discover all sheets
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param currentYear - Current year (e.g., 2026)
 * @returns Array of sheet names to process
 */
export async function getRecentMovimientoSheets(
  spreadsheetId: string,
  currentYear: number
): Promise<Result<string[], Error>> {
  const metadataResult = await getSheetMetadata(spreadsheetId);
  if (!metadataResult.ok) return metadataResult;

  const previousYear = currentYear - 1;
  const allowedYears = [currentYear, previousYear];

  const recentSheets = metadataResult.value
    .filter(sheet => {
      // Must match YYYY-MM pattern
      if (!YYYY_MM_PATTERN.test(sheet.title)) return false;

      // Extract year and check if it's current or previous year
      const year = parseInt(sheet.title.substring(0, 4), 10);
      return allowedYears.includes(year);
    })
    .map(sheet => sheet.title);

  debug('Found recent movimiento sheets', {
    module: 'movimientos-reader',
    spreadsheetId,
    currentYear,
    sheetsFound: recentSheets.length,
  });

  return { ok: true, value: recentSheets };
}

/**
 * Reads movimientos from a specific month sheet
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param sheetName - Sheet name (e.g., "2025-01")
 * @returns Array of MovimientoRow objects (excludes SALDO INICIAL/FINAL)
 */
export async function readMovimientosForPeriod(
  spreadsheetId: string,
  sheetName: string
): Promise<Result<MovimientoRow[], Error>> {
  // Use quoted sheet name for A1 notation (handles special characters)
  const range = `'${sheetName}'!A:I`;

  const valuesResult = await getValues(spreadsheetId, range);
  if (!valuesResult.ok) return valuesResult;

  const data = valuesResult.value;

  // Skip header row
  if (data.length < 2) {
    return { ok: true, value: [] };
  }

  // Skip non-bank movimientos sheets (credit cards, brokers, etc.).
  // The matcher unconditionally writes to G/H/I; if the schema isn't bank,
  // those columns either don't exist or hold unrelated data. Returning empty
  // here means matchAllMovimientos finds nothing to process for those sheets.
  if (!isBankMovimientosHeader(data[0])) {
    debug('Skipping non-bank movimientos sheet (header schema mismatch)', {
      module: 'movimientos-reader',
      sheetName,
      headerSample: data[0].slice(0, 3).map(c => String(c || '')).join(','),
    });
    return { ok: true, value: [] };
  }

  const movimientos: MovimientoRow[] = [];

  // Start from row 1 (skip header at row 0)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    // Row number is 1-indexed (i+1 because we skip header, and sheets are 1-indexed)
    const movimiento = parseMovimientoRow(row, sheetName, i + 1);
    if (movimiento) {
      movimientos.push(movimiento);
    }
  }

  debug('Read movimientos from sheet', {
    module: 'movimientos-reader',
    sheetName,
    totalRows: data.length - 1,
    movimientos: movimientos.length,
  });

  return { ok: true, value: movimientos };
}

/**
 * A single credit-card movimiento row, projected for delivery export.
 * Source schema (MOVIMIENTOS_TARJETA_SHEET): fecha, descripcion, nroCupon,
 * pesos, dolares, detalle. The `detalle` column is manually filled by humans.
 */
export interface CardMovimientoRow {
  fecha: string;
  descripcion: string;
  nroCupon: string;
  pesos: number;
  dolares: number;
  detalle: string;
}

/**
 * Reads credit-card movimientos from a specific month sheet for delivery.
 *
 * Distinct from `readMovimientosForPeriod` (which is wired to the bank-only
 * matcher and intentionally returns [] for non-bank schemas). Card
 * movimientos sheets follow the 6-column schema; we read A:F directly and
 * project the row.
 */
export async function readCardMovimientosForPeriod(
  spreadsheetId: string,
  sheetName: string
): Promise<Result<CardMovimientoRow[], Error>> {
  const range = `'${sheetName}'!A:F`;
  const valuesResult = await getValues(spreadsheetId, range);
  if (!valuesResult.ok) return valuesResult;

  const data = valuesResult.value;
  if (data.length < 2) return { ok: true, value: [] };

  const rows: CardMovimientoRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const descripcion = String(row[1] || '');
    if (isSpecialRow(descripcion)) continue;

    rows.push({
      fecha: normalizeSpreadsheetDate(row[0]),
      descripcion,
      nroCupon: String(row[2] || ''),
      pesos: parseNumber(row[3]) ?? 0,
      dolares: parseNumber(row[4]) ?? 0,
      detalle: String(row[5] || ''),
    });
  }

  debug('Read card movimientos from sheet', {
    module: 'movimientos-reader',
    sheetName,
    totalRows: data.length - 1,
    movimientos: rows.length,
  });

  return { ok: true, value: rows };
}

/**
 * Gets all recent movimientos from a bank spreadsheet
 * Excludes SALDO INICIAL/FINAL rows
 * Returns ALL movimientos (with or without detalles) for replacement logic
 *
 * @param spreadsheetId - The bank spreadsheet ID
 * @param currentYear - Current year for filtering (optional, defaults to current year)
 * @returns Array of all MovimientoRow objects
 */
export async function getMovimientosToFill(
  spreadsheetId: string,
  currentYear?: number
): Promise<Result<MovimientoRow[], Error>> {
  const year = currentYear ?? new Date().getFullYear();

  // Get list of recent sheets
  const sheetsResult = await getRecentMovimientoSheets(spreadsheetId, year);
  if (!sheetsResult.ok) return sheetsResult;

  const sheetNames = sheetsResult.value;

  if (sheetNames.length === 0) {
    return { ok: true, value: [] };
  }

  // Read sheets in chunks to manage memory
  const allMovimientos: MovimientoRow[] = [];

  for (let i = 0; i < sheetNames.length; i += PARALLEL_SHEET_READ_CHUNK_SIZE) {
    const chunk = sheetNames.slice(i, i + PARALLEL_SHEET_READ_CHUNK_SIZE);

    // Read chunk in parallel
    const results = await Promise.all(
      chunk.map(sheetName => readMovimientosForPeriod(spreadsheetId, sheetName))
    );

    // Collect results, log errors but continue processing
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.ok) {
        allMovimientos.push(...result.value);
      } else {
        warn('Failed to read movimientos from sheet', {
          module: 'movimientos-reader',
          sheetName: chunk[j],
          error: result.error.message,
        });
      }
    }
  }

  debug('Loaded all movimientos for matching', {
    module: 'movimientos-reader',
    spreadsheetId,
    sheetsProcessed: sheetNames.length,
    totalMovimientos: allMovimientos.length,
  });

  return { ok: true, value: allMovimientos };
}
