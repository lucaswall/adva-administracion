/**
 * Unit tests for bank movement matcher
 */

import { describe, it, expect } from 'vitest';
import {
  extractCuitFromConcepto,
  isBankFee,
  isCreditCardPayment,
  isDirectDebit,
  extractKeywordTokens,
  calculateKeywordMatchScore,
  BankMovementMatcher
} from '../../../src/bank/matcher';
import type { BankMovement, Factura, Pago, Recibo } from '../../../src/types/index';

describe('extractCuitFromConcepto', () => {
  it('extracts CUIT with explicit prefix "CUIT 30-71234567-1"', () => {
    expect(extractCuitFromConcepto('CUIT 30-71234567-1')).toBe('30712345671');
  });

  it('extracts CUIT with explicit prefix "CUIT: 20123456786"', () => {
    expect(extractCuitFromConcepto('CUIT: 20123456786')).toBe('20123456786');
  });

  it('extracts CUIL with explicit prefix "CUIL 27-23456789-1"', () => {
    expect(extractCuitFromConcepto('CUIL 27-23456789-1')).toBe('27234567891');
  });

  it('extracts CUIT from bank transfer text "TRANSFERENCI 30709076783"', () => {
    expect(extractCuitFromConcepto('TRANSFERENCI 30709076783')).toBe('30709076783');
  });

  it('extracts CUIT with separators "30-71234567-1"', () => {
    expect(extractCuitFromConcepto('Pago a 30-71234567-1')).toBe('30712345671');
  });

  it('extracts plain 11-digit valid CUIT "20123456786"', () => {
    expect(extractCuitFromConcepto('REF 20123456786 PAGO')).toBe('20123456786');
  });

  it('returns undefined for invalid 11-digit number (bad checksum)', () => {
    expect(extractCuitFromConcepto('Number 12345678901')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractCuitFromConcepto('')).toBeUndefined();
  });

  it('returns undefined for text without CUIT', () => {
    expect(extractCuitFromConcepto('COMISION BANCARIA MENSUAL')).toBeUndefined();
  });

  it('handles spaces in CUIT "20 12345678 6"', () => {
    expect(extractCuitFromConcepto('CUIT 20 12345678 6')).toBe('20123456786');
  });

  it('extracts first valid CUIT when multiple numbers present', () => {
    const result = extractCuitFromConcepto('REF 123 CUIT 30709076783 MONTO 5000');
    expect(result).toBe('30709076783');
  });
});

describe('isBankFee', () => {
  it('detects IMPUESTO LEY pattern', () => {
    expect(isBankFee('IMPUESTO LEY 30/12/24 00002')).toBe(true);
  });

  it('detects IMPUESTO LEY pattern with different date format', () => {
    expect(isBankFee('IMPUESTO LEY 03/11/25 00014')).toBe(true);
  });

  it('detects IMP.LEY 25413 pattern', () => {
    expect(isBankFee('IMP.LEY 25413 01/07/25 00002')).toBe(true);
  });

  it('detects LEY NRO 25.4 pattern', () => {
    expect(isBankFee('LEY NRO 25.4 07/01/25 00017')).toBe(true);
  });

  it('detects LEY NRO 25.413 pattern', () => {
    expect(isBankFee('LEY NRO 25.413 SOBRE CREDIT')).toBe(true);
  });

  it('detects COMISION MAN pattern', () => {
    expect(isBankFee('COMISION MAN 12/24')).toBe(true);
  });

  it('detects COM MANT MENS pattern', () => {
    expect(isBankFee('COM MANT MENS CTA CORRIENTE 06/25')).toBe(true);
  });

  it('detects COMISION MOV pattern', () => {
    expect(isBankFee('COMISION MOV 02/25')).toBe(true);
  });

  it('detects COMISION TRA pattern', () => {
    expect(isBankFee('COMISION TRA 20666666665')).toBe(true);
  });

  it('detects COMI TRANSFERENCIA pattern', () => {
    expect(isBankFee('COMI TRANSFERENCIA')).toBe(true);
  });

  it('detects COM.TRANSF pattern', () => {
    expect(isBankFee('COM.TRANSF COMISION')).toBe(true);
  });

  it('detects COMISION POR TRANSFERENCIA pattern', () => {
    expect(isBankFee('COMISION POR TRANSFERENCIA')).toBe(true);
  });

  it('detects IVA TASA GRA pattern', () => {
    expect(isBankFee('IVA TASA GRA')).toBe(true);
  });

  it('detects IVA TASA GENERAL pattern', () => {
    expect(isBankFee('IVA TASA GENERAL')).toBe(true);
  });

  it('detects COMISION GES pattern', () => {
    expect(isBankFee('COMISION GES')).toBe(true);
  });

  it('detects GP-COM.OPAGO pattern', () => {
    expect(isBankFee('GP-COM.OPAGO 4083953.01.8584')).toBe(true);
  });

  it('detects GP-IVA TASA pattern', () => {
    expect(isBankFee('GP-IVA TASA  4083953.01.8584')).toBe(true);
  });

  it('returns false for transfer with CUIT', () => {
    expect(isBankFee('TRANSFERENCI 30709076783')).toBe(false);
  });

  it('returns false for regular payment', () => {
    expect(isBankFee('PAGO A PROVEEDOR')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBankFee('')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isBankFee('impuesto ley 12/24')).toBe(true);
    expect(isBankFee('COMISION man 01/25')).toBe(true);
  });
});

