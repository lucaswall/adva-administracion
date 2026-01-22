/**
 * Folder structure discovery and caching service
 * Manages the Drive folder hierarchy for document organization
 */

import { getConfig } from '../config.js';
import { findByName, listByMimeType, createFolder, createSpreadsheet } from './drive.js';
import { getSheetMetadata, createSheet, setValues, getValues, formatSheet, deleteSheet, moveSheetToFirst } from './sheets.js';
import { formatMonthFolder } from '../utils/spanish-date.js';
import { CONTROL_CREDITOS_SHEETS, CONTROL_DEBITOS_SHEETS, DASHBOARD_OPERATIVO_SHEETS } from '../constants/spreadsheet-headers.js';
import type { FolderStructure, Result, SortDestination } from '../types/index.js';
import { debug, info, error as logError } from '../utils/logger.js';

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
  dashboardOperativo: 'Dashboard Operativo Contable',
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
  debug('Finding or creating folder', {
    module: 'folder-structure',
    phase: 'find-or-create',
    folderName: name,
    parentId: rootId
  });

  const findResult = await findByName(rootId, name, FOLDER_MIME);

  if (!findResult.ok) {
    logError('Error searching for folder', {
      module: 'folder-structure',
      phase: 'find-or-create',
      folderName: name,
      error: findResult.error.message
    });
    return findResult;
  }

  if (findResult.value) {
    debug('Folder already exists', {
      module: 'folder-structure',
      phase: 'find-or-create',
      folderName: name,
      folderId: findResult.value.id
    });
    return { ok: true, value: findResult.value.id };
  }

  // Folder doesn't exist, create it
  info('Creating new folder', {
    module: 'folder-structure',
    phase: 'find-or-create',
    folderName: name,
    parentId: rootId
  });
  const createResult = await createFolder(rootId, name);

  if (!createResult.ok) {
    logError('Error creating folder', {
      module: 'folder-structure',
      phase: 'find-or-create',
      folderName: name,
      error: createResult.error.message
    });
    return createResult;
  }

  info('Created folder successfully', {
    module: 'folder-structure',
    phase: 'find-or-create',
    folderName: name,
    folderId: createResult.value.id
  });
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
  debug('Finding or creating spreadsheet', {
    module: 'folder-structure',
    phase: 'find-or-create-spreadsheet',
    name
  });

  const findResult = await findByName(rootId, name, SPREADSHEET_MIME);

  if (!findResult.ok) {
    logError('Error searching for spreadsheet', {
      module: 'folder-structure',
      phase: 'find-or-create-spreadsheet',
      name,
      error: findResult.error.message
    });
    return findResult;
  }

  if (findResult.value) {
    debug('Spreadsheet already exists', {
      module: 'folder-structure',
      phase: 'find-or-create-spreadsheet',
      name,
      spreadsheetId: findResult.value.id
    });
    return { ok: true, value: findResult.value.id };
  }

  // Spreadsheet doesn't exist, create fresh spreadsheet
  info('Creating new fresh spreadsheet', {
    module: 'folder-structure',
    phase: 'find-or-create-spreadsheet',
    name
  });

  const createResult = await createSpreadsheet(rootId, name);

  if (!createResult.ok) {
    logError('Error creating fresh spreadsheet', {
      module: 'folder-structure',
      phase: 'find-or-create-spreadsheet',
      name,
      error: createResult.error.message
    });
    return createResult;
  }

  info('Created fresh spreadsheet successfully', {
    module: 'folder-structure',
    phase: 'find-or-create-spreadsheet',
    name,
    spreadsheetId: createResult.value.id
  });

  return { ok: true, value: createResult.value.id };
}

