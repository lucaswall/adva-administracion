/**
 * Idempotent MP movimientos writer
 * Incrementally appends new MercadoPago transaction rows to per-month tabs
 * in the Movimientos spreadsheet.
 *
 * Deduplication key: the `MP {id}` prefix parsed from existing concepto values.
 * A credit row and its fee row share the same op id — both are skipped when the
 * op id already exists.  Append is atomic: a single appendRowsWithLinks call
 * either lands all new rows or fails whole, leaving prior rows intact.
 */

import type { Result, MovimientoBancario } from '../types/index.js';
import {
  getOrCreateMonthSheet,
  appendRowsWithLinks,
  getValues,
  type CellDate,
  type CellNumber,
  type CellFormula,
  type CellValueOrLink,
} from '../services/sheets.js';
import { MOVIMIENTOS_BANCARIO_SHEET } from '../constants/spreadsheet-headers.js';
import {
  generateInitialBalanceRow,
  generateMovimientoRowWithFormula,
} from '../utils/balance-formulas.js';
import { info, warn } from '../utils/logger.js';

/** Pattern for MP op id prefix: `MP <digits>` */
const MP_OP_ID_RE = /^MP (\d+)/;

/**
 * Parses an MP op id from a concepto value.
 * Returns the op id string (e.g. "158805080384") or null if not an MP row.
 */
function parseMpOpId(concepto: unknown): string | null {
  const s = String(concepto || '').trim();
  const m = MP_OP_ID_RE.exec(s);
  return m ? m[1] : null;
}

/**
 * Idempotently appends new MercadoPago transaction rows to a per-month tab.
 *
 * - First call on a fresh tab: writes SALDO INICIAL + all movimiento rows
 *   (no SALDO FINAL — period close is represented by the Resumenes row).
 * - Subsequent calls: reads existing concepto values, extracts already-written
 *   op ids, and appends only the rows whose op id is not yet present.
 * - Re-running with an identical set: appends nothing.
 * - If reading existing rows fails: returns `ok: false` without appending.
 *
 * @param spreadsheetId - ID of the Movimientos spreadsheet
 * @param periodo - Month period in YYYY-MM format (tab name)
 * @param movimientos - Array of MovimientoBancario rows from the MP API
 * @param saldoInicialPeriodo - Opening balance written to the SALDO INICIAL row
 * @returns { appended, skippedExisting } or an error
 */
