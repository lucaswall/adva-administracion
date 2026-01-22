/**
 * Factura-Pago and Recibo-Pago matching logic
 * Matches payments to invoices and salary slips based on amount, date, and optional CUIT/CUIL
 */

import type { Factura, Pago, Recibo, MatchCandidate, ReciboMatchCandidate, MatchConfidence } from '../types/index.js';
import { parseArgDate, isWithinDays } from '../utils/date.js';
import { cuitOrDniMatch } from '../utils/validation.js';
import { amountsMatch } from '../utils/numbers.js';
import { amountsMatchCrossCurrency } from '../utils/exchange-rate.js';

/**
 * Default tolerance percentage for cross-currency matching
 * This is used when the ConfigManager is not available
 */
const DEFAULT_CROSS_CURRENCY_TOLERANCE = 5;

/**
 * Date range configuration for confidence tiers
 * Each tier defines [daysBefore, daysAfter] for the payment date relative to invoice date
 */
interface DateRangeConfig {
  /** HIGH confidence: payment within [0, 15] days of invoice */
  high: { before: number; after: number };
  /** MEDIUM confidence: payment within (-3, 30) days of invoice */
  medium: { before: number; after: number };
  /** LOW confidence: payment within (-10, 60) days of invoice */
  low: { before: number; after: number };
}

/**
 * Default date range configuration
 */
const DEFAULT_DATE_RANGES: DateRangeConfig = {
  high: { before: 0, after: 15 },
  medium: { before: 3, after: 30 },
  low: { before: 10, after: 60 }
};

/**
 * Normalizes a string for comparison by removing accents and converting to lowercase
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Match quality for comparison
 */
export interface MatchQuality {
  confidence: MatchConfidence;
  hasCuitMatch: boolean;
  dateProximityDays: number;
}

/**
 * Compares two match qualities using the three-tier system:
 * 1. Confidence level (HIGH > MEDIUM > LOW)
 * 2. CUIT match (has > doesn't have)
 * 3. Date proximity (closer is better)
 *
 * @returns Positive if a > b, negative if a < b, 0 if equal
 */
export function compareMatchQuality(a: MatchQuality, b: MatchQuality): number {
  const confidenceOrder: Record<MatchConfidence, number> = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
  };

  // 1. Compare confidence level
  const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
  if (confDiff !== 0) return confDiff;

  // 2. Compare CUIT match (has match > no match)
  if (a.hasCuitMatch !== b.hasCuitMatch) {
    return a.hasCuitMatch ? 1 : -1;
  }

  // 3. Compare date proximity (lower is better)
  return b.dateProximityDays - a.dateProximityDays;
}

/**
 * Matches pagos to facturas with fuzzy date matching
 */
export class FacturaPagoMatcher {
  private readonly dateRanges: DateRangeConfig;
  private readonly crossCurrencyTolerancePercent: number;

  /**
   * Creates a new matcher
   *
   * @param dateRangeBefore - Days before invoice date for LOW tier (default: 10)
   * @param dateRangeAfter - Days after invoice date for LOW tier (default: 60)
   * @param crossCurrencyTolerancePercent - Tolerance for USD→ARS matching (default: 5%)
   */
  constructor(
    dateRangeBefore: number = 10,
    dateRangeAfter: number = 60,
    crossCurrencyTolerancePercent: number = DEFAULT_CROSS_CURRENCY_TOLERANCE
  ) {
    // Use provided values for LOW tier, keep HIGH and MEDIUM defaults
    this.dateRanges = {
      high: { ...DEFAULT_DATE_RANGES.high },
      medium: { ...DEFAULT_DATE_RANGES.medium },
      low: { before: dateRangeBefore, after: dateRangeAfter }
    };
    this.crossCurrencyTolerancePercent = crossCurrencyTolerancePercent;
  }