/**
 * Ensures required sheets exist in a spreadsheet
 * Creates missing sheets with headers and applies formatting
 * Deletes the default "Sheet1" if it exists after adding custom sheets
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
    let needsHeaders = false;

    if (existingSheets.has(config.title)) {
      // Sheet already exists, get its ID
      sheetId = existingSheets.get(config.title)!;

      // Check if the sheet has headers by reading the first row
      const firstRowResult = await getValues(spreadsheetId, `${config.title}!A1:ZZ1`);
      if (!firstRowResult.ok) {
        return firstRowResult;
      }

      // If first row is empty or doesn't match expected headers, add headers
      const firstRow = firstRowResult.value[0] || [];
      if (firstRow.length === 0 || firstRow[0] !== config.headers[0]) {
        needsHeaders = true;
      }
    } else {
      // Create the sheet
      const createResult = await createSheet(spreadsheetId, config.title);
      if (!createResult.ok) {
        return createResult;
      }
      sheetId = createResult.value;
      needsHeaders = true;
    }

    // Add header row if needed
    if (needsHeaders) {
      const setResult = await setValues(
        spreadsheetId,
        `${config.title}!A1`,
        [config.headers]
      );
      if (!setResult.ok) {
        return setResult;
      }
    }

    // Always apply formatting (bold headers, frozen rows, and monetary columns if specified)
    const formatResult = await formatSheet(spreadsheetId, sheetId, {
      monetaryColumns: config.monetaryColumns || [],
      frozenRows: 1,
    });
    if (!formatResult.ok) {
      return formatResult;
    }
  }

  // Delete the default "Sheet1" if it exists and hasn't been converted to a custom sheet
  if (existingSheets.has('Sheet1')) {
    const sheet1Id = existingSheets.get('Sheet1')!;
    const deleteResult = await deleteSheet(spreadsheetId, sheet1Id);
    if (!deleteResult.ok) {
      return deleteResult;
    }
  }

  return { ok: true, value: undefined };
}

/**
 * Initializes Dashboard Operativo Contable spreadsheet with sheets and data
 * Creates "Resumen Mensual" and "Uso de API" sheets with headers
 * Initializes "Resumen Mensual" with current month only, with IFERROR handling for empty data
 *
 * @param spreadsheetId - Dashboard Operativo Contable spreadsheet ID
 * @returns Success or error
 */
