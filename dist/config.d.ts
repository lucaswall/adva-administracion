/**
 * Configuration management for ADVA Administración Server
 * All configuration is loaded from environment variables
 */
import type { LogLevel } from './types/index.js';
/**
 * ADVA's CUIT numbers
 * ADVA is always the receptor (client) in invoices, never the emisor (issuer)
 */
export declare const ADVA_CUITS: readonly ["30709076783"];
/**
 * Checks if a CUIT belongs to ADVA
 *
 * @param cuit - CUIT to check (with or without dashes)
 * @returns true if CUIT belongs to ADVA
 */
export declare function isAdvaCuit(cuit: string): boolean;
/**
 * Application configuration loaded from environment
 */
export interface Config {
    port: number;
    nodeEnv: 'development' | 'production' | 'test';
    logLevel: LogLevel;
    googleServiceAccountKey: string;
    geminiApiKey: string;
    driveRootFolderId: string;
    matchDaysBefore: number;
    matchDaysAfter: number;
    usdArsTolerancePercent: number;
}
/**
 * Loads configuration from environment variables
 * Throws if required variables are missing
 */
export declare function loadConfig(): Config;
/**
 * Gets the application configuration
 * Loads from environment on first call
 */
export declare function getConfig(): Config;
/**
 * Resets the config instance (for testing)
 */
export declare function resetConfig(): void;
