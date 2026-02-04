/**
 * Bank movement matcher
 * Matches bank movements against Facturas, Recibos, and Pagos
 */

import type {
  BankMatchTier,
  BankMovementMatchResult,
  MovimientoRow,
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
 * Date range for Pago matching (±15 days)
 */
const PAGO_DATE_RANGE = 15;

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
 * Strips bank origin prefix from concepto text.
 * Some bank statements prepend "D NNN" (where NNN is a channel code) to the description.
 * This function removes that prefix for consistent pattern matching.
 *
 * Examples:
 * - "D 500 TRANSFERENCIA RECIBIDA" → "TRANSFERENCIA RECIBIDA"
 * - "D COMISION MANTENIMIENTO" → "COMISION MANTENIMIENTO"
 * - "TRANSFERENCIA RECIBIDA" → "TRANSFERENCIA RECIBIDA" (no change)
 *
 * @param concepto - Bank transaction concept text, possibly with origin prefix
 * @returns Concept text with origin prefix removed
 */
export function stripBankOriginPrefix(concepto: string): string {
  if (!concepto) {
    return '';
  }
  return concepto.replace(/^D\s+\d{2,3}\s+/, '').trim();
}

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

  // Strip bank origin prefix before extracting tokens
  const cleaned = stripBankOriginPrefix(concepto);
  if (!cleaned) {
    return [];
  }

  // First split on whitespace/punctuation
  const parts = cleaned
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
    // Word boundary match in emisor name (prevents substring false positives)
    if (matchesWordBoundary(normalizedEmisor, token)) {
      score += 2;
    }

    // Word boundary match in factura concepto
    if (normalizedConcepto && matchesWordBoundary(normalizedConcepto, token)) {
      score += 2;
    }
  }

  return score;
}

/**
 * Checks if a token matches as a complete word (respecting word boundaries)
 * Prevents false positives from substring matches (e.g., "SA" in "COMISIONES SA")
 */
function matchesWordBoundary(text: string, token: string): boolean {
  // Escape special regex characters in the token
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Use word boundary regex to match complete words only
  const pattern = new RegExp(`\\b${escapedToken}\\b`, 'i');
  return pattern.test(text);
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
  /^PAGO TARJETA\s+(?:VISA|MASTERCARD|AMEX|NARANJA|CABAL)\b/i,
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
  const cleaned = stripBankOriginPrefix(concepto);
  return CREDIT_CARD_PAYMENT_PATTERNS.some(pattern => pattern.test(cleaned));
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
  const cleaned = stripBankOriginPrefix(concepto);
  return BANK_FEE_PATTERNS.some(pattern => pattern.test(cleaned));
}

/**
 * Extracts a 7-digit referencia from ORDEN DE PAGO patterns in bank concepto
 * Pattern: 7 digits followed by .NN.NNNN (e.g., "4083953.01.8584")
 *
 * @param concepto - Bank transaction concept text
 * @returns The 7-digit referencia string, or undefined if not found
 */
export function extractReferencia(concepto: string): string | undefined {
  if (!concepto) {
    return undefined;
  }
  const match = concepto.match(/(\d{7})\.\d{2}\.\d{4}/);
  return match ? match[1] : undefined;
}

/** Re-export for convenience */
export const extractCuitFromConcepto = extractCuitFromText;

/**
 * Internal candidate type for tier-based ranking
 */
interface TieredCandidate {
  tier: BankMatchTier;
  matchType: 'pago_factura' | 'direct_factura' | 'recibo' | 'pago_only';
  fileId: string;
  description: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
  dateDiff: number;
  isExactAmount: boolean;
}

/**
 * Calculates date distance in days between two dates
 */