async function initializeDashboardOperativo(
  spreadsheetId: string
): Promise<Result<void, Error>> {
  // Ensure all sheets exist with headers
  const ensureSheetsResult = await ensureSheetsExist(spreadsheetId, DASHBOARD_OPERATIVO_SHEETS);
  if (!ensureSheetsResult.ok) return ensureSheetsResult;

  // Move Pagos Pendientes to first position (leftmost tab)
  const moveResult = await moveSheetToFirst(spreadsheetId, 'Pagos Pendientes');
  if (!moveResult.ok) {
    debug('Failed to move Pagos Pendientes to first position', {
      module: 'folder-structure',
      phase: 'init-dashboard',
      error: moveResult.error.message,
      spreadsheetId
    });
    // Don't fail initialization if we can't move the sheet
  }

  // Check if Resumen Mensual already has data (row 2)
  const resumanMensual = DASHBOARD_OPERATIVO_SHEETS.find(s => s.title === 'Resumen Mensual');
  if (!resumanMensual) {
    return { ok: false, error: new Error('Resumen Mensual sheet config not found') };
  }
  const existingDataResult = await getValues(spreadsheetId, `${resumanMensual.title}!A2:A2`);
  if (existingDataResult.ok && existingDataResult.value.length > 0 && existingDataResult.value[0].length > 0) {
    // Data already exists, skip initialization
    debug('Dashboard already initialized, skipping', {
      module: 'folder-structure',
      phase: 'init-dashboard',
      spreadsheetId
    });
    return { ok: true, value: undefined };
  }

  // Initialize Resumen Mensual with current month only
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed (0 = January, 11 = December)
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const monthName = monthNames[currentMonth];
  const rowNumber = 2; // Row 1 is headers, data starts at row 2
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const yearForNextMonth = currentMonth === 11 ? currentYear + 1 : currentYear;

  // Create formulas for current month only with IFERROR for "no data" handling
  const row = [
    currentYear,
    monthName,
    // totalLlamadas: Count all calls in this month
    `=IFERROR(COUNTIFS('Uso de API'!A:A, ">="&DATE(${currentYear}, ${currentMonth + 1}, 1), 'Uso de API'!A:A, "<"&DATE(${yearForNextMonth}, ${nextMonth + 1}, 1)), "no data")`,
    // tokensEntrada: Sum of prompt tokens in this month
    `=IFERROR(SUMIFS('Uso de API'!F:F, 'Uso de API'!A:A, ">="&DATE(${currentYear}, ${currentMonth + 1}, 1), 'Uso de API'!A:A, "<"&DATE(${yearForNextMonth}, ${nextMonth + 1}, 1)), "no data")`,
    // tokensSalida: Sum of output tokens in this month
    `=IFERROR(SUMIFS('Uso de API'!G:G, 'Uso de API'!A:A, ">="&DATE(${currentYear}, ${currentMonth + 1}, 1), 'Uso de API'!A:A, "<"&DATE(${yearForNextMonth}, ${nextMonth + 1}, 1)), "no data")`,
    // costoTotalUSD: Sum of costs in this month
    `=IFERROR(SUMIFS('Uso de API'!I:I, 'Uso de API'!A:A, ">="&DATE(${currentYear}, ${currentMonth + 1}, 1), 'Uso de API'!A:A, "<"&DATE(${yearForNextMonth}, ${nextMonth + 1}, 1)), "no data")`,
    // tasaExito: Success rate (successful calls / total calls)
    `=IFERROR(IF(C${rowNumber}=0, 0, COUNTIFS('Uso de API'!A:A, ">="&DATE(${currentYear}, ${currentMonth + 1}, 1), 'Uso de API'!A:A, "<"&DATE(${yearForNextMonth}, ${nextMonth + 1}, 1), 'Uso de API'!K:K, "YES") / C${rowNumber}), "no data")`,
    // duracionPromedio: Average duration in this month
    `=IFERROR(AVERAGEIFS('Uso de API'!J:J, 'Uso de API'!A:A, ">="&DATE(${currentYear}, ${currentMonth + 1}, 1), 'Uso de API'!A:A, "<"&DATE(${yearForNextMonth}, ${nextMonth + 1}, 1)), "no data")`,
  ];

  // Set values for current month
  const setResult = await setValues(
    spreadsheetId,
    `Resumen Mensual!A${rowNumber}:H${rowNumber}`,
    [row]
  );
  if (!setResult.ok) return setResult;

  return { ok: true, value: undefined };
}

/**
 * Discovers and caches the folder structure from Drive
 * Creates root-level folders and spreadsheets only
 * Year folders and classification folders are created on-demand
 *
 * @returns The folder structure or error
 */
