// STUB FILE — real implementation merged from another worker branch. Lead discards this file at merge.

import type { Result } from '../types/index.js';

export interface MpPayment {
  id: number;
  status: string;
  date_approved: string;
  operation_type?: string;
  description?: string;
  external_reference?: string;
  currency_id: string;
  transaction_amount: number;
  transaction_details?: {
    net_received_amount?: number;
  };
  payer?: {
    identification?: {
      type?: string;
      number?: string;
    };
    email?: string;
  };
  card?: {
    cardholder?: {
      identification?: {
        type?: string;
        number?: string;
      };
    };
  };
  collector_id?: number;
  amount_refunded?: number;
  charges_details?: Array<{
    name?: string;
    type?: string;
    amounts?: {
      original?: number;
      refunded?: number;
    };
    accounts?: {
      from?: string;
      to?: string;
    };
  }>;
}

export async function searchApprovedPayments(_periodo: string): Promise<Result<MpPayment[], Error>> {
  throw new Error('stub — implemented by another worker');
}
