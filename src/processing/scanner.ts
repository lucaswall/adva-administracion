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
  RESUMEN_BANCARIO_PROMPT,
} from '../gemini/prompts.js';
import {
  parseClassificationResponse,
  parseFacturaResponse,
  parsePagoResponse,
  parseReciboResponse,
  parseResumenBancarioResponse,
} from '../gemini/parser.js';
import { listFilesInFolder, downloadFile } from '../services/drive.js';
import { getValues, appendRowsWithLinks, batchUpdate, sortSheet, type CellValueOrLink } from '../services/sheets.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { sortToSinProcesar, sortAndRenameDocument } from '../services/document-sorter.js';
import { getProcessingQueue } from './queue.js';
import { getConfig, MAX_CASCADE_DEPTH, CASCADE_TIMEOUT_MS } from '../config.js';
import { FacturaPagoMatcher, ReciboPagoMatcher, type MatchQuality } from '../matching/matcher.js';
import {
  DisplacementQueue,
  type CascadeState,
  type CascadeClaims,
  isBetterMatch,
  detectCycle,
  buildFacturaMatchUpdate,
  buildReciboMatchUpdate,
} from '../matching/cascade-matcher.js';
import { formatUSCurrency, parseNumber } from '../utils/numbers.js';
import {
  generateFacturaFileName,
  generatePagoFileName,
  generateReciboFileName,
} from '../utils/file-naming.js';
import { debug, info, warn, error as logError } from '../utils/logger.js';

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
      // Validate that both date fields are present and non-empty
      // If dates cannot be parsed, file should go to Sin Procesar
      return !!doc.fechaDesde && doc.fechaDesde !== '' && !!doc.fechaHasta && doc.fechaHasta !== '';
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
      extractPrompt = RESUMEN_BANCARIO_PROMPT;
      break;
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
        rawResponse: parseResult.error.rawData?.substring(0, 1000) // Log first 1000 chars
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

    // Check if role validation failed (for pagos we log but don't necessarily fail)
    if (parseResult.value.roleValidation && !parseResult.value.roleValidation.isValid) {
      warn('Pago role validation has warnings', {
        module: 'scanner',
        phase: 'validation',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        errors: parseResult.value.roleValidation.errors
      });
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
      return { ok: false, error: parseResult.error };
    }

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

  if (classification.documentType === 'resumen_bancario') {
    const parseResult = parseResumenBancarioResponse(extractResult.value);
    if (!parseResult.ok) {
      return { ok: false, error: parseResult.error };
    }

    const resumen: ResumenBancario = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      banco: parseResult.value.data.banco || 'Desconocido',
      numeroCuenta: parseResult.value.data.numeroCuenta || '',
      fechaDesde: parseResult.value.data.fechaDesde || '',
      fechaHasta: parseResult.value.data.fechaHasta || '',
      saldoInicial: parseResult.value.data.saldoInicial || 0,
      saldoFinal: parseResult.value.data.saldoFinal || 0,
      moneda: parseResult.value.data.moneda || 'ARS',
      cantidadMovimientos: parseResult.value.data.cantidadMovimientos || 0,
      processedAt: now,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
    };

    return {
      ok: true,
      value: {
        documentType: 'resumen_bancario',
        document: resumen,
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
 * @param documentType - The document type for filename generation
 */
async function storeFactura(
  factura: Factura,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'factura_emitida' | 'factura_recibida'
): Promise<Result<void, Error>> {
  // Calculate the renamed filename that will be used when the file is moved
  const renamedFileName = generateFacturaFileName(factura, documentType);

  // Build row based on document type - only include counterparty info
  let row: CellValueOrLink[];
  let range: string;

  if (documentType === 'factura_emitida') {
    // Facturas Emitidas: Only receptor info (columns A:R)
    row = [
      factura.fechaEmision,                 // A
      factura.fileId,                       // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${factura.fileId}/view` }, // C
      factura.tipoComprobante,              // D
      factura.nroFactura,                   // E
      factura.cuitReceptor || '',           // F - counterparty
      factura.razonSocialReceptor || '',    // G - counterparty
      formatUSCurrency(factura.importeNeto), // H
      formatUSCurrency(factura.importeIva),  // I
      formatUSCurrency(factura.importeTotal),// J
      factura.moneda,                       // K
      factura.concepto || '',               // L
      factura.processedAt,                  // M
      factura.confidence,                   // N
      factura.needsReview ? 'YES' : 'NO',   // O
      factura.matchedPagoFileId || '',      // P
      factura.matchConfidence || '',        // Q
      factura.hasCuitMatch ? 'YES' : 'NO',  // R
    ];
    range = `${sheetName}!A:R`;
  } else {
    // Facturas Recibidas: Only emisor info (columns A:R)
    row = [
      factura.fechaEmision,                 // A
      factura.fileId,                       // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${factura.fileId}/view` }, // C
      factura.tipoComprobante,              // D
      factura.nroFactura,                   // E
      factura.cuitEmisor || '',             // F - counterparty
      factura.razonSocialEmisor || '',      // G - counterparty
      formatUSCurrency(factura.importeNeto), // H
      formatUSCurrency(factura.importeIva),  // I
      formatUSCurrency(factura.importeTotal),// J
      factura.moneda,                       // K
      factura.concepto || '',               // L
      factura.processedAt,                  // M
      factura.confidence,                   // N
      factura.needsReview ? 'YES' : 'NO',   // O
      factura.matchedPagoFileId || '',      // P
      factura.matchConfidence || '',        // Q
      factura.hasCuitMatch ? 'YES' : 'NO',  // R
    ];
    range = `${sheetName}!A:R`;
  }

  const result = await appendRowsWithLinks(spreadsheetId, range, [row]);
  if (!result.ok) {
    return result;
  }

  info('Factura stored successfully', {
    module: 'scanner',
    phase: 'storage',
    fileId: factura.fileId,
    documentType,
    spreadsheet: sheetName
  });

  // Sort sheet by fechaEmision (column A, index 0) in descending order (most recent first)
  const sortResult = await sortSheet(spreadsheetId, sheetName, 0, true);
  if (!sortResult.ok) {
    warn(`Failed to sort sheet ${sheetName}`, {
      module: 'scanner',
      phase: 'storage',
      error: sortResult.error.message
    });
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
 * @param documentType - The document type for filename generation
 */
async function storePago(
  pago: Pago,
  spreadsheetId: string,
  sheetName: string,
  documentType: 'pago_enviado' | 'pago_recibido'
): Promise<Result<void, Error>> {
  // Calculate the renamed filename that will be used when the file is moved
  const renamedFileName = generatePagoFileName(pago, documentType);

  // Build row based on document type - only include counterparty info
  let row: CellValueOrLink[];
  let range: string;

  if (documentType === 'pago_enviado') {
    // Pagos Enviados: Only beneficiario info (columns A:O)
    row = [
      pago.fechaPago,                      // A
      pago.fileId,                         // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${pago.fileId}/view` }, // C
      pago.banco,                          // D
      formatUSCurrency(pago.importePagado),// E
      pago.moneda || 'ARS',                // F
      pago.referencia || '',               // G
      pago.cuitBeneficiario || '',         // H - counterparty
      pago.nombreBeneficiario || '',       // I - counterparty
      pago.concepto || '',                 // J
      pago.processedAt,                    // K
      pago.confidence,                     // L
      pago.needsReview ? 'YES' : 'NO',     // M
      pago.matchedFacturaFileId || '',     // N
      pago.matchConfidence || '',          // O
    ];
    range = `${sheetName}!A:O`;
  } else {
    // Pagos Recibidos: Only pagador info (columns A:O)
    row = [
      pago.fechaPago,                      // A
      pago.fileId,                         // B
      { text: renamedFileName, url: `https://drive.google.com/file/d/${pago.fileId}/view` }, // C
      pago.banco,                          // D
      formatUSCurrency(pago.importePagado),// E
      pago.moneda || 'ARS',                // F
      pago.referencia || '',               // G
      pago.cuitPagador || '',              // H - counterparty
      pago.nombrePagador || '',            // I - counterparty
      pago.concepto || '',                 // J
      pago.processedAt,                    // K
      pago.confidence,                     // L
      pago.needsReview ? 'YES' : 'NO',     // M
      pago.matchedFacturaFileId || '',     // N
      pago.matchConfidence || '',          // O
    ];
    range = `${sheetName}!A:O`;
  }

  const result = await appendRowsWithLinks(spreadsheetId, range, [row]);
  if (!result.ok) {
    return result;
  }

  info('Pago stored successfully', {
    module: 'scanner',
    phase: 'storage',
    fileId: pago.fileId,
    documentType,
    spreadsheet: sheetName
  });

  // Sort sheet by fechaPago (column A, index 0) in descending order (most recent first)
  const sortResult = await sortSheet(spreadsheetId, sheetName, 0, true);
  if (!sortResult.ok) {
    warn(`Failed to sort sheet ${sheetName}`, {
      module: 'scanner',
      phase: 'storage',
      error: sortResult.error.message
    });
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
    recibo.fechaPago,
    recibo.fileId,
    {
      text: renamedFileName,
      url: `https://drive.google.com/file/d/${recibo.fileId}/view`,
    },
    recibo.tipoRecibo,
    recibo.nombreEmpleado,
    recibo.cuilEmpleado,
    recibo.legajo,
    recibo.tareaDesempenada || '',
    recibo.cuitEmpleador,
    recibo.periodoAbonado,
    formatUSCurrency(recibo.subtotalRemuneraciones),
    formatUSCurrency(recibo.subtotalDescuentos),
    formatUSCurrency(recibo.totalNeto),
    recibo.processedAt,
    recibo.confidence,
    recibo.needsReview ? 'YES' : 'NO',
    recibo.matchedPagoFileId || '',
    recibo.matchConfidence || '',
  ];

  const result = await appendRowsWithLinks(spreadsheetId, 'Recibos!A:R', [row]);
  if (!result.ok) {
    return result;
  }

  // Sort sheet by fechaPago (column A, index 0) in descending order (most recent first)
  const sortResult = await sortSheet(spreadsheetId, 'Recibos', 0, true);
  if (!sortResult.ok) {
    warn('Failed to sort sheet Recibos', {
      module: 'scanner',
      phase: 'storage',
      error: sortResult.error.message
    });
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
  info(`Starting folder scan${folderId ? ` for folder ${folderId}` : ''}`, {
    module: 'scanner',
    phase: 'scan-start'
  });

  const folderStructure = getCachedFolderStructure();
  const config = getConfig();

  if (!folderStructure) {
    const errorMsg = 'Folder structure not initialized. Call discoverFolderStructure first.';
    logError(errorMsg, {
      module: 'scanner',
      phase: 'scan-start'
    });
    return {
      ok: false,
      error: new Error(errorMsg),
    };
  }

  const targetFolderId = folderId || folderStructure.entradaId;
  const controlCreditosId = folderStructure.controlCreditosId;
  const controlDebitosId = folderStructure.controlDebitosId;

  info('Scan configuration', {
    module: 'scanner',
    phase: 'scan-start',
    targetFolderId,
    controlCreditosId,
    controlDebitosId
  });

  // List files in folder
  const listResult = await listFilesInFolder(targetFolderId);
  if (!listResult.ok) {
    logError('Failed to list files in folder', {
      module: 'scanner',
      phase: 'scan-start',
      error: listResult.error.message
    });
    return listResult;
  }

  const allFiles = listResult.value;
  info(`Found ${allFiles.length} total files in folder`, {
    module: 'scanner',
    phase: 'scan-start'
  });

  // Get already processed file IDs from both spreadsheets
  const processedIds = await getProcessedFileIds(controlCreditosId, controlDebitosId);
  info(`${processedIds.size} files already processed`, {
    module: 'scanner',
    phase: 'scan-start'
  });

  // Filter to only new files
  const newFiles = allFiles.filter(f => !processedIds.has(f.id));
  info(`${newFiles.length} new files to process`, {
    module: 'scanner',
    phase: 'scan-start'
  });

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
      info(`Processing file: ${fileInfo.name}`, {
        module: 'scanner',
        phase: 'process-file',
        fileId: fileInfo.id
      });
      const processResult = await processFile(fileInfo);

      if (!processResult.ok) {
        logError('Failed to process file', {
          module: 'scanner',
          phase: 'process-file',
          fileId: fileInfo.id,
          fileName: fileInfo.name,
          error: processResult.error.message
        });
        result.errors++;
        // Move failed file to Sin Procesar
        const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
        if (!sortResult.success) {
          logError('Failed to move file to Sin Procesar', {
            module: 'scanner',
            phase: 'process-file',
            fileName: fileInfo.name,
            error: sortResult.error
          });
        } else {
          info(`Moved failed file to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'process-file',
            fileName: fileInfo.name
          });
        }
        return;
      }

      const processed = processResult.value;
      result.filesProcessed++;
      info('File processed successfully', {
        module: 'scanner',
        phase: 'complete',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: processed.documentType
      });

      if (processed.documentType === 'unrecognized' || processed.documentType === 'unknown') {
        info('Moving unrecognized file to Sin Procesar', {
          module: 'scanner',
          phase: 'process-file',
          fileName: fileInfo.name
        });
        // Move unrecognized to Sin Procesar
        const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
        if (!sortResult.success) {
          logError('Failed to move file to Sin Procesar', {
            module: 'scanner',
            phase: 'process-file',
            fileName: fileInfo.name,
            error: sortResult.error
          });
        } else {
          info(`Moved to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'process-file',
            fileName: fileInfo.name
          });
        }
        return;
      }

      const doc = processed.document;
      if (!doc) return;

      // CRITICAL: Validate that document has required date field
      // Documents without dates MUST NOT be written to spreadsheets
      if (!hasValidDate(doc, processed.documentType)) {
        warn('No date extracted, moving to Sin Procesar', {
          module: 'scanner',
          phase: 'process-file',
          fileName: fileInfo.name
        });
        const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
        if (!sortResult.success) {
          logError('Failed to move file to Sin Procesar', {
            module: 'scanner',
            phase: 'process-file',
            fileName: fileInfo.name,
            error: sortResult.error
          });
          result.errors++;
        } else {
          info(`Moved file without date to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'process-file',
            fileName: fileInfo.name
          });
        }
        return; // STOP processing - do NOT write to spreadsheet or move to destination folder
      }

      // Store in appropriate sheet based on document type
      // Creditos (money IN): factura_emitida, pago_recibido -> Control de Creditos -> Creditos folder
      // Debitos (money OUT): factura_recibida, pago_enviado, recibo -> Control de Debitos -> Debitos folder

      if (processed.documentType === 'factura_emitida') {
        // Factura issued BY ADVA -> goes to Control de Creditos
        debug('Storing factura emitida', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          spreadsheetId: controlCreditosId,
          cuit: (doc as Factura).cuitReceptor,
          total: (doc as Factura).importeTotal,
          date: (doc as Factura).fechaEmision
        });
        const storeResult = await storeFactura(doc as Factura, controlCreditosId, 'Facturas Emitidas', 'factura_emitida');
        if (storeResult.ok) {
          result.facturasAdded++;
          processedDocs.push({ type: 'factura_emitida', doc: doc as Factura });
          info('Factura emitida stored, moving to Creditos folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name
          });
          const sortResult = await sortAndRenameDocument(doc, 'creditos', 'factura_emitida');
          if (!sortResult.success) {
            logError('Failed to move factura to Creditos', {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name,
              error: sortResult.error
            });
            result.errors++;
          } else {
            info(`Moved to ${sortResult.targetPath}`, {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name
            });
          }
        } else {
          logError('Failed to store factura', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: storeResult.error.message
          });
          result.errors++;
        }
      } else if (processed.documentType === 'factura_recibida') {
        // Factura received BY ADVA -> goes to Control de Debitos
        debug('Storing factura recibida', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          spreadsheetId: controlDebitosId,
          cuit: (doc as Factura).cuitEmisor,
          total: (doc as Factura).importeTotal,
          date: (doc as Factura).fechaEmision
        });
        const storeResult = await storeFactura(doc as Factura, controlDebitosId, 'Facturas Recibidas', 'factura_recibida');
        if (storeResult.ok) {
          result.facturasAdded++;
          processedDocs.push({ type: 'factura_recibida', doc: doc as Factura });
          info('Factura recibida stored, moving to Debitos folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name
          });
          const sortResult = await sortAndRenameDocument(doc, 'debitos', 'factura_recibida');
          if (!sortResult.success) {
            logError('Failed to move factura to Debitos', {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name,
              error: sortResult.error
            });
            result.errors++;
          } else {
            info(`Moved to ${sortResult.targetPath}`, {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name
            });
          }
        } else {
          logError('Failed to store factura', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: storeResult.error.message
          });
          result.errors++;
        }
      } else if (processed.documentType === 'pago_recibido') {
        // Payment received BY ADVA -> goes to Control de Creditos
        debug('Storing pago recibido', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          spreadsheetId: controlCreditosId,
          banco: (doc as Pago).banco,
          amount: (doc as Pago).importePagado,
          date: (doc as Pago).fechaPago
        });
        const storeResult = await storePago(doc as Pago, controlCreditosId, 'Pagos Recibidos', 'pago_recibido');
        if (storeResult.ok) {
          result.pagosAdded++;
          processedDocs.push({ type: 'pago_recibido', doc: doc as Pago });
          info('Pago recibido stored, moving to Creditos folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name
          });
          const sortResult = await sortAndRenameDocument(doc, 'creditos', 'pago_recibido');
          if (!sortResult.success) {
            logError('Failed to move pago to Creditos', {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name,
              error: sortResult.error
            });
            result.errors++;
          } else {
            info(`Moved to ${sortResult.targetPath}`, {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name
            });
          }
        } else {
          logError('Failed to store pago', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: storeResult.error.message
          });
          result.errors++;
        }
      } else if (processed.documentType === 'pago_enviado') {
        // Payment sent BY ADVA -> goes to Control de Debitos
        debug('Storing pago enviado', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          spreadsheetId: controlDebitosId,
          banco: (doc as Pago).banco,
          amount: (doc as Pago).importePagado,
          date: (doc as Pago).fechaPago
        });
        const storeResult = await storePago(doc as Pago, controlDebitosId, 'Pagos Enviados', 'pago_enviado');
        if (storeResult.ok) {
          result.pagosAdded++;
          processedDocs.push({ type: 'pago_enviado', doc: doc as Pago });
          info('Pago enviado stored, moving to Debitos folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name
          });
          const sortResult = await sortAndRenameDocument(doc, 'debitos', 'pago_enviado');
          if (!sortResult.success) {
            logError('Failed to move pago to Debitos', {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name,
              error: sortResult.error
            });
            result.errors++;
          } else {
            info(`Moved to ${sortResult.targetPath}`, {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name
            });
          }
        } else {
          logError('Failed to store pago', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: storeResult.error.message
          });
          result.errors++;
        }
      } else if (processed.documentType === 'recibo') {
        // Salary receipt -> goes to Control de Debitos
        debug('Storing recibo', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          spreadsheetId: controlDebitosId,
          employee: (doc as Recibo).nombreEmpleado,
          total: (doc as Recibo).totalNeto,
          date: (doc as Recibo).fechaPago
        });
        const storeResult = await storeRecibo(doc as Recibo, controlDebitosId);
        if (storeResult.ok) {
          result.recibosAdded++;
          processedDocs.push({ type: 'recibo', doc: doc as Recibo });
          info('Recibo stored, moving to Debitos folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name
          });
          const sortResult = await sortAndRenameDocument(doc, 'debitos', 'recibo');
          if (!sortResult.success) {
            logError('Failed to move recibo to Debitos', {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name,
              error: sortResult.error
            });
            result.errors++;
          } else {
            info(`Moved to ${sortResult.targetPath}`, {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name
            });
          }
        } else {
          logError('Failed to store recibo', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: storeResult.error.message
          });
          result.errors++;
        }
      } else if (processed.documentType === 'resumen_bancario') {
        // Bank statement -> goes to Bancos folder (TODO: store in bank spreadsheet)
        info('Moving resumen bancario to Bancos folder', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name
        });
        const sortResult = await sortAndRenameDocument(doc, 'bancos', 'resumen_bancario');
        if (!sortResult.success) {
          logError('Failed to move resumen to Bancos', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: sortResult.error
          });
          result.errors++;
        } else {
          info(`Moved to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name
          });
        }
      }
    });
  }

  // Wait for all processing to complete
  await queue.onIdle();

  // Run automatic matching after processing
  if (result.filesProcessed > 0) {
    debug('Running automatic matching', {
      module: 'scanner',
      phase: 'auto-match',
      filesProcessed: result.filesProcessed
    });

    const matchResult = await runMatching(folderStructure, config);

    if (matchResult.ok) {
      result.matchesFound = matchResult.value;
      info('Automatic matching complete', {
        module: 'scanner',
        phase: 'auto-match',
        matchesFound: result.matchesFound
      });
    } else {
      // Log warning but don't fail scanFolder - matching is a best-effort operation
      warn('Automatic matching failed', {
        module: 'scanner',
        phase: 'auto-match',
        error: matchResult.error.message
      });
      result.matchesFound = 0;
    }
  } else {
    // No files processed, set matchesFound to 0
    result.matchesFound = 0;
  }

  result.duration = Date.now() - startTime;

  info('Scan complete', {
    module: 'scanner',
    phase: 'scan-complete',
    duration: result.duration,
    filesProcessed: result.filesProcessed,
    facturasAdded: result.facturasAdded,
    pagosAdded: result.pagosAdded,
    recibosAdded: result.recibosAdded,
    errors: result.errors
  });

  return { ok: true, value: result };
}