describe('isCreditCardPayment', () => {
  it('detects "PAGO TARJETA" pattern with number', () => {
    expect(isCreditCardPayment('PAGO TARJETA 000000941198918')).toBe(true);
  });

  it('detects "PAGO TARJETA" with different number format', () => {
    expect(isCreditCardPayment('PAGO TARJETA 123456789')).toBe(true);
  });

  it('returns false for regular payments', () => {
    expect(isCreditCardPayment('PAGO A PROVEEDOR')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCreditCardPayment('')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isCreditCardPayment('pago tarjeta 123456')).toBe(true);
    expect(isCreditCardPayment('Pago Tarjeta 789012')).toBe(true);
  });
});

describe('isDirectDebit', () => {
  it('detects "DEBITO DI" pattern', () => {
    expect(isDirectDebit('OG-DEBITO DI 20751CUOTA RFEC')).toBe(true);
  });

  it('detects "DEBITO DIRECTO" pattern', () => {
    expect(isDirectDebit('DEBITO DIRECTO SERVICIO')).toBe(true);
  });

  it('detects "DEBITO AUTOMATICO" pattern', () => {
    expect(isDirectDebit('DEBITO AUTOMATICO LUZ')).toBe(true);
  });

  it('detects "DEB AUT" pattern', () => {
    expect(isDirectDebit('DEB AUT TELEFONO')).toBe(true);
  });

  it('detects "DEB.AUT" pattern', () => {
    expect(isDirectDebit('DEB.AUT GAS')).toBe(true);
  });

  it('returns false for regular transfers', () => {
    expect(isDirectDebit('TRANSFERENCI 30709076783')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isDirectDebit('')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isDirectDebit('debito di 12345')).toBe(true);
    expect(isDirectDebit('Debito Directo')).toBe(true);
  });
});

describe('extractKeywordTokens', () => {
  it('extracts meaningful tokens from bank concept', () => {
    const tokens = extractKeywordTokens('OG-DEBITO DI 20751CUOTA RFEC');
    // Splits alphanumeric "20751CUOTA" into "20751" (filtered as number) and "CUOTA"
    expect(tokens).toContain('CUOTA');
    expect(tokens).toContain('RFEC');
    expect(tokens).not.toContain('20751CUOTA');
  });

  it('filters out bank jargon', () => {
    const tokens = extractKeywordTokens('DEBITO TRANSFERENCIA PAGO SERVICIO');
    expect(tokens).not.toContain('DEBITO');
    expect(tokens).not.toContain('TRANSFERENCIA');
    expect(tokens).not.toContain('PAGO');
    expect(tokens).toContain('SERVICIO');
  });

  it('filters out short words (< 3 chars)', () => {
    const tokens = extractKeywordTokens('EL DE LA SERVICIO');
    expect(tokens).not.toContain('EL');
    expect(tokens).not.toContain('DE');
    expect(tokens).not.toContain('LA');
    expect(tokens).toContain('SERVICIO');
  });

  it('filters out pure numbers', () => {
    const tokens = extractKeywordTokens('REF 12345 SERVICIO 67890');
    expect(tokens).not.toContain('12345');
    expect(tokens).not.toContain('67890');
    expect(tokens).toContain('SERVICIO');
  });

  it('returns empty array for empty string', () => {
    expect(extractKeywordTokens('')).toEqual([]);
  });

  it('handles concepts with only jargon/short words', () => {
    const tokens = extractKeywordTokens('OG DI 123');
    expect(tokens).toEqual([]);
  });
});

