/**
 * Request correlation ID management using AsyncLocalStorage
 * Enables tracing requests through the entire processing pipeline
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation context stored in AsyncLocalStorage
 */
export interface CorrelationContext {
  /** Unique correlation ID for this request/operation */
  correlationId: string;
  /** Optional file ID being processed */
  fileId?: string;
  /** Optional file name being processed */
  fileName?: string;
  /** Start time of the operation */
  startTime: number;
}

/**
 * AsyncLocalStorage instance for correlation context
 */
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Generates a new correlation ID
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Gets the current correlation context (if any)
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/**
 * Gets the current correlation ID (or undefined if not in a correlation context)
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

/**
 * Runs a function within a correlation context
 * All async operations within will have access to the correlation ID
 *
 * @param fn - Function to run
 * @param context - Optional partial context (correlationId will be generated if not provided)
 * @returns The result of the function
 */
export function withCorrelation<T>(
  fn: () => T,
  context?: Partial<CorrelationContext>
): T {
  const fullContext: CorrelationContext = {
    correlationId: context?.correlationId ?? generateCorrelationId(),
    fileId: context?.fileId,
    fileName: context?.fileName,
    startTime: context?.startTime ?? Date.now(),
  };

  return correlationStorage.run(fullContext, fn);
}

/**
 * Runs an async function within a correlation context
 *
 * @param fn - Async function to run
 * @param context - Optional partial context
 * @returns Promise that resolves to the function result
 */
export async function withCorrelationAsync<T>(
  fn: () => Promise<T>,
  context?: Partial<CorrelationContext>
): Promise<T> {
  const fullContext: CorrelationContext = {
    correlationId: context?.correlationId ?? generateCorrelationId(),
    fileId: context?.fileId,
    fileName: context?.fileName,
    startTime: context?.startTime ?? Date.now(),
  };

  return correlationStorage.run(fullContext, fn);
}

/**
 * Updates the current correlation context with additional data
 * Useful for adding fileId/fileName after the context is created
 *
 * @param updates - Partial context updates
 */
export function updateCorrelationContext(updates: Partial<Omit<CorrelationContext, 'correlationId' | 'startTime'>>): void {
  const store = correlationStorage.getStore();
  if (store) {
    if (updates.fileId !== undefined) store.fileId = updates.fileId;
    if (updates.fileName !== undefined) store.fileName = updates.fileName;
  }
}

/**
 * Gets correlation data suitable for logging
 * Returns an object with correlationId and elapsed time
 */
export function getCorrelationLogData(): Record<string, unknown> {
  const context = correlationStorage.getStore();
  if (!context) {
    return {};
  }

  const result: Record<string, unknown> = {
    correlationId: context.correlationId,
    elapsedMs: Date.now() - context.startTime,
  };

  if (context.fileId) result.fileId = context.fileId;
  if (context.fileName) result.fileName = context.fileName;

  return result;
}
