// STUB FILE — real implementation merged from another worker branch. Lead discards this file at merge.

import type { Result } from '../types/index.js';
import type { MovimientoBancario } from '../types/index.js';

export async function writeMpMovimientos(
  _spreadsheetId: string,
  _periodo: string,
  _movimientos: MovimientoBancario[],
  _saldoInicialPeriodo: number
): Promise<Result<{ appended: number; skippedExisting: number }, Error>> {
  throw new Error('stub — implemented by another worker');
}
