/**
 * Unit tests for Gemini response parser
 * Migrated to Vitest
 */

import { describe, it, expect } from 'vitest';
import {
  parseFacturaResponse,
  parsePagoResponse,
  parseReciboResponse,
  parseResumenBancarioResponse,
  parseClassificationResponse,
  extractJSON
} from '../../src/gemini/parser';

describe('extractJSON', () => {
  it('extracts clean JSON', () => {
    const input = '{"field": "value"}';
    const result = extractJSON(input);
    expect(result).toBe('{"field": "value"}');
  });

  it('extracts JSON wrapped in markdown code block', () => {
    const input = '```json\n{"field": "value"}\n```';
    const result = extractJSON(input);
    expect(result).toBe('{"field": "value"}');
  });

  it('extracts JSON with markdown code block without json label', () => {
    const input = '```\n{"field": "value"}\n```';
    const result = extractJSON(input);
    expect(result).toBe('{"field": "value"}');
  });

  it('handles JSON with whitespace', () => {
    const input = '  \n  {"field": "value"}  \n  ';
    const result = extractJSON(input);
    expect(result).toBe('{"field": "value"}');
  });

  it('returns empty string for no JSON found', () => {
    const input = 'no json here';
    const result = extractJSON(input);
    expect(result).toBe('');
  });
});

describe('parseFacturaResponse', () => {
  it('parses valid factura JSON', () => {
    const json = JSON.stringify({
      tipoComprobante: 'A',
      nroFactura: '00001-00000123',
      fechaEmision: '2024-01-15',
      cuitEmisor: '20123456786',
      razonSocialEmisor: 'TEST SA',
      cuitReceptor: '30709076783', // ADVA as receptor
      importeNeto: 1000,
      importeIva: 210,
      importeTotal: 1210,
      moneda: 'ARS'
    });

    const result = parseFacturaResponse(json, 'factura_recibida');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.tipoComprobante).toBe('A');
      expect(result.value.data.importeTotal).toBe(1210);
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('handles markdown-wrapped JSON', () => {
    const json = '```json\n{"tipoComprobante": "B", "nroFactura": "00002-00000456", "fechaEmision": "2024-01-15", "cuitEmisor": "20123456786", "razonSocialEmisor": "TEST", "cuitReceptor": "30709076783", "importeNeto": 1000, "importeIva": 210, "importeTotal": 1210, "moneda": "ARS"}\n```';

    const result = parseFacturaResponse(json, 'factura_recibida');
    expect(result.ok).toBe(true);
  });

  it('returns error for invalid JSON', () => {
    const result = parseFacturaResponse('not json', 'factura_recibida');
    expect(result.ok).toBe(false);
  });

  it('marks as needs review when missing required fields', () => {
    const json = JSON.stringify({
      tipoComprobante: 'A',
      nroFactura: '00001-00000001',
      cuitEmisor: '20123456786', // Add counterparty CUIT so validation passes
      cuitReceptor: '30709076783' // ADVA as receptor
      // Missing other required fields (fechaEmision, razonSocialEmisor, amounts, moneda)
    });

    const result = parseFacturaResponse(json, 'factura_recibida');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsReview).toBe(true);
      expect(result.value.missingFields!.length).toBe(6); // 6 missing required fields
    }
  });

  it('does not swap when ADVA is correctly identified as receptor', () => {
    const json = JSON.stringify({
      tipoComprobante: 'B',
      nroFactura: '00002-00001171',
      fechaEmision: '2025-12-23',
      cuitEmisor: '30555555554', // TEST TRAVEL COMPANY
      razonSocialEmisor: 'TEST TRAVEL COMPANY SRL',
      cuitReceptor: '30709076783', // ADVA (correct!)
      importeNeto: 6557360,
      importeIva: 0,
      importeTotal: 6557360,
      moneda: 'ARS'
    });

    const result = parseFacturaResponse(json, 'factura_recibida');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should NOT swap - everything is correct
      expect(result.value.data.cuitEmisor).toBe('30555555554');
      expect(result.value.data.cuitReceptor).toBe('30709076783');
      expect(result.value.data.razonSocialEmisor).toBe('TEST TRAVEL COMPANY SRL');
    }
  });
});

