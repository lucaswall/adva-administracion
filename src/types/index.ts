/**
 * Type definitions for ADVA Invoice Scanner
 * All TypeScript interfaces and types
 */

/**
 * Result type for operations that can succeed or fail
 * Replaces exceptions with explicit error handling
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Log levels for the logging system
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Result of storing a document to a spreadsheet
 * Distinguishes between "stored" (new row added) and "skipped" (duplicate detected)
 */
export interface StoreResult {
  /** true if row was added, false if duplicate skipped */
  stored: boolean;
  /** fileId of existing duplicate if skipped */
  existingFileId?: string;
  /** true if an existing row was updated in place (reprocessing) */
  updated?: boolean;
  /** fileId of the existing entry that was replaced by a better-quality document */
  replacedFileId?: string;
}

/**
 * Document types that can be processed
 *
 * Extended classification (Phase 4):
 * - factura_emitida: Invoice FROM ADVA (ADVA is emisor) → goes to Ingresos
 * - factura_recibida: Invoice TO ADVA (ADVA is receptor) → goes to Egresos
 * - pago_enviado: Payment BY ADVA → goes to Egresos
 * - pago_recibido: Payment TO ADVA → goes to Ingresos
 * - resumen_bancario: Bank account statement → goes to Bancos
 * - resumen_tarjeta: Credit card statement → goes to Bancos
 * - resumen_broker: Broker/investment statement → goes to Bancos
 * - recibo: Salary receipt → goes to Egresos
 * - certificado_retencion: Tax withholding certificate → goes to Ingresos
 */
export type DocumentType =
  | 'factura_emitida'    // Invoice FROM ADVA (ADVA is emisor)
  | 'factura_recibida'   // Invoice TO ADVA (ADVA is receptor)
  | 'pago_enviado'       // Payment BY ADVA
  | 'pago_recibido'      // Payment TO ADVA
  | 'resumen_bancario'   // Bank account statement
  | 'resumen_tarjeta'    // Credit card statement
  | 'resumen_broker'     // Broker/investment statement
  | 'recibo'             // Salary receipt
  | 'certificado_retencion' // Tax withholding certificate
  | 'unrecognized'
  | 'unknown';

/**
 * Processing status for files
 */
export type ProcessStatus = 'processed' | 'error' | 'pending';

/**
 * Match confidence levels
 */
export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'MANUAL';

/**
 * ARCA comprobante types
 * LP = Liquidación de Premio (insurance documents)
 */
export type TipoComprobante = 'A' | 'B' | 'C' | 'E' | 'NC' | 'NC A' | 'NC B' | 'NC C' | 'NC E' | 'ND' | 'ND A' | 'ND B' | 'ND C' | 'ND E' | 'LP';

/**
 * Currency types
 */
export type Moneda = 'ARS' | 'USD';

/**
 * Recibo types
 */
export type TipoRecibo = 'sueldo' | 'liquidacion_final';

/**
 * Argentine ARCA Factura (Invoice)
 */
export interface Factura {
  // File tracking
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;

  // Comprobante identification
  /** Type of comprobante (A, B, C, E, NC, NC A/B/C, ND, ND A/B/C, LP) */
  tipoComprobante: TipoComprobante;
  /** Full invoice number (e.g., "00003-00001957" or "0003-00001957") */
  nroFactura: string;

  // Dates
  /** Issue date (ISO format: YYYY-MM-DD) */
  fechaEmision: string;

  // Parties
  /** Issuer CUIT (11 digits, no dashes) */
  cuitEmisor: string;
  /** Issuer business name */
  razonSocialEmisor: string;
  /** Receptor CUIT (optional, may be ADVA's or client's) */
  cuitReceptor?: string;
  /** Receptor business name (optional) */
  razonSocialReceptor?: string;
  /** Receptor's IVA condition — factura_emitida only (ADVA's own condition is constant) */
  condicionIVAReceptor?: string;

  // Amounts (in original currency)
  /** Net amount before tax */
  importeNeto: number;
  /** IVA/VAT amount */
  importeIva: number;
  /** Total amount */
  importeTotal: number;
  /** Currency */
  moneda: Moneda;
  /** Exchange rate for USD invoices (AFIP rate at invoice date) */
  tipoDeCambio?: number;

  // Optional
  /** Brief description or concept */
  concepto?: string;

  // Processing metadata
  /** When this record was processed (ISO timestamp) */
  processedAt: string;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;
  /** File ID of matched Pago (if any) */
  matchedPagoFileId?: string;
  /** Match confidence level (if matched) */
  matchConfidence?: MatchConfidence;
  /** Whether the match was based on CUIT match */
  hasCuitMatch?: boolean;
  /** Pagada flag from Control sheet column T ('SI' once any matcher confirms payment; undefined when blank/absent) */
  pagada?: string;
}

