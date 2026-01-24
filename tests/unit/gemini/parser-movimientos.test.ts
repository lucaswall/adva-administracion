/**
 * Unit tests for Gemini parser movimientos extraction
 * Tests parsing of transaction arrays from resumen responses
 */

import { describe, it, expect } from 'vitest';
import {
  parseResumenTarjetaResponse,
  parseResumenBrokerResponse,
} from '../../../src/gemini/parser.js';

describe('parseResumenTarjetaResponse - movimientos', () => {
  it('parses response with movimientos array', () => {
    const response = `\`\`\`json
{
  "banco": "BBVA",
  "tipoTarjeta": "Visa",
  "numeroCuenta": "4563",
  "fechaDesde": "2024-01-01",
  "fechaHasta": "2024-01-31",
  "pagoMinimo": 5000,
  "saldoActual": 25000,
  "cantidadMovimientos": 2,
  "movimientos": [
    {
      "fecha": "2024-01-11",
      "descripcion": "ZOOM.COM USD 16,99",
      "nroCupon": "12345678",
      "pesos": 14500.00,
      "dolares": null
    },
    {
      "fecha": "2024-01-15",
      "descripcion": "MERCADOLIBRE",
      "nroCupon": null,
      "pesos": null,
      "dolares": 50.00
    }
  ]
}
\`\`\``;

    const result = parseResumenTarjetaResponse(response);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.movimientos).toBeDefined();
      expect(result.value.data.movimientos).toHaveLength(2);
      expect(result.value.data.movimientos?.[0].descripcion).toBe('ZOOM.COM USD 16,99');
      expect(result.value.data.movimientos?.[0].pesos).toBe(14500.00);
      expect(result.value.data.movimientos?.[1].dolares).toBe(50.00);
    }
  });

  it('parses response with empty movimientos array', () => {
    const response = `\`\`\`json
{
  "banco": "BBVA",
  "tipoTarjeta": "Visa",
  "numeroCuenta": "4563",
  "fechaDesde": "2024-01-01",
  "fechaHasta": "2024-01-31",
  "pagoMinimo": 0,
  "saldoActual": 0,
  "cantidadMovimientos": 0,
  "movimientos": []
}
\`\`\``;

    const result = parseResumenTarjetaResponse(response);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.movimientos).toBeDefined();
      expect(result.value.data.movimientos).toHaveLength(0);
    }
  });

  it('sets needsReview when movimientos count mismatch > 10%', () => {
    const response = `\`\`\`json
{
  "banco": "BBVA",
  "tipoTarjeta": "Visa",
  "numeroCuenta": "4563",
  "fechaDesde": "2024-01-01",
  "fechaHasta": "2024-01-31",
  "pagoMinimo": 5000,
  "saldoActual": 25000,
  "cantidadMovimientos": 50,
  "movimientos": [
    {
      "fecha": "2024-01-11",
      "descripcion": "TEST",
      "nroCupon": null,
      "pesos": 1000.00,
      "dolares": null
    }
  ]
}
\`\`\``;

    const result = parseResumenTarjetaResponse(response);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 1 vs 50 is > 10% mismatch
      expect(result.value.needsReview).toBe(true);
    }
  });
});

describe('parseResumenBrokerResponse - movimientos', () => {
  it('parses response with movimientos array', () => {
    const response = `\`\`\`json
{
  "broker": "BALANZ CAPITAL VALORES SAU",
  "numeroCuenta": "123456",
  "fechaDesde": "2024-07-01",
  "fechaHasta": "2024-07-31",
  "saldoARS": 500000,
  "saldoUSD": 1500,
  "cantidadMovimientos": 2,
  "movimientos": [
    {
      "descripcion": "Boleto / 5863936 / VENTA / 1 / ZZC1O / $",
      "cantidadVN": 1.0,
      "saldo": 500000.00,
      "precio": 100.50,
      "bruto": 100.50,
      "arancel": 0.20,
      "iva": 0.04,
      "neto": 100.26,
      "fechaConcertacion": "2024-07-07",
      "fechaLiquidacion": "2024-07-09"
    },
    {
      "descripcion": "Comisión mantenimiento",
      "cantidadVN": null,
      "saldo": 499900.00,
      "precio": null,
      "bruto": null,
      "arancel": 100.00,
      "iva": null,
      "neto": -100.00,
      "fechaConcertacion": "2024-07-31",
      "fechaLiquidacion": "2024-07-31"
    }
  ]
}
\`\`\``;

    const result = parseResumenBrokerResponse(response);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.movimientos).toBeDefined();
      expect(result.value.data.movimientos).toHaveLength(2);
      expect(result.value.data.movimientos?.[0].descripcion).toBe('Boleto / 5863936 / VENTA / 1 / ZZC1O / $');
      expect(result.value.data.movimientos?.[0].cantidadVN).toBe(1.0);
      expect(result.value.data.movimientos?.[1].arancel).toBe(100.00);
    }
  });

  it('parses response with empty movimientos array', () => {
    const response = `\`\`\`json
{
  "broker": "BALANZ CAPITAL VALORES SAU",
  "numeroCuenta": "123456",
  "fechaDesde": "2024-07-01",
  "fechaHasta": "2024-07-31",
  "saldoARS": 0,
  "cantidadMovimientos": 0,
  "movimientos": []
}
\`\`\``;

    const result = parseResumenBrokerResponse(response);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.movimientos).toBeDefined();
      expect(result.value.data.movimientos).toHaveLength(0);
    }
  });

  it('sets needsReview when movimientos count mismatch > 10%', () => {
    const response = `\`\`\`json
{
  "broker": "BALANZ CAPITAL VALORES SAU",
  "numeroCuenta": "123456",
  "fechaDesde": "2024-07-01",
  "fechaHasta": "2024-07-31",
  "saldoARS": 500000,
  "cantidadMovimientos": 20,
  "movimientos": [
    {
      "descripcion": "TEST",
      "cantidadVN": null,
      "saldo": 500000.00,
      "precio": null,
      "bruto": null,
      "arancel": null,
      "iva": null,
      "neto": null,
      "fechaConcertacion": "2024-07-31",
      "fechaLiquidacion": "2024-07-31"
    }
  ]
}
\`\`\``;

    const result = parseResumenBrokerResponse(response);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 1 vs 20 is > 10% mismatch
      expect(result.value.needsReview).toBe(true);
    }
  });
});
