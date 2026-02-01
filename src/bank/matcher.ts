/**
 * Bank movement matcher
 * Matches bank movements against Facturas, Recibos, and Pagos
 */

import type {
  BankMovement,
  BankMovementMatchResult,
  Factura,
  Pago,
  Recibo,
  Retencion
} from '../types/index.js';
import { parseArgDate, isWithinDays } from '../utils/date.js';
import { extractCuitFromText } from '../utils/validation.js';
import { amountsMatch } from '../utils/numbers.js';
import { amountsMatchCrossCurrency } from '../utils/exchange-rate.js';
import { warn } from '../utils/logger.js';

/**
 * Default tolerance percentage for cross-currency matching
 */
const DEFAULT_CROSS_CURRENCY_TOLERANCE = 5;

/**
 * Date range for Pago matching (tight: ±1 day)
 */
const PAGO_DATE_RANGE = 1;

/**
 * Date range for Factura/Recibo matching (looser)
 */
const FACTURA_DATE_RANGE_BEFORE = 5;
const FACTURA_DATE_RANGE_AFTER = 30;

/**
 * Date range for matching retenciones to facturas (90 days after factura)
 */
const RETENCION_DATE_RANGE_DAYS = 90;

/**
 * Direct debit patterns for automatic recognition
 * These patterns identify automatic/direct debit transactions
 */
const DIRECT_DEBIT_PATTERNS = [
  /DEBITO\s*DI\b/i,
  /DEBITO\s*DIRECTO/i,
  /DEBITO\s*AUTOMATICO/i,
  /DEB\.?\s*AUT/i,
];

/**
 * Bank jargon words to exclude from keyword matching
 */
const BANK_JARGON = new Set([
  'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'TRANSFERENCI', 'PAGO', 'COBRO',
  'OG', 'DI', 'AUT', 'AUTO', 'DIR', 'REF', 'NRO', 'NUM', 'CTA', 'CBU',
]);

/**
 * Checks if a bank concept represents a direct debit transaction
 *
 * @param concepto - Bank transaction concept text
 * @returns True if the concept matches a direct debit pattern
 */
export function isDirectDebit(concepto: string): boolean {
  if (!concepto) {
    return false;
  }
  return DIRECT_DEBIT_PATTERNS.some(pattern => pattern.test(concepto));
}

/**
 * Extracts meaningful tokens from a bank concept for keyword matching
 * Filters out numbers, short words, and bank jargon
 * Splits alphanumeric combinations (e.g., "20751CUOTA" -> ["CUOTA"])
 *
 * @param concepto - Bank transaction concept text
 * @returns Array of meaningful tokens (uppercase, normalized)
 */
export function extractKeywordTokens(concepto: string): string[] {
  if (!concepto) {
    return [];
  }

  // First split on whitespace/punctuation
  const parts = concepto
    .toUpperCase()
    .split(/[\s\-\.]+/);

  const tokens: string[] = [];

  for (const part of parts) {
    // Split alphanumeric combinations (e.g., "20751CUOTA" -> ["20751", "CUOTA"])
    // Uses lookbehind/lookahead to split at digit-to-letter or letter-to-digit boundaries
    const subparts = part.split(/(?<=\d)(?=[A-Z])|(?<=[A-Z])(?=\d)/);
    tokens.push(...subparts);
  }

  return tokens
    .filter(token => token.length >= 3)           // Skip short words
    .filter(token => !/^\d+$/.test(token))        // Skip pure numbers
    .filter(token => !BANK_JARGON.has(token))     // Skip bank jargon
    .map(token => normalizeForComparison(token)); // Normalize accents
}

/**
 * Normalizes a string for comparison by removing accents and converting to lowercase
 */
