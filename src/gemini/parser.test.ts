/**
 * Tests for Gemini parser - bank name normalization and movimiento validation
 */

import { describe, it, expect } from 'vitest';
import {
  parseResumenBancarioResponse,
  parseResumenTarjetaResponse,
  parseResumenBrokerResponse
} from './parser.js';

describe('Parser - Bank Name Normalization', () => {
  describe('parseResumenBancarioResponse', () => {
    it('normalizes "BancoCiudad" to "Banco Ciudad"', () => {
      const response = JSON.stringify({
        banco: 'BancoCiudad',
        numeroCuenta: '1234567890',
        fechaDesde: '2025-01-01',
        fechaHasta: '2025-01-31',
        saldoInicial: 100000,
        saldoFinal: 150000,
        moneda: 'ARS',
        cantidadMovimientos: 5,
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.banco).toBe('Banco Ciudad');
      }
    });

    it('normalizes "Banco Credicoop Cooperativo Limitado" to "Credicoop"', () => {
      const response = JSON.stringify({
        banco: 'Banco Credicoop Cooperativo Limitado',
        numeroCuenta: '9876543210',
        fechaDesde: '2025-01-01',
        fechaHasta: '2025-01-31',
        saldoInicial: 50000,
        saldoFinal: 75000,
        moneda: 'ARS',
        cantidadMovimientos: 3,
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.banco).toBe('Credicoop');
      }
    });

    it('normalizes "BBVA Frances" to "BBVA"', () => {
      const response = JSON.stringify({
        banco: 'BBVA Frances',
        numeroCuenta: '5555555555',
        fechaDesde: '2025-01-01',
        fechaHasta: '2025-01-31',
        saldoInicial: 200000,
        saldoFinal: 250000,
        moneda: 'USD',
        cantidadMovimientos: 10,
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.banco).toBe('BBVA');
      }
    });

    it('preserves unknown bank names', () => {
      const response = JSON.stringify({
        banco: 'Banco Galicia',
        numeroCuenta: '1111111111',
        fechaDesde: '2025-01-01',
        fechaHasta: '2025-01-31',
        saldoInicial: 300000,
        saldoFinal: 350000,
        moneda: 'ARS',
        cantidadMovimientos: 8,
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.banco).toBe('Banco Galicia');
      }
    });
  });

  describe('parseResumenTarjetaResponse', () => {
    it('normalizes "BancoCiudad" to "Banco Ciudad"', () => {
      const response = JSON.stringify({
        banco: 'BancoCiudad',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 5000,
        saldoActual: 50000,
        cantidadMovimientos: 14,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.banco).toBe('Banco Ciudad');
      }
    });

    it('normalizes "BBVA Francés" to "BBVA"', () => {
      const response = JSON.stringify({
        banco: 'BBVA Francés',
        tipoTarjeta: 'Mastercard',
        numeroCuenta: '1234',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 10000,
        saldoActual: 100000,
        cantidadMovimientos: 20,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.banco).toBe('BBVA');
      }
    });

    it('preserves unknown bank names', () => {
      const response = JSON.stringify({
        banco: 'Santander Rio',
        tipoTarjeta: 'Amex',
        numeroCuenta: '7890',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 15000,
        saldoActual: 150000,
        cantidadMovimientos: 25,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.banco).toBe('Santander Rio');
      }
    });
  });
});

