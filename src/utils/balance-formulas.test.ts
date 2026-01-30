/**
 * Tests for balance formula generation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  generateInitialBalanceRow,
  generateMovimientoRowWithFormula,
  generateFinalBalanceRow,
  generateBalanceOkFormula,
  generateBalanceDiffFormula,
} from './balance-formulas.js';
import type { MovimientoBancario } from '../types/index.js';

describe('Balance Formula Utilities', () => {
  describe('generateInitialBalanceRow', () => {
    it('should generate initial balance row with correct format', () => {
      const result = generateInitialBalanceRow(10000, '2025-01');

      expect(result).toEqual([
        null,              // fecha (empty for initial balance)
        'SALDO INICIAL',   // origenConcepto
        null,              // debito (empty)
        null,              // credito (empty)
        null,              // saldo (empty)
        10000,             // saldoCalculado (initial balance value)
      ]);
    });

    it('should handle negative initial balance', () => {
      const result = generateInitialBalanceRow(-500, '2025-01');

      expect(result[5]).toBe(-500);
    });

    it('should handle zero initial balance', () => {
      const result = generateInitialBalanceRow(0, '2025-01');

      expect(result[5]).toBe(0);
    });
  });

  describe('generateMovimientoRowWithFormula', () => {
    const mockMovimiento: MovimientoBancario = {
      fecha: '2025-01-15',
      origenConcepto: 'Transferencia recibida',
      debito: null,
      credito: 5000,
      saldo: 15000,
    };

    it('should generate row with formula in saldoCalculado column', () => {
      // Row 3 means row index 2 (0-based), previous row is index 1 (row 2 in sheet)
      const result = generateMovimientoRowWithFormula(mockMovimiento, 2);

      expect(result).toHaveLength(6);
      expect(result[0]).toEqual(mockMovimiento.fecha);
      expect(result[1]).toBe('Transferencia recibida');
      expect(result[2]).toBeNull(); // debito
      expect(result[3]).toBe(5000);  // credito
      expect(result[4]).toBe(15000); // saldo (parsed from PDF)
      expect(result[5]).toBe('=F2+D3-C3'); // formula: previous saldoCalculado + credito - debito
    });

    it('should handle first transaction row (index 1)', () => {
      const result = generateMovimientoRowWithFormula(mockMovimiento, 1);

      // First transaction references initial balance row (row 1, index 0)
      expect(result[5]).toBe('=F1+D2-C2');
    });

    it('should handle debit transaction', () => {
      const debitMovimiento: MovimientoBancario = {
        fecha: '2025-01-16',
        origenConcepto: 'Pago de servicio',
        debito: 1000,
        credito: null,
        saldo: 14000,
      };

      const result = generateMovimientoRowWithFormula(debitMovimiento, 3);

      expect(result[2]).toBe(1000);  // debito
      expect(result[3]).toBeNull();  // credito
      expect(result[5]).toBe('=F3+D4-C4'); // formula
    });

    it('should handle transaction with both debit and credit', () => {
      const bothMovimiento: MovimientoBancario = {
        fecha: '2025-01-17',
        origenConcepto: 'Ajuste bancario',
        debito: 100,
        credito: 50,
        saldo: 13950,
      };

      const result = generateMovimientoRowWithFormula(bothMovimiento, 4);

      expect(result[2]).toBe(100);   // debito
      expect(result[3]).toBe(50);    // credito
      expect(result[5]).toBe('=F4+D5-C5'); // formula
    });
  });

  describe('generateFinalBalanceRow', () => {
    it('should generate final balance row referencing last transaction', () => {
      // If last transaction is at row index 10 (row 11 in sheet)
      const result = generateFinalBalanceRow(10);

      expect(result).toEqual([
        null,            // fecha (empty)
        'SALDO FINAL',   // origenConcepto
        null,            // debito (empty)
        null,            // credito (empty)
        null,            // saldo (empty)
        '=F11',          // saldoCalculado (reference to last transaction's saldoCalculado)
      ]);
    });

    it('should handle single transaction case', () => {
      // If only one transaction at row index 1 (row 2 in sheet)
      const result = generateFinalBalanceRow(1);

      expect(result[5]).toBe('=F2');
    });
  });

  describe('generateBalanceOkFormula', () => {
    it('should generate formula comparing SALDO FINAL to reported saldoFinal', () => {
      // movimientosSheetId: spreadsheet ID where Movimientos are stored
      // monthSheetName: "2025-01" (sheet tab name)
      // finalRowIndex: 10 (row 11 in sheet has SALDO FINAL)
      // resumenRowIndex: 5 (row 6 in Control Resumenes where this resumen is stored)

      const result = generateBalanceOkFormula(
        '1abc123',
        '2025-01',
        10,   // SALDO FINAL is at row index 10 (F11)
        5     // This resumen is at row index 5 in Control sheet (J6)
      );

      // Formula checks if SALDO FINAL from Movimientos equals saldoFinal from Control
      // Format: =IF(IMPORTRANGE("spreadsheet_id", "sheet_name!F11")=J6,"SI","NO")
      expect(result).toBe('=IF(IMPORTRANGE("1abc123","2025-01!F11")=J6,"SI","NO")');
    });

    it('should handle different row indices', () => {
      const result = generateBalanceOkFormula('xyz789', '2024-12', 20, 15);

      expect(result).toBe('=IF(IMPORTRANGE("xyz789","2024-12!F21")=J16,"SI","NO")');
    });
  });

  describe('generateBalanceDiffFormula', () => {
    it('should generate formula calculating difference', () => {
      // Difference = SALDO FINAL (computed) - saldoFinal (reported)
      const result = generateBalanceDiffFormula(
        '1abc123',
        '2025-01',
        10,   // SALDO FINAL is at row index 10 (F11)
        5     // This resumen is at row index 5 in Control sheet (J6)
      );

      // Format: =IMPORTRANGE("spreadsheet_id", "sheet_name!F11")-J6
      expect(result).toBe('=IMPORTRANGE("1abc123","2025-01!F11")-J6');
    });

    it('should handle different row indices', () => {
      const result = generateBalanceDiffFormula('xyz789', '2024-12', 20, 15);

      expect(result).toBe('=IMPORTRANGE("xyz789","2024-12!F21")-J16');
    });
  });
});
