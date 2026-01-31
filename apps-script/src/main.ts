/**
 * ADVA Menu Bound Script
 * Attached directly to Dashboard Operativo Contable spreadsheet.
 * Provides menu for triggering server operations.
 */

import { API_BASE_URL, API_SECRET } from './config';

/**
 * Response from the /api/status endpoint
 */
interface StatusResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
  environment: string;
  uptime: string;
  startTime: string;
  queue: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
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
 * Apps Script trigger: Runs when spreadsheet is opened.
 * Creates the ADVA menu in the UI.
 */
export function createMenu(): void {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('ADVA')
    .addItem('🔄 Trigger Scan', 'triggerScan')
    .addItem('🔗 Trigger Re-match', 'triggerRematch')
    .addItem('🏦 Auto-fill Bank Data', 'triggerAutofillBank')
    .addItem('📝 Completar Detalles Movimientos', 'triggerMatchMovimientos')
    .addSeparator()
    .addItem('ℹ️ About', 'showAbout')
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
 * Triggers matching of bank movements against Control de Ingresos/Egresos
 * Fills matchedFileId and detalle columns in Movimientos Bancario sheets
 */
export function triggerMatchMovimientos(): void {
  const url = getApiUrl('/api/match-movimientos');
  makeApiCall(url, 'post', null, 'Match movimientos triggered successfully!');
}

/**
 * Validates that configuration values were properly injected during build
 */
function validateConfig(): void {
  // Check if API_BASE_URL was properly injected during build
  if (!API_BASE_URL || API_BASE_URL.includes('{{') || API_BASE_URL.includes('}}')) {
    throw new Error('API_BASE_URL not configured. Please rebuild the script with API_BASE_URL environment variable set.');
  }

  // Check if API_SECRET was properly injected during build
  if (!API_SECRET || API_SECRET.includes('{{') || API_SECRET.includes('}}')) {
    throw new Error('API_SECRET not configured. Please rebuild the script with API_SECRET environment variable set.');
  }
}

/**
 * Constructs the full API URL
 * @param endpoint - The API endpoint path (e.g., '/api/scan')
 * @returns The full URL
 */
function getApiUrl(endpoint: string): string {
  validateConfig();

  // Remove any trailing slash from base URL and leading slash from endpoint
  const cleanBase = API_BASE_URL.replace(/\/$/, '');
  const cleanEndpoint = endpoint.replace(/^\//, '');

  return `${cleanBase}/${cleanEndpoint}`;
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
        'User-Agent': 'ADVA-Spreadsheet',
        'Authorization': `Bearer ${API_SECRET}`
      },
      muteHttpExceptions: true
    };

    // Always send a JSON payload (empty object if null) for POST requests
    // This ensures Content-Type: application/json is valid
    if (method.toLowerCase() === 'post') {
      options.payload = JSON.stringify(payload || {});
    } else if (payload) {
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
        'User-Agent': 'ADVA-Spreadsheet',
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
 * Formats an ISO date string to a readable local format
 * @param isoString - ISO 8601 date string
 * @returns Formatted date string
 */
function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss z');
  } catch (e) {
    return isoString;
  }
}

/**
 * Shows information about the ADVA menu and tests API connectivity
 */
export function showAbout(): void {
  const ui = SpreadsheetApp.getUi();

  let message = 'ADVA Administration Menu\n\n';

  // Test API connectivity
  message += `API URL: ${API_BASE_URL}\n\n`;

  const status = fetchServerStatus();

  if (status) {
    message += `✅ Server Status: Online\n\n`;

    // Version and Environment
    message += `Version: ${status.version}\n`;
    message += `Environment: ${status.environment}\n\n`;

    // Uptime Information
    message += `Uptime: ${status.uptime}\n`;
    message += `Started: ${formatDateTime(status.startTime)}\n\n`;

    // Queue Statistics
    message += `━━ Queue Status ━━\n`;
    message += `Running: ${status.queue.running}\n`;
    message += `Pending: ${status.queue.pending}\n`;
    message += `Completed: ${status.queue.completed}\n`;
    message += `Failed: ${status.queue.failed}`;
  } else {
    message += '⚠️ Server Status: Offline\n\n';
    message += 'Unable to connect to the server.\n';
    message += 'The server may be down or the API URL may be incorrect.';
  }

  ui.alert('About ADVA Menu', message, ui.ButtonSet.OK);
}
