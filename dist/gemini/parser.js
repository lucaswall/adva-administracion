/**
 * Gemini response parsing and validation
 */
import { ParseError } from '../types/index.js';
/**
 * Extracts JSON from a response that might be wrapped in markdown
 *
 * @param response - Raw response text
 * @returns Extracted JSON string or empty string if no JSON found
 */
export function extractJSON(response) {
    if (!response)
        return '';
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
            if (trimmed[i] === '{')
                braceCount++;
            if (trimmed[i] === '}')
                braceCount--;
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
 * Parses a Gemini response for factura data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with factura data or error
 */
export function parseFacturaResponse(response) {
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
        const data = JSON.parse(jsonStr);
        // Check for required fields
        const requiredFields = [
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
        const optionalFields = ['cuitReceptor', 'razonSocialReceptor', 'concepto'];
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
                missingFields: missingFields.length > 0 ? missingFields : undefined
            }
        };
    }
    catch (error) {
        return {
            ok: false,
            error: new ParseError(error instanceof Error ? error.message : 'Unknown parse error', response)
        };
    }
}
/**
 * Parses a Gemini response for pago data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with pago data or error
 */
export function parsePagoResponse(response) {
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
        const data = JSON.parse(jsonStr);
        // Check for required fields
        const requiredFields = [
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
        const optionalFields = ['referencia', 'cuitPagador', 'nombrePagador', 'cuitBeneficiario', 'nombreBeneficiario', 'concepto'];
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
                missingFields: missingFields.length > 0 ? missingFields : undefined
            }
        };
    }
    catch (error) {
        return {
            ok: false,
            error: new ParseError(error instanceof Error ? error.message : 'Unknown parse error', response)
        };
    }
}
/**
 * Parses a Gemini response for recibo data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with recibo data or error
 */
export function parseReciboResponse(response) {
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
        const data = JSON.parse(jsonStr);
        // Check for required fields
        const requiredFields = [
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
        const optionalFields = ['tareaDesempenada'];
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
                missingFields: missingFields.length > 0 ? missingFields : undefined
            }
        };
    }
    catch (error) {
        return {
            ok: false,
            error: new ParseError(error instanceof Error ? error.message : 'Unknown parse error', response)
        };
    }
}
/**
 * Parses a Gemini response for resumen bancario data
 *
 * @param response - Raw Gemini response
 * @returns Parse result with resumen bancario data or error
 */
export function parseResumenBancarioResponse(response) {
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
        const data = JSON.parse(jsonStr);
        // Check for required fields
        const requiredFields = [
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
                missingFields: missingFields.length > 0 ? missingFields : undefined
            }
        };
    }
    catch (error) {
        return {
            ok: false,
            error: new ParseError(error instanceof Error ? error.message : 'Unknown parse error', response)
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
];
/**
 * Parses a Gemini response for document classification
 *
 * @param response - Raw Gemini response
 * @returns Parse result with classification data or error
 */
export function parseClassificationResponse(response) {
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
    }
    catch (error) {
        return {
            ok: false,
            error: new ParseError(error instanceof Error ? error.message : 'Unknown parse error', response)
        };
    }
}
