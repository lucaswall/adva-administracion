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
import { getValues, appendRows, batchUpdate } from '../services/sheets.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { sortDocument, sortToSinProcesar } from '../services/document-sorter.js';
import { getProcessingQueue } from './queue.js';
import { getConfig } from '../config.js';
import { FacturaPagoMatcher } from '../matching/matcher.js';

/**
 * Result of processing a single file
 */
export interface ProcessFileResult {
  documentType: DocumentType;
  document?: Factura | Pago | Recibo;
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
    case 'factura':
      extractPrompt = FACTURA_PROMPT;
      break;
    case 'pago':
      extractPrompt = PAGO_BBVA_PROMPT;
      break;
    case 'recibo':
      extractPrompt = RECIBO_PROMPT;
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
  const now = new Date().toISOString();

  if (classification.documentType === 'factura') {
    const parseResult = parseFacturaResponse(extractResult.value);
    if (!parseResult.ok) {
      return { ok: false, error: parseResult.error };
    }

    const factura: Factura = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      folderPath: fileInfo.folderPath,
      tipoComprobante: parseResult.value.data.tipoComprobante || 'A',
      puntoVenta: parseResult.value.data.puntoVenta || '',
      numeroComprobante: parseResult.value.data.numeroComprobante || '',
      fechaEmision: parseResult.value.data.fechaEmision || '',
      fechaVtoCae: parseResult.value.data.fechaVtoCae || '',
      cuitEmisor: parseResult.value.data.cuitEmisor || '',
      razonSocialEmisor: parseResult.value.data.razonSocialEmisor || '',
      cuitReceptor: parseResult.value.data.cuitReceptor,
      cae: parseResult.value.data.cae || '',
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
        documentType: 'factura',
        document: factura,
        classification,
      },
    };
  }

  if (classification.documentType === 'pago') {
    const parseResult = parsePagoResponse(extractResult.value);
    if (!parseResult.ok) {
      return { ok: false, error: parseResult.error };
    }

    const pago: Pago = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      folderPath: fileInfo.folderPath,
      banco: parseResult.value.data.banco || '',
      fechaPago: parseResult.value.data.fechaPago || '',
      importePagado: parseResult.value.data.importePagado || 0,
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
        documentType: 'pago',
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
      folderPath: fileInfo.folderPath,
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
 * Stores a factura in the Control de Pagos sheet
 */
async function storeFactura(factura: Factura, spreadsheetId: string): Promise<Result<void, Error>> {
  const row = [
    factura.fileId,
    factura.fileName,
    factura.folderPath,
    factura.tipoComprobante,
    factura.puntoVenta,
    factura.numeroComprobante,
    factura.fechaEmision,
    factura.fechaVtoCae,
    factura.cuitEmisor,
    factura.razonSocialEmisor,
    factura.cuitReceptor || '',
    factura.cae,
    factura.importeNeto,
    factura.importeIva,
    factura.importeTotal,
    factura.moneda,
    factura.concepto || '',
    factura.processedAt,
    factura.confidence,
    factura.needsReview ? 'YES' : 'NO',
    factura.matchedPagoFileId || '',
    factura.matchConfidence || '',
    factura.hasCuitMatch ? 'YES' : 'NO',
  ];

  const result = await appendRows(spreadsheetId, 'Facturas!A:W', [row]);
  if (!result.ok) {
    return result;
  }

  return { ok: true, value: undefined };
}

/**
 * Stores a pago in the Control de Pagos sheet
 */
async function storePago(pago: Pago, spreadsheetId: string): Promise<Result<void, Error>> {
  const row = [
    pago.fileId,
    pago.fileName,
    pago.folderPath,
    pago.banco,
    pago.fechaPago,
    pago.importePagado,
    pago.referencia || '',
    pago.cuitPagador || '',
    pago.nombrePagador || '',
    pago.cuitBeneficiario || '',
    pago.nombreBeneficiario || '',
    pago.concepto || '',
    pago.processedAt,
    pago.confidence,
    pago.needsReview ? 'YES' : 'NO',
    pago.matchedFacturaFileId || '',
    pago.matchConfidence || '',
  ];

  const result = await appendRows(spreadsheetId, 'Pagos!A:Q', [row]);
  if (!result.ok) {
    return result;
  }

  return { ok: true, value: undefined };
}

/**
 * Stores a recibo in the Control de Pagos sheet
 */
async function storeRecibo(recibo: Recibo, spreadsheetId: string): Promise<Result<void, Error>> {
  const row = [
    recibo.fileId,
    recibo.fileName,
    recibo.folderPath,
    recibo.tipoRecibo,
    recibo.nombreEmpleado,
    recibo.cuilEmpleado,
    recibo.legajo,
    recibo.tareaDesempenada || '',
    recibo.cuitEmpleador,
    recibo.periodoAbonado,
    recibo.fechaPago,
    recibo.subtotalRemuneraciones,
    recibo.subtotalDescuentos,
    recibo.totalNeto,
    recibo.processedAt,
    recibo.confidence,
    recibo.needsReview ? 'YES' : 'NO',
    recibo.matchedPagoFileId || '',
    recibo.matchConfidence || '',
  ];

  const result = await appendRows(spreadsheetId, 'Recibos!A:S', [row]);
  if (!result.ok) {
    return result;
  }

  return { ok: true, value: undefined };
}

/**
 * Gets list of already processed file IDs
 */
async function getProcessedFileIds(spreadsheetId: string): Promise<Set<string>> {
  const processedIds = new Set<string>();

  // Get facturas
  const facturas = await getValues(spreadsheetId, 'Facturas!A:A');
  if (facturas.ok && facturas.value.length > 1) {
    for (let i = 1; i < facturas.value.length; i++) {
      const row = facturas.value[i];
      if (row && row[0]) {
        processedIds.add(String(row[0]));
      }
    }
  }

  // Get pagos
  const pagos = await getValues(spreadsheetId, 'Pagos!A:A');
  if (pagos.ok && pagos.value.length > 1) {
    for (let i = 1; i < pagos.value.length; i++) {
      const row = pagos.value[i];
      if (row && row[0]) {
        processedIds.add(String(row[0]));
      }
    }
  }

  // Get recibos
  const recibos = await getValues(spreadsheetId, 'Recibos!A:A');
  if (recibos.ok && recibos.value.length > 1) {
    for (let i = 1; i < recibos.value.length; i++) {
      const row = recibos.value[i];
      if (row && row[0]) {
        processedIds.add(String(row[0]));
      }
    }
  }

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
  const folderStructure = getCachedFolderStructure();

  if (!folderStructure) {
    return {
      ok: false,
      error: new Error('Folder structure not initialized. Call discoverFolderStructure first.'),
    };
  }

  const targetFolderId = folderId || folderStructure.entradaId;
  const spreadsheetId = folderStructure.controlPagosId;

  // List files in folder
  const listResult = await listFilesInFolder(targetFolderId, '');
  if (!listResult.ok) {
    return listResult;
  }

  const allFiles = listResult.value;

  // Get already processed file IDs
  const processedIds = await getProcessedFileIds(spreadsheetId);

  // Filter to only new files
  const newFiles = allFiles.filter(f => !processedIds.has(f.id));

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
      const processResult = await processFile(fileInfo);

      if (!processResult.ok) {
        result.errors++;
        // Move failed file to Sin Procesar
        await sortToSinProcesar(fileInfo.id, fileInfo.name);
        return;
      }

      const processed = processResult.value;
      result.filesProcessed++;

      if (processed.documentType === 'unrecognized' || processed.documentType === 'unknown') {
        // Move unrecognized to Sin Procesar
        await sortToSinProcesar(fileInfo.id, fileInfo.name);
        return;
      }

      const doc = processed.document;
      if (!doc) return;

      // Store in appropriate sheet
      if (processed.documentType === 'factura') {
        const storeResult = await storeFactura(doc as Factura, spreadsheetId);
        if (storeResult.ok) {
          result.facturasAdded++;
          processedDocs.push({ type: 'factura', doc });
          // Sort to Cobros folder
          await sortDocument(doc, 'cobros');
        } else {
          result.errors++;
        }
      } else if (processed.documentType === 'pago') {
        const storeResult = await storePago(doc as Pago, spreadsheetId);
        if (storeResult.ok) {
          result.pagosAdded++;
          processedDocs.push({ type: 'pago', doc });
          // Sort to Pagos folder
          await sortDocument(doc, 'pagos');
        } else {
          result.errors++;
        }
      } else if (processed.documentType === 'recibo') {
        const storeResult = await storeRecibo(doc as Recibo, spreadsheetId);
        if (storeResult.ok) {
          result.recibosAdded++;
          processedDocs.push({ type: 'recibo', doc });
          // Sort to Pagos folder (recibos are salary payments)
          await sortDocument(doc, 'pagos');
        } else {
          result.errors++;
        }
      }
    });
  }

  // Wait for all processing to complete
  await queue.onIdle();

  // TODO: Run matching after processing (Phase 2 enhancement)

  result.duration = Date.now() - startTime;
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

  const spreadsheetId = folderStructure.controlPagosId;
  const config = getConfig();

  // Get all facturas
  const facturasResult = await getValues(spreadsheetId, 'Facturas!A:W');
  if (!facturasResult.ok) {
    return facturasResult;
  }

  // Get all pagos
  const pagosResult = await getValues(spreadsheetId, 'Pagos!A:Q');
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

      facturas.push({
        row: i + 1, // Sheet rows are 1-indexed
        fileId: String(row[0] || ''),
        fileName: String(row[1] || ''),
        folderPath: String(row[2] || ''),
        tipoComprobante: (row[3] || 'A') as Factura['tipoComprobante'],
        puntoVenta: String(row[4] || ''),
        numeroComprobante: String(row[5] || ''),
        fechaEmision: String(row[6] || ''),
        fechaVtoCae: String(row[7] || ''),
        cuitEmisor: String(row[8] || ''),
        razonSocialEmisor: String(row[9] || ''),
        cuitReceptor: row[10] ? String(row[10]) : undefined,
        cae: String(row[11] || ''),
        importeNeto: Number(row[12]) || 0,
        importeIva: Number(row[13]) || 0,
        importeTotal: Number(row[14]) || 0,
        moneda: (row[15] || 'ARS') as Factura['moneda'],
        concepto: row[16] ? String(row[16]) : undefined,
        processedAt: String(row[17] || ''),
        confidence: Number(row[18]) || 0,
        needsReview: row[19] === 'YES',
        matchedPagoFileId: row[20] ? String(row[20]) : undefined,
        matchConfidence: row[21] ? (String(row[21]) as MatchConfidence) : undefined,
        hasCuitMatch: row[22] === 'YES',
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
        folderPath: String(row[2] || ''),
        banco: String(row[3] || ''),
        fechaPago: String(row[4] || ''),
        importePagado: Number(row[5]) || 0,
        referencia: row[6] ? String(row[6]) : undefined,
        cuitPagador: row[7] ? String(row[7]) : undefined,
        nombrePagador: row[8] ? String(row[8]) : undefined,
        cuitBeneficiario: row[9] ? String(row[9]) : undefined,
        nombreBeneficiario: row[10] ? String(row[10]) : undefined,
        concepto: row[11] ? String(row[11]) : undefined,
        processedAt: String(row[12] || ''),
        confidence: Number(row[13]) || 0,
        needsReview: row[14] === 'YES',
        matchedFacturaFileId: row[15] ? String(row[15]) : undefined,
        matchConfidence: row[16] ? (String(row[16]) as MatchConfidence) : undefined,
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
          range: `Facturas!U${bestMatch.facturaRow}:W${bestMatch.facturaRow}`,
          values: [[
            pago.fileId,
            bestMatch.confidence,
            bestMatch.hasCuitMatch ? 'YES' : 'NO',
          ]],
        });

        // Update pago with match info
        updates.push({
          range: `Pagos!P${pago.row}:Q${pago.row}`,
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
    const updateResult = await batchUpdate(spreadsheetId, updates);
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

/**
 * Scanner interface for custom configurations
 */
export interface Scanner {
  processFile: typeof processFile;
  scanFolder: typeof scanFolder;
  rematch: typeof rematch;
}

/**
 * Creates a scanner instance with custom configuration
 *
 * @param config - Scanner configuration options
 * @returns Scanner instance
 */
export function createScanner(_config?: ScannerConfig): Scanner {
  // Note: config is reserved for future use when we need custom matchers, etc.
  return {
    processFile,
    scanFolder,
    rematch,
  };
}