  /**
   * Finds all matching facturas for a pago
   *
   * @param pago - Payment to match
   * @param facturas - Available invoices (can include already matched ones)
   * @param _includeMatched - Whether to consider already-matched facturas (for cascade displacement). Filtering is done by caller.
   * @param pagosMap - Optional map of pagos by fileId for calculating existingDateProximityDays
   * @returns Array of match candidates sorted by match quality
   */
  findMatches(
    pago: Pago,
    facturas: Array<Factura & { row: number }>,
    _includeMatched: boolean = false,
    pagosMap?: Map<string, Pago>
  ): MatchCandidate[] {
    const candidates: MatchCandidate[] = [];

    // Parse pago date
    const pagoDate = parseArgDate(pago.fechaPago);
    if (!pagoDate) {
      return []; // Can't match without valid date
    }

    for (const factura of facturas) {
      // Check amount match (required, with tolerance for floating-point precision)
      // For USD facturas, use cross-currency matching with exchange rate
      const crossCurrencyResult = amountsMatchCrossCurrency(
        factura.importeTotal,
        factura.moneda,
        factura.fechaEmision,
        pago.importePagado,
        this.crossCurrencyTolerancePercent
      );

      if (!crossCurrencyResult.matches) {
        continue;
      }

      // Parse factura date
      const facturaDate = parseArgDate(factura.fechaEmision);
      if (!facturaDate) {
        continue; // Skip if can't parse date
      }

      // Check date proximity against tiered ranges
      const isWithinHighRange = isWithinDays(facturaDate, pagoDate, this.dateRanges.high.before, this.dateRanges.high.after);
      const isWithinMediumRange = isWithinDays(facturaDate, pagoDate, this.dateRanges.medium.before, this.dateRanges.medium.after);
      const isWithinLowRange = isWithinDays(facturaDate, pagoDate, this.dateRanges.low.before, this.dateRanges.low.after);

      // Skip if not even within LOW range
      if (!isWithinLowRange) {
        continue;
      }

      // Calculate date proximity in days (absolute value)
      const daysDiff = Math.abs(Math.floor((pagoDate.getTime() - facturaDate.getTime()) / (1000 * 60 * 60 * 24)));

      // Track if this is a cross-currency match
      const isCrossCurrency = crossCurrencyResult.isCrossCurrency;

      // Build match candidate
      const reasons: string[] = [];
      if (isCrossCurrency) {
        reasons.push('Cross-currency match (USD→ARS)');
        reasons.push(`Exchange rate: ${crossCurrencyResult.rate}, expected ARS: ${crossCurrencyResult.expectedArs}`);
      } else {
        reasons.push(`Amount match: ${pago.importePagado}`);
      }

      if (isWithinHighRange) {
        reasons.push(`Date within high range: ${pago.fechaPago}`);
      } else if (isWithinMediumRange) {
        reasons.push(`Date within medium range: ${pago.fechaPago}`);
      } else {
        reasons.push(`Date within low range: ${pago.fechaPago}`);
      }

      // Check for CUIT match (optional boost)
      // Priority: beneficiary CUIT > payer CUIT
      // Beneficiary is the one receiving money, which should match the invoice emisor
      // Uses cuitOrDniMatch to handle cases where payment shows DNI (7-8 digits)
      // instead of full CUIT (11 digits)
      let cuitMatch = false;
      if (pago.cuitBeneficiario && factura.cuitEmisor && cuitOrDniMatch(pago.cuitBeneficiario, factura.cuitEmisor)) {
        cuitMatch = true;
        reasons.push('Beneficiary CUIT/DNI match');
      } else if (pago.cuitPagador && factura.cuitEmisor && cuitOrDniMatch(pago.cuitPagador, factura.cuitEmisor)) {
        cuitMatch = true;
        reasons.push('Payer CUIT/DNI match');
      }

      // Check for name match (optional boost)
      // Priority: beneficiary name > payer name
      let nameMatch = false;
      if (pago.nombreBeneficiario && factura.razonSocialEmisor) {
        const beneficiarioName = normalizeString(pago.nombreBeneficiario);
        const facturaName = normalizeString(factura.razonSocialEmisor);
        // Check if one name contains significant part of the other
        nameMatch = beneficiarioName.includes(facturaName) || facturaName.includes(beneficiarioName);
        if (nameMatch) {
          reasons.push('Beneficiary name match');
        }
      } else if (pago.nombrePagador && factura.razonSocialEmisor) {
        const pagoName = normalizeString(pago.nombrePagador);
        const facturaName = normalizeString(factura.razonSocialEmisor);
        // Check if one name contains significant part of the other
        nameMatch = pagoName.includes(facturaName) || facturaName.includes(pagoName);
        if (nameMatch) {
          reasons.push('Payer name match');
        }
      }

      // Calculate confidence based on date tier and CUIT/name matching
      // For cross-currency matches, cap confidence at MEDIUM (with CUIT) or LOW (without)
      const confidence = this.calculateConfidence(isWithinMediumRange, cuitMatch, nameMatch, isCrossCurrency);

      // Check if this is an upgrade (factura already matched)
      const isUpgrade = !!factura.matchedPagoFileId;
      const existingMatchConfidence = isUpgrade ? (factura.matchConfidence || 'LOW' as MatchConfidence) : undefined;
      const existingPagoFileId = isUpgrade ? factura.matchedPagoFileId : undefined;

      // Calculate existing date proximity if we have access to the pagos map
      let existingDateProximityDays: number | undefined;
      if (isUpgrade && existingPagoFileId && pagosMap) {
        const existingPago = pagosMap.get(existingPagoFileId);
        if (existingPago?.fechaPago) {
          const existingPagoDate = parseArgDate(existingPago.fechaPago);
          if (existingPagoDate && facturaDate) {
            existingDateProximityDays = Math.abs(Math.floor(
              (existingPagoDate.getTime() - facturaDate.getTime()) / (1000 * 60 * 60 * 24)
            ));
          }
        }
      }

      if (isUpgrade) {
        reasons.push(`Potential upgrade from ${existingMatchConfidence}`);
      }

      candidates.push({
        factura,
        facturaFileId: factura.fileId,
        facturaRow: factura.row,
        confidence,
        reasons,
        hasCuitMatch: cuitMatch,
        dateProximityDays: daysDiff,
        isUpgrade,
        existingMatchConfidence,
        existingPagoFileId,
        existingDateProximityDays
      });
    }

    // Sort by match quality (confidence, CUIT match, date proximity)
    candidates.sort((a, b) => {
      const qualityA: MatchQuality = {
        confidence: a.confidence,
        hasCuitMatch: a.hasCuitMatch || false,
        dateProximityDays: a.dateProximityDays || 999
      };
      const qualityB: MatchQuality = {
        confidence: b.confidence,
        hasCuitMatch: b.hasCuitMatch || false,
        dateProximityDays: b.dateProximityDays || 999
      };
      return compareMatchQuality(qualityB, qualityA); // Sort descending
    });

    return candidates;
  }