/**
 * Bank Payment Slip (Comprobante de Pago)
 */
export interface Pago {
  // File tracking
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;

  // Bank info
  /** Bank name (e.g., "BBVA") */
  banco: string;

  // Transaction
  /** Payment date (ISO format: YYYY-MM-DD) */
  fechaPago: string;
  /** Amount paid */
  importePagado: number;
  /** Currency */
  moneda: Moneda;
  /** Exchange rate for cross-currency payments (bank liquidation rate) */
  tipoDeCambio?: number;
  /** Equivalent amount in ARS for cross-currency payments */
  importeEnPesos?: number;
  /** Transaction reference/ID (if visible) */
  referencia?: string;

  // Payer info (if visible in document)
  /** Payer CUIT (11 digits, no dashes) */
  cuitPagador?: string;
  /** Payer name */
  nombrePagador?: string;

  // Beneficiary info (if visible in document)
  /** Beneficiary CUIT (11 digits, no dashes) */
  cuitBeneficiario?: string;
  /** Beneficiary name */
  nombreBeneficiario?: string;

  // Description
  /** Payment description or concept */
  concepto?: string;

  // Processing metadata
  /** When this record was processed (ISO timestamp) */
  processedAt: string;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;

  // Matching
  /** File ID of matched Factura (if any) */
  matchedFacturaFileId?: string;
  /** Match confidence level */
  matchConfidence?: MatchConfidence;
}

/**
 * Salary Payment Slip (Recibo de Sueldo / Liquidación Final)
 */
export interface Recibo {
  // File tracking
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;

  // Document type
  /** Type of recibo (sueldo or liquidacion_final) */
  tipoRecibo: TipoRecibo;

  // Employee info
  /** Employee name */
  nombreEmpleado: string;
  /** Employee CUIL (11 digits, no dashes) */
  cuilEmpleado: string;
  /** Employee number (Legajo) */
  legajo: string;
  /** Job title (optional) */
  tareaDesempenada?: string;

  // Employer info (always ADVA)
  /** Employer CUIT (always ADVA's CUIT: 30709076783) */
  cuitEmpleador: string;

  // Period and dates
  /** Payment period (e.g., "diciembre/2024") */
  periodoAbonado: string;
  /** Payment date (ISO format: YYYY-MM-DD) */
  fechaPago: string;

  // Amounts
  /** Gross salary before deductions */
  subtotalRemuneraciones: number;
  /** Total deductions */
  subtotalDescuentos: number;
  /** Net salary (what employee receives) */
  totalNeto: number;

  // Processing metadata
  /** When this record was processed (ISO timestamp) */
  processedAt: string;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;

  // Matching
  /** File ID of matched Pago (if any) */
  matchedPagoFileId?: string;
  /** Match confidence level */
  matchConfidence?: MatchConfidence;
  /** Whether the match was based on CUIL match (mirrors Factura.hasCuitMatch) */
  hasCuitMatch?: boolean;
}

/**
 * Credit card types
 */
export type TipoTarjeta = 'Visa' | 'Mastercard' | 'Amex' | 'Naranja' | 'Cabal';

/**
 * Individual transaction from a bank account statement
 */
export interface MovimientoBancario {
  /** Transaction date (ISO format: YYYY-MM-DD) */
  fecha: string;
  /** Transaction description/concept */
  concepto: string;
  /** Debit amount (null if credit transaction) */
  debito: number | null;
  /** Credit amount (null if debit transaction) */
  credito: number | null;
  /** Balance after this transaction */
  saldo: number;
}

/**
 * Bank Account Statement (Resumen Bancario)
 * Represents a monthly bank account statement document
 */
export interface ResumenBancario {
  // File tracking
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;

  // Bank info
  /** Bank name (e.g., "BBVA", "Santander", "Galicia") */
  banco: string;
  /** Account number (typically 10+ digits) */
  numeroCuenta: string;

  // Period
  /** Statement start date (ISO format: YYYY-MM-DD) */
  fechaDesde: string;
  /** Statement end date (ISO format: YYYY-MM-DD) */
  fechaHasta: string;

  // Balances
  /** Opening balance at start of period */
  saldoInicial: number;
  /** Closing balance at end of period */
  saldoFinal: number;
  /** Currency (ARS or USD) */
  moneda: Moneda;

  // Summary
  /** Number of movements in the period */
  cantidadMovimientos: number;
  /** Array of individual transactions (optional, extracted when available) */
  movimientos?: MovimientoBancario[];