/**
 * Processes cascading displacements for factura-pago matches
 * Handles the chain of re-matching when better matches displace existing ones
 *
 * @param queue - Queue of displaced pagos to re-match
 * @param cascadeState - State tracking for the cascade operation
 * @param facturas - All available facturas (including matched ones)
 * @param pagosMap - Map of pago fileId to pago object (for finding displaced pagos)
 * @param matcher - Matcher instance to use
 * @param claims - Tracks which documents have been claimed
 * @returns Result with void on success or error
 */
async function processCascadingFacturaDisplacements(
  queue: DisplacementQueue,
  cascadeState: CascadeState,
  facturas: Array<Factura & { row: number }>,
  pagosMap: Map<string, Pago & { row: number }>,
  matcher: FacturaPagoMatcher,
  claims: CascadeClaims
): Promise<Result<void, Error>> {
  const visited = new Set<string>();
  let iteration = 0;

  while (!queue.isEmpty() && iteration < MAX_CASCADE_DEPTH) {
    const displaced = queue.pop();
    if (!displaced) break;

    const displacedPago = displaced.document as Pago;

    // Check termination conditions
    if (displaced.depth >= MAX_CASCADE_DEPTH) {
      warn('Max cascade depth reached', {
        module: 'scanner',
        phase: 'cascade',
        depth: displaced.depth,
        pagoId: displacedPago.fileId
      });
      break;
    }

    if (Date.now() - cascadeState.startTime > CASCADE_TIMEOUT_MS) {
      warn('Cascade timeout exceeded', {
        module: 'scanner',
        phase: 'cascade',
        elapsed: Date.now() - cascadeState.startTime,
        pagoId: displacedPago.fileId
      });
      break;
    }

    if (detectCycle(visited, displacedPago.fileId)) {
      cascadeState.cycleDetected = true;
      warn('Cycle detected in displacement chain', {
        module: 'scanner',
        phase: 'cascade',
        pagoId: displacedPago.fileId,
        chain: Array.from(visited)
      });
      break;
    }

    visited.add(displacedPago.fileId);

    // Find best remaining match (exclude already claimed facturas)
    const availableFacturas = facturas.filter(f => !claims.claimedFacturas.has(f.fileId));
    const matches = matcher.findMatches(displacedPago, availableFacturas, true);

    if (matches.length > 0) {
      const bestMatch = matches[0];

      if (bestMatch.isUpgrade && bestMatch.existingPagoFileId) {
        // This match would displace another pago - check if it's strictly better
        const existingQuality: MatchQuality = {
          confidence: bestMatch.existingMatchConfidence || 'LOW',
          hasCuitMatch: bestMatch.factura.hasCuitMatch || false,
          dateProximityDays: 999 // We don't have the exact date proximity for existing match
        };
        const newQuality: MatchQuality = {
          confidence: bestMatch.confidence,
          hasCuitMatch: bestMatch.hasCuitMatch || false,
          dateProximityDays: bestMatch.dateProximityDays || 999
        };

        if (isBetterMatch(newQuality, existingQuality)) {
          // Cascade displacement - add the currently matched pago to queue
          const displacedPagoId = bestMatch.existingPagoFileId;
          const nextDisplacedPago = pagosMap.get(displacedPagoId);

          if (nextDisplacedPago) {
            debug('Cascading displacement', {
              module: 'scanner',
              phase: 'cascade',
              fromPago: displacedPagoId,
              toPago: displacedPago.fileId,
              factura: bestMatch.facturaFileId,
              depth: displaced.depth + 1
            });

            queue.add({
              documentType: 'pago',
              document: nextDisplacedPago,
              row: nextDisplacedPago.row,
              previousMatchFileId: bestMatch.facturaFileId,
              depth: displaced.depth + 1
            });
          }

          // Claim the factura and create update
          claims.claimedFacturas.add(bestMatch.facturaFileId);
          cascadeState.updates.set(
            bestMatch.facturaFileId,
            buildFacturaMatchUpdate(
              bestMatch.facturaFileId,
              bestMatch.facturaRow,
              displacedPago.fileId,
              bestMatch.confidence,
              bestMatch.hasCuitMatch || false
            )
          );
          cascadeState.displacedCount++;
        }
      } else {
        // Found an unmatched factura
        claims.claimedFacturas.add(bestMatch.facturaFileId);
        cascadeState.updates.set(
          bestMatch.facturaFileId,
          buildFacturaMatchUpdate(
            bestMatch.facturaFileId,
            bestMatch.facturaRow,
            displacedPago.fileId,
            bestMatch.confidence,
            bestMatch.hasCuitMatch || false
          )
        );

        debug('Displaced pago re-matched', {
          module: 'scanner',
          phase: 'cascade',
          pagoId: displacedPago.fileId,
          facturaId: bestMatch.facturaFileId,
          confidence: bestMatch.confidence
        });
      }
    } else {
      // No match found - pago becomes unmatched
      debug('Displaced pago has no remaining matches', {
        module: 'scanner',
        phase: 'cascade',
        pagoId: displacedPago.fileId
      });
    }

    iteration++;
    cascadeState.maxDepthReached = Math.max(cascadeState.maxDepthReached, iteration);
  }

  return { ok: true, value: undefined };
}

