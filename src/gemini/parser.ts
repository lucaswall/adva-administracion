/**
 * Gemini response parsing and validation
 */

import type { Factura, Pago, Recibo, ResumenBancario, ResumenTarjeta, ResumenBroker, Retencion, ParseResult, Result, ClassificationResult, AdvaRoleValidation, ResumenBancarioConMovimientos, ResumenTarjetaConMovimientos, ResumenBrokerConMovimientos } from '../types/index.js';
import { ParseError } from '../types/index.js';
import { warn } from '../utils/logger.js';
import { normalizeBankName } from '../utils/bank-names.js';

/** ADVA's CUIT - used for role validation and CUIT assignment */
const ADVA_CUIT = '30709076783';

/**
 * Flexible pattern to match ADVA's name in various forms.
 * Handles OCR errors, abbreviations, and variations:
 * - "ADVA"
 * - "ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS" (full name)
 * - "ASOC CIVIL DESARROLLADORES..." (abbreviated)
 * - "ASOCIACION CIVIL DE DESARROLLARODES..." (OCR error)
 * - "...VIDEOJUEGOS ARGENTINO..." (keyword match)
 */
const ADVA_NAME_PATTERN = /ADVA|ASOC.*DESARROLL|VIDEOJUEGO/i;

/**
 * Normalizes a CUIT by removing dashes, spaces, and slashes.
 *
 * @param cuit - CUIT string that may contain formatting characters
 * @returns Normalized 11-digit CUIT string
 */
export function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-\s/]/g, '');
}

/**
 * Checks if a name matches ADVA's known name patterns.
 *
 * @param name - Name to check
 * @returns True if the name matches ADVA
 */
export function isAdvaName(name: string): boolean {
  return ADVA_NAME_PATTERN.test(name);
}

/**
 * Result of CUIT assignment and classification
 */
interface CuitAssignmentResult {
  /** Document type based on ADVA's position */
  documentType: 'factura_emitida' | 'factura_recibida';
  /** Issuer CUIT (11 digits, no dashes) */
  cuitEmisor: string;
  /** Issuer name */
  razonSocialEmisor: string;
  /** Receptor CUIT (may be empty for Consumidor Final) */
  cuitReceptor: string;
  /** Receptor name */
  razonSocialReceptor: string;
}

/**
 * Assigns CUITs to issuer/receptor based on ADVA's position and determines document type.
 *
 * Since Gemini correctly identifies names but cannot reliably pair CUITs with their
 * corresponding names, this function uses name matching to determine ADVA's role
 * and then assigns CUITs accordingly.
 *
 * @param issuerName - Name of the issuer (company at TOP of document)
 * @param clientName - Name of the client (company in CLIENT section)
 * @param allCuits - Array of all CUITs found in the document (should be pre-normalized, 11 digits each)
 * @returns Assignment result with document type and properly paired CUIT/name combinations
 * @throws Error if ADVA is not found in either issuer or client name
 */
export function assignCuitsAndClassify(
  issuerName: string,
  clientName: string,
  allCuits: string[]
): CuitAssignmentResult {
  const advaIsIssuer = isAdvaName(issuerName);
  const advaIsClient = isAdvaName(clientName);

  // Find the "other" CUIT (not ADVA's) - CUITs should already be normalized by caller
  const otherCuit = allCuits.find(c => c !== ADVA_CUIT) || '';

  if (advaIsIssuer && !advaIsClient) {
    // factura_emitida - ADVA created this invoice
    return {
      documentType: 'factura_emitida',
      cuitEmisor: ADVA_CUIT,
      razonSocialEmisor: issuerName,
      cuitReceptor: otherCuit,
      razonSocialReceptor: clientName,
    };
  } else if (advaIsClient && !advaIsIssuer) {
    // factura_recibida - ADVA received this invoice
    return {
      documentType: 'factura_recibida',
      cuitEmisor: otherCuit,
      razonSocialEmisor: issuerName,
      cuitReceptor: ADVA_CUIT,
      razonSocialReceptor: clientName,
    };
  } else if (advaIsIssuer && advaIsClient) {
    // Both match ADVA - unusual but could happen with internal documents
    // Default to factura_emitida since ADVA is the issuer
    warn('Both issuer and client names match ADVA pattern', {
      module: 'gemini-parser',
      phase: 'cuit-assignment',
      issuerName,
      clientName,
    });
    return {
      documentType: 'factura_emitida',
      cuitEmisor: ADVA_CUIT,
      razonSocialEmisor: issuerName,
      cuitReceptor: otherCuit,
      razonSocialReceptor: clientName,
    };
  }

  // ADVA not found in either name - this is an error
  throw new Error(`ADVA not found in either issuer name "${issuerName}" or client name "${clientName}"`);
}

