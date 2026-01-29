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
  ResumenTarjeta,
  ResumenBroker,
  ResumenBancarioConMovimientos,
  ResumenTarjetaConMovimientos,
  ResumenBrokerConMovimientos,
  Retencion,
  ScanResult,
  DocumentType,
} from '../types/index.js';
import { listFilesInFolder } from '../services/drive.js';
import { getCachedFolderStructure, getOrCreateBankAccountFolder, getOrCreateBankAccountSpreadsheet, getOrCreateCreditCardFolder, getOrCreateCreditCardSpreadsheet, getOrCreateBrokerFolder, getOrCreateBrokerSpreadsheet, getOrCreateMovimientosSpreadsheet } from '../services/folder-structure.js';
import { sortToSinProcesar, sortAndRenameDocument, moveToDuplicadoFolder } from '../services/document-sorter.js';
import { getProcessingQueue } from './queue.js';
import { getConfig } from '../config.js';
import { debug, info, warn, error as logError } from '../utils/logger.js';
import { withCorrelationAsync, getCorrelationId, generateCorrelationId } from '../utils/correlation.js';

// Import from refactored modules
import { processFile, hasValidDate } from './extractor.js';
import { storeFactura, storePago, storeRecibo, storeRetencion, storeResumenBancario, storeResumenTarjeta, storeResumenBroker, storeMovimientosBancario, storeMovimientosTarjeta, storeMovimientosBroker, getProcessedFileIds, markFileProcessing, updateFileStatus } from './storage/index.js';
import { runMatching } from './matching/index.js';
import { SortBatch, DuplicateCache, MetadataCache, SheetOrderBatch } from './caches/index.js';
import { TokenUsageBatch } from '../services/token-usage-batch.js';

// Re-export for backwards compatibility
export { processFile, hasValidDate, type ProcessFileResult } from './extractor.js';

// Track files that have already been retried (to prevent infinite retries)
// This is cleared at the end of each scan
const retriedFileIds = new Set<string>();

/**
 * Scan context containing all caches for optimized batch operations
 */
export interface ScanContext {
  sortBatch: SortBatch;
  duplicateCache: DuplicateCache;
  metadataCache: MetadataCache;
  tokenBatch: TokenUsageBatch;
  sheetOrderBatch: SheetOrderBatch;
}

/**
 * Checks if an error is a JSON parse error (transient Gemini API issue)
 * These errors are often transient and worth retrying once
 *
 * Matches:
 * - "No JSON found in response" (ParseError from extractJSON)
 * - "Unexpected token" / "Unexpected end of JSON" (SyntaxError from JSON.parse)
 * - "Expected ',' or ']' after array element in JSON" (SyntaxError from malformed response)
 * - "Invalid or missing documentType" (truncated/malformed response)
 */
