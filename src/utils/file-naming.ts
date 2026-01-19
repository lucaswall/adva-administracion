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
 * Format: FacturaEmitida_00001-00001234_20123456786_2024-01-15.pdf
 * For NC: NotaCreditoEmitida_...
 * For ND: NotaDebitoEmitida_...
 *
 * @param factura - Factura data
 * @param tipo - Document type (factura_emitida or factura_recibida)
 * @returns Standardized file name
 */
export function generateFacturaFileName(
  factura: Factura,
  tipo: 'factura_emitida' | 'factura_recibida'
): string {
  const direction = tipo === 'factura_emitida' ? 'Emitida' : 'Recibida';

  let prefix: string;
  switch (factura.tipoComprobante) {
    case 'NC':
      prefix = `NotaCredito${direction}`;
      break;
    case 'ND':
      prefix = `NotaDebito${direction}`;
      break;
    default:
      prefix = `Factura${direction}`;
  }

  const puntoVenta = factura.puntoVenta;
  const numeroComprobante = factura.numeroComprobante;
  const cuit = factura.cuitEmisor;
  const fecha = factura.fechaEmision;

  return `${prefix}_${puntoVenta}-${numeroComprobante}_${cuit}_${fecha}.pdf`;
}

/**
 * Generates a standardized file name for a pago
 *
 * Format: PagoEnviado_BBVA_2024-01-18_1210.00.pdf
 *
 * @param pago - Pago data
 * @param tipo - Document type (pago_enviado or pago_recibido)
 * @returns Standardized file name
 */
export function generatePagoFileName(
  pago: Pago,
  tipo: 'pago_enviado' | 'pago_recibido'
): string {
  const prefix = tipo === 'pago_enviado' ? 'PagoEnviado' : 'PagoRecibido';
  const banco = sanitizeFileName(pago.banco);
  const fecha = pago.fechaPago;
  const importe = pago.importePagado.toFixed(2);

  return `${prefix}_${banco}_${fecha}_${importe}.pdf`;
}

/**
 * Generates a standardized file name for a recibo
 *
 * Format: Recibo_JuanPerez_diciembre2024.pdf
 * For liquidacion_final: LiquidacionFinal_JuanPerez_diciembre2024.pdf
 *
 * @param recibo - Recibo data
 * @returns Standardized file name
 */
export function generateReciboFileName(recibo: Recibo): string {
  const prefix = recibo.tipoRecibo === 'liquidacion_final' ? 'LiquidacionFinal' : 'Recibo';

  // Remove spaces and special characters from employee name
  const nombreLimpio = sanitizeFileName(recibo.nombreEmpleado)
    .replace(/[,\s]/g, '');

  // Clean up period format (remove slash)
  const periodo = recibo.periodoAbonado.replace('/', '');

  return `${prefix}_${nombreLimpio}_${periodo}.pdf`;
}

/**
 * Generates a standardized file name for a resumen bancario
 *
 * Format: Resumen_BBVA_2024-01-01_a_2024-01-31.pdf
 * For USD: Resumen_BBVA_2024-01-01_a_2024-01-31_USD.pdf
 *
 * @param resumen - Resumen bancario data
 * @returns Standardized file name
 */
export function generateResumenFileName(resumen: ResumenBancario): string {
  const banco = sanitizeFileName(resumen.banco);
  const desde = resumen.fechaDesde;
  const hasta = resumen.fechaHasta;

  // Add currency suffix for USD
  const currencySuffix = resumen.moneda === 'USD' ? '_USD' : '';

  return `Resumen_${banco}_${desde}_a_${hasta}${currencySuffix}.pdf`;
}
