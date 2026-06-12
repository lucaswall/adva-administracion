/**
 * Delivery package routes — "Envío a Contadores"
 *
 * Three idempotent endpoints that build a Drive delivery folder containing:
 *  - All resumen PDFs for the requested period range
 *  - A movimientos workbook with one tab per bank/month
 *
 * No processing lock acquired — these routes are read-only against existing
 * data and write only into the new Entregas/ subtree.
 */

import type { FastifyInstance } from 'fastify';
import {
  parsePeriodRange,
  enumerateResumenes,
  enumerateMovimientos,
  formatDeliveryFolderName,
  prepareDeliveryFolder,
  copyPdfsToDelivery,
  buildMovimientosFiles,
} from '../services/delivery-package.js';
import { authMiddleware } from '../middleware/auth.js';
import { getCachedFolderStructure } from '../services/folder-structure.js';
import { findByName, isDescendantOf } from '../services/drive.js';
import { getConfig } from '../config.js';
import { respond500, respond503 } from '../utils/error-response.js';
import { withLock } from '../utils/concurrency.js';

/**
 * Shared lock ID for all mutating delivery operations.
 * Ensures copy-pdfs and build-movimientos never run concurrently (ADV-354).
 */
const DELIVERY_LOCK_ID = 'delivery:mutating';

/** How long to wait for the lock before giving up (30 s) */
const DELIVERY_LOCK_TIMEOUT_MS = 30_000;

/** Auto-expiry for a held delivery lock — generous because builds can be slow (5 min) */
const DELIVERY_LOCK_EXPIRY_MS = 5 * 60_000;

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Request body for period-based endpoints
 */
interface PeriodRequest {
  period: string;
}

/**
 * Request body for build-movimientos endpoint
 */
interface BuildMovimientosRequest {
  period: string;
  folderId: string;
}

/**
 * Returns the label to display for a period range.
 * Single-month ranges show just "YYYY-MM"; multi-month shows "YYYY-MM..YYYY-MM".
 */
function periodLabel(from: string, to: string): string {
  return from === to ? from : `${from}..${to}`;
}

/**
 * Register delivery routes
 */
