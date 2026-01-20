/**
 * Gemini response parsing and validation
 */

import type { Factura, Pago, Recibo, ResumenBancario, ParseResult, Result, ClassificationResult, AdvaRoleValidation } from '../types/index.js';
import { ParseError } from '../types/index.js';
import { debug, warn } from '../utils/logger.js';

/** ADVA's CUIT - used for role validation */
const ADVA_CUIT = '30709076783';

/**
 * Extracts JSON from a response that might be wrapped in markdown
 *
 * @param response - Raw response text
 * @returns Extracted JSON string or empty string if no JSON found
 */
export function extractJSON(response: string): string {
  if (!response) return '';

  // Remove leading/trailing whitespace
  const trimmed = response.trim();

  // Check for markdown code blocks (use non-greedy match and take first occurrence)
  const markdownMatches = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g);
  if (markdownMatches && markdownMatches.length > 0) {
    // Extract content from first code block
    const firstBlock = markdownMatches[0];
    const contentMatch = firstBlock.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (contentMatch && contentMatch[1] !== undefined) {
      return contentMatch[1].trim();
    }
  }

  // Check if it starts with { (likely JSON)
  if (trimmed.startsWith('{')) {
    // Find the matching closing brace
    let braceCount = 0;
    let endIndex = 0;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '{') braceCount++;
      if (trimmed[i] === '}') braceCount--;
      if (braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
    if (endIndex > 0) {
      return trimmed.substring(0, endIndex);
    }
    return trimmed;
  }

  warn('No JSON found in response', {
    module: 'gemini-parser',
    phase: 'extraction',
    responsePreview: response.substring(0, 300)
  });

  return '';
}

/**
 * Validates that ADVA is in the expected role for the document type
 *
 * @param data - Extracted document data
 * @param expectedRole - Role ADVA should have
 * @param documentType - Type of document
 * @returns Validation result with errors if invalid
 */
function validateAdvaRole(
  data: any,
  expectedRole: 'emisor' | 'receptor' | 'pagador' | 'beneficiario' | 'empleador',
  documentType: string
): AdvaRoleValidation {
  const validation: AdvaRoleValidation = {
    isValid: true,
    expectedRole,
    advaCuit: ADVA_CUIT,
    errors: []
  };

  switch (expectedRole) {
    case 'emisor':
      if (data.cuitEmisor && data.cuitEmisor !== ADVA_CUIT) {
        validation.isValid = false;
        validation.errors.push(
          `Expected ADVA (${ADVA_CUIT}) as emisor but found ${data.cuitEmisor}`
        );
      }
      // Require receptor info for factura_emitida
      if (!data.cuitReceptor) {
        validation.errors.push('Missing cuitReceptor (counterparty)');
      }
      break;

    case 'receptor':
      if (data.cuitReceptor && data.cuitReceptor !== ADVA_CUIT) {
        validation.isValid = false;
        validation.errors.push(
          `Expected ADVA (${ADVA_CUIT}) as receptor but found ${data.cuitReceptor}`
        );
      }
      // Require emisor info for factura_recibida
      if (!data.cuitEmisor) {
        validation.errors.push('Missing cuitEmisor (counterparty)');
      }
      break;

    case 'pagador':
      // Pagador may be CUIT or just name (ADVA name check)
      const isPagadorAdva =
        (data.cuitPagador && data.cuitPagador === ADVA_CUIT) ||
        (data.nombrePagador && data.nombrePagador.toUpperCase().includes('ADVA'));

      if (!isPagadorAdva && data.cuitPagador) {
        validation.isValid = false;
        validation.errors.push(
          `Expected ADVA as pagador but found ${data.cuitPagador}`
        );
      }
      // Require beneficiario info for pago_enviado
      if (!data.cuitBeneficiario && !data.nombreBeneficiario) {
        validation.errors.push('Missing beneficiario information (counterparty)');
      }
      break;

    case 'beneficiario':
      const isBeneficiarioAdva =
        (data.cuitBeneficiario && data.cuitBeneficiario === ADVA_CUIT) ||
        (data.nombreBeneficiario && data.nombreBeneficiario.toUpperCase().includes('ADVA'));

      if (!isBeneficiarioAdva && data.cuitBeneficiario) {
        validation.isValid = false;
        validation.errors.push(
          `Expected ADVA as beneficiario but found ${data.cuitBeneficiario}`
        );
      }
      // Require pagador info for pago_recibido
      if (!data.cuitPagador && !data.nombrePagador) {
        validation.errors.push('Missing pagador information (counterparty)');
      }
      break;

    case 'empleador':
      if (data.cuitEmpleador && data.cuitEmpleador !== ADVA_CUIT) {
        validation.isValid = false;
        validation.errors.push(
          `Expected ADVA (${ADVA_CUIT}) as empleador but found ${data.cuitEmpleador}`
        );
      }
      break;
  }

  if (validation.errors.length > 0) {
    validation.isValid = false;
  }

  return validation;
}

