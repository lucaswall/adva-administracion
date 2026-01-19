/**
 * Google Service Account authentication for MCP server
 * Uses GOOGLE_SERVICE_ACCOUNT_KEY env var (base64-encoded JSON)
 */

import { google, Auth } from 'googleapis';

/** Read-only scopes for Drive and Sheets */
export const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

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

let authClient: Auth.GoogleAuth | null = null;

/**
 * Parses service account key from environment
 * Supports both base64-encoded and raw JSON formats
 */
function parseServiceAccountKey(): ServiceAccountCredentials {
  const keyString = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!keyString) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set');
  }

  try {
    // Try base64 decode first
    const decoded = Buffer.from(keyString, 'base64').toString('utf-8');
    return JSON.parse(decoded) as ServiceAccountCredentials;
  } catch {
    // Fall back to raw JSON
    try {
      return JSON.parse(keyString) as ServiceAccountCredentials;
    } catch {
      throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY format. Must be base64-encoded or raw JSON.');
    }
  }
}

/**
 * Gets or creates authenticated GoogleAuth client
 */
export function getGoogleAuth(): Auth.GoogleAuth {
  if (authClient) {
    return authClient;
  }

  const credentials = parseServiceAccountKey();

  authClient = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: SCOPES,
  });

  return authClient;
}

/**
 * Initializes Google APIs with service account auth
 */
export function initializeGoogleApis(): void {
  const auth = getGoogleAuth();
  google.options({ auth });
}
