/**
 * Document sorting service
 * Moves processed documents to appropriate folders based on type and date
 */

import { moveFile, getParents } from './drive.js';
import { getOrCreateMonthFolder, getCachedFolderStructure } from './folder-structure.js';
import { formatMonthFolder } from '../utils/spanish-date.js';
import type { Factura, Pago, Recibo, SortDestination, SortResult } from '../types/index.js';

/** Destination folder names for path building */
const DESTINATION_NAMES: Record<SortDestination, string> = {
  creditos: 'Creditos',
  debitos: 'Debitos',
  bancos: 'Bancos',
  sin_procesar: 'Sin Procesar',
};

/**
 * Document with file info needed for sorting
 */
type SortableDocument = Factura | Pago | Recibo;

/**
 * Extracts the relevant date from a document for sorting
 */
function getDocumentDate(doc: SortableDocument): Date {
  if ('fechaEmision' in doc) {
    // Factura - use emission date
    return new Date(doc.fechaEmision);
  } else if ('fechaPago' in doc) {
    // Pago or Recibo - use payment date
    return new Date(doc.fechaPago);
  }
  // Fallback to current date
  return new Date();
}

/**
 * Builds a human-readable path for the sort result
 */
function buildTargetPath(destination: SortDestination, date?: Date): string {
  if (destination === 'sin_procesar' || destination === 'bancos') {
    return DESTINATION_NAMES[destination];
  }

  const monthFolder = date ? formatMonthFolder(date) : '';
  return `${DESTINATION_NAMES[destination]}/${monthFolder}`;
}

/**
 * Sorts a document into the appropriate folder based on destination and date
 *
 * @param doc - The document to sort (Factura, Pago, Recibo, or ResumenBancario)
 * @param destination - Target destination ('creditos', 'debitos', 'bancos', or 'sin_procesar')
 * @returns Sort result with success status and target info
 */
export async function sortDocument(
  doc: SortableDocument,
  destination: SortDestination
): Promise<SortResult> {
  const structure = getCachedFolderStructure();

  if (!structure) {
    return {
      success: false,
      error: 'Folder structure not initialized. Call discoverFolderStructure first.',
    };
  }

  // Get the file's current parent folder
  const parentsResult = await getParents(doc.fileId);
  if (!parentsResult.ok) {
    return {
      success: false,
      error: parentsResult.error.message,
    };
  }

  if (parentsResult.value.length === 0) {
    return {
      success: false,
      error: `File ${doc.fileName} has no parent folder`,
    };
  }

  const currentParentId = parentsResult.value[0];

  // Determine target folder
  let targetFolderId: string;
  const docDate = getDocumentDate(doc);

  if (destination === 'sin_procesar') {
    targetFolderId = structure.sinProcesarId;
  } else if (destination === 'bancos') {
    // Bank statements go directly to Bancos folder (no month subfolders)
    targetFolderId = structure.bancosId;
  } else {
    // Creditos and Debitos use month subfolders
    const monthFolderResult = await getOrCreateMonthFolder(destination, docDate);
    if (!monthFolderResult.ok) {
      return {
        success: false,
        error: monthFolderResult.error.message,
      };
    }
    targetFolderId = monthFolderResult.value;
  }

  // Move the file
  const moveResult = await moveFile(doc.fileId, currentParentId, targetFolderId);
  if (!moveResult.ok) {
    return {
      success: false,
      error: moveResult.error.message,
    };
  }

  const usesMonthFolder = destination !== 'sin_procesar' && destination !== 'bancos';
  return {
    success: true,
    targetFolderId,
    targetPath: buildTargetPath(destination, usesMonthFolder ? docDate : undefined),
  };
}

/**
 * Moves a file directly to Sin Procesar folder
 * Used for files that fail processing or are unrecognized
 *
 * @param fileId - Drive file ID
 * @param fileName - File name for error messages
 * @returns Sort result
 */
export async function sortToSinProcesar(
  fileId: string,
  fileName: string
): Promise<SortResult> {
  const structure = getCachedFolderStructure();

  if (!structure) {
    return {
      success: false,
      error: 'Folder structure not initialized. Call discoverFolderStructure first.',
    };
  }

  // Get the file's current parent folder
  const parentsResult = await getParents(fileId);
  if (!parentsResult.ok) {
    return {
      success: false,
      error: parentsResult.error.message,
    };
  }

  if (parentsResult.value.length === 0) {
    return {
      success: false,
      error: `File ${fileName} has no parent folder`,
    };
  }

  const currentParentId = parentsResult.value[0];

  // Move to Sin Procesar
  const moveResult = await moveFile(fileId, currentParentId, structure.sinProcesarId);
  if (!moveResult.ok) {
    return {
      success: false,
      error: moveResult.error.message,
    };
  }

  return {
    success: true,
    targetFolderId: structure.sinProcesarId,
    targetPath: 'Sin Procesar',
  };
}