  /**
   * Calculates match confidence level based on date tier and CUIT/name matching
   *
   * Date ranges determine the base confidence tier:
   * - HIGH range [0, 15]: Can achieve HIGH (with CUIT/name) or MEDIUM (without)
   * - MEDIUM range (-3, 30): Can achieve HIGH (with CUIT/name) or MEDIUM (without)
   * - LOW range (-10, 60): Always LOW regardless of CUIT/name
   *
   * Cross-currency matching has reduced confidence:
   * - With CUIT match: capped at MEDIUM
   * - Without CUIT match: LOW
   *
   * @param isWithinMediumRange - Whether date is within medium confidence range (-3, 30)
   * @param cuitMatch - Whether CUITs match
   * @param nameMatch - Whether names match
   * @param isCrossCurrency - Whether this is a cross-currency match (USD→ARS)
   * @returns Confidence level
   */
  private calculateConfidence(
    isWithinMediumRange: boolean,
    cuitMatch: boolean,
    nameMatch: boolean,
    isCrossCurrency: boolean = false
  ): MatchConfidence {
    // Cross-currency matching has special confidence rules
    if (isCrossCurrency) {
      // With CUIT match: cap at MEDIUM
      if (cuitMatch) {
        return 'MEDIUM';
      }
      // Without CUIT match: always LOW
      return 'LOW';
    }

    // If outside MEDIUM range, it's LOW confidence regardless of CUIT/name
    if (!isWithinMediumRange) {
      return 'LOW';
    }

    // Within MEDIUM or HIGH range: CUIT or name match boosts to HIGH
    if (cuitMatch || nameMatch) {
      return 'HIGH';
    }

    // Within HIGH range without CUIT/name: MEDIUM
    // Within MEDIUM range without CUIT/name: MEDIUM
    return 'MEDIUM';
  }
}

