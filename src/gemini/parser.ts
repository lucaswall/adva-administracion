/**
 * Gemini response parsing and validation
 */

import type { Factura, Pago, Recibo, ResumenBancario, ResumenTarjeta, ResumenBroker, Retencion, ParseResult, Result, ClassificationResult, AdvaRoleValidation, ResumenBancarioConMovimientos, ResumenTarjetaConMovimientos, ResumenBrokerConMovimientos } from '../types/index.js';
import { ParseError } from '../types/index.js';
import { warn } from '../utils/logger.js';
import { normalizeBankName } from '../utils/bank-names.js';
import { isValidCuit, isValidDni } from '../utils/validation.js';

/** ADVA's CUIT - used for role validation and CUIT assignment */
const ADVA_CUIT = '30709076783';

/**
 * Maximum JSON response size (1MB)
 * Prevents memory exhaustion from oversized API responses
 */
const MAX_JSON_SIZE = 1_000_000;

/**
 * Flexible pattern to match ADVA's name in various forms.
 * Handles OCR errors, abbreviations, and variations:
 * - "ADVA" (the acronym)
 * - "ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS" (full name)
 * - "ASOC CIVIL DESARROLLADORES VIDEOJUEGOS" (abbreviated)
 * - "AS.C.DE DES.DE VIDEOJUEGOS ARG" (heavily abbreviated with periods)
 * - "A.C. DES. DE VIDEOJUEGOS" (very abbreviated)
 * - Requires VIDEOJUEGO to be present when matching ASOC/DESARROLL patterns
 *   to avoid false positives like "ASOCIACION DE DESARROLLADORES DE SOFTWARE"
 *
 * Pattern breakdown:
 * - `ADVA` - Matches the acronym directly
 * - `(?=.*VIDEOJUEGO)` - Lookahead requires VIDEOJUEGO keyword
 * - `(?=.*(?:A\.?[SC]\.?|A\.?DE))` - Lookahead for association abbreviation
 *   Matches: AS, A.S., A.C., AC, ASOC, A.DE, etc.
 * - `(?=.*D\.?E\.?S\.?)` - Lookahead for desarrolladores abbreviation
 *   Matches: DES, D.E.S., DESARROLL, DES., etc.
 */
const ADVA_NAME_PATTERN = /\bADVA\b|(?=.*VIDEOJUEGO)(?=.*(?:A\.?[SC]\.?|A\.?DE))(?=.*D\.?E\.?S\.?)/i;

/**
 * Normalizes a CUIT by removing dashes, spaces, and slashes.
 *
 * @param cuit - CUIT string that may contain formatting characters
 * @returns Normalized 11-digit CUIT string
 */
