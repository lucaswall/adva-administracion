/**
 * ADVA Administración Server
 * Fastify-based server for invoice and payment processing
 */
import Fastify from 'fastify';
/**
 * Build and configure the Fastify server
 */
export declare function buildServer(): Promise<Fastify.FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, Fastify.FastifyBaseLogger, Fastify.FastifyTypeProviderDefault>>;
