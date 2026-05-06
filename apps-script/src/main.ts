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
    .addItem('🔄 Procesar Entrada', 'triggerScan')
    .addItem('🔗 Volver a Vincular Documentos', 'triggerRematch')
    .addItem('📝 Completar Detalles de Movimientos', 'triggerMatchMovimientos')
    .addSeparator()
    .addItem('ℹ️ Acerca de', 'showAbout')
    .addToUi();
}

/**
 * Triggers a manual scan of the Entrada folder
 */
export function triggerScan(): void {
  const url = getApiUrl('/api/scan');
  makeApiCall(url, 'post', null, 'Procesamiento iniciado correctamente.');
}

/**
 * Triggers re-matching of unmatched documents
 */
export function triggerRematch(): void {
  const url = getApiUrl('/api/rematch');
  makeApiCall(url, 'post', null, 'Vinculación de documentos iniciada correctamente.');
}

/**
 * Triggers matching of bank movements against Control de Ingresos/Egresos
 * Fills matchedFileId and detalle columns in Movimientos Bancario sheets
 */
export function triggerMatchMovimientos(): void {
  const url = getApiUrl('/api/match-movimientos');
  makeApiCall(url, 'post', null, 'Completado de detalles iniciado correctamente.');
}

/**
 * Validates that configuration values were properly injected during build
 */
function validateConfig(): void {
  // Check if API_BASE_URL was properly injected during build
  if (!API_BASE_URL || API_BASE_URL.includes('{{') || API_BASE_URL.includes('}}')) {
    throw new Error('API_BASE_URL no está configurada. Reconstruí el script con la variable de entorno API_BASE_URL definida.');
  }

  // Check if API_SECRET was properly injected during build
  if (!API_SECRET || API_SECRET.includes('{{') || API_SECRET.includes('}}')) {
    throw new Error('API_SECRET no está configurada. Reconstruí el script con la variable de entorno API_SECRET definida.');
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
      ui.alert('✅ Listo', message, ui.ButtonSet.OK);
    } else {
      let errorMsg = `El servidor devolvió el estado ${statusCode}`;
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
      ui.alert('⚠️ Error de la API', errorMsg, ui.ButtonSet.OK);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    let userMessage = 'No se pudo conectar con el servidor.\n\n';

    // Provide more helpful error messages
    if (errorMessage.includes('DNS')) {
      userMessage += 'Falló la resolución DNS. Revisá la configuración del dominio de la API.';
    } else if (errorMessage.includes('timeout')) {
      userMessage += 'La solicitud agotó el tiempo de espera. El servidor puede estar caído o no responder.';
    } else if (errorMessage.includes('SSL') || errorMessage.includes('certificate')) {
      userMessage += 'Error de certificado SSL. Revisá la configuración del servidor.';
    } else {
      userMessage += `Error: ${errorMessage}`;
    }

    ui.alert('❌ Error de conexión', userMessage, ui.ButtonSet.OK);
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

  let message = 'Menú de Administración ADVA\n\n';

  // Test API connectivity
  message += `URL de la API: ${API_BASE_URL}\n\n`;

  const status = fetchServerStatus();

  if (status) {
    message += `✅ Estado del servidor: En línea\n\n`;

    // Version and Environment
    message += `Versión: ${status.version}\n`;
    message += `Entorno: ${status.environment}\n\n`;

    // Uptime Information
    message += `Tiempo activo: ${status.uptime}\n`;
    message += `Iniciado: ${formatDateTime(status.startTime)}\n\n`;

    // Queue Statistics
    message += `━━ Estado de la cola ━━\n`;
    message += `En ejecución: ${status.queue.running}\n`;
    message += `Pendientes: ${status.queue.pending}\n`;
    message += `Completados: ${status.queue.completed}\n`;
    message += `Fallidos: ${status.queue.failed}`;
  } else {
    message += '⚠️ Estado del servidor: Fuera de línea\n\n';
    message += 'No se pudo conectar con el servidor.\n';
    message += 'Puede estar caído o la URL de la API puede ser incorrecta.';
  }

  ui.alert('Acerca del menú ADVA', message, ui.ButtonSet.OK);
}