/**
 * Parses a Gemini response for factura data
 *
 * @param response - Raw Gemini response
 * @param documentType - Document type for role validation
 * @returns Parse result with factura data or error
 */
export function parseFacturaResponse(
  response: string,
  documentType: 'factura_emitida' | 'factura_recibida'
): Result<ParseResult<Partial<Factura>>, ParseError> {
  try {
    // Extract JSON
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }

    // Parse JSON
    const data = JSON.parse(jsonStr) as Partial<Factura>;

    debug('Parsed factura data', {
      module: 'gemini-parser',
      phase: 'parsing',
      documentType,
      fieldsExtracted: Object.keys(data),
      hasCuitEmisor: !!data.cuitEmisor,
      hasCuitReceptor: !!data.cuitReceptor
    });

    // Check for required fields
    const requiredFields: (keyof Factura)[] = [
      'tipoComprobante',
      'nroFactura',
      'fechaEmision',
      'cuitEmisor',
      'razonSocialEmisor',
      'importeNeto',
      'importeIva',
      'importeTotal',
      'moneda'
    ];

    // Check for missing or empty fields (empty strings are suspicious)
    const missingFields = requiredFields.filter(field => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });

    // Check for suspicious empty optional fields
    const optionalFields: (keyof Factura)[] = ['cuitReceptor', 'razonSocialReceptor', 'concepto'];
    let hasSuspiciousEmptyFields = false;
    for (const field of optionalFields) {
      const value = data[field];
      // Empty string is suspicious (should be undefined if not present)
      if (value === '') {
        hasSuspiciousEmptyFields = true;
        data[field] = undefined; // Convert empty strings to undefined
      }
    }

    // Calculate confidence based on completeness
    const completeness = (requiredFields.length - missingFields.length) / requiredFields.length;
    const confidence = Math.max(0.5, completeness); // Minimum 0.5 if we got some data

    // If confidence > 0.9, no review needed; otherwise check for issues
    const needsReview = confidence <= 0.9 && (missingFields.length > 0 || hasSuspiciousEmptyFields);

    // Validate ADVA role
    const expectedRole = documentType === 'factura_emitida' ? 'emisor' : 'receptor';
    const roleValidation = validateAdvaRole(data, expectedRole, documentType);

    // If role validation fails critically, return error
    if (!roleValidation.isValid) {
      warn('ADVA role validation failed', {
        module: 'gemini-parser',
        phase: 'validation',
        documentType,
        expectedRole,
        errors: roleValidation.errors,
        extractedData: {
          cuitEmisor: data.cuitEmisor,
          cuitReceptor: data.cuitReceptor
        }
      });

      return {
        ok: false,
        error: new ParseError(
          `ADVA role validation failed: ${roleValidation.errors.join(', ')}`,
          response
        )
      };
    }

    return {
      ok: true,
      value: {
        data,
        confidence,
        needsReview,
        missingFields: missingFields.length > 0 ? missingFields as string[] : undefined,
        roleValidation
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: new ParseError(
        error instanceof Error ? error.message : 'Unknown parse error',
        response
      )
    };
  }
}

/**
 * Parses a Gemini response for pago data
 *
 * @param response - Raw Gemini response
 * @param documentType - Document type for role validation
 * @returns Parse result with pago data or error
 */
