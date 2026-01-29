/**
 * Unit tests for type definitions
 * Tests type validation and utilities
 */

import { describe, it, expect } from 'vitest';
import type {
  DocumentType,
  SortDestination,
  ResumenBancario,
  FolderStructure,
} from './index.js';

describe('DocumentType', () => {
  it('accepts all valid document types', () => {
    const validTypes: DocumentType[] = [
      'factura_emitida',
      'factura_recibida',
      'pago_enviado',
      'pago_recibido',
      'resumen_bancario',
      'recibo',
      'unrecognized',
      'unknown',
    ];

    // Type system validates these at compile time
    // At runtime, we just verify they're strings
    validTypes.forEach(type => {
      expect(typeof type).toBe('string');
    });
  });

  it('differentiates between emitida and recibida facturas', () => {
    const emitida: DocumentType = 'factura_emitida';
    const recibida: DocumentType = 'factura_recibida';

    expect(emitida).not.toBe(recibida);
    expect(emitida).toBe('factura_emitida');
    expect(recibida).toBe('factura_recibida');
  });

  it('differentiates between enviado and recibido pagos', () => {
    const enviado: DocumentType = 'pago_enviado';
    const recibido: DocumentType = 'pago_recibido';

    expect(enviado).not.toBe(recibido);
    expect(enviado).toBe('pago_enviado');
    expect(recibido).toBe('pago_recibido');
  });
});

describe('SortDestination', () => {
  it('accepts all valid sort destinations', () => {
    const validDestinations: SortDestination[] = [
      'ingresos',
      'egresos',
      'bancos',
      'sin_procesar',
    ];

    validDestinations.forEach(dest => {
      expect(typeof dest).toBe('string');
    });
  });

  it('uses ingresos instead of cobros', () => {
    const dest: SortDestination = 'ingresos';
    expect(dest).toBe('ingresos');
  });

  it('uses egresos instead of pagos', () => {
    const dest: SortDestination = 'egresos';
    expect(dest).toBe('egresos');
  });

  it('has bancos destination for bank statements', () => {
    const dest: SortDestination = 'bancos';
    expect(dest).toBe('bancos');
  });
});

describe('ResumenBancario', () => {
  it('has all required fields', () => {
    const resumen: ResumenBancario = {
      fileId: 'file-123',
      fileName: 'resumen.pdf',
      banco: 'BBVA',
      fechaDesde: '2024-01-01',
      fechaHasta: '2024-01-31',
      saldoInicial: 100000,
      saldoFinal: 150000,
      moneda: 'ARS',
      cantidadMovimientos: 25,
      processedAt: new Date().toISOString(),
      confidence: 0.95,
      needsReview: false,
    };

    expect(resumen.banco).toBe('BBVA');
    expect(resumen.fechaDesde).toBe('2024-01-01');
    expect(resumen.fechaHasta).toBe('2024-01-31');
    expect(resumen.saldoInicial).toBe(100000);
    expect(resumen.saldoFinal).toBe(150000);
    expect(resumen.moneda).toBe('ARS');
    expect(resumen.cantidadMovimientos).toBe(25);
  });

  it('supports USD currency', () => {
    const resumen: ResumenBancario = {
      fileId: 'file-456',
      fileName: 'resumen-usd.pdf',
      banco: 'Santander',
      fechaDesde: '2024-02-01',
      fechaHasta: '2024-02-29',
      saldoInicial: 5000,
      saldoFinal: 6200,
      moneda: 'USD',
      cantidadMovimientos: 10,
      processedAt: new Date().toISOString(),
      confidence: 0.9,
      needsReview: false,
    };

    expect(resumen.moneda).toBe('USD');
  });
});

describe('FolderStructure', () => {
  it('has renamed fields for ingresos and egresos', () => {
    const structure: FolderStructure = {
      rootId: 'root-id',
      entradaId: 'entrada-id',
      sinProcesarId: 'sin-procesar-id',
      controlIngresosId: 'control-ingresos-id',
      controlEgresosId: 'control-egresos-id',
      dashboardOperativoId: 'dashboard-id',
      bankSpreadsheets: new Map(),
      yearFolders: new Map(),
      classificationFolders: new Map(),
      monthFolders: new Map(),
      lastRefreshed: new Date(),
    };

    expect(structure.controlIngresosId).toBe('control-ingresos-id');
    expect(structure.controlEgresosId).toBe('control-egresos-id');
  });
});