/**
 * Matches facturas with pagos in a single spreadsheet
 *
 * @param spreadsheetId - Spreadsheet ID (Control de Creditos or Control de Debitos)
 * @param facturasSheetName - Facturas sheet name ('Facturas Emitidas' or 'Facturas Recibidas')
 * @param pagosSheetName - Pagos sheet name ('Pagos Recibidos' or 'Pagos Enviados')
 * @param facturaCuitField - CUIT field name in factura to match (e.g., 'cuitReceptor' or 'cuitEmisor')
 * @param pagoCuitField - CUIT field name in pago to match (e.g., 'cuitPagador' or 'cuitBeneficiario')
 * @param config - Configuration with matching parameters
 * @returns Number of matches found
 */
async function matchFacturasWithPagos(
  spreadsheetId: string,
  facturasSheetName: 'Facturas Emitidas' | 'Facturas Recibidas',
  pagosSheetName: 'Pagos Recibidos' | 'Pagos Enviados',
  facturaCuitField: 'cuitReceptor' | 'cuitEmisor',
  pagoCuitField: 'cuitPagador' | 'cuitBeneficiario',
  config: ReturnType<typeof getConfig>
): Promise<Result<number, Error>> {
  debug('Starting factura-pago matching', {
    module: 'scanner',
    phase: 'matching',
    spreadsheetId,
    facturasSheet: facturasSheetName,
    pagosSheet: pagosSheetName
  });

  // Determine correct column ranges based on sheet type
  const facturasRange = `${facturasSheetName}!A:R`; // Both factura sheets use A:R
  const pagosRange = `${pagosSheetName}!A:O`; // Both pago sheets use A:O

  // Get all facturas
  const facturasResult = await getValues(spreadsheetId, facturasRange);
  if (!facturasResult.ok) {
    return facturasResult;
  }

  // Get all pagos
  const pagosResult = await getValues(spreadsheetId, pagosRange);
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

      // Build factura object based on sheet type
      const factura: Factura & { row: number } = {
        row: i + 1, // Sheet rows are 1-indexed
        fechaEmision: String(row[0] || ''),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        tipoComprobante: (row[3] || 'A') as Factura['tipoComprobante'],
        nroFactura: String(row[4] || ''),
        // Column 5 (F) and 6 (G) contain either emisor or receptor info depending on sheet
        cuitEmisor: facturaCuitField === 'cuitEmisor' ? String(row[5] || '') : '',
        razonSocialEmisor: facturaCuitField === 'cuitEmisor' ? String(row[6] || '') : '',
        cuitReceptor: facturaCuitField === 'cuitReceptor' ? String(row[5] || '') : undefined,
        razonSocialReceptor: facturaCuitField === 'cuitReceptor' ? String(row[6] || '') : undefined,
        importeNeto: parseNumber(row[7]) || 0,
        importeIva: parseNumber(row[8]) || 0,
        importeTotal: parseNumber(row[9]) || 0,
        moneda: (row[10] || 'ARS') as Factura['moneda'],
        concepto: row[11] ? String(row[11]) : undefined,
        processedAt: String(row[12] || ''),
        confidence: Number(row[13]) || 0,
        needsReview: row[14] === 'YES',
        matchedPagoFileId: row[15] ? String(row[15]) : undefined,
        matchConfidence: row[16] ? (String(row[16]) as MatchConfidence) : undefined,
        hasCuitMatch: row[17] === 'YES',
      };

      facturas.push(factura);
    }
  }

  if (pagosResult.value.length > 1) {
    for (let i = 1; i < pagosResult.value.length; i++) {
      const row = pagosResult.value[i];
      if (!row || !row[0]) continue;

      // Build pago object based on sheet type
      // Column 7 (H) and 8 (I) contain either pagador or beneficiario info depending on sheet
      const pago: Pago & { row: number } = {
        row: i + 1,
        fechaPago: String(row[0] || ''),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        banco: String(row[3] || ''),
        importePagado: parseNumber(row[4]) || 0,
        moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[6] ? String(row[6]) : undefined,
        cuitPagador: pagoCuitField === 'cuitPagador' ? String(row[7] || '') : undefined,
        nombrePagador: pagoCuitField === 'cuitPagador' ? String(row[8] || '') : undefined,
        cuitBeneficiario: pagoCuitField === 'cuitBeneficiario' ? String(row[7] || '') : undefined,
        nombreBeneficiario: pagoCuitField === 'cuitBeneficiario' ? String(row[8] || '') : undefined,
        concepto: row[9] ? String(row[9]) : undefined,
        processedAt: String(row[10] || ''),
        confidence: Number(row[11]) || 0,
        needsReview: row[12] === 'YES',
        matchedFacturaFileId: row[13] ? String(row[13]) : undefined,
        matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined,
      };

      pagos.push(pago);
    }
  }

  // Find unmatched documents
  const unmatchedPagos = pagos.filter(p => !p.matchedFacturaFileId);

  debug('Found unmatched documents', {
    module: 'scanner',
    phase: 'matching',
    totalFacturas: facturas.length,
    unmatchedPagos: unmatchedPagos.length
  });

  if (unmatchedPagos.length === 0) {
    return { ok: true, value: 0 };
  }

  // Run matching with cascading displacement
  const matcher = new FacturaPagoMatcher(
    config.matchDaysBefore,
    config.matchDaysAfter,
    config.usdArsTolerancePercent
  );

  // Initialize cascade infrastructure
  const displacementQueue = new DisplacementQueue();
  const cascadeState: CascadeState = {
    updates: new Map(),
    displacedCount: 0,
    maxDepthReached: 0,
    cycleDetected: false,
    startTime: Date.now()
  };
  const claims: CascadeClaims = {
    claimedFacturas: new Set(),
    claimedPagos: new Set(),
    claimedRecibos: new Set()
  };

  // Create pago map for quick lookup during cascading
  const pagosMap = new Map<string, Pago & { row: number }>();
  for (const pago of pagos) {
    pagosMap.set(pago.fileId, pago);
  }

  info('Starting cascading match displacement', {
    module: 'scanner',
    phase: 'cascade',
    unmatchedPagos: unmatchedPagos.length
  });

  // Process unmatched pagos - try to match against ALL facturas (including matched ones)
  for (const pago of unmatchedPagos) {
    const matches = matcher.findMatches(pago, facturas, true); // includeMatched=true

    if (matches.length > 0) {
      const bestMatch = matches[0];

      // Only accept high-confidence unique matches
      if (bestMatch.confidence === 'HIGH' || matches.length === 1) {
        // Check if this is an upgrade (factura already matched)
        if (bestMatch.isUpgrade && bestMatch.existingPagoFileId) {
          const existingQuality: MatchQuality = {
            confidence: bestMatch.existingMatchConfidence || 'LOW',
            hasCuitMatch: bestMatch.factura.hasCuitMatch || false,
            dateProximityDays: 999
          };
          const newQuality: MatchQuality = {
            confidence: bestMatch.confidence,
            hasCuitMatch: bestMatch.hasCuitMatch || false,
            dateProximityDays: bestMatch.dateProximityDays || 999
          };

          if (isBetterMatch(newQuality, existingQuality)) {
            // Displace! Queue the old pago for re-matching
            const displacedPago = pagosMap.get(bestMatch.existingPagoFileId);
            if (displacedPago) {
              debug('Match displaced', {
                module: 'scanner',
                phase: 'cascade',
                fromPago: bestMatch.existingPagoFileId,
                toPago: pago.fileId,
                factura: bestMatch.facturaFileId,
                reason: `${existingQuality.confidence} -> ${newQuality.confidence}`
              });

              displacementQueue.add({
                documentType: 'pago',
                document: displacedPago,
                row: displacedPago.row,
                previousMatchFileId: bestMatch.facturaFileId,
                depth: 1
              });

              claims.claimedFacturas.add(bestMatch.facturaFileId);
              cascadeState.updates.set(
                bestMatch.facturaFileId,
                buildFacturaMatchUpdate(
                  bestMatch.facturaFileId,
                  bestMatch.facturaRow,
                  pago.fileId,
                  bestMatch.confidence,
                  bestMatch.hasCuitMatch || false
                )
              );
              cascadeState.displacedCount++;
            }
          }
        } else {
          // New match, not displacing
          claims.claimedFacturas.add(bestMatch.facturaFileId);
          cascadeState.updates.set(
            bestMatch.facturaFileId,
            buildFacturaMatchUpdate(
              bestMatch.facturaFileId,
              bestMatch.facturaRow,
              pago.fileId,
              bestMatch.confidence,
              bestMatch.hasCuitMatch || false
            )
          );

          debug('Match found', {
            module: 'scanner',
            phase: 'matching',
            pagoId: pago.fileId,
            facturaId: bestMatch.facturaFileId,
            confidence: bestMatch.confidence,
            hasCuitMatch: bestMatch.hasCuitMatch
          });
        }
      }
    }
  }

  // Process cascading displacements
  const cascadeResult = await processCascadingFacturaDisplacements(
    displacementQueue,
    cascadeState,
    facturas,
    pagosMap,
    matcher,
    claims
  );

  if (!cascadeResult.ok) {
    return cascadeResult;
  }

  info('Cascade complete', {
    module: 'scanner',
    phase: 'cascade',
    displacedCount: cascadeState.displacedCount,
    maxDepth: cascadeState.maxDepthReached,
    cycleDetected: cascadeState.cycleDetected,
    duration: Date.now() - cascadeState.startTime
  });

  // Build sheet updates from cascade state
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];
  let matchesFound = 0;

  for (const [facturaFileId, update] of cascadeState.updates) {
    if (update.facturaFileId && update.facturaRow) {
      matchesFound++;

      // Update factura with match info (columns P:R)
      updates.push({
        range: `'${facturasSheetName}'!P${update.facturaRow}:R${update.facturaRow}`,
        values: [[
          update.pagoFileId,
          update.confidence,
          update.hasCuitMatch ? 'YES' : 'NO',
        ]],
      });

      // Update pago with match info (columns N:O)
      const pago = pagosMap.get(update.pagoFileId);
      if (pago) {
        updates.push({
          range: `'${pagosSheetName}'!N${pago.row}:O${pago.row}`,
          values: [[
            facturaFileId,
            update.confidence,
          ]],
        });
      }
    }
  }

  // Apply updates
  if (updates.length > 0) {
    info('Applying match updates', {
      module: 'scanner',
      phase: 'matching',
      updateCount: updates.length,
      matchesFound
    });

    const updateResult = await batchUpdate(spreadsheetId, updates);
    if (!updateResult.ok) {
      return updateResult;
    }
  }

  return { ok: true, value: matchesFound };
}

