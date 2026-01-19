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

/** Headers for Resumenes Bancarios sheet */
export const RESUMEN_BANCARIO_HEADERS = [
  'fileId',
  'fileName',
  'folderPath',
  'banco',
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
}

/**
 * Required sheets for Control de Creditos spreadsheet
 * Creditos = money coming IN to ADVA (facturas emitidas, pagos recibidos)
 */
export const CONTROL_CREDITOS_SHEETS: SheetConfig[] = [
  { title: 'Facturas Emitidas', headers: FACTURA_HEADERS },
  { title: 'Pagos Recibidos', headers: PAGO_HEADERS },
];

/**
 * Required sheets for Control de Debitos spreadsheet
 * Debitos = money going OUT from ADVA (facturas recibidas, pagos enviados, recibos)
 */
export const CONTROL_DEBITOS_SHEETS: SheetConfig[] = [
  { title: 'Facturas Recibidas', headers: FACTURA_HEADERS },
  { title: 'Pagos Enviados', headers: PAGO_HEADERS },
  { title: 'Recibos', headers: RECIBO_HEADERS },
];
