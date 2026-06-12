/**
 * POST /api/mp-sync route — trigger a Mercado Pago payment sync [ADV-370]
 */

import type { FastifyInstance } from 'fastify';
import { syncMercadopago, type MpSyncResult } from '../mercadopago/sync.js';
import { authMiddleware } from '../middleware/auth.js';
import { respond500 } from '../utils/error-response.js';
import { businessDateString } from '../utils/date.js';

/**
 * Query string for the mp-sync endpoint
 */
interface MpSyncQuerystring {
  period?: string;
}

/**
 * Validates a YYYY-MM period string for the route.
 * Returns false when:
 * - format is not exactly YYYY-MM
 * - month is outside 01–12
 * - period is strictly in the future (compared to current AR-timezone month)
 */
function isValidPeriodParam(period: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  const month = parseInt(period.slice(5, 7), 10);
  if (month < 1 || month > 12) return false;

  const currentPeriod = businessDateString().slice(0, 7);
  if (period > currentPeriod) return false;

  return true;
}

/**
 * Register the MP-sync route
 */
export async function mpSyncRoutes(server: FastifyInstance): Promise<void> {
  server.post<{ Querystring: MpSyncQuerystring }>('/mp-sync', {
    onRequest: authMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply): Promise<MpSyncResult | { error: string; correlationId?: string }> => {
    const { period } = request.query;

    // Validate ?period= if provided — return 400 on bad input
    let periods: string[] | undefined;
    if (period !== undefined) {
      if (!isValidPeriodParam(period)) {
        reply.status(400);
        return {
          error: 'Invalid period: must be YYYY-MM format, month 01-12, not in the future',
        };
      }
      periods = [period];
    }

    server.log.info({ period }, 'Starting MP sync');

    const result = await syncMercadopago(periods);

    if (!result.ok) {
      return respond500(reply, result.error, { module: 'mp-sync', phase: 'sync' });
    }

    return result.value;
  });
}
