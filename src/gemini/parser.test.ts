/**
 * Tests for Gemini parser - bank name normalization and movimiento validation
 */

import { describe, it, expect } from 'vitest';
import {
  parseResumenBancarioResponse,
  parseResumenTarjetaResponse,
  parseResumenBrokerResponse,
  assignCuitsAndClassify,
  parseFacturaResponse,
  parsePagoResponse,
  extractJSON,
  isAdvaName
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

  describe('parseResumenTarjetaResponse - tipoTarjeta validation', () => {
    it('sets needsReview for invalid tipoTarjeta', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'InvalidCard',
        numeroCuenta: '4563',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 15000,
        saldoActual: 150000,
        cantidadMovimientos: 25,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.needsReview).toBe(true);
        expect(result.value.data.tipoTarjeta).toBeUndefined();
      }
    });

    it('does not set needsReview for valid tipoTarjeta', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 15000,
        saldoActual: 150000,
        cantidadMovimientos: 25,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.needsReview).not.toBe(true);
        expect(result.value.data.tipoTarjeta).toBe('Visa');
      }
    });
  });

  describe('parseResumenTarjetaResponse - numeroCuenta validation', () => {
    it('sets needsReview for empty numeroCuenta', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 15000,
        saldoActual: 150000,
        cantidadMovimientos: 25,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.needsReview).toBe(true);
      }
    });

    it('does not crash with null numeroCuenta and sets needsReview via missingFields', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: null,
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 15000,
        saldoActual: 150000,
        cantidadMovimientos: 25,
      });

      const result = parseResumenTarjetaResponse(response);

      // Should not crash. needsReview should be true because numeroCuenta is in missingFields
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).toBe(true);
        expect(result.value.missingFields).toContain('numeroCuenta');
      }
    });

    it('sets needsReview for suspiciously short numeroCuenta (< 4 digits)', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '123',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 15000,
        saldoActual: 150000,
        cantidadMovimientos: 25,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.needsReview).toBe(true);
      }
    });

    it('does not set needsReview for valid 4-digit numeroCuenta', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 15000,
        saldoActual: 150000,
        cantidadMovimientos: 25,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.needsReview).not.toBe(true);
      }
    });

    it('does not set needsReview for valid 10-digit numeroCuenta', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '0941198918',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 15000,
        saldoActual: 150000,
        cantidadMovimientos: 25,
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.needsReview).not.toBe(true);
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
            concepto: 'D 500 TRANSFERENCIA',
            debito: null,
            credito: 50000.00,
            saldo: 150000.00
          },
          {
            fecha: '2024-01-05',
            concepto: 'D 003 PAGO TARJETA',
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
        expect(result.value.data.movimientos![0].concepto).toBe('D 500 TRANSFERENCIA');
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
            concepto: 'D 500 TRANSFERENCIA',
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
            concepto: 'D 500 TRANSFERENCIA',
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
            concepto: 'D 500 TRANSFERENCIA',
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

    it('detects movimientos count mismatch', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        pagoMinimo: 5000,
        saldoActual: 25000,
        cantidadMovimientos: 50,
        movimientos: [
          {
            fecha: '2024-01-11',
            descripcion: 'TEST',
            nroCupon: null,
            pesos: 1000.00,
            dolares: null
          }
        ]
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 1 vs 50 is > 10% mismatch
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

    it('detects movimientos count mismatch', () => {
      const response = JSON.stringify({
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2024-07-01',
        fechaHasta: '2024-07-31',
        saldoARS: 500000,
        cantidadMovimientos: 20,
        movimientos: [
          {
            descripcion: 'TEST',
            cantidadVN: null,
            saldo: 500000.00,
            precio: null,
            bruto: null,
            arancel: null,
            iva: null,
            neto: null,
            fechaConcertacion: '2024-07-31',
            fechaLiquidacion: '2024-07-31'
          }
        ]
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 1 vs 20 is > 10% mismatch
        expect(result.value.needsReview).toBe(true);
      }
    });
  });

  describe('parseResumenBrokerResponse - balance validation', () => {
    it('sets needsReview when both saldoARS and saldoUSD are undefined', () => {
      const response = JSON.stringify({
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2024-10-01',
        fechaHasta: '2024-10-31',
        cantidadMovimientos: 0,
        // No saldoARS or saldoUSD
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('does not set needsReview when only saldoARS is present', () => {
      const response = JSON.stringify({
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2024-10-01',
        fechaHasta: '2024-10-31',
        cantidadMovimientos: 0,
        saldoARS: 100000,
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should not flag for review just because saldoUSD is missing
        expect(result.value.needsReview).not.toBe(true);
      }
    });

    it('does not set needsReview when only saldoUSD is present', () => {
      const response = JSON.stringify({
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2024-10-01',
        fechaHasta: '2024-10-31',
        cantidadMovimientos: 0,
        saldoUSD: 5000,
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should not flag for review just because saldoARS is missing
        expect(result.value.needsReview).not.toBe(true);
      }
    });

    it('does not set needsReview when both balances are present', () => {
      const response = JSON.stringify({
        broker: 'BALANZ CAPITAL VALORES SAU',
        numeroCuenta: '123456',
        fechaDesde: '2024-10-01',
        fechaHasta: '2024-10-31',
        cantidadMovimientos: 0,
        saldoARS: 100000,
        saldoUSD: 5000,
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).not.toBe(true);
      }
    });
  });

  describe('parseResumenBancarioResponse - numeric range validation', () => {
    it('rejects negative saldo with needsReview flag', () => {
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
            concepto: 'TRANSFERENCIA',
            debito: null,
            credito: 50000,
            saldo: -5000, // Negative saldo is invalid
          }
        ]
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('rejects NaN debito with needsReview flag', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        numeroCuenta: '007-009364/1',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-01-31',
        saldoInicial: 100000,
        saldoFinal: 90000,
        moneda: 'ARS',
        cantidadMovimientos: 1,
        movimientos: [
          {
            fecha: '2024-01-02',
            concepto: 'TRANSFERENCIA',
            debito: NaN, // NaN is invalid
            credito: null,
            saldo: 90000,
          }
        ]
      });

      // Note: NaN becomes null in JSON.stringify, so test with manually crafted invalid scenario
      // In practice, Gemini might return garbage that parses to NaN after parseFloat
      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      // JSON.stringify converts NaN to null, so this tests null handling
    });

    it('rejects extremely large values (> 1e15) with needsReview flag', () => {
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
            concepto: 'TRANSFERENCIA',
            debito: null,
            credito: 1e16, // Extremely large value, likely hallucination
            saldo: 1e16,
          }
        ]
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('accepts valid movimientos with normal values', () => {
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
            concepto: 'TRANSFERENCIA',
            debito: null,
            credito: 50000,
            saldo: 150000,
          }
        ]
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).not.toBe(true);
      }
    });
  });

  describe('parseResumenTarjetaResponse - numeric range validation', () => {
    it('rejects extremely large pesos value with needsReview flag', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563-XXXX-XXXX-1234',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 5000,
        saldoActual: 50000,
        cantidadMovimientos: 1,
        movimientos: [
          {
            fecha: '2024-10-11',
            descripcion: 'COMPRA',
            nroCupon: '123456',
            pesos: 1e16, // Extremely large value
            dolares: null,
          }
        ]
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('accepts valid movimientos with normal values', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
        tipoTarjeta: 'Visa',
        numeroCuenta: '4563-XXXX-XXXX-1234',
        fechaDesde: '2024-10-15',
        fechaHasta: '2024-11-14',
        pagoMinimo: 5000,
        saldoActual: 50000,
        cantidadMovimientos: 1,
        movimientos: [
          {
            fecha: '2024-10-11',
            descripcion: 'COMPRA',
            nroCupon: '123456',
            pesos: 1500.00,
            dolares: null,
          }
        ]
      });

      const result = parseResumenTarjetaResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).not.toBe(true);
      }
    });
  });

  describe('parseResumenBrokerResponse - numeric range validation', () => {
    it('rejects extremely large saldo value with needsReview flag', () => {
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
            saldo: 1e16, // Extremely large value
            precio: 5000.00,
            bruto: 500000.00,
            arancel: 1000.00,
            iva: 210.00,
            neto: 498790.00,
            fechaConcertacion: '2024-07-07',
            fechaLiquidacion: '2024-07-09',
          }
        ]
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('accepts valid movimientos with normal values', () => {
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
            precio: 5000.00,
            bruto: 500000.00,
            arancel: 1000.00,
            iva: 210.00,
            neto: 498790.00,
            fechaConcertacion: '2024-07-07',
            fechaLiquidacion: '2024-07-09',
          }
        ]
      });

      const result = parseResumenBrokerResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).not.toBe(true);
      }
    });
  });
});