describe('parsePagoResponse', () => {
  it('parses valid pago JSON with moneda', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      fechaPago: '2024-01-18',
      importePagado: 1210,
      moneda: 'ARS'
    });

    const result = parsePagoResponse(json, 'pago_recibido');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.banco).toBe('BBVA');
      expect(result.value.data.importePagado).toBe(1210);
      expect(result.value.data.moneda).toBe('ARS');
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('parses valid pago JSON with USD moneda', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      fechaPago: '2024-01-18',
      importePagado: 500,
      moneda: 'USD'
    });

    const result = parsePagoResponse(json, 'pago_recibido');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.banco).toBe('BBVA');
      expect(result.value.data.importePagado).toBe(500);
      expect(result.value.data.moneda).toBe('USD');
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('handles optional fields', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      fechaPago: '2024-01-18',
      importePagado: 1210,
      moneda: 'ARS',
      referencia: 'TRX123',
      cuitPagador: '20111111119'
    });

    const result = parsePagoResponse(json, 'pago_recibido');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.referencia).toBe('TRX123');
      expect(result.value.data.cuitPagador).toBe('20111111119');
      expect(result.value.data.moneda).toBe('ARS');
    }
  });

  it('marks as needs review when missing required fields including moneda', () => {
    const json = JSON.stringify({
      banco: 'BBVA'
      // Missing fechaPago, importePagado, and moneda
    });

    const result = parsePagoResponse(json, 'pago_recibido');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsReview).toBe(true);
      expect(result.value.missingFields!.length).toBe(3); // banco, fechaPago, importePagado, moneda
    }
  });

  it('marks as needs review when moneda is missing', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      fechaPago: '2024-01-18',
      importePagado: 1210
      // Missing moneda
    });

    const result = parsePagoResponse(json, 'pago_recibido');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsReview).toBe(true);
      expect(result.value.missingFields).toContain('moneda');
    }
  });
});

