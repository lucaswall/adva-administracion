/**
 * Scan and processing routes
 */

import type { FastifyInstance } from 'fastify';
import type { ScanResult } from '../types/index.js';
import { scanFolder, rematch, RematchResult } from '../processing/scanner.js';
import { matchAllMovimientos, type MatchAllResult } from '../bank/match-movimientos.js';
import { authMiddleware } from '../middleware/auth.js';
import { extractDriveFolderId, isValidDriveId } from '../utils/drive-parser.js';
import { updateStatusSheet } from '../services/status-sheet.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { updateLastScanTime } from '../services/watch-manager.js';
import { isDescendantOf } from '../services/drive.js';
import { getConfig } from '../config.js';
import { respond500, respond503 } from '../utils/error-response.js';
import { error as logError } from '../utils/logger.js';

/**
 * Scan request body
 */
interface ScanRequest {
  folderId?: string;
}

/**
 * Rematch request body
 */
interface RematchRequest {
  documentType?: 'factura' | 'recibo' | 'all';
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
  server.post<{ Body: ScanRequest }>('/scan', {
    onRequest: authMiddleware,
    schema: {
      body: {
        type: 'object',
        properties: {
          folderId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply): Promise<ScanResult | ErrorResponse> => {
    const { folderId: rawFolderId } = request.body || {};

    // Validate and extract folderId if provided
    let folderId: string | undefined;
    if (rawFolderId) {
      // Extract ID from URL if needed, validate format
      const extractedId = extractDriveFolderId(rawFolderId);

      if (!extractedId || !isValidDriveId(extractedId)) {
        reply.status(400);
        return {
          error: 'Invalid folderId format',
          details: 'folderId must be a valid Google Drive folder ID (28-44 alphanumeric characters) or URL',
        };
      }

      // Verify the folder is within the configured root
      const config = getConfig();
      const ancestryResult = await isDescendantOf(extractedId, config.driveRootFolderId);
      if (!ancestryResult.ok) {
        // Drive API error or 10s deadline exceeded — return 503 (downstream service issue,
        // not an internal server error). ADV-219.
        return respond503(reply, ancestryResult.error, { module: 'scan', phase: 'ancestry-check' });
      }
      if (!ancestryResult.value) {
        reply.status(403);
        return {
          error: 'Access denied: folderId is not within the configured root folder',
        };
      }

      folderId = extractedId;
    }

    server.log.info({ folderId, rawFolderId }, 'Starting manual scan');

    const result = await scanFolder(folderId);

    if (!result.ok) {
      return respond500(reply, result.error, { module: 'scan', phase: 'scan' });
    }

    // Update last scan time and status sheet after successful scan
    updateLastScanTime();
    const folderStructure = getCachedFolderStructure();
    if (folderStructure?.dashboardOperativoId) {
      // Fire-and-forget: do not await — failure must not fail the scan response (ADV-296).
      // The .catch() prevents unhandled rejections and logs the error with context.
      void updateStatusSheet(folderStructure.dashboardOperativoId).catch((err: Error) => {
        logError('Status sheet update failed after scan', {
          module: 'scan',
          phase: 'status-sheet',
          error: err.message,
        });
      });
    }

    return result.value;
  });

  /**
   * POST /api/rematch - Re-run matching on unmatched documents
   * Protected with authentication
   *
   * Note: Rematch always processes all document types (facturas, recibos, etc.).
   * Document type filtering is not currently supported.
   */
  server.post<{ Body: RematchRequest }>('/rematch', {
    onRequest: authMiddleware,
    schema: {
      body: {
        type: 'object',
        properties: {
          documentType: { type: 'string', enum: ['factura', 'recibo', 'all'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply): Promise<RematchResult | ErrorResponse> => {
    const { documentType } = request.body || {};
    server.log.info({ documentType }, 'Starting rematch');

    const result = await rematch();

    if (!result.ok) {
      return respond500(reply, result.error, { module: 'scan', phase: 'rematch' });
    }

    return result.value;
  });

  /**
   * POST /api/match-movimientos - Match bank movements against Control de Ingresos/Egresos
   * Fills matchedFileId and detalle columns in Movimientos Bancario sheets
   * Protected with authentication
   *
   * Query parameters:
   *   force=true - Re-match all rows, clearing existing matches
   */
  server.post<{ Querystring: { force?: string } }>('/match-movimientos', {
    onRequest: authMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          force: { type: 'string', enum: ['true'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply): Promise<MatchAllResult | ErrorResponse> => {
    const force = request.query.force === 'true';

    server.log.info({ force }, 'Starting match movimientos');

    const result = await matchAllMovimientos({ force });

    if (!result.ok) {
      return respond500(reply, result.error, { module: 'scan', phase: 'match-movimientos' });
    }

    return result.value;
  });
}
