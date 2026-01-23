/**
 * Scanner module - core document processing orchestration
 * This is a slim orchestration layer that coordinates:
 * - File discovery
 * - Document extraction (via extractor.ts)
 * - Storage (via storage/*.ts)
 * - Matching (via matching/*.ts)
 * - Document sorting
 */

import type {
  Result,
  Factura,
  Pago,
  Recibo,
  ResumenBancario,
  Retencion,
  ScanResult,
  DocumentType,
} from '../types/index.js';
import { listFilesInFolder } from '../services/drive.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { sortToSinProcesar, sortAndRenameDocument } from '../services/document-sorter.js';
import { getProcessingQueue } from './queue.js';
import { getConfig } from '../config.js';
import { debug, info, warn, error as logError } from '../utils/logger.js';
import { withCorrelationAsync, getCorrelationId, generateCorrelationId } from '../utils/correlation.js';

// Import from refactored modules
import { processFile, hasValidDate } from './extractor.js';
import { storeFactura, storePago, storeRecibo, storeRetencion, getProcessedFileIds } from './storage/index.js';
import { runMatching } from './matching/index.js';

// Re-export for backwards compatibility
export { processFile, hasValidDate, type ProcessFileResult } from './extractor.js';

/**
 * Rematch result
 */
export interface RematchResult {
  matchesFound: number;
  duration: number;
}

/**
 * Scans a folder for new documents and processes them
 *
 * @param folderId - Optional folder ID to scan (defaults to Entrada folder)
 * @returns Scan result with statistics
 */
