/**
 * Tests for Gemini parser - bank name normalization
 */

import { describe, it, expect } from 'vitest';
import { parseResumenBancarioResponse, parseResumenTarjetaResponse } from './parser.js';

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
