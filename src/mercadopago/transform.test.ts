/**
 * Unit tests for MP payments → MovimientoBancario row transform
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as loggerModule from '../utils/logger.js';

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { paymentsToMovimientos } from './transform.js';
import type { MpPayment } from './client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCharge(
  name: string,
  original: number,
  refunded: number,
  from: string,
  to: string = 'mp',
): MpPayment['charges_details'][number] {
  return { name, type: 'debit', amounts: { original, refunded }, accounts: { from, to } };
}

function makePayment(overrides: Partial<MpPayment> = {}): MpPayment {
  return {
    id: 158805080384,
    status: 'approved',
    date_approved: '2026-05-15T13:07:57.000-03:00',
    operation_type: 'regular_payment',
    description: 'Unipersonal',
    external_reference: '',
    currency_id: 'ARS',
    transaction_amount: 25000,
    amount_refunded: 0,
    transaction_details: { net_received_amount: 23350 },
    payer: {
      identification: { type: 'CUIT', number: '20123456786' },
      email: 'payer@example.com',
    },
    collector_id: 12345,
    charges_details: [
      makeCharge('mercadopago_fee', 450, 0, 'collector'),
      makeCharge('tax_withholding_collector-debitos_creditos', 150, 0, 'collector'),
      makeCharge('tax_withholding_sirtac-caba', 425, 0, 'collector'),
      makeCharge('tax_withholding-caba', 625, 0, 'collector'),
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('paymentsToMovimientos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Main happy path
  // -------------------------------------------------------------------------
  describe('approved ARS payment with all charge types', () => {
    it('produces one credit row followed by one debit row per collector charge', () => {
      const payment = makePayment();
      const { movimientos, skipped } = paymentsToMovimientos([payment]);

      expect(skipped).toBe(0);
      // 1 credit + 4 debit rows
      expect(movimientos).toHaveLength(5);

      // Credit row
      const credit = movimientos[0];
      expect(credit.fecha).toBe('2026-05-15');
      expect(credit.concepto).toBe('MP 158805080384 - CUIT 20123456786 - Unipersonal');
      expect(credit.credito).toBe(25000);
      expect(credit.debito).toBeNull();
      expect(credit.saldo).toBeNull();

      // Debit rows — charge name mapping
      const debit1 = movimientos[1];
      expect(debit1.concepto).toBe('MP 158805080384 - Comisión Mercado Pago');
      expect(debit1.debito).toBe(450);
      expect(debit1.credito).toBeNull();
      expect(debit1.saldo).toBeNull();

      const debit2 = movimientos[2];
      expect(debit2.concepto).toBe('MP 158805080384 - Imp. Débitos y Créditos');
      expect(debit2.debito).toBe(150);

      const debit3 = movimientos[3];
      expect(debit3.concepto).toBe('MP 158805080384 - Retención SIRTAC CABA');
      expect(debit3.debito).toBe(425);

      const debit4 = movimientos[4];
      expect(debit4.concepto).toBe('MP 158805080384 - Retención IIBB CABA');
      expect(debit4.debito).toBe(625);
    });

    it('debit rows do NOT contain payer identity', () => {
      const { movimientos } = paymentsToMovimientos([makePayment()]);

      for (const row of movimientos.slice(1)) {
        expect(row.concepto).not.toContain('20123456786');
        expect(row.concepto).not.toContain('CUIT');
        expect(row.concepto).not.toContain('CUIL');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Collector-only filter
  // -------------------------------------------------------------------------
  describe('accounts.from filter', () => {
    it('only produces debit rows for charges where accounts.from === collector', () => {
      // charges split between collector and merchant — diff equals collector-only sum
      const payment2 = makePayment({
        transaction_amount: 1000,
        transaction_details: { net_received_amount: 950 },
        charges_details: [
          makeCharge('mercadopago_fee', 50, 0, 'collector'),   // debit
          makeCharge('merchant_fee', 30, 0, 'merchant'),       // no debit — but diff≠50
          // diff = 50, collector sum = 50 → OK
        ],
      });

      // diff = 1000 - 950 = 50; collector sum = 50 → reconciliation passes
      const { movimientos } = paymentsToMovimientos([payment2]);
      // 1 credit + 1 debit (only collector charge)
      expect(movimientos).toHaveLength(2);
      expect(movimientos[1].concepto).toBe('MP 158805080384 - Comisión Mercado Pago');
      expect(movimientos[1].debito).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // Charge amounts net of refunded
  // -------------------------------------------------------------------------
  describe('charge amounts net of amounts.refunded', () => {
    it('uses original - refunded as the debit amount', () => {
      const payment = makePayment({
        transaction_amount: 1000,
        transaction_details: { net_received_amount: 920 },
        charges_details: [
          makeCharge('mercadopago_fee', 80, 0, 'collector'),     // net = 80
          makeCharge('tax_withholding-caba', 50, 50, 'collector'), // net = 0 → still a row?
          // sum: 80 + 0 = 80; diff = 1000 - 920 = 80 → reconciliation passes
        ],
      });

      const { movimientos } = paymentsToMovimientos([payment]);

      const feeDebit = movimientos.find(r => r.concepto?.includes('Comisión'));
      expect(feeDebit?.debito).toBe(80);

      // Charge with net=0 still produces a $0 row (itemized, never dropped)
      const zeroDebit = movimientos.find(r => r.concepto?.includes('Retención IIBB'));
      expect(zeroDebit?.debito).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Reconciliation guard
  // -------------------------------------------------------------------------
  describe('reconciliation guard', () => {
    it('uses itemized rows when Σ(collector charges) === transaction_amount - net_received_amount', () => {
      // charges sum = 1650, diff = 25000 - 23350 = 1650 → passes
      const { movimientos } = paymentsToMovimientos([makePayment()]);

      // No combined fallback — should have individual debit rows
      expect(movimientos.every(r => r.concepto !== 'MP 158805080384 - Comisiones e impuestos Mercado Pago')).toBe(true);
      expect(movimientos).toHaveLength(5); // 1 credit + 4 debits
    });

    it('falls back to combined debit when Σ(collector charges) does not match diff', () => {
      const payment = makePayment({
        transaction_amount: 1000,
        transaction_details: { net_received_amount: 900 }, // diff = 100
        charges_details: [
          makeCharge('mercadopago_fee', 60, 0, 'collector'),   // sum = 60 ≠ 100
        ],
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      // 1 credit + 1 combined debit
      expect(movimientos).toHaveLength(2);
      const debit = movimientos[1];
      expect(debit.concepto).toBe('MP 158805080384 - Comisiones e impuestos Mercado Pago');
      expect(debit.debito).toBe(100); // full diff
    });

    it('logs a warn when reconciliation falls back', () => {
      const payment = makePayment({
        transaction_amount: 1000,
        transaction_details: { net_received_amount: 900 },
        charges_details: [
          makeCharge('mercadopago_fee', 60, 0, 'collector'), // mismatch
        ],
      });

      paymentsToMovimientos([payment]);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });

    it('uses no debit rows when diff === 0 and no charges', () => {
      const payment = makePayment({
        transaction_amount: 500,
        transaction_details: { net_received_amount: 500 },
        charges_details: [],
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0].credito).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // CUIL identification
  // -------------------------------------------------------------------------
  describe('CUIL payer identification', () => {
    it('renders CUIL prefix for type=CUIL (extractable by extractCuitFromText)', () => {
      const payment = makePayment({
        payer: {
          identification: { type: 'CUIL', number: '27234567891' },
          email: 'cuil@example.com',
        },
        charges_details: [],
        transaction_amount: 500,
        transaction_details: { net_received_amount: 500 },
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      expect(movimientos[0].concepto).toBe('MP 158805080384 - CUIL 27234567891 - Unipersonal');
    });

    it('renders DNI prefix for type=DNI — never mislabels a DNI as CUIT', () => {
      const payment = makePayment({
        payer: {
          identification: { type: 'DNI', number: '12345678' },
          email: 'dni@example.com',
        },
        charges_details: [],
        transaction_amount: 500,
        transaction_details: { net_received_amount: 500 },
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      expect(movimientos[0].concepto).toBe('MP 158805080384 - DNI 12345678 - Unipersonal');
    });
  });

  // -------------------------------------------------------------------------
  // Missing payer identification
  // -------------------------------------------------------------------------
  describe('missing payer identification', () => {
    it('omits identity segment when payer.identification.number is empty', () => {
      const payment = makePayment({
        payer: { identification: { type: '', number: '' }, email: 'noid@example.com' },
        charges_details: [],
        transaction_amount: 500,
        transaction_details: { net_received_amount: 500 },
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      expect(movimientos[0].concepto).toBe('MP 158805080384 - Unipersonal');
      expect(movimientos[0].concepto).not.toContain('undefined');
      expect(movimientos[0].concepto).not.toContain('null');
    });

    it('omits identity segment when payer is missing entirely', () => {
      const payment = makePayment({
        payer: undefined as unknown as MpPayment['payer'],
        charges_details: [],
        transaction_amount: 500,
        transaction_details: { net_received_amount: 500 },
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      expect(movimientos[0].concepto).toBe('MP 158805080384 - Unipersonal');
    });
  });

  // -------------------------------------------------------------------------
  // Timezone edge cases
  // -------------------------------------------------------------------------
  describe('timezone conversion (date_approved → AR date)', () => {
    it('converts UTC-4 timestamp that crosses midnight to the next AR date', () => {
      // '2026-05-31T23:15:00.000-04:00' = 2026-06-01T03:15:00Z = 2026-06-01T00:15:00-03:00
      const payment = makePayment({
        date_approved: '2026-05-31T23:15:00.000-04:00',
        charges_details: [],
        transaction_amount: 500,
        transaction_details: { net_received_amount: 500 },
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      expect(movimientos[0].fecha).toBe('2026-06-01');
    });

    it('converts a daytime UTC-4 timestamp to the correct AR date', () => {
      // '2026-05-11T13:07:57.000-04:00' = 2026-05-11T17:07:57Z = 2026-05-11T14:07:57-03:00
      const payment = makePayment({
        date_approved: '2026-05-11T13:07:57.000-04:00',
        charges_details: [],
        transaction_amount: 500,
        transaction_details: { net_received_amount: 500 },
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      expect(movimientos[0].fecha).toBe('2026-05-11');
    });
  });

  // -------------------------------------------------------------------------
  // Non-ARS currency
  // -------------------------------------------------------------------------
  describe('non-ARS currency', () => {
    it('skips non-ARS payments and counts them in skipped', () => {
      const arsPayment = makePayment({ id: 1, currency_id: 'ARS' });
      const usdPayment = makePayment({ id: 2, currency_id: 'USD' });

      const { movimientos, skipped } = paymentsToMovimientos([arsPayment, usdPayment]);

      expect(skipped).toBe(1);
      // Only ARS payment rows
      const ids = movimientos
        .filter(r => r.credito !== null)
        .map(r => r.concepto.match(/MP (\d+)/)?.[1]);
      expect(ids).toContain('1');
      expect(ids).not.toContain('2');
    });
  });

  // -------------------------------------------------------------------------
  // Partial refund (amount_refunded > 0)
  // -------------------------------------------------------------------------
  describe('amount_refunded > 0', () => {
    it('still produces rows and logs a warn', () => {
      const payment = makePayment({
        amount_refunded: 100,
        charges_details: [],
        transaction_amount: 500,
        transaction_details: { net_received_amount: 500 },
      });

      const { movimientos } = paymentsToMovimientos([payment]);
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0].credito).toBe(500);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Unknown charge name fallback
  // -------------------------------------------------------------------------
  describe('unknown charge name', () => {
    it('uses raw charge name as concepto label (never dropped)', () => {
      const payment = makePayment({
        transaction_amount: 1000,
        transaction_details: { net_received_amount: 900 },
        charges_details: [
          makeCharge('some_future_charge_type', 100, 0, 'collector'),
        ],
      });

      // diff = 100, sum = 100 → reconciliation passes
      const { movimientos } = paymentsToMovimientos([payment]);
      const debit = movimientos[1];
      expect(debit.concepto).toBe('MP 158805080384 - some_future_charge_type');
      expect(debit.debito).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // Malformed charge entries (defensive — API boundary)
  // -------------------------------------------------------------------------
  describe('malformed charge entries', () => {
    it('does not throw when a charge is missing accounts — falls back to combined debit', () => {
      const payment = makePayment({
        transaction_amount: 1000,
        transaction_details: { net_received_amount: 900 },
        charges_details: [
          { name: 'mercadopago_fee', type: 'debit', amounts: { original: 100, refunded: 0 } },
        ],
      });

      // The charge cannot be attributed to the collector → chargesSum (0) ≠ diff (100)
      // → reconciliation guard emits a single combined debit for the full diff
      const { movimientos } = paymentsToMovimientos([payment]);

      expect(movimientos).toHaveLength(2);
      expect(movimientos[1].concepto).toBe('MP 158805080384 - Comisiones e impuestos Mercado Pago');
      expect(movimientos[1].debito).toBe(100);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });

    it('does not throw when a collector charge is missing amounts — falls back to combined debit', () => {
      const payment = makePayment({
        transaction_amount: 1000,
        transaction_details: { net_received_amount: 900 },
        charges_details: [
          { name: 'mercadopago_fee', type: 'debit', accounts: { from: 'collector', to: 'mp' } },
        ],
      });

      // amounts missing → charge nets to 0 → chargesSum (0) ≠ diff (100)
      // → reconciliation guard emits a single combined debit for the full diff
      const { movimientos } = paymentsToMovimientos([payment]);

      expect(movimientos).toHaveLength(2);
      expect(movimientos[1].concepto).toBe('MP 158805080384 - Comisiones e impuestos Mercado Pago');
      expect(movimientos[1].debito).toBe(100);
      expect(vi.mocked(loggerModule.warn)).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------
  describe('output sort order', () => {
    it('sorts rows by fecha ascending, then by id for same-day payments', () => {
      const day1PaymentId10 = makePayment({
        id: 10,
        date_approved: '2026-05-01T12:00:00.000-03:00',
        charges_details: [],
        transaction_amount: 100,
        transaction_details: { net_received_amount: 100 },
      });
      const day1PaymentId5 = makePayment({
        id: 5,
        date_approved: '2026-05-01T10:00:00.000-03:00',
        charges_details: [],
        transaction_amount: 200,
        transaction_details: { net_received_amount: 200 },
      });
      const day2Payment = makePayment({
        id: 3,
        date_approved: '2026-05-02T09:00:00.000-03:00',
        charges_details: [],
        transaction_amount: 300,
        transaction_details: { net_received_amount: 300 },
      });

      // Pass in non-sorted order
      const { movimientos } = paymentsToMovimientos([day1PaymentId10, day2Payment, day1PaymentId5]);

      const creditRows = movimientos.filter(r => r.credito !== null);
      // Same-day sorted by id asc: id=5 before id=10
      expect(creditRows[0].concepto).toContain('MP 5');
      expect(creditRows[1].concepto).toContain('MP 10');
      // day2 last
      expect(creditRows[2].concepto).toContain('MP 3');
      expect(creditRows[2].fecha).toBe('2026-05-02');
    });
  });

  // -------------------------------------------------------------------------
  // skipped count
  // -------------------------------------------------------------------------
  describe('skipped count', () => {
    it('returns 0 when all payments are ARS', () => {
      const { skipped } = paymentsToMovimientos([makePayment()]);
      expect(skipped).toBe(0);
    });

    it('counts all non-ARS payments as skipped', () => {
      const payments = [
        makePayment({ id: 1, currency_id: 'ARS' }),
        makePayment({ id: 2, currency_id: 'USD' }),
        makePayment({ id: 3, currency_id: 'BRL' }),
      ];

      const { skipped } = paymentsToMovimientos(payments);
      expect(skipped).toBe(2);
    });
  });
});