/**
 * Detects if a response appears to be truncated
 *
 * @param response - Raw response text
 * @returns True if response appears truncated
 */
function isTruncated(response: string): boolean {
  const trimmed = response.trim();

  // Check if response ends with incomplete JSON structure
  const lastChar = trimmed[trimmed.length - 1];
  const endsWithValidJson = lastChar === '}' || lastChar === ']';

  if (!endsWithValidJson) {
    // Count opening and closing braces/brackets
    let braceCount = 0;
    let bracketCount = 0;

    for (const char of trimmed) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
    }

    // If there are unmatched opening braces/brackets, likely truncated
    if (braceCount > 0 || bracketCount > 0) {
      return true;
    }
  }

  return false;
}

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

  // Check for truncation before attempting extraction
  if (isTruncated(trimmed)) {
    const preview = trimmed.length > 200
      ? trimmed.substring(trimmed.length - 200)
      : trimmed;

    warn('Response appears truncated', {
      module: 'gemini-parser',
      phase: 'extract-json',
      responseLength: trimmed.length,
      responseEnd: preview
    });

    // Return empty string - caller will handle "No JSON found" error
    // But the warning log will help diagnose the issue
    return '';
  }

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
  _documentType: string
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

  // Note: isValid should only be false if ADVA is in wrong role
  // Missing counterparty info is an error but shouldn't invalidate the document
  return validation;
}

/**
 * Raw extraction result from Gemini for facturas (new format)
 * Contains issuerName, clientName, allCuits separately
 */
interface RawFacturaExtraction {
  issuerName?: string;
  clientName?: string;
  allCuits?: string[];
  tipoComprobante?: string;
  nroFactura?: string;
  fechaEmision?: string;
  importeNeto?: number;
  importeIva?: number;
  importeTotal?: number;
  moneda?: string;
  concepto?: string;
  // Legacy fields (for backwards compatibility)
  cuitEmisor?: string;
  razonSocialEmisor?: string;
  cuitReceptor?: string;
  razonSocialReceptor?: string;
}

/**
 * Parses a Gemini response for factura data
 *
 * This function now handles the new extraction format where Gemini returns
 * issuerName, clientName, and allCuits separately. It uses assignCuitsAndClassify
 * to properly pair CUITs with names based on ADVA's position.
 *
 * @param response - Raw Gemini response
 * @param expectedDocumentType - Expected type based on classification (may be overridden)
 * @returns Parse result with factura data or error
 */
