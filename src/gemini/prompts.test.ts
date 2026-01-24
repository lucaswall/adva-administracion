/**
 * Tests for resumen prompt functions
 * Verifies three-tier year extraction approach and dynamic date injection
 */

import { describe, it, expect } from 'vitest';
import {
  getResumenBancarioPrompt,
  getResumenTarjetaPrompt,
  getResumenBrokerPrompt,
  formatCurrentDateForPrompt,
} from './prompts.js';

describe('formatCurrentDateForPrompt', () => {
  it('should format January 2025 correctly', () => {
    const date = new Date('2025-01-15');
    expect(formatCurrentDateForPrompt(date)).toBe('January 2025 (month 1)');
  });

  it('should format December 2024 correctly', () => {
    const date = new Date('2024-12-20');
    expect(formatCurrentDateForPrompt(date)).toBe('December 2024 (month 12)');
  });

  it('should format July 2025 correctly', () => {
    const date = new Date('2025-07-10');
    expect(formatCurrentDateForPrompt(date)).toBe('July 2025 (month 7)');
  });
});

describe('getResumenBancarioPrompt', () => {
  it('should mention three-tier approach', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('TIER 1');
    expect(prompt).toContain('TIER 2');
    expect(prompt).toContain('TIER 3');
  });

  it('should prioritize clear labels first in tier 1', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('CLEAR LABELS');
    expect(prompt).toContain('Period headers');
    expect(prompt).toContain('Month-Year headers');
  });

  it('should describe transaction dates in tier 2', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('TRANSACTION DATES');
  });

  it('should describe dynamic inference in tier 3', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('DYNAMIC INFERENCE');
    expect(prompt).toContain('SIN MOVIMIENTOS');
  });

  it('should inject dynamic current date for tier 3 fallback', () => {
    const jan2025 = new Date('2025-01-15');
    const prompt = getResumenBancarioPrompt(jan2025);
    expect(prompt).toMatch(/Current date: January 2025/);
  });

  it('should inject different date when provided different date', () => {
    const dec2024 = new Date('2024-12-20');
    const prompt = getResumenBancarioPrompt(dec2024);
    expect(prompt).toMatch(/Current date: December 2024/);
  });

  it('should produce different dates when called with different dates', () => {
    // Verify dynamic behavior by testing two different dates
    const jan2025Prompt = getResumenBancarioPrompt(new Date('2025-01-15'));
    const dec2024Prompt = getResumenBancarioPrompt(new Date('2024-12-20'));

    // Check that the "Current date:" line contains the correct dynamic date
    expect(jan2025Prompt).toMatch(/Current date: January 2025/);
    expect(dec2024Prompt).toMatch(/Current date: December 2024/);
  });

  it('should use current date when no argument provided', () => {
    const prompt = getResumenBancarioPrompt();
    const now = new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const expectedMonth = months[now.getMonth()];
    const expectedYear = now.getFullYear();
    expect(prompt).toContain(`${expectedMonth} ${expectedYear}`);
  });

  it('should include required field descriptions', () => {
    const prompt = getResumenBancarioPrompt();
    expect(prompt).toContain('banco');
    expect(prompt).toContain('numeroCuenta');
    expect(prompt).toContain('fechaDesde');
    expect(prompt).toContain('fechaHasta');
    expect(prompt).toContain('saldoInicial');
    expect(prompt).toContain('saldoFinal');
    expect(prompt).toContain('moneda');
    expect(prompt).toContain('cantidadMovimientos');
  });
});

describe('getResumenTarjetaPrompt', () => {
  it('should mention three-tier approach', () => {
    const prompt = getResumenTarjetaPrompt();
    expect(prompt).toContain('TIER 1');
    expect(prompt).toContain('TIER 2');
    expect(prompt).toContain('TIER 3');
  });

  it('should prioritize clear labels first', () => {
    const prompt = getResumenTarjetaPrompt();
    expect(prompt).toContain('CLEAR LABELS');
    expect(prompt).toContain('CIERRE ACTUAL');
  });

  it('should inject dynamic current date', () => {
    // Use mid-month to avoid timezone issues with date parsing
    const jul2025 = new Date('2025-07-15');
    const prompt = getResumenTarjetaPrompt(jul2025);
    expect(prompt).toMatch(/Current date: July 2025/);
  });

  it('should produce different dates when called with different dates', () => {
    const jan2025Prompt = getResumenTarjetaPrompt(new Date('2025-01-15'));
    const oct2025Prompt = getResumenTarjetaPrompt(new Date('2025-10-20'));

    expect(jan2025Prompt).toMatch(/Current date: January 2025/);
    expect(oct2025Prompt).toMatch(/Current date: October 2025/);
  });

  it('should include card-specific fields', () => {
    const prompt = getResumenTarjetaPrompt();
    expect(prompt).toContain('tipoTarjeta');
    expect(prompt).toContain('Visa');
    expect(prompt).toContain('Mastercard');
    expect(prompt).toContain('pagoMinimo');
    expect(prompt).toContain('saldoActual');
  });
});

describe('getResumenBrokerPrompt', () => {
  it('should mention three-tier approach', () => {
    const prompt = getResumenBrokerPrompt();
    expect(prompt).toContain('TIER 1');
    expect(prompt).toContain('TIER 2');
    expect(prompt).toContain('TIER 3');
  });

  it('should prioritize clear labels first', () => {
    const prompt = getResumenBrokerPrompt();
    expect(prompt).toContain('CLEAR LABELS');
    expect(prompt).toContain('Period headers');
  });

  it('should inject dynamic current date', () => {
    const mar2025 = new Date('2025-03-15');
    const prompt = getResumenBrokerPrompt(mar2025);
    expect(prompt).toMatch(/Current date: March 2025/);
  });

  it('should produce different dates when called with different dates', () => {
    const jan2025Prompt = getResumenBrokerPrompt(new Date('2025-01-15'));
    const jul2025Prompt = getResumenBrokerPrompt(new Date('2025-07-20'));

    expect(jan2025Prompt).toMatch(/Current date: January 2025/);
    expect(jul2025Prompt).toMatch(/Current date: July 2025/);
  });

  it('should include broker-specific fields', () => {
    const prompt = getResumenBrokerPrompt();
    expect(prompt).toContain('broker');
    expect(prompt).toContain('Comitente');
    expect(prompt).toContain('saldoARS');
    expect(prompt).toContain('saldoUSD');
  });
});
