/**
 * Type definitions for ADVA Invoice Scanner
 * All TypeScript interfaces and types
 */
/**
 * Result type for operations that can succeed or fail
 * Replaces exceptions with explicit error handling
 */
export type Result<T, E = Error> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
/**
 * Log levels for the logging system
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
/**
 * Document types that can be processed
 */
export type DocumentType = 'factura' | 'pago' | 'recibo' | 'unrecognized' | 'unknown';
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
    /** Google Drive file ID */
    fileId: string;
    /** Original filename */
    fileName: string;
    /** Relative folder path where file was found */
    folderPath: string;
    /** Type of comprobante (A, B, C, E, NC, ND) */
    tipoComprobante: TipoComprobante;
    /** Punto de venta (4-5 digits, zero-padded) */
    puntoVenta: string;
    /** Sequential invoice number (8 digits, zero-padded) */
    numeroComprobante: string;
    /** Issue date (ISO format: YYYY-MM-DD) */
    fechaEmision: string;
    /** CAE expiration date (ISO format: YYYY-MM-DD) */
    fechaVtoCae: string;
    /** Issuer CUIT (11 digits, no dashes) */
    cuitEmisor: string;
    /** Issuer business name */
    razonSocialEmisor: string;
    /** Receptor CUIT (optional, may be ADVA's or client's) */
    cuitReceptor?: string;
    /** CAE (Código de Autorización Electrónico) - 14 digits */
    cae: string;
    /** Net amount before tax */
    importeNeto: number;
    /** IVA/VAT amount */
    importeIva: number;
    /** Total amount */
    importeTotal: number;
    /** Currency */
    moneda: Moneda;
    /** Brief description or concept */
    concepto?: string;
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
    /** Google Drive file ID */
    fileId: string;
    /** Original filename */
    fileName: string;
    /** Relative folder path where file was found */
    folderPath: string;
    /** Bank name (e.g., "BBVA") */
    banco: string;
    /** Payment date (ISO format: YYYY-MM-DD) */
    fechaPago: string;
    /** Amount paid */
    importePagado: number;
    /** Transaction reference/ID (if visible) */
    referencia?: string;
    /** Payer CUIT (11 digits, no dashes) */
    cuitPagador?: string;
    /** Payer name */
    nombrePagador?: string;
    /** Beneficiary CUIT (11 digits, no dashes) */
    cuitBeneficiario?: string;
    /** Beneficiary name */
    nombreBeneficiario?: string;
    /** Payment description or concept */
    concepto?: string;
    /** When this record was processed (ISO timestamp) */
    processedAt: string;
    /** Extraction confidence (0.0 to 1.0) */
    confidence: number;
    /** Whether manual review is needed */
    needsReview: boolean;
    /** File ID of matched Factura (if any) */
    matchedFacturaFileId?: string;
    /** Match confidence level */
    matchConfidence?: MatchConfidence;
}
/**
 * Salary Payment Slip (Recibo de Sueldo / Liquidación Final)
 */
export interface Recibo {
    /** Google Drive file ID */
    fileId: string;
    /** Original filename */
    fileName: string;
    /** Relative folder path where file was found */
    folderPath: string;
    /** Type of recibo (sueldo or liquidacion_final) */
    tipoRecibo: TipoRecibo;
    /** Employee name */
    nombreEmpleado: string;
    /** Employee CUIL (11 digits, no dashes) */
    cuilEmpleado: string;
    /** Employee number (Legajo) */
    legajo: string;
    /** Job title (optional) */
    tareaDesempenada?: string;
    /** Employer CUIT (always ADVA's CUIT: 30709076783) */
    cuitEmpleador: string;
    /** Payment period (e.g., "diciembre/2024") */
    periodoAbonado: string;
    /** Payment date (ISO format: YYYY-MM-DD) */
    fechaPago: string;
    /** Gross salary before deductions */
    subtotalRemuneraciones: number;
    /** Total deductions */
    subtotalDescuentos: number;
    /** Net salary (what employee receives) */
    totalNeto: number;
    /** When this record was processed (ISO timestamp) */
    processedAt: string;
    /** Extraction confidence (0.0 to 1.0) */
    confidence: number;
    /** Whether manual review is needed */
    needsReview: boolean;
    /** File ID of matched Pago (if any) */
    matchedPagoFileId?: string;
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
 * Application configuration
 */
export interface AppConfig {
    /** Google Drive folder ID to scan */
    sourceFolderId: string;
    /** Gemini API key */
    geminiApiKey: string;
    /** Days before invoice date to accept payment */
    matchDaysBefore: number;
    /** Days after invoice date to accept payment */
    matchDaysAfter: number;
    /** Minimum log level */
    logLevel: LogLevel;
    /** Tolerance percentage for USD→ARS cross-currency matching */
    usdArsTolerancePercent: number;
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
 */
export interface ClassificationResult {
    /** Detected document type */
    documentType: 'factura' | 'pago' | 'recibo' | 'unrecognized';
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
export declare class GeminiError extends Error {
    code?: number | undefined;
    details?: unknown | undefined;
    constructor(message: string, code?: number | undefined, details?: unknown | undefined);
}
/**
 * Parse error types
 */
export declare class ParseError extends Error {
    rawData?: string | undefined;
    constructor(message: string, rawData?: string | undefined);
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
 */
export type SortDestination = 'cobros' | 'pagos' | 'sin_procesar';
/**
 * Cached folder structure for Drive operations
 * Represents the discovered folder hierarchy
 */
export interface FolderStructure {
    /** Root folder ID */
    rootId: string;
    /** Entrada (incoming) folder ID */
    entradaId: string;
    /** Cobros (collections) folder ID */
    cobrosId: string;
    /** Pagos (payments) folder ID */
    pagosId: string;
    /** Sin Procesar (unprocessed) folder ID */
    sinProcesarId: string;
    /** Bancos (banks) folder ID */
    bancosId: string;
    /** Control de Cobros spreadsheet ID */
    controlCobrosId: string;
    /** Control de Pagos spreadsheet ID */
    controlPagosId: string;
    /** Map of bank spreadsheet names to IDs */
    bankSpreadsheets: Map<string, string>;
    /** Cache of month folders by destination and month key (e.g., "cobros:2024-01") */
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
        expiresIn: number;
    }>;
    /** Last notification received timestamp */
    lastNotification: Date | null;
    /** Last scan triggered timestamp */
    lastScan: Date | null;
}
