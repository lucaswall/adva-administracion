/**
 * Status and health check routes
 */

import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProcessingQueue } from '../processing/queue.js';

/**
 * Server start time for uptime calculation
 */
let serverStartTime: Date | null = null;

/**
 * Sets the server start time (called when server starts)
 */
export function setServerStartTime(): void {
  serverStartTime = new Date();
}

/**
 * Gets the server start time
 * @returns The server start time or null if not yet started
 */
export function getServerStartTime(): Date | null {
  return serverStartTime;
}

/**
 * Calculates server uptime in human-readable format
 */
export function formatUptime(startTime: Date): string {
  const uptimeMs = Date.now() - startTime.getTime();
  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Status response
 */
interface StatusResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
  environment: string;
  uptime: string;
  startTime: string;
  queue: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  memory: {
    heapUsed: string;
    heapTotal: string;
    rss: string;
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
  server.get('/api/status', { onRequest: authMiddleware }, async (_request, _reply): Promise<StatusResponse> => {
    const config = getConfig();
    const queue = getProcessingQueue();
    const queueStats = queue.getStats();
    const memUsage = process.memoryUsage();

    const startTime = serverStartTime || new Date();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: config.nodeEnv,
      uptime: formatUptime(startTime),
      startTime: startTime.toISOString(),
      queue: {
        pending: queueStats.pending,
        running: queueStats.running,
        completed: queueStats.completed,
        failed: queueStats.failed
      },
      memory: {
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
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