describe('calculateKeywordMatchScore', () => {
  it('scores match in emisor name', () => {
    const score = calculateKeywordMatchScore(
      'OG-DEBITO DI FEDERAL',
      'FEDERACION RED FEDERAL',
      'Cuota Social'
    );
    expect(score).toBe(2); // FEDERAL in emisor
  });

  it('scores match in factura concepto', () => {
    const score = calculateKeywordMatchScore(
      'OG-DEBITO DI CUOTA',
      'Some Company SA',
      'Cuota Social F'
    );
    expect(score).toBe(2); // CUOTA in concepto
  });

  it('scores matches in both emisor and concepto', () => {
    const score = calculateKeywordMatchScore(
      'OG-DEBITO DI FEDERAL CUOTA',
      'FEDERACION RED FEDERAL',
      'Cuota Social'
    );
    expect(score).toBe(4); // FEDERAL in emisor + CUOTA in concepto
  });

  it('returns 0 for no matches', () => {
    const score = calculateKeywordMatchScore(
      'SERVICIO XYZ',
      'Company ABC',
      'Service 123'
    );
    expect(score).toBe(0);
  });

  it('handles missing factura concepto', () => {
    const score = calculateKeywordMatchScore(
      'OG-DEBITO DI FEDERAL',
      'FEDERACION RED FEDERAL',
      undefined
    );
    expect(score).toBe(2);
  });

  it('is case insensitive', () => {
    const score = calculateKeywordMatchScore(
      'cuota federal',
      'FEDERACION RED FEDERAL',
      'Cuota Social'
    );
    expect(score).toBe(4);
  });

  it('handles accented characters', () => {
    const score = calculateKeywordMatchScore(
      'ECONOMÍA',
      'RED FEDERAL DE LA ECONOMIA',
      ''
    );
    expect(score).toBe(2);
  });
});