export async function scanFolder(folderId?: string): Promise<Result<ScanResult, Error>> {
  // Wrap the entire scan in a correlation context
  return withCorrelationAsync(async () => {
    const correlationId = getCorrelationId();
    const startTime = Date.now();

    info(`Starting folder scan${folderId ? ` for folder ${folderId}` : ''}`, {
      module: 'scanner',
      phase: 'scan-start',
      correlationId,
    });

    const folderStructure = getCachedFolderStructure();
    const config = getConfig();

    if (!folderStructure) {
      const errorMsg = 'Folder structure not initialized. Call discoverFolderStructure first.';
      logError(errorMsg, {
        module: 'scanner',
        phase: 'scan-start',
        correlationId,
      });
      return {
        ok: false,
        error: new Error(errorMsg),
      };
    }

    const targetFolderId = folderId || folderStructure.entradaId;
    const controlIngresosId = folderStructure.controlIngresosId;
    const controlEgresosId = folderStructure.controlEgresosId;

    info('Scan configuration', {
      module: 'scanner',
      phase: 'scan-start',
      targetFolderId,
      controlIngresosId,
      controlEgresosId,
      correlationId,
    });

    // List files in folder
    const listResult = await listFilesInFolder(targetFolderId);
    if (!listResult.ok) {
      logError('Failed to list files in folder', {
        module: 'scanner',
        phase: 'scan-start',
        error: listResult.error.message,
        correlationId,
      });
      return listResult;
    }

    const allFiles = listResult.value;
    info(`Found ${allFiles.length} total files in folder`, {
      module: 'scanner',
      phase: 'scan-start',
      correlationId,
    });

    // Get already processed file IDs from both spreadsheets
    const processedIds = await getProcessedFileIds(controlIngresosId, controlEgresosId);
    info(`${processedIds.size} files already processed`, {
      module: 'scanner',
      phase: 'scan-start',
      correlationId,
    });

    // Filter to only new files
    const newFiles = allFiles.filter(f => !processedIds.has(f.id));
    info(`${newFiles.length} new files to process`, {
      module: 'scanner',
      phase: 'scan-start',
      correlationId,
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

    // Queue all files for processing (don't await individual tasks)
    // This allows the queue to process files concurrently up to the concurrency limit
    const processingPromises: Promise<void>[] = [];

    for (const fileInfo of newFiles) {
      const promise = queue.add(async () => {
        // Each file gets its own correlation context that inherits from parent
        await withCorrelationAsync(async () => {
          const fileCorrelationId = getCorrelationId();

          info(`Processing file: ${fileInfo.name}`, {
            module: 'scanner',
            phase: 'process-file',
            fileId: fileInfo.id,
            correlationId: fileCorrelationId,
          });

          const processResult = await processFile(fileInfo);

          if (!processResult.ok) {
            logError('Failed to process file', {
              module: 'scanner',
              phase: 'process-file',
              fileId: fileInfo.id,
              fileName: fileInfo.name,
              error: processResult.error.message,
              correlationId: fileCorrelationId,
            });
            result.errors++;
            // Move failed file to Sin Procesar
            const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
            if (!sortResult.success) {
              logError('Failed to move file to Sin Procesar', {
                module: 'scanner',
                phase: 'process-file',
                fileName: fileInfo.name,
                error: sortResult.error,
                correlationId: fileCorrelationId,
              });
            } else {
              info(`Moved failed file to ${sortResult.targetPath}`, {
                module: 'scanner',
                phase: 'process-file',
                fileName: fileInfo.name,
                correlationId: fileCorrelationId,
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
            documentType: processed.documentType,
            correlationId: fileCorrelationId,
          });

          // Handle unrecognized/unknown documents
          if (processed.documentType === 'unrecognized' || processed.documentType === 'unknown') {
            info('Moving unrecognized file to Sin Procesar', {
              module: 'scanner',
              phase: 'process-file',
              fileName: fileInfo.name,
              correlationId: fileCorrelationId,
            });
            const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
            if (!sortResult.success) {
              logError('Failed to move file to Sin Procesar', {
                module: 'scanner',
                phase: 'process-file',
                fileName: fileInfo.name,
                error: sortResult.error,
                correlationId: fileCorrelationId,
              });
            } else {
              info(`Moved to ${sortResult.targetPath}`, {
                module: 'scanner',
                phase: 'process-file',
                fileName: fileInfo.name,
                correlationId: fileCorrelationId,
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
              fileName: fileInfo.name,
              correlationId: fileCorrelationId,
            });
            const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
            if (!sortResult.success) {
              logError('Failed to move file to Sin Procesar', {
                module: 'scanner',
                phase: 'process-file',
                fileName: fileInfo.name,
                error: sortResult.error,
                correlationId: fileCorrelationId,
              });
              result.errors++;
            } else {
              info(`Moved file without date to ${sortResult.targetPath}`, {
                module: 'scanner',
                phase: 'process-file',
                fileName: fileInfo.name,
                correlationId: fileCorrelationId,
              });
            }
            return; // STOP processing - do NOT write to spreadsheet or move to destination folder
          }

          // Store and sort based on document type
          await storeAndSortDocument(
            doc,
            processed.documentType,
            fileInfo,
            controlIngresosId,
            controlEgresosId,
            result,
            fileCorrelationId
          );
        }, { correlationId: generateCorrelationId(), fileId: fileInfo.id, fileName: fileInfo.name });
      });

      processingPromises.push(promise);
    }

    // Wait for all processing to complete
    await Promise.allSettled(processingPromises);

    // Run automatic matching after processing
    if (result.filesProcessed > 0) {
      debug('Running automatic matching', {
        module: 'scanner',
        phase: 'auto-match',
        filesProcessed: result.filesProcessed,
        correlationId,
      });

      const matchResult = await runMatching(folderStructure, config);

      if (matchResult.ok) {
        result.matchesFound = matchResult.value;
        info('Automatic matching complete', {
          module: 'scanner',
          phase: 'auto-match',
          matchesFound: result.matchesFound,
          correlationId,
        });
      } else {
        // Log warning but don't fail scanFolder - matching is a best-effort operation
        warn('Automatic matching failed', {
          module: 'scanner',
          phase: 'auto-match',
          error: matchResult.error.message,
          correlationId,
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
      errors: result.errors,
      correlationId,
    });

    return { ok: true, value: result };
  }, { correlationId: generateCorrelationId() });
}

/**
 * Helper to store and sort a document based on its type
 */
async function storeAndSortDocument(
  doc: Factura | Pago | Recibo | ResumenBancario | Retencion,
  documentType: DocumentType,
  fileInfo: { id: string; name: string },
  controlIngresosId: string,
  controlEgresosId: string,
  result: ScanResult,
  correlationId: string | undefined
): Promise<void> {
  // Store in appropriate sheet based on document type
  // Ingresos (money IN): factura_emitida, pago_recibido -> Control de Ingresos -> Ingresos folder
  // Egresos (money OUT): factura_recibida, pago_enviado, recibo -> Control de Egresos -> Egresos folder

  if (documentType === 'factura_emitida') {
    // Factura issued BY ADVA -> goes to Control de Ingresos
    debug('Storing factura emitida', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      spreadsheetId: controlIngresosId,
      cuit: (doc as Factura).cuitReceptor,
      total: (doc as Factura).importeTotal,
      date: (doc as Factura).fechaEmision,
      correlationId,
    });
    const storeResult = await storeFactura(doc as Factura, controlIngresosId, 'Facturas Emitidas', 'factura_emitida');
    if (storeResult.ok) {
      result.facturasAdded++;
      info('Factura emitida stored, moving to Ingresos folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        correlationId,
      });
      const sortResult = await sortAndRenameDocument(doc, 'ingresos', 'factura_emitida');
      if (!sortResult.success) {
        logError('Failed to move factura to Ingresos', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: sortResult.error,
          correlationId,
        });
        result.errors++;
      } else {
        info(`Moved to ${sortResult.targetPath}`, {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          correlationId,
        });
      }
    } else {
      logError('Failed to store factura', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: storeResult.error.message,
        correlationId,
      });
      result.errors++;
    }
  } else if (documentType === 'factura_recibida') {
    // Factura received BY ADVA -> goes to Control de Egresos
    debug('Storing factura recibida', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      spreadsheetId: controlEgresosId,
      cuit: (doc as Factura).cuitEmisor,
      total: (doc as Factura).importeTotal,
      date: (doc as Factura).fechaEmision,
      correlationId,
    });
    const storeResult = await storeFactura(doc as Factura, controlEgresosId, 'Facturas Recibidas', 'factura_recibida');
    if (storeResult.ok) {
      result.facturasAdded++;
      info('Factura recibida stored, moving to Egresos folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        correlationId,
      });
      const sortResult = await sortAndRenameDocument(doc, 'egresos', 'factura_recibida');
      if (!sortResult.success) {
        logError('Failed to move factura to Egresos', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: sortResult.error,
          correlationId,
        });
        result.errors++;
      } else {
        info(`Moved to ${sortResult.targetPath}`, {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          correlationId,
        });
      }
    } else {
      logError('Failed to store factura', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: storeResult.error.message,
        correlationId,
      });
      result.errors++;
    }
  } else if (documentType === 'pago_recibido') {
    // Payment received BY ADVA -> goes to Control de Ingresos
    debug('Storing pago recibido', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      spreadsheetId: controlIngresosId,
      banco: (doc as Pago).banco,
      amount: (doc as Pago).importePagado,
      date: (doc as Pago).fechaPago,
      correlationId,
    });
    const storeResult = await storePago(doc as Pago, controlIngresosId, 'Pagos Recibidos', 'pago_recibido');
    if (storeResult.ok) {
      result.pagosAdded++;
      info('Pago recibido stored, moving to Ingresos folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        correlationId,
      });
      const sortResult = await sortAndRenameDocument(doc, 'ingresos', 'pago_recibido');
      if (!sortResult.success) {
        logError('Failed to move pago to Ingresos', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: sortResult.error,
          correlationId,
        });
        result.errors++;
      } else {
        info(`Moved to ${sortResult.targetPath}`, {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          correlationId,
        });
      }
    } else {
      logError('Failed to store pago', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: storeResult.error.message,
        correlationId,
      });
      result.errors++;
    }
  } else if (documentType === 'pago_enviado') {
    // Payment sent BY ADVA -> goes to Control de Egresos
    debug('Storing pago enviado', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      spreadsheetId: controlEgresosId,
      banco: (doc as Pago).banco,
      amount: (doc as Pago).importePagado,
      date: (doc as Pago).fechaPago,
      correlationId,
    });
    const storeResult = await storePago(doc as Pago, controlEgresosId, 'Pagos Enviados', 'pago_enviado');
    if (storeResult.ok) {
      result.pagosAdded++;
      info('Pago enviado stored, moving to Egresos folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        correlationId,
      });
      const sortResult = await sortAndRenameDocument(doc, 'egresos', 'pago_enviado');
      if (!sortResult.success) {
        logError('Failed to move pago to Egresos', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: sortResult.error,
          correlationId,
        });
        result.errors++;
      } else {
        info(`Moved to ${sortResult.targetPath}`, {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          correlationId,
        });
      }
    } else {
      logError('Failed to store pago', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: storeResult.error.message,
        correlationId,
      });
      result.errors++;
    }
  } else if (documentType === 'recibo') {
    // Salary receipt -> goes to Control de Egresos
    debug('Storing recibo', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      spreadsheetId: controlEgresosId,
      employee: (doc as Recibo).nombreEmpleado,
      total: (doc as Recibo).totalNeto,
      date: (doc as Recibo).fechaPago,
      correlationId,
    });
    const storeResult = await storeRecibo(doc as Recibo, controlEgresosId);
    if (storeResult.ok) {
      result.recibosAdded++;
      info('Recibo stored, moving to Egresos folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        correlationId,
      });
      const sortResult = await sortAndRenameDocument(doc, 'egresos', 'recibo');
      if (!sortResult.success) {
        logError('Failed to move recibo to Egresos', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: sortResult.error,
          correlationId,
        });
        result.errors++;
      } else {
        info(`Moved to ${sortResult.targetPath}`, {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          correlationId,
        });
      }
    } else {
      logError('Failed to store recibo', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: storeResult.error.message,
        correlationId,
      });
      result.errors++;
    }
  } else if (documentType === 'resumen_bancario') {
    // Bank statement -> goes to Bancos folder (TODO: store in bank spreadsheet)
    info('Moving resumen bancario to Bancos folder', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      correlationId,
    });
    const sortResult = await sortAndRenameDocument(doc, 'bancos', 'resumen_bancario');
    if (!sortResult.success) {
      logError('Failed to move resumen to Bancos', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: sortResult.error,
        correlationId,
      });
      result.errors++;
    } else {
      info(`Moved to ${sortResult.targetPath}`, {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        correlationId,
      });
    }
  } else if (documentType === 'certificado_retencion') {
    // Tax withholding certificate -> goes to Control de Ingresos
    debug('Storing certificado de retencion', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      spreadsheetId: controlIngresosId,
      nroCertificado: (doc as Retencion).nroCertificado,
      montoRetencion: (doc as Retencion).montoRetencion,
      date: (doc as Retencion).fechaEmision,
      correlationId,
    });
    const storeResult = await storeRetencion(doc as Retencion, controlIngresosId);
    if (storeResult.ok) {
      info('Retencion stored, moving to Ingresos folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        correlationId,
      });
      const sortResult = await sortAndRenameDocument(doc, 'ingresos', 'certificado_retencion');
      if (!sortResult.success) {
        logError('Failed to move retencion to Ingresos', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: sortResult.error,
          correlationId,
        });
        result.errors++;
      } else {
        info(`Moved to ${sortResult.targetPath}`, {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          correlationId,
        });
      }
    } else {
      logError('Failed to store retencion', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: storeResult.error.message,
        correlationId,
      });
      result.errors++;
    }
  }
}

/**
 * Re-runs matching on unmatched documents
 *
 * @returns Rematch result with matches found
 */
export async function rematch(): Promise<Result<RematchResult, Error>> {
  return withCorrelationAsync(async () => {
    const correlationId = getCorrelationId();
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

    info('Rematch complete', {
      module: 'scanner',
      phase: 'rematch',
      matchesFound: matchResult.value,
      duration: Date.now() - startTime,
      correlationId,
    });

    return {
      ok: true,
      value: {
        matchesFound: matchResult.value,
        duration: Date.now() - startTime,
      },
    };
  }, { correlationId: generateCorrelationId() });
}
