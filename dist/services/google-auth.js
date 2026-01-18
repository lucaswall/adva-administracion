/**
 * Google Service Account authentication
 * Uses googleapis library for JWT-based authentication
 */
import { google } from 'googleapis';
import { getConfig } from '../config.js';
/**
 * Cached auth client instance
 */
let authClient = null;
/**
 * Parses the service account key from environment
 * The key should be base64 encoded JSON
 */
function parseServiceAccountKey() {
    const config = getConfig();
    const keyString = config.googleServiceAccountKey;
    if (!keyString) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not configured');
    }
    try {
        // Try to decode as base64 first
        const decoded = Buffer.from(keyString, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }
    catch {
        // If base64 decoding fails, try parsing as raw JSON
        try {
            return JSON.parse(keyString);
        }
        catch {
            throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY format. Must be base64-encoded or raw JSON.');
        }
    }
}
/**
 * Gets or creates the Google Auth client
 *
 * @param scopes - OAuth scopes to request
 * @returns Authenticated GoogleAuth client
 */
export function getGoogleAuth(scopes) {
    if (authClient) {
        return authClient;
    }
    const credentials = parseServiceAccountKey();
    authClient = new google.auth.GoogleAuth({
        credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
        },
        scopes,
    });
    return authClient;
}
/**
 * Gets the default scopes for Drive and Sheets access
 */
export function getDefaultScopes() {
    return [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/spreadsheets',
    ];
}
/**
 * Clears the cached auth client (for testing)
 */
export function clearAuthCache() {
    authClient = null;
}
