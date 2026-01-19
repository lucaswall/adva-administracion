/**
 * Unit tests for file naming utility
 * Tests standardized file name generation for documents
 */

import { describe, it, expect } from 'vitest';
import {
  generateFacturaFileName,
  generatePagoFileName,
  generateReciboFileName,
  generateResumenFileName,
  sanitizeFileName,
} from '../../../src/utils/file-naming.js';
import type { Factura, Pago, Recibo, ResumenBancario } from '../../../src/types/index.js';

describe('sanitizeFileName', () => {
  it('removes invalid characters', () => {
    expect(sanitizeFileName('test/file:name*.pdf')).toBe('testfilename.pdf');
  });

  it('replaces accented characters', () => {
    expect(sanitizeFileName('José García')).toBe('Jose Garcia');
    expect(sanitizeFileName('María Pérez')).toBe('Maria Perez');
    expect(sanitizeFileName('Señor Muñoz')).toBe('Senor Munoz');
  });

  it('handles multiple spaces', () => {
    expect(sanitizeFileName('test   file   name')).toBe('test file name');
  });

  it('trims whitespace', () => {
    expect(sanitizeFileName('  test file  ')).toBe('test file');
  });

  it('keeps underscores and hyphens', () => {
    expect(sanitizeFileName('test_file-name.pdf')).toBe('test_file-name.pdf');
  });

  it('handles empty string', () => {
    expect(sanitizeFileName('')).toBe('');
  });

  it('removes special characters', () => {
    expect(sanitizeFileName('test<>"|?file')).toBe('testfile');
  });
});

describe('generateFacturaFileName', () => {
  const baseFactura: Factura = {
    fileId: 'file-123',
    fileName: 'original.pdf',
    folderPath: '',
    tipoComprobante: 'A',
    puntoVenta: '00001',
    numeroComprobante: '00001234',
    fechaEmision: '2024-01-15',
    fechaVtoCae: '2024-01-25',
    cuitEmisor: '30709076783', // ADVA's CUIT (for emitida)
    razonSocialEmisor: 'ADVA SA',
    cuitReceptor: '20123456786',
    razonSocialReceptor: 'CLIENTE SA',
    cae: '12345678901234',
    importeNeto: 1000,
    importeIva: 210,
    importeTotal: 1210,
    moneda: 'ARS',
    concepto: 'Desarrollo de software',
    processedAt: new Date().toISOString(),
    confidence: 0.95,
    needsReview: false,
  };

  it('generates factura_emitida with all fields', () => {
    const result = generateFacturaFileName(baseFactura, 'factura_emitida');
    expect(result).toBe('2024-01-15 - Factura Emitida - 00001-00001234 - CLIENTE SA - Desarrollo de software.pdf');
  });

  it('generates factura_emitida without concepto', () => {
    const factura: Factura = { ...baseFactura, concepto: undefined };
    const result = generateFacturaFileName(factura, 'factura_emitida');
    expect(result).toBe('2024-01-15 - Factura Emitida - 00001-00001234 - CLIENTE SA.pdf');
  });

  it('generates factura_emitida without razonSocialReceptor (fallback to CUIT)', () => {
    const factura: Factura = { ...baseFactura, razonSocialReceptor: undefined };
    const result = generateFacturaFileName(factura, 'factura_emitida');
    expect(result).toBe('2024-01-15 - Factura Emitida - 00001-00001234 - 20123456786 - Desarrollo de software.pdf');
  });

  it('generates factura_recibida with all fields', () => {
    const factura: Factura = {
      ...baseFactura,
      cuitEmisor: '20123456786',
      razonSocialEmisor: 'PROVEEDOR SA',
      cuitReceptor: '30709076783', // ADVA's CUIT
      concepto: 'Servicios de hosting',
    };
    const result = generateFacturaFileName(factura, 'factura_recibida');
    expect(result).toBe('2024-01-15 - Factura Recibida - 00001-00001234 - PROVEEDOR SA - Servicios de hosting.pdf');
  });

  it('generates factura_recibida without concepto', () => {
    const factura: Factura = {
      ...baseFactura,
      cuitEmisor: '20123456786',
      razonSocialEmisor: 'PROVEEDOR SA',
      cuitReceptor: '30709076783',
      concepto: undefined,
    };
    const result = generateFacturaFileName(factura, 'factura_recibida');
    expect(result).toBe('2024-01-15 - Factura Recibida - 00001-00001234 - PROVEEDOR SA.pdf');
  });

  it('generates Nota de Credito Emitida', () => {
    const notaCredito: Factura = { ...baseFactura, tipoComprobante: 'NC' };
    const result = generateFacturaFileName(notaCredito, 'factura_emitida');
    expect(result).toBe('2024-01-15 - Nota de Credito Emitida - 00001-00001234 - CLIENTE SA - Desarrollo de software.pdf');
  });

  it('generates Nota de Debito Emitida', () => {
    const notaDebito: Factura = { ...baseFactura, tipoComprobante: 'ND' };
    const result = generateFacturaFileName(notaDebito, 'factura_emitida');
    expect(result).toBe('2024-01-15 - Nota de Debito Emitida - 00001-00001234 - CLIENTE SA - Desarrollo de software.pdf');
  });

  it('generates Nota de Credito Recibida', () => {
    const notaCredito: Factura = {
      ...baseFactura,
      tipoComprobante: 'NC',
      cuitEmisor: '20123456786',
      razonSocialEmisor: 'PROVEEDOR SA',
      cuitReceptor: '30709076783',
    };
    const result = generateFacturaFileName(notaCredito, 'factura_recibida');
    expect(result).toBe('2024-01-15 - Nota de Credito Recibida - 00001-00001234 - PROVEEDOR SA - Desarrollo de software.pdf');
  });
});

