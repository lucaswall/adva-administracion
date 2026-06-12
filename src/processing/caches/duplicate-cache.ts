import { getValues } from '../../services/sheets.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { parseNumber } from '../../utils/numbers.js';

/**
 * Reduces a `CellValueOrLink`-shaped cell to the primitive shape that
 * `getValues` returns for the same cell. The dupe-check methods compare cache
 * rows assuming spreadsheet-read shape (string/number primitives), so wrappers
 * coming from `appendRowsWithLinks` callers must be unwrapped before storing.
 *
 * Unwraps `CellDate`/`CellNumber`/`CellFormula` to their `value`, and
 * `CellLink` to its `text`. Primitives, `null`, and `undefined` pass through
 * unchanged.
 *
 * @param cell - Cell value, possibly wrapped as CellDate/CellNumber/CellFormula/CellLink
 * @returns Unwrapped primitive value, matching the shape `getValues` returns for the same cell
 */
export function normalizeForCache(cell: unknown): unknown {
  if (cell && typeof cell === 'object') {
    if ('type' in cell && 'value' in cell) {
      const c = cell as { type: unknown; value: unknown };
      if (c.type === 'date' || c.type === 'number' || c.type === 'formula') {
        return c.value;
      }
    }
    if ('text' in cell && 'url' in cell) {
      return (cell as { text: unknown }).text;
    }
  }
  return cell;
}

/**
 * In-memory cache of sheet data for duplicate detection.
 * Reduces N duplicate checks to ~5 initial loads.
 */
export class DuplicateCache {
  // Map<"spreadsheetId:sheetName", Map<fileId, rowData>>
  private cache = new Map<string, Map<string, unknown[]>>();
  private loadPromises = new Map<string, Promise<void>>();

  /**
   * Loads sheet data into cache. Uses promise-caching.
   */
  async loadSheet(spreadsheetId: string, sheetName: string, range: string): Promise<void> {
    const key = `${spreadsheetId}:${sheetName}`;

    if (this.cache.has(key)) return;

    // Promise-caching to prevent thundering herd
    if (!this.loadPromises.has(key)) {
      this.loadPromises.set(key, this.doLoadSheet(spreadsheetId, sheetName, range, key));
    }

    await this.loadPromises.get(key);
  }

  private async doLoadSheet(
    spreadsheetId: string,
    sheetName: string,
    range: string,
    key: string
  ): Promise<void> {
    try {
      const rowsResult = await getValues(spreadsheetId, `${sheetName}!${range}`);
      if (!rowsResult.ok) {
        // Remove failed promise from cache to allow retry
        this.loadPromises.delete(key);
        return;
      }

      const data = new Map<string, unknown[]>();
      // Skip header row (index 0)
      for (let i = 1; i < rowsResult.value.length; i++) {
        const row = rowsResult.value[i];
        if (row && row[1]) {
          // fileId is in column B (index 1)
          data.set(String(row[1]), row);
        }
      }
      this.cache.set(key, data);
    } catch (error) {
      // Remove failed promise from cache to allow retry
      this.loadPromises.delete(key);
      throw error;
    }
  }

