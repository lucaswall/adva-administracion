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
import { initWatchManager, startWatching, shutdownWatchManager, updateLastScanTime } from './services/watch-manager.js';
import { scanFolder } from './processing/scanner.js';
import { updateStatusSheet } from './services/status-sheet.js';
import { info, warn, error as logError } from './utils/logger.js';
import type { Result } from './types/index.js';

/**
 * Maximum time to wait for graceful shutdown before forcing exit
 * ADV-7: Prevent infinite hanging during shutdown
 */
export const SHUTDOWN_TIMEOUT_MS = 30000;

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
 * Checks if an error is a critical scan error that should prevent server startup
 * Critical errors indicate fundamental configuration or authentication issues
 * that won't be resolved by retrying later.
 *
 * @param error - Error from scanFolder
 * @returns true if the error is critical and should prevent startup
 */
export function isCriticalScanError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Authentication errors - credentials/permissions are wrong
  const authPatterns = [
    'authentication',
    'unauthorized',
    'forbidden',
    'invalid credentials',
    'access denied',
    'insufficient',
    '401',
    '403',
  ];

  // Folder structure errors - fundamental configuration issues
  // Note: patterns must be specific to avoid matching transient errors like "File temporarily not found"
  const folderPatterns = [
    'folder structure not initialized',
    'entrada folder not found',
    'root folder does not exist',
    'control de ingresos not found',
    'control de egresos not found',
    'dashboard operativo not found',
  ];

  // Check for auth errors
  for (const pattern of authPatterns) {
    if (message.includes(pattern)) {
      return true;
    }
  }

  // Check for folder structure errors
  for (const pattern of folderPatterns) {
    if (message.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Perform startup scan to process any pending documents
 * ADV-26: Returns Result to allow proper error handling by caller
 *
 * @returns Result indicating success or error
 *   - On success: { ok: true, value: undefined }
 *   - On critical error: { ok: false, error: Error } - should prevent startup
 *   - On transient error: { ok: true, value: undefined } - logged but startup continues
 */
export async function performStartupScan(): Promise<Result<void, Error>> {
  const config = getConfig();

  // Skip scan in test mode
  if (config.nodeEnv === 'test') {
    return { ok: true, value: undefined };
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

    // Update last scan time and status sheet after successful scan
    updateLastScanTime();
    const folderStructure = getCachedFolderStructure();
    if (folderStructure?.dashboardOperativoId) {
      await updateStatusSheet(folderStructure.dashboardOperativoId);
    }

    return { ok: true, value: undefined };
  }

  // Scan failed - check if it's a critical error
  if (isCriticalScanError(result.error)) {
    logError('Startup scan failed with critical error', {
      module: 'server',
      phase: 'startup-scan',
      error: result.error.message,
      critical: true,
    });
    return { ok: false, error: result.error };
  }

  // Transient error - log warning but allow startup to continue
  warn('Startup scan failed with transient error, server will continue', {
    module: 'server',
    phase: 'startup-scan',
    error: result.error.message,
    critical: false,
  });

  return { ok: true, value: undefined };
}

/**
 * Creates a shutdown handler that properly awaits all cleanup operations
 * ADV-7: Fix shutdown handlers not awaited - was causing unclean shutdown
 *
 * @param shutdownWatchManager - Function to shutdown watch manager
 * @param serverClose - Function to close the server
 * @param processExit - Function to exit the process (allows injection for testing)
 * @param timeoutMs - Maximum time to wait for shutdown (defaults to SHUTDOWN_TIMEOUT_MS)
 * @returns Async handler function that properly awaits cleanup
 */
export function createShutdownHandler(
  shutdownWatchManager: () => Promise<void>,
  serverClose: () => Promise<void>,
  processExit: (code: number) => void,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS
): (signal: string) => Promise<void> {
  return async (signal: string) => {
    info('Received shutdown signal', {
      module: 'server',
      phase: 'shutdown',
      signal
    });

    // Create timeout promise to prevent infinite hanging
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeoutMs);
    });

    // Create shutdown promise that awaits all cleanup operations
    const shutdownPromise = (async () => {
      try {
        // Stop watching before closing
        await shutdownWatchManager();
        info('Watch channels stopped', { module: 'server', phase: 'shutdown' });

        await serverClose();
        info('Server closed', { module: 'server', phase: 'shutdown' });

        return 'success' as const;
      } catch (err) {
        logError('Shutdown error', {
          module: 'server',
          phase: 'shutdown',
          error: err instanceof Error ? err.message : String(err)
        });
        return 'error' as const;
      }
    })();

    // Race between shutdown and timeout
    const result = await Promise.race([shutdownPromise, timeoutPromise]);

    if (result === 'timeout') {
      warn('Shutdown timed out, forcing exit', {
        module: 'server',
        phase: 'shutdown',
        timeoutMs
      });
      processExit(1);
    } else if (result === 'error') {
      processExit(1);
    } else {
      processExit(0);
    }
  };
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

    // Update status sheet with initial server state
    const folderStructure = getCachedFolderStructure();
    if (folderStructure?.dashboardOperativoId) {
      await updateStatusSheet(folderStructure.dashboardOperativoId);
      info('Initial status sheet updated', {
        module: 'server',
        phase: 'startup'
      });
    }

    // Perform startup scan
    // ADV-26: Check result and fail startup on critical errors
    const scanResult = await performStartupScan();
    if (!scanResult.ok) {
      throw scanResult.error;
    }

    // Graceful shutdown handler - ADV-7: Properly await shutdown operations
    const shutdown = createShutdownHandler(
      shutdownWatchManager,
      () => server.close(),
      (code) => process.exit(code)
    );

    // Note: The handlers call async shutdown() which is now properly awaited internally
    // The handler returns a promise, and process.exit() is called only after completion
    process.on('SIGTERM', () => { shutdown('SIGTERM'); });
    process.on('SIGINT', () => { shutdown('SIGINT'); });

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
