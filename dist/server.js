/**
 * ADVA Administración Server
 * Fastify-based server for invoice and payment processing
 */
import Fastify from 'fastify';
import { getConfig } from './config.js';
import { statusRoutes } from './routes/status.js';
import { scanRoutes } from './routes/scan.js';
import { webhookRoutes } from './routes/webhooks.js';
/**
 * Build and configure the Fastify server
 */
export async function buildServer() {
    const config = getConfig();
    const server = Fastify({
        logger: {
            level: config.logLevel.toLowerCase(),
            transport: config.nodeEnv === 'development' ? {
                target: 'pino-pretty',
                options: {
                    colorize: true
                }
            } : undefined
        }
    });
    // Register routes
    await server.register(statusRoutes);
    await server.register(scanRoutes, { prefix: '/api' });
    await server.register(webhookRoutes, { prefix: '/webhooks' });
    return server;
}
/**
 * Start the server
 */
async function start() {
    const config = getConfig();
    try {
        const server = await buildServer();
        await server.listen({
            port: config.port,
            host: '0.0.0.0'
        });
        console.log(`Server running at http://0.0.0.0:${config.port}`);
        console.log(`Environment: ${config.nodeEnv}`);
    }
    catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}
// Start the server if this is the main module
start();
