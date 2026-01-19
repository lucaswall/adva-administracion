/**
 * File naming utilities for standardized document names
 */

import type { Factura, Pago, Recibo, ResumenBancario } from '../types/index.js';

/**
 * Map of accented characters to their ASCII equivalents
 */
const ACCENT_MAP: Record<string, string> = {
  'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a',
  'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
  'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
  'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
  'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
  'ñ': 'n',
  'Á': 'A', 'À': 'A', 'Ä': 'A', 'Â': 'A', 'Ã': 'A',
  'É': 'E', 'È': 'E', 'Ë': 'E', 'Ê': 'E',
  'Í': 'I', 'Ì': 'I', 'Ï': 'I', 'Î': 'I',
  'Ó': 'O', 'Ò': 'O', 'Ö': 'O', 'Ô': 'O', 'Õ': 'O',
  'Ú': 'U', 'Ù': 'U', 'Ü': 'U', 'Û': 'U',
  'Ñ': 'N',
};

/**
 * Sanitizes a file name by removing invalid characters and normalizing accents
 *
 * @param name - Original file name or part of it
 * @returns Sanitized name safe for file systems
 */
export function sanitizeFileName(name: string): string {
  if (!name) return '';

  let result = name;

  // Replace accented characters
  for (const [accented, ascii] of Object.entries(ACCENT_MAP)) {
    result = result.replaceAll(accented, ascii);
  }

  // Remove invalid file system characters: / \ : * ? " < > |
  result = result.replace(/[/\\:*?"<>|]/g, '');

  // Replace multiple spaces with single space
  result = result.replace(/\s+/g, ' ');

  // Trim whitespace
  result = result.trim();

  return result;
}

/**
 * Generates a standardized file name for a factura
 *
 * Format: YYYY-MM-DD - <Tipo> - PPPPP-NNNNNNNN - Entity Name - Concepto.pdf
 * Example: 2024-01-15 - Factura Emitida - 00001-00001234 - CLIENTE SA - Desarrollo de software.pdf
 *
 * @param factura - Factura data
 * @param tipo - Document type (factura_emitida or factura_recibida)
 * @returns Standardized file name
 */
export function generateFacturaFileName(
  factura: Factura,
  tipo: 'factura_emitida' | 'factura_recibida'
): string {
  // Date (YYYY-MM-DD)
  const fecha = factura.fechaEmision;

  // Type label based on tipoComprobante and direction
  const direction = tipo === 'factura_emitida' ? 'Emitida' : 'Recibida';
  let typeLabel: string;
  switch (factura.tipoComprobante) {
    case 'NC':
      typeLabel = `Nota de Credito ${direction}`;
      break;
    case 'ND':
      typeLabel = `Nota de Debito ${direction}`;
      break;
    default:
      typeLabel = `Factura ${direction}`;
  }

  // Invoice number (PPPPP-NNNNNNNN)
  const numero = `${factura.puntoVenta}-${factura.numeroComprobante}`;

  // Entity name based on direction
  let entityName: string;
  if (tipo === 'factura_emitida') {
    // For emitida, use receptor name or fallback to CUIT
    entityName = factura.razonSocialReceptor || factura.cuitReceptor || 'Desconocido';
  } else {
    // For recibida, use emisor name
    entityName = factura.razonSocialEmisor;
  }
  const sanitizedEntity = sanitizeFileName(entityName);

  // Build parts array
  const parts = [fecha, typeLabel, numero, sanitizedEntity];

  // Add concepto if present
  if (factura.concepto) {
    parts.push(sanitizeFileName(factura.concepto));
  }

  return `${parts.join(' - ')}.pdf`;
}

/**
 * Generates a standardized file name for a pago
 *
 * Format: YYYY-MM-DD - <Tipo> - Entity Name - Concepto.pdf
 * Example: 2024-01-18 - Pago Recibido - Juan Perez - Pago de factura.pdf
 *
 * @param pago - Pago data
 * @param tipo - Document type (pago_enviado or pago_recibido)
 * @returns Standardized file name
 */
export function generatePagoFileName(
  pago: Pago,
  tipo: 'pago_enviado' | 'pago_recibido'
): string {
  // Date (YYYY-MM-DD)
  const fecha = pago.fechaPago;

  // Type label
  const typeLabel = tipo === 'pago_enviado' ? 'Pago Enviado' : 'Pago Recibido';

  // Entity name based on direction
  let entityName: string;
  if (tipo === 'pago_recibido') {
    // For recibido, use pagador name or fallback to CUIT or "Desconocido"
    entityName = pago.nombrePagador || pago.cuitPagador || 'Desconocido';
  } else {
    // For enviado, use beneficiario name or fallback to CUIT or "Desconocido"
    entityName = pago.nombreBeneficiario || pago.cuitBeneficiario || 'Desconocido';
  }
  const sanitizedEntity = sanitizeFileName(entityName);

  // Build parts array
  const parts = [fecha, typeLabel, sanitizedEntity];

  // Add concepto if present
  if (pago.concepto) {
    parts.push(sanitizeFileName(pago.concepto));
  }

  return `${parts.join(' - ')}.pdf`;
}

/**
 * Generates a standardized file name for a recibo
 *
 * Format: YYYY-MM - <Tipo> - Employee Name.pdf
 * Example: 2024-12 - Recibo de Sueldo - Juan Perez.pdf
 *
 * @param recibo - Recibo data
 * @returns Standardized file name
 */
export function generateReciboFileName(recibo: Recibo): string {
  // Extract YYYY-MM from fechaPago
  const yearMonth = recibo.fechaPago.substring(0, 7); // YYYY-MM-DD -> YYYY-MM

  // Type label
  const typeLabel = recibo.tipoRecibo === 'liquidacion_final'
    ? 'Liquidacion Final'
    : 'Recibo de Sueldo';

  // Employee name (sanitized)
  const employeeName = sanitizeFileName(recibo.nombreEmpleado);

  return `${yearMonth} - ${typeLabel} - ${employeeName}.pdf`;
}

/**
 * Generates a standardized file name for a resumen bancario
 *
 * Format: YYYY-MM - Resumen Bancario [USD] - Bank Name.pdf
 * Example ARS: 2024-01 - Resumen Bancario - BBVA.pdf
 * Example USD: 2024-01 - Resumen Bancario USD - BBVA.pdf
 *
 * @param resumen - Resumen bancario data
 * @returns Standardized file name
 */
export function generateResumenFileName(resumen: ResumenBancario): string {
  // Extract YYYY-MM from fechaDesde
  const yearMonth = resumen.fechaDesde.substring(0, 7); // YYYY-MM-DD -> YYYY-MM

  // Type label with USD suffix if applicable
  const typeLabel = resumen.moneda === 'USD'
    ? 'Resumen Bancario USD'
    : 'Resumen Bancario';

  // Bank name (sanitized)
  const bankName = sanitizeFileName(resumen.banco);

  return `${yearMonth} - ${typeLabel} - ${bankName}.pdf`;
}
