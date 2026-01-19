/**
 * Scan and processing routes
 */

import type { FastifyInstance } from 'fastify';
import type { ScanResult, BankAutoFillResult } from '../types/index.js';
import { scanFolder, rematch, RematchResult } from '../processing/scanner.js';
import { autoFillBankMovements } from '../bank/autofill.js';

/**
 * Scan request body
 */
interface ScanRequest {
  folderId?: string;
  force?: boolean;
}

/**
 * Rematch request body
 */
interface RematchRequest {
  documentType?: 'factura' | 'recibo' | 'all';
}

/**
 * Autofill request body
 */
interface AutofillRequest {
  bankName?: string;
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  details?: string;
}

/**
 * Register scan routes
 */
export async function scanRoutes(server: FastifyInstance) {
  /**
   * POST /api/scan - Trigger a manual scan of the Drive folder
   */
  server.post<{ Body: ScanRequest }>('/scan', async (request, reply): Promise<ScanResult | ErrorResponse> => {
    const { folderId } = request.body || {};

    server.log.info({ folderId }, 'Starting manual scan');

    const result = await scanFolder(folderId);

    if (!result.ok) {
      reply.status(500);
      return {
        error: result.error.message,
      };
    }

    return result.value;
  });

  /**
   * POST /api/rematch - Re-run matching on unmatched documents
   */
  server.post<{ Body: RematchRequest }>('/rematch', async (request, reply): Promise<RematchResult | ErrorResponse> => {
    const { documentType = 'all' } = request.body || {};

    server.log.info({ documentType }, 'Starting rematch');

    const result = await rematch();

    if (!result.ok) {
      reply.status(500);
      return {
        error: result.error.message,
      };
    }

    return result.value;
  });

  /**
   * POST /api/autofill-bank - Auto-fill bank movement descriptions
   */
  server.post<{ Body: AutofillRequest }>('/autofill-bank', async (request, reply): Promise<BankAutoFillResult | ErrorResponse> => {
    const { bankName } = request.body || {};

    server.log.info({ bankName }, 'Starting bank autofill');

    const result = await autoFillBankMovements(bankName);

    if (!result.ok) {
      reply.status(500);
      return {
        error: result.error.message,
      };
    }

    return result.value;
  });
}
