/**
 * Scanner module - core document processing orchestration
 * Handles file discovery, classification, extraction, storage, and matching
 */

import type {
  Result,
  FileInfo,
  Factura,
  Pago,
  Recibo,
  ResumenBancario,
  ScanResult,
  DocumentType,
  ClassificationResult,
  MatchConfidence,
} from '../types/index.js';
import { GeminiClient } from '../gemini/client.js';
import {
  CLASSIFICATION_PROMPT,
  FACTURA_PROMPT,
  PAGO_BBVA_PROMPT,
  RECIBO_PROMPT,
} from '../gemini/prompts.js';
import {
  parseClassificationResponse,
  parseFacturaResponse,
  parsePagoResponse,
  parseReciboResponse,
} from '../gemini/parser.js';
import { listFilesInFolder, downloadFile } from '../services/drive.js';
import { getValues, appendRowsWithLinks, batchUpdate, sortSheet, type CellValueOrLink } from '../services/sheets.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { sortToSinProcesar, sortAndRenameDocument } from '../services/document-sorter.js';
import { getProcessingQueue } from './queue.js';
import { getConfig } from '../config.js';
import { FacturaPagoMatcher } from '../matching/matcher.js';
import { formatUSCurrency } from '../utils/numbers.js';
import {
  generateFacturaFileName,
  generatePagoFileName,
  generateReciboFileName,
} from '../utils/file-naming.js';
import { debug, error as logError } from '../utils/logger.js';

/**
 * Result of processing a single file
 */
export interface ProcessFileResult {
  documentType: DocumentType;
  document?: Factura | Pago | Recibo | ResumenBancario;
  classification?: ClassificationResult;
  error?: string;
}

/**
 * Scanner configuration options
 */
export interface ScannerConfig {
  concurrency?: number;
  matchDaysBefore?: number;
  matchDaysAfter?: number;
  usdArsTolerancePercent?: number;
}

/**
 * Rematch result
 */
export interface RematchResult {
  matchesFound: number;
  duration: number;
}

/**
 * Validates that a document has the required date field
 * Documents without valid dates MUST be moved to Sin Procesar
 *
 * @param doc - Document to validate
 * @param documentType - Type of document
 * @returns true if document has valid date, false otherwise
 */
function hasValidDate(doc: any, documentType: DocumentType): boolean {
  switch (documentType) {
    case 'factura_emitida':
    case 'factura_recibida':
      return !!doc.fechaEmision && doc.fechaEmision !== '';
    case 'pago_enviado':
    case 'pago_recibido':
      return !!doc.fechaPago && doc.fechaPago !== '';
    case 'recibo':
      return !!doc.fechaPago && doc.fechaPago !== '';
    case 'resumen_bancario':
      // Skip validation for resumen_bancario until extraction is implemented (TODO)
      return true;
    default:
      return false;
  }
}

/**
 * Processes a single file - classifies and extracts data
 *
 * @param fileInfo - File metadata (without content)
 * @returns Result with processed document or error
 */
