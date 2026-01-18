/**
 * ADVA Administración Server
 * Fastify-based server for invoice and payment processing
 */
import Fastify from 'fastify';
/**
 * Build and configure the Fastify server
 */
export declare function buildServer(): Promise<Fastify.FastifyInstance<import("node:http").Server<typeof import("node:http").IncomingMessage, typeof import("node:http").ServerResponse>, import("node:http").IncomingMessage, import("node:http").ServerResponse<import("node:http").IncomingMessage>, Fastify.FastifyBaseLogger, Fastify.FastifyTypeProviderDefault>>;
