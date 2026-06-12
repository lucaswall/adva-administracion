// STUB FILE — real implementation merged from another worker branch. Lead discards this file at merge.

import type { Result } from '../types/index.js';

export async function writeMpResumenIfClosed(
  _controlSpreadsheetId: string,
  _movimientosSpreadsheetId: string,
  _periodo: string,
  _accountInfo: { collectorId: string },
  _today: Date
): Promise<Result<{ written: boolean }, Error>> {
  throw new Error('stub — implemented by another worker');
}