  // Processing metadata
  /** When this record was processed (ISO timestamp) */
  processedAt: string;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;
}

/**
 * Bank Account Statement with individual transactions
 */
export interface ResumenBancarioConMovimientos extends ResumenBancario {
  /** Array of individual transactions */
  movimientos: MovimientoBancario[];
}

/**
 * Individual transaction from a credit card statement
 */
export interface MovimientoTarjeta {
  /** Transaction date (ISO format: YYYY-MM-DD) */
  fecha: string;
  /** Transaction description (e.g., "ZOOM.COM 888-799 P38264908USD 16,99") */
  descripcion: string;
  /** Coupon/receipt number (null if not present) */
  nroCupon: string | null;
  /** Amount in ARS (null if USD transaction) */
  pesos: number | null;
  /** Amount in USD (null if ARS transaction) */
  dolares: number | null;
}

/**
 * Credit Card Statement (Resumen de Tarjeta)
 * Represents a monthly credit card statement document
 */
export interface ResumenTarjeta {
  // File tracking
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;

  // Card info
  /** Bank name (e.g., "BBVA", "Santander", "Galicia") */
  banco: string;
  /** Last 4-8 digits of card number */
  numeroCuenta: string;
  /** Card type (Visa, Mastercard, Amex, Naranja, Cabal) */
  tipoTarjeta: TipoTarjeta;

  // Period
  /** Statement start date (ISO format: YYYY-MM-DD) */
  fechaDesde: string;
  /** Statement end date (ISO format: YYYY-MM-DD) */
  fechaHasta: string;

  // Amounts
  /** Minimum payment due */
  pagoMinimo: number;
  /** Current balance (amount owed) */
  saldoActual: number;

  // Summary
  /** Number of movements in the period */
  cantidadMovimientos: number;
  /** Array of individual transactions (optional, extracted when available) */
  movimientos?: MovimientoTarjeta[];

  // Processing metadata
  /** When this record was processed (ISO timestamp) */
  processedAt: string;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;
}

/**
 * Credit Card Statement with individual transactions
 */
export interface ResumenTarjetaConMovimientos extends ResumenTarjeta {
  /** Array of individual transactions */
  movimientos: MovimientoTarjeta[];
}

/**
 * Individual transaction from a broker/investment statement
 */
export interface MovimientoBroker {
  /** Transaction description (e.g., "Boleto / 5863936 / VENTA / 1 / ZZC1O / $") */
  descripcion: string;
  /** Quantity/Nominal Value (null if not applicable) */
  cantidadVN: number | null;
  /** Balance after this transaction */
  saldo: number;
  /** Price per unit (null if not applicable) */
  precio: number | null;
  /** Gross amount (null if not applicable) */
  bruto: number | null;
  /** Fee/tariff amount (null if not applicable) */
  arancel: number | null;
  /** VAT amount (null if not applicable) */
  iva: number | null;
  /** Net amount (null if not applicable) */
  neto: number | null;
  /** Settlement date (ISO format: YYYY-MM-DD) */
  fechaConcertacion: string;
  /** Liquidation date (ISO format: YYYY-MM-DD) */
  fechaLiquidacion: string;
}

/**
 * Broker/Investment Statement (Resumen de Broker)
 * Represents a monthly broker account statement document
 */
export interface ResumenBroker {
  // File tracking
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;

  // Broker info
  /** Broker name (e.g., "BALANZ", "IOL", "PPI") */
  broker: string;
  /** Comitente number (client account) */
  numeroCuenta: string;

  // Period
  /** Statement start date (ISO format: YYYY-MM-DD) */
  fechaDesde: string;
  /** Statement end date (ISO format: YYYY-MM-DD) */
  fechaHasta: string;

  // Balances (multi-currency - both optional)
  /** Balance in ARS (optional) */
  saldoARS?: number;
  /** Balance in USD (optional) */
  saldoUSD?: number;

  // Summary
  /** Number of movements in the period */
  cantidadMovimientos: number;
  /** Array of individual transactions (optional, extracted when available) */
  movimientos?: MovimientoBroker[];

  // Processing metadata
  /** When this record was processed (ISO timestamp) */
  processedAt: string;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;
}

/**
 * Broker/Investment Statement with individual transactions
 */
export interface ResumenBrokerConMovimientos extends ResumenBroker {
  /** Array of individual transactions */
  movimientos: MovimientoBroker[];
}

/**
 * Certificado de Retención (Tax Withholding Certificate)
 * Issued when ADVA receives payment for Facturas Emitidas with tax withheld
 */
export interface Retencion {
  // File tracking
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;