function isJsonParseError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes('no json found') ||
         message.includes('unexpected token') ||
         message.includes('unexpected end') ||
         message.includes('after array element in json') ||
         message.includes('invalid or missing documenttype');
}

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
    const dashboardOperativoId = folderStructure.dashboardOperativoId;

    // Initialize caches for batch operations
    const context: ScanContext = {
      sortBatch: new SortBatch(),
      duplicateCache: new DuplicateCache(),
      metadataCache: new MetadataCache(),
      tokenBatch: new TokenUsageBatch(),
      sheetOrderBatch: new SheetOrderBatch(),
    };

    info('Scan configuration', {
      module: 'scanner',
      phase: 'scan-start',
      targetFolderId,
      controlIngresosId,
      controlEgresosId,
      dashboardOperativoId,
      correlationId,
    });

    try {
      // Pre-load duplicate cache for all relevant sheets
      debug('Pre-loading duplicate cache', {
        module: 'scanner',
        phase: 'cache-init',
        correlationId,
      });

      await Promise.all([
        // Control de Ingresos sheets
        context.duplicateCache.loadSheet(controlIngresosId, 'Facturas Emitidas', 'A:J'),
        context.duplicateCache.loadSheet(controlIngresosId, 'Pagos Recibidos', 'A:H'),
        context.duplicateCache.loadSheet(controlIngresosId, 'Retenciones Recibidas', 'A:O'),
        // Control de Egresos sheets
        context.duplicateCache.loadSheet(controlEgresosId, 'Facturas Recibidas', 'A:J'),
        context.duplicateCache.loadSheet(controlEgresosId, 'Pagos Enviados', 'A:H'),
        context.duplicateCache.loadSheet(controlEgresosId, 'Recibos', 'A:R'),
      ]);

      info('Duplicate cache pre-loaded', {
        module: 'scanner',
        phase: 'cache-init',
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

      // Get already processed file IDs from centralized tracking sheet
      const processedIdsResult = await getProcessedFileIds(dashboardOperativoId);
      if (!processedIdsResult.ok) {
        logError('Failed to get processed file IDs', {
          module: 'scanner',
          phase: 'scan-start',
          error: processedIdsResult.error.message,
          correlationId,
        });
        return processedIdsResult;
      }

      const processedIds = processedIdsResult.value;
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
      // Queue handles promise tracking internally - we'll use onIdle() to wait

      for (const fileInfo of newFiles) {
        queue.add(async () => {
        // Each file gets its own correlation context that inherits from parent
        await withCorrelationAsync(async () => {
          const fileCorrelationId = getCorrelationId();

          info(`Processing file: ${fileInfo.name}`, {
            module: 'scanner',
            phase: 'process-file',
            fileId: fileInfo.id,
            correlationId: fileCorrelationId,
          });

          const processResult = await processFile(fileInfo, context);

          if (!processResult.ok) {
            // Check if it's a JSON parse error and hasn't been retried yet
            // JSON errors are often transient (API instability, rate limiting, etc.)
            if (isJsonParseError(processResult.error) && !retriedFileIds.has(fileInfo.id)) {
              // Mark as retried to prevent infinite retries
              retriedFileIds.add(fileInfo.id);

              warn('JSON parse error, re-queuing for retry', {
                module: 'scanner',
                phase: 'process-file',
                fileId: fileInfo.id,
                fileName: fileInfo.name,
                error: processResult.error.message,
                correlationId: fileCorrelationId,
              });

              // Re-queue at end of queue for retry
              // Queue will track this internally - no need to capture promise
              queue.add(async () => {
                await withCorrelationAsync(async () => {
                  const retryCorrelationId = getCorrelationId();

                  info(`Retrying file: ${fileInfo.name}`, {
                    module: 'scanner',
                    phase: 'process-file-retry',
                    fileId: fileInfo.id,
                    correlationId: retryCorrelationId,
                  });

                  const retryResult = await processFile(fileInfo, context);

                  if (!retryResult.ok) {
                    logError('Failed to process file on retry', {
                      module: 'scanner',
                      phase: 'process-file-retry',
                      fileId: fileInfo.id,
                      fileName: fileInfo.name,
                      error: retryResult.error.message,
                      correlationId: retryCorrelationId,
                    });
                    result.errors++;
                    // Move failed file to Sin Procesar
                    const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
                    if (!sortResult.success) {
                      logError('Failed to move file to Sin Procesar', {
                        module: 'scanner',
                        phase: 'process-file-retry',
                        fileName: fileInfo.name,
                        error: sortResult.error,
                        correlationId: retryCorrelationId,
                      });
                    } else {
                      info(`Moved failed file to ${sortResult.targetPath}`, {
                        module: 'scanner',
                        phase: 'process-file-retry',
                        fileName: fileInfo.name,
                        correlationId: retryCorrelationId,
                      });
                    }
                    return;
                  }

                  // Success on retry - process normally
                  const processed = retryResult.value;
                  result.filesProcessed++;
                  info('File processed successfully on retry', {
                    module: 'scanner',
                    phase: 'complete',
                    fileId: fileInfo.id,
                    fileName: fileInfo.name,
                    documentType: processed.documentType,
                    correlationId: retryCorrelationId,
                  });

                  // Mark file as processing in centralized tracking sheet
                  const markResult = await markFileProcessing(
                    dashboardOperativoId,
                    fileInfo.id,
                    fileInfo.name,
                    processed.documentType
                  );
                  if (!markResult.ok) {
                    logError('Failed to mark file as processing', {
                      module: 'scanner',
                      phase: 'process-file-retry',
                      fileId: fileInfo.id,
                      fileName: fileInfo.name,
                      error: markResult.error.message,
                      correlationId: retryCorrelationId,
                    });
                    // Continue processing even if marking fails
                  }

                  // Handle unrecognized/unknown documents
                  if (processed.documentType === 'unrecognized' || processed.documentType === 'unknown') {
                    info('Moving unrecognized file to Sin Procesar', {
                      module: 'scanner',
                      phase: 'process-file-retry',
                      fileName: fileInfo.name,
                      correlationId: retryCorrelationId,
                    });
                    const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
                    if (!sortResult.success) {
                      logError('Failed to move file to Sin Procesar', {
                        module: 'scanner',
                        phase: 'process-file-retry',
                        fileName: fileInfo.name,
                        error: sortResult.error,
                        correlationId: retryCorrelationId,
                      });
                    } else {
                      info(`Moved to ${sortResult.targetPath}`, {
                        module: 'scanner',
                        phase: 'process-file-retry',
                        fileName: fileInfo.name,
                        correlationId: retryCorrelationId,
                      });
                    }
                    return;
                  }

                  const doc = processed.document;
                  if (!doc) return;

                  // CRITICAL: Validate that document has required date field
                  if (!hasValidDate(doc, processed.documentType)) {
                    warn('No date extracted, moving to Sin Procesar', {
                      module: 'scanner',
                      phase: 'process-file-retry',
                      fileName: fileInfo.name,
                      correlationId: retryCorrelationId,
                    });
                    const sortResult = await sortToSinProcesar(fileInfo.id, fileInfo.name);
                    if (!sortResult.success) {
                      logError('Failed to move file to Sin Procesar', {
                        module: 'scanner',
                        phase: 'process-file-retry',
                        fileName: fileInfo.name,
                        error: sortResult.error,
                        correlationId: retryCorrelationId,
                      });
                      result.errors++;
                    } else {
                      info(`Moved file without date to ${sortResult.targetPath}`, {
                        module: 'scanner',
                        phase: 'process-file-retry',
                        fileName: fileInfo.name,
                        correlationId: retryCorrelationId,
                      });
                    }
                    return;
                  }

                  // Store and sort based on document type
                  await storeAndSortDocument(
                    doc,
                    processed.documentType,
                    fileInfo,
                    controlIngresosId,
                    controlEgresosId,
                    dashboardOperativoId,
                    result,
                    retryCorrelationId,
                    context
                  );
                }, { correlationId: generateCorrelationId(), fileId: fileInfo.id, fileName: fileInfo.name });
              });
              // Queue will track retry internally - no need to push to retryPromises array
              return; // Don't move to Sin Procesar yet - will retry
            }

            // Already retried or not a JSON error - move to Sin Procesar
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
                fileId: fileInfo.id,
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

          // Mark file as processing in centralized tracking sheet
          const markResult = await markFileProcessing(
            dashboardOperativoId,
            fileInfo.id,
            fileInfo.name,
            processed.documentType
          );
          if (!markResult.ok) {
            logError('Failed to mark file as processing', {
              module: 'scanner',
              phase: 'process-file',
              fileId: fileInfo.id,
              fileName: fileInfo.name,
              error: markResult.error.message,
              correlationId: fileCorrelationId,
            });
            // Continue processing even if marking fails
          }

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
            dashboardOperativoId,
            result,
            fileCorrelationId,
            context
          );
        }, { correlationId: generateCorrelationId(), fileId: fileInfo.id, fileName: fileInfo.name });
        });
      }

      // Wait for all processing to complete (including retries)
      // Queue tracks all tasks internally, including retries added via queue.add()
      await queue.onIdle();

      // Clear retry tracking for next scan
      retriedFileIds.clear();

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

      // Flush batched operations before calculating duration
      debug('Flushing batched operations', {
        module: 'scanner',
        phase: 'flush-caches',
        correlationId,
      });

      await context.sortBatch.flushSorts();
      await context.sheetOrderBatch.flushReorders();

      const tokenFlushResult = await context.tokenBatch.flush(dashboardOperativoId);
      if (!tokenFlushResult.ok) {
        logError('Failed to flush token usage batch', {
          module: 'scanner',
          phase: 'flush-caches',
          correlationId,
          error: tokenFlushResult.error.message
        });
        // Continue anyway - token logging is not critical to scan success
      }

      info('Batched operations flushed', {
        module: 'scanner',
        phase: 'flush-caches',
        correlationId,
      });

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
    } finally {
      // Always clear caches to free memory
      debug('Clearing caches', {
        module: 'scanner',
        phase: 'cleanup',
        correlationId,
      });

      context.sortBatch.clear();
      context.sheetOrderBatch.clear();
      context.duplicateCache.clear();
      context.metadataCache.clear();

      info('Caches cleared', {
        module: 'scanner',
        phase: 'cleanup',
        correlationId,
      });
    }
  }, { correlationId: generateCorrelationId() });
}

