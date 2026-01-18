/**
 * Subdiario de Ventas matcher
 * Matches bank credit movements against Cobros from Subdiario de Ventas
 */

import type {
  BankMovement,
  SubdiarioCobro,
  SubdiarioMatchResult,
  MatchConfidence
} from '../types/index.js';
import { isValidCuit } from '../utils/validation.js';
import { parseArgDate } from '../utils/date.js';

/**
 * Amount tolerance for matching (in pesos)
 */
const AMOUNT_TOLERANCE = 1;

/**
 * Date range for MEDIUM confidence (±15 days)
 */
const MEDIUM_CONFIDENCE_DAYS = 15;

/**
 * Date range for LOW confidence (±30 days)
 */
const LOW_CONFIDENCE_DAYS = 30;

/**
 * Extracts CUIT from bank movement concepto text
 * Uses the same logic as extractCuitFromConcepto in matcher.ts
 *
 * @param concepto - Bank movement concept text
 * @returns Extracted CUIT (11 digits) or undefined
 */
export function extractCuitFromMovementConcepto(concepto: string): string | undefined {
  if (!concepto) {
    return undefined;
  }

  // Pattern 1: Explicit CUIT/CUIL prefix
  const explicitMatch = concepto.match(/CUI[TL][:\s]*(\d{2}[-\s]?\d{8}[-\s]?\d)/i);
  if (explicitMatch) {
    const cleaned = explicitMatch[1].replace(/[-\s]/g, '');
    if (isValidCuit(cleaned)) {
      return cleaned;
    }
  }

  // Pattern 2: 11-digit number with separators (XX-XXXXXXXX-X)
  const separatedMatch = concepto.match(/(\d{2})[-\s](\d{8})[-\s](\d)/);
  if (separatedMatch) {
    const cleaned = separatedMatch[1] + separatedMatch[2] + separatedMatch[3];
    if (isValidCuit(cleaned)) {
      return cleaned;
    }
  }

  // Pattern 3: Plain 11-digit number (validate checksum to reduce false positives)
  const plainMatches = concepto.match(/\b(\d{11})\b/g);
  if (plainMatches) {
    for (const match of plainMatches) {
      if (isValidCuit(match)) {
        return match;
      }
    }
  }

  return undefined;
}

/**
 * Checks if two amounts match within tolerance
 */
function amountsMatchWithTolerance(amount1: number, amount2: number): boolean {
  return Math.abs(amount1 - amount2) <= AMOUNT_TOLERANCE;
}

/**
 * Calculates the number of days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Formats the Detalle text for a matched cobro
 */
function formatDetalle(cobro: SubdiarioCobro): string {
  const parts = [`Cobro ${cobro.cliente}`, `Fc ${cobro.comprobanteNumero}`];
  if (cobro.concepto) {
    parts.push(cobro.concepto);
  }
  return parts.join(' - ');
}

/**
 * Matcher for Subdiario de Ventas Cobros
 *
 * Two-pass matching:
 * 1. CUIT match: Extract CUIT from movement concepto, find cobro with same CUIT + matching amount
 * 2. Amount + Date: For remaining, match by amount and date proximity
 */