export async function discoverFolderStructure(): Promise<Result<FolderStructure, Error>> {
  const config = getConfig();
  const rootId = config.driveRootFolderId;

  info('Starting folder structure discovery', {
    module: 'folder-structure',
    phase: 'discovery',
    rootId
  });

  // Find or create root-level folders (Entrada and Sin Procesar only)
  const entradaResult = await findOrCreateFolder(rootId, FOLDER_NAMES.entrada);
  if (!entradaResult.ok) return entradaResult;

  const sinProcesarResult = await findOrCreateFolder(rootId, FOLDER_NAMES.sinProcesar);
  if (!sinProcesarResult.ok) return sinProcesarResult;

  // Find or create control spreadsheets (at root level)
  const controlCreditosResult = await findOrCreateSpreadsheet(rootId, SPREADSHEET_NAMES.controlCreditos);
  if (!controlCreditosResult.ok) return controlCreditosResult;

  const controlDebitosResult = await findOrCreateSpreadsheet(rootId, SPREADSHEET_NAMES.controlDebitos);
  if (!controlDebitosResult.ok) return controlDebitosResult;

  // Find or create Dashboard Operativo Contable spreadsheet (at root level)
  const dashboardOperativoResult = await findOrCreateSpreadsheet(rootId, SPREADSHEET_NAMES.dashboardOperativo);
  if (!dashboardOperativoResult.ok) return dashboardOperativoResult;

  // Ensure required sheets exist in both control spreadsheets
  const ensureCreditosSheetsResult = await ensureSheetsExist(controlCreditosResult.value, CONTROL_CREDITOS_SHEETS);
  if (!ensureCreditosSheetsResult.ok) return ensureCreditosSheetsResult;

  const ensureDebitosSheetsResult = await ensureSheetsExist(controlDebitosResult.value, CONTROL_DEBITOS_SHEETS);
  if (!ensureDebitosSheetsResult.ok) return ensureDebitosSheetsResult;

  // Initialize Dashboard Operativo Contable with sheets and data
  const initializeDashboardResult = await initializeDashboardOperativo(dashboardOperativoResult.value);
  if (!initializeDashboardResult.ok) return initializeDashboardResult;

  // Discover bank spreadsheets in root folder (they can exist at root for external data)
  const bankSpreadsheetsResult = await listByMimeType(rootId, SPREADSHEET_MIME);
  if (!bankSpreadsheetsResult.ok) return bankSpreadsheetsResult;

  const bankSpreadsheets = new Map<string, string>();
  for (const sheet of bankSpreadsheetsResult.value) {
    // Skip control spreadsheets and dashboard
    if (sheet.name === SPREADSHEET_NAMES.controlCreditos ||
        sheet.name === SPREADSHEET_NAMES.controlDebitos ||
        sheet.name === SPREADSHEET_NAMES.dashboardOperativo) {
      continue;
    }
    bankSpreadsheets.set(sheet.name, sheet.id);
  }

  // Build and cache the structure
  const structure: FolderStructure = {
    rootId,
    entradaId: entradaResult.value,
    sinProcesarId: sinProcesarResult.value,
    controlCreditosId: controlCreditosResult.value,
    controlDebitosId: controlDebitosResult.value,
    dashboardOperativoId: dashboardOperativoResult.value,
    bankSpreadsheets,
    yearFolders: new Map(),
    classificationFolders: new Map(),
    monthFolders: new Map(),
    lastRefreshed: new Date(),
  };

  cachedStructure = structure;
  info('Folder structure discovery complete', {
    module: 'folder-structure',
    phase: 'discovery',
    entradaId: entradaResult.value,
    sinProcesarId: sinProcesarResult.value,
    controlCreditosId: controlCreditosResult.value,
    controlDebitosId: controlDebitosResult.value,
    dashboardOperativoId: dashboardOperativoResult.value,
    bankSpreadsheets: bankSpreadsheets.size
  });
  return { ok: true, value: structure };
}

/**
 * Ensures all classification folders exist in a year folder
 * Creates Creditos, Debitos, and Bancos folders if they don't exist
 *
 * @param yearFolderId - Year folder ID
 * @param year - Year string (e.g., "2024")
 * @returns Success or error
 */
async function ensureClassificationFolders(
  yearFolderId: string,
  year: string
): Promise<Result<void, Error>> {
  if (!cachedStructure) {
    return {
      ok: false,
      error: new Error('Folder structure not initialized.'),
    };
  }

  const classifications: Array<keyof typeof FOLDER_NAMES> = ['creditos', 'debitos', 'bancos'];

  for (const classification of classifications) {
    const cacheKey = `${year}:${classification}`;

    // Skip if already cached
    if (cachedStructure.classificationFolders.has(cacheKey)) {
      continue;
    }

    const folderName = FOLDER_NAMES[classification];

    // Try to find existing folder
    const findResult = await findByName(yearFolderId, folderName, FOLDER_MIME);
    if (!findResult.ok) return findResult;

    if (findResult.value) {
      // Cache existing folder
      cachedStructure.classificationFolders.set(cacheKey, findResult.value.id);
      debug('Found existing classification folder', {
        module: 'folder-structure',
        phase: 'classification-folders',
        folderName,
        year,
        folderId: findResult.value.id
      });
    } else {
      // Create new classification folder
      const createResult = await createFolder(yearFolderId, folderName);
      if (!createResult.ok) return createResult;

      cachedStructure.classificationFolders.set(cacheKey, createResult.value.id);
      info('Created classification folder', {
        module: 'folder-structure',
        phase: 'classification-folders',
        folderName,
        year,
        folderId: createResult.value.id
      });
    }
  }

  return { ok: true, value: undefined };
}

