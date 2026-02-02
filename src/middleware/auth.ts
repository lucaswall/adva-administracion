/**
 * Authentication middleware for API endpoints
 * Validates Bearer token using constant-time comparison
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config.js';
import { warn } from '../utils/logger.js';
import { timingSafeEqual, createHash } from 'crypto';

/**
 * Constant-time string comparison to prevent timing attacks
 * ADV-6: Uses SHA-256 hashing to normalize string lengths before comparison.
 * This prevents timing leaks from buffer padding differences.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal
 */
function constantTimeCompare(a: string, b: string): boolean {
  // Hash both strings with SHA-256 to normalize length
  // This ensures timingSafeEqual always compares 32-byte buffers,
  // eliminating timing leaks from padding different-length strings
  const hashA = createHash('sha256').update(a, 'utf-8').digest();
  const hashB = createHash('sha256').update(b, 'utf-8').digest();

  // Both hashes are always exactly 32 bytes, so timingSafeEqual
  // performs a true constant-time comparison
  return timingSafeEqual(hashA, hashB);
}

/**
 * Authentication middleware hook
 * Validates Bearer token from Authorization header
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const config = getConfig();

  // Validate API_SECRET is configured
  if (!config.apiSecret || config.apiSecret.length === 0) {
    warn('API_SECRET not configured - rejecting request', {
      module: 'auth',
      phase: 'validate',
      path: request.url,
    });

    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'API_SECRET not configured',
    });
  }

  // Extract Authorization header
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    warn('Authentication failed: missing Authorization header', {
      module: 'auth',
      phase: 'validate',
      path: request.url,
      ip: request.ip,
    });

    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing authorization header',
    });
  }

  // Parse Bearer token
  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    warn('Authentication failed: invalid Authorization header format', {
      module: 'auth',
      phase: 'validate',
      path: request.url,
      ip: request.ip,
    });

    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid authorization header format',
    });
  }

  const token = parts[1].trim();

  if (!token) {
    warn('Authentication failed: empty token', {
      module: 'auth',
      phase: 'validate',
      path: request.url,
      ip: request.ip,
    });

    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Empty authorization token',
    });
  }

  // Validate token using constant-time comparison
  const isValid = constantTimeCompare(token, config.apiSecret);

  if (!isValid) {
    warn('Authentication failed: invalid token', {
      module: 'auth',
      phase: 'validate',
      path: request.url,
      ip: request.ip,
    });

    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid authorization token',
    });
  }

  // Token is valid - continue to route handler
}