describe('Parser - Movimiento Validation', () => {
  describe('parseResumenBancarioResponse - movimientos', () => {
    it('accepts valid movimientos array', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        numeroCuenta: '007-009364/1',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        saldoInicial: 100000,
        saldoFinal: 150000,
        moneda: 'ARS',
        cantidadMovimientos: 2,
        movimientos: [
          {
            fecha: '2024-01-02',
            origenConcepto: 'D 500 TRANSFERENCIA',
            debito: null,
            credito: 50000.00,
            saldo: 150000.00
          },
          {
            fecha: '2024-01-05',
            origenConcepto: 'D 003 PAGO TARJETA',
            debito: 25000.00,
            credito: null,
            saldo: 125000.00
          }
        ]
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.movimientos).toHaveLength(2);
        expect(result.value.data.movimientos![0].fecha).toBe('2024-01-02');
        expect(result.value.data.movimientos![0].origenConcepto).toBe('D 500 TRANSFERENCIA');
        expect(result.value.data.movimientos![0].debito).toBeNull();
        expect(result.value.data.movimientos![0].credito).toBe(50000.00);
      }
    });

    it('accepts empty movimientos array', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        numeroCuenta: '007-009364/1',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        saldoInicial: 100000,
        saldoFinal: 100000,
        moneda: 'ARS',
        cantidadMovimientos: 0,
        movimientos: []
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.movimientos).toEqual([]);
      }
    });

    it('validates fecha format in movimientos', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        numeroCuenta: '007-009364/1',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        saldoInicial: 100000,
        saldoFinal: 150000,
        moneda: 'ARS',
        cantidadMovimientos: 1,
        movimientos: [
          {
            fecha: 'invalid-date',
            origenConcepto: 'D 500 TRANSFERENCIA',
            debito: null,
            credito: 50000.00,
            saldo: 150000.00
          }
        ]
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Parser should accept it but may flag for review
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('validates at least one of debito/credito has value', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        numeroCuenta: '007-009364/1',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        saldoInicial: 100000,
        saldoFinal: 150000,
        moneda: 'ARS',
        cantidadMovimientos: 1,
        movimientos: [
          {
            fecha: '2024-01-02',
            origenConcepto: 'D 500 TRANSFERENCIA',
            debito: null,
            credito: null,
            saldo: 150000.00
          }
        ]
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Parser should accept it but may flag for review due to invalid movimiento
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('detects movimientos count mismatch', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        numeroCuenta: '007-009364/1',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        saldoInicial: 100000,
        saldoFinal: 150000,
        moneda: 'ARS',
        cantidadMovimientos: 10,
        movimientos: [
          {
            fecha: '2024-01-02',
            origenConcepto: 'D 500 TRANSFERENCIA',
            debito: null,
            credito: 50000.00,
            saldo: 150000.00
          }
        ]
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should flag for review due to count mismatch (1 vs 10 = 90% discrepancy)
        expect(result.value.needsReview).toBe(true);
      }
    });
  });

  describe('parseResumenTarjetaResponse - movimientos', () => {
    it('accepts valid movimientos array', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 5000,
        saldoActual: 50000,
        cantidadMovimientos: 2,
        movimientos: [
          {
            fecha: '2024-10-11',
            descripcion: 'ZOOM.COM 888-799',
            nroCupon: '12345678',
            pesos: 1500.00,
            dolares: null
          },
          {
            fecha: '2024-10-13',
            descripcion: 'AMAZON.COM',
            nroCupon: null,
            pesos: null,
            dolares: 25.99
          }
        ]
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.movimientos).toHaveLength(2);
        expect(result.value.data.movimientos![0].descripcion).toBe('ZOOM.COM 888-799');
        expect(result.value.data.movimientos![0].pesos).toBe(1500.00);
        expect(result.value.data.movimientos![0].dolares).toBeNull();
      }
    });

    it('accepts empty movimientos array', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 0,
        saldoActual: 0,
        cantidadMovimientos: 0,
        movimientos: []
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.movimientos).toEqual([]);
      }
    });

    it('validates at least one of pesos/dolares has value', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 5000,
        saldoActual: 50000,
        cantidadMovimientos: 1,
        movimientos: [
          {
            fecha: '2024-10-11',
            descripcion: 'ZOOM.COM',
            nroCupon: null,
            pesos: null,
            dolares: null
          }
        ]
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should flag for review due to invalid movimiento (no amount)
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('validates fecha format in movimientos', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 5000,
        saldoActual: 50000,
        cantidadMovimientos: 1,
        movimientos: [
          {
            fecha: '10/11/2024',
            descripcion: 'ZOOM.COM',
            nroCupon: null,
            pesos: 1500.00,
            dolares: null
          }
        ]
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should flag for review due to invalid date format
        expect(result.value.needsReview).toBe(true);
      }
    });
  });

  describe('parseResumenBrokerResponse - movimientos', () => {
    it('accepts valid movimientos array with all fields', () => {
      const response = JSON.stringify({
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2024-07-01',
        fechaHasta: '2024-07-31',
        saldoARS: 500000,
        saldoUSD: 1500,
        cantidadMovimientos: 1,
        movimientos: [
          {
            descripcion: 'Boleto / VENTA / ZZC1O',
            cantidadVN: 100.00,
            saldo: 500000.00,
            precio: 1250.00,
            bruto: 125000.00,
            arancel: 50.00,
            iva: 10.50,
            neto: 124939.50,
            fechaConcertacion: '2024-07-07',
            fechaLiquidacion: '2024-07-09'
          }
        ]
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.movimientos).toHaveLength(1);
        expect(result.value.data.movimientos![0].descripcion).toBe('Boleto / VENTA / ZZC1O');
        expect(result.value.data.movimientos![0].cantidadVN).toBe(100.00);
        expect(result.value.data.movimientos![0].saldo).toBe(500000.00);
        expect(result.value.data.movimientos![0].fechaConcertacion).toBe('2024-07-07');
        expect(result.value.data.movimientos![0].fechaLiquidacion).toBe('2024-07-09');
      }
    });

    it('accepts empty movimientos array', () => {
      const response = JSON.stringify({
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2024-07-01',
        fechaHasta: '2024-07-31',
        saldoARS: 500000,
        saldoUSD: 1500,
        cantidadMovimientos: 0,
        movimientos: []
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.movimientos).toEqual([]);
      }
    });

    it('validates both fecha fields format in movimientos', () => {
      const response = JSON.stringify({
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2024-07-01',
        fechaHasta: '2024-07-31',
        saldoARS: 500000,
        saldoUSD: 1500,
        cantidadMovimientos: 1,
        movimientos: [
          {
            descripcion: 'Boleto / VENTA / ZZC1O',
            cantidadVN: 100.00,
            saldo: 500000.00,
            precio: null,
            bruto: null,
            arancel: null,
            iva: null,
            neto: null,
            fechaConcertacion: 'invalid-date',
            fechaLiquidacion: '2024-07-09'
          }
        ]
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should flag for review due to invalid date format
        expect(result.value.needsReview).toBe(true);
      }
    });
  });
});

