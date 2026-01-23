/**
 * Unit tests for validation utilities
 * Migrated to Vitest from custom framework
 */

import { describe, it, expect } from 'vitest';
import {
  isValidCuit,
  formatCuit,
  isValidCae,
  isValidDni,
  formatDni,
  extractDniFromCuit,
  cuitContainsDni,
  cuitOrDniMatch,
  validateFactura,
  validatePago,
  validateRecibo,
  validateTipoComprobante,
  validateMatchConfidence,
  validateMoneda,
  validateTipoRecibo
} from '../../src/utils/validation';
import type { Factura, Pago, Recibo } from '../../src/types/index';

describe('isValidCuit', () => {
  it('returns true for valid CUIT 20-12345678-6', () => {
    // This is a valid CUIT with correct checksum
    expect(isValidCuit('20-12345678-6')).toBe(true);
  });

  it('returns true for CUIT without dashes 20123456786', () => {
    expect(isValidCuit('20123456786')).toBe(true);
  });

  it('returns true for valid CUIT 27-23456789-1', () => {
    expect(isValidCuit('27-23456789-1')).toBe(true);
  });

  it('returns true for valid CUIT 30-71234567-1', () => {
    expect(isValidCuit('30712345671')).toBe(true);
  });

  it('returns false for invalid checksum', () => {
    expect(isValidCuit('20-12345678-9')).toBe(false);
  });

  it('returns false for wrong length', () => {
    expect(isValidCuit('2012345')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidCuit('')).toBe(false);
  });

  it('returns false for non-numeric characters', () => {
    expect(isValidCuit('20-1234567A-6')).toBe(false);
  });

  it('returns false for invalid prefix 10', () => {
    // Valid checksum but invalid prefix
    expect(isValidCuit('10-12345678-8')).toBe(false);
  });

  it('returns false for invalid prefix 25', () => {
    expect(isValidCuit('25-12345678-4')).toBe(false);
  });

  it('returns true for valid prefix 23', () => {
    // 23 is valid for unisex individuals
    // Checksum: 2*5+3*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2=160, 11-(160%11)=5
    expect(isValidCuit('23-12345678-5')).toBe(true);
  });

  it('returns true for valid prefix 24', () => {
    // 24 is valid for unisex individuals
    // Checksum: 2*5+4*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2=164, 11-(164%11)=1
    expect(isValidCuit('24-12345678-1')).toBe(true);
  });

  it('returns true for valid prefix 33', () => {
    // 33 is valid for companies
    // Checksum: 3*5+3*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2=165, 11-(165%11)=0
    expect(isValidCuit('33-12345678-0')).toBe(true);
  });

  it('returns true for valid prefix 34', () => {
    // 34 is valid for companies
    // Checksum: 3*5+4*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2=169, 11-(169%11)=7
    expect(isValidCuit('34-12345678-7')).toBe(true);
  });
});

describe('formatCuit', () => {
  it('removes dashes from 20-12345678-6', () => {
    expect(formatCuit('20-12345678-6')).toBe('20123456786');
  });

  it('returns same if already 11 digits', () => {
    expect(formatCuit('20123456786')).toBe('20123456786');
  });

  it('handles spaces', () => {
    expect(formatCuit('20 12345678 6')).toBe('20123456786');
  });

  it('returns empty string for invalid input', () => {
    expect(formatCuit('')).toBe('');
  });
});

describe('isValidDni', () => {
  it('returns true for 8-digit DNI', () => {
    expect(isValidDni('40535475')).toBe(true);
  });

  it('returns true for 7-digit DNI', () => {
    expect(isValidDni('1234567')).toBe(true);
  });

  it('returns true for DNI with dots', () => {
    expect(isValidDni('40.535.475')).toBe(true);
  });

  it('returns true for DNI with spaces', () => {
    expect(isValidDni('40 535 475')).toBe(true);
  });

  it('returns false for 6-digit number (too short)', () => {
    expect(isValidDni('123456')).toBe(false);
  });

  it('returns false for 9-digit number (too long)', () => {
    expect(isValidDni('123456789')).toBe(false);
  });

  it('returns false for 11-digit CUIT', () => {
    expect(isValidDni('20405354757')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidDni('')).toBe(false);
  });

  it('returns false for non-numeric characters', () => {
    expect(isValidDni('4053547A')).toBe(false);
  });
});

