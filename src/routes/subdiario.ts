/**
 * Subdiario de Ventas rebuild route
 *
 * POST /api/rebuild-subdiario — triggers a full sync of the Subdiario de Ventas workbook.
 * Requires Bearer auth. Uses the unified PROCESSING_LOCK to prevent concurrent runs.
 */

import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { withLock } from '../utils/concurrency.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { syncSubdiario } from '../services/subdiario-writer.js';
import { PROCESSING_LOCK_ID, PROCESSING_LOCK_TIMEOUT_MS } from '../config.js';
import { error as logError } from '../utils/logger.js';

/**
 * Success response body
 */
interface RebuildSubdiarioResponse {
  rowsWritten: number;
  gapsDetected: number;
  inserts: number;
  updates: number;
  deletes: number;
  sortInvariantFallback: boolean;
  durationMs: number;
}

/**
 * Error response body
 */
interface RebuildSubdiarioError {
  error: string;
}

/**
 * Register Subdiario de Ventas routes
 */
export async function subdiarioRoutes(server: FastifyInstance) {
  /**
   * POST /api/rebuild-subdiario — Rebuild the Subdiario de Ventas workbook
   * Protected with authentication
   */
  server.post(
    '/rebuild-subdiario',
    { onRequest: authMiddleware },
    async (_request, reply): Promise<RebuildSubdiarioResponse | RebuildSubdiarioError> => {
      const start = Date.now();
      let durationMs = 0;

      try {
        // The callback returns a Result<SyncSubdiarioResult, Error> so it never
        // throws — any throw from withLock would be re-classified as a lock
        // timeout (503) instead of an inner failure (500).
        const lockResult = await withLock(
          PROCESSING_LOCK_ID,
          async () => {
            const folderStructure = getCachedFolderStructure();

            if (!folderStructure) {
              return {
                ok: false as const,
                error: new Error('Folder structure not initialized'),
              };
            }

            const { rootId, controlIngresosId, controlEgresosId, movimientosSpreadsheets } =
              folderStructure;
            const currentYear = new Date().getFullYear();

            try {
              return await syncSubdiario(
                rootId,
                controlIngresosId,
                controlEgresosId,
                currentYear,
                movimientosSpreadsheets,
              );
            } catch (err) {
              return {
                ok: false as const,
                error: err instanceof Error ? err : new Error(String(err)),
              };
            }
          },
          PROCESSING_LOCK_TIMEOUT_MS,
          PROCESSING_LOCK_TIMEOUT_MS,
        );

        durationMs = Date.now() - start;

        if (!lockResult.ok) {
          // Lock was never acquired (timeout) — callback was never called
          logError('Subdiario rebuild blocked: service busy', {
            module: 'subdiario',
            error: lockResult.error.message,
          });
          reply.status(503);
          return { error: 'Service busy — try again later' };
        }

        // Unwrap the inner Result returned by the callback
        const innerResult = lockResult.value;

        if (!innerResult.ok) {
          // Writer already logged the cause at lib layer; route does not re-log.
          reply.status(500);
          return { error: 'Subdiario rebuild failed' };
        }

        return { ...innerResult.value, durationMs };
      } catch (err) {
        // Safety net for unexpected errors outside the lock callback
        durationMs = Date.now() - start;
        logError('Subdiario rebuild failed', {
          module: 'subdiario',
          error: (err as Error).message,
        });
        reply.status(500);
        return { error: 'Subdiario rebuild failed' };
      }
    },
  );
}