export function parsePagoResponse(
  response: string,
  documentType: 'pago_enviado' | 'pago_recibido'
): Result<ParseResult<Partial<Pago>>, ParseError> {
  try {
    // Extract JSON
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }

    // Parse JSON
    const data = JSON.parse(jsonStr) as Partial<Pago>;

    debug('Parsed pago data', {
      module: 'gemini-parser',
      phase: 'parsing',
      documentType,
      fieldsExtracted: Object.keys(data),
      hasCuitPagador: !!data.cuitPagador,
      hasCuitBeneficiario: !!data.cuitBeneficiario
    });

    // Check for required fields
    const requiredFields: (keyof Pago)[] = [
      'banco',
      'fechaPago',
      'importePagado',
      'moneda'
    ];

    // Check for missing or empty fields (empty strings are suspicious)
    const missingFields = requiredFields.filter(field => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });

    // Check for suspicious empty optional fields
    const optionalFields: (keyof Pago)[] = ['referencia', 'cuitPagador', 'nombrePagador', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto'];
    let hasSuspiciousEmptyFields = false;
    for (const field of optionalFields) {
      const value = data[field];
      // Empty string is suspicious (should be undefined if not present)
      if (value === '') {
        hasSuspiciousEmptyFields = true;
        data[field] = undefined; // Convert empty strings to undefined
      }
    }

    // Calculate confidence based on completeness
    const completeness = (requiredFields.length - missingFields.length) / requiredFields.length;
    const confidence = Math.max(0.5, completeness);

    // If confidence > 0.9, no review needed; otherwise check for issues
    const needsReview = confidence <= 0.9 && (missingFields.length > 0 || hasSuspiciousEmptyFields);

    // Validate ADVA role
    const expectedRole = documentType === 'pago_enviado' ? 'pagador' : 'beneficiario';
    const roleValidation = validateAdvaRole(data, expectedRole, documentType);

    // Note: For pagos, we're more lenient since CUIT might not always be present
    // Just add validation result, don't fail the parse unless critical error
    if (!roleValidation.isValid) {
      warn('ADVA role validation warning for pago', {
        module: 'gemini-parser',
        phase: 'validation',
        documentType,
        expectedRole,
        errors: roleValidation.errors,
        extractedData: {
          cuitPagador: data.cuitPagador,
          cuitBeneficiario: data.cuitBeneficiario
        }
      });
    }

    return {
      ok: true,
      value: {
        data,
        confidence,
        needsReview,
        missingFields: missingFields.length > 0 ? missingFields as string[] : undefined,
        roleValidation
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: new ParseError(
        error instanceof Error ? error.message : 'Unknown parse error',
        response
      )
    };
  }
}

/**
 * Parses a Gemini response for recibo data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with recibo data or error
 */