describe('BankMovementMatcher', () => {
  const matcher = new BankMovementMatcher();

  // Helper to create a test movement
  const createMovement = (overrides: Partial<BankMovement> = {}): BankMovement => ({
    row: 13,
    fecha: '2025-01-07',
    fechaValor: '2025-01-07',
    concepto: 'TRANSFERENCI 30712345671',
    codigo: '319',
    oficina: '500',
    areaAdva: 'E',
    credito: null,
    debito: 100000,
    detalle: '',
    ...overrides
  });

  // Helper to create a test factura
  const createFactura = (overrides: Partial<Factura & { row: number }> = {}): Factura & { row: number } => ({
    row: 2,
    fileId: 'factura-file-id',
    fileName: 'factura.pdf',
    folderPath: '',
    tipoComprobante: 'A',
    puntoVenta: '00001',
    numeroComprobante: '00000001',
    fechaEmision: '2025-01-05',
    cuitEmisor: '30712345671',
    razonSocialEmisor: 'Proveedor SA',
    cae: '12345678901234',
    fechaVtoCae: '2025-01-15',
    importeNeto: 82644.63,
    importeIva: 17355.37,
    importeTotal: 100000,
    moneda: 'ARS',
    concepto: 'Servicios de consultoría',
    processedAt: '2025-01-06T10:00:00Z',
    confidence: 0.95,
    needsReview: false,
    ...overrides
  });

  // Helper to create a test pago
  const createPago = (overrides: Partial<Pago & { row: number }> = {}): Pago & { row: number } => ({
    row: 2,
    fileId: 'pago-file-id',
    fileName: 'pago.pdf',
    folderPath: '',
    banco: 'BBVA',
    fechaPago: '2025-01-07',
    importePagado: 100000,
    cuitBeneficiario: '30712345671',
    nombreBeneficiario: 'Proveedor SA',
    processedAt: '2025-01-07T10:00:00Z',
    confidence: 0.9,
    needsReview: false,
    ...overrides
  });

  // Helper to create a test recibo
  const createRecibo = (overrides: Partial<Recibo & { row: number }> = {}): Recibo & { row: number } => ({
    row: 2,
    fileId: 'recibo-file-id',
    fileName: 'recibo.pdf',
    folderPath: '',
    tipoRecibo: 'sueldo',
    nombreEmpleado: 'Juan Pérez',
    cuilEmpleado: '20123456786',
    legajo: '001',
    cuitEmpleador: '30709076783',
    periodoAbonado: 'diciembre/2024',
    fechaPago: '2025-01-07',
    subtotalRemuneraciones: 500000,
    subtotalDescuentos: 85000,
    totalNeto: 415000,
    processedAt: '2025-01-07T10:00:00Z',
    confidence: 0.9,
    needsReview: false,
    ...overrides
  });

  describe('Pago → Factura matching (BEST)', () => {
    it('matches movement to Pago with linked Factura', () => {
      const movement = createMovement({ debito: 100000 });
      const factura = createFactura({ importeTotal: 100000 });
      const pago = createPago({
        importePagado: 100000,
        matchedFacturaFileId: factura.fileId
      });

      const result = matcher.matchMovement(movement, [factura], [], [pago]);

      expect(result.matchType).toBe('pago_factura');
      expect(result.description).toContain('Proveedor SA');
      expect(result.description).toContain('Servicios de consultoría');
      expect(result.confidence).toBe('HIGH');
    });

    it('uses Factura concepto in description', () => {
      const movement = createMovement({ debito: 50000 });
      const factura = createFactura({
        importeTotal: 50000,
        concepto: 'Diseño gráfico para campaña'
      });
      const pago = createPago({
        importePagado: 50000,
        matchedFacturaFileId: factura.fileId
      });

      const result = matcher.matchMovement(movement, [factura], [], [pago]);

      expect(result.matchType).toBe('pago_factura');
      expect(result.description).toBe('Pago Factura a Proveedor SA - Diseño gráfico para campaña');
    });
  });

  describe('Direct Factura matching', () => {
    it('matches movement to Factura by amount + date + CUIT', () => {
      const movement = createMovement({
        debito: 100000,
        concepto: 'TRANSFERENCI 30712345671'
      });
      const factura = createFactura({
        importeTotal: 100000,
        cuitEmisor: '30712345671'
      });

      const result = matcher.matchMovement(movement, [factura], [], []);

      expect(result.matchType).toBe('direct_factura');
      expect(result.description).toContain('Proveedor SA');
      expect(result.extractedCuit).toBe('30712345671');
      expect(result.confidence).toBe('HIGH');
    });

    it('does not match Factura without CUIT match', () => {
      const movement = createMovement({
        debito: 100000,
        concepto: 'TRANSFERENCIA GENERAL'
      });
      const factura = createFactura({ importeTotal: 100000 });

      const result = matcher.matchMovement(movement, [factura], [], []);

      expect(result.matchType).toBe('no_match');
      expect(result.description).toBe('');
    });

    it('matches direct debit by keyword when no CUIT in concepto', () => {
      // Simulates: OG-DEBITO DI 20751CUOTA RFEC → FEDERACION RED FEDERAL
      const movement = createMovement({
        debito: 291008,
        fecha: '2025-10-13',
        fechaValor: '2025-10-13',
        concepto: 'OG-DEBITO DI 20751CUOTA RFEC'
      });
      const factura = createFactura({
        importeTotal: 291008,
        fechaEmision: '2025-10-08',
        cuitEmisor: '30718686004',
        razonSocialEmisor: 'FEDERACION RED FEDERAL',
        concepto: 'Cuota Social F Mes: Octubre/2025'
      });

      const result = matcher.matchMovement(movement, [factura], [], []);

      expect(result.matchType).toBe('direct_factura');
      expect(result.description).toContain('FEDERACION RED FEDERAL');
      expect(result.confidence).toBe('MEDIUM'); // Keyword match = MEDIUM confidence
      expect(result.reasons).toContain('Keyword match (score: 2)');
      expect(result.reasons).toContain('Direct debit without CUIT');
    });

    it('does not keyword match for non-direct-debit movements', () => {
      const movement = createMovement({
        debito: 291008,
        fecha: '2025-10-13',
        concepto: 'PAGO CUOTA FEDERAL' // Not a direct debit pattern
      });
      const factura = createFactura({
        importeTotal: 291008,
        fechaEmision: '2025-10-08',
        razonSocialEmisor: 'FEDERACION RED FEDERAL',
        concepto: 'Cuota Social F'
      });

      const result = matcher.matchMovement(movement, [factura], [], []);

      // Should not match because it's not a direct debit
      expect(result.matchType).toBe('no_match');
    });

    it('prefers CUIT match over keyword match', () => {
      const movement = createMovement({
        debito: 100000,
        concepto: 'OG-DEBITO DI FEDERAL 30712345671' // Has CUIT
      });
      const factura = createFactura({
        importeTotal: 100000,
        cuitEmisor: '30712345671',
        razonSocialEmisor: 'FEDERACION RED FEDERAL'
      });

      const result = matcher.matchMovement(movement, [factura], [], []);

      expect(result.matchType).toBe('direct_factura');
      expect(result.confidence).toBe('HIGH'); // CUIT match = HIGH confidence
      expect(result.reasons).toContain('CUIT match with emisor');
    });
  });

  describe('Recibo matching', () => {
    it('matches movement to Recibo by amount + date', () => {
      const movement = createMovement({
        fecha: '2025-01-07',
        debito: 415000
      });
      const recibo = createRecibo({
        totalNeto: 415000,
        fechaPago: '2025-01-07'
      });

      const result = matcher.matchMovement(movement, [], [recibo], []);

      expect(result.matchType).toBe('recibo');
      expect(result.description).toBe('Sueldo diciembre/2024 - Juan Pérez');
      expect(result.confidence).toBe('HIGH');
    });

    it('includes periodo and nombre in Recibo description', () => {
      const movement = createMovement({ debito: 350000 });
      const recibo = createRecibo({
        totalNeto: 350000,
        nombreEmpleado: 'María García',
        periodoAbonado: 'enero/2025'
      });

      const result = matcher.matchMovement(movement, [], [recibo], []);

      expect(result.matchType).toBe('recibo');
      expect(result.description).toBe('Sueldo enero/2025 - María García');
    });
  });

  describe('Pago-only matching (REVISAR)', () => {
    it('matches movement to Pago without linked Factura', () => {
      const movement = createMovement({ debito: 75000 });
      const pago = createPago({
        importePagado: 75000,
        nombreBeneficiario: 'Consultor Externo',
        cuitBeneficiario: '20301234567'
        // No matchedFacturaFileId
      });

      const result = matcher.matchMovement(movement, [], [], [pago]);

      expect(result.matchType).toBe('pago_only');
      expect(result.description).toContain('REVISAR!');
      expect(result.description).toContain('Consultor Externo');
      expect(result.description).toContain('20301234567');
      expect(result.confidence).toBe('LOW');
    });
  });

  describe('No match', () => {
    it('returns no_match when no documents match', () => {
      const movement = createMovement({ debito: 999999 });
      const factura = createFactura({ importeTotal: 100000 });
      const pago = createPago({ importePagado: 50000 });

      const result = matcher.matchMovement(movement, [factura], [], [pago]);

      expect(result.matchType).toBe('no_match');
      expect(result.description).toBe('');
    });

    it('returns no_match when movement has no debit', () => {
      const movement = createMovement({ debito: null });

      const result = matcher.matchMovement(movement, [], [], []);

      expect(result.matchType).toBe('no_match');
      expect(result.reasons).toContain('No debit amount');
    });

    it('returns no_match when movement has zero debit', () => {
      const movement = createMovement({ debito: 0 });

      const result = matcher.matchMovement(movement, [], [], []);

      expect(result.matchType).toBe('no_match');
    });
  });

  describe('Date matching', () => {
    it('matches Pago within ±1 day of movement date', () => {
      const movement = createMovement({
        fecha: '2025-01-07',
        debito: 100000
      });
      const pago = createPago({
        importePagado: 100000,
        fechaPago: '2025-01-08', // 1 day after
        matchedFacturaFileId: 'factura-id'
      });
      const factura = createFactura({
        fileId: 'factura-id',
        importeTotal: 100000
      });

      const result = matcher.matchMovement(movement, [factura], [], [pago]);

      expect(result.matchType).toBe('pago_factura');
    });

    it('does not match Pago more than 1 day from movement date', () => {
      const movement = createMovement({
        fecha: '2025-01-07',
        fechaValor: '2025-01-07',
        debito: 100000
      });
      const pago = createPago({
        importePagado: 100000,
        fechaPago: '2025-01-10', // 3 days after
        matchedFacturaFileId: 'factura-id'
      });
      const factura = createFactura({
        fileId: 'factura-id',
        importeTotal: 100000,
        cuitEmisor: '30712345671'
      });

      const result = matcher.matchMovement(movement, [factura], [], [pago]);

      // Should fall through to direct factura match if CUIT matches
      expect(result.matchType).toBe('direct_factura');
    });
  });

  describe('Amount matching with tolerance', () => {
    it('matches amounts within 1 peso tolerance', () => {
      const movement = createMovement({ debito: 100000.00 });
      const pago = createPago({
        importePagado: 100000.50, // Within tolerance (0.50 peso difference)
        matchedFacturaFileId: 'factura-id'
      });
      const factura = createFactura({
        fileId: 'factura-id',
        importeTotal: 100000
      });

      const result = matcher.matchMovement(movement, [factura], [], [pago]);

      expect(result.matchType).toBe('pago_factura');
    });

    it('does not match amounts outside 1 peso tolerance', () => {
      const movement = createMovement({ debito: 100000.00 });
      const pago = createPago({
        importePagado: 100002.00, // Outside tolerance (2 pesos difference)
        matchedFacturaFileId: 'factura-id'
      });

      const result = matcher.matchMovement(movement, [], [], [pago]);

      expect(result.matchType).toBe('no_match');
    });
  });

  describe('Priority order', () => {
    it('identifies bank fees before any document matching (Priority 0)', () => {
      const movement = createMovement({
        debito: 300,
        concepto: 'COMISION TRA 20666666665'
      });

      // Even with matching documents available, should return bank fee
      const factura = createFactura({
        importeTotal: 300,
        cuitEmisor: '20666666665',
        razonSocialEmisor: 'Some Provider'
      });

      const result = matcher.matchMovement(movement, [factura], [], []);

      expect(result.matchType).toBe('bank_fee');
      expect(result.description).toBe('Gastos bancarios');
      expect(result.confidence).toBe('HIGH');
    });

    it('identifies bank fees with credits (credito field)', () => {
      const movement = createMovement({
        debito: null,
        credito: 150,
        concepto: 'COMISION MAN 12345'
      });

      const result = matcher.matchMovement(movement, [], [], []);

      expect(result.matchType).toBe('bank_fee');
      expect(result.description).toBe('Gastos bancarios');
      expect(result.confidence).toBe('HIGH');
    });

    it('identifies credit card payments before any document matching (Priority 0.5)', () => {
      const movement = createMovement({
        debito: 150000,
        concepto: 'PAGO TARJETA 000000941198918'
      });

      // Even with matching documents available, should return credit card payment
      const factura = createFactura({
        importeTotal: 150000,
        cuitEmisor: '30712345671',
        razonSocialEmisor: 'Some Provider'
      });

      const result = matcher.matchMovement(movement, [factura], [], []);

      expect(result.matchType).toBe('credit_card_payment');
      expect(result.description).toBe('Pago de tarjeta de credito');
      expect(result.confidence).toBe('HIGH');
    });

    it('prefers Pago→Factura over direct Factura', () => {
      const movement = createMovement({
        debito: 100000,
        concepto: 'TRANSFERENCI 30712345671'
      });

      // Direct factura match available
      const directFactura = createFactura({
        fileId: 'direct-factura-id',
        importeTotal: 100000,
        cuitEmisor: '30712345671',
        razonSocialEmisor: 'Direct Match SA'
      });

      // Pago→Factura match available
      const linkedFactura = createFactura({
        fileId: 'linked-factura-id',
        importeTotal: 100000,
        cuitEmisor: '30712345671',
        razonSocialEmisor: 'Linked Match SA'
      });
      const pago = createPago({
        importePagado: 100000,
        matchedFacturaFileId: 'linked-factura-id'
      });

      const result = matcher.matchMovement(
        movement,
        [directFactura, linkedFactura],
        [],
        [pago]
      );

      // Should prefer Pago→Factura
      expect(result.matchType).toBe('pago_factura');
      expect(result.description).toContain('Linked Match SA');
    });

    it('prefers Factura over Recibo when both match', () => {
      const movement = createMovement({
        debito: 100000,
        concepto: 'TRANSFERENCI 30712345671'
      });

      const factura = createFactura({
        importeTotal: 100000,
        cuitEmisor: '30712345671'
      });

      const recibo = createRecibo({
        totalNeto: 100000
      });

      const result = matcher.matchMovement(movement, [factura], [recibo], []);

      expect(result.matchType).toBe('direct_factura');
    });

    it('prefers Recibo over Pago-only', () => {
      const movement = createMovement({
        debito: 415000,
        concepto: 'SUELDO'
      });

      const recibo = createRecibo({
        totalNeto: 415000
      });

      const pago = createPago({
        importePagado: 415000
        // No matchedFacturaFileId
      });

      const result = matcher.matchMovement(movement, [], [recibo], [pago]);

      expect(result.matchType).toBe('recibo');
    });
  });
});