describe('generatePagoFileName', () => {
  const basePago: Pago = {
    fileId: 'pago-123',
    fileName: 'original.pdf',
    folderPath: '',
    banco: 'BBVA',
    fechaPago: '2024-01-18',
    importePagado: 1210.50,
    nombrePagador: 'Juan Perez',
    cuitPagador: '20111111119',
    nombreBeneficiario: 'EMPRESA SA',
    cuitBeneficiario: '30709076783',
    concepto: 'Pago de factura',
    processedAt: new Date().toISOString(),
    confidence: 0.9,
    needsReview: false,
  };

  it('generates pago_recibido with all fields', () => {
    const result = generatePagoFileName(basePago, 'pago_recibido');
    expect(result).toBe('2024-01-18 - Pago Recibido - Juan Perez - Pago de factura.pdf');
  });

  it('generates pago_recibido without concepto', () => {
    const pago: Pago = { ...basePago, concepto: undefined };
    const result = generatePagoFileName(pago, 'pago_recibido');
    expect(result).toBe('2024-01-18 - Pago Recibido - Juan Perez.pdf');
  });

  it('generates pago_recibido without nombrePagador (fallback to CUIT)', () => {
    const pago: Pago = { ...basePago, nombrePagador: undefined };
    const result = generatePagoFileName(pago, 'pago_recibido');
    expect(result).toBe('2024-01-18 - Pago Recibido - 20111111119 - Pago de factura.pdf');
  });

  it('generates pago_recibido without both name and CUIT', () => {
    const pago: Pago = { ...basePago, nombrePagador: undefined, cuitPagador: undefined };
    const result = generatePagoFileName(pago, 'pago_recibido');
    expect(result).toBe('2024-01-18 - Pago Recibido - Desconocido - Pago de factura.pdf');
  });

  it('generates pago_enviado with all fields', () => {
    const result = generatePagoFileName(basePago, 'pago_enviado');
    expect(result).toBe('2024-01-18 - Pago Enviado - EMPRESA SA - Pago de factura.pdf');
  });

  it('generates pago_enviado without nombreBeneficiario (fallback to CUIT)', () => {
    const pago: Pago = { ...basePago, nombreBeneficiario: undefined };
    const result = generatePagoFileName(pago, 'pago_enviado');
    expect(result).toBe('2024-01-18 - Pago Enviado - 30709076783 - Pago de factura.pdf');
  });

  it('generates pago_enviado without concepto', () => {
    const pago: Pago = { ...basePago, concepto: undefined };
    const result = generatePagoFileName(pago, 'pago_enviado');
    expect(result).toBe('2024-01-18 - Pago Enviado - EMPRESA SA.pdf');
  });
});

describe('generateReciboFileName', () => {
  const baseRecibo: Recibo = {
    fileId: 'recibo-123',
    fileName: 'original.pdf',
    folderPath: '',
    tipoRecibo: 'sueldo',
    nombreEmpleado: 'Juan Perez',
    cuilEmpleado: '20123456786',
    legajo: '001',
    cuitEmpleador: '30709076783',
    periodoAbonado: 'diciembre/2024',
    fechaPago: '2024-12-05',
    subtotalRemuneraciones: 500000,
    subtotalDescuentos: 85000,
    totalNeto: 415000,
    processedAt: new Date().toISOString(),
    confidence: 0.95,
    needsReview: false,
  };

  it('generates regular recibo de sueldo', () => {
    const result = generateReciboFileName(baseRecibo);
    expect(result).toBe('2024-12 - Recibo de Sueldo - Juan Perez.pdf');
  });

  it('generates liquidacion final', () => {
    const recibo: Recibo = { ...baseRecibo, tipoRecibo: 'liquidacion_final' };
    const result = generateReciboFileName(recibo);
    expect(result).toBe('2024-12 - Liquidacion Final - Juan Perez.pdf');
  });

  it('handles name with accents', () => {
    const recibo: Recibo = { ...baseRecibo, nombreEmpleado: 'José García' };
    const result = generateReciboFileName(recibo);
    expect(result).toBe('2024-12 - Recibo de Sueldo - Jose Garcia.pdf');
  });

  it('handles name with special characters', () => {
    const recibo: Recibo = { ...baseRecibo, nombreEmpleado: 'María Pérez-González' };
    const result = generateReciboFileName(recibo);
    expect(result).toBe('2024-12 - Recibo de Sueldo - Maria Perez-Gonzalez.pdf');
  });
});

describe('generateResumenFileName', () => {
  const baseResumen: ResumenBancario = {
    fileId: 'resumen-123',
    fileName: 'original.pdf',
    folderPath: '',
    banco: 'BBVA',
    fechaDesde: '2024-01-01',
    fechaHasta: '2024-01-31',
    saldoInicial: 150000,
    saldoFinal: 185000,
    moneda: 'ARS',
    cantidadMovimientos: 47,
    processedAt: new Date().toISOString(),
    confidence: 0.95,
    needsReview: false,
  };

  it('generates ARS currency resumen', () => {
    const result = generateResumenFileName(baseResumen);
    expect(result).toBe('2024-01 - Resumen Bancario - BBVA.pdf');
  });

  it('generates USD currency resumen', () => {
    const resumenUSD: ResumenBancario = { ...baseResumen, moneda: 'USD' };
    const result = generateResumenFileName(resumenUSD);
    expect(result).toBe('2024-01 - Resumen Bancario USD - BBVA.pdf');
  });

  it('handles bank name with accents', () => {
    const resumen: ResumenBancario = { ...baseResumen, banco: 'Río de la Plata' };
    const result = generateResumenFileName(resumen);
    expect(result).toBe('2024-01 - Resumen Bancario - Rio de la Plata.pdf');
  });
});