export async function deliveryRoutes(server: FastifyInstance) {
  /**
   * POST /api/delivery/plan
   * Read-only — enumerates scope without making Drive mutations.
   * Returns folderName, pdfCount, movimientosTabCount, and periodLabel.
   */
  server.post<{ Body: PeriodRequest }>('/delivery/plan', {
    onRequest: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['period'],
        properties: {
          period: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { period } = request.body;

    // Parse and validate the period string
    const parsedPeriod = parsePeriodRange(period);
    if (!parsedPeriod.ok) {
      reply.status(400);
      return { error: parsedPeriod.error.message };
    }
    const { from, to } = parsedPeriod.value;

    // Require folder structure to be initialized (boot-time discovery)
    if (!getCachedFolderStructure()) {
      return respond503(
        reply,
        new Error('Folder structure not initialized'),
        { module: 'delivery', phase: 'plan' }
      );
    }

    const config = getConfig();
    const rootFolderId = config.driveRootFolderId;

    // Enumerate both scopes in parallel
    const [resumenesResult, movimientosResult] = await Promise.all([
      enumerateResumenes(from, to, rootFolderId),
      enumerateMovimientos(from, to, rootFolderId),
    ]);

    if (!resumenesResult.ok) {
      return respond500(reply, resumenesResult.error, { module: 'delivery', phase: 'enumerate-resumenes' });
    }
    if (!movimientosResult.ok) {
      return respond500(reply, movimientosResult.error, { module: 'delivery', phase: 'enumerate-movimientos' });
    }

    const label = periodLabel(from, to);
    const folderName = formatDeliveryFolderName({ from, to, deliveryDate: new Date() });

    server.log.info(
      { from, to, pdfCount: resumenesResult.value.length, movimientosTabCount: movimientosResult.value.length },
      'Delivery plan ready'
    );

    return {
      folderName,
      pdfCount: resumenesResult.value.length,
      movimientosTabCount: movimientosResult.value.length,
      periodLabel: label,
    };
  });

  /**
   * POST /api/delivery/copy-pdfs
   * Prepares (or reuses) the delivery folder and copies all resumen PDFs into it.
   * Idempotent: existing folder is cleared before re-populating.
   */
  server.post<{ Body: PeriodRequest }>('/delivery/copy-pdfs', {
    onRequest: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['period'],
        properties: {
          period: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { period } = request.body;

    const parsedPeriod = parsePeriodRange(period);
    if (!parsedPeriod.ok) {
      reply.status(400);
      return { error: parsedPeriod.error.message };
    }
    const { from, to } = parsedPeriod.value;

    if (!getCachedFolderStructure()) {
      return respond503(
        reply,
        new Error('Folder structure not initialized'),
        { module: 'delivery', phase: 'copy-pdfs' }
      );
    }

    const config = getConfig();
    const rootFolderId = config.driveRootFolderId;
    const deliveryDate = new Date();
    const folderName = formatDeliveryFolderName({ from, to, deliveryDate });

    // Enumerate resumenes (read-only, outside the lock)
    const resumenesResult = await enumerateResumenes(from, to, rootFolderId);
    if (!resumenesResult.ok) {
      return respond500(reply, resumenesResult.error, { module: 'delivery', phase: 'enumerate-resumenes' });
    }

    // Serialize mutating operations: prepare folder + copy PDFs (ADV-354)
    const operationResult = await withLock(DELIVERY_LOCK_ID, async () => {
      const folderResult = await prepareDeliveryFolder(rootFolderId, folderName, deliveryDate);
      if (!folderResult.ok) throw folderResult.error;
      const { folderId, folderUrl } = folderResult.value;

      const copyResult = await copyPdfsToDelivery(folderId, resumenesResult.value);
      if (!copyResult.ok) throw copyResult.error;

      server.log.info(
        { folderId, copied: copyResult.value.copied, failed: copyResult.value.failed.length },
        'PDFs copied to delivery folder'
      );

      return { folderId, folderUrl, copied: copyResult.value.copied, failed: copyResult.value.failed };
    }, DELIVERY_LOCK_TIMEOUT_MS, DELIVERY_LOCK_EXPIRY_MS);

    if (!operationResult.ok) {
      if (operationResult.error.message.startsWith('Failed to acquire lock')) {
        return respond503(reply, operationResult.error, { module: 'delivery', phase: 'copy-pdfs' });
      }
      return respond500(reply, operationResult.error, { module: 'delivery', phase: 'copy-pdfs' });
    }

    return operationResult.value;
  });

  /**
   * POST /api/delivery/build-movimientos
   * Builds a Google Sheets workbook in the delivery folder with one tab per
   * bank account/month combination.
   */
  server.post<{ Body: BuildMovimientosRequest }>('/delivery/build-movimientos', {
    onRequest: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['period', 'folderId'],
        properties: {
          period: { type: 'string' },
          folderId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { period, folderId } = request.body;

    const parsedPeriod = parsePeriodRange(period);
    if (!parsedPeriod.ok) {
      reply.status(400);
      return { error: parsedPeriod.error.message };
    }
    const { from, to } = parsedPeriod.value;

    if (!getCachedFolderStructure()) {
      return respond503(
        reply,
        new Error('Folder structure not initialized'),
        { module: 'delivery', phase: 'build-movimientos' }
      );
    }

    const config = getConfig();
    const rootFolderId = config.driveRootFolderId;

    // IDOR guard: confirm folderId is inside Entregas/ before any write.
    // The Apps Script flow always supplies a folderId returned by /copy-pdfs,
    // so the legitimate path is unaffected — this rejects misuse.
    const entregasResult = await findByName(rootFolderId, 'Entregas', FOLDER_MIME);
    if (!entregasResult.ok) {
      // Drive API failure (quota, network) — downstream service unavailable (ADV-334)
      return respond503(reply, entregasResult.error, { module: 'delivery', phase: 'build-movimientos' });
    }
    if (!entregasResult.value) {
      return respond500(reply, new Error('Carpeta Entregas/ no encontrada'), { module: 'delivery', phase: 'build-movimientos' });
    }
    const ancestorCheck = await isDescendantOf(folderId, entregasResult.value.id);
    if (!ancestorCheck.ok) {
      // Drive API failure — downstream service unavailable (ADV-334)
      return respond503(reply, ancestorCheck.error, { module: 'delivery', phase: 'build-movimientos' });
    }
    if (!ancestorCheck.value) {
      reply.status(400);
      return { error: 'folderId no pertenece a la carpeta Entregas/' };
    }

    // Serialize mutating operations: enumerate + build movimientos files (ADV-354)
    const operationResult = await withLock(DELIVERY_LOCK_ID, async () => {
      const movimientosResult = await enumerateMovimientos(from, to, rootFolderId);
      if (!movimientosResult.ok) throw movimientosResult.error;

      const buildResult = await buildMovimientosFiles(folderId, movimientosResult.value);
      if (!buildResult.ok) throw buildResult.error;

      server.log.info(
        { folderId, created: buildResult.value.created, failed: buildResult.value.failed.length },
        'Movimientos files built'
      );

      return { created: buildResult.value.created, failed: buildResult.value.failed };
    }, DELIVERY_LOCK_TIMEOUT_MS, DELIVERY_LOCK_EXPIRY_MS);

    if (!operationResult.ok) {
      if (operationResult.error.message.startsWith('Failed to acquire lock')) {
        return respond503(reply, operationResult.error, { module: 'delivery', phase: 'build-movimientos' });
      }
      return respond500(reply, operationResult.error, { module: 'delivery', phase: 'build-movimientos' });
    }

    return operationResult.value;
  });
}
