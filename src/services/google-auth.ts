/**
 * Google Service Account authentication
 * Uses googleapis library for JWT-based authentication
 */

import { google, Auth } from 'googleapis';
import { getConfig } from '../config.js';

/**
 * Service Account credentials structure
 */
interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

/**
 * Cached auth client instance
 */
let authClient: Auth.GoogleAuth | null = null;

/**
 * Cached auth client promise for concurrent initialization protection
 */
let authClientPromise: Promise<Auth.GoogleAuth> | null = null;

/**
 * Parses the service account key from environment
 * The key should be base64 encoded JSON
 */
function parseServiceAccountKey(): ServiceAccountCredentials {
  const config = getConfig();
  const keyString = config.googleServiceAccountKey;

  if (!keyString) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not configured');
  }

  try {
    // Try to decode as base64 first
    const decoded = Buffer.from(keyString, 'base64').toString('utf-8');
    return JSON.parse(decoded) as ServiceAccountCredentials;
  } catch {
    // If base64 decoding fails, try parsing as raw JSON
    try {
      return JSON.parse(keyString) as ServiceAccountCredentials;
    } catch {
      throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY format. Must be base64-encoded or raw JSON.');
    }
  }
}

/**
 * Gets or creates the Google Auth client
 * Uses promise-caching pattern to prevent race conditions during initialization
 *
 * @param scopes - OAuth scopes to request
 * @returns Authenticated GoogleAuth client
 */
export async function getGoogleAuthAsync(scopes: string[]): Promise<Auth.GoogleAuth> {
  // Fast path: client already created
  if (authClient) {
    return authClient;
  }

  // Promise-caching: if initialization is in progress, wait for it
  if (authClientPromise) {
    return await authClientPromise;
  }

  // Create and cache the initialization promise
  authClientPromise = (async () => {
    const credentials = parseServiceAccountKey();
    const newClient = new google.auth.GoogleAuth({
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
      scopes,
    });

    authClient = newClient;
    return newClient;
  })();

  try {
    return await authClientPromise;
  } catch (error) {
    // Clear promise on error to allow retry
    authClientPromise = null;
    throw error;
  }
}

/**
 * Gets or creates the Google Auth client (synchronous - DEPRECATED)
 * Use getGoogleAuthAsync instead for proper concurrency handling
 *
 * @param scopes - OAuth scopes to request
 * @returns Authenticated GoogleAuth client
 * @deprecated Use getGoogleAuthAsync for promise-caching pattern
 */
export function getGoogleAuth(scopes: string[]): Auth.GoogleAuth {
  // First check (fast path)
  if (authClient) {
    return authClient;
  }

  // Create new client
  const credentials = parseServiceAccountKey();
  const newClient = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes,
  });

  // Double-check: another call may have already set authClient
  // If so, use the existing one to avoid multiple clients
  if (authClient) {
    return authClient;
  }

  authClient = newClient;
  return authClient;
}

/**
 * Gets the default scopes for Drive and Sheets access
 * Uses full Drive access for folder creation and file movement
 */
export function getDefaultScopes(): string[] {
  return [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
  ];
}

/**
 * Clears the cached auth client (for testing)
 */
export function clearAuthCache(): void {
  authClient = null;
  authClientPromise = null;
}
