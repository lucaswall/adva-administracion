/**
 * Spreadsheet header definitions for Control de Cobros and Control de Pagos
 * These headers match the SPREADSHEET_FORMAT.md specification
 */

/** Headers for Facturas Emitidas sheet - ADVA is emisor, only store receptor info (columns A:S) */
export const FACTURA_EMITIDA_HEADERS = [
  'fechaEmision',           // A - date column first
  'fileId',                 // B
  'fileName',               // C
  'tipoComprobante',        // D
  'nroFactura',             // E
  'cuitReceptor',           // F - counterparty only
  'razonSocialReceptor',    // G - counterparty only
  'importeNeto',            // H
  'importeIva',             // I
  'importeTotal',           // J
  'moneda',                 // K
  'concepto',               // L
  'processedAt',            // M
  'confidence',             // N
  'needsReview',            // O
  'matchedPagoFileId',      // P
  'matchConfidence',        // Q
  'hasCuitMatch',           // R
];

/** Headers for Facturas Recibidas sheet - ADVA is receptor, only store emisor info (columns A:S) */
export const FACTURA_RECIBIDA_HEADERS = [
  'fechaEmision',           // A - date column first
  'fileId',                 // B
  'fileName',               // C
  'tipoComprobante',        // D
  'nroFactura',             // E
  'cuitEmisor',             // F - counterparty only
  'razonSocialEmisor',      // G - counterparty only
  'importeNeto',            // H
  'importeIva',             // I
  'importeTotal',           // J
  'moneda',                 // K
  'concepto',               // L
  'processedAt',            // M
  'confidence',             // N
  'needsReview',            // O
  'matchedPagoFileId',      // P
  'matchConfidence',        // Q
  'hasCuitMatch',           // R
];

/** Headers for Pagos Enviados sheet - ADVA is pagador, only store beneficiario info (columns A:N) */
export const PAGO_ENVIADO_HEADERS = [
  'fechaPago',              // A - date column first
  'fileId',                 // B
  'fileName',               // C
  'banco',                  // D
  'importePagado',          // E
  'moneda',                 // F
  'referencia',             // G
  'cuitBeneficiario',       // H - counterparty only
  'nombreBeneficiario',     // I - counterparty only
  'concepto',               // J
  'processedAt',            // K
  'confidence',             // L
  'needsReview',            // M
  'matchedFacturaFileId',   // N
  'matchConfidence',        // O
];

/** Headers for Pagos Recibidos sheet - ADVA is beneficiario, only store pagador info (columns A:N) */
export const PAGO_RECIBIDO_HEADERS = [
  'fechaPago',              // A - date column first
  'fileId',                 // B
  'fileName',               // C
  'banco',                  // D
  'importePagado',          // E
  'moneda',                 // F
  'referencia',             // G
  'cuitPagador',            // H - counterparty only
  'nombrePagador',          // I - counterparty only
  'concepto',               // J
  'processedAt',            // K
  'confidence',             // L
  'needsReview',            // M
  'matchedFacturaFileId',   // N
  'matchConfidence',        // O
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
    headers: FACTURA_EMITIDA_HEADERS,
    monetaryColumns: [7, 8, 9] // importeNeto, importeIva, importeTotal (columns H, I, J - 0-indexed: 7, 8, 9)
  },
  {
    title: 'Pagos Recibidos',
    headers: PAGO_RECIBIDO_HEADERS,
    monetaryColumns: [4] // importePagado (column E - 0-indexed: 4)
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
    monetaryColumns: [7, 8, 9] // importeNeto, importeIva, importeTotal (columns H, I, J - 0-indexed: 7, 8, 9)
  },
  {
    title: 'Pagos Enviados',
    headers: PAGO_ENVIADO_HEADERS,
    monetaryColumns: [4] // importePagado (column E - 0-indexed: 4)
  },
  {
    title: 'Recibos',
    headers: RECIBO_HEADERS,
    monetaryColumns: [10, 11, 12] // subtotalRemuneraciones, subtotalDescuentos, totalNeto (0-indexed: 10, 11, 12)
  },
];
