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
 * Scopes used to create the cached auth client (for scope mismatch detection ADV-294)
 */
let authClientScopes: string[] | null = null;

/**
 * Cached auth client promise for concurrent initialization protection
 */
let authClientPromise: Promise<Auth.GoogleAuth> | null = null;

/**
 * Scopes being initialized by the in-flight authClientPromise (ADV-294)
 */
let authClientPromiseScopes: string[] | null = null;

/**
 * Returns true when both arrays contain the same set of scopes (order-independent).
 */
function scopesMatch(a: string[] | null, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return [...a].sort().join(',') === [...b].sort().join(',');
}

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
  // Fast path: client already created with matching scopes (ADV-294)
  if (authClient && scopesMatch(authClientScopes, scopes)) {
    return authClient;
  }

  // Promise-caching: if initialization with the SAME scopes is in progress, wait for it (ADV-294)
  if (authClientPromise && scopesMatch(authClientPromiseScopes, scopes)) {
    return await authClientPromise;
  }

  // Create and cache the initialization promise for these scopes
  authClientPromiseScopes = scopes;
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
    authClientScopes = scopes;
    return newClient;
  })();

  try {
    return await authClientPromise;
  } catch (error) {
    // Clear promise on error to allow retry
    authClientPromise = null;
    authClientPromiseScopes = null;
    throw error;
  }
}

/**
 * Gets the default scopes for Drive and Sheets access.
 *
 * Uses full `drive` scope (not `drive.file`) because the app must read folders
 * it did not create: Entrada, yearly archives, and banking subfolders already exist
 * in the user's Drive. `drive.file` only grants access to files the application
 * itself created, which is insufficient here.
 *
 * The service account is domain-delegated to a Workspace user who owns **only**
 * the ADVA folder hierarchy, limiting the scope of access to that folder tree.
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
  authClientScopes = null;
  authClientPromise = null;
  authClientPromiseScopes = null;
}
