/**
 * Scan and processing routes
 */

import type { FastifyInstance } from 'fastify';
import type { ScanResult, BankAutoFillResult } from '../types/index.js';
import { scanFolder, rematch, RematchResult } from '../processing/scanner.js';
import { autoFillBankMovements } from '../bank/autofill.js';
import { authMiddleware } from '../middleware/auth.js';
import { extractDriveFolderId, isValidDriveId } from '../utils/drive-parser.js';

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
   * Protected with authentication
   */
  server.post<{ Body: ScanRequest }>('/scan', { onRequest: authMiddleware }, async (request, reply): Promise<ScanResult | ErrorResponse> => {
    const { folderId: rawFolderId } = request.body || {};

    // Validate and extract folderId if provided
    let folderId: string | undefined;
    if (rawFolderId) {
      // Try to extract ID from URL or use as-is
      folderId = extractDriveFolderId(rawFolderId);

      // Validate the extracted ID
      if (!folderId || !isValidDriveId(folderId)) {
        server.log.warn({ rawFolderId }, 'Invalid folderId provided');
        reply.status(400);
        return {
          error: 'Invalid folderId format',
          details: 'folderId must be a valid Google Drive folder ID (28-44 alphanumeric characters) or a Drive URL',
        };
      }
    }

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
   * Protected with authentication
   */
  server.post<{ Body: RematchRequest }>('/rematch', { onRequest: authMiddleware }, async (request, reply): Promise<RematchResult | ErrorResponse> => {
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
   * Protected with authentication
   */
  server.post<{ Body: AutofillRequest }>('/autofill-bank', { onRequest: authMiddleware }, async (request, reply): Promise<BankAutoFillResult | ErrorResponse> => {
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
