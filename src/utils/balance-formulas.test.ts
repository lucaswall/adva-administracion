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
  calculateBalanceDiff,
  generateBalanceOkFormulaLocal,
} from './balance-formulas.js';
import type { MovimientoBancario } from '../types/index.js';

describe('Balance Formula Utilities', () => {
  describe('generateInitialBalanceRow', () => {
    it('should generate initial balance row with correct format', () => {
      const result = generateInitialBalanceRow(10000, '2025-01');

      expect(result).toEqual([
        null,              // fecha (empty for initial balance)
        'SALDO INICIAL',   // concepto
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
      concepto: 'Transferencia recibida',
      debito: null,
      credito: 5000,
      saldo: 15000,
    };

    // Row indexing with header row:
    // - Row 1 (sheet): Headers
    // - Row 2 (sheet): SALDO INICIAL (array index 0)
    // - Row 3 (sheet): First transaction (array index 1)
    // - Row N+2 (sheet): Transaction at array index N

    it('should generate row with formula in saldoCalculado column (accounts for header)', () => {
      // Array index 2 → Sheet row 4, previous sheet row 3
      const result = generateMovimientoRowWithFormula(mockMovimiento, 2);

      expect(result).toHaveLength(6);
      expect(result[0]).toEqual(mockMovimiento.fecha);
      expect(result[1]).toBe('Transferencia recibida');
      expect(result[2]).toBeNull(); // debito
      expect(result[3]).toBe(5000);  // credito
      expect(result[4]).toBe(15000); // saldo (parsed from PDF)
      // Formula: =F{prev}+D{curr}-C{curr} where prev=3, curr=4
      expect(result[5]).toBe('=F3+D4-C4');
    });

    it('should handle first transaction row (index 1)', () => {
      const result = generateMovimientoRowWithFormula(mockMovimiento, 1);

      // Array index 1 → Sheet row 3, previous sheet row 2 (SALDO INICIAL)
      expect(result[5]).toBe('=F2+D3-C3');
    });

    it('should handle debit transaction', () => {
      const debitMovimiento: MovimientoBancario = {
        fecha: '2025-01-16',
        concepto: 'Pago de servicio',
        debito: 1000,
        credito: null,
        saldo: 14000,
      };

      // Array index 3 → Sheet row 5, previous sheet row 4
      const result = generateMovimientoRowWithFormula(debitMovimiento, 3);

      expect(result[2]).toBe(1000);  // debito
      expect(result[3]).toBeNull();  // credito
      expect(result[5]).toBe('=F4+D5-C5'); // formula
    });

    it('should handle transaction with both debit and credit', () => {
      const bothMovimiento: MovimientoBancario = {
        fecha: '2025-01-17',
        concepto: 'Ajuste bancario',
        debito: 100,
        credito: 50,
        saldo: 13950,
      };

      // Array index 4 → Sheet row 6, previous sheet row 5
      const result = generateMovimientoRowWithFormula(bothMovimiento, 4);

      expect(result[2]).toBe(100);   // debito
      expect(result[3]).toBe(50);    // credito
      expect(result[5]).toBe('=F5+D6-C6'); // formula
    });
  });

  describe('generateFinalBalanceRow', () => {
    // Row indexing with header row:
    // - Last transaction at array index N is at sheet row N + 2
    // - Array index 10 → Sheet row 12

    it('should generate final balance row referencing last transaction (accounts for header)', () => {
      // Last transaction at array index 10 → Sheet row 12
      const result = generateFinalBalanceRow(10);

      expect(result).toEqual([
        null,            // fecha (empty)
        'SALDO FINAL',   // concepto
        null,            // debito (empty)
        null,            // credito (empty)
        null,            // saldo (empty)
        '=F12',          // saldoCalculado (reference to last transaction at sheet row 12)
      ]);
    });

    it('should handle single transaction case', () => {
      // Only one transaction at array index 1 → Sheet row 3
      const result = generateFinalBalanceRow(1);

      expect(result[5]).toBe('=F3');
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

  describe('calculateBalanceDiff', () => {
    it('should return 0 when computed balance matches saldoFinal exactly', () => {
      const movimientos: MovimientoBancario[] = [
        { fecha: '2025-01-15', concepto: 'Credit', debito: null, credito: 5000, saldo: 15000 },
        { fecha: '2025-01-20', concepto: 'Debit', debito: 2000, credito: null, saldo: 13000 },
      ];

      // saldoInicial: 10000 + 5000 - 2000 = 13000
      const diff = calculateBalanceDiff(10000, movimientos, 13000);

      expect(diff).toBe(0);
    });

    it('should return positive diff when computed balance is higher than saldoFinal', () => {
      const movimientos: MovimientoBancario[] = [
        { fecha: '2025-01-15', concepto: 'Credit', debito: null, credito: 5000, saldo: 15000 },
      ];

      // saldoInicial: 10000 + 5000 = 15000, but saldoFinal reported as 14000
      const diff = calculateBalanceDiff(10000, movimientos, 14000);

      expect(diff).toBe(1000);  // computed - reported = 15000 - 14000
    });

    it('should return negative diff when computed balance is lower than saldoFinal', () => {
      const movimientos: MovimientoBancario[] = [
        { fecha: '2025-01-15', concepto: 'Debit', debito: 3000, credito: null, saldo: 7000 },
      ];

      // saldoInicial: 10000 - 3000 = 7000, but saldoFinal reported as 8000
      const diff = calculateBalanceDiff(10000, movimientos, 8000);

      expect(diff).toBe(-1000);  // computed - reported = 7000 - 8000
    });

    it('should handle small rounding differences', () => {
      const movimientos: MovimientoBancario[] = [
        { fecha: '2025-01-15', concepto: 'Credit', debito: null, credito: 100.33, saldo: 10100.33 },
        { fecha: '2025-01-16', concepto: 'Credit', debito: null, credito: 100.33, saldo: 10200.66 },
        { fecha: '2025-01-17', concepto: 'Credit', debito: null, credito: 100.34, saldo: 10301 },
      ];

      // 10000 + 100.33 + 100.33 + 100.34 = 10301.00
      const diff = calculateBalanceDiff(10000, movimientos, 10301);

      expect(diff).toBe(0);
    });

    it('should handle empty movimientos array', () => {
      const diff = calculateBalanceDiff(10000, [], 10000);

      expect(diff).toBe(0);  // No transactions, balance should equal initial
    });

    it('should handle empty movimientos with different saldoFinal', () => {
      const diff = calculateBalanceDiff(10000, [], 9500);

      expect(diff).toBe(500);  // Parsing error: computed (10000) - reported (9500)
    });

    it('should handle transactions with both debit and credit', () => {
      const movimientos: MovimientoBancario[] = [
        { fecha: '2025-01-15', concepto: 'Adjustment', debito: 100, credito: 200, saldo: 10100 },
      ];

      // saldoInicial: 10000 + 200 - 100 = 10100
      const diff = calculateBalanceDiff(10000, movimientos, 10100);

      expect(diff).toBe(0);
    });

    it('should handle null debito/credito values', () => {
      const movimientos: MovimientoBancario[] = [
        { fecha: '2025-01-15', concepto: 'Only credit', debito: null, credito: 500, saldo: 10500 },
        { fecha: '2025-01-16', concepto: 'Only debit', debito: 200, credito: null, saldo: 10300 },
      ];

      // saldoInicial: 10000 + 500 - 200 = 10300
      const diff = calculateBalanceDiff(10000, movimientos, 10300);

      expect(diff).toBe(0);
    });
  });

  describe('generateBalanceOkFormulaLocal', () => {
    it('should generate formula checking if balanceDiff is within tolerance', () => {
      const result = generateBalanceOkFormulaLocal();

      // Uses INDIRECT with ROW() to work regardless of row position after sorting
      expect(result).toBe('=IF(ABS(INDIRECT("L"&ROW()))<0.01,"SI","NO")');
    });
  });
});