export async function processFile(
  fileInfo: Omit<FileInfo, 'content'>
): Promise<Result<ProcessFileResult, Error>> {
  const config = getConfig();
  const gemini = new GeminiClient(config.geminiApiKey);

  // Download file content
  const downloadResult = await downloadFile(fileInfo.id);
  if (!downloadResult.ok) {
    return downloadResult;
  }

  const content = downloadResult.value;

  // Step 1: Classify the document
  const classifyResult = await gemini.analyzeDocument(
    content,
    fileInfo.mimeType,
    CLASSIFICATION_PROMPT
  );

  if (!classifyResult.ok) {
    return {
      ok: false,
      error: new Error(`Classification failed: ${classifyResult.error.message}`),
    };
  }

  const classificationParse = parseClassificationResponse(classifyResult.value);
  if (!classificationParse.ok) {
    return {
      ok: false,
      error: classificationParse.error,
    };
  }

  const classification = classificationParse.value;

  debug('Document classified', {
    module: 'scanner',
    phase: 'classification',
    fileId: fileInfo.id,
    fileName: fileInfo.name,
    documentType: classification.documentType,
    confidence: classification.confidence,
    reason: classification.reason
  });

  // Prepare timestamp for all documents
  const now = new Date().toISOString();

  // If unrecognized, return early
  if (classification.documentType === 'unrecognized') {
    return {
      ok: true,
      value: {
        documentType: 'unrecognized',
        classification,
      },
    };
  }

  // Step 2: Extract data based on document type
  let extractPrompt: string;
  switch (classification.documentType) {
    case 'factura_emitida':
    case 'factura_recibida':
      extractPrompt = FACTURA_PROMPT;
      break;
    case 'pago_enviado':
    case 'pago_recibido':
      extractPrompt = PAGO_BBVA_PROMPT;
      break;
    case 'recibo':
      extractPrompt = RECIBO_PROMPT;
      break;
    case 'resumen_bancario':
      // TODO: Add RESUMEN_BANCARIO_PROMPT extraction in a future phase
      // For now, create a minimal document to enable sorting and renaming
      const resumen: import('../types/index.js').ResumenBancario = {
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        banco: 'Desconocido', // Will be extracted in future
        numeroCuenta: '', // Will be extracted in future
        fechaDesde: '',
        fechaHasta: '',
        saldoInicial: 0,
        saldoFinal: 0,
        moneda: 'ARS',
        cantidadMovimientos: 0,
        processedAt: now,
        confidence: classification.confidence,
        needsReview: true, // Always needs review until extraction is implemented
      };
      return {
        ok: true,
        value: {
          documentType: 'resumen_bancario',
          document: resumen,
          classification,
        },
      };
    default:
      return {
        ok: true,
        value: {
          documentType: 'unknown',
          classification,
        },
      };
  }

  const extractResult = await gemini.analyzeDocument(
    content,
    fileInfo.mimeType,
    extractPrompt
  );

  if (!extractResult.ok) {
    return {
      ok: false,
      error: new Error(`Extraction failed: ${extractResult.error.message}`),
    };
  }

  // Step 3: Parse the extraction result

  if (classification.documentType === 'factura_emitida' || classification.documentType === 'factura_recibida') {
    const parseResult = parseFacturaResponse(extractResult.value, classification.documentType);

    if (!parseResult.ok) {
      logError('Failed to parse factura response', {
        module: 'scanner',
        phase: 'parsing',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        error: parseResult.error.message,
        rawResponse: parseResult.error.rawData?.substring(0, 1000)
      });
      return { ok: false, error: parseResult.error };
    }

    debug('Factura extracted', {
      module: 'scanner',
      phase: 'extraction',
      fileId: fileInfo.id,
      documentType: classification.documentType,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
      roleValidation: parseResult.value.roleValidation
    });

    // Check if role validation failed
    if (parseResult.value.roleValidation && !parseResult.value.roleValidation.isValid) {
      logError('Document failed ADVA role validation', {
        module: 'scanner',
        phase: 'validation',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        errors: parseResult.value.roleValidation.errors,
        willMoveTo: 'Sin Procesar'
      });

      return {
        ok: false,
        error: new Error(
          `Role validation failed: ${parseResult.value.roleValidation.errors.join(', ')}`
        )
      };
    }

    const factura: Factura = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      tipoComprobante: parseResult.value.data.tipoComprobante || 'A',
      nroFactura: parseResult.value.data.nroFactura || '',
      fechaEmision: parseResult.value.data.fechaEmision || '',
      cuitEmisor: parseResult.value.data.cuitEmisor || '',
      razonSocialEmisor: parseResult.value.data.razonSocialEmisor || '',
      cuitReceptor: parseResult.value.data.cuitReceptor,
      razonSocialReceptor: parseResult.value.data.razonSocialReceptor,
      importeNeto: parseResult.value.data.importeNeto || 0,
      importeIva: parseResult.value.data.importeIva || 0,
      importeTotal: parseResult.value.data.importeTotal || 0,
      moneda: parseResult.value.data.moneda || 'ARS',
      concepto: parseResult.value.data.concepto,
      processedAt: now,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
    };

    return {
      ok: true,
      value: {
        documentType: classification.documentType,
        document: factura,
        classification,
      },
    };
  }

  if (classification.documentType === 'pago_enviado' || classification.documentType === 'pago_recibido') {
    const parseResult = parsePagoResponse(extractResult.value, classification.documentType);

    if (!parseResult.ok) {
      logError('Failed to parse pago response', {
        module: 'scanner',
        phase: 'parsing',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        error: parseResult.error.message,
        rawResponse: parseResult.error.rawData?.substring(0, 1000)
      });
      return { ok: false, error: parseResult.error };
    }

    debug('Pago extracted', {
      module: 'scanner',
      phase: 'extraction',
      fileId: fileInfo.id,
      documentType: classification.documentType,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
      roleValidation: parseResult.value.roleValidation
    });

    // Check if role validation failed
    if (parseResult.value.roleValidation && !parseResult.value.roleValidation.isValid) {
      logError('Document failed ADVA role validation', {
        module: 'scanner',
        phase: 'validation',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        errors: parseResult.value.roleValidation.errors,
        willMoveTo: 'Sin Procesar'
      });

      return {
        ok: false,
        error: new Error(
          `Role validation failed: ${parseResult.value.roleValidation.errors.join(', ')}`
        )
      };
    }

    const pago: Pago = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      banco: parseResult.value.data.banco || '',
      fechaPago: parseResult.value.data.fechaPago || '',
      importePagado: parseResult.value.data.importePagado || 0,
      moneda: parseResult.value.data.moneda || 'ARS',
      referencia: parseResult.value.data.referencia,
      cuitPagador: parseResult.value.data.cuitPagador,
      nombrePagador: parseResult.value.data.nombrePagador,
      cuitBeneficiario: parseResult.value.data.cuitBeneficiario,
      nombreBeneficiario: parseResult.value.data.nombreBeneficiario,
      concepto: parseResult.value.data.concepto,
      processedAt: now,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
    };

    return {
      ok: true,
      value: {
        documentType: classification.documentType,
        document: pago,
        classification,
      },
    };
  }

  if (classification.documentType === 'recibo') {
    const parseResult = parseReciboResponse(extractResult.value);

    if (!parseResult.ok) {
      logError('Failed to parse recibo response', {
        module: 'scanner',
        phase: 'parsing',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        error: parseResult.error.message,
        rawResponse: parseResult.error.rawData?.substring(0, 1000)
      });
      return { ok: false, error: parseResult.error };
    }

    debug('Recibo extracted', {
      module: 'scanner',
      phase: 'extraction',
      fileId: fileInfo.id,
      documentType: classification.documentType,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
      roleValidation: parseResult.value.roleValidation
    });

    const recibo: Recibo = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      tipoRecibo: parseResult.value.data.tipoRecibo || 'sueldo',
      nombreEmpleado: parseResult.value.data.nombreEmpleado || '',
      cuilEmpleado: parseResult.value.data.cuilEmpleado || '',
      legajo: parseResult.value.data.legajo || '',
      tareaDesempenada: parseResult.value.data.tareaDesempenada,
      cuitEmpleador: parseResult.value.data.cuitEmpleador || '',
      periodoAbonado: parseResult.value.data.periodoAbonado || '',
      fechaPago: parseResult.value.data.fechaPago || '',
      subtotalRemuneraciones: parseResult.value.data.subtotalRemuneraciones || 0,
      subtotalDescuentos: parseResult.value.data.subtotalDescuentos || 0,
      totalNeto: parseResult.value.data.totalNeto || 0,
      processedAt: now,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
    };

    return {
      ok: true,
      value: {
        documentType: 'recibo',
        document: recibo,
        classification,
      },
    };
  }

  return {
    ok: true,
    value: {
      documentType: 'unknown',
      classification,
    },
  };
}

