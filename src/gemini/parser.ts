/**
 * Gemini response parsing and validation
 */

import type { Factura, Pago, Recibo, ResumenBancario, ParseResult, Result, ClassificationResult } from '../types/index.js';
import { ParseError } from '../types/index.js';
import { isAdvaCuit } from '../config.js';

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

  return '';
}

/**
 * Corrects emisor/receptor swap if ADVA is detected as emisor
 * ADVA is always the receptor (client), never the emisor (issuer)
 *
 * When Gemini swaps them, the pattern is:
 * - cuitEmisor = ADVA's CUIT (wrong!)
 * - razonSocialEmisor = Real issuer's name (correct!)
 * - cuitReceptor = Real issuer's CUIT (correct!)
 *
 * We need to swap the CUITs but keep razonSocialEmisor as is.
 *
 * @param data - Partial factura data
 * @returns Corrected data
 */
function correctEmisorReceptorSwap(data: Partial<Factura>): Partial<Factura> {
  // If ADVA's CUIT is in cuitEmisor, swap with cuitReceptor
  if (data.cuitEmisor && isAdvaCuit(data.cuitEmisor)) {
    // Swap CUITs
    const tempCuit = data.cuitEmisor;
    data.cuitEmisor = data.cuitReceptor;
    data.cuitReceptor = tempCuit;

    // razonSocialEmisor usually already has the correct name, so keep it
    // Only clear it if it contains ADVA's name
    if (data.razonSocialEmisor?.includes('ADVA') ||
        data.razonSocialEmisor?.includes('ASOCIACION CIVIL DE DESARROLLADORES')) {
      data.razonSocialEmisor = undefined;
    }
  }

  return data;
}

/**
 * Parses a Gemini response for factura data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with factura data or error
 */
export function parseFacturaResponse(response: string): Result<ParseResult<Partial<Factura>>, ParseError> {
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
    let data = JSON.parse(jsonStr) as Partial<Factura>;

    // Correct emisor/receptor swap if ADVA is emisor
    data = correctEmisorReceptorSwap(data);

    // Check for required fields
    const requiredFields: (keyof Factura)[] = [
      'tipoComprobante',
      'puntoVenta',
      'numeroComprobante',
      'fechaEmision',
      'cuitEmisor',
      'razonSocialEmisor',
      'cae',
      'fechaVtoCae',
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
    const optionalFields: (keyof Factura)[] = ['cuitReceptor', 'concepto'];
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

/**
 * Parses a Gemini response for pago data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with pago data or error
 */
export function parsePagoResponse(response: string): Result<ParseResult<Partial<Pago>>, ParseError> {
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

    // Check for required fields
    const requiredFields: (keyof Pago)[] = [
      'banco',
      'fechaPago',
      'importePagado'
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