  // Certificate identification
  /** Certificate number (e.g., "000000009185") */
  nroCertificado: string;
  /** Issue date (ISO format: YYYY-MM-DD) */
  fechaEmision: string;

  // Withholding agent (who withheld the tax)
  /** CUIT of withholding agent (11 digits, no dashes) */
  cuitAgenteRetencion: string;
  /** Name of withholding agent */
  razonSocialAgenteRetencion: string;

  // Subject (ADVA - who had tax withheld)
  /** CUIT of subject (should always be ADVA: 30709076783) */
  cuitSujetoRetenido: string;

  // Tax details
  /** Tax type (e.g., "Impuesto a las Ganancias", "IVA", "IIBB") */
  impuesto: string;
  /** Tax regime description */
  regimen: string;

  // Amounts
  /** Original invoice amount */
  montoComprobante: number;
  /** Amount withheld (tax credit for ADVA) */
  montoRetencion: number;

  // Optional
  /** Payment order number if present */
  ordenPago?: string;

  // Processing metadata
  /** When this record was processed (ISO timestamp) */
  processedAt: string;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;

  // Matching (future feature)
  /** File ID of matched Factura Emitida (if any) */
  matchedFacturaFileId?: string;
  /** Match confidence level */
  matchConfidence?: MatchConfidence;
}

/**
 * Processed file tracking record
 */
export interface ProcessedFile {
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;
  /** Last modified timestamp from Drive */
  lastModified: string;
  /** When we processed this file */
  processedAt: string;
  /** Type of document detected */
  documentType: DocumentType;
  /** Processing status */
  status: ProcessStatus;
}

/**
 * Error record for failed extractions
 */
export interface ErrorRecord {
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;
  /** When the error occurred */
  timestamp: string;
  /** Type of error */
  errorType: string;
  /** Error message */
  errorMessage: string;
  /** Raw response from Gemini (if applicable) */
  rawResponse?: string;
}


/**
 * Token usage metadata from Gemini API
 */
export interface GeminiUsageMetadata {
  /** Number of input/prompt tokens */
  promptTokenCount: number;
  /** Number of cached content tokens (if using prompt caching) */
  cachedContentTokenCount?: number;
  /** Number of output/candidate tokens */
  candidatesTokenCount: number;
  /** Total tokens (prompt + cached + candidates) */
  totalTokenCount: number;
}

/**
 * Gemini API response structure
 */
export interface GeminiResponse {
  /** Candidates from the model */
  candidates?: Array<{
    /** Content from the candidate */
    content?: {
      /** Parts of the response */
      parts?: Array<{
        /** Text content */
        text?: string;
      }>;
    };
    /** Finish reason */
    finishReason?: string;
  }>;
  /** Error information (if any) */
  error?: {
    /** Error message */
    message: string;
    /** Error code */
    code?: number;
  };
  /** Token usage metadata */
  usageMetadata?: GeminiUsageMetadata;
}

/**
 * ADVA role validation result
 * Validates that ADVA CUIT is in the expected role for the document type
 */
export interface AdvaRoleValidation {
  /** Whether ADVA is in the correct role */
  isValid: boolean;
  /** Expected role for this document type */
  expectedRole: 'emisor' | 'receptor' | 'pagador' | 'beneficiario' | 'empleador';
  /** ADVA's CUIT (always 30709076783) */
  advaCuit: string;
  /** Validation error messages */
  errors: string[];
}

/**
 * Parse result with validation info
 */
export interface ParseResult<T> {
  /** Parsed data */
  data: T;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;
  /** Missing required fields */
  missingFields?: string[];
  /** ADVA role validation result */
  roleValidation?: AdvaRoleValidation;
  /**
   * Actual document type determined by extraction/parsing.
   * May differ from classification when CUIT assignment overrides classification.
   * Only set for facturas when the type is determined by name-based CUIT assignment.
   */
  actualDocumentType?: 'factura_emitida' | 'factura_recibida';
}

/**
 * Classification result from Gemini
 *
 * Extended classification (Phase 4) now includes direction:
 * - factura_emitida/factura_recibida: Invoice direction based on ADVA CUIT position
 * - pago_enviado/pago_recibido: Payment direction based on payer/beneficiary
 * - resumen_bancario: Bank account statement
 * - resumen_tarjeta: Credit card statement
 * - resumen_broker: Broker/investment statement
 * - recibo: Salary receipt (unchanged)
 * - certificado_retencion: Tax withholding certificate
 */
