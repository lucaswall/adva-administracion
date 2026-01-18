/**
 * Status and health check routes
 */
import { getConfig } from '../config.js';
/**
 * Register status routes
 */
export async function statusRoutes(server) {
    /**
     * GET /api/status - Health check and system status
     */
    server.get('/api/status', async (_request, _reply) => {
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
