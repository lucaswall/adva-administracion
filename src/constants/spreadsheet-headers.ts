/**
 * Spreadsheet header definitions for Control de Cobros and Control de Pagos
 * These headers match the SPREADSHEET_FORMAT.md specification
 */

/** Headers for Facturas Emitidas sheet - ADVA is emisor, only store receptor info (columns A:R) */
export const FACTURA_EMITIDA_HEADERS = [
  'fechaEmision',
  'fileId',
  'fileName',
  'tipoComprobante',
  'nroFactura',
  'cuitReceptor',
  'razonSocialReceptor',
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

/** Headers for Facturas Recibidas sheet - ADVA is receptor, only store emisor info (columns A:S) */
export const FACTURA_RECIBIDA_HEADERS = [
  'fechaEmision',
  'fileId',
  'fileName',
  'tipoComprobante',
  'nroFactura',
  'cuitEmisor',
  'razonSocialEmisor',
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
  'pagada',
];

/** Headers for Pagos Enviados sheet - ADVA is pagador, only store beneficiario info (columns A:O) */
export const PAGO_ENVIADO_HEADERS = [
  'fechaPago',
  'fileId',
  'fileName',
  'banco',
  'importePagado',
  'moneda',
  'referencia',
  'cuitBeneficiario',
  'nombreBeneficiario',
  'concepto',
  'processedAt',
  'confidence',
  'needsReview',
  'matchedFacturaFileId',
  'matchConfidence',
];

/** Headers for Pagos Recibidos sheet - ADVA is beneficiario, only store pagador info (columns A:O) */
export const PAGO_RECIBIDO_HEADERS = [
  'fechaPago',
  'fileId',
  'fileName',
  'banco',
  'importePagado',
  'moneda',
  'referencia',
  'cuitPagador',
  'nombrePagador',
  'concepto',
  'processedAt',
  'confidence',
  'needsReview',
  'matchedFacturaFileId',
  'matchConfidence',
];

/** Headers for Retenciones Recibidas sheet - Tax withholding certificates (columns A:O) */
export const RETENCIONES_RECIBIDAS_HEADERS = [
  'fechaEmision',
  'fileId',
  'fileName',
  'nroCertificado',
  'cuitAgenteRetencion',
  'razonSocialAgenteRetencion',
  'impuesto',
  'regimen',
  'montoComprobante',
  'montoRetencion',
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
 * Creditos = money coming IN to ADVA (facturas emitidas, pagos recibidos, retenciones)
 */
export const CONTROL_CREDITOS_SHEETS: SheetConfig[] = [
  {
    title: 'Facturas Emitidas',
    headers: FACTURA_EMITIDA_HEADERS,
    monetaryColumns: [7, 8, 9] // importeNeto, importeIva, importeTotal (0-indexed: 7, 8, 9)
  },
  {
    title: 'Pagos Recibidos',
    headers: PAGO_RECIBIDO_HEADERS,
    monetaryColumns: [4] // importePagado (0-indexed: 4)
  },
  {
    title: 'Retenciones Recibidas',
    headers: RETENCIONES_RECIBIDAS_HEADERS,
    monetaryColumns: [8, 9] // montoComprobante, montoRetencion (0-indexed: 8, 9)
  },
];

/**
 * Required sheets for Control de Debitos spreadsheet
 * Debitos = money going OUT from ADVA (facturas recibidas, pagos enviados, recibos)
 */
export const CONTROL_DEBITOS_SHEETS: SheetConfig[] = [
  {
    title: 'Facturas Recibidas',
    headers: FACTURA_RECIBIDA_HEADERS,
    monetaryColumns: [7, 8, 9] // importeNeto, importeIva, importeTotal (0-indexed: 7, 8, 9)
  },
  {
    title: 'Pagos Enviados',
    headers: PAGO_ENVIADO_HEADERS,
    monetaryColumns: [4] // importePagado (0-indexed: 4)
  },
  {
    title: 'Recibos',
    headers: RECIBO_HEADERS,
    monetaryColumns: [10, 11, 12] // subtotalRemuneraciones, subtotalDescuentos, totalNeto (0-indexed: 10, 11, 12)
  },
];

/** Headers for Resumen Mensual sheet */
export const RESUMEN_MENSUAL_HEADERS = [
  'fecha',
  'totalLlamadas',
  'tokensEntrada',
  'tokensSalida',
  'costoTotalUSD',
  'tasaExito',
  'duracionPromedio',
];

/** Headers for Uso de API sheet */
export const USO_API_HEADERS = [
  'timestamp',
  'requestId',
  'fileId',
  'fileName',
  'model',
  'promptTokens',
  'outputTokens',
  'totalTokens',
  'estimatedCostUSD',
  'durationMs',
  'success',
  'errorMessage',
];

/** Headers for Pagos Pendientes sheet - unpaid invoices from Control de Debitos */
export const PAGOS_PENDIENTES_HEADERS = [
  'fechaEmision',
  'fileId',
  'fileName',
  'tipoComprobante',
  'nroFactura',
  'cuitEmisor',
  'razonSocialEmisor',
  'importeTotal',
  'moneda',
  'concepto',
];

/**
 * Required sheets for Dashboard Operativo Contable spreadsheet
 * Tracks Gemini API token usage, costs, and pending payments
 */
export const DASHBOARD_OPERATIVO_SHEETS: SheetConfig[] = [
  {
    title: 'Pagos Pendientes',
    headers: PAGOS_PENDIENTES_HEADERS,
    monetaryColumns: [7] // importeTotal (0-indexed: 7)
  },
  {
    title: 'Resumen Mensual',
    headers: RESUMEN_MENSUAL_HEADERS,
    monetaryColumns: [4] // costoTotalUSD (0-indexed: 4 after combining fecha)
  },
  {
    title: 'Uso de API',
    headers: USO_API_HEADERS,
    monetaryColumns: [8] // estimatedCostUSD (0-indexed: 8)
  },
];