export async function writeMpMovimientos(
  spreadsheetId: string,
  periodo: string,
  movimientos: MovimientoBancario[],
  saldoInicialPeriodo: number
): Promise<Result<{ appended: number; skippedExisting: number }, Error>> {
  try {
    // Get or create the month tab (uses same headers as regular bank movimientos)
    const sheetResult = await getOrCreateMonthSheet(
      spreadsheetId,
      periodo,
      MOVIMIENTOS_BANCARIO_SHEET.headers,
      undefined
    );
    if (!sheetResult.ok) return sheetResult;

    // Read existing rows to derive op ids and current row count.
    // Failure here means we cannot safely determine what to skip — abort.
    const existingResult = await getValues(spreadsheetId, `${periodo}!A:I`);
    if (!existingResult.ok) return existingResult;

    const existingRows = existingResult.value;

    // Extract existing MP op ids from the concepto column (index 1)
    const existingOpIds = new Set<string>();
    for (let i = 1; i < existingRows.length; i++) {
      const row = existingRows[i];
      if (!row) continue;
      const opId = parseMpOpId(row[1]);
      if (opId) existingOpIds.add(opId);
    }

    // Partition movimientos into new (to append) and existing (to skip)
    const newMovimientos: MovimientoBancario[] = [];
    const skippedMovimientos: MovimientoBancario[] = [];

    for (const mov of movimientos) {
      const opId = parseMpOpId(mov.concepto);
      if (opId && existingOpIds.has(opId)) {
        skippedMovimientos.push(mov);
      } else {
        newMovimientos.push(mov);
      }
    }

    // Nothing new to append — idempotent no-op
    if (newMovimientos.length === 0) {
      info('writeMpMovimientos: all ops already present, nothing to append', {
        module: 'mercadopago/movimientos-writer',
        periodo,
        skippedExisting: skippedMovimientos.length,
      });
      return {
        ok: true,
        value: { appended: 0, skippedExisting: skippedMovimientos.length },
      };
    }

    // Determine if this is a fresh tab (no data rows yet, i.e., only header or empty)
    // existingRows includes the header row when the sheet has data.
    const existingDataRows = existingRows.length > 1 ? existingRows.length - 1 : 0;
    const isFreshTab = existingDataRows === 0;

    // Build the batch of rows to append:
    //   Fresh tab: [SALDO INICIAL, mov0, mov1, ...]  (startRowOffset=0, rowIndex starts at 1)
    //   Existing tab: [mov0, mov1, ...]             (startRowOffset=existingDataRows, rowIndex starts at 0)
    const rows: CellValueOrLink[][] = [];

    if (isFreshTab) {
      // Write SALDO INICIAL at batch index 0
      const initialRow = generateInitialBalanceRow(saldoInicialPeriodo, periodo);
      rows.push([
        initialRow[0],   // null (fecha)
        initialRow[1],   // 'SALDO INICIAL'
        initialRow[2],   // null (debito)
        initialRow[3],   // null (credito)
        initialRow[4],   // null (saldo)
        { type: 'number', value: initialRow[5] } as CellNumber, // saldoCalculado
        '',              // matchedFileId
        '',              // matchedType
        '',              // detalle
      ]);

      // Transaction rows use rowIndex starting at 1 (SALDO INICIAL occupies index 0)
      newMovimientos.forEach((mov, idx) => {
        const rowIndex = idx + 1;
        const txRow = generateMovimientoRowWithFormula(mov, rowIndex, 0);
        rows.push(buildMovimientoRow(txRow));
      });
    } else {
      // Incremental append: transaction rows use rowIndex starting at 0
      const startRowOffset = existingDataRows;
      newMovimientos.forEach((mov, idx) => {
        const txRow = generateMovimientoRowWithFormula(mov, idx, startRowOffset);
        rows.push(buildMovimientoRow(txRow));
      });
    }

    // Atomically append all new rows in a single call
    const appendResult = await appendRowsWithLinks(
      spreadsheetId,
      `${periodo}!A:I`,
      rows
    );
    if (!appendResult.ok) return { ok: false, error: appendResult.error };

    info('writeMpMovimientos: appended new rows', {
      module: 'mercadopago/movimientos-writer',
      periodo,
      appended: newMovimientos.length,
      skippedExisting: skippedMovimientos.length,
    });

    return {
      ok: true,
      value: {
        appended: newMovimientos.length,
        skippedExisting: skippedMovimientos.length,
      },
    };
  } catch (error) {
    warn('writeMpMovimientos: unexpected error', {
      module: 'mercadopago/movimientos-writer',
      periodo,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Converts a raw movimiento row tuple (from generateMovimientoRowWithFormula)
 * into a typed CellValueOrLink[] array for appendRowsWithLinks.
 */
function buildMovimientoRow(
  txRow: ReturnType<typeof generateMovimientoRowWithFormula>
): CellValueOrLink[] {
  return [
    { type: 'date', value: txRow[0] } as CellDate,
    txRow[1],  // concepto
    txRow[2] !== null ? ({ type: 'number', value: txRow[2] } as CellNumber) : null,
    txRow[3] !== null ? ({ type: 'number', value: txRow[3] } as CellNumber) : null,
    txRow[4] !== null ? ({ type: 'number', value: txRow[4] } as CellNumber) : null,
    { type: 'formula', value: txRow[5] } as CellFormula,
    '',  // matchedFileId
    '',  // matchedType
    '',  // detalle
  ];
}
