/**
 * Validation utilities for CUIT, CAE, and invoice data
 */

import type { Factura, Pago, Recibo, ValidationResult, TipoComprobante, TipoRecibo, MatchConfidence, Moneda } from '../types/index.js';

/**
 * Validates an Argentine CUIT using the modulo 11 checksum algorithm
 *
 * Format: XX-XXXXXXXX-X (stored as 11 digits without dashes)
 * Checksum algorithm:
 * - Weights: [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
 * - Sum = Σ(digit[i] * weight[i]) for i = 0..9
 * - Checksum = 11 - (Sum % 11)
 * - If checksum == 11 → 0
 * - If checksum == 10 → 9
 *
 * @param cuit - CUIT string (with or without dashes)
 * @returns true if CUIT is valid
 */
export function isValidCuit(cuit: string): boolean {
  if (!cuit) return false;

  // Remove dashes and spaces
  const cleaned = cuit.replace(/[-\s]/g, '');

  // Must be exactly 11 digits
  if (cleaned.length !== 11) return false;

  // Must be all numeric
  if (!/^\d+$/.test(cleaned)) return false;

  // Extract digits
  const digits = cleaned.split('').map(Number);

  // Checksum weights
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

  // Calculate sum
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += digits[i] * weights[i];
  }

  // Calculate expected checksum
  let checksum = 11 - (sum % 11);
  if (checksum === 11) checksum = 0;
  if (checksum === 10) checksum = 9;

  // Verify checksum matches
  return checksum === digits[10];
}

/**
 * Formats a CUIT to 11 digits without dashes
 *
 * @param cuit - CUIT string (with or without dashes)
 * @returns Formatted CUIT (11 digits, no dashes) or empty string if invalid
 */
export function formatCuit(cuit: string): string {
  if (!cuit) return '';

  // Remove dashes and spaces
  const cleaned = cuit.replace(/[-\s]/g, '');

  // Return empty if not exactly 11 digits
  if (cleaned.length !== 11 || !/^\d+$/.test(cleaned)) {
    return '';
  }

  return cleaned;
}

/**
 * Validates an Argentine DNI (Documento Nacional de Identidad)
 *
 * Format: 7-8 numeric digits
 * DNI numbers in Argentina are typically 7-8 digits for individuals
 *
 * @param dni - DNI string
 * @returns true if DNI has valid format
 */
export function isValidDni(dni: string): boolean {
  if (!dni) return false;

  // Remove any spaces or dashes
  const cleaned = dni.replace(/[-\s.]/g, '');

  // Must be 7 or 8 digits
  if (cleaned.length < 7 || cleaned.length > 8) return false;

  // Must be all numeric
  if (!/^\d+$/.test(cleaned)) return false;

  return true;
}

/**
 * Formats a DNI to digits only
 *
 * @param dni - DNI string (with or without separators)
 * @returns Formatted DNI (digits only) or empty string if invalid
 */
export function formatDni(dni: string): string {
  if (!dni) return '';

  // Remove dashes, spaces, and dots
  const cleaned = dni.replace(/[-\s.]/g, '');

  // Return empty if not 7-8 digits
  if (cleaned.length < 7 || cleaned.length > 8 || !/^\d+$/.test(cleaned)) {
    return '';
  }

  return cleaned;
}

/**
 * Extracts the DNI portion from a CUIT
 *
 * CUIT structure: XX-XXXXXXXX-X
 * - First 2 digits: Type prefix (20=male, 27=female, 23/24=unisex, 30/33/34=company)
 * - Middle 7-8 digits: DNI
 * - Last 1 digit: Check digit
 *
 * @param cuit - CUIT string (with or without dashes)
 * @returns DNI portion (7-8 digits) or empty string if invalid CUIT
 */
export function extractDniFromCuit(cuit: string): string {
  if (!cuit) return '';

  // Remove dashes and spaces
  const cleaned = cuit.replace(/[-\s]/g, '');

  // Must be exactly 11 digits
  if (cleaned.length !== 11 || !/^\d+$/.test(cleaned)) {
    return '';
  }

  // Extract middle portion (skip first 2 digits and last 1 digit)
  const dniPortion = cleaned.substring(2, 10);

  // Remove leading zeros to get actual DNI
  const dni = dniPortion.replace(/^0+/, '');

  return dni;
}

/**
 * Checks if a DNI matches the DNI portion embedded in a CUIT
 *
 * This handles the common case where payment documents show only
 * the DNI (7-8 digits) while invoices have the full CUIT (11 digits).
 *
 * @param cuit - Full CUIT (11 digits)
 * @param dni - DNI to check (7-8 digits)
 * @returns true if the DNI matches the DNI portion of the CUIT
 */