function dateDiffDays(a: Date, b: Date): number {
  return Math.abs(Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Determines confidence based on tier and cross-currency status
 * Tier 1-3: HIGH (MEDIUM if cross-currency)
 * Tier 4: MEDIUM (LOW if cross-currency)
 * Tier 5: LOW
 */
function tierToConfidence(tier: BankMatchTier, isCrossCurrency: boolean): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (tier <= 3) {
    return isCrossCurrency ? 'MEDIUM' : 'HIGH';
  }
  if (tier === 4) {
    return isCrossCurrency ? 'LOW' : 'MEDIUM';
  }
  return 'LOW';
}

/**
 * Matches bank movements against Facturas, Recibos, and Pagos
 * Uses a tier-based ranking algorithm:
 * Tier 1: Pago with linked Factura
 * Tier 2: CUIT match from concepto
 * Tier 3: Referencia match
 * Tier 4: Name token score >= 2
 * Tier 5: Amount + date only
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
   * Matches a debit bank movement against Egresos documents (Facturas Recibidas, Recibos, Pagos Enviados)
   *
   * Algorithm:
   * Phase 0: Auto-detect bank fees and credit card payments
   * Phase 1: Extract identity (CUIT, referencia, name tokens) from concepto
   * Phase 3: Gather candidates with hard identity filters
   * Phase 4: Score each candidate with tier, sort, return best
   *
   * @param movement - Bank movement to match
   * @param facturas - All facturas from sheet
   * @param recibos - All recibos from sheet
   * @param pagos - All pagos from sheet
   * @returns Match result with generated description and tier
   */
  matchMovement(
    movement: MovimientoRow,
    facturas: Array<Factura & { row: number }>,
    recibos: Array<Recibo & { row: number }>,
    pagos: Array<Pago & { row: number }>
  ): BankMovementMatchResult {
    // Phase 0: Auto-detect
    if (isBankFee(movement.concepto)) {
      return this.createBankFeeMatch(movement);
    }

    const amount = movement.debito;
    if (amount === null || amount === 0) {
      return this.noMatch(movement, ['No debit amount']);
    }

    if (isCreditCardPayment(movement.concepto)) {
      return this.createCreditCardPaymentMatch(movement);
    }

    // Phase 1: Extract identity
    const extractedCuit = extractCuitFromConcepto(movement.concepto);
    const extractedRef = extractReferencia(movement.concepto);

    const bankFecha = parseArgDate(movement.fecha);
    if (!bankFecha) {
      return this.noMatch(movement, ['No valid date in movement']);
    }

    // Phase 3 & 4: Gather and score candidates
    const candidates: TieredCandidate[] = [];

    // If CUIT extracted, apply hard filter — only consider documents with matching CUIT
    const hasCuitFilter = !!extractedCuit;

    // --- Pagos ---
    for (const pago of pagos) {
      if (!amountsMatch(pago.importePagado, amount)) continue;
      const pagoDate = parseArgDate(pago.fechaPago);
      if (!pagoDate) continue;
      if (!isWithinDays(bankFecha, pagoDate, PAGO_DATE_RANGE, PAGO_DATE_RANGE)) continue;

      // Hard CUIT filter
      if (hasCuitFilter && pago.cuitBeneficiario !== extractedCuit) continue;

      const dateDiff = dateDiffDays(bankFecha, pagoDate);
      const reasons = [`Amount match: ${amount}`, `Date match: Pago ${pago.fechaPago}`];

      // Check for linked factura (Tier 1)
      if (pago.matchedFacturaFileId) {
        const linkedFactura = facturas.find(f => f.fileId === pago.matchedFacturaFileId);
        if (linkedFactura) {
          const description = this.formatDebitFacturaDescription(linkedFactura);
          candidates.push({
            tier: 1,
            matchType: 'pago_factura',
            fileId: pago.fileId,
            description,
            confidence: 'HIGH',
            reasons: [...reasons, 'Pago linked to Factura'],
            dateDiff,
            isExactAmount: true,
          });
          continue;
        } else {
          warn('Linked factura not found in facturas array', {
            pagoFileId: pago.fileId,
            matchedFacturaFileId: pago.matchedFacturaFileId
          });
        }
      }

      // Pago without linked factura — determine tier
      let tier: BankMatchTier;
      if (extractedCuit && pago.cuitBeneficiario === extractedCuit) {
        tier = 2;
      } else if (extractedRef && pago.referencia === extractedRef) {
        tier = 3;
        reasons.push('Referencia match');
      } else {
        tier = 5;
      }
      const name = pago.nombreBeneficiario || 'Desconocido';
      const cuit = pago.cuitBeneficiario ? ` ${pago.cuitBeneficiario}` : '';
      const concepto = pago.concepto ? ` (${pago.concepto})` : '';
      const description = `REVISAR! Pago a ${name}${cuit}${concepto}`.trim();

      candidates.push({
        tier,
        matchType: 'pago_only',
        fileId: pago.fileId,
        description,
        confidence: tier <= 3 ? 'HIGH' : 'LOW',
        reasons: [...reasons, 'Pago without linked Factura'],
        dateDiff,
        isExactAmount: true,
      });
    }

    // --- Facturas ---
    for (const factura of facturas) {
      const crossCurrencyResult = amountsMatchCrossCurrency(
        factura.importeTotal, factura.moneda, factura.fechaEmision,
        amount, this.crossCurrencyTolerancePercent
      );
      if (!crossCurrencyResult.matches) continue;

      const facturaDate = parseArgDate(factura.fechaEmision);
      if (!facturaDate) continue;
      if (!isWithinDays(facturaDate, bankFecha, FACTURA_DATE_RANGE_BEFORE, FACTURA_DATE_RANGE_AFTER)) continue;

      // Hard CUIT filter
      if (hasCuitFilter && factura.cuitEmisor !== extractedCuit) continue;

      const dateDiff = dateDiffDays(bankFecha, facturaDate);
      const isCrossCurrency = factura.moneda === 'USD';
      const reasons: string[] = [];
      if (crossCurrencyResult.isCrossCurrency) {
        reasons.push('Cross-currency match (USD→ARS)');
        reasons.push(`Exchange rate: ${crossCurrencyResult.rate}, expected ARS: ${crossCurrencyResult.expectedArs}`);
      } else {
        reasons.push(`Amount match: ${amount}`);
      }
      reasons.push(`Date match: Factura ${factura.fechaEmision}`);

      // Determine tier
      let tier: BankMatchTier;
      if (extractedCuit && factura.cuitEmisor === extractedCuit) {
        tier = 2;
        reasons.push('CUIT match with emisor');
      } else {
        // Try keyword matching (applies to ALL movements, not just direct debits)
        const keywordScore = calculateKeywordMatchScore(
          movement.concepto, factura.razonSocialEmisor, factura.concepto
        );
        if (keywordScore >= MIN_KEYWORD_MATCH_SCORE) {
          tier = 4;
          reasons.push(`Keyword match (score: ${keywordScore})`);
        } else {
          tier = 5;
        }
      }

      const description = this.formatDebitFacturaDescription(factura);
      const confidence = tierToConfidence(tier, isCrossCurrency);

      candidates.push({
        tier,
        matchType: 'direct_factura',
        fileId: factura.fileId,
        description,
        confidence,
        reasons: [...reasons, 'Direct Factura match'],
        dateDiff,
        isExactAmount: !crossCurrencyResult.isCrossCurrency,
      });
    }

    // --- Recibos ---
    for (const recibo of recibos) {
      if (!amountsMatch(recibo.totalNeto, amount)) continue;
      const reciboDate = parseArgDate(recibo.fechaPago);
      if (!reciboDate) continue;
      if (!isWithinDays(reciboDate, bankFecha, FACTURA_DATE_RANGE_BEFORE, FACTURA_DATE_RANGE_AFTER)) continue;

      // Hard CUIT filter — recibos don't have a counterparty CUIT to match
      if (hasCuitFilter) continue;

      const dateDiff = dateDiffDays(bankFecha, reciboDate);
      const description = `Sueldo ${recibo.periodoAbonado} - ${recibo.nombreEmpleado}`;

      candidates.push({
        tier: 5,
        matchType: 'recibo',
        fileId: recibo.fileId,
        description,
        confidence: 'HIGH',
        reasons: [`Amount match: ${amount}`, `Date match: Recibo ${recibo.fechaPago}`, `Employee: ${recibo.nombreEmpleado}`],
        dateDiff,
        isExactAmount: true,
      });
    }

    // Phase 4: Sort candidates by tier (lower wins), then date distance, then exact amount
    candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.dateDiff !== b.dateDiff) return a.dateDiff - b.dateDiff;
      if (a.isExactAmount !== b.isExactAmount) return a.isExactAmount ? -1 : 1;
      return 0;
    });

    if (candidates.length === 0) {
      return this.noMatch(movement, ['No matching documents found']);
    }

    const best = candidates[0];
    return {
      movement,
      matchType: best.matchType,
      description: best.description,
      matchedFileId: best.fileId,
      extractedCuit,
      confidence: best.confidence,
      tier: best.tier,
      reasons: best.reasons,
    };
  }

  /**
   * Matches a credit movement (money coming IN to ADVA) against Facturas Emitidas and Pagos Recibidos
   *
   * Uses the same tier-based algorithm as matchMovement but for the Ingresos pool.
   *
   * @param movement - Bank movement with credito amount
   * @param facturasEmitidas - All Facturas Emitidas from Control de Ingresos
   * @param pagosRecibidos - All Pagos Recibidos from Control de Ingresos
   * @param retenciones - All Retenciones Recibidas from Control de Ingresos
   * @returns Match result with generated description and matchedFileId
   */
  matchCreditMovement(
    movement: MovimientoRow,
    facturasEmitidas: Array<Factura & { row: number }>,
    pagosRecibidos: Array<Pago & { row: number }>,
    retenciones: Array<Retencion & { row: number }>
  ): BankMovementMatchResult {
    // Phase 0: Auto-detect
    if (isBankFee(movement.concepto)) {
      return this.createBankFeeMatch(movement);
    }

    if (isCreditCardPayment(movement.concepto)) {
      return this.createCreditCardPaymentMatch(movement);
    }

    const amount = movement.credito;
    if (amount === null || amount === 0) {
      return this.noMatchCredit(movement, ['No credit amount']);
    }

    // Phase 1: Extract identity
    const extractedCuit = extractCuitFromConcepto(movement.concepto);

    const bankFecha = parseArgDate(movement.fecha);
    if (!bankFecha) {
      return this.noMatchCredit(movement, ['No valid date in movement']);
    }

    const hasCuitFilter = !!extractedCuit;
    const candidates: TieredCandidate[] = [];

    // --- Pagos Recibidos ---
    for (const pago of pagosRecibidos) {
      const pagoFecha = parseArgDate(pago.fechaPago);
      if (!pagoFecha) continue;
      if (!isWithinDays(bankFecha, pagoFecha, PAGO_DATE_RANGE, PAGO_DATE_RANGE)) continue;

      // Use cross-currency matching for pagos recibidos
      const amountOk = amountsMatchCrossCurrency(
        pago.importePagado, pago.moneda || 'ARS', pago.fechaPago,
        amount, this.crossCurrencyTolerancePercent
      );
      if (!amountOk.matches) continue;

      // Hard CUIT filter
      if (hasCuitFilter && pago.cuitPagador !== extractedCuit) continue;

      const dateDiff = dateDiffDays(bankFecha, pagoFecha);
      const reasons = ['Amount match', `Date within ±${PAGO_DATE_RANGE} days`];
      if (extractedCuit && pago.cuitPagador === extractedCuit) {
        reasons.push('CUIT match');
      }

      // Check for linked factura (Tier 1)
      if (pago.matchedFacturaFileId) {
        const linkedFactura = facturasEmitidas.find(f => f.fileId === pago.matchedFacturaFileId);
        if (linkedFactura) {
          const isCrossCurrency = linkedFactura.moneda === 'USD';
          const cliente = linkedFactura.razonSocialReceptor || 'Cliente';
          const concepto = linkedFactura.concepto || '';
          const description = concepto
            ? `Cobro Factura de ${cliente} - ${concepto}`
            : `Cobro Factura de ${cliente}`;
          const confidence = isCrossCurrency ? 'MEDIUM' : 'HIGH';

          if (isCrossCurrency) {
            reasons.push('Cross-currency match (USD→ARS)');
          }

          candidates.push({
            tier: 1,
            matchType: 'pago_factura',
            fileId: pago.fileId,
            description,
            confidence,
            reasons: [...reasons, 'Pago with linked Factura'],
            dateDiff,
            isExactAmount: !amountOk.isCrossCurrency,
          });
          continue;
        }
      }

      // Pago without linked factura (REVISAR)
      const pagador = pago.nombrePagador || 'Desconocido';
      const description = `REVISAR! Cobro de ${pagador}`;
      const tier: BankMatchTier = extractedCuit && pago.cuitPagador === extractedCuit ? 2 : 5;

      candidates.push({
        tier,
        matchType: 'pago_only',
        fileId: pago.fileId,
        description,
        confidence: 'MEDIUM',
        reasons: [...reasons, 'Pago without linked Factura'],
        dateDiff,
        isExactAmount: !amountOk.isCrossCurrency,
      });
    }

    // --- Facturas Emitidas (with retencion tolerance) ---
    for (const factura of facturasEmitidas) {
      const facturaFecha = parseArgDate(factura.fechaEmision);
      if (!facturaFecha) continue;
      if (!isWithinDays(facturaFecha, bankFecha, FACTURA_DATE_RANGE_BEFORE, FACTURA_DATE_RANGE_AFTER)) continue;

      // Hard CUIT filter
      if (hasCuitFilter && factura.cuitReceptor !== extractedCuit) continue;

      // Find related retenciones
      const relatedRetenciones = this.findRelatedRetenciones(factura, facturaFecha, retenciones);
      const retencionSum = this.sumRetenciones(relatedRetenciones);

      // Try direct amount match
      let amountMatches = false;
      const isCrossCurrency = factura.moneda === 'USD';

      if (factura.moneda === 'ARS') {
        amountMatches = amountsMatch(amount, factura.importeTotal, this.crossCurrencyTolerancePercent);
      } else if (factura.moneda === 'USD') {
        const matchResult = amountsMatchCrossCurrency(
          factura.importeTotal, factura.moneda, factura.fechaEmision,
          amount, this.crossCurrencyTolerancePercent
        );
        amountMatches = matchResult.matches;
      }

      // Try with retencion tolerance
      let usedRetenciones: Array<Retencion & { row: number }> = [];
      let matchType: 'exact' | 'with_retenciones' = 'exact';

      if (!amountMatches && retencionSum > 0) {
        const amountWithRetenciones = amount + retencionSum;
        if (factura.moneda === 'ARS') {
          amountMatches = amountsMatch(amountWithRetenciones, factura.importeTotal, this.crossCurrencyTolerancePercent);
        } else if (factura.moneda === 'USD') {
          const matchResult = amountsMatchCrossCurrency(
            factura.importeTotal, factura.moneda, factura.fechaEmision,
            amountWithRetenciones, this.crossCurrencyTolerancePercent
          );
          amountMatches = matchResult.matches;
        }
        if (amountMatches) {
          usedRetenciones = relatedRetenciones;
          matchType = 'with_retenciones';
        }
      }

      if (!amountMatches) continue;

      const dateDiff = dateDiffDays(bankFecha, facturaFecha);
      const reasons: string[] = [];
      reasons.push(matchType === 'exact' ? 'Exact amount match' : 'Amount + retenciones match');
      reasons.push('Date within range');
      if (isCrossCurrency) {
        reasons.push('Cross-currency match (USD→ARS)');
      }

      // CUIT match check
      const hasCuit = !!(extractedCuit && factura.cuitReceptor === extractedCuit);
      if (hasCuit) reasons.push('CUIT match');
      const hasImplicitCuitMatch = usedRetenciones.length > 0;

      // Determine tier
      let tier: BankMatchTier;
      if (hasCuit || hasImplicitCuitMatch) {
        tier = 2;
      } else {
        // Try keyword matching (applies to ALL movements)
        const keywordScore = calculateKeywordMatchScore(
          movement.concepto, factura.razonSocialReceptor ?? '', factura.concepto
        );
        if (keywordScore >= MIN_KEYWORD_MATCH_SCORE) {
          tier = 4;
          reasons.push(`Keyword match (score: ${keywordScore})`);
        } else {
          tier = 5;
        }
      }

      // Build description
      const cliente = factura.razonSocialReceptor || 'Cliente';
      const concepto = factura.concepto || '';
      let description = concepto
        ? `Cobro Factura de ${cliente} - ${concepto}`
        : `Cobro Factura de ${cliente}`;
      if (usedRetenciones.length > 0) {
        description += ` (con retencion)`;
      }

      // Confidence
      let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      if (isCrossCurrency) {
        confidence = (hasCuit || hasImplicitCuitMatch) ? 'MEDIUM' : 'LOW';
      } else {
        confidence = (hasCuit || hasImplicitCuitMatch) ? 'HIGH' : 'MEDIUM';
      }

      candidates.push({
        tier,
        matchType: 'direct_factura',
        fileId: factura.fileId,
        description,
        confidence,
        reasons,
        dateDiff,
        isExactAmount: matchType === 'exact',
      });
    }

    // Sort by tier, then date, then exact amount
    candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.dateDiff !== b.dateDiff) return a.dateDiff - b.dateDiff;
      if (a.isExactAmount !== b.isExactAmount) return a.isExactAmount ? -1 : 1;
      return 0;
    });

    if (candidates.length === 0) {
      return this.noMatchCredit(movement, ['No matching factura or pago found']);
    }

    const best = candidates[0];
    return {
      movement,
      matchType: best.matchType,
      description: best.description,
      matchedFileId: best.fileId,
      extractedCuit,
      confidence: best.confidence,
      tier: best.tier,
      reasons: best.reasons,
    };
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
      if (retencion.cuitAgenteRetencion !== factura.cuitReceptor) {
        continue;
      }

      const retencionFecha = parseArgDate(retencion.fechaEmision);
      if (!retencionFecha) continue;

      const daysDiff = Math.floor(
        (retencionFecha.getTime() - facturaFecha.getTime()) / (1000 * 60 * 60 * 24)
      );

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
   * Formats a debit Factura description (Pago Factura a ...)
   */
  private formatDebitFacturaDescription(factura: Factura): string {
    const razonSocial = factura.razonSocialEmisor || 'Proveedor';
    const concepto = factura.concepto || '';
    if (concepto) {
      return `Pago Factura a ${razonSocial} - ${concepto}`;
    }
    return `Pago Factura a ${razonSocial}`;
  }

  /**
   * Creates a no-match result
   */
  private noMatch(movement: MovimientoRow, reasons: string[]): BankMovementMatchResult {
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
  private createBankFeeMatch(movement: MovimientoRow): BankMovementMatchResult {
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
  private createCreditCardPaymentMatch(movement: MovimientoRow): BankMovementMatchResult {
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
   * Creates a no-match result for credit movements
   */
  private noMatchCredit(movement: MovimientoRow, reasons: string[]): BankMovementMatchResult {
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
 * Uses tier-based ranking: lower tier = better match
 */
export interface MatchQuality {
  fileId: string;
  /** Match tier (1-5, lower is better) */
  tier: BankMatchTier;
  /** Date distance in days between movement and document */
  dateDistance: number;
  /** Whether the amount matched exactly (vs tolerance) */
  isExactAmount: boolean;
}
