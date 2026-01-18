/**
 * Folder structure discovery and caching service
 * Manages the Drive folder hierarchy for document organization
 */

import { getConfig } from '../config.js';
import { findByName, listByMimeType, createFolder, createSpreadsheet } from './drive.js';
import { formatMonthFolder } from '../utils/spanish-date.js';
import type { FolderStructure, Result, SortDestination } from '../types/index.js';

/** MIME type for Google Drive folders */
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** MIME type for Google Sheets */
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Required folder names */
const FOLDER_NAMES = {
  entrada: 'Entrada',
  cobros: 'Cobros',
  pagos: 'Pagos',
  sinProcesar: 'Sin Procesar',
  bancos: 'Bancos',
} as const;

/** Required spreadsheet names */
const SPREADSHEET_NAMES = {
  controlCobros: 'Control de Cobros',
  controlPagos: 'Control de Pagos',
} as const;

/** Cached folder structure */
let cachedStructure: FolderStructure | null = null;

/**
 * Gets the cached folder structure (if available)
 * @returns The cached folder structure or null
 */
export function getCachedFolderStructure(): FolderStructure | null {
  return cachedStructure;
}

/**
 * Clears the cached folder structure
 * Used for testing and forced refresh
 */
export function clearFolderStructureCache(): void {
  cachedStructure = null;
}

/**
 * Finds or creates a folder in the root
 * @param rootId - Root folder ID
 * @param name - Folder name
 * @returns Folder ID
 */
async function findOrCreateFolder(
  rootId: string,
  name: string
): Promise<Result<string, Error>> {
  const findResult = await findByName(rootId, name, FOLDER_MIME);

  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value) {
    return { ok: true, value: findResult.value.id };
  }

  // Folder doesn't exist, create it
  const createResult = await createFolder(rootId, name);

  if (!createResult.ok) {
    return createResult;
  }

  return { ok: true, value: createResult.value.id };
}

/**
 * Finds or creates a spreadsheet in the root
 * @param rootId - Root folder ID
 * @param name - Spreadsheet name
 * @returns Spreadsheet ID
 */
async function findOrCreateSpreadsheet(
  rootId: string,
  name: string
): Promise<Result<string, Error>> {
  const findResult = await findByName(rootId, name, SPREADSHEET_MIME);

  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value) {
    return { ok: true, value: findResult.value.id };
  }

  // Spreadsheet doesn't exist, create it
  const createResult = await createSpreadsheet(rootId, name);

  if (!createResult.ok) {
    return createResult;
  }

  return { ok: true, value: createResult.value.id };
}

/**
 * Discovers and caches the folder structure from Drive
 * Creates missing folders as needed
 *
 * @returns The folder structure or error
 */
export async function discoverFolderStructure(): Promise<Result<FolderStructure, Error>> {
  const config = getConfig();
  const rootId = config.driveRootFolderId;

  // Find or create all required folders
  const entradaResult = await findOrCreateFolder(rootId, FOLDER_NAMES.entrada);
  if (!entradaResult.ok) return entradaResult;

  const cobrosResult = await findOrCreateFolder(rootId, FOLDER_NAMES.cobros);
  if (!cobrosResult.ok) return cobrosResult;

  const pagosResult = await findOrCreateFolder(rootId, FOLDER_NAMES.pagos);
  if (!pagosResult.ok) return pagosResult;

  const sinProcesarResult = await findOrCreateFolder(rootId, FOLDER_NAMES.sinProcesar);
  if (!sinProcesarResult.ok) return sinProcesarResult;

  const bancosResult = await findOrCreateFolder(rootId, FOLDER_NAMES.bancos);
  if (!bancosResult.ok) return bancosResult;

  // Find or create control spreadsheets
  const controlCobrosResult = await findOrCreateSpreadsheet(rootId, SPREADSHEET_NAMES.controlCobros);
  if (!controlCobrosResult.ok) return controlCobrosResult;

  const controlPagosResult = await findOrCreateSpreadsheet(rootId, SPREADSHEET_NAMES.controlPagos);
  if (!controlPagosResult.ok) return controlPagosResult;

  // Discover bank spreadsheets in Bancos folder
  const bankSpreadsheetsResult = await listByMimeType(bancosResult.value, SPREADSHEET_MIME);
  if (!bankSpreadsheetsResult.ok) return bankSpreadsheetsResult;

  const bankSpreadsheets = new Map<string, string>();
  for (const sheet of bankSpreadsheetsResult.value) {
    bankSpreadsheets.set(sheet.name, sheet.id);
  }

  // Build and cache the structure
  const structure: FolderStructure = {
    rootId,
    entradaId: entradaResult.value,
    cobrosId: cobrosResult.value,
    pagosId: pagosResult.value,
    sinProcesarId: sinProcesarResult.value,
    bancosId: bancosResult.value,
    controlCobrosId: controlCobrosResult.value,
    controlPagosId: controlPagosResult.value,
    bankSpreadsheets,
    monthFolders: new Map(),
    lastRefreshed: new Date(),
  };

  cachedStructure = structure;
  return { ok: true, value: structure };
}

/**
 * Gets or creates a month folder for a destination
 *
 * @param destination - Sort destination ('cobros' or 'pagos')
 * @param date - Date to determine the month
 * @returns Folder ID for the month
 */
export async function getOrCreateMonthFolder(
  destination: SortDestination,
  date: Date
): Promise<Result<string, Error>> {
  if (!cachedStructure) {
    return {
      ok: false,
      error: new Error('Folder structure not initialized. Call discoverFolderStructure first.'),
    };
  }

  // sin_procesar doesn't use month folders
  if (destination === 'sin_procesar') {
    return { ok: true, value: cachedStructure.sinProcesarId };
  }

  const monthName = formatMonthFolder(date);
  const cacheKey = `${destination}:${monthName}`;

  // Check cache first
  const cachedId = cachedStructure.monthFolders.get(cacheKey);
  if (cachedId) {
    return { ok: true, value: cachedId };
  }

  // Determine parent folder
  const parentId = destination === 'cobros'
    ? cachedStructure.cobrosId
    : cachedStructure.pagosId;

  // Try to find existing folder
  const findResult = await findByName(parentId, monthName, FOLDER_MIME);
  if (!findResult.ok) return findResult;

  if (findResult.value) {
    // Cache and return existing folder
    cachedStructure.monthFolders.set(cacheKey, findResult.value.id);
    return { ok: true, value: findResult.value.id };
  }

  // Create new month folder
  const createResult = await createFolder(parentId, monthName);
  if (!createResult.ok) return createResult;

  // Cache and return new folder
  cachedStructure.monthFolders.set(cacheKey, createResult.value.id);
  return { ok: true, value: createResult.value.id };
}