/**
 * Matches pagos to recibos with fuzzy date matching
 * Used for matching salary payments (Recibos) to bank payments (Pagos)
 */
export class ReciboPagoMatcher {
  private readonly dateRanges: DateRangeConfig;

  /**
   * Creates a new matcher
   *
   * @param dateRangeBefore - Days before recibo date for LOW tier (default: 10)
   * @param dateRangeAfter - Days after recibo date for LOW tier (default: 60)
   */
  constructor(dateRangeBefore: number = 10, dateRangeAfter: number = 60) {
    // Use provided values for LOW tier, keep HIGH and MEDIUM defaults
    this.dateRanges = {
      high: { ...DEFAULT_DATE_RANGES.high },
      medium: { ...DEFAULT_DATE_RANGES.medium },
      low: { before: dateRangeBefore, after: dateRangeAfter }
    };
  }

  /**
   * Finds all matching recibos for a pago
   *
   * @param pago - Payment to match
   * @param recibos - Available salary slips (can include already matched ones)
   * @param _includeMatched - Whether to consider already-matched recibos (for cascade displacement). Filtering is done by caller.
   * @param pagosMap - Optional map of pagos by fileId for calculating existingDateProximityDays
   * @returns Array of match candidates sorted by match quality
   */
  findMatches(
    pago: Pago,
    recibos: Array<Recibo & { row: number }>,
    _includeMatched: boolean = false,
    pagosMap?: Map<string, Pago>
  ): ReciboMatchCandidate[] {
    const candidates: ReciboMatchCandidate[] = [];

    // Parse pago date
    const pagoDate = parseArgDate(pago.fechaPago);
    if (!pagoDate) {
      return []; // Can't match without valid date
    }

    for (const recibo of recibos) {
      // Check amount match (pago amount should match recibo net salary)
      if (!amountsMatch(recibo.totalNeto, pago.importePagado)) {
        continue;
      }

      // Parse recibo date
      const reciboDate = parseArgDate(recibo.fechaPago);
      if (!reciboDate) {
        continue; // Skip if can't parse date
      }

      // Check date proximity against tiered ranges
      const isWithinHighRange = isWithinDays(reciboDate, pagoDate, this.dateRanges.high.before, this.dateRanges.high.after);
      const isWithinMediumRange = isWithinDays(reciboDate, pagoDate, this.dateRanges.medium.before, this.dateRanges.medium.after);
      const isWithinLowRange = isWithinDays(reciboDate, pagoDate, this.dateRanges.low.before, this.dateRanges.low.after);

      // Skip if not even within LOW range
      if (!isWithinLowRange) {
        continue;
      }

      // Calculate date proximity in days (absolute value)
      const daysDiff = Math.abs(Math.floor((pagoDate.getTime() - reciboDate.getTime()) / (1000 * 60 * 60 * 24)));

      // Build match candidate
      const reasons: string[] = [];
      reasons.push(`Amount match: ${pago.importePagado}`);

      if (isWithinHighRange) {
        reasons.push(`Date within high range: ${pago.fechaPago}`);
      } else if (isWithinMediumRange) {
        reasons.push(`Date within medium range: ${pago.fechaPago}`);
      } else {
        reasons.push(`Date within low range: ${pago.fechaPago}`);
      }

      // Check for CUIL match (beneficiary only, since employee receives payment)
      // For recibos, the employee (beneficiary) receives the payment
      // Uses cuitOrDniMatch to handle cases where payment shows DNI (7-8 digits)
      // instead of full CUIL (11 digits)
      let cuilMatch = false;
      if (pago.cuitBeneficiario && recibo.cuilEmpleado && cuitOrDniMatch(pago.cuitBeneficiario, recibo.cuilEmpleado)) {
        cuilMatch = true;
        reasons.push('Beneficiary CUIL/DNI matches employee');
      }

      // Check for name match (beneficiary only)
      let nameMatch = false;
      if (pago.nombreBeneficiario && recibo.nombreEmpleado) {
        const beneficiarioName = normalizeString(pago.nombreBeneficiario);
        const empleadoName = normalizeString(recibo.nombreEmpleado);
        // Check if one name contains significant part of the other
        nameMatch = beneficiarioName.includes(empleadoName) || empleadoName.includes(beneficiarioName);
        if (nameMatch) {
          reasons.push('Beneficiary name matches employee');
        }
      }

      // Calculate confidence based on date tier and CUIL/name matching
      const confidence = this.calculateConfidence(isWithinMediumRange, cuilMatch, nameMatch);

      // Check if this is an upgrade (recibo already matched)
      const isUpgrade = !!recibo.matchedPagoFileId;
      const existingMatchConfidence = isUpgrade ? (recibo.matchConfidence || 'LOW' as MatchConfidence) : undefined;
      const existingPagoFileId = isUpgrade ? recibo.matchedPagoFileId : undefined;

      // Calculate existing date proximity if we have access to the pagos map
      let existingDateProximityDays: number | undefined;
      if (isUpgrade && existingPagoFileId && pagosMap) {
        const existingPago = pagosMap.get(existingPagoFileId);
        if (existingPago?.fechaPago) {
          const existingPagoDate = parseArgDate(existingPago.fechaPago);
          if (existingPagoDate && reciboDate) {
            existingDateProximityDays = Math.abs(Math.floor(
              (existingPagoDate.getTime() - reciboDate.getTime()) / (1000 * 60 * 60 * 24)
            ));
          }
        }
      }

      if (isUpgrade) {
        reasons.push(`Potential upgrade from ${existingMatchConfidence}`);
      }

      candidates.push({
        recibo,
        reciboFileId: recibo.fileId,
        reciboRow: recibo.row,
        confidence,
        reasons,
        hasCuilMatch: cuilMatch,
        dateProximityDays: daysDiff,
        isUpgrade,
        existingMatchConfidence,
        existingPagoFileId,
        existingDateProximityDays
      });
    }

    // Sort by match quality (confidence, CUIL match, date proximity)
    candidates.sort((a, b) => {
      const qualityA: MatchQuality = {
        confidence: a.confidence,
        hasCuitMatch: a.hasCuilMatch || false,
        dateProximityDays: a.dateProximityDays || 999
      };
      const qualityB: MatchQuality = {
        confidence: b.confidence,
        hasCuitMatch: b.hasCuilMatch || false,
        dateProximityDays: b.dateProximityDays || 999
      };
      return compareMatchQuality(qualityB, qualityA); // Sort descending
    });

    return candidates;
  }

