/**
 * Gemini response parsing and validation
 */
import type { Factura, Pago, Recibo, ResumenBancario, ParseResult, Result, ClassificationResult } from '../types/index.js';
import { ParseError } from '../types/index.js';
/**
 * Extracts JSON from a response that might be wrapped in markdown
 *
 * @param response - Raw response text
 * @returns Extracted JSON string or empty string if no JSON found
 */
export declare function extractJSON(response: string): string;
/**
 * Parses a Gemini response for factura data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with factura data or error
 */
export declare function parseFacturaResponse(response: string): Result<ParseResult<Partial<Factura>>, ParseError>;
/**
 * Parses a Gemini response for pago data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with pago data or error
 */
export declare function parsePagoResponse(response: string): Result<ParseResult<Partial<Pago>>, ParseError>;
/**
 * Parses a Gemini response for recibo data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with recibo data or error
 */
export declare function parseReciboResponse(response: string): Result<ParseResult<Partial<Recibo>>, ParseError>;
/**
 * Parses a Gemini response for resumen bancario data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with resumen bancario data or error
 */
export declare function parseResumenBancarioResponse(response: string): Result<ParseResult<Partial<ResumenBancario>>, ParseError>;
/**
 * Parses a Gemini response for document classification
 *
 * @param response - Raw Gemini response
 * @returns Parse result with classification data or error
 */
export declare function parseClassificationResponse(response: string): Result<ClassificationResult, ParseError>;
