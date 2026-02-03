/**
 * Tests for recibo-pago matching
 */

import { describe, it, expect } from 'vitest';
import { parseNumber } from '../../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import type { Pago, Recibo, MatchConfidence } from '../../types/index.js';

describe('recibo-pago-matcher', () => {
  describe('Bug #1: CUIT field assignment', () => {
    it('should parse pagos with correct cuitPagador from column H', () => {
      // Test data simulating a row from Pagos Enviados sheet
      // Columns: A:fechaPago, B:fileId, C:fileName, D:banco, E:importePagado
      //          F:moneda, G:referencia, H:cuitPagador, I:nombrePagador
      //          J:concepto, K:processedAt, L:confidence, M:needsReview
      //          N:matchedFacturaFileId, O:matchConfidence
      const row = [
        '2025-01-15',               // A: fechaPago
        'pago-file-id-123',         // B: fileId
        'Pago Empleado.pdf',        // C: fileName
        'BBVA',                     // D: banco
        100000,                     // E: importePagado
        'ARS',                      // F: moneda
        'Ref-123',                  // G: referencia
        '30709076783',              // H: cuitPagador (ADVA)
        'ADVA SA',                  // I: nombrePagador
        'Pago de sueldo',           // J: concepto
        '2025-01-15T10:00:00.000Z', // K: processedAt
        95,                         // L: confidence
        'NO',                       // M: needsReview
        '',                         // N: matchedFacturaFileId
        '',                         // O: matchConfidence
      ];

      // Parse the pago using the same logic as in recibo-pago-matcher.ts
      const pago: Pago & { row: number } = {
        row: 2,
        fechaPago: String(row[0] || ''),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        banco: String(row[3] || ''),
        importePagado: parseNumber(row[4]) || 0,
        moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[6] ? String(row[6]) : undefined,
        cuitPagador: row[7] ? String(row[7]) : undefined,
        nombrePagador: row[8] ? String(row[8]) : undefined,
        concepto: row[9] ? String(row[9]) : undefined,
        processedAt: String(row[10] || ''),
        confidence: Number(row[11]) || 0,
        needsReview: row[12] === 'YES',
        matchedFacturaFileId: row[13] ? String(row[13]) : undefined,
        matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined,
      };

      // Verify correct parsing
      expect(pago.cuitPagador).toBe('30709076783');
      expect(pago.nombrePagador).toBe('ADVA SA');
      expect(pago.fileId).toBe('pago-file-id-123');

      // Verify that cuitBeneficiario and nombreBeneficiario are NOT set
      // The Pago type may have these fields, but they should not be populated
      // from the Pagos Enviados sheet - they come from matched Recibo
      expect('cuitBeneficiario' in pago).toBe(false);
      expect('nombreBeneficiario' in pago).toBe(false);
    });
  });

  describe('Date serial number normalization', () => {
    it('should normalize serial number dates in recibo fechaPago', () => {
      // Simulate how recibo-pago-matcher.ts parses recibos (line ~259)
      const row = [
        45671,                        // A: fechaPago (serial number => '2025-01-14')
        'recibo-file-id',             // B: fileId
        'recibo.pdf',                 // C: fileName
        'sueldo',                     // D: tipoRecibo
        'Juan Perez',                 // E: nombreEmpleado
        '20123456786',                // F: cuilEmpleado
        '001',                        // G: legajo
        'Programador',                // H: tareaDesempenada
        '30709076783',                // I: cuitEmpleador
        '2025-01',                    // J: periodoAbonado
        100000,                       // K: subtotalRemuneraciones
        20000,                        // L: subtotalDescuentos
        80000,                        // M: totalNeto
        '2025-01-15T10:00:00.000Z',   // N: processedAt
        95,                           // O: confidence
        'NO',                         // P: needsReview
        '',                           // Q: matchedPagoFileId
        '',                           // R: matchConfidence
      ];

      // This is the pattern that should be used (normalizeSpreadsheetDate)
      const recibo: Recibo & { row: number } = {
        row: 2,
        fechaPago: normalizeSpreadsheetDate(row[0]),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        tipoRecibo: (row[3] || 'sueldo') as Recibo['tipoRecibo'],
        nombreEmpleado: String(row[4] || ''),
        cuilEmpleado: String(row[5] || ''),
        legajo: String(row[6] || ''),
        tareaDesempenada: row[7] ? String(row[7]) : undefined,
        cuitEmpleador: String(row[8] || ''),
        periodoAbonado: String(row[9] || ''),
        subtotalRemuneraciones: parseNumber(row[10]) || 0,
        subtotalDescuentos: parseNumber(row[11]) || 0,
        totalNeto: parseNumber(row[12]) || 0,
        processedAt: String(row[13] || ''),
        confidence: Number(row[14]) || 0,
        needsReview: row[15] === 'YES',
        matchedPagoFileId: row[16] ? String(row[16]) : undefined,
        matchConfidence: row[17] ? (String(row[17]) as MatchConfidence) : undefined,
      };

      // Serial number 45671 => '2025-01-14'
      expect(recibo.fechaPago).toBe('2025-01-14');
    });

    it('should normalize serial number dates in pago fechaPago', () => {
      // Simulate how recibo-pago-matcher.ts parses pagos (line ~288)
      const row = [
        45671,                        // A: fechaPago (serial number => '2025-01-14')
        'pago-file-id',               // B: fileId
        'pago.pdf',                   // C: fileName
        'BBVA',                       // D: banco
        80000,                        // E: importePagado
        'ARS',                        // F: moneda
        'REF-001',                    // G: referencia
        '30709076783',                // H: cuitPagador
        'ADVA SA',                    // I: nombrePagador
        'Pago sueldo',                // J: concepto
        '2025-01-15T10:00:00.000Z',   // K: processedAt
        95,                           // L: confidence
        'NO',                         // M: needsReview
        '',                           // N: matchedFacturaFileId
        '',                           // O: matchConfidence
      ];

      const pago: Pago & { row: number } = {
        row: 2,
        fechaPago: normalizeSpreadsheetDate(row[0]),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        banco: String(row[3] || ''),
        importePagado: parseNumber(row[4]) || 0,
        moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[6] ? String(row[6]) : undefined,
        cuitPagador: row[7] ? String(row[7]) : undefined,
        nombrePagador: row[8] ? String(row[8]) : undefined,
        concepto: row[9] ? String(row[9]) : undefined,
        processedAt: String(row[10] || ''),
        confidence: Number(row[11]) || 0,
        needsReview: row[12] === 'YES',
        matchedFacturaFileId: row[13] ? String(row[13]) : undefined,
        matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined,
      };

      // Serial number 45671 => '2025-01-14'
      expect(pago.fechaPago).toBe('2025-01-14');
    });
  });
});
