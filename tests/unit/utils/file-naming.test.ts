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
    cuitEmisor: '20123456786',
    razonSocialEmisor: 'TEST SA',
    cae: '12345678901234',
    importeNeto: 1000,
    importeIva: 210,
    importeTotal: 1210,
    moneda: 'ARS',
    processedAt: new Date().toISOString(),
    confidence: 0.95,
    needsReview: false,
  };

  it('generates factura_emitida file name', () => {
    const result = generateFacturaFileName(baseFactura, 'factura_emitida');
    expect(result).toBe('FacturaEmitida_00001-00001234_20123456786_2024-01-15.pdf');
  });

  it('generates factura_recibida file name', () => {
    const result = generateFacturaFileName(baseFactura, 'factura_recibida');
    expect(result).toBe('FacturaRecibida_00001-00001234_20123456786_2024-01-15.pdf');
  });

  it('handles nota de credito type', () => {
    const notaCredito: Factura = { ...baseFactura, tipoComprobante: 'NC' };
    const result = generateFacturaFileName(notaCredito, 'factura_recibida');
    expect(result).toBe('NotaCreditoRecibida_00001-00001234_20123456786_2024-01-15.pdf');
  });

  it('handles nota de debito type', () => {
    const notaDebito: Factura = { ...baseFactura, tipoComprobante: 'ND' };
    const result = generateFacturaFileName(notaDebito, 'factura_emitida');
    expect(result).toBe('NotaDebitoEmitida_00001-00001234_20123456786_2024-01-15.pdf');
  });

  it('handles different comprobante types (B, C)', () => {
    const facturaB: Factura = { ...baseFactura, tipoComprobante: 'B' };
    expect(generateFacturaFileName(facturaB, 'factura_recibida'))
      .toBe('FacturaRecibida_00001-00001234_20123456786_2024-01-15.pdf');

    const facturaC: Factura = { ...baseFactura, tipoComprobante: 'C' };
    expect(generateFacturaFileName(facturaC, 'factura_emitida'))
      .toBe('FacturaEmitida_00001-00001234_20123456786_2024-01-15.pdf');
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
    processedAt: new Date().toISOString(),
    confidence: 0.9,
    needsReview: false,
  };

  it('generates pago_enviado file name', () => {
    const result = generatePagoFileName(basePago, 'pago_enviado');
    expect(result).toBe('PagoEnviado_BBVA_2024-01-18_1210.50.pdf');
  });

  it('generates pago_recibido file name', () => {
    const result = generatePagoFileName(basePago, 'pago_recibido');
    expect(result).toBe('PagoRecibido_BBVA_2024-01-18_1210.50.pdf');
  });

  it('handles whole number amounts', () => {
    const pago: Pago = { ...basePago, importePagado: 5000 };
    const result = generatePagoFileName(pago, 'pago_enviado');
    expect(result).toBe('PagoEnviado_BBVA_2024-01-18_5000.00.pdf');
  });

  it('handles large amounts', () => {
    const pago: Pago = { ...basePago, importePagado: 2917310.00 };
    const result = generatePagoFileName(pago, 'pago_enviado');
    expect(result).toBe('PagoEnviado_BBVA_2024-01-18_2917310.00.pdf');
  });

  it('handles different banks', () => {
    const pagoGalicia: Pago = { ...basePago, banco: 'Galicia' };
    expect(generatePagoFileName(pagoGalicia, 'pago_enviado'))
      .toBe('PagoEnviado_Galicia_2024-01-18_1210.50.pdf');

    const pagoSantander: Pago = { ...basePago, banco: 'Santander' };
    expect(generatePagoFileName(pagoSantander, 'pago_recibido'))
      .toBe('PagoRecibido_Santander_2024-01-18_1210.50.pdf');
  });
});

describe('generateReciboFileName', () => {
  const baseRecibo: Recibo = {
    fileId: 'recibo-123',
    fileName: 'original.pdf',
    folderPath: '',
    tipoRecibo: 'sueldo',
    nombreEmpleado: 'Juan Pérez',
    cuilEmpleado: '20123456786',
    legajo: '001',
    cuitEmpleador: '30709076783',
    periodoAbonado: 'diciembre/2024',
    fechaPago: '2025-01-05',
    subtotalRemuneraciones: 500000,
    subtotalDescuentos: 85000,
    totalNeto: 415000,
    processedAt: new Date().toISOString(),
    confidence: 0.95,
    needsReview: false,
  };

  it('generates recibo file name with sanitized employee name', () => {
    const result = generateReciboFileName(baseRecibo);
    expect(result).toBe('Recibo_JuanPerez_diciembre2024.pdf');
  });

  it('handles employee name with multiple parts', () => {
    const recibo: Recibo = { ...baseRecibo, nombreEmpleado: 'MARTIN, Miguel Angel' };
    const result = generateReciboFileName(recibo);
    expect(result).toBe('Recibo_MARTINMiguelAngel_diciembre2024.pdf');
  });

  it('handles period with slash format', () => {
    const recibo: Recibo = { ...baseRecibo, periodoAbonado: 'noviembre/2024' };
    const result = generateReciboFileName(recibo);
    expect(result).toBe('Recibo_JuanPerez_noviembre2024.pdf');
  });

  it('handles period with different format', () => {
    const recibo: Recibo = { ...baseRecibo, periodoAbonado: '12/2024' };
    const result = generateReciboFileName(recibo);
    expect(result).toBe('Recibo_JuanPerez_122024.pdf');
  });

  it('handles liquidacion final type', () => {
    const recibo: Recibo = { ...baseRecibo, tipoRecibo: 'liquidacion_final' };
    const result = generateReciboFileName(recibo);
    expect(result).toBe('LiquidacionFinal_JuanPerez_diciembre2024.pdf');
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

  it('generates resumen file name', () => {
    const result = generateResumenFileName(baseResumen);
    expect(result).toBe('Resumen_BBVA_2024-01-01_a_2024-01-31.pdf');
  });

  it('handles different banks', () => {
    const resumenGalicia: ResumenBancario = { ...baseResumen, banco: 'Galicia' };
    expect(generateResumenFileName(resumenGalicia))
      .toBe('Resumen_Galicia_2024-01-01_a_2024-01-31.pdf');
  });

  it('handles different date ranges', () => {
    const resumen: ResumenBancario = {
      ...baseResumen,
      fechaDesde: '2024-06-01',
      fechaHasta: '2024-06-30',
    };
    expect(generateResumenFileName(resumen))
      .toBe('Resumen_BBVA_2024-06-01_a_2024-06-30.pdf');
  });

  it('handles USD currency', () => {
    const resumenUSD: ResumenBancario = { ...baseResumen, moneda: 'USD' };
    expect(generateResumenFileName(resumenUSD))
      .toBe('Resumen_BBVA_2024-01-01_a_2024-01-31_USD.pdf');
  });
});
