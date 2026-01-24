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

/** Headers for Resumenes Bancarios sheet (legacy - not currently used) */
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

/**
 * Sheet configuration for Control de Resumenes spreadsheet - Bank Accounts
 * Stores bank account statements in bank account-specific folders
 * Folder: {YYYY}/Bancos/{Bank} {Account} {Currency}/
 */
export const CONTROL_RESUMENES_BANCARIO_SHEET: SheetConfig = {
  title: 'Resumenes',
  headers: [
    'fechaDesde',
    'fechaHasta',
    'fileId',
    'fileName',
    'banco',
    'numeroCuenta',
    'moneda',          // ARS|USD
    'saldoInicial',
    'saldoFinal',
  ],
  numberFormats: new Map([
    [0, { type: 'date' }],              // fechaDesde
    [1, { type: 'date' }],              // fechaHasta
    [7, { type: 'currency', decimals: 2 }],  // saldoInicial
    [8, { type: 'currency', decimals: 2 }],  // saldoFinal
  ]),
};

/**
 * Sheet configuration for Control de Resumenes spreadsheet - Credit Cards
 * Stores credit card statements in card-specific folders
 * Folder: {YYYY}/Bancos/{Bank} {CardType} {LastDigits}/
 */
export const CONTROL_RESUMENES_TARJETA_SHEET: SheetConfig = {
  title: 'Resumenes',
  headers: [
    'fechaDesde',
    'fechaHasta',
    'fileId',
    'fileName',
    'banco',
    'numeroCuenta',
    'tipoTarjeta',     // Visa|Mastercard|Amex|Naranja|Cabal
    'pagoMinimo',
    'saldoActual',
  ],
  numberFormats: new Map([
    [0, { type: 'date' }],              // fechaDesde
    [1, { type: 'date' }],              // fechaHasta
    [7, { type: 'currency', decimals: 2 }],  // pagoMinimo
    [8, { type: 'currency', decimals: 2 }],  // saldoActual
  ]),
};

/**
 * Sheet configuration for Control de Resumenes spreadsheet - Broker/Investment
 * Stores broker statements in broker-specific folders
 * Folder: {YYYY}/Bancos/{Broker} {Comitente}/
 */
export const CONTROL_RESUMENES_BROKER_SHEET: SheetConfig = {
  title: 'Resumenes',
  headers: [
    'fechaDesde',
    'fechaHasta',
    'fileId',
    'fileName',
    'broker',
    'numeroCuenta',
    'saldoARS',        // Balance in ARS (optional)
    'saldoUSD',        // Balance in USD (optional)
  ],
  numberFormats: new Map([
    [0, { type: 'date' }],              // fechaDesde
    [1, { type: 'date' }],              // fechaHasta
    [6, { type: 'currency', decimals: 2 }],  // saldoARS
    [7, { type: 'currency', decimals: 2 }],  // saldoUSD
  ]),
};

/** Number format patterns */
export type NumberFormat =
  | { type: 'currency'; decimals: 2 }  // e.g., $1,234.56
  | { type: 'currency'; decimals: 8 }  // e.g., 0.00000123 (for cost-per-token)
  | { type: 'number'; decimals: 0 }    // e.g., 1,234 (for counts)
  | { type: 'number'; decimals: 2 }    // e.g., 12.34 (for rates/percentages)
  | { type: 'date' };                  // e.g., yyyy-mm-dd

/** Sheet configuration */
export interface SheetConfig {
  title: string;
  headers: string[];
  monetaryColumns?: number[]; // 0-indexed column numbers to format as currency
  numberFormats?: Map<number, NumberFormat>; // 0-indexed column number -> format
}

/**
 * Required sheets for Control de Ingresos spreadsheet
 * Ingresos = money coming IN to ADVA (facturas emitidas, pagos recibidos, retenciones)
 */
