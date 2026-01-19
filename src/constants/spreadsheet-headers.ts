/**
 * Spreadsheet header definitions for Control de Cobros and Control de Pagos
 * These headers match the SPREADSHEET_FORMAT.md specification
 */

/** Headers for Facturas sheet (columns A:W) */
export const FACTURA_HEADERS = [
  'fileId',
  'fileName',
  'folderPath',
  'tipoComprobante',
  'puntoVenta',
  'numeroComprobante',
  'fechaEmision',
  'fechaVtoCae',
  'cuitEmisor',
  'razonSocialEmisor',
  'cuitReceptor',
  'cae',
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
  'folderPath',
  'banco',
  'fechaPago',
  'importePagado',
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

/** Headers for Recibos sheet (columns A:S) */
export const RECIBO_HEADERS = [
  'fileId',
  'fileName',
  'folderPath',
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

/** Sheet configuration */
export interface SheetConfig {
  title: string;
  headers: string[];
}

/** Required sheets for Control de Pagos spreadsheet */
export const CONTROL_PAGOS_SHEETS: SheetConfig[] = [
  { title: 'Facturas', headers: FACTURA_HEADERS },
  { title: 'Pagos', headers: PAGO_HEADERS },
  { title: 'Recibos', headers: RECIBO_HEADERS },
];