describe('parseClassificationResponse', () => {
  it('parses valid factura_emitida classification', () => {
    const json = JSON.stringify({
      documentType: 'factura_emitida',
      confidence: 0.95,
      reason: 'CAE and ARCA text found, ADVA is emisor',
      indicators: ['CAE number', 'ARCA logo', 'ADVA as emisor']
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('factura_emitida');
      expect(result.value.confidence).toBe(0.95);
      expect(result.value.reason).toBe('CAE and ARCA text found, ADVA is emisor');
      expect(result.value.indicators.length).toBe(3);
    }
  });

  it('parses valid factura_recibida classification', () => {
    const json = JSON.stringify({
      documentType: 'factura_recibida',
      confidence: 0.92,
      reason: 'CAE and ARCA text found, ADVA is receptor',
      indicators: ['CAE number', 'ARCA logo', 'ADVA as receptor']
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('factura_recibida');
      expect(result.value.confidence).toBe(0.92);
    }
  });

  it('parses valid pago_enviado classification', () => {
    const json = JSON.stringify({
      documentType: 'pago_enviado',
      confidence: 0.88,
      reason: 'BBVA transfer receipt, ADVA is ordenante',
      indicators: ['BBVA logo', 'Reference number', 'ADVA as payer']
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('pago_enviado');
      expect(result.value.confidence).toBe(0.88);
    }
  });

  it('parses valid pago_recibido classification', () => {
    const json = JSON.stringify({
      documentType: 'pago_recibido',
      confidence: 0.85,
      reason: 'Payment receipt, ADVA is beneficiario',
      indicators: ['Bank transfer', 'ADVA as beneficiary']
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('pago_recibido');
      expect(result.value.confidence).toBe(0.85);
    }
  });

  it('parses valid resumen_bancario classification', () => {
    const json = JSON.stringify({
      documentType: 'resumen_bancario',
      confidence: 0.90,
      reason: 'Bank statement with date range and balances',
      indicators: ['Date range', 'Opening balance', 'Closing balance']
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('resumen_bancario');
      expect(result.value.confidence).toBe(0.90);
    }
  });

  it('parses unrecognized classification', () => {
    const json = JSON.stringify({
      documentType: 'unrecognized',
      confidence: 0.4,
      reason: 'Document appears to be a contract',
      indicators: ['No CAE', 'No bank info']
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('unrecognized');
      expect(result.value.confidence).toBe(0.4);
    }
  });

  it('handles markdown-wrapped JSON', () => {
    const json = '```json\n{"documentType": "factura_recibida", "confidence": 0.9, "reason": "Test", "indicators": []}\n```';
    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('factura_recibida');
    }
  });

  it('returns error for invalid documentType', () => {
    const json = JSON.stringify({
      documentType: 'invalid',
      confidence: 0.5,
      reason: 'Test',
      indicators: []
    });
    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(false);
  });

  it('returns error for old documentType factura', () => {
    const json = JSON.stringify({
      documentType: 'factura',
      confidence: 0.5,
      reason: 'Test',
      indicators: []
    });
    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(false);
  });

  it('returns error for old documentType pago', () => {
    const json = JSON.stringify({
      documentType: 'pago',
      confidence: 0.5,
      reason: 'Test',
      indicators: []
    });
    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(false);
  });

  it('clamps confidence to valid range', () => {
    const json = JSON.stringify({
      documentType: 'factura_emitida',
      confidence: 1.5, // Out of range
      reason: 'Test',
      indicators: []
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence).toBe(1); // Should be clamped to 1
    }
  });

  it('uses default confidence if not provided', () => {
    const json = JSON.stringify({
      documentType: 'factura_recibida',
      reason: 'Test',
      indicators: []
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence).toBe(0.5); // Default
    }
  });

  it('handles missing optional fields gracefully', () => {
    const json = JSON.stringify({
      documentType: 'pago_enviado',
      confidence: 0.7
      // Missing reason and indicators
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reason).toBe('No reason provided');
      expect(result.value.indicators.length).toBe(0);
    }
  });
});

describe('parseReciboResponse', () => {
  it('parses valid recibo JSON', () => {
    const json = JSON.stringify({
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Pérez',
      cuilEmpleado: '20123456786',
      legajo: '001',
      cuitEmpleador: '30709076783',
      periodoAbonado: 'diciembre/2024',
      fechaPago: '2025-01-05',
      subtotalRemuneraciones: 500000,
      subtotalDescuentos: 85000,
      totalNeto: 415000
    });

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.tipoRecibo).toBe('sueldo');
      expect(result.value.data.nombreEmpleado).toBe('Juan Pérez');
      expect(result.value.data.totalNeto).toBe(415000);
      expect(result.value.needsReview).toBe(false);
      expect(result.value.confidence).toBeGreaterThan(0.9);
    }
  });

  it('handles markdown-wrapped JSON', () => {
    const json = '```json\n{"tipoRecibo": "liquidacion_final", "nombreEmpleado": "María García", "cuilEmpleado": "27234567891", "legajo": "002", "cuitEmpleador": "30709076783", "periodoAbonado": "noviembre/2024", "fechaPago": "2024-12-01", "subtotalRemuneraciones": 800000, "subtotalDescuentos": 140000, "totalNeto": 660000}\n```';

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.tipoRecibo).toBe('liquidacion_final');
    }
  });

  it('returns error for invalid JSON', () => {
    const result = parseReciboResponse('not json');
    expect(result.ok).toBe(false);
  });

  it('marks as needs review when missing required fields', () => {
    const json = JSON.stringify({
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Pérez'
      // Missing many required fields
    });

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsReview).toBe(true);
      expect(result.value.missingFields!.length).toBe(8); // 8 missing required fields
      expect(result.value.confidence).toBeLessThanOrEqual(0.9);
    }
  });

  it('handles optional fields correctly', () => {
    const json = JSON.stringify({
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
      tareaDesempenada: 'Desarrollador'
    });

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.tareaDesempenada).toBe('Desarrollador');
    }
  });

  it('converts empty strings in optional fields to undefined', () => {
    const json = JSON.stringify({
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
      tareaDesempenada: '' // Empty string
    });

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.tareaDesempenada).toBeUndefined();
      // needsReview requires confidence <= 0.9 AND (missing fields OR suspicious empty fields)
      // Since all required fields are present (confidence = 1.0), needsReview will be false
      // even though there's a suspicious empty field
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('calculates confidence based on completeness', () => {
    // All 10 required fields present
    const completeJson = JSON.stringify({
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Pérez',
      cuilEmpleado: '20123456786',
      legajo: '001',
      cuitEmpleador: '30709076783',
      periodoAbonado: 'diciembre/2024',
      fechaPago: '2025-01-05',
      subtotalRemuneraciones: 500000,
      subtotalDescuentos: 85000,
      totalNeto: 415000
    });

    const completeResult = parseReciboResponse(completeJson);
    expect(completeResult.ok).toBe(true);
    if (completeResult.ok) {
      expect(completeResult.value.confidence).toBe(1.0); // 10/10 = 1.0
    }

    // 5 required fields present out of 10
    const halfJson = JSON.stringify({
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Pérez',
      cuilEmpleado: '20123456786',
      legajo: '001',
      cuitEmpleador: '30709076783'
      // Missing 5 fields
    });

    const halfResult = parseReciboResponse(halfJson);
    expect(halfResult.ok).toBe(true);
    if (halfResult.ok) {
      expect(halfResult.value.confidence).toBe(0.5); // 5/10 = 0.5
    }
  });

  it('sets needsReview to false for high confidence (>0.9)', () => {
    const json = JSON.stringify({
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Pérez',
      cuilEmpleado: '20123456786',
      legajo: '001',
      cuitEmpleador: '30709076783',
      periodoAbonado: 'diciembre/2024',
      fechaPago: '2025-01-05',
      subtotalRemuneraciones: 500000,
      subtotalDescuentos: 85000,
      totalNeto: 415000
    });

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence).toBeGreaterThan(0.9);
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('sets needsReview to true for low confidence (<=0.9)', () => {
    const json = JSON.stringify({
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Pérez',
      cuilEmpleado: '20123456786',
      legajo: '001',
      cuitEmpleador: '30709076783'
      // Missing 5 fields -> confidence = 0.5
    });

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence).toBeLessThanOrEqual(0.9);
      expect(result.value.needsReview).toBe(true);
    }
  });

  it('handles missing tipoRecibo', () => {
    const json = JSON.stringify({
      nombreEmpleado: 'Juan Pérez',
      cuilEmpleado: '20123456786',
      legajo: '001',
      cuitEmpleador: '30709076783',
      periodoAbonado: 'diciembre/2024',
      fechaPago: '2025-01-05',
      subtotalRemuneraciones: 500000,
      subtotalDescuentos: 85000,
      totalNeto: 415000
    });

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.missingFields).toContain('tipoRecibo');
      expect(result.value.needsReview).toBe(true);
    }
  });

  it('handles zero values for amounts', () => {
    const json = JSON.stringify({
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Pérez',
      cuilEmpleado: '20123456786',
      legajo: '001',
      cuitEmpleador: '30709076783',
      periodoAbonado: 'diciembre/2024',
      fechaPago: '2025-01-05',
      subtotalRemuneraciones: 0,
      subtotalDescuentos: 0,
      totalNeto: 0
    });

    const result = parseReciboResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.subtotalRemuneraciones).toBe(0);
      expect(result.value.data.subtotalDescuentos).toBe(0);
      expect(result.value.data.totalNeto).toBe(0);
      expect(result.value.needsReview).toBe(false); // All required fields present
    }
  });
});