export interface ClassificationResult {
  /** Detected document type with direction */
  documentType:
    | 'factura_emitida'
    | 'factura_recibida'
    | 'pago_enviado'
    | 'pago_recibido'
    | 'resumen_bancario'
    | 'resumen_tarjeta'
    | 'resumen_broker'
    | 'recibo'
    | 'certificado_retencion'
    | 'unrecognized';
  /** Classification confidence (0.0 to 1.0) */
  confidence: number;
  /** Brief reason for classification */
  reason: string;
  /** Key indicators found in document */
  indicators: string[];
}

/**
 * Match candidate between Factura and Pago
 */
export interface MatchCandidate {
  /** The matched factura */
  factura: Factura;
  /** File ID of matched factura */
  facturaFileId: string;
  /** Row number of factura in sheet (for sheet updates) */
  facturaRow: number;
  /** Match confidence level */
  confidence: MatchConfidence;
  /** Reasons for the match */
  reasons: string[];
  /** Whether this is an upgrade (replacing existing match) */
  isUpgrade?: boolean;
  /** Existing match confidence (if upgrade) */
  existingMatchConfidence?: MatchConfidence;
  /** Existing pago file ID (if upgrade) */
  existingPagoFileId?: string;
  /** Whether this match has CUIT match */
  hasCuitMatch?: boolean;
  /** Date proximity in days from invoice date */
  dateProximityDays?: number;
  /** Date proximity of existing match (if upgrade) */
  existingDateProximityDays?: number;
}

/**
 * Match candidate between Recibo and Pago
 */
export interface ReciboMatchCandidate {
  /** The matched recibo */
  recibo: Recibo;
  /** File ID of matched recibo */
  reciboFileId: string;
  /** Row number of recibo in sheet (for sheet updates) */
  reciboRow: number;
  /** Match confidence level */
  confidence: MatchConfidence;
  /** Reasons for the match */
  reasons: string[];
  /** Whether this is an upgrade (replacing existing match) */
  isUpgrade?: boolean;
  /** Existing match confidence (if upgrade) */
  existingMatchConfidence?: MatchConfidence;
  /** Existing pago file ID (if upgrade) */
  existingPagoFileId?: string;
  /** Whether this match has CUIT match */
  hasCuitMatch?: boolean;
  /** Date proximity in days from recibo date */
  dateProximityDays?: number;
  /** Date proximity of existing match (if upgrade) */
  existingDateProximityDays?: number;
}

/**
 * Result of matching operation
 */
export interface MatchResult {
  /** Pago being matched */
  pago: Pago;
  /** All matching candidates */
  candidates: MatchCandidate[];
  /** Whether there's a unique match */
  hasUniqueMatch: boolean;
}

/**
 * File information from Drive
 */
export interface FileInfo {
  /** File ID */
  id: string;
  /** File name */
  name: string;
  /** MIME type */
  mimeType: string;
  /** Last updated timestamp */
  lastUpdated: Date;
  /** File content as Buffer */
  content: Buffer;
}

/**
 * Scan result summary
 */
export interface ScanResult {
  /** Whether the scan was skipped */
  skipped?: boolean;
  /** Reason for skip (if skipped) */
  reason?: string;
  /** Number of files processed */
  filesProcessed: number;
  /** Number of facturas added */
  facturasAdded: number;
  /** Number of pagos added */
  pagosAdded: number;
  /** Number of recibos added */
  recibosAdded: number;
  /** Number of matches found */
  matchesFound: number;
  /** Number of errors */
  errors: number;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors */
  errors: string[];
}

/**
 * Gemini API error types
 */
export class GeminiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Parse error types
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public rawData?: string
  ) {
    super(message);
    this.name = 'ParseError';
  }
}


/**
 * Row from Movimientos Bancario per-month sheets
 * Used for matching against Control de Ingresos/Egresos
 */
export interface MovimientoRow {
  /** Sheet name (e.g., "2025-01") */
  sheetName: string;
  /** Row number in sheet (1-indexed, after header) */
  rowNumber: number;
  /** Transaction date */
  fecha: string;
  /** Transaction description/concept */
  concepto: string;
  /** Debit amount - null if credit */
  debito: number | null;
  /** Credit amount - null if debit */
  credito: number | null;
  /** Balance from PDF (for comparison) */
  saldo: number | null;
  /** Calculated balance (formula) */
  saldoCalculado: number | null;
  /** Google Drive fileId of matched document (for replacement logic) */
  matchedFileId: string;
  /** Human-readable match description */
  detalle: string;
  /** Match type: 'AUTO' (algorithmic), 'MANUAL' (user-set), or '' (unmatched) */
  matchedType: 'AUTO' | 'MANUAL' | '';
}

/**
 * Bank match tier for tier-based ranking algorithm
 * Lower tier = better match
 * Tier 1: Pago with linked Factura
 * Tier 2: CUIT match from concepto
 * Tier 3: Referencia match
 * Tier 4: Name token score >= 2
 * Tier 5: Amount + date only
 */