export function parseReciboResponse(response: string): Result<ParseResult<Partial<Recibo>>, ParseError> {
  try {
    // Extract JSON
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }

    // Parse JSON
    const data = JSON.parse(jsonStr) as Partial<Recibo>;

    debug('Parsed recibo data', {
      module: 'gemini-parser',
      phase: 'parsing',
      documentType: 'recibo',
      fieldsExtracted: Object.keys(data),
      hasCuitEmpleador: !!data.cuitEmpleador
    });

    // Check for required fields
    const requiredFields: (keyof Recibo)[] = [
      'tipoRecibo',
      'nombreEmpleado',
      'cuilEmpleado',
      'legajo',
      'cuitEmpleador',
      'periodoAbonado',
      'fechaPago',
      'subtotalRemuneraciones',
      'subtotalDescuentos',
      'totalNeto'
    ];

    // Check for missing or empty fields (empty strings are suspicious)
    const missingFields = requiredFields.filter(field => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });

    // Check for suspicious empty optional fields
    const optionalFields: (keyof Recibo)[] = ['tareaDesempenada'];
    let hasSuspiciousEmptyFields = false;
    for (const field of optionalFields) {
      const value = data[field];
      // Empty string is suspicious (should be undefined if not present)
      if (value === '') {
        hasSuspiciousEmptyFields = true;
        data[field] = undefined; // Convert empty strings to undefined
      }
    }

    // Calculate confidence based on completeness
    const completeness = (requiredFields.length - missingFields.length) / requiredFields.length;
    const confidence = Math.max(0.5, completeness);

    // If confidence > 0.9, no review needed; otherwise check for issues
    const needsReview = confidence <= 0.9 && (missingFields.length > 0 || hasSuspiciousEmptyFields);

    // Validate ADVA is empleador
    const roleValidation = validateAdvaRole(data, 'empleador', 'recibo');

    if (!roleValidation.isValid) {
      warn('ADVA role validation failed for recibo', {
        module: 'gemini-parser',
        phase: 'validation',
        documentType: 'recibo',
        expectedRole: 'empleador',
        errors: roleValidation.errors,
        extractedData: {
          cuitEmpleador: data.cuitEmpleador
        }
      });

      return {
        ok: false,
        error: new ParseError(
          `ADVA role validation failed: ${roleValidation.errors.join(', ')}`,
          response
        )
      };
    }

    return {
      ok: true,
      value: {
        data,
        confidence,
        needsReview,
        missingFields: missingFields.length > 0 ? missingFields as string[] : undefined,
        roleValidation
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: new ParseError(
        error instanceof Error ? error.message : 'Unknown parse error',
        response
      )
    };
  }
}

/**
 * Parses a Gemini response for resumen bancario data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with resumen bancario data or error
 */
export function parseResumenBancarioResponse(response: string): Result<ParseResult<Partial<ResumenBancario>>, ParseError> {
  try {
    // Extract JSON
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }

    // Parse JSON
    const data = JSON.parse(jsonStr) as Partial<ResumenBancario>;

    // Check for required fields
    const requiredFields: (keyof ResumenBancario)[] = [
      'banco',
      'numeroCuenta',
      'fechaDesde',
      'fechaHasta',
      'saldoInicial',
      'saldoFinal',
      'moneda',
      'cantidadMovimientos'
    ];

    // Check for missing or empty fields (empty strings are suspicious)
    const missingFields = requiredFields.filter(field => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });

    // Calculate confidence based on completeness
    const completeness = (requiredFields.length - missingFields.length) / requiredFields.length;
    const confidence = Math.max(0.5, completeness);

    // If confidence > 0.9, no review needed; otherwise check for issues
    const needsReview = confidence <= 0.9 && missingFields.length > 0;

    return {
      ok: true,
      value: {
        data,
        confidence,
        needsReview,
        missingFields: missingFields.length > 0 ? missingFields as string[] : undefined
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: new ParseError(
        error instanceof Error ? error.message : 'Unknown parse error',
        response
      )
    };
  }
}

/** Valid document types for classification */
const VALID_DOCUMENT_TYPES = [
  'factura_emitida',
  'factura_recibida',
  'pago_enviado',
  'pago_recibido',
  'resumen_bancario',
  'recibo',
  'unrecognized',
] as const;

/**
 * Parses a Gemini response for document classification
 *
 * @param response - Raw Gemini response
 * @returns Parse result with classification data or error
 */
export function parseClassificationResponse(
  response: string
): Result<ClassificationResult, ParseError> {
  try {
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
      return {
        ok: false,
        error: new ParseError('No JSON found in classification response', response)
      };
    }

    const data = JSON.parse(jsonStr);

    // Validate required fields
    if (!data.documentType || !VALID_DOCUMENT_TYPES.includes(data.documentType)) {
      return {
        ok: false,
        error: new ParseError('Invalid or missing documentType in classification', response)
      };
    }

    // Normalize confidence
    const confidence = typeof data.confidence === 'number'
      ? Math.max(0, Math.min(1, data.confidence))
      : 0.5;

    return {
      ok: true,
      value: {
        documentType: data.documentType,
        confidence,
        reason: data.reason || 'No reason provided',
        indicators: Array.isArray(data.indicators) ? data.indicators : []
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: new ParseError(
        error instanceof Error ? error.message : 'Unknown parse error',
        response
      )
    };
  }
}
