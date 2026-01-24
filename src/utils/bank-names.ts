/**
 * Bank name normalization utilities
 * Standardizes bank names to prevent duplicate folders from Gemini API non-determinism
 */

/**
 * Mapping of bank name variations to their canonical form
 * This prevents duplicate folders when Gemini API returns different variations
 * of the same bank name (e.g., "BancoCiudad" vs "Banco Ciudad")
 */
const BANK_NAME_ALIASES: Record<string, string> = {
  // Banco Ciudad variations
  'BancoCiudad': 'Banco Ciudad',
  'Banco de la Ciudad': 'Banco Ciudad',
  'Ciudad': 'Banco Ciudad',

  // Credicoop variations
  'Banco Credicoop': 'Credicoop',
  'Banco Credicoop Cooperativo Limitado': 'Credicoop',
  'Credicoop Cooperativo Limitado': 'Credicoop',

  // BBVA variations
  'BBVA Frances': 'BBVA',
  'BBVA Francés': 'BBVA',
  'Banco BBVA': 'BBVA',
};

/**
 * Normalizes bank names to prevent duplicate folders
 *
 * @param banco - Bank name from Gemini extraction
 * @returns Canonical bank name
 *
 * @example
 * ```typescript
 * normalizeBankName('BancoCiudad') // => 'Banco Ciudad'
 * normalizeBankName('Banco de la Ciudad') // => 'Banco Ciudad'
 * normalizeBankName('BBVA Frances') // => 'BBVA'
 * normalizeBankName('Unknown Bank') // => 'Unknown Bank' (unchanged)
 * ```
 */
export function normalizeBankName(banco: string): string {
  return BANK_NAME_ALIASES[banco] || banco;
}