/**
 * Gets or creates a month folder for a destination
 * Implements year-based folder structure: {year}/{classification}/{month}/
 *
 * @param destination - Sort destination ('creditos', 'debitos', 'bancos', or 'sin_procesar')
 * @param date - Date to determine the year and month
 * @returns Folder ID for the target location
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

  // sin_procesar stays at root level (no year, no month)
  if (destination === 'sin_procesar') {
    return { ok: true, value: cachedStructure.sinProcesarId };
  }

  // Extract year from date
  const year = date.getFullYear().toString();

  // Get or create year folder
  let yearFolderId = cachedStructure.yearFolders.get(year);

  if (!yearFolderId) {
    // Try to find existing year folder
    const findYearResult = await findByName(cachedStructure.rootId, year, FOLDER_MIME);
    if (!findYearResult.ok) return findYearResult;

    if (findYearResult.value) {
      yearFolderId = findYearResult.value.id;
      cachedStructure.yearFolders.set(year, yearFolderId);
      debug('Found existing year folder', {
        module: 'folder-structure',
        phase: 'year-folder',
        year,
        folderId: yearFolderId
      });
    } else {
      // Create new year folder
      const createYearResult = await createFolder(cachedStructure.rootId, year);
      if (!createYearResult.ok) return createYearResult;

      yearFolderId = createYearResult.value.id;
      cachedStructure.yearFolders.set(year, yearFolderId);
      info('Created year folder', {
        module: 'folder-structure',
        phase: 'year-folder',
        year,
        folderId: yearFolderId
      });
    }
  }

  // Ensure all classification folders exist in this year
  const ensureResult = await ensureClassificationFolders(yearFolderId, year);
  if (!ensureResult.ok) return ensureResult;

  // Get classification folder ID
  const classificationCacheKey = `${year}:${destination}`;
  const classificationFolderId = cachedStructure.classificationFolders.get(classificationCacheKey);

  if (!classificationFolderId) {
    return {
      ok: false,
      error: new Error(`Classification folder ${destination} not found for year ${year}`),
    };
  }

  // bancos doesn't use month subfolders - return classification folder directly
  if (destination === 'bancos') {
    return { ok: true, value: classificationFolderId };
  }

  // For creditos and debitos, create/find month folder
  const monthName = formatMonthFolder(date);
  const monthCacheKey = `${year}:${destination}:${monthName}`;

  // Check cache first
  const cachedMonthId = cachedStructure.monthFolders.get(monthCacheKey);
  if (cachedMonthId) {
    return { ok: true, value: cachedMonthId };
  }

  // Try to find existing month folder
  const findMonthResult = await findByName(classificationFolderId, monthName, FOLDER_MIME);
  if (!findMonthResult.ok) return findMonthResult;

  if (findMonthResult.value) {
    // Cache and return existing folder
    cachedStructure.monthFolders.set(monthCacheKey, findMonthResult.value.id);
    debug('Found existing month folder', {
      module: 'folder-structure',
      phase: 'month-folder',
      monthName,
      year,
      destination,
      folderId: findMonthResult.value.id
    });
    return { ok: true, value: findMonthResult.value.id };
  }

  // Create new month folder
  const createMonthResult = await createFolder(classificationFolderId, monthName);
  if (!createMonthResult.ok) return createMonthResult;

  // Cache and return new folder
  cachedStructure.monthFolders.set(monthCacheKey, createMonthResult.value.id);
  info('Created month folder', {
    module: 'folder-structure',
    phase: 'month-folder',
    monthName,
    year,
    destination,
    folderId: createMonthResult.value.id
  });
  return { ok: true, value: createMonthResult.value.id };
}