/**
 * Stores a factura in the appropriate Control spreadsheet
 *
 * @param factura - The factura to store
 * @param spreadsheetId - The spreadsheet ID (Control de Creditos or Control de Debitos)
 * @param sheetName - The sheet name ('Facturas Emitidas' or 'Facturas Recibidas')
 * @param documentType - Document type for conditional row building
 */
async function storeFactura(
  factura: Factura,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'factura_emitida' | 'factura_recibida'
): Promise<Result<void, Error>> {
  // Calculate the renamed filename that will be used when the file is moved
  const renamedFileName = generateFacturaFileName(factura, documentType);

  // Build row based on document type - only store counterparty info
  const row: CellValueOrLink[] = [
    factura.fechaEmision,                    // A - date first
    factura.fileId,                          // B
    {                                        // C - formatted link
      text: renamedFileName,
      url: `https://drive.google.com/file/d/${factura.fileId}/view`,
    },
    factura.tipoComprobante,                 // D
    factura.nroFactura,                      // E
    // F, G - counterparty only (emisor for recibidas, receptor for emitidas)
    documentType === 'factura_emitida' ? (factura.cuitReceptor || '') : (factura.cuitEmisor || ''),
    documentType === 'factura_emitida' ? (factura.razonSocialReceptor || '') : (factura.razonSocialEmisor || ''),
    formatUSCurrency(factura.importeNeto),   // H
    formatUSCurrency(factura.importeIva),    // I
    formatUSCurrency(factura.importeTotal),  // J
    factura.moneda,                          // K
    factura.concepto || '',                  // L
    factura.processedAt,                     // M
    factura.confidence,                      // N
    factura.needsReview ? 'YES' : 'NO',      // O
    factura.matchedPagoFileId || '',         // P
    factura.matchConfidence || '',           // Q
    factura.hasCuitMatch ? 'YES' : 'NO',     // R
  ];

  const result = await appendRowsWithLinks(spreadsheetId, `${sheetName}!A:R`, [row]);
  if (!result.ok) {
    return result;
  }

  // Sort sheet by fechaEmision (column A, index 0) in descending order (most recent first)
  const sortResult = await sortSheet(spreadsheetId, sheetName, 0, true);
  if (!sortResult.ok) {
    console.warn(`Failed to sort sheet ${sheetName}:`, sortResult.error.message);
    // Don't fail the operation if sorting fails
  }

  return { ok: true, value: undefined };
}

