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

    // Enumerate resumenes
    const resumenesResult = await enumerateResumenes(from, to, rootFolderId);
    if (!resumenesResult.ok) {
      return respond500(reply, resumenesResult.error, { module: 'delivery', phase: 'enumerate-resumenes' });
    }

    // Prepare (create or reuse) delivery folder
    const folderResult = await prepareDeliveryFolder(rootFolderId, folderName, deliveryDate);
    if (!folderResult.ok) {
      return respond500(reply, folderResult.error, { module: 'delivery', phase: 'prepare-folder' });
    }
    const { folderId, folderUrl } = folderResult.value;

    // Copy PDFs into delivery folder
    const copyResult = await copyPdfsToDelivery(folderId, resumenesResult.value);
    if (!copyResult.ok) {
      return respond500(reply, copyResult.error, { module: 'delivery', phase: 'copy-pdfs' });
    }

    server.log.info(
      { folderId, copied: copyResult.value.copied, failed: copyResult.value.failed.length },
      'PDFs copied to delivery folder'
    );

    return {
      folderId,
      folderUrl,
      copied: copyResult.value.copied,
      failed: copyResult.value.failed,
    };
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
      return respond500(reply, entregasResult.error, { module: 'delivery', phase: 'build-movimientos' });
    }
    if (!entregasResult.value) {
      return respond500(reply, new Error('Carpeta Entregas/ no encontrada'), { module: 'delivery', phase: 'build-movimientos' });
    }
    const ancestorCheck = await isDescendantOf(folderId, entregasResult.value.id);
    if (!ancestorCheck.ok) {
      return respond500(reply, ancestorCheck.error, { module: 'delivery', phase: 'build-movimientos' });
    }
    if (!ancestorCheck.value) {
      reply.status(400);
      return { error: 'folderId no pertenece a la carpeta Entregas/' };
    }

    // Enumerate movimientos scope
    const movimientosResult = await enumerateMovimientos(from, to, rootFolderId);
    if (!movimientosResult.ok) {
      return respond500(reply, movimientosResult.error, { module: 'delivery', phase: 'enumerate-movimientos' });
    }

    // Build per-(account × month) spreadsheets in delivery folder
    const buildResult = await buildMovimientosFiles(folderId, movimientosResult.value);
    if (!buildResult.ok) {
      return respond500(reply, buildResult.error, { module: 'delivery', phase: 'build-movimientos' });
    }

    server.log.info(
      { folderId, created: buildResult.value.created, failed: buildResult.value.failed.length },
      'Movimientos files built'
    );

    return {
      created: buildResult.value.created,
      failed: buildResult.value.failed,
    };
  });
}
