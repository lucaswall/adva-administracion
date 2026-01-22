/**
 * ADVA Administración Server
 * Fastify-based server for invoice and payment processing
 */

import Fastify from 'fastify';
import { getConfig } from './config.js';
import { statusRoutes, setServerStartTime } from './routes/status.js';
import { scanRoutes } from './routes/scan.js';
import { webhookRoutes } from './routes/webhooks.js';
import { discoverFolderStructure, getCachedFolderStructure } from './services/folder-structure.js';
import { initWatchManager, startWatching, shutdownWatchManager } from './services/watch-manager.js';
import { scanFolder } from './processing/scanner.js';
import { info, error as logError } from './utils/logger.js';

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
    info('Skipping folder structure initialization', { module: 'server', phase: 'init' });
    return;
  }

  info('Discovering folder structure', { module: 'server', phase: 'init' });
  const result = await discoverFolderStructure();

  if (!result.ok) {
    logError('Failed to discover folder structure', {
      module: 'server',
      phase: 'init',
      error: result.error.message
    });
    throw result.error;
  }

  info('Folder structure initialized successfully', {
    module: 'server',
    phase: 'init',
    entradaId: result.value.entradaId,
    sinProcesarId: result.value.sinProcesarId,
    bankSpreadsheets: result.value.bankSpreadsheets.size
  });
}

/**
 * Initialize real-time monitoring with Drive push notifications
 * Sets up watch on the Entrada folder for automatic processing
 */
async function initializeRealTimeMonitoring(): Promise<void> {
  const config = getConfig();

  // Skip if no webhook URL configured
  if (!config.webhookUrl) {
    info('Real-time monitoring disabled (no API_BASE_URL configured)', {
      module: 'server',
      phase: 'init'
    });
    return;
  }

  // Initialize watch manager with cron jobs
  initWatchManager(config.webhookUrl);

  // Get entrada folder ID from cached structure
  const folderStructure = getCachedFolderStructure();
  if (!folderStructure) {
    logError('Cannot start watching: folder structure not initialized', {
      module: 'server',
      phase: 'init'
    });
    return;
  }

  // Start watching the Entrada folder
  const watchResult = await startWatching(folderStructure.entradaId);
  if (!watchResult.ok) {
    logError('Failed to start watching', {
      module: 'server',
      phase: 'init',
      error: watchResult.error.message
    });
    info('Continuing without real-time monitoring (fallback polling active)', {
      module: 'server',
      phase: 'init'
    });
  } else {
    info('Real-time monitoring active for Entrada folder', {
      module: 'server',
      phase: 'init',
      folderId: folderStructure.entradaId
    });
  }
}

/**
 * Perform startup scan to process any pending documents
 */
async function performStartupScan(): Promise<void> {
  const config = getConfig();

  // Skip scan in test mode
  if (config.nodeEnv === 'test') {
    return;
  }

  info('Performing startup scan', { module: 'server', phase: 'startup-scan' });
  const result = await scanFolder();

  if (result.ok) {
    info('Startup scan complete', {
      module: 'server',
      phase: 'startup-scan',
      filesProcessed: result.value.filesProcessed,
      facturasAdded: result.value.facturasAdded,
      pagosAdded: result.value.pagosAdded,
      errors: result.value.errors
    });
  } else {
    logError('Startup scan failed', {
      module: 'server',
      phase: 'startup-scan',
      error: result.error.message
    });
  }
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

    // Set server start time for uptime tracking
    setServerStartTime();

    info('Server started successfully', {
      module: 'server',
      phase: 'startup',
      port: config.port,
      environment: config.nodeEnv,
      url: `http://0.0.0.0:${config.port}`
    });

    // Initialize folder structure after server is running
    await initializeFolderStructure();

    // Start real-time monitoring (if configured)
    await initializeRealTimeMonitoring();

    // Perform startup scan
    await performStartupScan();

    // Graceful shutdown handler
    const shutdown = async (signal: string) => {
      info('Received shutdown signal', {
        module: 'server',
        phase: 'shutdown',
        signal
      });

      // Stop watching before closing
      await shutdownWatchManager();
      info('Watch channels stopped', { module: 'server', phase: 'shutdown' });

      await server.close();
      info('Server closed', { module: 'server', phase: 'shutdown' });
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logError('Failed to start server', {
      module: 'server',
      phase: 'startup',
      error: err instanceof Error ? err.message : String(err)
    });
    process.exit(1);
  }
}

// Start the server only when run directly (not imported during tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