function normalizeForComparison(str: string): string {
  return str
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Calculates a keyword match score between a bank concept and a factura
 * Higher scores indicate better matches
 *
 * @param bankConcepto - Bank transaction concept text
 * @param emisorName - Factura emisor razon social
 * @param facturaConcepto - Factura concepto (optional)
 * @returns Match score (0 = no match, higher = better match)
 */
export function calculateKeywordMatchScore(
  bankConcepto: string,
  emisorName: string,
  facturaConcepto?: string
): number {
  const tokens = extractKeywordTokens(bankConcepto);
  if (tokens.length === 0) {
    return 0;
  }

  const normalizedEmisor = normalizeForComparison(emisorName);
  const normalizedConcepto = facturaConcepto ? normalizeForComparison(facturaConcepto) : '';

  let score = 0;

  for (const token of tokens) {
    // Direct word match in emisor name
    if (normalizedEmisor.includes(token)) {
      score += 2;
    }

    // Direct word match in factura concepto
    if (normalizedConcepto && normalizedConcepto.includes(token)) {
      score += 2;
    }
  }

  return score;
}

/**
 * Minimum keyword match score required for a match
 */
const MIN_KEYWORD_MATCH_SCORE = 2;

/**
 * Credit card payment patterns for automatic recognition
 * These patterns identify credit card payments
 */
const CREDIT_CARD_PAYMENT_PATTERNS = [
  /^PAGO TARJETA\s+\d+/i,
];

/**
 * Checks if a bank concept represents a credit card payment
 *
 * @param concepto - Bank transaction concept text
 * @returns True if the concept matches a credit card payment pattern
 */
export function isCreditCardPayment(concepto: string): boolean {
  if (!concepto) {
    return false;
  }
  return CREDIT_CARD_PAYMENT_PATTERNS.some(pattern => pattern.test(concepto));
}

/**
 * Bank fee patterns for automatic recognition
 * These patterns identify bank charges, commissions, taxes, and fees
 */
const BANK_FEE_PATTERNS = [
  /^IMPUESTO LEY/i,
  /^IMP\.LEY 25413/i,
  /^LEY NRO 25\.4/i,
  /^LEY NRO 25\.413/i,
  /^COMISION MAN/i,
  /^COM MANT MENS/i,
  /^COMISION MOV/i,
  /^COMISION TRA/i,
  /^COMI TRANSFERENCIA/i,
  /^COM\.TRANSF/i,
  /^COMISION POR TRANSFERENCIA/i,
  /^IVA TASA GRA/i,
  /^IVA TASA GENERAL/i,
  /^COMISION GES/i,
  /^GP-COM\.OPAGO/i,
  /^GP-IVA TASA/i,
];

/**
 * Checks if a bank concept represents a bank fee/charge
 *
 * @param concepto - Bank transaction concept text
 * @returns True if the concept matches a bank fee pattern
 */
export function isBankFee(concepto: string): boolean {
  if (!concepto) {
    return false;
  }
  return BANK_FEE_PATTERNS.some(pattern => pattern.test(concepto));
}

/** Re-export for convenience */
export const extractCuitFromConcepto = extractCuitFromText;

/**
 * Matches bank movements against Facturas, Recibos, and Pagos
 */
export class BankMovementMatcher {
  private readonly crossCurrencyTolerancePercent: number;

  /**
   * Creates a new bank movement matcher
   *
   * @param crossCurrencyTolerancePercent - Tolerance for USD→ARS matching (default: 5%)
   */
  constructor(crossCurrencyTolerancePercent: number = DEFAULT_CROSS_CURRENCY_TOLERANCE) {
    this.crossCurrencyTolerancePercent = crossCurrencyTolerancePercent;
  }

  /**
   * Matches a bank movement against all available documents
   *
   * Priority:
   * 0. Bank fees (gastos bancarios) - FIRST
   * 1. Pago with linked Factura (BEST)
   * 2. Direct Factura match
   * 3. Recibo match
   * 4. Pago without linked Factura (REVISAR)
   * 5. No match
   *
   * @param movement - Bank movement to match
   * @param facturas - All facturas from sheet
   * @param recibos - All recibos from sheet
   * @param pagos - All pagos from sheet
   * @returns Match result with generated description
   */
  matchMovement(
    movement: BankMovement,
    facturas: Array<Factura & { row: number }>,
    recibos: Array<Recibo & { row: number }>,
    pagos: Array<Pago & { row: number }>
  ): BankMovementMatchResult {
    // Priority 0: Check for bank fees FIRST (can be debito or credito)
    if (isBankFee(movement.concepto)) {
      return this.createBankFeeMatch(movement);
    }

    const amount = movement.debito;
    if (amount === null || amount === 0) {
      return this.noMatch(movement, ['No debit amount']);
    }

    // Priority 0.5: Check for credit card payments
    if (isCreditCardPayment(movement.concepto)) {
      return this.createCreditCardPaymentMatch(movement);
    }

    // Extract CUIT from concepto for matching
    const extractedCuit = extractCuitFromConcepto(movement.concepto);

    // Parse bank dates
    const bankFecha = parseArgDate(movement.fecha);
    const bankFechaValor = parseArgDate(movement.fechaValor);

    if (!bankFecha && !bankFechaValor) {
      return this.noMatch(movement, ['No valid date in movement']);
    }

    // Step 1: Try to find matching Pagos (tight date range: ±1 day)
    const matchingPagos = this.findMatchingPagos(amount, bankFecha, bankFechaValor, extractedCuit, pagos);

    // Step 2: Check if any Pago has a linked Factura (BEST MATCH)
    for (const pagoMatch of matchingPagos) {
      if (pagoMatch.pago.matchedFacturaFileId) {
        // Find the linked Factura
        const linkedFactura = facturas.find(f => f.fileId === pagoMatch.pago.matchedFacturaFileId);
        if (linkedFactura) {
          return this.createPagoFacturaMatch(movement, pagoMatch.pago, linkedFactura, extractedCuit, pagoMatch.reasons);
        } else {
          // Linked factura not found in the array - log warning and continue
          warn(
            'Linked factura not found in facturas array',
            {
              pagoFileId: pagoMatch.pago.fileId,
              matchedFacturaFileId: pagoMatch.pago.matchedFacturaFileId
            }
          );
        }
      }
    }

    // Step 3: Try direct Factura match (amount + date + CUIT or keyword for direct debits)
    const matchingFacturas = this.findMatchingFacturas(amount, bankFecha, bankFechaValor, extractedCuit, movement.concepto, facturas);
    if (matchingFacturas.length > 0) {
      const bestFactura = matchingFacturas[0];
      return this.createDirectFacturaMatch(movement, bestFactura.factura, extractedCuit, bestFactura.reasons, bestFactura.matchType);
    }

    // Step 4: Try Recibo match
    const matchingRecibos = this.findMatchingRecibos(amount, bankFecha, bankFechaValor, recibos);
    if (matchingRecibos.length > 0) {
      const bestRecibo = matchingRecibos[0];
      return this.createReciboMatch(movement, bestRecibo.recibo, extractedCuit, bestRecibo.reasons);
    }

    // Step 5: Pago without linked Factura (REVISAR)
    if (matchingPagos.length > 0) {
      const bestPago = matchingPagos[0];
      return this.createPagoOnlyMatch(movement, bestPago.pago, extractedCuit, bestPago.reasons);
    }

    // Step 6: No match
    return this.noMatch(movement, ['No matching documents found']);
  }

  /**
   * Finds pagos matching amount and date criteria (tight: ±1 day)
   */
  private findMatchingPagos(
    amount: number,
    bankFecha: Date | null,
    bankFechaValor: Date | null,
    extractedCuit: string | undefined,
    pagos: Array<Pago & { row: number }>
  ): Array<{ pago: Pago & { row: number }; reasons: string[] }> {
    const matches: Array<{ pago: Pago & { row: number }; reasons: string[]; hasCuit: boolean; dateDiff: number }> = [];

    for (const pago of pagos) {
      // Check amount match
      if (!amountsMatch(pago.importePagado, amount)) {
        continue;
      }

      // Parse pago date
      const pagoDate = parseArgDate(pago.fechaPago);
      if (!pagoDate) {
        continue;
      }

      // Check date match (±1 day from either bank date)
      let dateMatches = false;
      let dateDiff = 999;

      if (bankFecha && isWithinDays(bankFecha, pagoDate, PAGO_DATE_RANGE, PAGO_DATE_RANGE)) {
        dateMatches = true;
        dateDiff = Math.min(dateDiff, Math.abs(Math.floor((pagoDate.getTime() - bankFecha.getTime()) / (1000 * 60 * 60 * 24))));
      }
      if (bankFechaValor && isWithinDays(bankFechaValor, pagoDate, PAGO_DATE_RANGE, PAGO_DATE_RANGE)) {
        dateMatches = true;
        dateDiff = Math.min(dateDiff, Math.abs(Math.floor((pagoDate.getTime() - bankFechaValor.getTime()) / (1000 * 60 * 60 * 24))));
      }

      if (!dateMatches) {
        continue;
      }

      const reasons: string[] = [];
      reasons.push(`Amount match: ${amount}`);
      reasons.push(`Date match: Pago ${pago.fechaPago}`);

      // Check CUIT match
      let hasCuit = false;
      if (extractedCuit && pago.cuitBeneficiario === extractedCuit) {
        hasCuit = true;
        reasons.push('CUIT match with beneficiary');
      }

      matches.push({ pago, reasons, hasCuit, dateDiff });
    }

    // Sort by CUIT match first, then by date proximity
    matches.sort((a, b) => {
      if (a.hasCuit !== b.hasCuit) {
        return a.hasCuit ? -1 : 1;
      }
      return a.dateDiff - b.dateDiff;
    });

    return matches.map(m => ({ pago: m.pago, reasons: m.reasons }));
  }

  /**
   * Finds facturas matching amount, date, and CUIT/keyword criteria
   * Supports cross-currency matching for USD facturas
   * For direct debits without CUIT, falls back to keyword matching
   */
  private findMatchingFacturas(
    amount: number,
    bankFecha: Date | null,
    bankFechaValor: Date | null,
    extractedCuit: string | undefined,
    bankConcepto: string,
    facturas: Array<Factura & { row: number }>
  ): Array<{ factura: Factura & { row: number }; reasons: string[]; matchType: 'cuit' | 'keyword' }> {
    const matches: Array<{ factura: Factura & { row: number }; reasons: string[]; hasCuit: boolean; hasKeyword: boolean; keywordScore: number; dateDiff: number }> = [];

    // Check if this is a direct debit (for keyword matching fallback)
    const isDirectDebitMovement = isDirectDebit(bankConcepto);

    for (const factura of facturas) {
      // Check amount match (supports cross-currency for USD facturas)
      const crossCurrencyResult = amountsMatchCrossCurrency(
        factura.importeTotal,
        factura.moneda,
        factura.fechaEmision,
        amount,
        this.crossCurrencyTolerancePercent
      );

      if (!crossCurrencyResult.matches) {
        continue;
      }

      // Parse factura date
      const facturaDate = parseArgDate(factura.fechaEmision);
      if (!facturaDate) {
        continue;
      }

      // Check date match (bank date should be after or near factura date)
      let dateMatches = false;
      let dateDiff = 999;

      if (bankFecha && isWithinDays(facturaDate, bankFecha, FACTURA_DATE_RANGE_BEFORE, FACTURA_DATE_RANGE_AFTER)) {
        dateMatches = true;
        dateDiff = Math.min(dateDiff, Math.abs(Math.floor((bankFecha.getTime() - facturaDate.getTime()) / (1000 * 60 * 60 * 24))));
      }
      if (bankFechaValor && isWithinDays(facturaDate, bankFechaValor, FACTURA_DATE_RANGE_BEFORE, FACTURA_DATE_RANGE_AFTER)) {
        dateMatches = true;
        dateDiff = Math.min(dateDiff, Math.abs(Math.floor((bankFechaValor.getTime() - facturaDate.getTime()) / (1000 * 60 * 60 * 24))));
      }

      if (!dateMatches) {
        continue;
      }

      const reasons: string[] = [];
      if (crossCurrencyResult.isCrossCurrency) {
        reasons.push('Cross-currency match (USD→ARS)');
        reasons.push(`Exchange rate: ${crossCurrencyResult.rate}, expected ARS: ${crossCurrencyResult.expectedArs}`);
      } else {
        reasons.push(`Amount match: ${amount}`);
      }
      reasons.push(`Date match: Factura ${factura.fechaEmision}`);

      // Check CUIT match (preferred for direct factura match)
      let hasCuit = false;
      if (extractedCuit && factura.cuitEmisor === extractedCuit) {
        hasCuit = true;
        reasons.push('CUIT match with emisor');
      }

      // For direct debits without CUIT, try keyword matching
      let hasKeyword = false;
      let keywordScore = 0;
      if (!hasCuit && isDirectDebitMovement) {
        keywordScore = calculateKeywordMatchScore(
          bankConcepto,
          factura.razonSocialEmisor,
          factura.concepto
        );
        if (keywordScore >= MIN_KEYWORD_MATCH_SCORE) {
          hasKeyword = true;
          reasons.push(`Keyword match (score: ${keywordScore})`);
          reasons.push('Direct debit without CUIT');
        }
      }

      // Only include if CUIT matches OR keyword matches (for direct debits)
      if (!hasCuit && !hasKeyword) {
        continue;
      }

      matches.push({ factura, reasons, hasCuit, hasKeyword, keywordScore, dateDiff });
    }

    // Sort by: CUIT match first, then keyword score, then date proximity
    matches.sort((a, b) => {
      // CUIT matches always come first
      if (a.hasCuit !== b.hasCuit) {
        return a.hasCuit ? -1 : 1;
      }
      // For keyword matches, higher score is better
      if (a.hasKeyword && b.hasKeyword && a.keywordScore !== b.keywordScore) {
        return b.keywordScore - a.keywordScore;
      }
      // Finally, sort by date proximity
      return a.dateDiff - b.dateDiff;
    });

    return matches.map(m => ({
      factura: m.factura,
      reasons: m.reasons,
      matchType: m.hasCuit ? 'cuit' as const : 'keyword' as const
    }));
  }

  /**
   * Finds recibos matching amount and date criteria
   */
  private findMatchingRecibos(
    amount: number,
    bankFecha: Date | null,
    bankFechaValor: Date | null,
    recibos: Array<Recibo & { row: number }>
  ): Array<{ recibo: Recibo & { row: number }; reasons: string[] }> {
    const matches: Array<{ recibo: Recibo & { row: number }; reasons: string[]; dateDiff: number }> = [];

    for (const recibo of recibos) {
      // Check amount match (use totalNeto for salary)
      if (!amountsMatch(recibo.totalNeto, amount)) {
        continue;
      }

      // Parse recibo date
      const reciboDate = parseArgDate(recibo.fechaPago);
      if (!reciboDate) {
        continue;
      }

      // Check date match
      let dateMatches = false;
      let dateDiff = 999;

      if (bankFecha && isWithinDays(reciboDate, bankFecha, FACTURA_DATE_RANGE_BEFORE, FACTURA_DATE_RANGE_AFTER)) {
        dateMatches = true;
        dateDiff = Math.min(dateDiff, Math.abs(Math.floor((bankFecha.getTime() - reciboDate.getTime()) / (1000 * 60 * 60 * 24))));
      }
      if (bankFechaValor && isWithinDays(reciboDate, bankFechaValor, FACTURA_DATE_RANGE_BEFORE, FACTURA_DATE_RANGE_AFTER)) {
        dateMatches = true;
        dateDiff = Math.min(dateDiff, Math.abs(Math.floor((bankFechaValor.getTime() - reciboDate.getTime()) / (1000 * 60 * 60 * 24))));
      }

      if (!dateMatches) {
        continue;
      }

      const reasons: string[] = [];
      reasons.push(`Amount match: ${amount}`);
      reasons.push(`Date match: Recibo ${recibo.fechaPago}`);
      reasons.push(`Employee: ${recibo.nombreEmpleado}`);

      matches.push({ recibo, reasons, dateDiff });
    }

    // Sort by date proximity
    matches.sort((a, b) => a.dateDiff - b.dateDiff);

    return matches.map(m => ({ recibo: m.recibo, reasons: m.reasons }));
  }

  /**
   * Creates a Pago → Factura match result (BEST)
   */
  private createPagoFacturaMatch(
    movement: BankMovement,
    pago: Pago,
    factura: Factura,
    extractedCuit: string | undefined,
    reasons: string[]
  ): BankMovementMatchResult {
    const description = this.formatFacturaDescription(factura);

    return {
      movement,
      matchType: 'pago_factura',
      description,
      matchedFileId: pago.fileId,
      extractedCuit,
      confidence: 'HIGH',
      reasons: [...reasons, 'Pago linked to Factura']
    };
  }

  /**
   * Creates a direct Factura match result
   *
   * @param movement - Bank movement
   * @param factura - Matched factura
   * @param extractedCuit - CUIT extracted from bank concepto (if any)
   * @param reasons - Match reasons
   * @param facturaMatchType - How the factura was matched ('cuit' or 'keyword')
   */
  private createDirectFacturaMatch(
    movement: BankMovement,
    factura: Factura,
    extractedCuit: string | undefined,
    reasons: string[],
    facturaMatchType: 'cuit' | 'keyword' = 'cuit'
  ): BankMovementMatchResult {
    const description = this.formatFacturaDescription(factura);

    // Determine base confidence
    // Keyword matches have MEDIUM confidence (needs review)
    // CUIT matches have HIGH confidence
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = facturaMatchType === 'keyword' ? 'MEDIUM' : 'HIGH';

    // Cap confidence for cross-currency matches per CLAUDE.md:
    // "With CUIT → MEDIUM max; without → LOW"
    const isCrossCurrency = factura.moneda === 'USD';
    if (isCrossCurrency) {
      if (facturaMatchType === 'cuit') {
        confidence = 'MEDIUM'; // Cap HIGH to MEDIUM for cross-currency with CUIT
      } else {
        confidence = 'LOW'; // Cap MEDIUM to LOW for cross-currency without CUIT (keyword match)
      }
    }

    const matchTypeLabel = facturaMatchType === 'keyword'
      ? 'Direct Factura match (keyword)'
      : 'Direct Factura match';

    return {
      movement,
      matchType: 'direct_factura',
      description,
      matchedFileId: factura.fileId,
      extractedCuit,
      confidence,
      reasons: [...reasons, matchTypeLabel]
    };
  }

  /**
   * Creates a Recibo match result
   */
  private createReciboMatch(
    movement: BankMovement,
    recibo: Recibo,
    extractedCuit: string | undefined,
    reasons: string[]
  ): BankMovementMatchResult {
    const description = `Sueldo ${recibo.periodoAbonado} - ${recibo.nombreEmpleado}`;

    return {
      movement,
      matchType: 'recibo',
      description,
      matchedFileId: recibo.fileId,
      extractedCuit,
      confidence: 'HIGH',
      reasons
    };
  }

  /**
   * Creates a Pago-only match result (REVISAR)
   */
  private createPagoOnlyMatch(
    movement: BankMovement,
    pago: Pago,
    extractedCuit: string | undefined,
    reasons: string[]
  ): BankMovementMatchResult {
    const name = pago.nombreBeneficiario || 'Desconocido';
    const cuit = pago.cuitBeneficiario ? ` ${pago.cuitBeneficiario}` : '';
    const concepto = pago.concepto ? ` (${pago.concepto})` : '';
    const description = `REVISAR! Pago a ${name}${cuit}${concepto}`.trim();

    return {
      movement,
      matchType: 'pago_only',
      description,
      matchedFileId: pago.fileId,
      extractedCuit,
      confidence: 'LOW',
      reasons: [...reasons, 'Pago without linked Factura']
    };
  }

  /**
   * Creates a no-match result
   */
  private noMatch(movement: BankMovement, reasons: string[]): BankMovementMatchResult {
    return {
      movement,
      matchType: 'no_match',
      description: '',
      matchedFileId: '',
      confidence: 'LOW',
      reasons
    };
  }

  /**
   * Creates a bank fee match result
   */
  private createBankFeeMatch(movement: BankMovement): BankMovementMatchResult {
    return {
      movement,
      matchType: 'bank_fee',
      description: 'Gastos bancarios',
      matchedFileId: '',
      confidence: 'HIGH',
      reasons: ['Bank fee pattern detected']
    };
  }

  /**
   * Creates a credit card payment match result
   */
  private createCreditCardPaymentMatch(movement: BankMovement): BankMovementMatchResult {
    return {
      movement,
      matchType: 'credit_card_payment',
      description: 'Pago de tarjeta de credito',
      matchedFileId: '',
      confidence: 'HIGH',
      reasons: ['Credit card payment pattern detected']
    };
  }

  /**
   * Formats a Factura description
   */
  private formatFacturaDescription(factura: Factura): string {
    const razonSocial = factura.razonSocialEmisor || 'Proveedor';
    const concepto = factura.concepto || '';

    if (concepto) {
      return `Pago Factura a ${razonSocial} - ${concepto}`;
    }
    return `Pago Factura a ${razonSocial}`;
  }

  /**
   * Matches a credit movement (money coming IN to ADVA) against Facturas Emitidas and Pagos Recibidos
   *
   * Priority:
   * 1. Pago Recibido with linked Factura Emitida (BEST)
   * 2. Direct Factura Emitida match (with retencion tolerance)
   * 3. Pago Recibido without linked Factura (REVISAR)
   * 4. No match
   *
   * @param movement - Bank movement with credito amount
   * @param facturasEmitidas - All Facturas Emitidas from Control de Ingresos
   * @param pagosRecibidos - All Pagos Recibidos from Control de Ingresos
   * @param retenciones - All Retenciones Recibidas from Control de Ingresos
   * @returns Match result with generated description and matchedFileId
   */
  matchCreditMovement(
    movement: BankMovement,
    facturasEmitidas: Array<Factura & { row: number }>,
    pagosRecibidos: Array<Pago & { row: number }>,
    retenciones: Array<Retencion & { row: number }>
  ): BankMovementMatchResult {
    const amount = movement.credito;
    if (amount === null || amount === 0) {
      return this.noMatchCredit(movement, ['No credit amount']);
    }

    // Extract CUIT from concepto
    const extractedCuit = extractCuitFromConcepto(movement.concepto);

    // Parse bank dates
    const bankFecha = parseArgDate(movement.fecha);
    if (!bankFecha) {
      return this.noMatchCredit(movement, ['No valid date in movement']);
    }

    // Step 1: Try to find matching Pagos Recibidos (tight date range: ±1 day)
    const matchingPagos = this.findMatchingPagosRecibidos(
      amount,
      bankFecha,
      extractedCuit,
      pagosRecibidos
    );

    // Step 2: Check if any Pago has a linked Factura Emitida (BEST MATCH)
    for (const pagoMatch of matchingPagos) {
      if (pagoMatch.pago.matchedFacturaFileId) {
        const linkedFactura = facturasEmitidas.find(
          f => f.fileId === pagoMatch.pago.matchedFacturaFileId
        );
        if (linkedFactura) {
          return this.createPagoFacturaMatchCredit(
            movement,
            pagoMatch.pago,
            linkedFactura,
            extractedCuit,
            pagoMatch.reasons
          );
        }
      }
    }

    // Step 3: Try direct Factura Emitida match (with retencion tolerance)
    const matchingFacturas = this.findMatchingFacturasEmitidas(
      amount,
      bankFecha,
      extractedCuit,
      facturasEmitidas,
      retenciones
    );

    if (matchingFacturas.length > 0) {
      const bestFactura = matchingFacturas[0];
      return this.createDirectFacturaMatchCredit(
        movement,
        bestFactura.factura,
        extractedCuit,
        bestFactura.reasons,
        bestFactura.usedRetenciones
      );
    }

    // Step 4: Pago Recibido without linked Factura (REVISAR)
    if (matchingPagos.length > 0) {
      const bestPago = matchingPagos[0];
      return this.createPagoOnlyMatchCredit(
        movement,
        bestPago.pago,
        extractedCuit,
        bestPago.reasons
      );
    }

    // No match
    return this.noMatchCredit(movement, ['No matching factura or pago found']);
  }

  /**
   * Compares two matches to determine which is better
   * Used for replacement logic when a movimiento already has a match
   *
   * @param existing - Quality metrics of existing match
   * @param candidate - Quality metrics of candidate match
   * @returns 'existing' if existing is better or equal, 'candidate' if candidate is better
   */
  compareMatches(
    existing: MatchQuality,
    candidate: MatchQuality
  ): 'existing' | 'candidate' {
    // 1. CUIT match beats no CUIT match
    if (candidate.hasCuitMatch && !existing.hasCuitMatch) return 'candidate';
    if (!candidate.hasCuitMatch && existing.hasCuitMatch) return 'existing';

    // 2. Closer date wins (when CUIT match is equal)
    if (candidate.dateDistance < existing.dateDistance) return 'candidate';
    if (candidate.dateDistance > existing.dateDistance) return 'existing';

    // 3. Exact amount beats tolerance match
    if (candidate.isExactAmount && !existing.isExactAmount) return 'candidate';
    if (!candidate.isExactAmount && existing.isExactAmount) return 'existing';

    // 4. Has linked pago beats no linked pago
    if (candidate.hasLinkedPago && !existing.hasLinkedPago) return 'candidate';
    if (!candidate.hasLinkedPago && existing.hasLinkedPago) return 'existing';

    // Equal quality - keep existing (no churn)
    return 'existing';
  }

  /**
   * Finds matching Pagos Recibidos for a credit movement
   */
  private findMatchingPagosRecibidos(
    amount: number,
    bankFecha: Date,
    extractedCuit: string | undefined,
    pagos: Array<Pago & { row: number }>
  ): Array<{ pago: Pago & { row: number }; reasons: string[] }> {
    const matches: Array<{
      pago: Pago & { row: number };
      reasons: string[];
      hasCuit: boolean;
      dateDiff: number;
    }> = [];

    for (const pago of pagos) {
      const pagoFecha = parseArgDate(pago.fechaPago);
      if (!pagoFecha) continue;

      // Check date range (tight: ±1 day)
      if (!isWithinDays(bankFecha, pagoFecha, PAGO_DATE_RANGE, PAGO_DATE_RANGE)) {
        continue;
      }

      // Check amount
      const amountMatches = amountsMatch(amount, pago.importePagado, this.crossCurrencyTolerancePercent);
      if (!amountMatches) continue;

      const dateDiff = Math.abs(bankFecha.getTime() - pagoFecha.getTime()) / (1000 * 60 * 60 * 24);
      const reasons: string[] = [];
      reasons.push('Amount match');
      reasons.push(`Date within ±${PAGO_DATE_RANGE} days`);

      // Check CUIT match
      let hasCuit = false;
      if (extractedCuit && pago.cuitPagador === extractedCuit) {
        hasCuit = true;
        reasons.push('CUIT match');
      }

      matches.push({ pago, reasons, hasCuit, dateDiff });
    }

    // Sort by CUIT match first, then by date proximity
    matches.sort((a, b) => {
      if (a.hasCuit !== b.hasCuit) {
        return a.hasCuit ? -1 : 1;
      }
      return a.dateDiff - b.dateDiff;
    });

    return matches.map(m => ({ pago: m.pago, reasons: m.reasons }));
  }

  /**
   * Finds matching Facturas Emitidas for a credit movement (with retencion tolerance)
   */
  private findMatchingFacturasEmitidas(
    amount: number,
    bankFecha: Date,
    extractedCuit: string | undefined,
    facturas: Array<Factura & { row: number }>,
    retenciones: Array<Retencion & { row: number }>
  ): Array<{
    factura: Factura & { row: number };
    reasons: string[];
    usedRetenciones: Array<Retencion & { row: number }>;
  }> {
    const matches: Array<{
      factura: Factura & { row: number };
      reasons: string[];
      usedRetenciones: Array<Retencion & { row: number }>;
      hasCuit: boolean;
      dateDiff: number;
      isExactAmount: boolean;
    }> = [];

    for (const factura of facturas) {
      const facturaFecha = parseArgDate(factura.fechaEmision);
      if (!facturaFecha) continue;

      // Check date range for credits: factura before movement (customer pays after invoice)
      // Allow factura up to 30 days before movement, or up to 5 days after (for date recording issues)
      if (!isWithinDays(facturaFecha, bankFecha, FACTURA_DATE_RANGE_BEFORE, FACTURA_DATE_RANGE_AFTER)) {
        continue;
      }

      // Find related retenciones (same CUIT, within 90 days after factura)
      const relatedRetenciones = this.findRelatedRetenciones(
        factura,
        facturaFecha,
        retenciones
      );

      const retencionSum = this.sumRetenciones(relatedRetenciones);

      // Check if amount + retenciones ≈ factura total
      const amountWithRetenciones = amount + retencionSum;

      // Try direct amount match first (no retenciones needed)
      let amountMatches = false;
      const isCrossCurrency = factura.moneda === 'USD';

      if (factura.moneda === 'ARS') {
        amountMatches = amountsMatch(amount, factura.importeTotal, this.crossCurrencyTolerancePercent);
      } else if (factura.moneda === 'USD') {
        // Cross-currency matching (USD factura, ARS payment)
        const matchResult = amountsMatchCrossCurrency(
          factura.importeTotal,
          factura.moneda,
          factura.fechaEmision,
          amount,
          this.crossCurrencyTolerancePercent
        );
        amountMatches = matchResult.matches;
      }

      // If direct match fails, try with retencion tolerance
      let usedRetenciones: Array<Retencion & { row: number }> = [];
      let matchType: 'exact' | 'with_retenciones' = 'exact';

      if (!amountMatches && retencionSum > 0) {
        if (factura.moneda === 'ARS') {
          amountMatches = amountsMatch(
            amountWithRetenciones,
            factura.importeTotal,
            this.crossCurrencyTolerancePercent
          );
        } else if (factura.moneda === 'USD') {
          const matchResult = amountsMatchCrossCurrency(
            factura.importeTotal,
            factura.moneda,
            factura.fechaEmision,
            amountWithRetenciones,
            this.crossCurrencyTolerancePercent
          );
          amountMatches = matchResult.matches;
        }

        if (amountMatches) {
          usedRetenciones = relatedRetenciones;
          matchType = 'with_retenciones';
        }
      }

      if (!amountMatches) continue;

      const dateDiff = Math.abs(bankFecha.getTime() - facturaFecha.getTime()) / (1000 * 60 * 60 * 24);
      const reasons: string[] = [];
      reasons.push(matchType === 'exact' ? 'Exact amount match' : 'Amount + retenciones match');
      reasons.push('Date within range');

      if (isCrossCurrency) {
        reasons.push('Cross-currency match (USD→ARS)');
      }

      // Check CUIT match
      let hasCuit = false;
      if (extractedCuit && factura.cuitReceptor === extractedCuit) {
        hasCuit = true;
        reasons.push('CUIT match');
      }

      matches.push({
        factura,
        reasons,
        usedRetenciones,
        hasCuit,
        dateDiff,
        isExactAmount: matchType === 'exact',
      });
    }

    // Sort by CUIT match first, then date proximity, then exact amount
    matches.sort((a, b) => {
      if (a.hasCuit !== b.hasCuit) {
        return a.hasCuit ? -1 : 1;
      }
      if (a.dateDiff !== b.dateDiff) {
        return a.dateDiff - b.dateDiff;
      }
      // Prefer exact amount match over retencion-adjusted match
      if (a.isExactAmount !== b.isExactAmount) {
        return a.isExactAmount ? -1 : 1;
      }
      return 0;
    });

    return matches.map(m => ({
      factura: m.factura,
      reasons: m.reasons,
      usedRetenciones: m.usedRetenciones,
    }));
  }

  /**
   * Finds retenciones related to a factura (same CUIT, within date range)
   */
  private findRelatedRetenciones(
    factura: Factura,
    facturaFecha: Date,
    retenciones: Array<Retencion & { row: number }>
  ): Array<Retencion & { row: number }> {
    const related: Array<Retencion & { row: number }> = [];

    for (const retencion of retenciones) {
      // Check CUIT match
      if (retencion.cuitAgenteRetencion !== factura.cuitReceptor) {
        continue;
      }

      // Check date range (up to 90 days AFTER factura)
      const retencionFecha = parseArgDate(retencion.fechaEmision);
      if (!retencionFecha) continue;

      const daysDiff = Math.floor(
        (retencionFecha.getTime() - facturaFecha.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Retencion must be on or after factura date, but not more than 90 days after
      if (daysDiff < 0 || daysDiff > RETENCION_DATE_RANGE_DAYS) {
        continue;
      }

      related.push(retencion);
    }

    return related;
  }

  /**
   * Sums the montoRetencion from an array of retenciones
   */
  private sumRetenciones(retenciones: Array<Retencion & { row: number }>): number {
    return retenciones.reduce((sum, ret) => sum + ret.montoRetencion, 0);
  }

  /**
   * Creates a Pago + Factura match result for credit movements
   */
  private createPagoFacturaMatchCredit(
    movement: BankMovement,
    pago: Pago & { row: number },
    factura: Factura,
    extractedCuit: string | undefined,
    reasons: string[]
  ): BankMovementMatchResult {
    const cliente = factura.razonSocialReceptor || 'Cliente';
    const concepto = factura.concepto || '';
    const description = concepto
      ? `Cobro Factura de ${cliente} - ${concepto}`
      : `Cobro Factura de ${cliente}`;

    // Check for cross-currency
    const isCrossCurrency = factura.moneda === 'USD';
    const confidence = isCrossCurrency ? 'MEDIUM' : 'HIGH';

    if (isCrossCurrency) {
      reasons.push('Cross-currency match (USD→ARS)');
    }

    return {
      movement,
      matchType: 'pago_factura',
      description,
      matchedFileId: pago.fileId,
      extractedCuit,
      confidence,
      reasons: [...reasons, 'Pago with linked Factura']
    };
  }

  /**
   * Creates a direct Factura match result for credit movements
   */
  private createDirectFacturaMatchCredit(
    movement: BankMovement,
    factura: Factura & { row: number },
    extractedCuit: string | undefined,
    reasons: string[],
    usedRetenciones: Array<Retencion & { row: number }>
  ): BankMovementMatchResult {
    const cliente = factura.razonSocialReceptor || 'Cliente';
    const concepto = factura.concepto || '';

    let description = concepto
      ? `Cobro Factura de ${cliente} - ${concepto}`
      : `Cobro Factura de ${cliente}`;

    if (usedRetenciones.length > 0) {
      description += ` (con retencion)`;
    }

    // Check for cross-currency and CUIT match
    const isCrossCurrency = factura.moneda === 'USD';
    const hasCuitMatch = reasons.includes('CUIT match');

    // If we matched retenciones, that implies CUIT match (retenciones are matched by CUIT)
    const hasImplicitCuitMatch = usedRetenciones.length > 0;

    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';

    if (isCrossCurrency) {
      // Cross-currency: MEDIUM max with CUIT (explicit or implicit), LOW without
      confidence = (hasCuitMatch || hasImplicitCuitMatch) ? 'MEDIUM' : 'LOW';
    } else {
      // Same currency: HIGH with CUIT (explicit or implicit), MEDIUM without
      confidence = (hasCuitMatch || hasImplicitCuitMatch) ? 'HIGH' : 'MEDIUM';
    }

    return {
      movement,
      matchType: 'direct_factura',
      description,
      matchedFileId: factura.fileId,
      extractedCuit,
      confidence,
      reasons
    };
  }

  /**
   * Creates a Pago-only match result for credit movements (REVISAR)
   */
  private createPagoOnlyMatchCredit(
    movement: BankMovement,
    pago: Pago & { row: number },
    extractedCuit: string | undefined,
    reasons: string[]
  ): BankMovementMatchResult {
    const pagador = pago.nombrePagador || 'Desconocido';
    const description = `REVISAR! Cobro de ${pagador}`;

    return {
      movement,
      matchType: 'pago_only',
      description,
      matchedFileId: pago.fileId,
      extractedCuit,
      confidence: 'MEDIUM',
      reasons: [...reasons, 'Pago without linked Factura']
    };
  }

  /**
   * Creates a no-match result for credit movements
   */
  private noMatchCredit(movement: BankMovement, reasons: string[]): BankMovementMatchResult {
    return {
      movement,
      matchType: 'no_match',
      description: '',
      matchedFileId: '',
      confidence: 'LOW',
      reasons
    };
  }
}

/**
 * Match quality metrics for comparison
 */
export interface MatchQuality {
  fileId: string;
  hasCuitMatch: boolean;
  dateDistance: number;
  isExactAmount: boolean;
  hasLinkedPago: boolean;
}
