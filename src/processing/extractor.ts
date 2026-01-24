/**
 * Document extraction and classification
 * Handles processing a single file - classification and data extraction
 */

import type {
  Result,
  FileInfo,
  Factura,
  Pago,
  Recibo,
  ResumenBancario,
  ResumenTarjeta,
  ResumenBroker,
  Retencion,
  DocumentType,
  ClassificationResult,
} from '../types/index.js';
import { GeminiClient, type UsageCallbackData } from '../gemini/client.js';
import {
  CLASSIFICATION_PROMPT,
  FACTURA_PROMPT,
  PAGO_BBVA_PROMPT,
  RECIBO_PROMPT,
  getResumenBancarioPrompt,
  getResumenTarjetaPrompt,
  getResumenBrokerPrompt,
  CERTIFICADO_RETENCION_PROMPT,
} from '../gemini/prompts.js';
import {
  parseClassificationResponse,
  parseFacturaResponse,
  parsePagoResponse,
  parseReciboResponse,
  parseResumenBancarioResponse,
  parseResumenTarjetaResponse,
  parseResumenBrokerResponse,
  parseRetencionResponse,
} from '../gemini/parser.js';
import { downloadFile } from '../services/drive.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { generateRequestId, logTokenUsage } from '../services/token-usage-logger.js';
import { getConfig, GEMINI_PRICING } from '../config.js';
import { debug, warn, error as logError } from '../utils/logger.js';
import { getCorrelationId, updateCorrelationContext } from '../utils/correlation.js';
import { getCircuitBreaker } from '../utils/circuit-breaker.js';

/**
 * Result of processing a single file
 */
export interface ProcessFileResult {
  documentType: DocumentType;
  document?: Factura | Pago | Recibo | ResumenBancario | ResumenTarjeta | ResumenBroker | Retencion;
  classification?: ClassificationResult;
  error?: string;
}

/**
 * Validates that a document has the required date field
 * Documents without valid dates MUST be moved to Sin Procesar
 *
 * @param doc - Document to validate
 * @param documentType - Type of document
 * @returns true if document has valid date, false otherwise
 */