/**
 * Processes cascading displacements for recibo-pago matches
 * Handles the chain of re-matching when better matches displace existing ones
 *
 * @param queue - Queue of displaced pagos to re-match
 * @param cascadeState - State tracking for the cascade operation
 * @param recibos - All available recibos (including matched ones)
 * @param pagosMap - Map of pago fileId to pago object (for finding displaced pagos)
 * @param matcher - Matcher instance to use
 * @param claims - Tracks which documents have been claimed
 * @returns Result with void on success or error
 */
async function processCascadingReciboDisplacements(
  queue: DisplacementQueue,
  cascadeState: CascadeState,
  recibos: Array<Recibo & { row: number }>,
  pagosMap: Map<string, Pago & { row: number }>,
  matcher: ReciboPagoMatcher,
  claims: CascadeClaims
): Promise<Result<void, Error>> {
  const visited = new Set<string>();
  let iteration = 0;

  while (!queue.isEmpty() && iteration < MAX_CASCADE_DEPTH) {
    const displaced = queue.pop();
    if (!displaced) break;

    const displacedPago = displaced.document as Pago;

    // Check termination conditions
    if (displaced.depth >= MAX_CASCADE_DEPTH) {
      warn('Max cascade depth reached', {
        module: 'scanner',
        phase: 'cascade-recibo',
        depth: displaced.depth,
        pagoId: displacedPago.fileId
      });
      break;
    }

    if (Date.now() - cascadeState.startTime > CASCADE_TIMEOUT_MS) {
      warn('Cascade timeout exceeded', {
        module: 'scanner',
        phase: 'cascade-recibo',
        elapsed: Date.now() - cascadeState.startTime,
        pagoId: displacedPago.fileId
      });
      break;
    }

    if (detectCycle(visited, displacedPago.fileId)) {
      cascadeState.cycleDetected = true;
      warn('Cycle detected in displacement chain', {
        module: 'scanner',
        phase: 'cascade-recibo',
        pagoId: displacedPago.fileId,
        chain: Array.from(visited)
      });
      break;
    }

    visited.add(displacedPago.fileId);

    // Find best remaining match (exclude already claimed recibos)
    const availableRecibos = recibos.filter(r => !claims.claimedRecibos.has(r.fileId));
    const matches = matcher.findMatches(displacedPago, availableRecibos, true);

    if (matches.length > 0) {
      const bestMatch = matches[0];

      if (bestMatch.isUpgrade && bestMatch.existingPagoFileId) {
        // This match would displace another pago - check if it's strictly better
        const existingQuality: MatchQuality = {
          confidence: bestMatch.existingMatchConfidence || 'LOW',
          hasCuitMatch: bestMatch.recibo.matchConfidence === 'HIGH',
          dateProximityDays: 999
        };
        const newQuality: MatchQuality = {
          confidence: bestMatch.confidence,
          hasCuitMatch: bestMatch.hasCuilMatch || false,
          dateProximityDays: bestMatch.dateProximityDays || 999
        };

        if (isBetterMatch(newQuality, existingQuality)) {
          // Cascade displacement - add the currently matched pago to queue
          const displacedPagoId = bestMatch.existingPagoFileId;
          const nextDisplacedPago = pagosMap.get(displacedPagoId);

          if (nextDisplacedPago) {
            debug('Cascading displacement (recibo)', {
              module: 'scanner',
              phase: 'cascade-recibo',
              fromPago: displacedPagoId,
              toPago: displacedPago.fileId,
              recibo: bestMatch.reciboFileId,
              depth: displaced.depth + 1
            });

            queue.add({
              documentType: 'pago',
              document: nextDisplacedPago,
              row: nextDisplacedPago.row,
              previousMatchFileId: bestMatch.reciboFileId,
              depth: displaced.depth + 1
            });
          }

          // Claim the recibo and create update
          claims.claimedRecibos.add(bestMatch.reciboFileId);
          cascadeState.updates.set(
            bestMatch.reciboFileId,
            buildReciboMatchUpdate(
              bestMatch.reciboFileId,
              bestMatch.reciboRow,
              displacedPago.fileId,
              bestMatch.confidence,
              bestMatch.hasCuilMatch || false
            )
          );
          cascadeState.displacedCount++;
        }
      } else {
        // Found an unmatched recibo
        claims.claimedRecibos.add(bestMatch.reciboFileId);
        cascadeState.updates.set(
          bestMatch.reciboFileId,
          buildReciboMatchUpdate(
            bestMatch.reciboFileId,
            bestMatch.reciboRow,
            displacedPago.fileId,
            bestMatch.confidence,
            bestMatch.hasCuilMatch || false
          )
        );

        debug('Displaced pago re-matched (recibo)', {
          module: 'scanner',
          phase: 'cascade-recibo',
          pagoId: displacedPago.fileId,
          reciboId: bestMatch.reciboFileId,
          confidence: bestMatch.confidence
        });
      }
    } else {
      // No match found - pago becomes unmatched
      debug('Displaced pago has no remaining recibo matches', {
        module: 'scanner',
        phase: 'cascade-recibo',
        pagoId: displacedPago.fileId
      });
    }

    iteration++;
    cascadeState.maxDepthReached = Math.max(cascadeState.maxDepthReached, iteration);
  }

  return { ok: true, value: undefined };
}

