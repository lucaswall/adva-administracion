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
          force: { type: 'boolean' },
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

      folderId = extractedId;
    }

    server.log.info({ folderId, rawFolderId }, 'Starting manual scan');

    const result = await scanFolder(folderId);

    if (!result.ok) {
      reply.status(500);
      return {
        error: result.error.message,
      };
    }

    // Update last scan time and status sheet after successful scan
    updateLastScanTime();
    const folderStructure = getCachedFolderStructure();
    if (folderStructure?.dashboardOperativoId) {
      void updateStatusSheet(folderStructure.dashboardOperativoId);
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
  }, async (_request, reply): Promise<RematchResult | ErrorResponse> => {
    server.log.info({}, 'Starting rematch');

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
      reply.status(500);
      return {
        error: result.error.message,
      };
    }

    return result.value;
  });
}
