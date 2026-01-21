/**
 * ADVA Menu Library
 * Shared library for Control spreadsheets.
 * Menu callbacks use ADVALib prefix so they resolve to this library.
 */

import { API_BASE_URL, API_SECRET } from './config';

/**
 * Response from the /api/status endpoint
 */
interface StatusResponse {
  status: 'ok';
  timestamp: string;
  uptime: number;
  queue?: {
    size: number;
    pending: number;
  };
}

/**
 * API error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Creates the ADVA menu.
 * Called from bound script's onOpen() trigger.
 */
export function createMenu(): void {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('ADVA')
    .addItem('🔄 Trigger Scan', 'ADVALib.triggerScan')
    .addItem('🔗 Trigger Re-match', 'ADVALib.triggerRematch')
    .addItem('🏦 Auto-fill Bank Data', 'ADVALib.triggerAutofillBank')
    .addSeparator()
    .addItem('ℹ️ About', 'ADVALib.showAbout')
    .addToUi();
}

/**
 * Triggers a manual scan of the Entrada folder
 */
export function triggerScan(): void {
  const url = getApiUrl('/api/scan');
  makeApiCall(url, 'post', null, 'Scan triggered successfully!');
}

/**
 * Triggers re-matching of unmatched documents
 */
export function triggerRematch(): void {
  const url = getApiUrl('/api/rematch');
  makeApiCall(url, 'post', null, 'Re-match triggered successfully!');
}

/**
 * Triggers automatic bank data filling
 */
export function triggerAutofillBank(): void {
  const url = getApiUrl('/api/autofill-bank');
  makeApiCall(url, 'post', null, 'Bank auto-fill triggered successfully!');
}

/**
 * Validates that configuration values were properly injected during build
 */
function validateConfig(): void {
  // Check if API_BASE_URL was properly injected during build
  if (!API_BASE_URL || API_BASE_URL.includes('{{') || API_BASE_URL.includes('}}')) {
    throw new Error('API_BASE_URL not configured. Please rebuild the library with API_BASE_URL environment variable set.');
  }

  // Check if API_SECRET was properly injected during build
  if (!API_SECRET || API_SECRET.includes('{{') || API_SECRET.includes('}}')) {
    throw new Error('API_SECRET not configured. Please rebuild the library with API_SECRET environment variable set.');
  }
}

/**
 * Constructs the full API URL with HTTPS protocol
 * @param endpoint - The API endpoint path (e.g., '/api/scan')
 * @returns The full HTTPS URL
 */
function getApiUrl(endpoint: string): string {
  validateConfig();

  // Remove any trailing slash from base URL and leading slash from endpoint
  const cleanBase = API_BASE_URL.replace(/\/$/, '');
  const cleanEndpoint = endpoint.replace(/^\//, '');

  return `https://${cleanBase}/${cleanEndpoint}`;
}

/**
 * Makes an API call to the ADVA server
 * @param url - The full URL to call
 * @param method - HTTP method (get, post, etc.)
 * @param payload - Request payload (for POST/PUT)
 * @param successMessage - Message to show on success
 */
function makeApiCall(
  url: string,
  method: GoogleAppsScript.URL_Fetch.HttpMethod,
  payload: Record<string, unknown> | null,
  successMessage: string
): void {
  const ui = SpreadsheetApp.getUi();

  try {
    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ADVA-Spreadsheet/3.0',
        'Authorization': `Bearer ${API_SECRET}`
      },
      muteHttpExceptions: true
    };

    if (payload) {
      options.payload = JSON.stringify(payload);
    }

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      let message = successMessage;
      try {
        const data = JSON.parse(responseText) as { message?: string };
        if (data.message) {
          message = `${successMessage}\n\n${data.message}`;
        }
      } catch (e) {
        // Response is not JSON, use default message
      }
      ui.alert('✅ Success', message, ui.ButtonSet.OK);
    } else {
      let errorMsg = `Server returned status ${statusCode}`;
      try {
        const errorData = JSON.parse(responseText) as ErrorResponse;
        if (errorData.error) {
          errorMsg += `\n\n${errorData.error}`;
          if (errorData.message) {
            errorMsg += `\n${errorData.message}`;
          }
        }
      } catch (e) {
        // Response is not JSON
        if (responseText) {
          errorMsg += `\n\n${responseText}`;
        }
      }
      ui.alert('⚠️ API Error', errorMsg, ui.ButtonSet.OK);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    let userMessage = 'Failed to connect to API server.\n\n';

    // Provide more helpful error messages
    if (errorMessage.includes('DNS')) {
      userMessage += 'DNS resolution failed. Please check the API domain configuration.';
    } else if (errorMessage.includes('timeout')) {
      userMessage += 'Request timed out. The server may be down or unresponsive.';
    } else if (errorMessage.includes('SSL') || errorMessage.includes('certificate')) {
      userMessage += 'SSL certificate error. Please check the server configuration.';
    } else {
      userMessage += `Error: ${errorMessage}`;
    }

    ui.alert('❌ Connection Error', userMessage, ui.ButtonSet.OK);
  }
}

/**
 * Fetches server status from /api/status endpoint
 * @returns Status data or null if request fails
 */
function fetchServerStatus(): StatusResponse | null {
  try {
    const url = getApiUrl('/api/status');
    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'get',
      headers: {
        'User-Agent': 'ADVA-Spreadsheet/3.0',
        'Authorization': `Bearer ${API_SECRET}`
      },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 200) {
      const data = JSON.parse(response.getContentText()) as StatusResponse;
      return data;
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Formats uptime in seconds to human-readable string
 * @param seconds - Uptime in seconds
 * @returns Formatted string (e.g., "2h 34m", "45m", "1d 3h")
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : '< 1m';
}

/**
 * Shows information about the ADVA menu and tests API connectivity
 */
export function showAbout(): void {
  const ui = SpreadsheetApp.getUi();

  let message = 'ADVA Administration Menu v3.0\n\n';
  message += 'This menu allows you to trigger server operations:\n\n';
  message += '• Trigger Scan: Processes new documents in Entrada folder\n';
  message += '• Trigger Re-match: Re-matches unmatched documents\n';
  message += '• Auto-fill Bank: Fills bank data automatically\n\n';
  message += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  // Test API connectivity
  message += `API Base URL: ${API_BASE_URL}\n`;

  const status = fetchServerStatus();

  if (status) {
    message += `Status: ✅ Online\n`;
    message += `Uptime: ${formatUptime(status.uptime)}\n`;

    if (status.queue) {
      message += `Queue: ${status.queue.pending} pending / ${status.queue.size} total\n`;
    }
  } else {
    message += 'Status: ⚠️ Unable to connect\n';
    message += '\nThe server may be offline or the API URL may be incorrect.';
  }

  ui.alert('About ADVA Menu', message, ui.ButtonSet.OK);
}
