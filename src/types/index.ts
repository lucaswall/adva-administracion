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
 * Document types that can be processed
 *
 * Extended classification (Phase 4):
 * - factura_emitida: Invoice FROM ADVA (ADVA is emisor) → goes to Creditos
 * - factura_recibida: Invoice TO ADVA (ADVA is receptor) → goes to Debitos
 * - pago_enviado: Payment BY ADVA → goes to Debitos
 * - pago_recibido: Payment TO ADVA → goes to Creditos
 * - resumen_bancario: Bank statement → goes to Bancos
 * - recibo: Salary receipt → goes to Debitos
 */
export type DocumentType =
  | 'factura_emitida'    // Invoice FROM ADVA (ADVA is emisor)
  | 'factura_recibida'   // Invoice TO ADVA (ADVA is receptor)
  | 'pago_enviado'       // Payment BY ADVA
  | 'pago_recibido'      // Payment TO ADVA
  | 'resumen_bancario'   // Bank statement
  | 'recibo'             // Salary receipt
  | 'unrecognized'
  | 'unknown';

/**
 * Processing status for files
 */
export type ProcessStatus = 'processed' | 'error' | 'pending';

/**
 * Match confidence levels
 */
export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * ARCA comprobante types
 */
export type TipoComprobante = 'A' | 'B' | 'C' | 'E' | 'NC' | 'ND';

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
  /** Relative folder path where file was found */
  folderPath: string;

  // Comprobante identification
  /** Type of comprobante (A, B, C, E, NC, ND) */
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

  // Amounts (in original currency)
  /** Net amount before tax */
  importeNeto: number;
  /** IVA/VAT amount */
  importeIva: number;
  /** Total amount */
  importeTotal: number;
  /** Currency */
  moneda: Moneda;

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
  /** Relative folder path where file was found */
  folderPath: string;

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
  /** Relative folder path where file was found */
  folderPath: string;

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
}

/**
 * Bank Statement (Resumen Bancario)
 * Represents a monthly bank statement document
 */
export interface ResumenBancario {
  // File tracking
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;
  /** Relative folder path where file was found */
  folderPath: string;

  // Bank info
  /** Bank name (e.g., "BBVA", "Santander", "Galicia") */
  banco: string;
  /** Account number or card brand (e.g., "1234567890" or "VISA", "Mastercard") */
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
  /** Currency */
  moneda: Moneda;

  // Summary
  /** Number of movements in the period */
  cantidadMovimientos: number;

  // Processing metadata
  /** When this record was processed (ISO timestamp) */
  processedAt: string;
  /** Extraction confidence (0.0 to 1.0) */
  confidence: number;
  /** Whether manual review is needed */
  needsReview: boolean;
}

/**
 * Processed file tracking record
 */
export interface ProcessedFile {
  /** Google Drive file ID */
  fileId: string;
  /** Original filename */
  fileName: string;
  /** Relative folder path where file was found */
  folderPath: string;
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
}

/**
 * Classification result from Gemini
 *
 * Extended classification (Phase 4) now includes direction:
 * - factura_emitida/factura_recibida: Invoice direction based on ADVA CUIT position
 * - pago_enviado/pago_recibido: Payment direction based on payer/beneficiary
 * - resumen_bancario: Bank statement
 * - recibo: Salary receipt (unchanged)
 */
export interface ClassificationResult {
  /** Detected document type with direction */
  documentType:
    | 'factura_emitida'
    | 'factura_recibida'
    | 'pago_enviado'
    | 'pago_recibido'
    | 'resumen_bancario'
    | 'recibo'
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
  /** Whether this match has CUIL match */
  hasCuilMatch?: boolean;
  /** Date proximity in days from recibo date */
  dateProximityDays?: number;
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
  /** Relative folder path from root (e.g., "2024/Enero" or "" for root) */
  folderPath: string;
}

/**
 * Scan result summary
 */