export function cuitContainsDni(cuit: string, dni: string): boolean {
  if (!cuit || !dni) return false;

  const extractedDni = extractDniFromCuit(cuit);
  if (!extractedDni) return false;

  // Format DNI for comparison
  const formattedDni = formatDni(dni);
  if (!formattedDni) return false;

  // Compare the DNI portions
  return extractedDni === formattedDni;
}

/**
 * Checks if two identifiers match, considering both CUIT-CUIT and CUIT-DNI comparisons
 *
 * This function handles:
 * 1. Direct CUIT match (both are 11-digit CUITs)
 * 2. DNI embedded in CUIT match (one is 7-8 digit DNI, other is 11-digit CUIT)
 *
 * @param id1 - First identifier (CUIT or DNI)
 * @param id2 - Second identifier (CUIT or DNI)
 * @returns true if identifiers match (directly or via DNI extraction)
 */
export function cuitOrDniMatch(id1: string, id2: string): boolean {
  if (!id1 || !id2) return false;

  // Clean both identifiers
  const cleaned1 = id1.replace(/[-\s.]/g, '');
  const cleaned2 = id2.replace(/[-\s.]/g, '');

  // Direct match
  if (cleaned1 === cleaned2) return true;

  // Check if one is a CUIT and the other is a DNI
  const is1Cuit = cleaned1.length === 11 && /^\d+$/.test(cleaned1);
  const is2Cuit = cleaned2.length === 11 && /^\d+$/.test(cleaned2);
  const is1Dni = cleaned1.length >= 7 && cleaned1.length <= 8 && /^\d+$/.test(cleaned1);
  const is2Dni = cleaned2.length >= 7 && cleaned2.length <= 8 && /^\d+$/.test(cleaned2);

  // If one is CUIT and other is DNI, check if DNI is embedded in CUIT
  if (is1Cuit && is2Dni) {
    return cuitContainsDni(cleaned1, cleaned2);
  }
  if (is2Cuit && is1Dni) {
    return cuitContainsDni(cleaned2, cleaned1);
  }

  return false;
}

/**
 * Validates a CAE (Código de Autorización Electrónico)
 *
 * Format: 14 numeric digits
 * Note: ARCA does not publish a checksum algorithm for CAE
 *
 * @param cae - CAE string
 * @returns true if CAE has valid format
 */
export function isValidCae(cae: string): boolean {
  if (!cae) return false;

  // Must be exactly 14 digits
  if (cae.length !== 14) return false;

  // Must be all numeric
  if (!/^\d+$/.test(cae)) return false;

  return true;
}

/**
 * Validates a Factura object for required fields
 *
 * @param data - Partial Factura data
 * @returns Validation result with errors
 */