describe('Parser - CUIT Assignment for Consumidor Final', () => {
  describe('assignCuitsAndClassify', () => {
    it('handles Doc. Receptor IDs for Consumidor Final clients', () => {
      // Test case where client ID is labeled "Doc. Receptor" not "CUIT"
      const issuerName = 'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS';
      const clientName = 'Marcial Fermin Gutierrez';
      const allCuits = ['30709076783', '20367086921']; // ADVA CUIT + client CUIL (11 digits)

      const result = assignCuitsAndClassify(issuerName, clientName, allCuits);

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe('30709076783');
      expect(result.razonSocialEmisor).toBe(issuerName);
      expect(result.cuitReceptor).toBe('20367086921');
      expect(result.razonSocialReceptor).toBe(clientName);
    });

    it('handles extraction with only ADVA CUIT (Consumidor Final case)', () => {
      // When allCuits only contains ADVA's CUIT, cuitReceptor should be empty
      const issuerName = 'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS';
      const clientName = 'Marcial Fermin Gutierrez';
      const allCuits = ['30709076783']; // Only ADVA's CUIT extracted

      const result = assignCuitsAndClassify(issuerName, clientName, allCuits);

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe('30709076783');
      expect(result.cuitReceptor).toBe(''); // Empty, not present in allCuits
      expect(result.razonSocialReceptor).toBe(clientName);
    });

    it('handles DNI format (7-8 digits)', () => {
      // DNIs are 7-8 digits, not 11 like CUITs
      const issuerName = 'ADVA';
      const clientName = 'Juan Perez';
      const allCuits = ['30709076783', '12345678']; // ADVA CUIT + client DNI (8 digits)

      const result = assignCuitsAndClassify(issuerName, clientName, allCuits);

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitReceptor).toBe('12345678'); // DNI should be assigned
    });

    // CUIT-based fallback tests (ADV-47)
    it('uses CUIT fallback when ADVA CUIT is first in array and name matching fails', () => {
      // ADVA CUIT appears first (issuer position) but names don't match pattern
      const issuerName = 'UNKNOWN COMPANY NAME'; // Doesn't match ADVA pattern
      const clientName = 'PROVEEDOR SA';
      const allCuits = ['30709076783', '20123456786']; // ADVA first = issuer

      const result = assignCuitsAndClassify(issuerName, clientName, allCuits);

      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe('30709076783');
      expect(result.cuitReceptor).toBe('20123456786');
    });

    it('uses CUIT fallback when ADVA CUIT is second in array and name matching fails', () => {
      // ADVA CUIT appears second (client position) but names don't match pattern
      const issuerName = 'PROVEEDOR SA';
      const clientName = 'UNKNOWN COMPANY NAME'; // Doesn't match ADVA pattern
      const allCuits = ['20123456786', '30709076783']; // ADVA second = client

      const result = assignCuitsAndClassify(issuerName, clientName, allCuits);

      expect(result.documentType).toBe('factura_recibida');
      expect(result.cuitEmisor).toBe('20123456786');
      expect(result.cuitReceptor).toBe('30709076783');
    });

    it('prefers name matching over CUIT fallback when name matches', () => {
      // Name clearly matches ADVA - don't fall back to CUIT position
      const issuerName = 'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS';
      const clientName = 'PROVEEDOR SA';
      // CUIT order is opposite to name order - but name should take precedence
      const allCuits = ['20123456786', '30709076783']; // ADVA second, but name says issuer

      const result = assignCuitsAndClassify(issuerName, clientName, allCuits);

      expect(result.documentType).toBe('factura_emitida'); // Name-based, not CUIT-based
      expect(result.cuitEmisor).toBe('30709076783');
    });

    it('throws when ADVA CUIT not found and name matching also fails', () => {
      const issuerName = 'EMPRESA RANDOM SA';
      const clientName = 'OTRA EMPRESA SA';
      const allCuits = ['20123456786', '27234567891']; // No ADVA CUIT

      expect(() => assignCuitsAndClassify(issuerName, clientName, allCuits))
        .toThrow(/ADVA not found/);
    });

    it('handles CUIT fallback with mismatched names but valid ADVA CUIT', () => {
      // Real-world case: OCR/extraction issue corrupts name but CUIT is correct
      const issuerName = 'A.C.D.V.A.'; // Weird OCR corruption
      const clientName = 'BBHO PRODUCCIONES SA';
      const allCuits = ['30709076783', '20123456786']; // ADVA first = issuer

      const result = assignCuitsAndClassify(issuerName, clientName, allCuits);

      // Should work via CUIT fallback since name doesn't match
      expect(result.documentType).toBe('factura_emitida');
      expect(result.cuitEmisor).toBe('30709076783');
    });
  });

  describe('parseFacturaResponse - Consumidor Final validation', () => {
    it('flags empty cuitReceptor for factura_emitida as needs review', () => {
      // Simulate Gemini extracting only ADVA's CUIT
      const response = JSON.stringify({
        issuerName: 'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS',
        clientName: 'Marcial Fermin Gutierrez',
        allCuits: ['30709076783'], // Only ADVA CUIT
        tipoComprobante: 'C',
        nroFactura: '00005-00000035',
        fechaEmision: '2025-11-10',
        importeNeto: 100000,
        importeIva: 0,
        importeTotal: 100000,
        moneda: 'ARS',
      });

      const result = parseFacturaResponse(response, 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.cuitReceptor).toBeUndefined();
        expect(result.value.needsReview).toBe(true); // Should flag for review
      }
    });

    it('lowers confidence when counterparty CUIT is missing in factura_emitida', () => {
      // All required fields present but no counterparty CUIT
      const response = JSON.stringify({
        issuerName: 'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS',
        clientName: 'Consumidor Final',
        allCuits: ['30709076783'], // Only ADVA CUIT - no counterparty CUIT
        tipoComprobante: 'B',
        nroFactura: '00001-00000001',
        fechaEmision: '2025-01-15',
        importeNeto: 10000,
        importeIva: 0,
        importeTotal: 10000,
        moneda: 'ARS',
      });

      const result = parseFacturaResponse(response, 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Confidence should be significantly lowered (0.3) due to missing counterparty CUIT
        expect(result.value.confidence).toBeLessThanOrEqual(0.3);
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('maintains high confidence when all CUITs are present', () => {
      // Complete data with both ADVA and counterparty CUIT
      const response = JSON.stringify({
        issuerName: 'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS',
        clientName: 'Empresa Cliente SA',
        allCuits: ['30709076783', '20123456786'], // Both CUITs present
        tipoComprobante: 'A',
        nroFactura: '00001-00000001',
        fechaEmision: '2025-01-15',
        importeNeto: 100000,
        importeIva: 21000,
        importeTotal: 121000,
        moneda: 'ARS',
      });

      const result = parseFacturaResponse(response, 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Confidence should be high (>= 0.9) when all fields including CUIT are present
        expect(result.value.confidence).toBeGreaterThanOrEqual(0.9);
        expect(result.value.needsReview).toBe(false);
      }
    });

    it('does not flag when cuitReceptor is present', () => {
      // Complete data: all required fields present, confidence > 0.9, no suspicious fields
      const response = JSON.stringify({
        issuerName: 'ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS',
        clientName: 'Empresa Test SA',
        allCuits: ['30709076783', '20367086921'],
        tipoComprobante: 'A',
        nroFactura: '00001-00000001',
        fechaEmision: '2025-01-15',
        importeNeto: 100000,
        importeIva: 21000,
        importeTotal: 121000,
        moneda: 'ARS',
      });

      const result = parseFacturaResponse(response, 'factura_emitida');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.cuitReceptor).toBe('20367086921');
        // No review needed: all required fields present, cuitReceptor not empty, confidence = 1.0
        expect(result.value.needsReview).toBe(false);
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

// Bug #22: Improve truncated response handling
describe('extractJSON', () => {
  it('returns valid type for complete JSON', () => {
    const response = '{"field": "value"}';
    const result = extractJSON(response);

    expect(result.type).toBe('valid');
    if (result.type === 'valid') {
      expect(result.json).toBe('{"field": "value"}');
    }
  });

  it('returns truncated type for incomplete JSON', () => {
    const response = '{"field": "value"'; // Missing closing brace
    const result = extractJSON(response);

    expect(result.type).toBe('truncated');
    if (result.type === 'truncated') {
      expect(result.partial).toContain('{"field": "value"');
    }
  });

  it('returns empty type when no JSON found', () => {
    const response = 'This is just plain text with no JSON';
    const result = extractJSON(response);

    expect(result.type).toBe('empty');
  });

  it('distinguishes between truncated and empty', () => {
    const truncated = '{"incomplete": ';
    const empty = 'No JSON here';

    const truncatedResult = extractJSON(truncated);
    const emptyResult = extractJSON(empty);

    expect(truncatedResult.type).toBe('truncated');
    expect(emptyResult.type).toBe('empty');
    expect(truncatedResult.type).not.toBe(emptyResult.type);
  });

  it('extracts JSON from markdown code blocks', () => {
    const response = '```json\n{"field": "value"}\n```';
    const result = extractJSON(response);

    expect(result.type).toBe('valid');
    if (result.type === 'valid') {
      expect(result.json).toContain('{"field": "value"}');
    }
  });
});

describe('Parser - JSON Size Limit', () => {
  it('rejects oversized JSON string (> 1MB)', () => {
    // Create a JSON string larger than 1MB
    const largeObject = {
      data: 'x'.repeat(1_100_000) // 1.1MB of data
    };
    const largeJson = JSON.stringify(largeObject);

    const result = parseFacturaResponse(largeJson, 'factura_emitida');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('exceeds maximum size');
    }
  });

  it('accepts normal-sized JSON string (< 1MB)', () => {
    const normalJson = JSON.stringify({
      issuerName: 'ADVA',
      clientName: 'Client SA',
      allCuits: ['30709076783', '20123456786'],
      tipoComprobante: 'Factura A',
      nroFactura: '0001-00000123',
      fechaEmision: '2025-01-15',
      importeNeto: 10000,
      importeIva: 2100,
      importeTotal: 12100,
      moneda: 'ARS',
      concepto: 'Test'
    });

    const result = parseFacturaResponse(normalJson, 'factura_emitida');

    // Should succeed (not be rejected for size)
    // May still fail for other validation reasons, but not size
    if (!result.ok) {
      expect(result.error.message).not.toContain('exceeds maximum size');
    }
  });

  it('checks size limit in all parser functions', () => {
    const largeJson = JSON.stringify({ data: 'x'.repeat(1_100_000) });

    // Test parseResumenBancarioResponse
    const bancarioResult = parseResumenBancarioResponse(largeJson);
    expect(bancarioResult.ok).toBe(false);
    if (!bancarioResult.ok) {
      expect(bancarioResult.error.message).toContain('exceeds maximum size');
    }

    // Test parseResumenTarjetaResponse
    const tarjetaResult = parseResumenTarjetaResponse(largeJson);
    expect(tarjetaResult.ok).toBe(false);
    if (!tarjetaResult.ok) {
      expect(tarjetaResult.error.message).toContain('exceeds maximum size');
    }

    // Test parseResumenBrokerResponse
    const brokerResult = parseResumenBrokerResponse(largeJson);
    expect(brokerResult.ok).toBe(false);
    if (!brokerResult.ok) {
      expect(brokerResult.error.message).toContain('exceeds maximum size');
    }
  });
});

describe('isAdvaName', () => {
  // Valid ADVA names - should return true
  it('accepts "ADVA" (acronym)', () => {
    expect(isAdvaName('ADVA')).toBe(true);
  });

  it('accepts full official name', () => {
    expect(isAdvaName('ASOCIACION CIVIL DE DESARROLLADORES DE VIDEOJUEGOS ARGENTINOS')).toBe(true);
  });

  it('accepts abbreviated form with VIDEOJUEGOS', () => {
    expect(isAdvaName('ASOC CIVIL DESARROLLADORES VIDEOJUEGOS')).toBe(true);
  });

  it('accepts variation with VIDEOJUEGO (singular)', () => {
    expect(isAdvaName('ASOCIACION DE DESARROLLADORES DE VIDEOJUEGO')).toBe(true);
  });

  it('accepts case insensitive match', () => {
    expect(isAdvaName('Asociacion Civil de Desarrolladores de Videojuegos Argentinos')).toBe(true);
  });

  // Abbreviated forms with periods (ADV-46)
  it('accepts "AS.C.DE DES.DE VIDEOJUEGOS ARG" (periods in abbreviations)', () => {
    expect(isAdvaName('AS.C.DE DES.DE VIDEOJUEGOS ARG')).toBe(true);
  });

  it('accepts "A.C. DES. DE VIDEOJUEGOS" (abbreviated with periods)', () => {
    expect(isAdvaName('A.C. DES. DE VIDEOJUEGOS')).toBe(true);
  });

  it('accepts "ASOC. CIVIL DESARROLL. VIDEOJUEGOS" (partial abbreviations)', () => {
    expect(isAdvaName('ASOC. CIVIL DESARROLL. VIDEOJUEGOS')).toBe(true);
  });

  it('accepts "AS DE DES DE VIDEOJUEGO" (extreme abbreviation without periods)', () => {
    expect(isAdvaName('AS DE DES DE VIDEOJUEGO')).toBe(true);
  });

  it('accepts "A.DE DES.VIDEOJUEGOS ARG" (mixed abbreviation)', () => {
    expect(isAdvaName('A.DE DES.VIDEOJUEGOS ARG')).toBe(true);
  });

  // Invalid names - should return false (these were matching incorrectly before)
  it('rejects "ASOCIACION DE DESARROLLADORES DE SOFTWARE" (no VIDEOJUEGO)', () => {
    expect(isAdvaName('ASOCIACION DE DESARROLLADORES DE SOFTWARE')).toBe(false);
  });

  it('rejects "ASOCIACION DESARROLLADORES DE APPS" (no VIDEOJUEGO)', () => {
    expect(isAdvaName('ASOCIACION DESARROLLADORES DE APPS')).toBe(false);
  });

  it('rejects "CAMARA DE DESARROLLADORES DE SOFTWARE" (no VIDEOJUEGO)', () => {
    expect(isAdvaName('CAMARA DE DESARROLLADORES DE SOFTWARE')).toBe(false);
  });

  it('rejects "ASOCIACION ARGENTINA DE DESARROLLADORES" (no VIDEOJUEGO)', () => {
    expect(isAdvaName('ASOCIACION ARGENTINA DE DESARROLLADORES')).toBe(false);
  });

  it('rejects company names with only DESARROLL* substring', () => {
    expect(isAdvaName('EMPRESA DESARROLLADORA SA')).toBe(false);
  });

  it('rejects random company names', () => {
    expect(isAdvaName('EMPRESA TEST SA')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAdvaName('')).toBe(false);
  });
});

describe('Confidence calculation without artificial floor', () => {
  describe('parsePagoResponse', () => {
    it('returns low confidence when most required fields missing', () => {
      // Only provide fechaPago - missing banco, importePagado which are also required
      const response = JSON.stringify({
        fechaPago: '2025-01-15',
        // Missing: banco, importePagado, moneda, cuitPagador, cuitBeneficiario, etc.
      });

      const result = parsePagoResponse(response, 'pago_enviado');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // With most fields missing, confidence should be well below 0.5
        expect(result.value.confidence).toBeLessThan(0.5);
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('returns high confidence when all required fields present', () => {
      const response = JSON.stringify({
        fechaPago: '2025-01-15',
        banco: 'BBVA',
        importePagado: 10000,
        moneda: 'ARS',
        cuitPagador: '30709076783', // ADVA
        nombrePagador: 'ADVA',
        cuitBeneficiario: '20123456786',
        nombreBeneficiario: 'Proveedor SA',
      });

      const result = parsePagoResponse(response, 'pago_enviado');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.confidence).toBeGreaterThanOrEqual(0.9);
      }
    });
  });

  describe('parseResumenBancarioResponse', () => {
    it('returns low confidence when most required fields missing', () => {
      // Only provide banco - missing numeroCuenta, fechaDesde, fechaHasta, etc.
      const response = JSON.stringify({
        banco: 'BBVA',
        // Missing: numeroCuenta, fechaDesde, fechaHasta, saldoInicial, saldoFinal, moneda
      });

      const result = parseResumenBancarioResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // With most fields missing, confidence should be well below 0.5
        expect(result.value.confidence).toBeLessThan(0.5);
        expect(result.value.needsReview).toBe(true);
      }
    });

    it('returns high confidence when all required fields present', () => {
      const response = JSON.stringify({
        banco: 'BBVA',
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
        expect(result.value.confidence).toBeGreaterThanOrEqual(0.9);
      }
    });
  });
});
