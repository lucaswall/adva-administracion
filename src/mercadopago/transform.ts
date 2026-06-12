// STUB FILE — real implementation merged from another worker branch. Lead discards this file at merge.

import type { MovimientoBancario } from '../types/index.js';
import type { MpPayment } from './client.js';

export function paymentsToMovimientos(_payments: MpPayment[]): { movimientos: MovimientoBancario[]; skipped: number } {
  throw new Error('stub — implemented by another worker');
}
