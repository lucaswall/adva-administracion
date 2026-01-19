/**
 * ADVA Administración Server
 * Fastify-based server for invoice and payment processing
 */
import Fastify from 'fastify';
import { getConfig } from './config.js';
import { statusRoutes } from './routes/status.js';
import { scanRoutes } from './routes/scan.js';
import { webhookRoutes } from './routes/webhooks.js';
import { discoverFolderStructure, getCachedFolderStructure } from './services/folder-structure.js';
import { initWatchManager, startWatching, shutdownWatchManager } from './services/watch-manager.js';
import { scanFolder } from './processing/scanner.js';
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
async function initializeFolderStructure() {
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
    console.log(`  - Creditos: ${result.value.creditosId}`);
    console.log(`  - Debitos: ${result.value.debitosId}`);
    console.log(`  - Sin Procesar: ${result.value.sinProcesarId}`);
    console.log(`  - Bancos: ${result.value.bancosId}`);
    console.log(`  - Bank spreadsheets: ${result.value.bankSpreadsheets.size}`);
}
/**
 * Initialize real-time monitoring with Drive push notifications
 * Sets up watch on the Entrada folder for automatic processing
 */
async function initializeRealTimeMonitoring() {
    const config = getConfig();
    // Skip if no webhook URL configured
    if (!config.webhookUrl) {
        console.log('Real-time monitoring disabled (no WEBHOOK_URL configured)');
        return;
    }
    // Initialize watch manager with cron jobs
    initWatchManager(config.webhookUrl);
    // Get entrada folder ID from cached structure
    const folderStructure = getCachedFolderStructure();
    if (!folderStructure) {
        console.error('Cannot start watching: folder structure not initialized');
        return;
    }
    // Start watching the Entrada folder
    const watchResult = await startWatching(folderStructure.entradaId);
    if (!watchResult.ok) {
        console.error('Failed to start watching:', watchResult.error.message);
        console.log('Continuing without real-time monitoring (fallback polling active)');
    }
    else {
        console.log('Real-time monitoring active for Entrada folder');
    }
}
/**
 * Perform startup scan to process any pending documents
 */
async function performStartupScan() {
    const config = getConfig();
    // Skip scan in test mode
    if (config.nodeEnv === 'test') {
        return;
    }
    console.log('Performing startup scan...');
    const result = await scanFolder();
    if (result.ok) {
        console.log(`Startup scan complete: ${result.value.filesProcessed} files processed`);
    }
    else {
        console.error('Startup scan failed:', result.error.message);
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
        console.log(`Server running at http://0.0.0.0:${config.port}`);
        console.log(`Environment: ${config.nodeEnv}`);
        // Initialize folder structure after server is running
        await initializeFolderStructure();
        // Start real-time monitoring (if configured)
        await initializeRealTimeMonitoring();
        // Perform startup scan
        await performStartupScan();
        // Graceful shutdown handler
        const shutdown = async (signal) => {
            console.log(`Received ${signal}, shutting down gracefully...`);
            // Stop watching before closing
            await shutdownWatchManager();
            console.log('Watch channels stopped');
            await server.close();
            console.log('Server closed');
            process.exit(0);
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }
    catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}
// Start the server if this is the main module
start();