/**
 * Matches recibos with pagos enviados in Control de Debitos
 *
 * @param spreadsheetId - Control de Debitos spreadsheet ID
 * @param config - Configuration with matching parameters
 * @returns Number of matches found
 */
async function matchRecibosWithPagos(
  spreadsheetId: string,
  config: ReturnType<typeof getConfig>
): Promise<Result<number, Error>> {
  debug('Starting recibo-pago matching', {
    module: 'scanner',
    phase: 'matching',
    spreadsheetId
  });

  // Get all recibos
  const recibosResult = await getValues(spreadsheetId, 'Recibos!A:R');
  if (!recibosResult.ok) {
    return recibosResult;
  }

  // Get all pagos enviados
  const pagosResult = await getValues(spreadsheetId, 'Pagos Enviados!A:O');
  if (!pagosResult.ok) {
    return pagosResult;
  }

  // Parse data (skip header row)
  const recibos: Array<Recibo & { row: number }> = [];
  const pagos: Array<Pago & { row: number }> = [];

  if (recibosResult.value.length > 1) {
    for (let i = 1; i < recibosResult.value.length; i++) {
      const row = recibosResult.value[i];
      if (!row || !row[0]) continue;

      recibos.push({
        row: i + 1,
        fechaPago: String(row[0] || ''),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        tipoRecibo: (row[3] || 'sueldo') as Recibo['tipoRecibo'],
        nombreEmpleado: String(row[4] || ''),
        cuilEmpleado: String(row[5] || ''),
        legajo: String(row[6] || ''),
        tareaDesempenada: row[7] ? String(row[7]) : undefined,
        cuitEmpleador: String(row[8] || ''),
        periodoAbonado: String(row[9] || ''),
        subtotalRemuneraciones: parseNumber(row[10]) || 0,
        subtotalDescuentos: parseNumber(row[11]) || 0,
        totalNeto: parseNumber(row[12]) || 0,
        processedAt: String(row[13] || ''),
        confidence: Number(row[14]) || 0,
        needsReview: row[15] === 'YES',
        matchedPagoFileId: row[16] ? String(row[16]) : undefined,
        matchConfidence: row[17] ? (String(row[17]) as MatchConfidence) : undefined,
      });
    }
  }

  if (pagosResult.value.length > 1) {
    for (let i = 1; i < pagosResult.value.length; i++) {
      const row = pagosResult.value[i];
      if (!row || !row[0]) continue;

      pagos.push({
        row: i + 1,
        fechaPago: String(row[0] || ''),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        banco: String(row[3] || ''),
        importePagado: parseNumber(row[4]) || 0,
        moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[6] ? String(row[6]) : undefined,
        cuitPagador: row[7] ? String(row[7]) : undefined,
        nombrePagador: row[8] ? String(row[8]) : undefined,
        cuitBeneficiario: String(row[7] || ''), // For Pagos Enviados, beneficiary is in columns H:I
        nombreBeneficiario: String(row[8] || ''),
        concepto: row[9] ? String(row[9]) : undefined,
        processedAt: String(row[10] || ''),
        confidence: Number(row[11]) || 0,
        needsReview: row[12] === 'YES',
        matchedFacturaFileId: row[13] ? String(row[13]) : undefined,
        matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined,
      });
    }
  }

  // Find unmatched documents
  const unmatchedPagos = pagos.filter(p => !p.matchedFacturaFileId); // Recibos can also match in this field

  debug('Found unmatched documents', {
    module: 'scanner',
    phase: 'matching',
    totalRecibos: recibos.length,
    unmatchedPagos: unmatchedPagos.length
  });

  if (unmatchedPagos.length === 0) {
    return { ok: true, value: 0 };
  }

  // Run matching with cascading displacement
  const matcher = new ReciboPagoMatcher(
    config.matchDaysBefore,
    config.matchDaysAfter
  );

  // Initialize cascade infrastructure
  const displacementQueue = new DisplacementQueue();
  const cascadeState: CascadeState = {
    updates: new Map(),
    displacedCount: 0,
    maxDepthReached: 0,
    cycleDetected: false,
    startTime: Date.now()
  };
  const claims: CascadeClaims = {
    claimedFacturas: new Set(),
    claimedPagos: new Set(),
    claimedRecibos: new Set()
  };

  // Create pago map for quick lookup during cascading
  const pagosMap = new Map<string, Pago & { row: number }>();
  for (const pago of pagos) {
    pagosMap.set(pago.fileId, pago);
  }

  info('Starting cascading match displacement (recibos)', {
    module: 'scanner',
    phase: 'cascade-recibo',
    unmatchedPagos: unmatchedPagos.length
  });

  // Process unmatched pagos - try to match against ALL recibos (including matched ones)
  for (const pago of unmatchedPagos) {
    const matches = matcher.findMatches(pago, recibos, true); // includeMatched=true

    if (matches.length > 0) {
      const bestMatch = matches[0];

      // Only accept high-confidence unique matches
      if (bestMatch.confidence === 'HIGH' || matches.length === 1) {
        // Check if this is an upgrade (recibo already matched)
        if (bestMatch.isUpgrade && bestMatch.existingPagoFileId) {
          const existingQuality: MatchQuality = {
            confidence: bestMatch.existingMatchConfidence || 'LOW',
            hasCuitMatch: bestMatch.recibo.matchConfidence === 'HIGH',
            dateProximityDays: 999
          };
          const newQuality: MatchQuality = {
            confidence: bestMatch.confidence,
            hasCuitMatch: bestMatch.hasCuilMatch || false,
            dateProximityDays: bestMatch.dateProximityDays || 999
          };

          if (isBetterMatch(newQuality, existingQuality)) {
            // Displace! Queue the old pago for re-matching
            const displacedPago = pagosMap.get(bestMatch.existingPagoFileId);
            if (displacedPago) {
              debug('Match displaced (recibo)', {
                module: 'scanner',
                phase: 'cascade-recibo',
                fromPago: bestMatch.existingPagoFileId,
                toPago: pago.fileId,
                recibo: bestMatch.reciboFileId,
                reason: `${existingQuality.confidence} -> ${newQuality.confidence}`
              });

              displacementQueue.add({
                documentType: 'pago',
                document: displacedPago,
                row: displacedPago.row,
                previousMatchFileId: bestMatch.reciboFileId,
                depth: 1
              });

              claims.claimedRecibos.add(bestMatch.reciboFileId);
              cascadeState.updates.set(
                bestMatch.reciboFileId,
                buildReciboMatchUpdate(
                  bestMatch.reciboFileId,
                  bestMatch.reciboRow,
                  pago.fileId,
                  bestMatch.confidence,
                  bestMatch.hasCuilMatch || false
                )
              );
              cascadeState.displacedCount++;
            }
          }
        } else {
          // New match, not displacing
          claims.claimedRecibos.add(bestMatch.reciboFileId);
          cascadeState.updates.set(
            bestMatch.reciboFileId,
            buildReciboMatchUpdate(
              bestMatch.reciboFileId,
              bestMatch.reciboRow,
              pago.fileId,
              bestMatch.confidence,
              bestMatch.hasCuilMatch || false
            )
          );

          debug('Match found (recibo)', {
            module: 'scanner',
            phase: 'matching',
            pagoId: pago.fileId,
            reciboId: bestMatch.reciboFileId,
            confidence: bestMatch.confidence,
            hasCuilMatch: bestMatch.hasCuilMatch
          });
        }
      }
    }
  }

  // Process cascading displacements
  const cascadeResult = await processCascadingReciboDisplacements(
    displacementQueue,
    cascadeState,
    recibos,
    pagosMap,
    matcher,
    claims
  );

  if (!cascadeResult.ok) {
    return cascadeResult;
  }

  info('Cascade complete (recibos)', {
    module: 'scanner',
    phase: 'cascade-recibo',
    displacedCount: cascadeState.displacedCount,
    maxDepth: cascadeState.maxDepthReached,
    cycleDetected: cascadeState.cycleDetected,
    duration: Date.now() - cascadeState.startTime
  });

  // Build sheet updates from cascade state
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];
  let matchesFound = 0;

  for (const [reciboFileId, update] of cascadeState.updates) {
    if (update.reciboFileId && update.reciboRow) {
      matchesFound++;

      // Update recibo with match info (columns Q:R)
      updates.push({
        range: `'Recibos'!Q${update.reciboRow}:R${update.reciboRow}`,
        values: [[
          update.pagoFileId,
          update.confidence,
        ]],
      });

      // Update pago with match info (columns N:O)
      const pago = pagosMap.get(update.pagoFileId);
      if (pago) {
        updates.push({
          range: `'Pagos Enviados'!N${pago.row}:O${pago.row}`,
          values: [[
            reciboFileId,
            update.confidence,
          ]],
        });
      }
    }
  }

  // Apply updates
  if (updates.length > 0) {
    info('Applying recibo match updates', {
      module: 'scanner',
      phase: 'matching',
      updateCount: updates.length,
      matchesFound
    });

    const updateResult = await batchUpdate(spreadsheetId, updates);
    if (!updateResult.ok) {
      return updateResult;
    }
  }

  return { ok: true, value: matchesFound };
}