export type BankMatchTier = 1 | 2 | 3 | 4 | 5;

/**
 * Match type for bank movement matching
 */
export type BankMatchType = 'bank_fee' | 'credit_card_payment' | 'pago_factura' | 'direct_factura' | 'recibo' | 'pago_only' | 'no_match';

/**
 * Result of matching a bank movement
 */
export interface BankMovementMatchResult {
  /** The movement that was matched */
  movement: MovimientoRow;
  /** Type of match found */
  matchType: BankMatchType;
  /** Generated description in Spanish (empty if no match) */
  description: string;
  /** Google Drive fileId of matched document (for replacement logic) */
  matchedFileId?: string;
  /** CUIT/CUIL extracted from concepto (if any) */
  extractedCuit?: string;
  /** Match confidence */
  confidence: MatchConfidence;
  /** Match tier (1-5, lower is better) */
  tier?: BankMatchTier;
  /** Match reasons for debugging */
  reasons: string[];
}

/**
 * Source movement from BBVA bank export
 * Represents a row from the bank export spreadsheet before transformation
 */
export interface SourceBankMovement {
  /** Transaction date (original format from bank) */
  fecha: string;
  /** Value date (original format from bank) */
  fechaValor: string;
  /** Transaction concept/description */
  concepto: string;
  /** Bank code */
  codigo: string;
  /** Document number (from bank export, not used in target) */
  numeroDocumento: string;
  /** Branch */
  oficina: string;
  /** Credit amount (as string, Argentine format) */
  credito: string;
  /** Debit amount (as string, Argentine format) */
  debito: string;
  /** Detail/description */
  detalle: string;
}

/**
 * Result of importing bank movements
 */
export interface BankImportResult {
  /** Total rows read from source */
  totalSourceRows: number;
  /** Rows already existing in target (duplicates) */
  duplicateRows: number;
  /** New rows imported */
  newRowsImported: number;
  /** Errors encountered during import */
  errors: string[];
  /** Execution duration in milliseconds */
  duration: number;
}


/**
 * Sort destination types for document sorting
 *
 * Renamed from Cobros/Pagos to Ingresos/Egresos (Phase 5):
 * - ingresos: Money coming IN to ADVA (facturas emitidas, pagos recibidos)
 * - egresos: Money going OUT from ADVA (facturas recibidas, pagos enviados, recibos)
 * - bancos: Bank statements (resumenes bancarios)
 * - sin_procesar: Unprocessed/unrecognized documents
 */
export type SortDestination = 'ingresos' | 'egresos' | 'bancos' | 'sin_procesar';

/**
 * Cached folder structure for Drive operations
 * Represents the discovered folder hierarchy
 *
 * Renamed from Cobros/Pagos to Ingresos/Egresos (Phase 5):
 * - Ingresos: Money coming IN to ADVA
 * - Egresos: Money going OUT from ADVA
 */
export interface FolderStructure {
  /** Root folder ID */
  rootId: string;
  /** Entrada (incoming) folder ID - stays at root */
  entradaId: string;
  /** Sin Procesar (unprocessed) folder ID - stays at root */
  sinProcesarId: string;
  /** Duplicado (duplicate files) folder ID - stays at root */
  duplicadoId: string;
  /** Control de Ingresos spreadsheet ID - stays at root */
  controlIngresosId: string;
  /** Control de Egresos spreadsheet ID - stays at root */
  controlEgresosId: string;
  /** Dashboard Operativo Contable spreadsheet ID - stays at root */
  dashboardOperativoId: string;
  /** Map of bank spreadsheet names to IDs */
  bankSpreadsheets: Map<string, string>;
  /** Map of Movimientos spreadsheet folder names to spreadsheet IDs */
  movimientosSpreadsheets: Map<string, string>;
  /** Cache of year folders by year (e.g., "2024" -> folder ID) */
  yearFolders: Map<string, string>;
  /** Cache of classification folders by year:classification key (e.g., "2024:ingresos" -> folder ID) */
  classificationFolders: Map<string, string>;
  /** Cache of month folders by year:destination:month key (e.g., "2024:ingresos:01 - Enero" -> folder ID) */
  monthFolders: Map<string, string>;
  /** Cache of bank account folders by year:banco:cuenta:moneda key (e.g., "2024:Santander 1234567890 ARS" -> folder ID) */
  bankAccountFolders: Map<string, string>;
  /** Cache of bank account spreadsheets by year:banco:cuenta:moneda key (e.g., "2024:Santander 1234567890 ARS" -> spreadsheet ID) */
  bankAccountSpreadsheets: Map<string, string>;
  /** Subdiario de Ventas spreadsheet ID (optional — populated lazily by syncSubdiario on first run) */
  subdiarioId?: string;
  /** When the structure was last refreshed */
  lastRefreshed: Date;
}

