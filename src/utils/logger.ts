/**
 * Shared logger service using Pino
 * Provides structured logging across all modules
 */

import pino from 'pino';
import { getConfig } from '../config.js';

/**
 * Create Pino logger instance with configuration
 */
function createLogger() {
  const config = getConfig();

  return pino({
    level: config.logLevel.toLowerCase(),
    transport: config.nodeEnv === 'development' ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname'
      }
    } : undefined
  });
}

// Create singleton logger instance
const logger = createLogger();

/**
 * Log debug message with optional context
 * Only visible when LOG_LEVEL=DEBUG
 */
export function debug(message: string, context?: Record<string, any>) {
  if (context) {
    logger.debug(context, message);
  } else {
    logger.debug(message);
  }
}

/**
 * Log info message with optional context
 */
export function info(message: string, context?: Record<string, any>) {
  if (context) {
    logger.info(context, message);
  } else {
    logger.info(message);
  }
}

/**
 * Log warning message with optional context
 */
export function warn(message: string, context?: Record<string, any>) {
  if (context) {
    logger.warn(context, message);
  } else {
    logger.warn(message);
  }
}

/**
 * Log error message with optional context
 */
export function error(message: string, context?: Record<string, any>) {
  if (context) {
    logger.error(context, message);
  } else {
    logger.error(message);
  }
}

// Export the raw logger for advanced use cases
export { logger };