/**
 * Runs matching on unmatched documents across all spreadsheets
 *
 * @param folderStructure - Cached folder structure with spreadsheet IDs
 * @param config - Config with matching parameters (date ranges, tolerances)
 * @returns Total number of matches found
 */
async function runMatching(
  folderStructure: ReturnType<typeof getCachedFolderStructure>,
  config: ReturnType<typeof getConfig>
): Promise<Result<number, Error>> {
  if (!folderStructure) {
    return { ok: false, error: new Error('Folder structure not initialized') };
  }

  info('Starting comprehensive matching', {
    module: 'scanner',
    phase: 'auto-match',
    controlCreditosId: folderStructure.controlCreditosId,
    controlDebitosId: folderStructure.controlDebitosId
  });

  let totalMatches = 0;

  // Match Debitos: Facturas Recibidas ↔ Pagos Enviados
  debug('Matching Facturas Recibidas with Pagos Enviados', {
    module: 'scanner',
    phase: 'auto-match'
  });

  const debitosFacturaMatches = await matchFacturasWithPagos(
    folderStructure.controlDebitosId,
    'Facturas Recibidas',
    'Pagos Enviados',
    'cuitEmisor',       // Factura field to match
    'cuitBeneficiario', // Pago field to match
    config
  );

  if (!debitosFacturaMatches.ok) {
    return debitosFacturaMatches;
  }

  totalMatches += debitosFacturaMatches.value;
  debug('Debitos factura matches complete', {
    module: 'scanner',
    phase: 'auto-match',
    matchesFound: debitosFacturaMatches.value
  });

  // Match Creditos: Facturas Emitidas ↔ Pagos Recibidos
  debug('Matching Facturas Emitidas with Pagos Recibidos', {
    module: 'scanner',
    phase: 'auto-match'
  });

  const creditosMatches = await matchFacturasWithPagos(
    folderStructure.controlCreditosId,
    'Facturas Emitidas',
    'Pagos Recibidos',
    'cuitReceptor',  // Factura field to match
    'cuitPagador',   // Pago field to match
    config
  );

  if (!creditosMatches.ok) {
    return creditosMatches;
  }

  totalMatches += creditosMatches.value;
  debug('Creditos matches complete', {
    module: 'scanner',
    phase: 'auto-match',
    matchesFound: creditosMatches.value
  });

  // Match Debitos: Recibos ↔ Pagos Enviados
  debug('Matching Recibos with Pagos Enviados', {
    module: 'scanner',
    phase: 'auto-match'
  });

  const recibosMatches = await matchRecibosWithPagos(
    folderStructure.controlDebitosId,
    config
  );

  if (!recibosMatches.ok) {
    return recibosMatches;
  }

  totalMatches += recibosMatches.value;
  debug('Recibo matches complete', {
    module: 'scanner',
    phase: 'auto-match',
    matchesFound: recibosMatches.value
  });

  info('Comprehensive matching complete', {
    module: 'scanner',
    phase: 'auto-match',
    totalMatches
  });

  return { ok: true, value: totalMatches };
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

  const config = getConfig();
  const matchResult = await runMatching(folderStructure, config);

  if (!matchResult.ok) {
    return matchResult;
  }

  return {
    ok: true,
    value: {
      matchesFound: matchResult.value,
      duration: Date.now() - startTime,
    },
  };
}

