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
 * Sanitized 5xx response body
 */
export interface ErrorResponse {
  /** Generic message — no internal details */
  error: string;
  /** UUID that correlates this response to the server-side error log entry */
  correlationId: string;
}

/** Backwards-compatible alias for the 500 response shape */
export type Error500Response = ErrorResponse;

function respondError(
  reply: FastifyReply,
  status: number,
  message: string,
  err: Error,
  context: Record<string, unknown>
): ErrorResponse {
  const correlationId = randomUUID();
  logError(message, { ...context, correlationId, error: err.message });
  reply.status(status);
  return { error: message, correlationId };
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
): ErrorResponse {
  return respondError(reply, 500, 'Internal server error', err, context);
}

/**
 * Sends a sanitized HTTP 503 response and logs the original error with a correlationId.
 * Use for downstream-service issues (deadline exceeded, dependency unavailable) where
 * "internal server error" misrepresents the failure mode. ADV-219.
 *
 * @param reply - Fastify reply object (status is set to 503)
 * @param err - Original error (logged server-side, NOT sent to client)
 * @param context - Extra log context (module, phase, etc.)
 * @returns Generic 503 body with correlationId
 */
export function respond503(
  reply: FastifyReply,
  err: Error,
  context: Record<string, unknown> = {}
): ErrorResponse {
  return respondError(reply, 503, 'Service unavailable', err, context);
}