  /**
   * Checks for duplicate factura in cache.
   *
   * After ADV-245 the Facturas Emitidas schema grew by one column
   * (condicionIVAReceptor at H/7), shifting importeTotal from J (9) to K
   * (10). Facturas Recibidas is unchanged. Callers MUST pass `documentType`
   * so the comparison reads the correct column.
   */
  isDuplicateFactura(
    spreadsheetId: string,
    sheetName: string,
    nroFactura: string,
    fecha: string,
    importeTotal: number,
    cuit: string,
    documentType: 'factura_emitida' | 'factura_recibida'
  ): { isDuplicate: boolean; existingFileId?: string } {
    const key = `${spreadsheetId}:${sheetName}`;
    const sheetData = this.cache.get(key);
    if (!sheetData) return { isDuplicate: false };

    const importeColIdx = documentType === 'factura_emitida' ? 10 : 9;

    for (const [fileId, row] of sheetData) {
      const rowNroFactura = row[4];   // Column E
      const rowFecha = normalizeSpreadsheetDate(row[0]); // Column A
      const rowImporte = parseNumber(String(row[importeColIdx])) ?? 0; // J (recibida) or K (emitida)
      const rowCuit = row[5]; // Column F

      if (
        rowNroFactura === nroFactura &&
        rowFecha === fecha &&
        Math.abs(rowImporte - importeTotal) < 0.01 &&
        rowCuit === cuit
      ) {
        return { isDuplicate: true, existingFileId: fileId };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * Checks for duplicate pago in cache.
   */
  isDuplicatePago(
    spreadsheetId: string,
    sheetName: string,
    fecha: string,
    importePagado: number,
    cuit: string
  ): { isDuplicate: boolean; existingFileId?: string } {
    const key = `${spreadsheetId}:${sheetName}`;
    const sheetData = this.cache.get(key);
    if (!sheetData) return { isDuplicate: false };

    for (const [fileId, row] of sheetData) {
      const rowFecha = normalizeSpreadsheetDate(row[0]); // Column A
      const rowImporte = parseNumber(String(row[4])) ?? 0; // Column E
      const rowCuit = row[7]; // Column H

      if (
        rowFecha === fecha &&
        Math.abs(rowImporte - importePagado) < 0.01 &&
        rowCuit === cuit
      ) {
        return { isDuplicate: true, existingFileId: fileId };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * Checks for duplicate recibo in cache.
   */
  isDuplicateRecibo(
    spreadsheetId: string,
    cuilEmpleado: string,
    periodoAbonado: string,
    totalNeto: number
  ): { isDuplicate: boolean; existingFileId?: string } {
    const key = `${spreadsheetId}:Recibos`;
    const sheetData = this.cache.get(key);
    if (!sheetData) return { isDuplicate: false };

    for (const [fileId, row] of sheetData) {
      const rowCuilEmpleado = row[5]; // Column F
      const rowPeriodoAbonado = row[9]; // Column J
      const rowTotalNeto = parseNumber(String(row[12])) ?? 0; // Column M

      if (
        rowCuilEmpleado === cuilEmpleado &&
        rowPeriodoAbonado === periodoAbonado &&
        Math.abs(rowTotalNeto - totalNeto) < 0.01
      ) {
        return { isDuplicate: true, existingFileId: fileId };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * Checks for duplicate retencion in cache.
   */
  isDuplicateRetencion(
    spreadsheetId: string,
    nroCertificado: string,
    cuitAgenteRetencion: string,
    fechaEmision: string,
    montoRetencion: number
  ): { isDuplicate: boolean; existingFileId?: string } {
    const key = `${spreadsheetId}:Retenciones Recibidas`;
    const sheetData = this.cache.get(key);
    if (!sheetData) return { isDuplicate: false };

    for (const [fileId, row] of sheetData) {
      const rowFechaEmision = normalizeSpreadsheetDate(row[0]); // Column A
      const rowNroCertificado = row[3]; // Column D
      const rowCuitAgente = row[4]; // Column E
      const rowMontoRetencion = parseNumber(String(row[9])) ?? 0; // Column J

      if (
        rowNroCertificado === nroCertificado &&
        rowCuitAgente === cuitAgenteRetencion &&
        rowFechaEmision === fechaEmision &&
        Math.abs(rowMontoRetencion - montoRetencion) < 0.01
      ) {
        return { isDuplicate: true, existingFileId: fileId };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * Reports whether a sheet's data has been successfully loaded into cache.
   *
   * Callers MUST check this before using `isDuplicate*` methods — an unloaded
   * cache returns `{ isDuplicate: false }` for every query (fail-open).
   * When `isLoaded()` returns `false`, callers should fall back to the
   * API-based duplicate check to avoid accepting real duplicates (ADV-297).
   *
   * @param spreadsheetId - Spreadsheet ID
   * @param sheetName - Sheet name
   * @returns true if data was successfully loaded and is available for querying
   */
  isLoaded(spreadsheetId: string, sheetName: string): boolean {
    return this.cache.has(`${spreadsheetId}:${sheetName}`);
  }

  /**
   * Adds entry to cache after successful store.
   *
   * Normalizes wrapper cell shapes ({type:'date'|'number'}, {text,url}) to
   * primitives so subsequent dupe-checks — which call parseNumber(String(...))
   * and rely on plain-string equality — find the entry. Without this, a row
   * written by `appendRowsWithLinks` with `CellNumber` importe wrappers would
   * be invisible to `isDuplicateFactura` etc. on the same scan (ADV-242).
   */
  addEntry(spreadsheetId: string, sheetName: string, fileId: string, row: unknown[]): void {
    const key = `${spreadsheetId}:${sheetName}`;
    const sheetData = this.cache.get(key);
    if (sheetData) {
      sheetData.set(fileId, row.map(normalizeForCache));
    }
  }

  /**
   * Clears all cached data. Call after scan completes.
   */
  clear(): void {
    this.cache.clear();
    this.loadPromises.clear();
  }
}
