/**
 * ADVA Administración Server
 * Fastify-based server for invoice and payment processing
 */

import Fastify from 'fastify';
import { getConfig } from './config.js';
import { statusRoutes } from './routes/status.js';
import { scanRoutes } from './routes/scan.js';
import { webhookRoutes } from './routes/webhooks.js';
import { discoverFolderStructure } from './services/folder-structure.js';

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
 * Initialize folder structure from Drive
 * Discovers and caches the folder hierarchy for document sorting
 */
async function initializeFolderStructure(): Promise<void> {
  const config = getConfig();

  // Skip in test mode or when no root folder is configured
  if (config.nodeEnv === 'test' || !config.driveRootFolderId) {
    console.log('Skipping folder structure initialization');
    return;
  }

  console.log('Discovering folder structure...');
  const result = await discoverFolderStructure();

  if (!result.ok) {
    console.error('Failed to discover folder structure:', result.error.message);
    throw result.error;
  }

  console.log('Folder structure initialized successfully');
  console.log(`  - Entrada: ${result.value.entradaId}`);
  console.log(`  - Cobros: ${result.value.cobrosId}`);
  console.log(`  - Pagos: ${result.value.pagosId}`);
  console.log(`  - Sin Procesar: ${result.value.sinProcesarId}`);
  console.log(`  - Bancos: ${result.value.bancosId}`);
  console.log(`  - Bank spreadsheets: ${result.value.bankSpreadsheets.size}`);
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

    // Initialize folder structure after server is running
    await initializeFolderStructure();
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Start the server if this is the main module
start();