/**
 * Result of sorting a document into the folder structure
 */
export interface SortResult {
  /** Whether the sort was successful */
  success: boolean;
  /** Target folder ID where file was moved */
  targetFolderId?: string;
  /** Target folder path (human-readable) */
  targetPath?: string;
  /** Error message if unsuccessful */
  error?: string;
  /** Warning when file was moved successfully but rename failed (ADV-348) */
  renameWarning?: string;
}

/**
 * Watch channel information for Drive push notifications
 */
export interface WatchChannel {
  /** Unique channel identifier (UUID) */
  channelId: string;
  /** Resource ID from Drive API */
  resourceId: string;
  /** Folder being watched */
  folderId: string;
  /** Channel expiration timestamp */
  expiration: Date;
  /** When the channel was created */
  createdAt: Date;
}

/**
 * Watch manager status for health checks
 */
export interface WatchManagerStatus {
  /** Whether the watch manager is enabled */
  enabled: boolean;
  /** Number of active watch channels */
  activeChannels: number;
  /** Channels and their expiration times */
  channels: Array<{
    folderId: string;
    expiresIn: number; // milliseconds
  }>;
  /** Last notification received timestamp */
  lastNotification: Date | null;
  /** Last scan triggered timestamp */
  lastScan: Date | null;
}

/**
 * A bank movimiento row with matching data, as needed by the Subdiario builder.
 * Subset of MovimientoRow — only the fields the builder uses.
 */
export interface BankMovimiento {
  /** Transaction date (YYYY-MM-DD) */
  fecha: string;
  /** Credit amount (ARS) — null if debit transaction */
  credito: number | null;
  /** Debit amount (ARS) — null if credit transaction */
  debito: number | null;
  /** Google Drive fileId of matched document ('' if unmatched) */
  matchedFileId: string;
  /** Match type: 'AUTO', 'MANUAL', or '' (unmatched) */
  matchedType: 'AUTO' | 'MANUAL' | '';
  /** Transaction description/concept */
  concepto?: string;
  /**
   * Google Sheets URL pointing at the source bank row.
   * Format: `https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit#gid={sheetId}&range=A{rowNumber}`.
   * Used by the Subdiario writer to render the `movimiento` text-format link target.
   * Identity is per-row (assigned even when `matchedFileId` is empty).
   */
  sourceUrl: string;
  /**
   * Descriptive cell text used by the Subdiario `movimiento` column.
   * Format: `{bankFolderName} {sheetTitle} #{rowNumber}` (e.g.,
   * `'BBVA 007-009364/1 ARS 2026-03 #42'`). Always populated for every row,
   * even unmatched ones (it's row-identity, not match-identity).
   */
  label: string;
}

/**
 * Entry from the Facturador de Socios spreadsheet.
 * Produced by the facturador-reader service (ADV-246).
 */
export interface FacturadorEntry {
  /** Socio number (e.g., '1003') */
  nroSocio: string;
  /** Normalized comprobante number (key in the reader map) */
  comprobante: string;
  /** Company / legal name (may be empty — caller falls back to representante) */
  empresa: string;
  /** Representative name */
  representante: string;
  /** Contact email */
  email: string;
  /** Membership tier — becomes `categoria` in SubdiarioRow (e.g., 'Micro', 'Empresa') */
  membresia: string;
  /** Internal cobro ID */
  cobroId: string;
  /** IVA condition of the socio (e.g., 'IVA Responsable Inscripto') */
  condIVA: string;
  /** Invoice date in the Facturador */
  fecha: string;
  /** Invoice amount in ARS */
  importe: number;
  /** Raw value from the Pagado? column (may be an NC number like '0005-00000011') */
  pagadoCol: string;
}

/**
 * A single row in the Subdiario de Ventas workbook.
 * Output type of buildSubdiarioRows().
 */
