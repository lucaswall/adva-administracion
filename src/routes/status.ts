/**
 * Status and health check routes
 */

import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';

/**
 * Health check response
 */
interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
  environment: string;
  queue?: {
    pending: number;
    running: number;
  };
}

/**
 * Register status routes
 */
export async function statusRoutes(server: FastifyInstance) {
  /**
   * GET /api/status - Health check and system status
   * Protected with authentication
   */
  server.get('/api/status', { onRequest: authMiddleware }, async (_request, _reply): Promise<HealthResponse> => {
    const config = getConfig();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      environment: config.nodeEnv,
      queue: {
        pending: 0,
        running: 0
      }
    };
  });

  /**
   * GET /health - Simple health check for load balancers
   */
  server.get('/health', async (_request, reply) => {
    reply.code(200).send({ status: 'ok' });
  });
}
