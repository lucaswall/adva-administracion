/**
 * Unit tests for Gemini response parser
 * Migrated to Vitest
 */

import { describe, it, expect } from 'vitest';
import {
  parseFacturaResponse,
  parsePagoResponse,
  parseReciboResponse,
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
      puntoVenta: '00001',
      numeroComprobante: '00000123',
      fechaEmision: '2024-01-15',
      cuitEmisor: '20123456786',
      razonSocialEmisor: 'TEST SA',
      cae: '12345678901234',
      fechaVtoCae: '2024-01-25',
      importeNeto: 1000,
      importeIva: 210,
      importeTotal: 1210,
      moneda: 'ARS'
    });

    const result = parseFacturaResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.tipoComprobante).toBe('A');
      expect(result.value.data.importeTotal).toBe(1210);
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('handles markdown-wrapped JSON', () => {
    const json = '```json\n{"tipoComprobante": "B", "puntoVenta": "00002", "numeroComprobante": "00000456", "fechaEmision": "2024-01-15", "cuitEmisor": "20123456786", "razonSocialEmisor": "TEST", "cae": "12345678901234", "fechaVtoCae": "2024-01-25", "importeNeto": 1000, "importeIva": 210, "importeTotal": 1210, "moneda": "ARS"}\n```';

    const result = parseFacturaResponse(json);
    expect(result.ok).toBe(true);
  });

  it('returns error for invalid JSON', () => {
    const result = parseFacturaResponse('not json');
    expect(result.ok).toBe(false);
  });

  it('marks as needs review when missing required fields', () => {
    const json = JSON.stringify({
      tipoComprobante: 'A',
      puntoVenta: '00001'
      // Missing many required fields
    });

    const result = parseFacturaResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsReview).toBe(true);
      expect(result.value.missingFields!.length).toBe(10); // 10 missing required fields
    }
  });

  it('corrects emisor/receptor swap when ADVA is emisor', () => {
    // Simulate case where Gemini incorrectly identifies ADVA as emisor
    const json = JSON.stringify({
      tipoComprobante: 'B',
      puntoVenta: '00004',
      numeroComprobante: '00000024',
      fechaEmision: '2025-11-17',
      cuitEmisor: '30709076783', // ADVA's CUIT (wrong!)
      razonSocialEmisor: 'TEST VENDOR SA', // Correct emisor name
      cuitReceptor: '20444444443', // Real emisor CUIT (swapped)
      cae: '75465275861546',
      fechaVtoCae: '2025-11-27',
      importeNeto: 5750000,
      importeIva: 0,
      importeTotal: 5750000,
      moneda: 'ARS'
    });

    const result = parseFacturaResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should swap the CUITs
      expect(result.value.data.cuitEmisor).toBe('20444444443'); // Real emisor
      expect(result.value.data.cuitReceptor).toBe('30709076783'); // ADVA
      // Should keep the emisor name (it was already correct)
      expect(result.value.data.razonSocialEmisor).toBe('TEST VENDOR SA');
    }
  });

  it('does not swap when ADVA is correctly identified as receptor', () => {
    const json = JSON.stringify({
      tipoComprobante: 'B',
      puntoVenta: '00002',
      numeroComprobante: '00001171',
      fechaEmision: '2025-12-23',
      cuitEmisor: '30555555554', // TEST TRAVEL COMPANY
      razonSocialEmisor: 'TEST TRAVEL COMPANY SRL',
      cuitReceptor: '30709076783', // ADVA (correct!)
      cae: '75513050768065',
      fechaVtoCae: '2026-01-02',
      importeNeto: 6557360,
      importeIva: 0,
      importeTotal: 6557360,
      moneda: 'ARS'
    });

    const result = parseFacturaResponse(json);
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
  it('parses valid pago JSON', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      fechaPago: '2024-01-18',
      importePagado: 1210
    });

    const result = parsePagoResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.banco).toBe('BBVA');
      expect(result.value.data.importePagado).toBe(1210);
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('handles optional fields', () => {
    const json = JSON.stringify({
      banco: 'BBVA',
      fechaPago: '2024-01-18',
      importePagado: 1210,
      referencia: 'TRX123',
      cuitPagador: '20111111119'
    });

    const result = parsePagoResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.referencia).toBe('TRX123');
      expect(result.value.data.cuitPagador).toBe('20111111119');
    }
  });

  it('marks as needs review when missing required fields', () => {
    const json = JSON.stringify({
      banco: 'BBVA'
      // Missing fechaPago and importePagado
    });

    const result = parsePagoResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsReview).toBe(true);
      expect(result.value.missingFields!.length).toBe(2);
    }
  });
});

describe('parseClassificationResponse', () => {
  it('parses valid factura classification', () => {
    const json = JSON.stringify({
      documentType: 'factura',
      confidence: 0.95,
      reason: 'CAE and ARCA text found',
      indicators: ['CAE number', 'ARCA logo', 'Multiple CUITs']
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('factura');
      expect(result.value.confidence).toBe(0.95);
      expect(result.value.reason).toBe('CAE and ARCA text found');
      expect(result.value.indicators.length).toBe(3);
    }
  });

  it('parses valid pago classification', () => {
    const json = JSON.stringify({
      documentType: 'pago',
      confidence: 0.88,
      reason: 'BBVA transfer receipt',
      indicators: ['BBVA logo', 'Reference number', 'Single amount']
    });

    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('pago');
      expect(result.value.confidence).toBe(0.88);
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
    const json = '```json\n{"documentType": "factura", "confidence": 0.9, "reason": "Test", "indicators": []}\n```';
    const result = parseClassificationResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('factura');
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

  it('clamps confidence to valid range', () => {
    const json = JSON.stringify({
      documentType: 'factura',
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
      documentType: 'factura',
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
      documentType: 'pago',
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