export function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-\s/.]/g, '');
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
  /**
   * True when the classification used an ambiguous fallback (CUIT-position
   * heuristic or both names matching ADVA).  Callers should set needsReview.
   */
  ambiguous?: boolean;
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

  // Normalize all CUIT candidates by removing formatting chars (dots, dashes, spaces, slashes).
  // This ensures dotted CUITs like "20.123.456.786" are validated correctly.
  const normalizedCandidates = allCuits.map(c => c.replace(/[-\s/.]/g, ''));

  // Find the counterparty ID: prefer a valid CUIT (11-digit, passes checksum) over a DNI (7-8 digits).
  const validCounterpartyCuit = normalizedCandidates.find(c => c !== ADVA_CUIT && isValidCuit(c)) ?? '';
  const validCounterpartyDni = normalizedCandidates.find(c => c !== ADVA_CUIT && isValidDni(c)) ?? '';
  const otherCuit = validCounterpartyCuit || validCounterpartyDni;

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
    // Both match ADVA — unusual; flag as ambiguous so the caller can request human review.
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
      ambiguous: true,
    };
  }

  // ADVA not found in either name - try CUIT-based positional fallback.
  // If ADVA's CUIT is present in the array, use its position to infer the role.
  const advaCuitIndex = normalizedCandidates.indexOf(ADVA_CUIT);
  if (advaCuitIndex !== -1) {
    warn('Name matching failed, using CUIT fallback for ADVA role detection', {
      module: 'gemini-parser',
      phase: 'cuit-assignment',
      issuerName,
      clientName,
      advaCuitIndex,
    });

    if (advaCuitIndex === 0) {
      // ADVA CUIT is first - ADVA is the issuer (factura_emitida)
      return {
        documentType: 'factura_emitida',
        cuitEmisor: ADVA_CUIT,
        razonSocialEmisor: issuerName,
        cuitReceptor: otherCuit,
        razonSocialReceptor: clientName,
        ambiguous: true,
      };
    } else {
      // ADVA CUIT is not first - ADVA is the client (factura_recibida)
      return {
        documentType: 'factura_recibida',
        cuitEmisor: otherCuit,
        razonSocialEmisor: issuerName,
        cuitReceptor: ADVA_CUIT,
        razonSocialReceptor: clientName,
        ambiguous: true,
      };
    }
  }

  // ADVA not found in names or CUITs - this is an error
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
    // Count opening and closing braces/brackets (string-aware: skip chars inside quoted strings)
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (ch === '\\') {
          i++; // skip escaped character
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          braceCount++;
        } else if (ch === '}') {
          braceCount--;
        } else if (ch === '[') {
          bracketCount++;
        } else if (ch === ']') {
          bracketCount--;
        }
      }
    }

    // If there are unmatched opening braces/brackets, likely truncated
    if (braceCount > 0 || bracketCount > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Result types for JSON extraction
 */
export type ExtractJSONResult =
  | { type: 'valid'; json: string }
  | { type: 'truncated'; partial: string }
  | { type: 'empty' };

/**
 * Extracts JSON from a response that might be wrapped in markdown
 *
 * @param response - Raw response text
 * @returns Extraction result with type information
 */
export function extractJSON(response: string): ExtractJSONResult {
  if (!response) return { type: 'empty' };

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

    return { type: 'truncated', partial: trimmed };
  }

  // Check for markdown code blocks (use non-greedy match and take first occurrence)
  const markdownMatches = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g);
  if (markdownMatches && markdownMatches.length > 0) {
    // Extract content from first code block
    const firstBlock = markdownMatches[0];
    const contentMatch = firstBlock.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (contentMatch && contentMatch[1] !== undefined) {
      return { type: 'valid', json: contentMatch[1].trim() };
    }
  }

  // Check if it starts with { (likely JSON)
  if (trimmed.startsWith('{')) {
    // Find the matching closing brace — use string-aware scanning so that
    // '}' characters inside quoted string values do not close the object.
    let braceCount = 0;
    let endIndex = 0;
    let inString = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (ch === '\\') {
          i++; // skip escaped character (e.g. \" \\ \/)
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          braceCount++;
        } else if (ch === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIndex = i + 1;
            break;
          }
        }
      }
    }
    if (endIndex > 0) {
      return { type: 'valid', json: trimmed.substring(0, endIndex) };
    }
    // Incomplete JSON (no matching closing brace)
    return { type: 'truncated', partial: trimmed };
  }

  return { type: 'empty' };
}

/**
 * Validates that ADVA is in the expected role for the document type.
 *
 * The `data` parameter is typed as the intersection of the three document
 * interfaces (all fields made optional via Partial<>) so TypeScript catches
 * field-name typos and invalid accesses while remaining flexible enough to
 * accept Partial<Factura>, Partial<Pago>, and Partial<Recibo> at call sites.
 *
 * @param data - Extracted document data (factura, pago, or recibo fields)
 * @param expectedRole - Role ADVA should have
 * @param documentType - Type of document (unused, kept for future narrowing)
 * @returns Validation result with errors if invalid
 */
function validateAdvaRole(
  data: Partial<Factura> & Partial<Pago> & Partial<Recibo>,
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
        validation.errors.push('Missing cuitReceptor - may be Consumidor Final or extraction issue');
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
 * Raw extraction result from Gemini for facturas
 * Contains issuerName, clientName, allCuits separately for CUIT assignment
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
  tipoDeCambio?: number;
  condicionIVAReceptor?: string;
}