describe('formatDni', () => {
  it('returns clean 8-digit DNI', () => {
    expect(formatDni('40535475')).toBe('40535475');
  });

  it('removes dots from DNI', () => {
    expect(formatDni('40.535.475')).toBe('40535475');
  });

  it('removes spaces from DNI', () => {
    expect(formatDni('40 535 475')).toBe('40535475');
  });

  it('removes dashes from DNI', () => {
    expect(formatDni('40-535-475')).toBe('40535475');
  });

  it('returns empty string for too short input', () => {
    expect(formatDni('123456')).toBe('');
  });

  it('returns empty string for too long input', () => {
    expect(formatDni('123456789')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(formatDni('')).toBe('');
  });
});

describe('extractDniFromCuit', () => {
  it('extracts DNI from CUIT 20405354757', () => {
    // CUIT: 20-40535475-7 -> DNI: 40535475
    expect(extractDniFromCuit('20405354757')).toBe('40535475');
  });

  it('extracts DNI from CUIT with dashes', () => {
    expect(extractDniFromCuit('20-40535475-7')).toBe('40535475');
  });

  it('extracts DNI from company CUIT 30709076783', () => {
    // CUIT: 30-70907678-3 -> DNI portion: 70907678
    expect(extractDniFromCuit('30709076783')).toBe('70907678');
  });

  it('handles CUIT with leading zeros in DNI portion', () => {
    // CUIT: 20-01234567-8 -> DNI: 1234567 (leading zero removed)
    expect(extractDniFromCuit('20012345678')).toBe('1234567');
  });

  it('returns empty string for invalid CUIT', () => {
    expect(extractDniFromCuit('123456')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(extractDniFromCuit('')).toBe('');
  });
});

describe('cuitContainsDni', () => {
  it('returns true when DNI matches CUIT', () => {
    // CUIT 20405354757 contains DNI 40535475
    expect(cuitContainsDni('20405354757', '40535475')).toBe(true);
  });

  it('returns true with formatted inputs', () => {
    expect(cuitContainsDni('20-40535475-7', '40.535.475')).toBe(true);
  });

  it('returns false when DNI does not match', () => {
    expect(cuitContainsDni('20405354757', '12345678')).toBe(false);
  });

  it('returns false for empty CUIT', () => {
    expect(cuitContainsDni('', '40535475')).toBe(false);
  });

  it('returns false for empty DNI', () => {
    expect(cuitContainsDni('20405354757', '')).toBe(false);
  });

  it('returns false for invalid CUIT', () => {
    expect(cuitContainsDni('123456', '40535475')).toBe(false);
  });
});

describe('cuitOrDniMatch', () => {
  it('returns true for exact CUIT match', () => {
    expect(cuitOrDniMatch('20405354757', '20405354757')).toBe(true);
  });

  it('returns true for CUIT match with dashes', () => {
    expect(cuitOrDniMatch('20-40535475-7', '20405354757')).toBe(true);
  });

  it('returns true when DNI matches CUIT (DNI first)', () => {
    expect(cuitOrDniMatch('40535475', '20405354757')).toBe(true);
  });

  it('returns true when DNI matches CUIT (CUIT first)', () => {
    expect(cuitOrDniMatch('20405354757', '40535475')).toBe(true);
  });

  it('returns true for exact DNI match', () => {
    expect(cuitOrDniMatch('40535475', '40535475')).toBe(true);
  });

  it('returns false for non-matching CUIT and DNI', () => {
    expect(cuitOrDniMatch('20405354757', '12345678')).toBe(false);
  });

  it('returns false for two different CUITs', () => {
    expect(cuitOrDniMatch('20405354757', '30709076783')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(cuitOrDniMatch('', '20405354757')).toBe(false);
    expect(cuitOrDniMatch('20405354757', '')).toBe(false);
  });

  it('handles real-world example from sample documents', () => {
    // Factura: CUIT emisor 20405354757
    // Pago: beneficiary 40535475 (DNI)
    expect(cuitOrDniMatch('20405354757', '40535475')).toBe(true);
  });
});

describe('isValidCae', () => {
  it('returns true for 14-digit CAE', () => {
    expect(isValidCae('12345678901234')).toBe(true);
  });

  it('returns false for wrong length', () => {
    expect(isValidCae('123456789012')).toBe(false);
  });

  it('returns false for non-numeric', () => {
    expect(isValidCae('1234567890123A')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidCae('')).toBe(false);
  });
});

describe('validateFactura', () => {
  const validFactura: Partial<Factura> = {
    tipoComprobante: 'A',
    nroFactura: '00001-00000001',
    fechaEmision: '2024-01-15',
    cuitEmisor: '20-12345678-6',
    razonSocialEmisor: 'Test Company SA',
    importeNeto: 1000.00,
    importeIva: 210.00,
    importeTotal: 1210.00,
    moneda: 'ARS'
  };

  it('returns valid for complete valid factura', () => {
    const result = validateFactura(validFactura);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing tipoComprobante', () => {
    const { tipoComprobante, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing tipoComprobante');
  });

  it('detects missing nroFactura', () => {
    const { nroFactura, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing nroFactura');
  });

  it('detects missing numeroComprobante (combined in nroFactura)', () => {
    const { nroFactura, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing nroFactura');
  });

  it('detects missing fechaEmision', () => {
    const { fechaEmision, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing fechaEmision');
  });

  it('detects missing cuitEmisor', () => {
    const { cuitEmisor, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing cuitEmisor');
  });

  it('detects invalid cuitEmisor', () => {
    const invalidCuit = { ...validFactura, cuitEmisor: '20-12345678-9' };
    const result = validateFactura(invalidCuit);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid cuitEmisor');
  });

  it('detects missing razonSocialEmisor', () => {
    const { razonSocialEmisor, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing razonSocialEmisor');
  });


  it('detects missing importeNeto', () => {
    const { importeNeto, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing importeNeto');
  });

  it('detects missing importeIva', () => {
    const { importeIva, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing importeIva');
  });

  it('detects missing importeTotal', () => {
    const { importeTotal, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing importeTotal');
  });

  it('detects missing moneda', () => {
    const { moneda, ...incomplete } = validFactura;
    const result = validateFactura(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing moneda');
  });

  it('accepts valid optional cuitReceptor', () => {
    const withReceptor = { ...validFactura, cuitReceptor: '27-23456789-1' };
    const result = validateFactura(withReceptor);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects invalid optional cuitReceptor', () => {
    const invalidReceptor = { ...validFactura, cuitReceptor: '27-23456789-9' };
    const result = validateFactura(invalidReceptor);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid cuitReceptor');
  });

  it('allows zero values for amounts', () => {
    const zeroAmounts = {
      ...validFactura,
      importeNeto: 0,
      importeIva: 0,
      importeTotal: 0
    };
    const result = validateFactura(zeroAmounts);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accumulates multiple errors', () => {
    const multipleErrors: Partial<Factura> = {
      tipoComprobante: 'A',
      cuitEmisor: '20-12345678-9' // invalid
      // missing most fields
    };
    const result = validateFactura(multipleErrors);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(4);
    expect(result.errors).toContain('Invalid cuitEmisor');
    expect(result.errors).toContain('Missing nroFactura');
  });
});

describe('validatePago', () => {
  const validPago: Partial<Pago> = {
    banco: 'BBVA',
    fechaPago: '2024-01-15',
    importePagado: 1210.00
  };

  it('returns valid for complete valid pago', () => {
    const result = validatePago(validPago);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing banco', () => {
    const { banco, ...incomplete } = validPago;
    const result = validatePago(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing banco');
  });

  it('detects missing fechaPago', () => {
    const { fechaPago, ...incomplete } = validPago;
    const result = validatePago(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing fechaPago');
  });

  it('detects missing importePagado', () => {
    const { importePagado, ...incomplete } = validPago;
    const result = validatePago(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing importePagado');
  });

  it('accepts valid optional cuitPagador', () => {
    const withCuit = { ...validPago, cuitPagador: '20-12345678-6' };
    const result = validatePago(withCuit);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects invalid optional cuitPagador', () => {
    const invalidCuit = { ...validPago, cuitPagador: '123' }; // too short for both CUIT and DNI
    const result = validatePago(invalidCuit);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid cuitPagador');
  });

  it('accepts valid DNI as cuitPagador', () => {
    const withDni = { ...validPago, cuitPagador: '40535475' };
    const result = validatePago(withDni);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid CUIT as cuitBeneficiario', () => {
    const withCuit = { ...validPago, cuitBeneficiario: '20-12345678-6' };
    const result = validatePago(withCuit);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid DNI as cuitBeneficiario', () => {
    const withDni = { ...validPago, cuitBeneficiario: '40535475' };
    const result = validatePago(withDni);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects invalid cuitBeneficiario', () => {
    const invalidCuit = { ...validPago, cuitBeneficiario: '123' }; // too short
    const result = validatePago(invalidCuit);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid cuitBeneficiario');
  });

  it('accepts optional fields', () => {
    const withOptionals = {
      ...validPago,
      referencia: 'REF123',
      nombrePagador: 'Test Payer',
      concepto: 'Payment for services'
    };
    const result = validatePago(withOptionals);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('allows zero value for importePagado', () => {
    const zeroAmount = { ...validPago, importePagado: 0 };
    const result = validatePago(zeroAmount);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accumulates multiple errors', () => {
    const multipleErrors: Partial<Pago> = {
      cuitPagador: '20-12345678-9' // invalid, and missing required fields
    };
    const result = validatePago(multipleErrors);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
    expect(result.errors).toContain('Invalid cuitPagador');
    expect(result.errors).toContain('Missing banco');
    expect(result.errors).toContain('Missing fechaPago');
  });
});

describe('validateTipoComprobante', () => {
  it('returns valid tipo for A', () => {
    expect(validateTipoComprobante('A')).toBe('A');
  });

  it('returns valid tipo for B', () => {
    expect(validateTipoComprobante('B')).toBe('B');
  });

  it('returns valid tipo for C', () => {
    expect(validateTipoComprobante('C')).toBe('C');
  });

  it('returns valid tipo for E', () => {
    expect(validateTipoComprobante('E')).toBe('E');
  });

  it('returns valid tipo for NC', () => {
    expect(validateTipoComprobante('NC')).toBe('NC');
  });

  it('returns valid tipo for ND', () => {
    expect(validateTipoComprobante('ND')).toBe('ND');
  });

  it('returns undefined for invalid string', () => {
    expect(validateTipoComprobante('X')).toBeUndefined();
  });

  it('returns undefined for lowercase', () => {
    expect(validateTipoComprobante('a')).toBeUndefined();
  });

  it('returns undefined for number', () => {
    expect(validateTipoComprobante(123)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(validateTipoComprobante(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(validateTipoComprobante(undefined)).toBeUndefined();
  });

  it('returns undefined for object', () => {
    expect(validateTipoComprobante({ tipo: 'A' })).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(validateTipoComprobante('')).toBeUndefined();
  });
});

describe('validateMatchConfidence', () => {
  it('returns HIGH for HIGH', () => {
    expect(validateMatchConfidence('HIGH')).toBe('HIGH');
  });

  it('returns MEDIUM for MEDIUM', () => {
    expect(validateMatchConfidence('MEDIUM')).toBe('MEDIUM');
  });

  it('returns LOW for LOW', () => {
    expect(validateMatchConfidence('LOW')).toBe('LOW');
  });

  it('returns undefined for invalid string', () => {
    expect(validateMatchConfidence('INVALID')).toBeUndefined();
  });

  it('returns undefined for lowercase', () => {
    expect(validateMatchConfidence('high')).toBeUndefined();
  });

  it('returns undefined for number', () => {
    expect(validateMatchConfidence(1)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(validateMatchConfidence(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(validateMatchConfidence(undefined)).toBeUndefined();
  });

  it('returns undefined for object', () => {
    expect(validateMatchConfidence({ level: 'HIGH' })).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(validateMatchConfidence('')).toBeUndefined();
  });
});

describe('validateMoneda', () => {
  it('returns ARS for ARS', () => {
    expect(validateMoneda('ARS')).toBe('ARS');
  });

  it('returns USD for USD', () => {
    expect(validateMoneda('USD')).toBe('USD');
  });

  it('returns undefined for invalid string', () => {
    expect(validateMoneda('EUR')).toBeUndefined();
  });

  it('returns undefined for lowercase', () => {
    expect(validateMoneda('ars')).toBeUndefined();
  });

  it('returns undefined for number', () => {
    expect(validateMoneda(100)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(validateMoneda(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(validateMoneda(undefined)).toBeUndefined();
  });

  it('returns undefined for object', () => {
    expect(validateMoneda({ currency: 'ARS' })).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(validateMoneda('')).toBeUndefined();
  });
});

describe('validateTipoRecibo', () => {
  it('returns sueldo for sueldo', () => {
    expect(validateTipoRecibo('sueldo')).toBe('sueldo');
  });

  it('returns liquidacion_final for liquidacion_final', () => {
    expect(validateTipoRecibo('liquidacion_final')).toBe('liquidacion_final');
  });

  it('returns undefined for invalid string', () => {
    expect(validateTipoRecibo('otro')).toBeUndefined();
  });

  it('returns undefined for uppercase', () => {
    expect(validateTipoRecibo('SUELDO')).toBeUndefined();
  });

  it('returns undefined for number', () => {
    expect(validateTipoRecibo(123)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(validateTipoRecibo(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(validateTipoRecibo(undefined)).toBeUndefined();
  });

  it('returns undefined for object', () => {
    expect(validateTipoRecibo({ tipo: 'sueldo' })).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(validateTipoRecibo('')).toBeUndefined();
  });
});

describe('validateRecibo', () => {
  const validRecibo: Partial<Recibo> = {
    tipoRecibo: 'sueldo',
    nombreEmpleado: 'Juan Pérez',
    cuilEmpleado: '20-12345678-6',
    legajo: '001',
    cuitEmpleador: '30-70907678-3',
    periodoAbonado: 'diciembre/2024',
    fechaPago: '2025-01-05',
    subtotalRemuneraciones: 500000,
    subtotalDescuentos: 85000,
    totalNeto: 415000
  };

  it('returns valid for complete valid recibo', () => {
    const result = validateRecibo(validRecibo);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing tipoRecibo', () => {
    const { tipoRecibo, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing tipoRecibo');
  });

  it('detects missing nombreEmpleado', () => {
    const { nombreEmpleado, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing nombreEmpleado');
  });

  it('detects missing cuilEmpleado', () => {
    const { cuilEmpleado, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing cuilEmpleado');
  });

  it('detects invalid cuilEmpleado', () => {
    const invalidCuil = { ...validRecibo, cuilEmpleado: '20-12345678-9' };
    const result = validateRecibo(invalidCuil);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid cuilEmpleado');
  });

  it('detects missing legajo', () => {
    const { legajo, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing legajo');
  });

  it('detects missing cuitEmpleador', () => {
    const { cuitEmpleador, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing cuitEmpleador');
  });

  it('detects invalid cuitEmpleador', () => {
    const invalidCuit = { ...validRecibo, cuitEmpleador: '30-70907678-9' };
    const result = validateRecibo(invalidCuit);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid cuitEmpleador');
  });

  it('detects missing periodoAbonado', () => {
    const { periodoAbonado, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing periodoAbonado');
  });

  it('detects missing fechaPago', () => {
    const { fechaPago, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing fechaPago');
  });

  it('detects missing subtotalRemuneraciones', () => {
    const { subtotalRemuneraciones, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing subtotalRemuneraciones');
  });

  it('detects missing subtotalDescuentos', () => {
    const { subtotalDescuentos, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing subtotalDescuentos');
  });

  it('detects missing totalNeto', () => {
    const { totalNeto, ...incomplete } = validRecibo;
    const result = validateRecibo(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing totalNeto');
  });

  it('allows zero values for amounts', () => {
    const zeroAmounts = {
      ...validRecibo,
      subtotalRemuneraciones: 0,
      subtotalDescuentos: 0,
      totalNeto: 0
    };
    const result = validateRecibo(zeroAmounts);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid liquidacion_final type', () => {
    const liquidacion = { ...validRecibo, tipoRecibo: 'liquidacion_final' as const };
    const result = validateRecibo(liquidacion);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accumulates multiple errors', () => {
    const multipleErrors: Partial<Recibo> = {
      tipoRecibo: 'sueldo',
      cuilEmpleado: '20-12345678-9', // invalid
      cuitEmpleador: '30-70907678-9' // invalid
      // missing most fields
    };
    const result = validateRecibo(multipleErrors);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(5);
    expect(result.errors).toContain('Invalid cuilEmpleado');
    expect(result.errors).toContain('Invalid cuitEmpleador');
    expect(result.errors).toContain('Missing nombreEmpleado');
    expect(result.errors).toContain('Missing legajo');
  });

  it('accepts valid CUILs without dashes', () => {
    const noDashes = {
      ...validRecibo,
      cuilEmpleado: '20123456786',
      cuitEmpleador: '30709076783'
    };
    const result = validateRecibo(noDashes);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
