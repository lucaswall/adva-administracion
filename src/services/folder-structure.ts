/**
 * Folder structure discovery and caching service
 * Manages the Drive folder hierarchy for document organization
 */

import { getConfig } from '../config.js';
import { findByName, listByMimeType, createFolder, createSpreadsheet } from './drive.js';
import { getSheetMetadata, createSheet, setValues, formatSheet } from './sheets.js';
import { formatMonthFolder } from '../utils/spanish-date.js';
import { CONTROL_CREDITOS_SHEETS, CONTROL_DEBITOS_SHEETS } from '../constants/spreadsheet-headers.js';
import type { FolderStructure, Result, SortDestination } from '../types/index.js';

/** MIME type for Google Drive folders */
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** MIME type for Google Sheets */
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Required folder names */
const FOLDER_NAMES = {
  entrada: 'Entrada',
  creditos: 'Creditos',
  debitos: 'Debitos',
  sinProcesar: 'Sin Procesar',
  bancos: 'Bancos',
} as const;

/** Required spreadsheet names */
const SPREADSHEET_NAMES = {
  controlCreditos: 'Control de Creditos',
  controlDebitos: 'Control de Debitos',
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
  console.log(`[Folder Discovery] Finding or creating folder "${name}" in parent ${rootId}`);

  const findResult = await findByName(rootId, name, FOLDER_MIME);

  if (!findResult.ok) {
    console.error(`[Folder Discovery] Error searching for folder "${name}":`, findResult.error.message);
    return findResult;
  }

  if (findResult.value) {
    console.log(`[Folder Discovery] Folder "${name}" exists with ID: ${findResult.value.id}`);
    return { ok: true, value: findResult.value.id };
  }

  // Folder doesn't exist, create it
  console.log(`[Folder Discovery] Folder "${name}" not found, creating new folder...`);
  const createResult = await createFolder(rootId, name);

  if (!createResult.ok) {
    console.error(`[Folder Discovery] Error creating folder "${name}":`, createResult.error.message);
    return createResult;
  }

  console.log(`[Folder Discovery] Created folder "${name}" with ID: ${createResult.value.id}`);
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
 * Ensures required sheets exist in a spreadsheet
 * Creates missing sheets with headers and applies formatting
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetConfigs - Array of sheet configurations to ensure exist
 * @returns Success or error
 */
async function ensureSheetsExist(
  spreadsheetId: string,
  sheetConfigs: Array<{ title: string; headers: string[]; monetaryColumns?: number[] }>
): Promise<Result<void, Error>> {
  // Get existing sheets
  const metadataResult = await getSheetMetadata(spreadsheetId);
  if (!metadataResult.ok) {
    return metadataResult;
  }

  const existingSheets = new Map(metadataResult.value.map(s => [s.title, s.sheetId]));

  // Create missing sheets with headers and apply formatting
  for (const config of sheetConfigs) {
    let sheetId: number;

    if (existingSheets.has(config.title)) {
      // Sheet already exists, get its ID
      sheetId = existingSheets.get(config.title)!;
    } else {
      // Create the sheet
      const createResult = await createSheet(spreadsheetId, config.title);
      if (!createResult.ok) {
        return createResult;
      }
      sheetId = createResult.value;

      // Add header row
      const setResult = await setValues(
        spreadsheetId,
        `${config.title}!A1`,
        [config.headers]
      );
      if (!setResult.ok) {
        return setResult;
      }
    }

    // Apply formatting (bold headers, frozen rows, number format for monetary columns)
    if (config.monetaryColumns && config.monetaryColumns.length > 0) {
      const formatResult = await formatSheet(spreadsheetId, sheetId, {
        monetaryColumns: config.monetaryColumns,
        frozenRows: 1,
      });
      if (!formatResult.ok) {
        return formatResult;
      }
    }
  }

  return { ok: true, value: undefined };
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

  console.log(`[Folder Discovery] Starting folder structure discovery in root folder: ${rootId}`);

  // Find or create all required folders
  const entradaResult = await findOrCreateFolder(rootId, FOLDER_NAMES.entrada);
  if (!entradaResult.ok) return entradaResult;

  const creditosResult = await findOrCreateFolder(rootId, FOLDER_NAMES.creditos);
  if (!creditosResult.ok) return creditosResult;

  const debitosResult = await findOrCreateFolder(rootId, FOLDER_NAMES.debitos);
  if (!debitosResult.ok) return debitosResult;

  const sinProcesarResult = await findOrCreateFolder(rootId, FOLDER_NAMES.sinProcesar);
  if (!sinProcesarResult.ok) return sinProcesarResult;

  const bancosResult = await findOrCreateFolder(rootId, FOLDER_NAMES.bancos);
  if (!bancosResult.ok) return bancosResult;

  // Find or create control spreadsheets
  const controlCreditosResult = await findOrCreateSpreadsheet(rootId, SPREADSHEET_NAMES.controlCreditos);
  if (!controlCreditosResult.ok) return controlCreditosResult;

  const controlDebitosResult = await findOrCreateSpreadsheet(rootId, SPREADSHEET_NAMES.controlDebitos);
  if (!controlDebitosResult.ok) return controlDebitosResult;

  // Ensure required sheets exist in both control spreadsheets
  const ensureCreditosSheetsResult = await ensureSheetsExist(controlCreditosResult.value, CONTROL_CREDITOS_SHEETS);
  if (!ensureCreditosSheetsResult.ok) return ensureCreditosSheetsResult;

  const ensureDebitosSheetsResult = await ensureSheetsExist(controlDebitosResult.value, CONTROL_DEBITOS_SHEETS);
  if (!ensureDebitosSheetsResult.ok) return ensureDebitosSheetsResult;

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
    creditosId: creditosResult.value,
    debitosId: debitosResult.value,
    sinProcesarId: sinProcesarResult.value,
    bancosId: bancosResult.value,
    controlCreditosId: controlCreditosResult.value,
    controlDebitosId: controlDebitosResult.value,
    bankSpreadsheets,
    monthFolders: new Map(),
    lastRefreshed: new Date(),
  };

  cachedStructure = structure;
  console.log(`[Folder Discovery] Folder structure discovery complete:`);
  console.log(`  - Entrada: ${entradaResult.value}`);
  console.log(`  - Creditos: ${creditosResult.value}`);
  console.log(`  - Debitos: ${debitosResult.value}`);
  console.log(`  - Sin Procesar: ${sinProcesarResult.value}`);
  console.log(`  - Bancos: ${bancosResult.value}`);
  console.log(`  - Control de Creditos: ${controlCreditosResult.value}`);
  console.log(`  - Control de Debitos: ${controlDebitosResult.value}`);
  console.log(`  - Bank spreadsheets: ${bankSpreadsheets.size}`);
  return { ok: true, value: structure };
}

/**
 * Gets or creates a month folder for a destination
 *
 * @param destination - Sort destination ('creditos' or 'debitos')
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

  // sin_procesar and bancos don't use month folders
  if (destination === 'sin_procesar') {
    return { ok: true, value: cachedStructure.sinProcesarId };
  }
  if (destination === 'bancos') {
    return { ok: true, value: cachedStructure.bancosId };
  }

  const monthName = formatMonthFolder(date);
  const cacheKey = `${destination}:${monthName}`;

  // Check cache first
  const cachedId = cachedStructure.monthFolders.get(cacheKey);
  if (cachedId) {
    return { ok: true, value: cachedId };
  }

  // Determine parent folder
  const parentId = destination === 'creditos'
    ? cachedStructure.creditosId
    : cachedStructure.debitosId;

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