describe('parseResumenBancarioResponse', () => {
  it('parses valid resumen bancario JSON', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2024-01-01',
      fechaHasta: '2024-01-31',
      saldoInicial: 150000,
      saldoFinal: 185000,
      moneda: 'ARS',
      cantidadMovimientos: 47
    });

    const result = parseResumenBancarioResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.banco).toBe('BBVA');
      expect(result.value.data.numeroCuenta).toBe('1234567890');
      expect(result.value.data.fechaDesde).toBe('2024-01-01');
      expect(result.value.data.fechaHasta).toBe('2024-01-31');
      expect(result.value.data.saldoInicial).toBe(150000);
      expect(result.value.data.saldoFinal).toBe(185000);
      expect(result.value.data.moneda).toBe('ARS');
      expect(result.value.data.cantidadMovimientos).toBe(47);
      expect(result.value.needsReview).toBe(false);
      expect(result.value.confidence).toBe(1.0);
    }
  });

  it('handles markdown-wrapped JSON', () => {
    const json = '```json\n{"banco": "Galicia", "numeroCuenta": "9876543210", "fechaDesde": "2024-02-01", "fechaHasta": "2024-02-29", "saldoInicial": 50000, "saldoFinal": 75000, "moneda": "ARS", "cantidadMovimientos": 23}\n```';

    const result = parseResumenBancarioResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.banco).toBe('Galicia');
      expect(result.value.data.numeroCuenta).toBe('9876543210');
    }
  });

  it('returns error for invalid JSON', () => {
    const result = parseResumenBancarioResponse('not json');
    expect(result.ok).toBe(false);
  });

  it('marks as needs review when missing required fields', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      fechaDesde: '2024-01-01'
      // Missing many required fields
    });

    const result = parseResumenBancarioResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsReview).toBe(true);
      expect(result.value.missingFields!.length).toBe(6); // 6 missing required fields (now including numeroCuenta)
    }
  });

  it('handles negative balances', () => {
    const json = JSON.stringify({
      banco: 'Santander',
      numeroCuenta: 'VISA',
      fechaDesde: '2024-03-01',
      fechaHasta: '2024-03-31',
      saldoInicial: -50000,
      saldoFinal: -25000,
      moneda: 'ARS',
      cantidadMovimientos: 15
    });

    const result = parseResumenBancarioResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.saldoInicial).toBe(-50000);
      expect(result.value.data.saldoFinal).toBe(-25000);
    }
  });

  it('handles USD currency', () => {
    const json = JSON.stringify({
      banco: 'HSBC',
      numeroCuenta: '5555666677778888',
      fechaDesde: '2024-01-01',
      fechaHasta: '2024-01-31',
      saldoInicial: 10000,
      saldoFinal: 12500,
      moneda: 'USD',
      cantidadMovimientos: 5
    });

    const result = parseResumenBancarioResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.moneda).toBe('USD');
    }
  });

  it('handles zero movements', () => {
    const json = JSON.stringify({
      banco: 'Macro',
      numeroCuenta: '0123456789',
      fechaDesde: '2024-04-01',
      fechaHasta: '2024-04-30',
      saldoInicial: 100000,
      saldoFinal: 100000,
      moneda: 'ARS',
      cantidadMovimientos: 0
    });

    const result = parseResumenBancarioResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.cantidadMovimientos).toBe(0);
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('calculates confidence based on completeness', () => {
    // All 8 required fields present
    const completeJson = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2024-01-01',
      fechaHasta: '2024-01-31',
      saldoInicial: 150000,
      saldoFinal: 185000,
      moneda: 'ARS',
      cantidadMovimientos: 47
    });

    const completeResult = parseResumenBancarioResponse(completeJson);
    expect(completeResult.ok).toBe(true);
    if (completeResult.ok) {
      expect(completeResult.value.confidence).toBe(1.0); // 8/8 = 1.0
    }

    // Only 2 required fields present out of 8
    const partialJson = JSON.stringify({
      banco: 'BBVA',
      fechaDesde: '2024-01-01'
      // Missing 6 fields
    });

    const partialResult = parseResumenBancarioResponse(partialJson);
    expect(partialResult.ok).toBe(true);
    if (partialResult.ok) {
      // 2/8 = 0.25, but minimum is 0.5
      expect(partialResult.value.confidence).toBe(0.5);
    }
  });

  it('sets needsReview to false for high confidence (>0.9)', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2024-01-01',
      fechaHasta: '2024-01-31',
      saldoInicial: 150000,
      saldoFinal: 185000,
      moneda: 'ARS',
      cantidadMovimientos: 47
    });

    const result = parseResumenBancarioResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence).toBeGreaterThan(0.9);
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('sets needsReview to true for low confidence (<=0.9)', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      fechaDesde: '2024-01-01',
      fechaHasta: '2024-01-31'
      // Missing 5 fields -> confidence = 3/8 = 0.375, clamped to 0.5
    });

    const result = parseResumenBancarioResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence).toBeLessThanOrEqual(0.9);
      expect(result.value.needsReview).toBe(true);
    }
  });
});
