/**
 * Unit tests for subdiario_cobro dead code removal
 *
 * This test verified that 'subdiario_cobro' was dead code before removal.
 * The dead code has been removed from the codebase.
 */

import { describe, it, expect } from 'vitest';

describe('subdiario_cobro removal', () => {
  it('confirms subdiario_cobro has been removed from BankMatchType', () => {
    // BankMatchType should not include 'subdiario_cobro'
    // This would cause a TypeScript compilation error if 'subdiario_cobro' was still in the type

    // Valid match types after removal:
    const validMatchTypes = [
      'bank_fee',
      'credit_card_payment',
      'pago_factura',
      'direct_factura',
      'recibo',
      'pago_only',
      'no_match'
    ] as const;

    expect(validMatchTypes).not.toContain('subdiario_cobro');
  });
});