  /**
   * Calculates match confidence level based on date tier and CUIL/name matching
   *
   * Same logic as FacturaPagoMatcher:
   * - HIGH range [0, 15]: Can achieve HIGH (with CUIL/name) or MEDIUM (without)
   * - MEDIUM range (-3, 30): Can achieve HIGH (with CUIL/name) or MEDIUM (without)
   * - LOW range (-10, 60): Always LOW regardless of CUIL/name
   *
   * @param isWithinMediumRange - Whether date is within medium confidence range (-3, 30)
   * @param cuilMatch - Whether CUILs match
   * @param nameMatch - Whether names match
   * @returns Confidence level
   */
  private calculateConfidence(
    isWithinMediumRange: boolean,
    cuilMatch: boolean,
    nameMatch: boolean
  ): MatchConfidence {
    // If outside MEDIUM range, it's LOW confidence regardless of CUIL/name
    if (!isWithinMediumRange) {
      return 'LOW';
    }

    // Within MEDIUM or HIGH range: CUIL or name match boosts to HIGH
    if (cuilMatch || nameMatch) {
      return 'HIGH';
    }

    // Within HIGH range without CUIL/name: MEDIUM
    // Within MEDIUM range without CUIL/name: MEDIUM
    return 'MEDIUM';
  }
}
