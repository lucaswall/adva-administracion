import type { ResumenBancario, ResumenTarjeta, ResumenBroker } from '../../types/index.js';
import { getValues } from '../../services/sheets.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { parseNumber } from '../../utils/numbers.js';

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
   */
  isDuplicateFactura(
    spreadsheetId: string,
    sheetName: string,
    nroFactura: string,
    fecha: string,
    importeTotal: number,
    cuit: string
  ): { isDuplicate: boolean; existingFileId?: string } {
    const key = `${spreadsheetId}:${sheetName}`;
    const sheetData = this.cache.get(key);
    if (!sheetData) return { isDuplicate: false };

    for (const [fileId, row] of sheetData) {
      const rowNroFactura = row[4];   // Column E
      const rowFecha = normalizeSpreadsheetDate(row[0]); // Column A
      const rowImporte = parseNumber(String(row[9])) ?? 0; // Column J
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
   * Checks for duplicate bank account resumen in cache.
   */
  isDuplicateResumenBancario(
    spreadsheetId: string,
    resumen: ResumenBancario
  ): { isDuplicate: boolean; existingFileId?: string } {
    const key = `${spreadsheetId}:Resumenes`;
    const sheetData = this.cache.get(key);
    if (!sheetData) return { isDuplicate: false };

    for (const [fileId, row] of sheetData) {
      const rowFechaDesde = normalizeSpreadsheetDate(row[0]); // Column A
      const rowFechaHasta = normalizeSpreadsheetDate(row[1]); // Column B
      const rowBanco = row[4]; // Column E
      const rowNumeroCuenta = row[5]; // Column F
      const rowMoneda = row[6]; // Column G

      if (
        rowBanco === resumen.banco &&
        rowFechaDesde === resumen.fechaDesde &&
        rowFechaHasta === resumen.fechaHasta &&
        rowNumeroCuenta === resumen.numeroCuenta &&
        rowMoneda === resumen.moneda
      ) {
        return { isDuplicate: true, existingFileId: fileId };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * Checks for duplicate credit card resumen in cache.
   */
  isDuplicateResumenTarjeta(
    spreadsheetId: string,
    resumen: ResumenTarjeta
  ): { isDuplicate: boolean; existingFileId?: string } {
    const key = `${spreadsheetId}:Resumenes`;
    const sheetData = this.cache.get(key);
    if (!sheetData) return { isDuplicate: false };

    for (const [fileId, row] of sheetData) {
      const rowFechaDesde = normalizeSpreadsheetDate(row[0]); // Column A
      const rowFechaHasta = normalizeSpreadsheetDate(row[1]); // Column B
      const rowBanco = row[4]; // Column E
      const rowNumeroCuenta = row[5]; // Column F
      const rowTipoTarjeta = row[6]; // Column G

      if (
        rowBanco === resumen.banco &&
        rowFechaDesde === resumen.fechaDesde &&
        rowFechaHasta === resumen.fechaHasta &&
        rowNumeroCuenta === resumen.numeroCuenta &&
        rowTipoTarjeta === resumen.tipoTarjeta
      ) {
        return { isDuplicate: true, existingFileId: fileId };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * Checks for duplicate broker resumen in cache.
   */
  isDuplicateResumenBroker(
    spreadsheetId: string,
    resumen: ResumenBroker
  ): { isDuplicate: boolean; existingFileId?: string } {
    const key = `${spreadsheetId}:Resumenes`;
    const sheetData = this.cache.get(key);
    if (!sheetData) return { isDuplicate: false };

    for (const [fileId, row] of sheetData) {
      const rowFechaDesde = normalizeSpreadsheetDate(row[0]); // Column A
      const rowFechaHasta = normalizeSpreadsheetDate(row[1]); // Column B
      const rowBroker = row[4]; // Column E
      const rowNumeroCuenta = row[5]; // Column F

      if (
        rowBroker === resumen.broker &&
        rowFechaDesde === resumen.fechaDesde &&
        rowFechaHasta === resumen.fechaHasta &&
        rowNumeroCuenta === resumen.numeroCuenta
      ) {
        return { isDuplicate: true, existingFileId: fileId };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * Adds entry to cache after successful store.
   */
  addEntry(spreadsheetId: string, sheetName: string, fileId: string, row: unknown[]): void {
    const key = `${spreadsheetId}:${sheetName}`;
    const sheetData = this.cache.get(key);
    if (sheetData) {
      sheetData.set(fileId, row);
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