export const CONTROL_INGRESOS_SHEETS: SheetConfig[] = [
  {
    title: 'Facturas Emitidas',
    headers: FACTURA_EMITIDA_HEADERS,
    numberFormats: new Map([
      [0, { type: 'date' }],                    // fechaEmision
      [7, { type: 'currency', decimals: 2 }],   // importeNeto
      [8, { type: 'currency', decimals: 2 }],   // importeIva
      [9, { type: 'currency', decimals: 2 }],   // importeTotal
    ]),
  },
  {
    title: 'Pagos Recibidos',
    headers: PAGO_RECIBIDO_HEADERS,
    numberFormats: new Map([
      [0, { type: 'date' }],                    // fechaPago
      [4, { type: 'currency', decimals: 2 }],   // importePagado
    ]),
  },
  {
    title: 'Retenciones Recibidas',
    headers: RETENCIONES_RECIBIDAS_HEADERS,
    numberFormats: new Map([
      [0, { type: 'date' }],                    // fechaEmision
      [8, { type: 'currency', decimals: 2 }],   // montoComprobante
      [9, { type: 'currency', decimals: 2 }],   // montoRetencion
    ]),
  },
];

/**
 * Required sheets for Control de Egresos spreadsheet
 * Egresos = money going OUT from ADVA (facturas recibidas, pagos enviados, recibos)
 */
export const CONTROL_EGRESOS_SHEETS: SheetConfig[] = [
  {
    title: 'Facturas Recibidas',
    headers: FACTURA_RECIBIDA_HEADERS,
    numberFormats: new Map([
      [0, { type: 'date' }],                    // fechaEmision
      [7, { type: 'currency', decimals: 2 }],   // importeNeto
      [8, { type: 'currency', decimals: 2 }],   // importeIva
      [9, { type: 'currency', decimals: 2 }],   // importeTotal
    ]),
  },
  {
    title: 'Pagos Enviados',
    headers: PAGO_ENVIADO_HEADERS,
    numberFormats: new Map([
      [0, { type: 'date' }],                    // fechaPago
      [4, { type: 'currency', decimals: 2 }],   // importePagado
    ]),
  },
  {
    title: 'Recibos',
    headers: RECIBO_HEADERS,
    numberFormats: new Map([
      [0, { type: 'date' }],                    // fechaPago
      [10, { type: 'currency', decimals: 2 }],  // subtotalRemuneraciones
      [11, { type: 'currency', decimals: 2 }],  // subtotalDescuentos
      [12, { type: 'currency', decimals: 2 }],  // totalNeto
    ]),
  },
];

/** Headers for Resumen Mensual sheet */
export const RESUMEN_MENSUAL_HEADERS = [
  'fecha',
  'totalLlamadas',
  'tokensEntrada',
  'tokensCache',
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
  'cachedTokens',
  'outputTokens',
  'promptCostPerToken',
  'cachedCostPerToken',
  'outputCostPerToken',
  'estimatedCostUSD',
  'durationMs',
  'success',
  'errorMessage',
];

/** Headers for Pagos Pendientes sheet - unpaid invoices from Control de Egresos */
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
    numberFormats: new Map([
      [1, { type: 'number', decimals: 0 }],  // totalLlamadas - thousands separator
      [2, { type: 'number', decimals: 0 }],  // tokensEntrada - thousands separator
      [3, { type: 'number', decimals: 0 }],  // tokensCache - thousands separator
      [4, { type: 'number', decimals: 0 }],  // tokensSalida - thousands separator
      [5, { type: 'currency', decimals: 2 }], // costoTotalUSD - 2 decimals
      [6, { type: 'number', decimals: 2 }],  // tasaExito - 2 decimals (success rate)
      [7, { type: 'number', decimals: 2 }],  // duracionPromedio - 2 decimals (avg duration)
    ])
  },
  {
    title: 'Uso de API',
    headers: USO_API_HEADERS,
    numberFormats: new Map([
      [8, { type: 'currency', decimals: 8 }],  // promptCostPerToken - 8 decimals
      [9, { type: 'currency', decimals: 8 }],  // cachedCostPerToken - 8 decimals
      [10, { type: 'currency', decimals: 8 }], // outputCostPerToken - 8 decimals
      [11, { type: 'currency', decimals: 8 }], // estimatedCostUSD - 8 decimals
    ])
  },
];