/**
 * Stores a pago in the appropriate Control spreadsheet
 *
 * @param pago - The pago to store
 * @param spreadsheetId - The spreadsheet ID (Control de Creditos or Control de Debitos)
 * @param sheetName - The sheet name ('Pagos Recibidos' or 'Pagos Enviados')
 * @param documentType - Document type for conditional row building
 */
async function storePago(
  pago: Pago,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'pago_enviado' | 'pago_recibido'
): Promise<Result<void, Error>> {
  // Calculate the renamed filename that will be used when the file is moved
  const renamedFileName = generatePagoFileName(pago, documentType);

  // Build row based on document type - only store counterparty info
  const row: CellValueOrLink[] = [
    pago.fechaPago,                          // A - date first
    pago.fileId,                             // B
    {                                        // C - formatted link
      text: renamedFileName,
      url: `https://drive.google.com/file/d/${pago.fileId}/view`,
    },
    pago.banco,                              // D
    formatUSCurrency(pago.importePagado),    // E
    pago.moneda || 'ARS',                    // F
    pago.referencia || '',                   // G
    // H, I - counterparty only (beneficiario for enviados, pagador for recibidos)
    documentType === 'pago_enviado' ? (pago.cuitBeneficiario || '') : (pago.cuitPagador || ''),
    documentType === 'pago_enviado' ? (pago.nombreBeneficiario || '') : (pago.nombrePagador || ''),
    pago.concepto || '',                     // J
    pago.processedAt,                        // K
    pago.confidence,                         // L
    pago.needsReview ? 'YES' : 'NO',         // M
    pago.matchedFacturaFileId || '',         // N
    pago.matchConfidence || '',              // O
  ];

  const result = await appendRowsWithLinks(spreadsheetId, `${sheetName}!A:O`, [row]);
  if (!result.ok) {
    return result;
  }

  // Sort sheet by fechaPago (column A, index 0) in descending order (most recent first)
  const sortResult = await sortSheet(spreadsheetId, sheetName, 0, true);
  if (!sortResult.ok) {
    console.warn(`Failed to sort sheet ${sheetName}:`, sortResult.error.message);
    // Don't fail the operation if sorting fails
  }

  return { ok: true, value: undefined };
}

/**
 * Stores a recibo in the Control de Debitos spreadsheet
 */
async function storeRecibo(recibo: Recibo, spreadsheetId: string): Promise<Result<void, Error>> {
  // Calculate the renamed filename that will be used when the file is moved
  const renamedFileName = generateReciboFileName(recibo);

  const row: CellValueOrLink[] = [
    recibo.fechaPago,                          // A - date first
    recibo.fileId,                             // B
    {                                          // C - formatted link
      text: renamedFileName,
      url: `https://drive.google.com/file/d/${recibo.fileId}/view`,
    },
    recibo.tipoRecibo,                         // D
    recibo.nombreEmpleado,                     // E
    recibo.cuilEmpleado,                       // F
    recibo.legajo,                             // G
    recibo.tareaDesempenada || '',             // H
    recibo.cuitEmpleador,                      // I
    recibo.periodoAbonado,                     // J
    recibo.subtotalRemuneraciones,             // K
    recibo.subtotalDescuentos,                 // L
    recibo.totalNeto,                          // M
    recibo.processedAt,                        // N
    recibo.confidence,                         // O
    recibo.needsReview ? 'YES' : 'NO',         // P
    recibo.matchedPagoFileId || '',            // Q
    recibo.matchConfidence || '',              // R
  ];

  const result = await appendRowsWithLinks(spreadsheetId, 'Recibos!A:R', [row]);
  if (!result.ok) {
    return result;
  }

  // Sort sheet by fechaPago (column A, index 0) in descending order (most recent first)
  const sortResult = await sortSheet(spreadsheetId, 'Recibos', 0, true);
  if (!sortResult.ok) {
    console.warn(`Failed to sort sheet Recibos:`, sortResult.error.message);
    // Don't fail the operation if sorting fails
  }

  return { ok: true, value: undefined };
}

/**
 * Gets list of already processed file IDs from both control spreadsheets
 *
 * @param controlCreditosId - Control de Creditos spreadsheet ID
 * @param controlDebitosId - Control de Debitos spreadsheet ID
 */