export function parseFacturaResponse(
  response: string,
  expectedDocumentType: 'factura_emitida' | 'factura_recibida'
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
    const rawData = JSON.parse(jsonStr) as RawFacturaExtraction;

    // Check if using new format (has issuerName/clientName) or legacy format
    const isNewFormat = rawData.issuerName !== undefined || rawData.clientName !== undefined;

    let data: Partial<Factura>;
    let actualDocumentType: 'factura_emitida' | 'factura_recibida' = expectedDocumentType;

    if (isNewFormat) {
      // New format: assign CUITs based on ADVA name matching
      const issuerName = rawData.issuerName || '';
      const clientName = rawData.clientName || '';
      const allCuits = rawData.allCuits || [];

      // Normalize CUITs that may still have dashes
      const normalizedCuits = allCuits.map(normalizeCuit);

      try {
        const assignment = assignCuitsAndClassify(issuerName, clientName, normalizedCuits);
        actualDocumentType = assignment.documentType;

        data = {
          tipoComprobante: rawData.tipoComprobante as Factura['tipoComprobante'],
          nroFactura: rawData.nroFactura,
          fechaEmision: rawData.fechaEmision,
          cuitEmisor: assignment.cuitEmisor,
          razonSocialEmisor: assignment.razonSocialEmisor,
          cuitReceptor: assignment.cuitReceptor || undefined,
          razonSocialReceptor: assignment.razonSocialReceptor || undefined,
          importeNeto: rawData.importeNeto,
          importeIva: rawData.importeIva,
          importeTotal: rawData.importeTotal,
          moneda: rawData.moneda as Factura['moneda'],
          concepto: rawData.concepto,
        };

        // Log if document type differs from expected
        if (actualDocumentType !== expectedDocumentType) {
          warn('Document type determined by CUIT assignment differs from classification', {
            module: 'gemini-parser',
            phase: 'factura-parse',
            expectedType: expectedDocumentType,
            actualType: actualDocumentType,
            issuerName,
            clientName,
          });
        }
      } catch (assignError) {
        // CUIT assignment failed - ADVA not found in names
        return {
          ok: false,
          error: new ParseError(
            assignError instanceof Error ? assignError.message : 'CUIT assignment failed',
            response
          )
        };
      }
    } else {
      // Legacy format: use data as-is (backwards compatibility)
      data = {
        tipoComprobante: rawData.tipoComprobante as Factura['tipoComprobante'],
        nroFactura: rawData.nroFactura,
        fechaEmision: rawData.fechaEmision,
        cuitEmisor: rawData.cuitEmisor ? normalizeCuit(rawData.cuitEmisor) : undefined,
        razonSocialEmisor: rawData.razonSocialEmisor,
        cuitReceptor: rawData.cuitReceptor ? normalizeCuit(rawData.cuitReceptor) : undefined,
        razonSocialReceptor: rawData.razonSocialReceptor,
        importeNeto: rawData.importeNeto,
        importeIva: rawData.importeIva,
        importeTotal: rawData.importeTotal,
        moneda: rawData.moneda as Factura['moneda'],
        concepto: rawData.concepto,
      };
    }

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

    // Validate ADVA role using the actual document type (may differ from expected)
    const expectedRole = actualDocumentType === 'factura_emitida' ? 'emisor' : 'receptor';
    const roleValidation = validateAdvaRole(data, expectedRole, actualDocumentType);

    // If role validation fails critically, return error
    if (!roleValidation.isValid) {
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
        roleValidation,
        // Include actual document type if it was determined by CUIT assignment
        // (which happens when using the new format with issuerName/clientName)
        actualDocumentType: isNewFormat ? actualDocumentType : undefined,
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
 * @param documentType - Type of pago (enviado or recibido)
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
    // Just add validation result, don't fail the parse
    // The scanner will decide whether to reject based on validation

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

/** Valid credit card types */
const VALID_CARD_TYPES = ['Visa', 'Mastercard', 'Amex', 'Naranja', 'Cabal'] as const;

/**
 * Validates if a date string is in YYYY-MM-DD format and represents a valid date
 * @param dateStr - Date string to validate
 * @returns True if valid format and valid date
 */
function isValidDateFormat(dateStr: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    return false;
  }

  // Parse the date and check that components round-trip correctly
  const parsed = new Date(dateStr + 'T00:00:00.000Z'); // Use UTC to avoid timezone issues
  const [year, month, day] = dateStr.split('-').map(Number);

  // Check if the parsed date matches the input (catches invalid dates like 2024-02-30)
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 && // getUTCMonth is 0-indexed
    parsed.getUTCDate() === day
  );
}

/**
 * Validates movimientos for resumen bancario
 * @param movimientos - Array of movimientos to validate
 * @returns True if any validation issues found
 */
function validateMovimientosBancario(movimientos: Array<{
  fecha: string;
  origenConcepto: string;
  debito: number | null;
  credito: number | null;
  saldo: number;
}>): boolean {
  let hasIssues = false;

  for (const mov of movimientos) {
    // Validate fecha format
    if (!isValidDateFormat(mov.fecha)) {
      warn('Invalid fecha format in movimiento bancario', {
        module: 'gemini-parser',
        phase: 'movimiento-validation',
        fecha: mov.fecha,
      });
      hasIssues = true;
    }

    // Validate at least one of debito/credito has value
    if (mov.debito === null && mov.credito === null) {
      warn('Movimiento bancario has neither debito nor credito', {
        module: 'gemini-parser',
        phase: 'movimiento-validation',
        origenConcepto: mov.origenConcepto,
      });
      hasIssues = true;
    }
  }

  return hasIssues;
}

