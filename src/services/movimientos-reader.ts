/**
 * Movimientos reader service
 * Reads bank movements from per-month sheets for matching
 */

import type { Result, MovimientoRow } from '../types/index.js';
import { PARALLEL_SHEET_READ_CHUNK_SIZE } from '../config.js';
import { getSheetMetadata, getValues, type CellValue } from './sheets.js';
import { parseNumber } from '../utils/numbers.js';
import { warn, debug } from '../utils/logger.js';

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
 * @param origenConcepto - The origenConcepto field value
 * @returns True if the row is a special row that should be skipped
 */
export function isSpecialRow(origenConcepto: string): boolean {
  if (!origenConcepto) return false;
  const normalized = origenConcepto.trim().toUpperCase();
  return SKIP_LABELS.some(label => normalized.startsWith(label));
}

/**
 * Parses a single row into a MovimientoRow object
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
  const origenConcepto = String(row[1] || '');
  if (isSpecialRow(origenConcepto)) return null;

  return {
    sheetName,
    rowNumber,
    fecha: String(row[0] || ''),
    origenConcepto,
    debito: parseNumber(row[2]),
    credito: parseNumber(row[3]),
    saldo: parseNumber(row[4]),
    saldoCalculado: parseNumber(row[5]),
    matchedFileId: String(row[6] || ''),
    detalle: String(row[7] || ''),
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
  const range = `'${sheetName}'!A:H`;

  const valuesResult = await getValues(spreadsheetId, range);
  if (!valuesResult.ok) return valuesResult;

  const data = valuesResult.value;

  // Skip header row
  if (data.length < 2) {
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
