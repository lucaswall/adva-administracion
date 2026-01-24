/**
 * Tests for spreadsheet headers constants
 */

import { describe, it, expect } from 'vitest';
import {
  STATUS_HEADERS,
  STATUS_SHEET,
  DASHBOARD_OPERATIVO_SHEETS,
  MOVIMIENTOS_BANCARIO_SHEET,
  MOVIMIENTOS_TARJETA_SHEET,
  MOVIMIENTOS_BROKER_SHEET,
} from './spreadsheet-headers.js';

describe('Status Sheet Headers', () => {
  describe('STATUS_HEADERS', () => {
    it('should have Metrica and Valor columns', () => {
      expect(STATUS_HEADERS).toEqual(['Metrica', 'Valor']);
    });

    it('should have exactly 2 headers', () => {
      expect(STATUS_HEADERS).toHaveLength(2);
    });
  });

  describe('STATUS_SHEET', () => {
    it('should have correct title', () => {
      expect(STATUS_SHEET.title).toBe('Status');
    });

    it('should have STATUS_HEADERS as headers', () => {
      expect(STATUS_SHEET.headers).toEqual(STATUS_HEADERS);
    });
  });

  describe('DASHBOARD_OPERATIVO_SHEETS', () => {
    it('should include Status sheet', () => {
      const statusSheet = DASHBOARD_OPERATIVO_SHEETS.find(
        s => s.title === 'Status'
      );
      expect(statusSheet).toBeDefined();
      expect(statusSheet?.headers).toEqual(['Metrica', 'Valor']);
    });
  });
});

describe('Movimientos Sheet Headers', () => {
  describe('MOVIMIENTOS_BANCARIO_SHEET', () => {
    it('should have correct title', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.title).toBe('Movimientos');
    });

    it('should have 5 headers in correct order', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.headers).toEqual([
        'fecha',
        'origenConcepto',
        'debito',
        'credito',
        'saldo',
      ]);
    });

    it('should have date format for fecha column', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.numberFormats?.get(0)).toEqual({ type: 'date' });
    });

    it('should have currency format for monetary columns', () => {
      expect(MOVIMIENTOS_BANCARIO_SHEET.numberFormats?.get(2)).toEqual({ type: 'currency', decimals: 2 }); // debito
      expect(MOVIMIENTOS_BANCARIO_SHEET.numberFormats?.get(3)).toEqual({ type: 'currency', decimals: 2 }); // credito
      expect(MOVIMIENTOS_BANCARIO_SHEET.numberFormats?.get(4)).toEqual({ type: 'currency', decimals: 2 }); // saldo
    });
  });

  describe('MOVIMIENTOS_TARJETA_SHEET', () => {
    it('should have correct title', () => {
      expect(MOVIMIENTOS_TARJETA_SHEET.title).toBe('Movimientos');
    });

    it('should have 5 headers in correct order', () => {
      expect(MOVIMIENTOS_TARJETA_SHEET.headers).toEqual([
        'fecha',
        'descripcion',
        'nroCupon',
        'pesos',
        'dolares',
      ]);
    });

    it('should have date format for fecha column', () => {
      expect(MOVIMIENTOS_TARJETA_SHEET.numberFormats?.get(0)).toEqual({ type: 'date' });
    });

    it('should have currency format for monetary columns', () => {
      expect(MOVIMIENTOS_TARJETA_SHEET.numberFormats?.get(3)).toEqual({ type: 'currency', decimals: 2 }); // pesos
      expect(MOVIMIENTOS_TARJETA_SHEET.numberFormats?.get(4)).toEqual({ type: 'currency', decimals: 2 }); // dolares
    });
  });

  describe('MOVIMIENTOS_BROKER_SHEET', () => {
    it('should have correct title', () => {
      expect(MOVIMIENTOS_BROKER_SHEET.title).toBe('Movimientos');
    });

    it('should have 10 headers in correct order', () => {
      expect(MOVIMIENTOS_BROKER_SHEET.headers).toEqual([
        'descripcion',
        'cantidadVN',
        'saldo',
        'precio',
        'bruto',
        'arancel',
        'iva',
        'neto',
        'fechaConcertacion',
        'fechaLiquidacion',
      ]);
    });

    it('should have date format for date columns', () => {
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(8)).toEqual({ type: 'date' }); // fechaConcertacion
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(9)).toEqual({ type: 'date' }); // fechaLiquidacion
    });

    it('should have number format for cantidadVN', () => {
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(1)).toEqual({ type: 'number', decimals: 2 });
    });

    it('should have currency format for monetary columns', () => {
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(2)).toEqual({ type: 'currency', decimals: 2 }); // saldo
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(3)).toEqual({ type: 'currency', decimals: 2 }); // precio
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(4)).toEqual({ type: 'currency', decimals: 2 }); // bruto
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(5)).toEqual({ type: 'currency', decimals: 2 }); // arancel
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(6)).toEqual({ type: 'currency', decimals: 2 }); // iva
      expect(MOVIMIENTOS_BROKER_SHEET.numberFormats?.get(7)).toEqual({ type: 'currency', decimals: 2 }); // neto
    });
  });
});