async function getProcessedFileIds(
  controlCreditosId: string,
  controlDebitosId: string
): Promise<Set<string>> {
  const processedIds = new Set<string>();

  /**
   * Helper to extract file IDs from a sheet's first column
   */
  const extractFileIds = async (spreadsheetId: string, sheetName: string) => {
    const result = await getValues(spreadsheetId, `${sheetName}!A:A`);
    if (result.ok && result.value.length > 1) {
      for (let i = 1; i < result.value.length; i++) {
        const row = result.value[i];
        if (row && row[0]) {
          processedIds.add(String(row[0]));
        }
      }
    }
  };

  // Get from Control de Creditos
  await extractFileIds(controlCreditosId, 'Facturas Emitidas');
  await extractFileIds(controlCreditosId, 'Pagos Recibidos');

  // Get from Control de Debitos
  await extractFileIds(controlDebitosId, 'Facturas Recibidas');
  await extractFileIds(controlDebitosId, 'Pagos Enviados');
  await extractFileIds(controlDebitosId, 'Recibos');

  return processedIds;
}

/**
 * Scans a folder for new documents and processes them
 *
 * @param folderId - Optional folder ID to scan (defaults to Entrada folder)
 * @returns Scan result with statistics
 */
export async function scanFolder(folderId?: string): Promise<Result<ScanResult, Error>> {
  const startTime = Date.now();
  console.log(`Starting folder scan${folderId ? ` for folder ${folderId}` : ''}...`);

  const folderStructure = getCachedFolderStructure();

  if (!folderStructure) {
    const error = 'Folder structure not initialized. Call discoverFolderStructure first.';
    console.error(error);
    return {
      ok: false,
      error: new Error(error),
    };
  }

  const targetFolderId = folderId || folderStructure.entradaId;
  const controlCreditosId = folderStructure.controlCreditosId;
  const controlDebitosId = folderStructure.controlDebitosId;

  console.log(`Scanning folder: ${targetFolderId}`);
  console.log(`Using Control de Creditos: ${controlCreditosId}`);
  console.log(`Using Control de Debitos: ${controlDebitosId}`);

  // List files in folder
  const listResult = await listFilesInFolder(targetFolderId);
  if (!listResult.ok) {
    console.error('Failed to list files in folder:', listResult.error.message);
    return listResult;
  }

  const allFiles = listResult.value;
  console.log(`Found ${allFiles.length} total files in folder`);

  // Get already processed file IDs from both spreadsheets
  const processedIds = await getProcessedFileIds(controlCreditosId, controlDebitosId);
  console.log(`${processedIds.size} files already processed`);

  // Filter to only new files
  const newFiles = allFiles.filter(f => !processedIds.has(f.id));
  console.log(`${newFiles.length} new files to process`);

  const result: ScanResult = {
    filesProcessed: 0,
    facturasAdded: 0,
    pagosAdded: 0,
    recibosAdded: 0,
    matchesFound: 0,
    errors: 0,
    duration: 0,
  };

  const queue = getProcessingQueue();

  // Process each new file
  const processedDocs: Array<{ type: DocumentType; doc: Factura | Pago | Recibo }> = [];

  for (const fileInfo of newFiles) {
    await queue.add(async () => {
      console.log(`Processing file: ${fileInfo.name} (${fileInfo.id})`);
      const processResult = await processFile(fileInfo);

      if (!processResult.ok) {
        console.error(`Failed to process file ${fileInfo.name}:`, processResult.error.message);
        result.errors++;
        // Move failed file to Sin Procesar
        const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
        if (!sortResult.success) {
          console.error(`Failed to move file ${fileInfo.name} to Sin Procesar:`, sortResult.error);
        } else {
          console.log(`Moved failed file ${fileInfo.name} to ${sortResult.targetPath}`);
        }
        return;
      }

      const processed = processResult.value;
      result.filesProcessed++;
      console.log(`File ${fileInfo.name} classified as: ${processed.documentType}`);

      if (processed.documentType === 'unrecognized' || processed.documentType === 'unknown') {
        console.log(`Moving unrecognized file ${fileInfo.name} to Sin Procesar`);
        // Move unrecognized to Sin Procesar
        const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
        if (!sortResult.success) {
          console.error(`Failed to move file ${fileInfo.name} to Sin Procesar:`, sortResult.error);
        } else {
          console.log(`Moved ${fileInfo.name} to ${sortResult.targetPath}`);
        }
        return;
      }

      const doc = processed.document;
      if (!doc) return;

      // CRITICAL: Validate that document has required date field
      // Documents without dates MUST NOT be written to spreadsheets
      if (!hasValidDate(doc, processed.documentType)) {
        console.warn(`No date extracted from ${fileInfo.name}, moving to Sin Procesar`);
        const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
        if (!sortResult.success) {
          console.error(`Failed to move file ${fileInfo.name} to Sin Procesar:`, sortResult.error);
          result.errors++;
        } else {
          console.log(`Moved file without date ${fileInfo.name} to ${sortResult.targetPath}`);
        }
        return; // STOP processing - do NOT write to spreadsheet or move to destination folder
      }

      // Store in appropriate sheet based on document type
      // Creditos (money IN): factura_emitida, pago_recibido -> Control de Creditos -> Creditos folder
      // Debitos (money OUT): factura_recibida, pago_enviado, recibo -> Control de Debitos -> Debitos folder

      if (processed.documentType === 'factura_emitida') {
        // Factura issued BY ADVA -> goes to Control de Creditos
        console.log(`Storing factura emitida from ${fileInfo.name} in Control de Creditos (${controlCreditosId})`);
        console.log(`  Factura data: CUIT=${(doc as Factura).cuitEmisor}, Total=${(doc as Factura).importeTotal}, Date=${(doc as Factura).fechaEmision}`);
        const storeResult = await storeFactura(doc as Factura, controlCreditosId, 'Facturas Emitidas', 'factura_emitida');
        if (storeResult.ok) {
          result.facturasAdded++;
          processedDocs.push({ type: 'factura_emitida', doc: doc as Factura });
          console.log(`✓ Factura emitida stored successfully in spreadsheet, moving to Creditos folder`);
          const sortResult = await sortAndRenameDocument(doc, 'creditos', 'factura_emitida');
          if (!sortResult.success) {
            console.error(`Failed to move factura ${fileInfo.name} to Creditos:`, sortResult.error);
            result.errors++;
          } else {
            console.log(`Moved factura ${fileInfo.name} to ${sortResult.targetPath}`);
          }
        } else {
          console.error(`Failed to store factura ${fileInfo.name}:`, storeResult.error.message);
          result.errors++;
        }
      } else if (processed.documentType === 'factura_recibida') {
        // Factura received BY ADVA -> goes to Control de Debitos
        console.log(`Storing factura recibida from ${fileInfo.name} in Control de Debitos (${controlDebitosId})`);
        console.log(`  Factura data: CUIT=${(doc as Factura).cuitEmisor}, Total=${(doc as Factura).importeTotal}, Date=${(doc as Factura).fechaEmision}`);
        const storeResult = await storeFactura(doc as Factura, controlDebitosId, 'Facturas Recibidas', 'factura_recibida');
        if (storeResult.ok) {
          result.facturasAdded++;
          processedDocs.push({ type: 'factura_recibida', doc: doc as Factura });
          console.log(`✓ Factura recibida stored successfully in spreadsheet, moving to Debitos folder`);
          const sortResult = await sortAndRenameDocument(doc, 'debitos', 'factura_recibida');
          if (!sortResult.success) {
            console.error(`Failed to move factura ${fileInfo.name} to Debitos:`, sortResult.error);
            result.errors++;
          } else {
            console.log(`Moved factura ${fileInfo.name} to ${sortResult.targetPath}`);
          }
        } else {
          console.error(`Failed to store factura ${fileInfo.name}:`, storeResult.error.message);
          result.errors++;
        }
      } else if (processed.documentType === 'pago_recibido') {
        // Payment received BY ADVA -> goes to Control de Creditos
        console.log(`Storing pago recibido from ${fileInfo.name} in Control de Creditos (${controlCreditosId})`);
        console.log(`  Pago data: Banco=${(doc as Pago).banco}, Amount=${(doc as Pago).importePagado}, Date=${(doc as Pago).fechaPago}`);
        const storeResult = await storePago(doc as Pago, controlCreditosId, 'Pagos Recibidos', 'pago_recibido');
        if (storeResult.ok) {
          result.pagosAdded++;
          processedDocs.push({ type: 'pago_recibido', doc: doc as Pago });
          console.log(`✓ Pago recibido stored successfully in spreadsheet, moving to Creditos folder`);
          const sortResult = await sortAndRenameDocument(doc, 'creditos', 'pago_recibido');
          if (!sortResult.success) {
            console.error(`Failed to move pago ${fileInfo.name} to Creditos:`, sortResult.error);
            result.errors++;
          } else {
            console.log(`Moved pago ${fileInfo.name} to ${sortResult.targetPath}`);
          }
        } else {
          console.error(`Failed to store pago ${fileInfo.name}:`, storeResult.error.message);
          result.errors++;
        }
      } else if (processed.documentType === 'pago_enviado') {
        // Payment sent BY ADVA -> goes to Control de Debitos
        console.log(`Storing pago enviado from ${fileInfo.name} in Control de Debitos (${controlDebitosId})`);
        console.log(`  Pago data: Banco=${(doc as Pago).banco}, Amount=${(doc as Pago).importePagado}, Date=${(doc as Pago).fechaPago}`);
        const storeResult = await storePago(doc as Pago, controlDebitosId, 'Pagos Enviados', 'pago_enviado');
        if (storeResult.ok) {
          result.pagosAdded++;
          processedDocs.push({ type: 'pago_enviado', doc: doc as Pago });
          console.log(`✓ Pago enviado stored successfully in spreadsheet, moving to Debitos folder`);
          const sortResult = await sortAndRenameDocument(doc, 'debitos', 'pago_enviado');
          if (!sortResult.success) {
            console.error(`Failed to move pago ${fileInfo.name} to Debitos:`, sortResult.error);
            result.errors++;
          } else {
            console.log(`Moved pago ${fileInfo.name} to ${sortResult.targetPath}`);
          }
        } else {
          console.error(`Failed to store pago ${fileInfo.name}:`, storeResult.error.message);
          result.errors++;
        }
      } else if (processed.documentType === 'recibo') {
        // Salary receipt -> goes to Control de Debitos
        console.log(`Storing recibo from ${fileInfo.name} in Control de Debitos (${controlDebitosId})`);
        console.log(`  Recibo data: Employee=${(doc as Recibo).nombreEmpleado}, Total=${(doc as Recibo).totalNeto}, Date=${(doc as Recibo).fechaPago}`);
        const storeResult = await storeRecibo(doc as Recibo, controlDebitosId);
        if (storeResult.ok) {
          result.recibosAdded++;
          processedDocs.push({ type: 'recibo', doc: doc as Recibo });
          console.log(`✓ Recibo stored successfully in spreadsheet, moving to Debitos folder`);
          const sortResult = await sortAndRenameDocument(doc, 'debitos', 'recibo');
          if (!sortResult.success) {
            console.error(`Failed to move recibo ${fileInfo.name} to Debitos:`, sortResult.error);
            result.errors++;
          } else {
            console.log(`Moved recibo ${fileInfo.name} to ${sortResult.targetPath}`);
          }
        } else {
          console.error(`Failed to store recibo ${fileInfo.name}:`, storeResult.error.message);
          result.errors++;
        }
      } else if (processed.documentType === 'resumen_bancario') {
        // Bank statement -> goes to Bancos folder (TODO: store in bank spreadsheet)
        console.log(`Moving resumen bancario ${fileInfo.name} to Bancos folder`);
        const sortResult = await sortAndRenameDocument(doc, 'bancos', 'resumen_bancario');
        if (!sortResult.success) {
          console.error(`Failed to move resumen ${fileInfo.name} to Bancos:`, sortResult.error);
          result.errors++;
        } else {
          console.log(`Moved resumen ${fileInfo.name} to ${sortResult.targetPath}`);
        }
      }
    });
  }

  // Wait for all processing to complete
  await queue.onIdle();

  // TODO: Run matching after processing (Phase 2 enhancement)

  result.duration = Date.now() - startTime;

  console.log(`Scan complete in ${result.duration}ms:`);
  console.log(`  - Files processed: ${result.filesProcessed}`);
  console.log(`  - Facturas added: ${result.facturasAdded}`);
  console.log(`  - Pagos added: ${result.pagosAdded}`);
  console.log(`  - Recibos added: ${result.recibosAdded}`);
  console.log(`  - Errors: ${result.errors}`);

  return { ok: true, value: result };
}

