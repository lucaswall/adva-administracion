/**
 * Centralized logging service using Pino
 * Provides structured logging with configurable log levels
 */

import pino from 'pino';
import type { Logger } from 'pino';
import { getConfig } from '../config.js';

// Lazy logger initialization to avoid calling getConfig() at import time
let loggerInstance: Logger | null = null;

/**
 * Gets or creates the logger instance
 */
function getLogger(): Logger {
  if (!loggerInstance) {
    const config = getConfig();
    const logLevel = config.logLevel || 'INFO';

    loggerInstance = pino({
      level: logLevel.toLowerCase(),
      // Use pino-pretty in development for human-readable output
      transport: process.env.NODE_ENV !== 'production' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        }
      } : undefined,
    });
  }

  return loggerInstance;
}

/**
 * Log a DEBUG message with optional context
 * @param message - Log message
 * @param context - Optional context object
 */
export function debug(message: string, context?: Record<string, unknown>): void {
  const logger = getLogger();
  if (context) {
    logger.debug(context, message);
  } else {
    logger.debug(message);
  }
}

/**
 * Log an INFO message with optional context
 * @param message - Log message
 * @param context - Optional context object
 */
export function info(message: string, context?: Record<string, unknown>): void {
  const logger = getLogger();
  if (context) {
    logger.info(context, message);
  } else {
    logger.info(message);
  }
}

/**
 * Log a WARN message with optional context
 * @param message - Log message
 * @param context - Optional context object
 */
export function warn(message: string, context?: Record<string, unknown>): void {
  const logger = getLogger();
  if (context) {
    logger.warn(context, message);
  } else {
    logger.warn(message);
  }
}

/**
 * Log an ERROR message with optional context
 * @param message - Log message
 * @param context - Optional context object
 */
export function error(message: string, context?: Record<string, unknown>): void {
  const logger = getLogger();
  if (context) {
    logger.error(context, message);
  } else {
    logger.error(message);
  }
}

// Export getLogger function as default for backward compatibility
// Users can call getLogger() to get the logger instance
export { getLogger as default };
