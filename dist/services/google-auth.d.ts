/**
 * Google Service Account authentication
 * Uses googleapis library for JWT-based authentication
 */
import { Auth } from 'googleapis';
/**
 * Gets or creates the Google Auth client
 *
 * @param scopes - OAuth scopes to request
 * @returns Authenticated GoogleAuth client
 */
export declare function getGoogleAuth(scopes: string[]): Auth.GoogleAuth;
/**
 * Gets the default scopes for Drive and Sheets access
 * Uses full Drive access for folder creation and file movement
 */
export declare function getDefaultScopes(): string[];
/**
 * Clears the cached auth client (for testing)
 */
export declare function clearAuthCache(): void;
