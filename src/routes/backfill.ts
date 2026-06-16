/**
 * POST /api/admin/backfill-condicion-iva route (ADV-380)
 *
 * One-time production backfill: populates blank condicionIVAReceptor (col H)
 * on existing Facturas Emitidas rows in Control de Ingresos.
 * Idempotent — already-filled rows are skipped.
 */

import type { FastifyInstance } from 'fastify';
import { backfillCondicionIva, type BackfillResult } from '../services/condicion-backfill.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { authMiddleware } from '../middleware/auth.js';
import { respond500, respond503 } from '../utils/error-response.js';

/** Query-string params accepted by the endpoint */
interface BackfillQuerystring {
  limit?: string;
}

/**
 * Register the condición IVA backfill admin route
 */
export async function backfillRoutes(server: FastifyInstance): Promise<void> {
  server.post<{ Querystring: BackfillQuerystring }>(
    '/admin/backfill-condicion-iva',
    {
      onRequest: authMiddleware,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply): Promise<BackfillResult | { error: string; correlationId?: string }> => {
      // Require cached folder structure (populated at server startup)
      const folderStructure = getCachedFolderStructure();
      if (!folderStructure) {
        return respond503(
          reply,
          new Error('Folder structure not initialized — wait for server startup to complete'),
          { module: 'backfill-condicion-iva', phase: 'init' }
        );
      }

      // Optional ?limit= query param for batching
      const { limit: limitStr } = request.query;
      let limit: number | undefined;
      if (limitStr !== undefined) {
        limit = parseInt(limitStr, 10);
        if (isNaN(limit) || limit < 1) {
          reply.status(400);
          return { error: 'Invalid limit: must be a positive integer' };
        }
      }

      server.log.info({ limit }, 'Starting condición IVA backfill');

      const result = await backfillCondicionIva({
        controlIngresosId: folderStructure.controlIngresosId,
        limit,
      });

      if (!result.ok) {
        return respond500(reply, result.error, {
          module: 'backfill-condicion-iva',
          phase: 'backfill',
        });
      }

      server.log.info(result.value, 'Condición IVA backfill complete');
      return result.value;
    }
  );
}
