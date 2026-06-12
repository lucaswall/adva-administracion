/**
 * Transform Mercado Pago approved payments into MovimientoBancario rows.
 *
 * Each ARS payment generates:
 *   - One CREDIT row for transaction_amount (the gross amount collected)
 *   - One DEBIT row per charge where accounts.from === 'collector' (itemized fees / taxes)
 *
 * Reconciliation guard: if Σ(collector charge debits) differs from
 * (transaction_amount − net_received_amount) by more than $0.01, the
 * itemized debits are discarded and a single combined debit row is emitted
 * for the full difference. This ensures the running balance never drifts.
 *
 * Non-ARS payments are silently skipped (counted in the returned `skipped`).
 */

import type { MovimientoBancario } from '../types/index.js';
import { businessDateString } from '../utils/date.js';
import { warn } from '../utils/logger.js';
import type { MpPayment } from './client.js';

// ---------------------------------------------------------------------------
// Charge name mapping
// ---------------------------------------------------------------------------

/**
 * Maps a raw MP charge `name` to a human-readable Spanish label.
 * Unknown names fall back to the raw name (still itemized, never dropped).
 */
function getChargeLabel(name: string): string {
  if (name === 'mercadopago_fee') {
    return 'Comisión Mercado Pago';
  }

  if (name === 'tax_withholding_collector-debitos_creditos') {
    return 'Imp. Débitos y Créditos';
  }

  // tax_withholding_sirtac-{jurisdiccion}
  const sirtacMatch = name.match(/^tax_withholding_sirtac-(.+)$/);
  if (sirtacMatch) {
    return `Retención SIRTAC ${(sirtacMatch[1] ?? '').toUpperCase()}`;
  }

  // tax_withholding-{jurisdiccion}  (IIBB)
  const iibbMatch = name.match(/^tax_withholding-(.+)$/);
  if (iibbMatch) {
    return `Retención IIBB ${(iibbMatch[1] ?? '').toUpperCase()}`;
  }

  // Unknown: raw name (itemized, never dropped)
  return name;
}

// ---------------------------------------------------------------------------
// Identity rendering
// ---------------------------------------------------------------------------

/**
 * Returns "CUIT {number}" / "CUIL {number}" / "" depending on payer info.
 * Empty string means the identity segment should be omitted from concepto.
 * The prefix format is required so that extractCuitFromText() can find the number.
 */
function renderPayerIdentity(payer: MpPayment['payer'] | undefined): string {
  if (!payer) return '';
  const { type, number } = payer.identification ?? {};
  if (!number || !type) return '';

  const prefix = type.toUpperCase() === 'CUIL' ? 'CUIL' : 'CUIT';
  return `${prefix} ${number}`;
}

// ---------------------------------------------------------------------------
// Row groups (credit + debits for one payment)
// ---------------------------------------------------------------------------

interface PaymentGroup {
  /** The date used for sorting (AR timezone YYYY-MM-DD) */
  fecha: string;
  /** The payment ID used as secondary sort key */
  id: number;
  /** All rows: credit first, then debits */
  rows: MovimientoBancario[];
}

/**
 * Converts a single ARS-denominated MpPayment into a PaymentGroup.
 * Returns null if the payment should be skipped (non-ARS).
 */
function paymentToGroup(payment: MpPayment): PaymentGroup {
  const fecha = businessDateString(new Date(payment.date_approved));
  const idStr = String(payment.id);

  // ---- Identity segment ----
  const identity = renderPayerIdentity(payment.payer);
  const creditConcepto = identity
    ? `MP ${idStr} - ${identity} - ${payment.description}`
    : `MP ${idStr} - ${payment.description}`;

  // ---- Credit row ----
  const creditRow: MovimientoBancario = {
    fecha,
    concepto: creditConcepto,
    credito: payment.transaction_amount,
    debito: null,
    saldo: null,
  };

  // ---- Collector charges ----
  const diff = payment.transaction_amount - payment.transaction_details.net_received_amount;
  // Charge entries are not validated at the API boundary — a malformed entry
  // (missing accounts/amounts) nets to 0 or drops out of the collector filter,
  // and the reconciliation guard below falls back to the combined debit row.
  const collectorCharges = payment.charges_details.filter(
    c => c.accounts?.from === 'collector',
  );

  const chargeDebits = collectorCharges.map(c => ({
    name: c.name,
    net: (c.amounts?.original ?? 0) - (c.amounts?.refunded ?? 0),
  }));

  const chargesSum = chargeDebits.reduce((sum, c) => sum + c.net, 0);
  const reconciled = Math.abs(chargesSum - diff) <= 0.01;

  let debitRows: MovimientoBancario[];

  if (diff === 0 && chargesSum === 0) {
    // No fees — credit row only
    debitRows = [];
  } else if (reconciled) {
    // Itemized debit rows
    debitRows = chargeDebits.map(c => ({
      fecha,
      concepto: `MP ${idStr} - ${getChargeLabel(c.name)}`,
      credito: null,
      debito: c.net,
      saldo: null,
    }));
  } else {
    // Reconciliation failed: emit single combined debit for the full diff
    warn('MP payment charge reconciliation failed — using combined debit', {
      module: 'mercadopago',
      paymentId: payment.id,
      chargesSum,
      diff,
    });
    debitRows = diff !== 0
      ? [
          {
            fecha,
            concepto: `MP ${idStr} - Comisiones e impuestos Mercado Pago`,
            credito: null,
            debito: diff,
            saldo: null,
          },
        ]
      : [];
  }

  return { fecha, id: payment.id, rows: [creditRow, ...debitRows] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transforms an array of approved MP payments into MovimientoBancario rows.
 *
 * @param payments - Approved MpPayment objects (any currency — non-ARS are skipped)
 * @returns An object with:
 *   - `movimientos`: rows sorted by fecha ASC then by payment id ASC (deterministic)
 *   - `skipped`: count of non-ARS payments that were ignored
 *
 * @remarks
 * - Each ARS payment becomes 1 credit row + N debit rows (one per collector charge)
 * - Debit rows never contain payer identity (to avoid mis-feeding the CUIT matcher)
 * - The `MP {id}` prefix in concepto is the idempotency key for the sheet writer
 * - `saldo` is always null (no PDF balance; the sheet formula column fills it in)
 */
export function paymentsToMovimientos(payments: MpPayment[]): {
  movimientos: MovimientoBancario[];
  skipped: number;
} {
  let skipped = 0;
  const groups: PaymentGroup[] = [];

  for (const payment of payments) {
    // Warn on partial refunds but still produce rows
    if (payment.amount_refunded > 0) {
      warn('MP payment has amount_refunded > 0, producing rows anyway', {
        module: 'mercadopago',
        paymentId: payment.id,
        amountRefunded: payment.amount_refunded,
      });
    }

    if (payment.currency_id !== 'ARS') {
      skipped++;
      continue;
    }

    groups.push(paymentToGroup(payment));
  }

  // Sort groups: fecha ASC, then id ASC for same-day payments
  groups.sort((a, b) => {
    if (a.fecha < b.fecha) return -1;
    if (a.fecha > b.fecha) return 1;
    return a.id - b.id;
  });

  const movimientos = groups.flatMap(g => g.rows);
  return { movimientos, skipped };
}