/**
 * Re-runs matching on unmatched documents
 *
 * @returns Rematch result with matches found
 */
export async function rematch(): Promise<Result<RematchResult, Error>> {
  const startTime = Date.now();
  const folderStructure = getCachedFolderStructure();

  if (!folderStructure) {
    return {
      ok: false,
      error: new Error('Folder structure not initialized'),
    };
  }

  // TODO: Update rematch to handle two-spreadsheet structure
  // For now, rematch only works with facturas recibidas and pagos enviados (debitos)
  // Full implementation would also match facturas emitidas with pagos recibidos (creditos)
  const controlDebitosId = folderStructure.controlDebitosId;
  const config = getConfig();

  // Get all facturas recibidas (invoices we need to pay)
  const facturasResult = await getValues(controlDebitosId, 'Facturas Recibidas!A:W');
  if (!facturasResult.ok) {
    return facturasResult;
  }

  // Get all pagos enviados (payments we made)
  const pagosResult = await getValues(controlDebitosId, 'Pagos Enviados!A:R');
  if (!pagosResult.ok) {
    return pagosResult;
  }

  // Parse data (skip header row)
  const facturas: Array<Factura & { row: number }> = [];
  const pagos: Array<Pago & { row: number }> = [];

  if (facturasResult.value.length > 1) {
    for (let i = 1; i < facturasResult.value.length; i++) {
      const row = facturasResult.value[i];
      if (!row || !row[0]) continue;

      // New layout: A=fechaEmision, B=fileId, C=fileName, D=tipoComprobante, E=nroFactura,
      // F=cuit(counterparty), G=razonSocial(counterparty), H=importeNeto, I=importeIva,
      // J=importeTotal, K=moneda, L=concepto, M=processedAt, N=confidence, O=needsReview,
      // P=matchedPagoFileId, Q=matchConfidence, R=hasCuitMatch
      const fechaEmision = String(row[0] || '');
      const fileId = String(row[1] || '');
      const fileName = String(row[2] || '');
      const tipoComprobante = (row[3] || 'A') as Factura['tipoComprobante'];
      const nroFactura = String(row[4] || '');
      const cuitCounterparty = String(row[5] || '');
      const razonSocialCounterparty = String(row[6] || '');

      // This is from "Facturas Recibidas" (debitos) so counterparty is emisor
      facturas.push({
        row: i + 1,
        fileId,
        fileName,
        tipoComprobante,
        nroFactura,
        fechaEmision,
        cuitEmisor: cuitCounterparty,
        razonSocialEmisor: razonSocialCounterparty,
        cuitReceptor: undefined, // ADVA is receptor (not stored in spreadsheet)
        razonSocialReceptor: undefined,
        importeNeto: Number(row[7]) || 0,
        importeIva: Number(row[8]) || 0,
        importeTotal: Number(row[9]) || 0,
        moneda: (row[10] || 'ARS') as Factura['moneda'],
        concepto: row[11] ? String(row[11]) : undefined,
        processedAt: String(row[12] || ''),
        confidence: Number(row[13]) || 0,
        needsReview: row[14] === 'YES',
        matchedPagoFileId: row[15] ? String(row[15]) : undefined,
        matchConfidence: row[16] ? (String(row[16]) as MatchConfidence) : undefined,
        hasCuitMatch: row[17] === 'YES',
      });
    }
  }

  if (pagosResult.value.length > 1) {
    for (let i = 1; i < pagosResult.value.length; i++) {
      const row = pagosResult.value[i];
      if (!row || !row[0]) continue;

      pagos.push({
        row: i + 1,
        fileId: String(row[0] || ''),
        fileName: String(row[1] || ''),
        banco: String(row[3] || ''),
        fechaPago: String(row[4] || ''),
        importePagado: Number(row[5]) || 0,
        moneda: (String(row[6]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[7] ? String(row[7]) : undefined,
        cuitPagador: row[8] ? String(row[8]) : undefined,
        nombrePagador: row[9] ? String(row[9]) : undefined,
        cuitBeneficiario: row[10] ? String(row[10]) : undefined,
        nombreBeneficiario: row[11] ? String(row[11]) : undefined,
        concepto: row[12] ? String(row[12]) : undefined,
        processedAt: String(row[13] || ''),
        confidence: Number(row[14]) || 0,
        needsReview: row[15] === 'YES',
        matchedFacturaFileId: row[16] ? String(row[16]) : undefined,
        matchConfidence: row[17] ? (String(row[17]) as MatchConfidence) : undefined,
      });
    }
  }

  // Find unmatched documents
  const unmatchedFacturas = facturas.filter(f => !f.matchedPagoFileId);
  const unmatchedPagos = pagos.filter(p => !p.matchedFacturaFileId);

  if (unmatchedPagos.length === 0) {
    return {
      ok: true,
      value: {
        matchesFound: 0,
        duration: Date.now() - startTime,
      },
    };
  }

  // Run matching
  const matcher = new FacturaPagoMatcher(
    config.matchDaysBefore,
    config.matchDaysAfter,
    config.usdArsTolerancePercent
  );

  let matchesFound = 0;
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];

  for (const pago of unmatchedPagos) {
    const matches = matcher.findMatches(pago, unmatchedFacturas);

    if (matches.length > 0) {
      const bestMatch = matches[0];

      // Only accept high-confidence unique matches
      if (bestMatch.confidence === 'HIGH' || matches.length === 1) {
        matchesFound++;

        // Update factura with match info
        updates.push({
          range: `'Facturas Recibidas'!U${bestMatch.facturaRow}:W${bestMatch.facturaRow}`,
          values: [[
            pago.fileId,
            bestMatch.confidence,
            bestMatch.hasCuitMatch ? 'YES' : 'NO',
          ]],
        });

        // Update pago with match info
        updates.push({
          range: `'Pagos Enviados'!P${pago.row}:Q${pago.row}`,
          values: [[
            bestMatch.facturaFileId,
            bestMatch.confidence,
          ]],
        });

        // Remove matched factura from candidates
        const index = unmatchedFacturas.findIndex(f => f.fileId === bestMatch.facturaFileId);
        if (index !== -1) {
          unmatchedFacturas.splice(index, 1);
        }
      }
    }
  }

  // Apply updates
  if (updates.length > 0) {
    const updateResult = await batchUpdate(controlDebitosId, updates);
    if (!updateResult.ok) {
      return updateResult;
    }
  }

  return {
    ok: true,
    value: {
      matchesFound,
      duration: Date.now() - startTime,
    },
  };
}

