/**
 * Spreadsheet header definitions for Control de Cobros and Control de Pagos
 * These headers match the SPREADSHEET_FORMAT.md specification
 */

/** Headers for Facturas sheet (columns A:S) */
export const FACTURA_HEADERS = [
  'fechaEmision',
  'fileId',
  'fileName',
  'tipoComprobante',
  'nroFactura',
  'cuitEmisor',
  'razonSocialEmisor',
  'cuitReceptor',
  'importeNeto',
  'importeIva',
  'importeTotal',
  'moneda',
  'concepto',
  'processedAt',
  'confidence',
  'needsReview',
  'matchedPagoFileId',
  'matchConfidence',
  'hasCuitMatch',
];

/** Headers for Pagos sheet (columns A:Q) */
export const PAGO_HEADERS = [
  'fechaPago',
  'fileId',
  'fileName',
  'banco',
  'importePagado',
  'moneda',
  'referencia',
  'cuitPagador',
  'nombrePagador',
  'cuitBeneficiario',
  'nombreBeneficiario',
  'concepto',
  'processedAt',
  'confidence',
  'needsReview',
  'matchedFacturaFileId',
  'matchConfidence',
];

/** Headers for Recibos sheet (columns A:R) */
export const RECIBO_HEADERS = [
  'fechaPago',
  'fileId',
  'fileName',
  'tipoRecibo',
  'nombreEmpleado',
  'cuilEmpleado',
  'legajo',
  'tareaDesempenada',
  'cuitEmpleador',
  'periodoAbonado',
  'subtotalRemuneraciones',
  'subtotalDescuentos',
  'totalNeto',
  'processedAt',
  'confidence',
  'needsReview',
  'matchedPagoFileId',
  'matchConfidence',
];

/** Headers for Resumenes Bancarios sheet */
export const RESUMEN_BANCARIO_HEADERS = [
  'fileId',
  'fileName',
  'banco',
  'numeroCuenta',
  'fechaDesde',
  'fechaHasta',
  'saldoInicial',
  'saldoFinal',
  'moneda',
  'cantidadMovimientos',
  'processedAt',
  'confidence',
  'needsReview',
];

/** Sheet configuration */
export interface SheetConfig {
  title: string;
  headers: string[];
  monetaryColumns?: number[]; // 0-indexed column numbers to format as currency
}

/**
 * Required sheets for Control de Creditos spreadsheet
 * Creditos = money coming IN to ADVA (facturas emitidas, pagos recibidos)
 */
export const CONTROL_CREDITOS_SHEETS: SheetConfig[] = [
  {
    title: 'Facturas Emitidas',
    headers: FACTURA_HEADERS,
    monetaryColumns: [8, 9, 10] // importeNeto, importeIva, importeTotal (0-indexed: 8, 9, 10)
  },
  {
    title: 'Pagos Recibidos',
    headers: PAGO_HEADERS,
    monetaryColumns: [4] // importePagado (0-indexed: 4)
  },
];

/**
 * Required sheets for Control de Debitos spreadsheet
 * Debitos = money going OUT from ADVA (facturas recibidas, pagos enviados, recibos)
 */
export const CONTROL_DEBITOS_SHEETS: SheetConfig[] = [
  {
    title: 'Facturas Recibidas',
    headers: FACTURA_HEADERS,
    monetaryColumns: [8, 9, 10] // importeNeto, importeIva, importeTotal (0-indexed: 8, 9, 10)
  },
  {
    title: 'Pagos Enviados',
    headers: PAGO_HEADERS,
    monetaryColumns: [4] // importePagado (0-indexed: 4)
  },
  {
    title: 'Recibos',
    headers: RECIBO_HEADERS,
    monetaryColumns: [10, 11, 12] // subtotalRemuneraciones, subtotalDescuentos, totalNeto (0-indexed: 10, 11, 12)
  },
];