export interface ScanResult {
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
 * Bank movement from external spreadsheet
 */
export interface BankMovement {
  /** Row number in external sheet (1-indexed) */
  row: number;
  /** Transaction date (Fecha column) */
  fecha: string;
  /** Value date (Fecha Valor column) */
  fechaValor: string;
  /** Transaction concept/description (Concepto column) */
  concepto: string;
  /** Bank code (Codigo column) */
  codigo: string;
  /** Branch (Oficina column) */
  oficina: string;
  /** ADVA area (Area ADVA column) */
  areaAdva: string;
  /** Credit amount - null if debit */
  credito: number | null;
  /** Debit amount - null if credit */
  debito: number | null;
  /** Existing detail (Detalle column) */
  detalle: string;
}

/**
 * Match type for bank movement matching
 */
export type BankMatchType = 'bank_fee' | 'credit_card_payment' | 'subdiario_cobro' | 'pago_factura' | 'direct_factura' | 'recibo' | 'pago_only' | 'no_match';

/**
 * Result of matching a bank movement
 */
export interface BankMovementMatchResult {
  /** The movement that was matched */
  movement: BankMovement;
  /** Type of match found */
  matchType: BankMatchType;
  /** Generated description in Spanish (empty if no match) */
  description: string;
  /** CUIT/CUIL extracted from concepto (if any) */
  extractedCuit?: string;
  /** Match confidence */
  confidence: MatchConfidence;
  /** Match reasons for debugging */
  reasons: string[];
}

/**
 * Auto-fill operation result
 */
export interface BankAutoFillResult {
  /** Total rows processed */
  rowsProcessed: number;
  /** Rows filled with descriptions */
  rowsFilled: number;
  /** Matches for bank fees (gastos bancarios) */
  bankFeeMatches: number;
  /** Matches for credit card payments */
  creditCardPaymentMatches: number;
  /** Matches from Subdiario de Ventas Cobros */
  subdiarioCobroMatches: number;
  /** Matches via Pago→Factura link */
  pagoFacturaMatches: number;
  /** Direct Factura matches */
  directFacturaMatches: number;
  /** Recibo matches */
  reciboMatches: number;
  /** Pago-only matches (REVISAR) */
  pagoOnlyMatches: number;
  /** Rows with no match */
  noMatches: number;
  /** Errors encountered */
  errors: number;
  /** Execution duration in milliseconds */
  duration: number;
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
 * Cobro from Subdiario de Ventas spreadsheet
 * Represents a collection/payment received from a client
 */
export interface SubdiarioCobro {
  /** Row number in Cobros sheet (1-indexed) */
  rowNumber: number;
  /** Collection date (when payment was received) */
  fechaCobro: Date;
  /** Invoice date (from the original invoice) */
  fechaFactura: Date;
  /** Invoice number (e.g., "00003-00001957") */
  comprobanteNumero: string;
  /** Client name */
  cliente: string;
  /** Client CUIT (11 digits) */
  cuit: string;
  /** Total amount collected */
  total: number;
  /** Payment concept/description */
  concepto: string;
  /** Category */
  categoria: string;
}

/**
 * Match result for Subdiario de Ventas matching
 */
export interface SubdiarioMatchResult {
  /** Whether a match was found */
  matched: boolean;
  /** The matched cobro (if any) */
  cobro?: SubdiarioCobro;
  /** Match confidence level */
  confidence: MatchConfidence;
  /** Match reasons for debugging */
  reasons: string[];
  /** Generated Detalle text */
  detalle: string;
}

/**
 * Sort destination types for document sorting
 *
 * Renamed from Cobros/Pagos to Creditos/Debitos (Phase 5):
 * - creditos: Money coming IN to ADVA (facturas emitidas, pagos recibidos)
 * - debitos: Money going OUT from ADVA (facturas recibidas, pagos enviados, recibos)
 * - bancos: Bank statements (resumenes bancarios)
 * - sin_procesar: Unprocessed/unrecognized documents
 */
export type SortDestination = 'creditos' | 'debitos' | 'bancos' | 'sin_procesar';

/**
 * Cached folder structure for Drive operations
 * Represents the discovered folder hierarchy
 *
 * Renamed from Cobros/Pagos to Creditos/Debitos (Phase 5):
 * - Creditos: Money coming IN to ADVA
 * - Debitos: Money going OUT from ADVA
 */
export interface FolderStructure {
  /** Root folder ID */
  rootId: string;
  /** Entrada (incoming) folder ID - stays at root */
  entradaId: string;
  /** Sin Procesar (unprocessed) folder ID - stays at root */
  sinProcesarId: string;
  /** Control de Creditos spreadsheet ID - stays at root */
  controlCreditosId: string;
  /** Control de Debitos spreadsheet ID - stays at root */
  controlDebitosId: string;
  /** Map of bank spreadsheet names to IDs */
  bankSpreadsheets: Map<string, string>;
  /** Cache of year folders by year (e.g., "2024" -> folder ID) */
  yearFolders: Map<string, string>;
  /** Cache of classification folders by year:classification key (e.g., "2024:creditos" -> folder ID) */
  classificationFolders: Map<string, string>;
  /** Cache of month folders by year:destination:month key (e.g., "2024:creditos:01 - Enero" -> folder ID) */
  monthFolders: Map<string, string>;
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
