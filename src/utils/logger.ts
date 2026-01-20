/**
 * Centralized logging service using Pino
 * Provides structured logging with configurable log levels
 */

import pino from 'pino';
import { getConfig } from '../config.js';

const config = getConfig();

// Determine log level from environment or default to INFO
const logLevel = config.logLevel || 'INFO';

// Create Pino logger instance
const logger = pino({
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

/**
 * Log a DEBUG message with optional context
 * @param message - Log message
 * @param context - Optional context object
 */
export function debug(message: string, context?: Record<string, unknown>): void {
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
  if (context) {
    logger.error(context, message);
  } else {
    logger.error(message);
  }
}

export default logger;
