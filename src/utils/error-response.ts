/**
 * Helpers for sending sanitized HTTP error responses.
 *
 * 500 responses must never echo internal error details (file paths, row IDs, SQL
 * snippets, etc.) back to callers. All such details are captured in the server-side
 * error log alongside a correlationId so they can be traced without being exposed.
 */

import { randomUUID } from 'node:crypto';
import { error as logError } from './logger.js';
import type { FastifyReply } from 'fastify';

/**
 * Sanitized 500 response body
 */
export interface Error500Response {
  /** Always "Internal server error" — no internal details */
  error: string;
  /** UUID that correlates this response to the server-side error log entry */
  correlationId: string;
}

/**
 * Sends a sanitized HTTP 500 response and logs the original error with a correlationId.
 *
 * @param reply - Fastify reply object (status is set to 500)
 * @param err - Original error (logged server-side, NOT sent to client)
 * @param context - Extra log context (module, phase, etc.)
 * @returns Generic 500 body with correlationId
 */
export function respond500(
  reply: FastifyReply,
  err: Error,
  context: Record<string, unknown> = {}
): Error500Response {
  const correlationId = randomUUID();

  logError('Internal server error', {
    ...context,
    correlationId,
    error: err.message,
  });

  reply.status(500);

  return {
    error: 'Internal server error',
    correlationId,
  };
}