/**
 * Helper to store and sort a document based on its type
 */
async function storeAndSortDocument(
  doc: Factura | Pago | Recibo | ResumenBancario | ResumenTarjeta | ResumenBroker | Retencion,
  documentType: DocumentType,
  fileInfo: { id: string; name: string },
  controlIngresosId: string,
  controlEgresosId: string,
  dashboardOperativoId: string,
  result: ScanResult,
  correlationId: string | undefined,
  context?: ScanContext
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
    const storeResult = await storeFactura(doc as Factura, controlIngresosId, 'Facturas Emitidas', 'factura_emitida', context);
    if (storeResult.ok) {
      if (storeResult.value.stored) {
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
          // Mark as failed in tracking sheet
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          // Mark as success in tracking sheet
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
      } else {
        // Duplicate detected - move to Duplicado folder
        info('Duplicate factura emitida detected, moving to Duplicado folder', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          existingFileId: storeResult.value.existingFileId,
          correlationId,
        });
        const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
        if (!moveResult.ok) {
          logError('Failed to move duplicate to Duplicado folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: moveResult.error.message,
            correlationId,
          });
          result.errors++;
          // Mark as failed in tracking sheet
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved duplicate to ${moveResult.value.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          // Mark as success in tracking sheet (duplicate is successfully handled)
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
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
      // Mark as failed in tracking sheet
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
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
    const storeResult = await storeFactura(doc as Factura, controlEgresosId, 'Facturas Recibidas', 'factura_recibida', context);
    if (storeResult.ok) {
      if (storeResult.value.stored) {
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
          // Mark as failed in tracking sheet
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          // Mark as success in tracking sheet
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
      } else {
        // Duplicate detected - move to Duplicado folder
        info('Duplicate factura recibida detected, moving to Duplicado folder', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          existingFileId: storeResult.value.existingFileId,
          correlationId,
        });
        const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
        if (!moveResult.ok) {
          logError('Failed to move duplicate to Duplicado folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: moveResult.error.message,
            correlationId,
          });
          result.errors++;
          // Mark as failed in tracking sheet
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved duplicate to ${moveResult.value.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          // Mark as success in tracking sheet (duplicate is successfully handled)
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
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
      // Mark as failed in tracking sheet
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
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
    const storeResult = await storePago(doc as Pago, controlIngresosId, 'Pagos Recibidos', 'pago_recibido', context);
    if (storeResult.ok) {
      if (storeResult.value.stored) {
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
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
      } else {
        // Duplicate detected - move to Duplicado folder
        info('Duplicate pago recibido detected, moving to Duplicado folder', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          existingFileId: storeResult.value.existingFileId,
          correlationId,
        });
        const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
        if (!moveResult.ok) {
          logError('Failed to move duplicate to Duplicado folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: moveResult.error.message,
            correlationId,
          });
          result.errors++;
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved duplicate to ${moveResult.value.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
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
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
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
    const storeResult = await storePago(doc as Pago, controlEgresosId, 'Pagos Enviados', 'pago_enviado', context);
    if (storeResult.ok) {
      if (storeResult.value.stored) {
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
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
      } else {
        // Duplicate detected - move to Duplicado folder
        info('Duplicate pago enviado detected, moving to Duplicado folder', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          existingFileId: storeResult.value.existingFileId,
          correlationId,
        });
        const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
        if (!moveResult.ok) {
          logError('Failed to move duplicate to Duplicado folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: moveResult.error.message,
            correlationId,
          });
          result.errors++;
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved duplicate to ${moveResult.value.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
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
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
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
    const storeResult = await storeRecibo(doc as Recibo, controlEgresosId, context);
    if (storeResult.ok) {
      if (storeResult.value.stored) {
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
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
      } else {
        // Duplicate detected - move to Duplicado folder
        info('Duplicate recibo detected, moving to Duplicado folder', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          existingFileId: storeResult.value.existingFileId,
          correlationId,
        });
        const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
        if (!moveResult.ok) {
          logError('Failed to move duplicate to Duplicado folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: moveResult.error.message,
            correlationId,
          });
          result.errors++;
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved duplicate to ${moveResult.value.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
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
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
    }
  } else if (documentType === 'resumen_bancario') {
    // Bank account statement -> store in bank account-specific spreadsheet
    const resumen = doc as ResumenBancario;
    const year = resumen.fechaHasta.substring(0, 4);

    debug('Storing resumen bancario', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      banco: resumen.banco,
      numeroCuenta: resumen.numeroCuenta,
      year,
      correlationId,
    });

    // Get or create bank account folder
    const folderResult = await getOrCreateBankAccountFolder(
      year,
      resumen.banco,
      resumen.numeroCuenta,
      resumen.moneda
    );

    if (!folderResult.ok) {
      logError('Failed to get bank account folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: folderResult.error.message,
        correlationId,
      });
      result.errors++;
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', folderResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
    } else {
      // Get or create bank account spreadsheet
      const spreadsheetResult = await getOrCreateBankAccountSpreadsheet(
        folderResult.value,
        year,
        resumen.banco,
        resumen.numeroCuenta,
        resumen.moneda
      );

      if (!spreadsheetResult.ok) {
        logError('Failed to get bank account spreadsheet', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: spreadsheetResult.error.message,
          correlationId,
        });
        result.errors++;
        const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', spreadsheetResult.error.message);
        if (!statusResult.ok) {
          logError('Failed to update file status', {
            module: 'scanner',
            fileId: fileInfo.id,
            error: statusResult.error.message,
            correlationId,
          });
        }
      } else {
        // Store the resumen
        const storeResult = await storeResumenBancario(resumen, spreadsheetResult.value, context);

        if (storeResult.ok) {
          if (storeResult.value.stored) {
            // Store movimientos (including empty "SIN MOVIMIENTOS" case)
            const resumenWithMovimientos = doc as ResumenBancarioConMovimientos;
            if (resumenWithMovimientos.movimientos) {
              const folderName = `${resumen.banco} ${resumen.numeroCuenta} ${resumen.moneda}`;
              const movSpreadsheetResult = await getOrCreateMovimientosSpreadsheet(
                folderResult.value,
                folderName,
                'bancario'
              );

              if (movSpreadsheetResult.ok) {
                const storeMovResult = await storeMovimientosBancario(
                  resumenWithMovimientos.movimientos,
                  movSpreadsheetResult.value,
                  { fechaDesde: resumen.fechaDesde, fechaHasta: resumen.fechaHasta },
                  context?.sheetOrderBatch
                );

                if (!storeMovResult.ok) {
                  warn('Failed to store movimientos bancario', {
                    module: 'scanner',
                    phase: 'storage',
                    fileName: fileInfo.name,
                    error: storeMovResult.error.message,
                    correlationId,
                  });
                } else {
                  info('Stored movimientos bancario', {
                    module: 'scanner',
                    phase: 'storage',
                    fileName: fileInfo.name,
                    count: resumenWithMovimientos.movimientos.length,
                    correlationId,
                  });
                }
              } else {
                warn('Failed to get movimientos spreadsheet', {
                  module: 'scanner',
                  phase: 'storage',
                  fileName: fileInfo.name,
                  error: movSpreadsheetResult.error.message,
                  correlationId,
                });
              }
            }

            // Not a duplicate - move to bank account folder
            const sortResult = await sortAndRenameDocument(doc, 'bancos', 'resumen_bancario');
            if (!sortResult.success) {
              logError('Failed to move resumen', {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                error: sortResult.error,
                correlationId,
              });
              result.errors++;
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
            } else {
              info(`Stored and moved to ${sortResult.targetPath}`, {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                correlationId,
              });
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
            }
          } else {
            // Duplicate - move to Duplicado folder
            info('Duplicate resumen detected, moving to Duplicado folder', {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name,
              existingFileId: storeResult.value.existingFileId,
              correlationId,
            });
            const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
            if (!moveResult.ok) {
              logError('Failed to move duplicate resumen to Duplicado', {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                error: moveResult.error.message,
                correlationId,
              });
              result.errors++;
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
            } else {
              info('Moved duplicate resumen to Duplicado', {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                correlationId,
              });
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
            }
          }
        } else {
          logError('Failed to store resumen', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: storeResult.error.message,
            correlationId,
          });
          result.errors++;
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
      }
    }
  } else if (documentType === 'resumen_tarjeta') {
    // Credit card statement -> store in credit card-specific spreadsheet
    const resumen = doc as ResumenTarjeta;
    const year = resumen.fechaHasta.substring(0, 4);

    debug('Storing resumen tarjeta', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      banco: resumen.banco,
      tipoTarjeta: resumen.tipoTarjeta,
      numeroCuenta: resumen.numeroCuenta,
      year,
      correlationId,
    });

    // Get or create credit card folder
    const folderResult = await getOrCreateCreditCardFolder(
      year,
      resumen.banco,
      resumen.tipoTarjeta,
      resumen.numeroCuenta
    );

    if (!folderResult.ok) {
      logError('Failed to get credit card folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: folderResult.error.message,
        correlationId,
      });
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', folderResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
      result.errors++;
    } else {
      // Get or create credit card spreadsheet
      const spreadsheetResult = await getOrCreateCreditCardSpreadsheet(
        folderResult.value,
        year,
        resumen.banco,
        resumen.tipoTarjeta,
        resumen.numeroCuenta
      );

      if (!spreadsheetResult.ok) {
        logError('Failed to get credit card spreadsheet', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: spreadsheetResult.error.message,
          correlationId,
        });
        const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', spreadsheetResult.error.message);
        if (!statusResult.ok) {
          logError('Failed to update file status', {
            module: 'scanner',
            fileId: fileInfo.id,
            error: statusResult.error.message,
            correlationId,
          });
        }
        result.errors++;
      } else {
        // Store the resumen
        const storeResult = await storeResumenTarjeta(resumen, spreadsheetResult.value, context);

        if (storeResult.ok) {
          if (storeResult.value.stored) {
            // Store movimientos (including empty "SIN MOVIMIENTOS" case)
            const resumenWithMovimientos = doc as ResumenTarjetaConMovimientos;
            if (resumenWithMovimientos.movimientos) {
              const folderName = `${resumen.banco} ${resumen.tipoTarjeta} ${resumen.numeroCuenta}`;
              const movSpreadsheetResult = await getOrCreateMovimientosSpreadsheet(
                folderResult.value,
                folderName,
                'tarjeta'
              );

              if (movSpreadsheetResult.ok) {
                const storeMovResult = await storeMovimientosTarjeta(
                  resumenWithMovimientos.movimientos,
                  movSpreadsheetResult.value,
                  { fechaDesde: resumen.fechaDesde, fechaHasta: resumen.fechaHasta },
                  context?.sheetOrderBatch
                );

                if (!storeMovResult.ok) {
                  warn('Failed to store movimientos tarjeta', {
                    module: 'scanner',
                    phase: 'storage',
                    fileName: fileInfo.name,
                    error: storeMovResult.error.message,
                    correlationId,
                  });
                } else {
                  info('Stored movimientos tarjeta', {
                    module: 'scanner',
                    phase: 'storage',
                    fileName: fileInfo.name,
                    count: resumenWithMovimientos.movimientos.length,
                    correlationId,
                  });
                }
              } else {
                warn('Failed to get movimientos spreadsheet', {
                  module: 'scanner',
                  phase: 'storage',
                  fileName: fileInfo.name,
                  error: movSpreadsheetResult.error.message,
                  correlationId,
                });
              }
            }

            const sortResult = await sortAndRenameDocument(doc, 'bancos', 'resumen_tarjeta');
            if (!sortResult.success) {
              logError('Failed to move resumen tarjeta', {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                error: sortResult.error,
                correlationId,
              });
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
              result.errors++;
            } else {
              info(`Stored and moved to ${sortResult.targetPath}`, {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                correlationId,
              });
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
            }
          } else {
            info('Duplicate resumen tarjeta detected, moving to Duplicado folder', {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name,
              existingFileId: storeResult.value.existingFileId,
              correlationId,
            });
            const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
            if (!moveResult.ok) {
              logError('Failed to move duplicate resumen tarjeta to Duplicado', {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                error: moveResult.error.message,
                correlationId,
              });
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
              result.errors++;
            } else {
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
            }
          }
        } else {
          logError('Failed to store resumen tarjeta', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: storeResult.error.message,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
          result.errors++;
        }
      }
    }
  } else if (documentType === 'resumen_broker') {
    // Broker statement -> store in broker-specific spreadsheet
    const resumen = doc as ResumenBroker;
    const year = resumen.fechaHasta.substring(0, 4);

    debug('Storing resumen broker', {
      module: 'scanner',
      phase: 'storage',
      fileName: fileInfo.name,
      broker: resumen.broker,
      numeroCuenta: resumen.numeroCuenta,
      year,
      correlationId,
    });

    // Get or create broker folder
    const folderResult = await getOrCreateBrokerFolder(
      year,
      resumen.broker,
      resumen.numeroCuenta
    );

    if (!folderResult.ok) {
      logError('Failed to get broker folder', {
        module: 'scanner',
        phase: 'storage',
        fileName: fileInfo.name,
        error: folderResult.error.message,
        correlationId,
      });
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', folderResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
      result.errors++;
    } else {
      // Get or create broker spreadsheet
      const spreadsheetResult = await getOrCreateBrokerSpreadsheet(
        folderResult.value,
        year,
        resumen.broker,
        resumen.numeroCuenta
      );

      if (!spreadsheetResult.ok) {
        logError('Failed to get broker spreadsheet', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          error: spreadsheetResult.error.message,
          correlationId,
        });
        const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', spreadsheetResult.error.message);
        if (!statusResult.ok) {
          logError('Failed to update file status', {
            module: 'scanner',
            fileId: fileInfo.id,
            error: statusResult.error.message,
            correlationId,
          });
        }
        result.errors++;
      } else {
        // Store the resumen
        const storeResult = await storeResumenBroker(resumen, spreadsheetResult.value, context);

        if (storeResult.ok) {
          if (storeResult.value.stored) {
            // Store movimientos (including empty "SIN MOVIMIENTOS" case)
            const resumenWithMovimientos = doc as ResumenBrokerConMovimientos;
            if (resumenWithMovimientos.movimientos) {
              const folderName = `${resumen.broker} ${resumen.numeroCuenta}`;
              const movSpreadsheetResult = await getOrCreateMovimientosSpreadsheet(
                folderResult.value,
                folderName,
                'broker'
              );

              if (movSpreadsheetResult.ok) {
                const storeMovResult = await storeMovimientosBroker(
                  resumenWithMovimientos.movimientos,
                  movSpreadsheetResult.value,
                  { fechaDesde: resumen.fechaDesde, fechaHasta: resumen.fechaHasta },
                  context?.sheetOrderBatch
                );

                if (!storeMovResult.ok) {
                  warn('Failed to store movimientos broker', {
                    module: 'scanner',
                    phase: 'storage',
                    fileName: fileInfo.name,
                    error: storeMovResult.error.message,
                    correlationId,
                  });
                } else {
                  info('Stored movimientos broker', {
                    module: 'scanner',
                    phase: 'storage',
                    fileName: fileInfo.name,
                    count: resumenWithMovimientos.movimientos.length,
                    correlationId,
                  });
                }
              } else {
                warn('Failed to get movimientos spreadsheet', {
                  module: 'scanner',
                  phase: 'storage',
                  fileName: fileInfo.name,
                  error: movSpreadsheetResult.error.message,
                  correlationId,
                });
              }
            }

            const sortResult = await sortAndRenameDocument(doc, 'bancos', 'resumen_broker');
            if (!sortResult.success) {
              logError('Failed to move resumen broker', {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                error: sortResult.error,
                correlationId,
              });
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
              result.errors++;
            } else {
              info(`Stored and moved to ${sortResult.targetPath}`, {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                correlationId,
              });
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
            }
          } else {
            info('Duplicate resumen broker detected, moving to Duplicado folder', {
              module: 'scanner',
              phase: 'storage',
              fileName: fileInfo.name,
              existingFileId: storeResult.value.existingFileId,
              correlationId,
            });
            const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
            if (!moveResult.ok) {
              logError('Failed to move duplicate resumen broker to Duplicado', {
                module: 'scanner',
                phase: 'storage',
                fileName: fileInfo.name,
                error: moveResult.error.message,
                correlationId,
              });
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
              result.errors++;
            } else {
              const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
              if (!statusResult.ok) {
                logError('Failed to update file status', {
                  module: 'scanner',
                  fileId: fileInfo.id,
                  error: statusResult.error.message,
                  correlationId,
                });
              }
            }
          }
        } else {
          logError('Failed to store resumen broker', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: storeResult.error.message,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
          result.errors++;
        }
      }
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
    const storeResult = await storeRetencion(doc as Retencion, controlIngresosId, context);
    if (storeResult.ok) {
      if (storeResult.value.stored) {
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
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', sortResult.error);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved to ${sortResult.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
      } else {
        // Duplicate detected - move to Duplicado folder
        info('Duplicate retencion detected, moving to Duplicado folder', {
          module: 'scanner',
          phase: 'storage',
          fileName: fileInfo.name,
          existingFileId: storeResult.value.existingFileId,
          correlationId,
        });
        const moveResult = await moveToDuplicadoFolder(fileInfo.id, fileInfo.name);
        if (!moveResult.ok) {
          logError('Failed to move duplicate to Duplicado folder', {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            error: moveResult.error.message,
            correlationId,
          });
          result.errors++;
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', moveResult.error.message);
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        } else {
          info(`Moved duplicate to ${moveResult.value.targetPath}`, {
            module: 'scanner',
            phase: 'storage',
            fileName: fileInfo.name,
            correlationId,
          });
          const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'success');
          if (!statusResult.ok) {
            logError('Failed to update file status', {
              module: 'scanner',
              fileId: fileInfo.id,
              error: statusResult.error.message,
              correlationId,
            });
          }
        }
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
      const statusResult = await updateFileStatus(dashboardOperativoId, fileInfo.id, 'failed', storeResult.error.message);
      if (!statusResult.ok) {
        logError('Failed to update file status', {
          module: 'scanner',
          fileId: fileInfo.id,
          error: statusResult.error.message,
          correlationId,
        });
      }
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
