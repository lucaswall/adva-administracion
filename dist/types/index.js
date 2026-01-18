/**
 * Type definitions for ADVA Invoice Scanner
 * All TypeScript interfaces and types
 */
/**
 * Gemini API error types
 */
export class GeminiError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'GeminiError';
    }
}
/**
 * Parse error types
 */
export class ParseError extends Error {
    rawData;
    constructor(message, rawData) {
        super(message);
        this.rawData = rawData;
        this.name = 'ParseError';
    }
}