export class SubdiarioMatcher {
  /**
   * Matches a bank credit movement against cobros
   *
   * @param movement - Bank movement (must be a credit)
   * @param cobros - Available cobros to match against
   * @param usedCobros - Set of cobro row numbers already used (to prevent double-matching)
   * @returns Match result with generated Detalle text
   */
  matchMovement(
    movement: BankMovement,
    cobros: SubdiarioCobro[],
    usedCobros: Set<number>
  ): SubdiarioMatchResult {
    // Only match credit movements
    if (movement.credito === null || movement.credito === 0) {
      return this.noMatch(['Not a credit movement']);
    }

    if (cobros.length === 0) {
      return this.noMatch(['No cobros to match against']);
    }

    const creditAmount = movement.credito;

    // Filter out already used cobros
    const availableCobros = cobros.filter(c => !usedCobros.has(c.rowNumber));
    if (availableCobros.length === 0) {
      return this.noMatch(['All cobros already matched']);
    }

    // Parse movement date
    const movementDate = parseArgDate(movement.fecha) || parseArgDate(movement.fechaValor);
    if (!movementDate) {
      return this.noMatch(['No valid date in movement']);
    }

    // Extract CUIT from concepto
    const extractedCuit = extractCuitFromMovementConcepto(movement.concepto);

    // Pass 1: Try CUIT + amount + date match
    if (extractedCuit) {
      const cuitMatch = this.findCuitMatch(creditAmount, extractedCuit, movementDate, availableCobros);
      if (cuitMatch) {
        const days = daysBetween(movementDate, cuitMatch.cobro.fechaCobro);
        return {
          matched: true,
          cobro: cuitMatch.cobro,
          confidence: 'HIGH',
          reasons: [
            `CUIT match: ${extractedCuit}`,
            `Amount match: ${creditAmount}`,
            `Date proximity: ${days} days`
          ],
          detalle: formatDetalle(cuitMatch.cobro)
        };
      }
    }

    // Pass 2: Try amount + date match
    const dateMatch = this.findDateMatch(creditAmount, movementDate, availableCobros);
    if (dateMatch) {
      const days = daysBetween(movementDate, dateMatch.cobro.fechaCobro);
      const confidence: MatchConfidence = days <= MEDIUM_CONFIDENCE_DAYS ? 'MEDIUM' : 'LOW';

      return {
        matched: true,
        cobro: dateMatch.cobro,
        confidence,
        reasons: [
          `Amount match: ${creditAmount}`,
          `Date proximity: ${days} days`
        ],
        detalle: formatDetalle(dateMatch.cobro)
      };
    }

    return this.noMatch(['No matching cobros found']);
  }

  /**
   * Finds a cobro with matching CUIT, amount, and date within range
   * Returns the cobro with the closest date if multiple matches exist
   */
  private findCuitMatch(
    amount: number,
    cuit: string,
    movementDate: Date,
    cobros: SubdiarioCobro[]
  ): { cobro: SubdiarioCobro; days: number } | null {
    let bestMatch: { cobro: SubdiarioCobro; days: number } | null = null;

    for (const cobro of cobros) {
      // Check CUIT
      if (cobro.cuit !== cuit) {
        continue;
      }

      // Check amount
      if (!amountsMatchWithTolerance(cobro.total, amount)) {
        continue;
      }

      // Check date proximity (must be within LOW confidence range)
      const days = daysBetween(movementDate, cobro.fechaCobro);
      if (days > LOW_CONFIDENCE_DAYS) {
        continue;
      }

      // Keep the closest date
      if (!bestMatch || days < bestMatch.days) {
        bestMatch = { cobro, days };
      }
    }

    return bestMatch;
  }

  /**
   * Finds a cobro with matching amount and date within range
   * Returns the cobro with the closest date
   */
  private findDateMatch(
    amount: number,
    movementDate: Date,
    cobros: SubdiarioCobro[]
  ): { cobro: SubdiarioCobro; days: number } | null {
    let bestMatch: { cobro: SubdiarioCobro; days: number } | null = null;

    for (const cobro of cobros) {
      // Check amount
      if (!amountsMatchWithTolerance(cobro.total, amount)) {
        continue;
      }

      // Check date proximity
      const days = daysBetween(movementDate, cobro.fechaCobro);
      if (days > LOW_CONFIDENCE_DAYS) {
        continue;
      }

      // Keep the closest date
      if (!bestMatch || days < bestMatch.days) {
        bestMatch = { cobro, days };
      }
    }

    return bestMatch;
  }

  /**
   * Creates a no-match result
   */
  private noMatch(reasons: string[]): SubdiarioMatchResult {
    return {
      matched: false,
      confidence: 'LOW',
      reasons,
      detalle: ''
    };
  }
}
