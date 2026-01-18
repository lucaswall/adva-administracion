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
export declare function isValidCuit(cuit: string): boolean;
/**
 * Formats a CUIT to 11 digits without dashes
 *
 * @param cuit - CUIT string (with or without dashes)
 * @returns Formatted CUIT (11 digits, no dashes) or empty string if invalid
 */
export declare function formatCuit(cuit: string): string;
/**
 * Validates an Argentine DNI (Documento Nacional de Identidad)
 *
 * Format: 7-8 numeric digits
 * DNI numbers in Argentina are typically 7-8 digits for individuals
 *
 * @param dni - DNI string
 * @returns true if DNI has valid format
 */
export declare function isValidDni(dni: string): boolean;
/**
 * Formats a DNI to digits only
 *
 * @param dni - DNI string (with or without separators)
 * @returns Formatted DNI (digits only) or empty string if invalid
 */
export declare function formatDni(dni: string): string;
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
export declare function extractDniFromCuit(cuit: string): string;
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
export declare function cuitContainsDni(cuit: string, dni: string): boolean;
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
export declare function cuitOrDniMatch(id1: string, id2: string): boolean;
/**
 * Validates a CAE (Código de Autorización Electrónico)
 *
 * Format: 14 numeric digits
 * Note: ARCA does not publish a checksum algorithm for CAE
 *
 * @param cae - CAE string
 * @returns true if CAE has valid format
 */
export declare function isValidCae(cae: string): boolean;
/**
 * Validates a Factura object for required fields
 *
 * @param data - Partial Factura data
 * @returns Validation result with errors
 */
export declare function validateFactura(data: Partial<Factura>): ValidationResult;
/**
 * Validates a Pago object for required fields
 *
 * @param data - Partial Pago data
 * @returns Validation result with errors
 */
export declare function validatePago(data: Partial<Pago>): ValidationResult;
/**
 * Validates a Recibo object for required fields
 *
 * @param data - Partial Recibo data
 * @returns Validation result with errors
 */
export declare function validateRecibo(data: Partial<Recibo>): ValidationResult;
/**
 * Validates and returns a TipoComprobante enum value
 *
 * @param value - String value to validate
 * @returns Valid TipoComprobante or undefined
 */
export declare function validateTipoComprobante(value: unknown): TipoComprobante | undefined;
/**
 * Validates and returns a MatchConfidence enum value
 *
 * @param value - String value to validate
 * @returns Valid MatchConfidence or undefined
 */
export declare function validateMatchConfidence(value: unknown): MatchConfidence | undefined;
/**
 * Validates and returns a Moneda enum value
 *
 * @param value - String value to validate
 * @returns Valid Moneda or undefined
 */
export declare function validateMoneda(value: unknown): Moneda | undefined;
/**
 * Validates and returns a TipoRecibo enum value
 *
 * @param value - String value to validate
 * @returns Valid TipoRecibo or undefined
 */
export declare function validateTipoRecibo(value: unknown): TipoRecibo | undefined;