export function validateFactura(data: Partial<Factura>): ValidationResult {
  const errors: string[] = [];

  // Required fields
  if (!data.tipoComprobante) errors.push('Missing tipoComprobante');
  if (!data.puntoVenta) errors.push('Missing puntoVenta');
  if (!data.numeroComprobante) errors.push('Missing numeroComprobante');
  if (!data.fechaEmision) errors.push('Missing fechaEmision');
  if (!data.cuitEmisor) errors.push('Missing cuitEmisor');
  else if (!isValidCuit(data.cuitEmisor)) errors.push('Invalid cuitEmisor');
  if (!data.razonSocialEmisor) errors.push('Missing razonSocialEmisor');
  if (!data.cae) errors.push('Missing cae');
  else if (!isValidCae(data.cae)) errors.push('Invalid cae');
  if (!data.fechaVtoCae) errors.push('Missing fechaVtoCae');
  if (data.importeNeto === undefined) errors.push('Missing importeNeto');
  if (data.importeIva === undefined) errors.push('Missing importeIva');
  if (data.importeTotal === undefined) errors.push('Missing importeTotal');
  if (!data.moneda) errors.push('Missing moneda');

  // Validate CUIT receptor if present
  if (data.cuitReceptor && !isValidCuit(data.cuitReceptor)) {
    errors.push('Invalid cuitReceptor');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a Pago object for required fields
 *
 * @param data - Partial Pago data
 * @returns Validation result with errors
 */
export function validatePago(data: Partial<Pago>): ValidationResult {
  const errors: string[] = [];

  // Required fields
  if (!data.banco) errors.push('Missing banco');
  if (!data.fechaPago) errors.push('Missing fechaPago');
  if (data.importePagado === undefined) errors.push('Missing importePagado');

  // Validate CUIT pagador if present (accept both CUIT and DNI)
  if (data.cuitPagador && !isValidCuit(data.cuitPagador) && !isValidDni(data.cuitPagador)) {
    errors.push('Invalid cuitPagador');
  }

  // Validate CUIT beneficiario if present (accept both CUIT and DNI)
  if (data.cuitBeneficiario && !isValidCuit(data.cuitBeneficiario) && !isValidDni(data.cuitBeneficiario)) {
    errors.push('Invalid cuitBeneficiario');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a Recibo object for required fields
 *
 * @param data - Partial Recibo data
 * @returns Validation result with errors
 */
export function validateRecibo(data: Partial<Recibo>): ValidationResult {
  const errors: string[] = [];

  // Required fields
  if (!data.tipoRecibo) errors.push('Missing tipoRecibo');
  if (!data.nombreEmpleado) errors.push('Missing nombreEmpleado');
  if (!data.cuilEmpleado) errors.push('Missing cuilEmpleado');
  else if (!isValidCuit(data.cuilEmpleado)) errors.push('Invalid cuilEmpleado');
  if (!data.legajo) errors.push('Missing legajo');
  if (!data.cuitEmpleador) errors.push('Missing cuitEmpleador');
  else if (!isValidCuit(data.cuitEmpleador)) errors.push('Invalid cuitEmpleador');
  if (!data.periodoAbonado) errors.push('Missing periodoAbonado');
  if (!data.fechaPago) errors.push('Missing fechaPago');
  if (data.subtotalRemuneraciones === undefined) errors.push('Missing subtotalRemuneraciones');
  if (data.subtotalDescuentos === undefined) errors.push('Missing subtotalDescuentos');
  if (data.totalNeto === undefined) errors.push('Missing totalNeto');

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates and returns a TipoComprobante enum value
 *
 * @param value - String value to validate
 * @returns Valid TipoComprobante or undefined
 */
export function validateTipoComprobante(value: unknown): TipoComprobante | undefined {
  if (typeof value !== 'string') return undefined;

  const validTypes: TipoComprobante[] = ['A', 'B', 'C', 'E', 'NC', 'ND'];
  return validTypes.includes(value as TipoComprobante) ? (value as TipoComprobante) : undefined;
}

/**
 * Validates and returns a MatchConfidence enum value
 *
 * @param value - String value to validate
 * @returns Valid MatchConfidence or undefined
 */
export function validateMatchConfidence(value: unknown): MatchConfidence | undefined {
  if (typeof value !== 'string') return undefined;

  const validLevels: MatchConfidence[] = ['HIGH', 'MEDIUM', 'LOW'];
  return validLevels.includes(value as MatchConfidence) ? (value as MatchConfidence) : undefined;
}

/**
 * Validates and returns a Moneda enum value
 *
 * @param value - String value to validate
 * @returns Valid Moneda or undefined
 */
export function validateMoneda(value: unknown): Moneda | undefined {
  if (typeof value !== 'string') return undefined;

  const validCurrencies: Moneda[] = ['ARS', 'USD'];
  return validCurrencies.includes(value as Moneda) ? (value as Moneda) : undefined;
}

/**
 * Validates and returns a TipoRecibo enum value
 *
 * @param value - String value to validate
 * @returns Valid TipoRecibo or undefined
 */
export function validateTipoRecibo(value: unknown): TipoRecibo | undefined {
  if (typeof value !== 'string') return undefined;

  const validTypes: TipoRecibo[] = ['sueldo', 'liquidacion_final'];
  return validTypes.includes(value as TipoRecibo) ? (value as TipoRecibo) : undefined;
}

/**
 * Extracts CUIT/CUIL from text using regex patterns
 *
 * Patterns recognized:
 * - "CUIT 30-71234567-8" or "CUIL: 20271190523"
 * - "XX-XXXXXXXX-X" format
 * - Plain 11-digit number with valid checksum
 * - Embedded in text like "TRANSFERENCI 30709076783"
 *
 * @param text - Text to search for CUIT/CUIL
 * @returns Extracted CUIT (11 digits) or undefined
 */
export function extractCuitFromText(text: string): string | undefined {
  if (!text) {
    return undefined;
  }

  // Pattern 1: Explicit CUIT/CUIL prefix
  const explicitMatch = text.match(/CUI[TL][:\s]*(\d{2}[-\s]?\d{8}[-\s]?\d)/i);
  if (explicitMatch) {
    const cleaned = explicitMatch[1].replace(/[-\s]/g, '');
    if (isValidCuit(cleaned)) {
      return cleaned;
    }
  }

  // Pattern 2: 11-digit number with separators (XX-XXXXXXXX-X)
  const separatedMatch = text.match(/(\d{2})[-\s](\d{8})[-\s](\d)/);
  if (separatedMatch) {
    const cleaned = separatedMatch[1] + separatedMatch[2] + separatedMatch[3];
    if (isValidCuit(cleaned)) {
      return cleaned;
    }
  }

  // Pattern 3: Plain 11-digit number (validate checksum to reduce false positives)
  const plainMatches = text.match(/\b(\d{11})\b/g);
  if (plainMatches) {
    for (const match of plainMatches) {
      if (isValidCuit(match)) {
        return match;
      }
    }
  }

  return undefined;
}
