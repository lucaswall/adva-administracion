/**
 * Spreadsheet header definitions for Control de Cobros and Control de Pagos
 * These headers match the SPREADSHEET_FORMAT.md specification
 */

/** Headers for Facturas sheet (columns A:S) */
export const FACTURA_HEADERS = [
  'fileId',
  'fileName',
  'tipoComprobante',
  'nroFactura',
  'fechaEmision',
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
  'fileId',
  'fileName',
  'banco',
  'fechaPago',
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
  'fileId',
  'fileName',
  'tipoRecibo',
  'nombreEmpleado',
  'cuilEmpleado',
  'legajo',
  'tareaDesempenada',
  'cuitEmpleador',
  'periodoAbonado',
  'fechaPago',
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
    monetaryColumns: [8, 9, 10] // importeNeto, importeIva, importeTotal (columns I, J, K)
  },
  {
    title: 'Pagos Recibidos',
    headers: PAGO_HEADERS,
    monetaryColumns: [4] // importePagado (column E)
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
    monetaryColumns: [8, 9, 10] // importeNeto, importeIva, importeTotal (columns I, J, K)
  },
  {
    title: 'Pagos Enviados',
    headers: PAGO_HEADERS,
    monetaryColumns: [4] // importePagado (column E)
  },
  {
    title: 'Recibos',
    headers: RECIBO_HEADERS,
    monetaryColumns: [10, 11, 12] // subtotalRemuneraciones, subtotalDescuentos, totalNeto (columns K, L, M)
  },
];