describe('isValidDateFormat', () => {
  // Note: isValidDateFormat is not exported, so we test it indirectly through parser functions
  // We'll test with parseResumenBancarioResponse which uses isValidDateFormat internally

  it('rejects invalid day (2024-02-30)', () => {
    const response = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2024-02-30', // Invalid: Feb doesn't have 30 days
      fechaHasta: '2024-02-28',
      saldoInicial: 100000,
      saldoFinal: 150000,
      moneda: 'ARS',
      cantidadMovimientos: 0,
      movimientos: []
    });

    const result = parseResumenBancarioResponse(response);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should flag for review due to invalid date
      expect(result.value.needsReview).toBe(true);
    }
  });

  it('rejects invalid month (2024-13-01)', () => {
    const response = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2024-13-01', // Invalid: month 13 doesn't exist
      fechaHasta: '2024-12-31',
      saldoInicial: 100000,
      saldoFinal: 150000,
      moneda: 'ARS',
      cantidadMovimientos: 0,
      movimientos: []
    });

    const result = parseResumenBancarioResponse(response);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should flag for review due to invalid date
      expect(result.value.needsReview).toBe(true);
    }
  });

  it('accepts leap year date (2024-02-29)', () => {
    const response = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2024-02-29', // Valid: 2024 is a leap year
      fechaHasta: '2024-02-29',
      saldoInicial: 100000,
      saldoFinal: 150000,
      moneda: 'ARS',
      cantidadMovimientos: 0,
      movimientos: []
    });

    const result = parseResumenBancarioResponse(response);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should NOT flag for review - date is valid
      expect(result.value.needsReview).toBe(false);
    }
  });

  it('rejects non-leap year Feb 29 (2023-02-29)', () => {
    const response = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2023-02-29', // Invalid: 2023 is not a leap year
      fechaHasta: '2023-02-28',
      saldoInicial: 100000,
      saldoFinal: 150000,
      moneda: 'ARS',
      cantidadMovimientos: 0,
      movimientos: []
    });

    const result = parseResumenBancarioResponse(response);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should flag for review due to invalid date
      expect(result.value.needsReview).toBe(true);
    }
  });

  it('accepts valid dates', () => {
    const response = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2024-01-15', // Valid date
      fechaHasta: '2024-12-31', // Valid date
      saldoInicial: 100000,
      saldoFinal: 150000,
      moneda: 'ARS',
      cantidadMovimientos: 0,
      movimientos: []
    });

    const result = parseResumenBancarioResponse(response);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should NOT flag for review
      expect(result.value.needsReview).toBe(false);
    }
  });
});