/**
 * Validates movimientos for resumen tarjeta
 * @param movimientos - Array of movimientos to validate
 * @returns True if any validation issues found
 */
function validateMovimientosTarjeta(movimientos: Array<{
  fecha: string;
  descripcion: string;
  nroCupon: string | null;
  pesos: number | null;
  dolares: number | null;
}>): boolean {
  let hasIssues = false;

  for (const mov of movimientos) {
    // Validate fecha format
    if (!isValidDateFormat(mov.fecha)) {
      warn('Invalid fecha format in movimiento tarjeta', {
        module: 'gemini-parser',
        phase: 'movimiento-validation',
        fecha: mov.fecha,
      });
      hasIssues = true;
    }

    // Validate at least one of pesos/dolares has value
    if (mov.pesos === null && mov.dolares === null) {
      warn('Movimiento tarjeta has neither pesos nor dolares', {
        module: 'gemini-parser',
        phase: 'movimiento-validation',
        descripcion: mov.descripcion,
      });
      hasIssues = true;
    }
  }

  return hasIssues;
}

/**
 * Validates movimientos for resumen broker
 * @param movimientos - Array of movimientos to validate
 * @returns True if any validation issues found
 */
function validateMovimientosBroker(movimientos: Array<{
  descripcion: string;
  cantidadVN: number | null;
  saldo: number;
  precio: number | null;
  bruto: number | null;
  arancel: number | null;
  iva: number | null;
  neto: number | null;
  fechaConcertacion: string;
  fechaLiquidacion: string;
}>): boolean {
  let hasIssues = false;

  for (const mov of movimientos) {
    // Validate fechaConcertacion format
    if (!isValidDateFormat(mov.fechaConcertacion)) {
      warn('Invalid fechaConcertacion format in movimiento broker', {
        module: 'gemini-parser',
        phase: 'movimiento-validation',
        fechaConcertacion: mov.fechaConcertacion,
      });
      hasIssues = true;
    }

    // Validate fechaLiquidacion format
    if (!isValidDateFormat(mov.fechaLiquidacion)) {
      warn('Invalid fechaLiquidacion format in movimiento broker', {
        module: 'gemini-parser',
        phase: 'movimiento-validation',
        fechaLiquidacion: mov.fechaLiquidacion,
      });
      hasIssues = true;
    }
  }

  return hasIssues;
}

/**
 * Parses a Gemini response for resumen bancario (bank account) data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with resumen bancario data or error
 */