export function hasValidDate(doc: unknown, documentType: DocumentType): boolean {
  const d = doc as Record<string, unknown>;
  switch (documentType) {
    case 'factura_emitida':
    case 'factura_recibida':
      return !!d.fechaEmision && d.fechaEmision !== '';
    case 'pago_enviado':
    case 'pago_recibido':
      return !!d.fechaPago && d.fechaPago !== '';
    case 'recibo':
      return !!d.fechaPago && d.fechaPago !== '';
    case 'resumen_bancario':
    case 'resumen_tarjeta':
    case 'resumen_broker':
      // Validate that both date fields are present and non-empty
      // If dates cannot be parsed, file should go to Sin Procesar
      return !!d.fechaDesde && d.fechaDesde !== '' && !!d.fechaHasta && d.fechaHasta !== '';
    case 'certificado_retencion':
      return !!d.fechaEmision && d.fechaEmision !== '';
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
  const correlationId = getCorrelationId();

  // Update correlation context with file info
  updateCorrelationContext({ fileId: fileInfo.id, fileName: fileInfo.name });

  // Get folder structure for Dashboard Operativo Contable ID
  const folderStructure = getCachedFolderStructure();
  const dashboardOperativoId = folderStructure?.dashboardOperativoId;

  // Create usage callback for token tracking
  const usageCallback = dashboardOperativoId
    ? (data: UsageCallbackData) => {
        // Get current pricing for this model
        const pricing = GEMINI_PRICING[data.model];

        // Log usage to Dashboard Operativo Contable
        // Note: Fire and forget - don't await to avoid slowing down processing
        void logTokenUsage(dashboardOperativoId, {
          timestamp: new Date().toISOString(),
          requestId: generateRequestId(),
          fileId: data.fileId,
          fileName: data.fileName,
          model: data.model,
          promptTokens: data.promptTokens,
          cachedTokens: data.cachedTokens,
          outputTokens: data.outputTokens,
          totalTokens: data.totalTokens,
          promptCostPerToken: pricing.inputPerToken,
          cachedCostPerToken: pricing.cachedPerToken,
          outputCostPerToken: pricing.outputPerToken,
          durationMs: data.durationMs,
          success: data.success,
          errorMessage: data.errorMessage || '',
        }).then(result => {
          if (!result.ok) {
            warn('Failed to log token usage', {
              module: 'extractor',
              phase: 'token-logging',
              fileId: data.fileId,
              fileName: data.fileName,
              error: result.error.message,
              correlationId,
            });
          }
        });
      }
    : undefined;

  const gemini = new GeminiClient(config.geminiApiKey, config.geminiRpmLimit, usageCallback);

  // Get circuit breaker for Gemini API
  const circuitBreaker = getCircuitBreaker('gemini', {
    failureThreshold: 5,
    resetTimeoutMs: 60000, // 1 minute
    successThreshold: 2,
  });

  // Download file content
  const downloadResult = await downloadFile(fileInfo.id);
  if (!downloadResult.ok) {
    return downloadResult;
  }

  const content = downloadResult.value;

  // Step 1: Classify the document (with circuit breaker protection)
  const classifyResult = await circuitBreaker.execute(async () => {
    const result = await gemini.analyzeDocument(
      content,
      fileInfo.mimeType,
      CLASSIFICATION_PROMPT,
      3,
      fileInfo.id,
      fileInfo.name
    );
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  });

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
    module: 'extractor',
    phase: 'classification',
    fileId: fileInfo.id,
    fileName: fileInfo.name,
    documentType: classification.documentType,
    confidence: classification.confidence,
    reason: classification.reason,
    correlationId,
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
      extractPrompt = getResumenBancarioPrompt();
      break;
    case 'resumen_tarjeta':
      extractPrompt = getResumenTarjetaPrompt();
      break;
    case 'resumen_broker':
      extractPrompt = getResumenBrokerPrompt();
      break;
    case 'certificado_retencion':
      extractPrompt = CERTIFICADO_RETENCION_PROMPT;
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

  // Extract document data (with circuit breaker protection)
  const extractResult = await circuitBreaker.execute(async () => {
    const result = await gemini.analyzeDocument(
      content,
      fileInfo.mimeType,
      extractPrompt,
      3,
      fileInfo.id,
      fileInfo.name
    );
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  });

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
        module: 'extractor',
        phase: 'parsing',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        error: parseResult.error.message,
        rawResponse: parseResult.error.rawData?.substring(0, 1000), // Log first 1000 chars
        correlationId,
      });
      return { ok: false, error: parseResult.error };
    }

    debug('Factura extracted', {
      module: 'extractor',
      phase: 'extraction',
      fileId: fileInfo.id,
      documentType: classification.documentType,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
      roleValidation: parseResult.value.roleValidation,
      correlationId,
    });

    // Check if role validation failed
    if (parseResult.value.roleValidation && !parseResult.value.roleValidation.isValid) {
      logError('Document failed ADVA role validation', {
        module: 'extractor',
        phase: 'validation',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        errors: parseResult.value.roleValidation.errors,
        willMoveTo: 'Sin Procesar',
        correlationId,
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

    // Use actual document type from CUIT assignment if available (more reliable than classification)
    const finalDocumentType = parseResult.value.actualDocumentType || classification.documentType;

    return {
      ok: true,
      value: {
        documentType: finalDocumentType,
        document: factura,
        classification,
      },
    };
  }

  if (classification.documentType === 'pago_enviado' || classification.documentType === 'pago_recibido') {
    const parseResult = parsePagoResponse(extractResult.value, classification.documentType);
    if (!parseResult.ok) {
      logError('Failed to parse pago response', {
        module: 'extractor',
        phase: 'parsing',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        error: parseResult.error.message,
        rawResponse: parseResult.error.rawData?.substring(0, 1000),
        correlationId,
      });
      return { ok: false, error: parseResult.error };
    }

    debug('Pago extracted', {
      module: 'extractor',
      phase: 'extraction',
      fileId: fileInfo.id,
      documentType: classification.documentType,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
      roleValidation: parseResult.value.roleValidation,
      correlationId,
    });

    // Check if role validation failed (for pagos we log but don't necessarily fail)
    if (parseResult.value.roleValidation && !parseResult.value.roleValidation.isValid) {
      warn('Pago role validation has warnings', {
        module: 'extractor',
        phase: 'validation',
        fileId: fileInfo.id,
        fileName: fileInfo.name,
        documentType: classification.documentType,
        errors: parseResult.value.roleValidation.errors,
        correlationId,
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

  if (classification.documentType === 'resumen_tarjeta') {
    const parseResult = parseResumenTarjetaResponse(extractResult.value);
    if (!parseResult.ok) {
      return { ok: false, error: parseResult.error };
    }

    const resumen: ResumenTarjeta = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      banco: parseResult.value.data.banco || 'Desconocido',
      numeroCuenta: parseResult.value.data.numeroCuenta || '',
      tipoTarjeta: parseResult.value.data.tipoTarjeta || 'Visa',
      fechaDesde: parseResult.value.data.fechaDesde || '',
      fechaHasta: parseResult.value.data.fechaHasta || '',
      pagoMinimo: parseResult.value.data.pagoMinimo || 0,
      saldoActual: parseResult.value.data.saldoActual || 0,
      cantidadMovimientos: parseResult.value.data.cantidadMovimientos || 0,
      processedAt: now,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
    };

    return {
      ok: true,
      value: {
        documentType: 'resumen_tarjeta',
        document: resumen,
        classification,
      },
    };
  }

  if (classification.documentType === 'resumen_broker') {
    const parseResult = parseResumenBrokerResponse(extractResult.value);
    if (!parseResult.ok) {
      return { ok: false, error: parseResult.error };
    }

    const resumen: ResumenBroker = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      broker: parseResult.value.data.broker || 'Desconocido',
      numeroCuenta: parseResult.value.data.numeroCuenta || '',
      fechaDesde: parseResult.value.data.fechaDesde || '',
      fechaHasta: parseResult.value.data.fechaHasta || '',
      saldoARS: parseResult.value.data.saldoARS,
      saldoUSD: parseResult.value.data.saldoUSD,
      cantidadMovimientos: parseResult.value.data.cantidadMovimientos || 0,
      processedAt: now,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
    };

    return {
      ok: true,
      value: {
        documentType: 'resumen_broker',
        document: resumen,
        classification,
      },
    };
  }

  if (classification.documentType === 'certificado_retencion') {
    const parseResult = parseRetencionResponse(extractResult.value);
    if (!parseResult.ok) {
      return { ok: false, error: parseResult.error };
    }

    const retencion: Retencion = {
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      nroCertificado: parseResult.value.data.nroCertificado || '',
      fechaEmision: parseResult.value.data.fechaEmision || '',
      cuitAgenteRetencion: parseResult.value.data.cuitAgenteRetencion || '',
      razonSocialAgenteRetencion: parseResult.value.data.razonSocialAgenteRetencion || '',
      cuitSujetoRetenido: parseResult.value.data.cuitSujetoRetenido || '',
      impuesto: parseResult.value.data.impuesto || '',
      regimen: parseResult.value.data.regimen || '',
      montoComprobante: parseResult.value.data.montoComprobante || 0,
      montoRetencion: parseResult.value.data.montoRetencion || 0,
      ordenPago: parseResult.value.data.ordenPago,
      processedAt: now,
      confidence: parseResult.value.confidence,
      needsReview: parseResult.value.needsReview,
    };

    return {
      ok: true,
      value: {
        documentType: 'certificado_retencion',
        document: retencion,
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
