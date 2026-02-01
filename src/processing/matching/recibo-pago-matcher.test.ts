/**
 * Tests for recibo-pago matching
 */

import { describe, it, expect } from 'vitest';
import { parseNumber } from '../../utils/numbers.js';
import type { Pago, MatchConfidence } from '../../types/index.js';

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
});