/** Canonical IVA condition values for invoice receptors */
const VALID_CONDICION_IVA: readonly string[] = [
  'IVA Responsable Inscripto',
  'Consumidor Final',
  'Responsable Monotributo',
  'Cliente del Exterior',
  'IVA Sujeto Exento',
];

/** Valid tipoComprobante values (ADV-286) */
const VALID_TIPO_COMPROBANTE: readonly string[] = [
  'A', 'B', 'C', 'E',
  'NC', 'NC A', 'NC B', 'NC C', 'NC E',
  'ND', 'ND A', 'ND B', 'ND C', 'ND E',
  'LP',
];

/** Valid moneda (currency) values */
const VALID_MONEDA: readonly string[] = ['ARS', 'USD'];

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
    const extractResult = extractJSON(response);
    if (extractResult.type === 'empty') {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }
    if (extractResult.type === 'truncated') {
      return {
        ok: false,
        error: new ParseError('Response appears truncated', extractResult.partial)
      };
    }
    const jsonStr = extractResult.json;

    // Check JSON size limit
    if (jsonStr.length > MAX_JSON_SIZE) {
      return {
        ok: false,
        error: new ParseError(
          `JSON response exceeds maximum size (${jsonStr.length} > ${MAX_JSON_SIZE} bytes)`,
          jsonStr.substring(0, 200)
        )
      };
    }

    // Parse JSON
    const rawData = JSON.parse(jsonStr) as RawFacturaExtraction;

    // Require issuerName and clientName for CUIT assignment
    if (rawData.issuerName === undefined && rawData.clientName === undefined) {
      return {
        ok: false,
        error: new ParseError('Missing issuerName and clientName in extraction', response)
      };
    }

    let data: Partial<Factura>;
    let actualDocumentType: 'factura_emitida' | 'factura_recibida' = expectedDocumentType;
    let hasInvalidCondicionIVA = false;
    let hasInvalidTipoComprobante = false;
    let hasInvalidMoneda = false;
    let assignmentAmbiguous = false;

    // Assign CUITs based on ADVA name matching
    const issuerName = rawData.issuerName || '';
    const clientName = rawData.clientName || '';
    const allCuits = rawData.allCuits || [];

    // Normalize CUITs that may still have dashes
    const normalizedCuits = allCuits.map(normalizeCuit);

    try {
      const assignment = assignCuitsAndClassify(issuerName, clientName, normalizedCuits);
      actualDocumentType = assignment.documentType;
      assignmentAmbiguous = assignment.ambiguous ?? false;

      // Validate tipoDeCambio: only positive numbers are valid
      const tipoDeCambio = typeof rawData.tipoDeCambio === 'number' && rawData.tipoDeCambio > 0
        ? rawData.tipoDeCambio
        : undefined;

      // Validate tipoComprobante at AI boundary (ADV-286): unknown values → undefined + review
      const rawTipoComprobante = rawData.tipoComprobante;
      const tipoComprobante = (rawTipoComprobante !== undefined && VALID_TIPO_COMPROBANTE.includes(rawTipoComprobante))
        ? rawTipoComprobante as Factura['tipoComprobante']
        : undefined;
      hasInvalidTipoComprobante = rawTipoComprobante !== undefined && tipoComprobante === undefined;

      // Validate moneda at AI boundary (ADV-286): unknown values → undefined + review
      const rawMoneda = rawData.moneda;
      const moneda = (rawMoneda !== undefined && VALID_MONEDA.includes(rawMoneda))
        ? rawMoneda as Factura['moneda']
        : undefined;
      hasInvalidMoneda = rawMoneda !== undefined && moneda === undefined;

      // Validate monetary fields (ADV-317): must be finite numbers, not strings
      const importeNeto = (typeof rawData.importeNeto === 'number' && Number.isFinite(rawData.importeNeto))
        ? rawData.importeNeto : undefined;
      const importeIva = (typeof rawData.importeIva === 'number' && Number.isFinite(rawData.importeIva))
        ? rawData.importeIva : undefined;
      const importeTotal = (typeof rawData.importeTotal === 'number' && Number.isFinite(rawData.importeTotal))
        ? rawData.importeTotal : undefined;

      data = {
        tipoComprobante,
        nroFactura: rawData.nroFactura,
        fechaEmision: rawData.fechaEmision,
        cuitEmisor: assignment.cuitEmisor,
        razonSocialEmisor: assignment.razonSocialEmisor,
        cuitReceptor: assignment.cuitReceptor || undefined,
        razonSocialReceptor: assignment.razonSocialReceptor || undefined,
        importeNeto,
        importeIva,
        importeTotal,
        moneda,
        tipoDeCambio,
        concepto: rawData.concepto,
      };

      // condicionIVAReceptor: only set for factura_emitida (ADVA's own condition is constant)
      if (actualDocumentType === 'factura_emitida') {
        // ADV-277: Factura E (exports) — receptor is by AFIP definition foreign.
        // Hardcode 'Exterior' regardless of Gemini's extraction; the value cannot
        // be trusted on E forms (the extractor latches onto the issuer's condition).
        // NC E / ND E (export credit/debit notes) follow the same rule.
        const tc = rawData.tipoComprobante;
        if (tc === 'E' || tc === 'NC E' || tc === 'ND E') {
          data.condicionIVAReceptor = 'Exterior';
        } else {
          const rawCondicion = rawData.condicionIVAReceptor;
          if (rawCondicion !== undefined && rawCondicion !== null && rawCondicion !== '') {
            if (VALID_CONDICION_IVA.includes(rawCondicion)) {
              data.condicionIVAReceptor = rawCondicion;
            } else {
              hasInvalidCondicionIVA = true;
            }
          }
        }
      }

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
    let confidence = completeness; // No artificial floor - let completeness drive confidence

    // hasSuspiciousEmptyFields triggers needsReview independently of confidence (ADV-336)
    let needsReview = (confidence <= 0.9 && missingFields.length > 0) || hasSuspiciousEmptyFields;

    // Invalid enum values → needsReview (ADV-286)
    if (hasInvalidTipoComprobante || hasInvalidMoneda) {
      needsReview = true;
    }

    // CUIT-position fallback / both-names-ADVA ambiguity → needsReview (ADV-337)
    if (assignmentAmbiguous) {
      needsReview = true;
    }

    // CRITICAL: For factura_emitida, empty cuitReceptor indicates Consumidor Final or extraction failure
    // Flag for review to ensure human verification and significantly lower confidence
    if (actualDocumentType === 'factura_emitida' && (!data.cuitReceptor || data.cuitReceptor === '')) {
      warn('Empty cuitReceptor in factura_emitida - likely Consumidor Final or extraction issue', {
        module: 'gemini-parser',
        phase: 'factura-parse',
        clientName: data.razonSocialReceptor,
      });
      needsReview = true;
      // Lower confidence significantly to indicate missing counterparty data
      confidence = Math.min(confidence, 0.3);
    }

    // Flag for review if condicionIVAReceptor was present but not a canonical value
    if (hasInvalidCondicionIVA) {
      needsReview = true;
    }

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
        // Include actual document type determined by CUIT assignment
        actualDocumentType,
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
    const extractResult = extractJSON(response);
    if (extractResult.type === 'empty') {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }
    if (extractResult.type === 'truncated') {
      return {
        ok: false,
        error: new ParseError('Response appears truncated', extractResult.partial)
      };
    }
    const jsonStr = extractResult.json;

    // Check JSON size limit
    if (jsonStr.length > MAX_JSON_SIZE) {
      return {
        ok: false,
        error: new ParseError(
          `JSON response exceeds maximum size (${jsonStr.length} > ${MAX_JSON_SIZE} bytes)`,
          jsonStr.substring(0, 200)
        )
      };
    }

    // Parse JSON
    const data = JSON.parse(jsonStr) as Partial<Pago>;

    // Validate importePagado: must be a finite number (ADV-317)
    if (data.importePagado !== undefined) {
      if (typeof data.importePagado !== 'number' || !Number.isFinite(data.importePagado)) {
        data.importePagado = undefined;
      }
    }

    // Validate moneda at AI boundary (ADV-286): unknown values → undefined
    let hasInvalidPagoMoneda = false;
    if (data.moneda !== undefined) {
      if (!VALID_MONEDA.includes(data.moneda)) {
        hasInvalidPagoMoneda = true;
        data.moneda = undefined;
      }
    }

    // Validate tipoDeCambio: only positive numbers are valid
    if (data.tipoDeCambio !== undefined) {
      if (typeof data.tipoDeCambio !== 'number' || data.tipoDeCambio <= 0) {
        data.tipoDeCambio = undefined;
      }
    }

    // Validate importeEnPesos: only positive numbers are valid
    if (data.importeEnPesos !== undefined) {
      if (typeof data.importeEnPesos !== 'number' || data.importeEnPesos <= 0) {
        data.importeEnPesos = undefined;
      }
    }

    // importeEnPesos without tipoDeCambio is meaningless — clear it
    if (data.tipoDeCambio === undefined) {
      data.importeEnPesos = undefined;
    }

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
    const confidence = completeness;

    // hasSuspiciousEmptyFields triggers needsReview independently of confidence (ADV-336)
    let needsReview = (confidence <= 0.9 && missingFields.length > 0) || hasSuspiciousEmptyFields;

    // Invalid moneda → needsReview (ADV-286)
    if (hasInvalidPagoMoneda) {
      needsReview = true;
    }

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
    const extractResult = extractJSON(response);
    if (extractResult.type === 'empty') {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }
    if (extractResult.type === 'truncated') {
      return {
        ok: false,
        error: new ParseError('Response appears truncated', extractResult.partial)
      };
    }
    const jsonStr = extractResult.json;

    // Check JSON size limit
    if (jsonStr.length > MAX_JSON_SIZE) {
      return {
        ok: false,
        error: new ParseError(
          `JSON response exceeds maximum size (${jsonStr.length} > ${MAX_JSON_SIZE} bytes)`,
          jsonStr.substring(0, 200)
        )
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
    const confidence = completeness;

    // hasSuspiciousEmptyFields triggers needsReview independently of confidence (ADV-336)
    const needsReview = (confidence <= 0.9 && missingFields.length > 0) || hasSuspiciousEmptyFields;

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
/** Maximum reasonable value for financial amounts (1 quadrillion) */
const MAX_FINANCIAL_VALUE = 1e15;

/**
 * Validates that a numeric value is within reasonable bounds
 * @param value - The number to validate (can be null)
 * @param fieldName - Name of the field for logging
 * @param context - Additional context for logging
 * @param options - Optional configuration
 * @param options.allowNegative - If true, negative values are accepted (e.g. overdraft saldo, credit transactions)
 * @returns True if the value is invalid
 */
function isInvalidNumericValue(
  value: number | null,
  fieldName: string,
  context: Record<string, unknown>,
  options: { allowNegative?: boolean } = {}
): boolean {
  if (value === null) return false;

  if (!Number.isFinite(value)) {
    warn(`Invalid ${fieldName}: not a finite number`, {
      module: 'gemini-parser',
      phase: 'movimiento-validation',
      [fieldName]: value,
      ...context,
    });
    return true;
  }

  if (value < 0 && !options.allowNegative) {
    warn(`Invalid ${fieldName}: negative value`, {
      module: 'gemini-parser',
      phase: 'movimiento-validation',
      [fieldName]: value,
      ...context,
    });
    return true;
  }

  if (Math.abs(value) > MAX_FINANCIAL_VALUE) {
    warn(`Invalid ${fieldName}: exceeds maximum reasonable value`, {
      module: 'gemini-parser',
      phase: 'movimiento-validation',
      [fieldName]: value,
      ...context,
    });
    return true;
  }

  return false;
}

function validateMovimientosBancario(movimientos: Array<{
  fecha: string;
  concepto: string;
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
        concepto: mov.concepto,
      });
      hasIssues = true;
    }

    // Validate numeric ranges.
    // debito/credito are transaction amounts: must be non-negative.
    // saldo is a running balance: may be negative (overdraft).
    const context = { concepto: mov.concepto };
    if (isInvalidNumericValue(mov.debito, 'debito', context)) hasIssues = true;
    if (isInvalidNumericValue(mov.credito, 'credito', context)) hasIssues = true;
    if (isInvalidNumericValue(mov.saldo, 'saldo', context, { allowNegative: true })) hasIssues = true;
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

    // Validate numeric ranges.
    // pesos/dolares may be negative (payments/credits on the card statement).
    const context = { descripcion: mov.descripcion };
    if (isInvalidNumericValue(mov.pesos, 'pesos', context, { allowNegative: true })) hasIssues = true;
    if (isInvalidNumericValue(mov.dolares, 'dolares', context, { allowNegative: true })) hasIssues = true;
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

    // Validate numeric ranges.
    // cantidadVN, saldo, bruto, and neto may be negative (sell trades reduce holdings
    // and produce negative cash flows).  precio, arancel, and iva are always positive.
    const context = { descripcion: mov.descripcion };
    if (isInvalidNumericValue(mov.cantidadVN, 'cantidadVN', context, { allowNegative: true })) hasIssues = true;
    if (isInvalidNumericValue(mov.saldo, 'saldo', context, { allowNegative: true })) hasIssues = true;
    if (isInvalidNumericValue(mov.precio, 'precio', context)) hasIssues = true;
    if (isInvalidNumericValue(mov.bruto, 'bruto', context, { allowNegative: true })) hasIssues = true;
    if (isInvalidNumericValue(mov.arancel, 'arancel', context)) hasIssues = true;
    if (isInvalidNumericValue(mov.iva, 'iva', context)) hasIssues = true;
    if (isInvalidNumericValue(mov.neto, 'neto', context, { allowNegative: true })) hasIssues = true;
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
    const extractResult = extractJSON(response);
    if (extractResult.type === 'empty') {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }
    if (extractResult.type === 'truncated') {
      return {
        ok: false,
        error: new ParseError('Response appears truncated', extractResult.partial)
      };
    }
    const jsonStr = extractResult.json;

    // Check JSON size limit
    if (jsonStr.length > MAX_JSON_SIZE) {
      return {
        ok: false,
        error: new ParseError(
          `JSON response exceeds maximum size (${jsonStr.length} > ${MAX_JSON_SIZE} bytes)`,
          jsonStr.substring(0, 200)
        )
      };
    }

    // Parse JSON - might include movimientos array
    const data = JSON.parse(jsonStr) as Partial<ResumenBancarioConMovimientos>;

    // Normalize bank name to prevent duplicate folders
    if (data.banco) {
      data.banco = normalizeBankName(data.banco);
    }

    // Validate moneda at AI boundary (ADV-286): unknown values → undefined + review
    let hasInvalidBancarioMoneda = false;
    if (data.moneda !== undefined) {
      if (!VALID_MONEDA.includes(data.moneda)) {
        hasInvalidBancarioMoneda = true;
        data.moneda = undefined;
      }
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
    let confidence = completeness;

    // Verify movimientos count if movimientos array is present
    let needsReview = confidence <= 0.9 && missingFields.length > 0;

    // Invalid moneda → needsReview (ADV-286)
    if (hasInvalidBancarioMoneda) {
      needsReview = true;
    }

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

      if (expectedCount === 0 && actualCount > 0) {
        // ADV-338: cantidadMovimientos=0 but movimientos array is non-empty → mismatch
        needsReview = true;
        warn('Movimientos count mismatch: cantidadMovimientos=0 but movimientos array has entries', {
          module: 'gemini-parser',
          phase: 'resumen-bancario-parse',
          expectedCount,
          actualCount,
        });
      } else if (expectedCount > 0) {
        // Check for > 10% discrepancy
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

    // ADV-184: Detect narrow date windows (< 14 days) in bank statements.
    // Bank statements typically cover a full calendar month (28-31 days).
    // Narrow windows suggest Gemini anchored on a footer/saldo block instead of
    // the statement-period header (e.g., "Del 01/01/2026 al 31/01/2026").
    // Production evidence: Credicoop 2026 statements extracted 2-7 day ranges.
    if (
      data.fechaDesde && data.fechaHasta &&
      isValidDateFormat(data.fechaDesde) && isValidDateFormat(data.fechaHasta)
    ) {
      const desde = new Date(data.fechaDesde + 'T00:00:00.000Z');
      const hasta = new Date(data.fechaHasta + 'T00:00:00.000Z');
      const diffDays = Math.round((hasta.getTime() - desde.getTime()) / (1000 * 60 * 60 * 24));

      // diffDays must be > 0 to exclude valid SIN MOVIMIENTOS same-day statements.
      // The Credicoop production bug cases all have spans of 1-7 days.
      if (diffDays > 0 && diffDays < 14) {
        needsReview = true;
        warn('Suspicious narrow date window in resumen bancario — possible footer/saldo date extraction instead of period header', {
          module: 'gemini-parser',
          phase: 'resumen-bancario-parse',
          fechaDesde: data.fechaDesde,
          fechaHasta: data.fechaHasta,
          diffDays,
        });
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
    const extractResult = extractJSON(response);
    if (extractResult.type === 'empty') {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }
    if (extractResult.type === 'truncated') {
      return {
        ok: false,
        error: new ParseError('Response appears truncated', extractResult.partial)
      };
    }
    const jsonStr = extractResult.json;

    // Check JSON size limit
    if (jsonStr.length > MAX_JSON_SIZE) {
      return {
        ok: false,
        error: new ParseError(
          `JSON response exceeds maximum size (${jsonStr.length} > ${MAX_JSON_SIZE} bytes)`,
          jsonStr.substring(0, 200)
        )
      };
    }

    // Parse JSON - might include movimientos array
    const data = JSON.parse(jsonStr) as Partial<ResumenTarjetaConMovimientos>;

    // Normalize bank name to prevent duplicate folders
    if (data.banco) {
      data.banco = normalizeBankName(data.banco);
    }

    // Normalize tipoTarjeta case (ADV-316): try case-insensitive match, set canonical form.
    // This handles Gemini returning "MASTERCARD", "visa", "VISA", etc.
    if (data.tipoTarjeta !== undefined) {
      const rawCardType = data.tipoTarjeta;
      const normalized = VALID_CARD_TYPES.find(
        ct => ct.toLowerCase() === rawCardType.toLowerCase()
      );
      if (normalized !== undefined) {
        // Map to canonical casing (e.g. "MASTERCARD" → "Mastercard")
        data.tipoTarjeta = normalized;
      } else {
        // Unknown card type — clear and flag for review
        warn('Invalid tipoTarjeta value in credit card statement', {
          module: 'gemini-parser',
          phase: 'resumen-tarjeta-parse',
          tipoTarjeta: rawCardType,
        });
        data.tipoTarjeta = undefined;
        data.needsReview = true;
      }
    }

    // Validate numeroCuenta
    if (data.numeroCuenta !== undefined && data.numeroCuenta !== null) {
      const accountNumber = String(data.numeroCuenta).trim();
      if (accountNumber === '' || accountNumber.length < 4) {
        // Empty or suspiciously short account number - mark for review
        warn('Invalid numeroCuenta in credit card statement (empty or < 4 digits)', {
          module: 'gemini-parser',
          phase: 'resumen-tarjeta-parse',
          numeroCuenta: accountNumber,
          length: accountNumber.length,
        });
        data.needsReview = true;
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
    let confidence = completeness;

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

      if (expectedCount === 0 && actualCount > 0) {
        // ADV-338: cantidadMovimientos=0 but movimientos array is non-empty → mismatch
        needsReview = true;
        warn('Movimientos count mismatch: cantidadMovimientos=0 but movimientos array has entries', {
          module: 'gemini-parser',
          phase: 'resumen-tarjeta-parse',
          expectedCount,
          actualCount,
        });
      } else if (expectedCount > 0) {
        // Check for > 10% discrepancy
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

    // Propagate data.needsReview to returned needsReview
    if (data.needsReview) {
      needsReview = true;
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
    const extractResult = extractJSON(response);
    if (extractResult.type === 'empty') {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }
    if (extractResult.type === 'truncated') {
      return {
        ok: false,
        error: new ParseError('Response appears truncated', extractResult.partial)
      };
    }
    const jsonStr = extractResult.json;

    // Check JSON size limit
    if (jsonStr.length > MAX_JSON_SIZE) {
      return {
        ok: false,
        error: new ParseError(
          `JSON response exceeds maximum size (${jsonStr.length} > ${MAX_JSON_SIZE} bytes)`,
          jsonStr.substring(0, 200)
        )
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
    let confidence = completeness;

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

      if (expectedCount === 0 && actualCount > 0) {
        // ADV-338: cantidadMovimientos=0 but movimientos array is non-empty → mismatch
        needsReview = true;
        warn('Movimientos count mismatch: cantidadMovimientos=0 but movimientos array has entries', {
          module: 'gemini-parser',
          phase: 'resumen-broker-parse',
          expectedCount,
          actualCount,
        });
      } else if (expectedCount > 0) {
        // Check for > 10% discrepancy
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

    // Validate that at least one balance is present
    if (data.saldoARS === undefined && data.saldoUSD === undefined) {
      needsReview = true;
      warn('No balance found in broker statement', {
        module: 'gemini-parser',
        phase: 'resumen-broker-parse',
        broker: data.broker,
        numeroCuenta: data.numeroCuenta
      });
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
    const extractResult = extractJSON(response);
    if (extractResult.type === 'empty') {
      return {
        ok: false,
        error: new ParseError('No JSON found in classification response', response)
      };
    }
    if (extractResult.type === 'truncated') {
      return {
        ok: false,
        error: new ParseError('Classification response appears truncated', extractResult.partial)
      };
    }
    const jsonStr = extractResult.json;

    // Check JSON size limit
    if (jsonStr.length > MAX_JSON_SIZE) {
      return {
        ok: false,
        error: new ParseError(
          `JSON response exceeds maximum size (${jsonStr.length} > ${MAX_JSON_SIZE} bytes)`,
          jsonStr.substring(0, 200)
        )
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
    const extractResult = extractJSON(response);
    if (extractResult.type === 'empty') {
      return {
        ok: false,
        error: new ParseError('No JSON found in response', response)
      };
    }
    if (extractResult.type === 'truncated') {
      return {
        ok: false,
        error: new ParseError('Response appears truncated', extractResult.partial)
      };
    }
    const jsonStr = extractResult.json;

    // Check JSON size limit
    if (jsonStr.length > MAX_JSON_SIZE) {
      return {
        ok: false,
        error: new ParseError(
          `JSON response exceeds maximum size (${jsonStr.length} > ${MAX_JSON_SIZE} bytes)`,
          jsonStr.substring(0, 200)
        )
      };
    }

    // Parse JSON
    const data = JSON.parse(jsonStr) as Partial<Retencion>;

    // Validate monetary fields (ADV-317): must be finite numbers, not strings
    if (data.montoRetencion !== undefined) {
      if (typeof data.montoRetencion !== 'number' || !Number.isFinite(data.montoRetencion)) {
        data.montoRetencion = undefined;
      }
    }
    if (data.montoComprobante !== undefined) {
      if (typeof data.montoComprobante !== 'number' || !Number.isFinite(data.montoComprobante)) {
        data.montoComprobante = undefined;
      }
    }

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
    const confidence = completeness;

    // hasSuspiciousEmptyFields triggers needsReview independently of confidence (ADV-336)
    const needsReview = (confidence <= 0.9 && missingFields.length > 0) || hasSuspiciousEmptyFields;

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