export interface SubdiarioRow {
  /** Invoice date (YYYY-MM-DD) */
  fecha: string;
  /** AFIP comprobante code: 001, 003, 006, 008, 011, 013, 019, 021 */
  cod: string;
  /** 'FC' for facturas, 'NC' for notas de crédito */
  tipo: 'FC' | 'NC';
  /** Normalized comprobante number (e.g., '00003-00001956') */
  nro: string;
  /** Receptor's legal name from AFIP (razonSocialReceptor) */
  cliente: string;
  /** Receptor CUIT */
  cuit: string;
  /** Receptor's IVA condition (from PDF or Facturador) */
  condicion: string;
  /** Total in ARS (negative for NCs, 0 for placeholders) */
  total: number;
  /** Brief description/concept */
  concepto: string;
  /** Membership tier for socios ('Micro', 'Empresa', etc.), '' for non-socios/NCs/placeholders */
  categoria: string;
  /**
   * Date of payment (YYYY-MM-DD), or 'NC 00003-00000140' if cancelled by NC,
   * or '' if unpaid/placeholder
   */
  fechaCobro: string;
  /**
   * Sum of matched movimientos credito (positive for FCs, same as total for NCs).
   * `null` when nothing was received: FC unpaid, FC cancelled by NC, or placeholder.
   */
  recibido: number | null;
  /**
   * Google Sheets URL for the matched bank movimiento (latest cuota's `sourceUrl`)
   * or empty string. Rendered as the URI of the col M textFormatRuns link by the
   * writer. Hard-paid FCs only — soft-paid, unpaid, NC-cancelled, and gap rows
   * leave it empty so the column's semantic stays "authoritative bank movement".
   * ADV-272.
   *
   * NOTE (ADV-281): the URL is unknowable from a sheet read (the read side
   * captures only the displayed text — `movimientoLabel`). The diff equality
   * therefore SKIPS this field entirely and keys on `movimientoLabel` instead.
   */
  movimiento: string;
  /**
   * Displayed text for the col M link (ADV-281). Format:
   * `{bankFolderName} {YYYY-MM} #{rowNumber}` (e.g., `'BBVA ARS 2026-03 #42'`).
   * Empty when the row has no matched bank movimiento. This is the field the
   * diff equality keys on — it round-trips through `getValues`, unlike the URL.
   */
  movimientoLabel: string;
  /**
   * Source factura's Drive fileId (ADV-280). Rendered as the URI of the col D
   * textFormatRuns link so operators can click the nro to open the PDF. Empty
   * for FALTA placeholder rows. Read-side always reports '' — the cell content
   * does not encode the fileId — so the diff equality skips this field.
   */
  facturaFileId: string;
  /** Additional annotations: socio info, export TC, retencion, multi-cuota, etc. */
  notas: string;
}

/**
 * A SubdiarioRow with its 0-indexed position in the Comprobantes sheet.
 * First data row (after the header) has rowIndex=0.
 */
export interface SubdiarioRowWithIndex extends SubdiarioRow {
  /** 0-indexed row position in the sheet (row 0 = first data row, below header) */
  rowIndex: number;
}

/**
 * Result of diffing existing sheet rows against the desired row set.
 * Produced by diffSubdiarioRows().
 */
export interface SubdiarioDiff {
  /**
   * Rows to update in place: (cod, nro) matched but at least one field changed.
   * `rowIndex`: original 0-based existing position (used for ordering only).
   * `desiredIndex`: 0-based position in the desired array — used by applySubdiarioDiff
   *   to compute the correct sheetRow AFTER all prior deletions and insertions shift it.
   */
  updates: { rowIndex: number; desiredIndex: number; row: SubdiarioRow }[];
  /** Rows to insert: in desired but not in existing; insertAt = position in desired array */
  inserts: { insertAt: number; row: SubdiarioRow }[];
  /** Existing row indices to delete, sorted DESCENDING (bottom-up to avoid index shift) */
  deletes: number[];
  /** True when existing rows are not sorted by (fecha ASC, nro ASC); caller falls back to full rewrite */
  sortInvariantViolated: boolean;
  /** True when (cod, nro) is non-unique in existing; first occurrence kept, rest emitted as deletes */
  duplicateKeysDetected: boolean;
}

/**
 * Input to the buildSubdiarioRows() pure function.
 */
export interface SubdiarioInput {
  /** The fiscal year being built (e.g., 2026) */
  currentYear: number;
  /** All rows from Control de Ingresos / Facturas Emitidas (full history; builder applies scope filter) */
  facturasEmitidas: Factura[];
  /** All rows from Control de Ingresos / Pagos Recibidos */
  pagosRecibidos: Pago[];
  /** All rows from Control de Ingresos / Retenciones Recibidas */
  retencionesRecibidas: Retencion[];
  /** All movimientos from all bank sheets, with matchedFileId/matchedType populated */
  movimientos: BankMovimiento[];
  /** Facturador de Socios lookup table, keyed by normalized comprobante (empty Map if env var unset) */
  facturador: Map<string, FacturadorEntry>;
  /** Optional: official exchange rate per YYYY-MM period (TC oficial fallback for export FCs) */
  tipoCambioByPeriodo?: Map<string, number>;
}