export function parseResumenBancarioResponse(response: string): Result<ParseResult<Partial<ResumenBancarioConMovimientos>>, ParseError> {
  try {
    // Extract JSON
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }

    // Parse JSON - might include movimientos array
    const data = JSON.parse(jsonStr) as Partial<ResumenBancarioConMovimientos>;

    // Normalize bank name to prevent duplicate folders
    if (data.banco) {
      data.banco = normalizeBankName(data.banco);
    }

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
    let confidence = Math.max(0.5, completeness);

    // Verify movimientos count if movimientos array is present
    let needsReview = confidence <= 0.9 && missingFields.length > 0;

    // Validate main date fields
    if (data.fechaDesde && !isValidDateFormat(data.fechaDesde)) {
      needsReview = true;
      warn('Invalid fechaDesde format or value', {
        module: 'gemini-parser',
        phase: 'resumen-bancario-parse',
        fechaDesde: data.fechaDesde
      });
    }
    if (data.fechaHasta && !isValidDateFormat(data.fechaHasta)) {
      needsReview = true;
      warn('Invalid fechaHasta format or value', {
        module: 'gemini-parser',
        phase: 'resumen-bancario-parse',
        fechaHasta: data.fechaHasta
      });
    }

    if (data.movimientos !== undefined && data.cantidadMovimientos !== undefined) {
      const actualCount = data.movimientos.length;
      const expectedCount = data.cantidadMovimientos;

      // Check for > 10% discrepancy
      if (expectedCount > 0) {
        const discrepancy = Math.abs(actualCount - expectedCount) / expectedCount;
        if (discrepancy > 0.1) {
          needsReview = true;
          warn('Movimientos count mismatch detected', {
            module: 'gemini-parser',
            phase: 'resumen-bancario-parse',
            expectedCount,
            actualCount,
            discrepancy: `${(discrepancy * 100).toFixed(1)}%`
          });
        }
      }
    }

    // Validate movimientos field integrity if present
    if (data.movimientos !== undefined && data.movimientos.length > 0) {
      const hasValidationIssues = validateMovimientosBancario(data.movimientos);
      if (hasValidationIssues) {
        needsReview = true;
      }
    }

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
 * Parses a Gemini response for resumen tarjeta (credit card) data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with resumen tarjeta data or error
 */
export function parseResumenTarjetaResponse(response: string): Result<ParseResult<Partial<ResumenTarjetaConMovimientos>>, ParseError> {
  try {
    // Extract JSON
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }

    // Parse JSON - might include movimientos array
    const data = JSON.parse(jsonStr) as Partial<ResumenTarjetaConMovimientos>;

    // Normalize bank name to prevent duplicate folders
    if (data.banco) {
      data.banco = normalizeBankName(data.banco);
    }

    // Validate tipoTarjeta
    if (data.tipoTarjeta !== undefined) {
      if (!VALID_CARD_TYPES.includes(data.tipoTarjeta as typeof VALID_CARD_TYPES[number])) {
        // Invalid card type - mark for review
        warn('Invalid tipoTarjeta value in credit card statement', {
          module: 'gemini-parser',
          phase: 'resumen-tarjeta-parse',
          tipoTarjeta: data.tipoTarjeta,
        });
        data.tipoTarjeta = undefined;
      }
    }

    // Check for required fields
    const requiredFields: (keyof ResumenTarjeta)[] = [
      'banco',
      'tipoTarjeta',
      'numeroCuenta',
      'fechaDesde',
      'fechaHasta',
      'pagoMinimo',
      'saldoActual',
      'cantidadMovimientos'
    ];

    // Check for missing or empty fields
    const missingFields = requiredFields.filter(field => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });

    // Calculate confidence based on completeness
    const completeness = (requiredFields.length - missingFields.length) / requiredFields.length;
    let confidence = Math.max(0.5, completeness);

    // Verify movimientos count if movimientos array is present
    let needsReview = confidence <= 0.9 && missingFields.length > 0;

    // Validate main date fields
    if (data.fechaDesde && !isValidDateFormat(data.fechaDesde)) {
      needsReview = true;
      warn('Invalid fechaDesde format or value', {
        module: 'gemini-parser',
        phase: 'resumen-tarjeta-parse',
        fechaDesde: data.fechaDesde
      });
    }
    if (data.fechaHasta && !isValidDateFormat(data.fechaHasta)) {
      needsReview = true;
      warn('Invalid fechaHasta format or value', {
        module: 'gemini-parser',
        phase: 'resumen-tarjeta-parse',
        fechaHasta: data.fechaHasta
      });
    }

    if (data.movimientos !== undefined && data.cantidadMovimientos !== undefined) {
      const actualCount = data.movimientos.length;
      const expectedCount = data.cantidadMovimientos;

      // Check for > 10% discrepancy
      if (expectedCount > 0) {
        const discrepancy = Math.abs(actualCount - expectedCount) / expectedCount;
        if (discrepancy > 0.1) {
          needsReview = true;
          warn('Movimientos count mismatch detected', {
            module: 'gemini-parser',
            phase: 'resumen-tarjeta-parse',
            expectedCount,
            actualCount,
            discrepancy: `${(discrepancy * 100).toFixed(1)}%`
          });
        }
      }
    }

    // Validate movimientos field integrity if present
    if (data.movimientos !== undefined && data.movimientos.length > 0) {
      const hasValidationIssues = validateMovimientosTarjeta(data.movimientos);
      if (hasValidationIssues) {
        needsReview = true;
      }
    }

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
 * Parses a Gemini response for resumen broker (investment) data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with resumen broker data or error
 */
export function parseResumenBrokerResponse(response: string): Result<ParseResult<Partial<ResumenBrokerConMovimientos>>, ParseError> {
  try {
    // Extract JSON
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }

    // Parse JSON - might include movimientos array
    const data = JSON.parse(jsonStr) as Partial<ResumenBrokerConMovimientos>;

    // Check for required fields (saldoARS and saldoUSD are optional)
    const requiredFields: (keyof ResumenBroker)[] = [
      'broker',
      'numeroCuenta',
      'fechaDesde',
      'fechaHasta',
      'cantidadMovimientos'
    ];

    // Check for missing or empty fields
    const missingFields = requiredFields.filter(field => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });

    // Calculate confidence based on completeness
    const completeness = (requiredFields.length - missingFields.length) / requiredFields.length;
    let confidence = Math.max(0.5, completeness);

    // Verify movimientos count if movimientos array is present
    let needsReview = confidence <= 0.9 && missingFields.length > 0;

    // Validate main date fields
    if (data.fechaDesde && !isValidDateFormat(data.fechaDesde)) {
      needsReview = true;
      warn('Invalid fechaDesde format or value', {
        module: 'gemini-parser',
        phase: 'resumen-broker-parse',
        fechaDesde: data.fechaDesde
      });
    }
    if (data.fechaHasta && !isValidDateFormat(data.fechaHasta)) {
      needsReview = true;
      warn('Invalid fechaHasta format or value', {
        module: 'gemini-parser',
        phase: 'resumen-broker-parse',
        fechaHasta: data.fechaHasta
      });
    }

    if (data.movimientos !== undefined && data.cantidadMovimientos !== undefined) {
      const actualCount = data.movimientos.length;
      const expectedCount = data.cantidadMovimientos;

      // Check for > 10% discrepancy
      if (expectedCount > 0) {
        const discrepancy = Math.abs(actualCount - expectedCount) / expectedCount;
        if (discrepancy > 0.1) {
          needsReview = true;
          warn('Movimientos count mismatch detected', {
            module: 'gemini-parser',
            phase: 'resumen-broker-parse',
            expectedCount,
            actualCount,
            discrepancy: `${(discrepancy * 100).toFixed(1)}%`
          });
        }
      }
    }

    // Validate movimientos field integrity if present
    if (data.movimientos !== undefined && data.movimientos.length > 0) {
      const hasValidationIssues = validateMovimientosBroker(data.movimientos);
      if (hasValidationIssues) {
        needsReview = true;
      }
    }

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
  'resumen_tarjeta',
  'resumen_broker',
  'recibo',
  'certificado_retencion',
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

/**
 * Parses a Gemini response for retencion data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with retencion data or error
 */
export function parseRetencionResponse(
  response: string
): Result<ParseResult<Partial<Retencion>>, ParseError> {
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
    const data = JSON.parse(jsonStr) as Partial<Retencion>;

    // Check for required fields
    const requiredFields: (keyof Retencion)[] = [
      'nroCertificado',
      'fechaEmision',
      'cuitAgenteRetencion',
      'razonSocialAgenteRetencion',
      'cuitSujetoRetenido',
      'impuesto',
      'regimen',
      'montoComprobante',
      'montoRetencion'
    ];

    // Check for missing or empty fields
    const missingFields = requiredFields.filter(field => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });

    // Check for suspicious empty optional fields
    const optionalFields: (keyof Retencion)[] = ['ordenPago'];
    let hasSuspiciousEmptyFields = false;
    for (const field of optionalFields) {
      const value = data[field];
      if (value === '') {
        hasSuspiciousEmptyFields = true;
        data[field] = undefined;
      }
    }

    // Calculate confidence based on completeness
    const completeness = (requiredFields.length - missingFields.length) / requiredFields.length;
    const confidence = Math.max(0.5, completeness);

    // If confidence > 0.9, no review needed; otherwise check for issues
    const needsReview = confidence <= 0.9 && (missingFields.length > 0 || hasSuspiciousEmptyFields);

    // Validate that cuitSujetoRetenido is ADVA
    if (data.cuitSujetoRetenido && data.cuitSujetoRetenido !== ADVA_CUIT) {
      return {
        ok: false,
        error: new ParseError(
          `ADVA validation failed: Expected ADVA (${ADVA_CUIT}) as sujeto retenido but found ${data.cuitSujetoRetenido}`,
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
