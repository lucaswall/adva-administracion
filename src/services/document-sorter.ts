/**
 * Document sorting service
 * Moves processed documents to appropriate folders based on type and date
 */

import { moveFile, getParents, renameFile } from './drive.js';
import { getOrCreateMonthFolder, getOrCreateBankAccountFolder, getOrCreateCreditCardFolder, getOrCreateBrokerFolder, getCachedFolderStructure } from './folder-structure.js';
import { formatMonthFolder } from '../utils/spanish-date.js';
import {
  generateFacturaFileName,
  generatePagoFileName,
  generateReciboFileName,
  generateResumenFileName,
  generateResumenTarjetaFileName,
  generateResumenBrokerFileName,
  generateRetencionFileName,
} from '../utils/file-naming.js';
import type { Factura, Pago, Recibo, ResumenBancario, ResumenTarjeta, ResumenBroker, Retencion, SortDestination, SortResult, DocumentType, Result } from '../types/index.js';

/** Destination folder names for path building */
const DESTINATION_NAMES: Record<SortDestination, string> = {
  ingresos: 'Ingresos',
  egresos: 'Egresos',
  bancos: 'Bancos',
  sin_procesar: 'Sin Procesar',
};

/**
 * Document with file info needed for sorting
 */
type SortableDocument = Factura | Pago | Recibo | ResumenBancario | ResumenTarjeta | ResumenBroker | Retencion;

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
  } else if ('fechaHasta' in doc) {
    // ResumenBancario - use end date
    return new Date(doc.fechaHasta);
  }
  // Fallback to current date
  return new Date();
}

/**
 * Builds a human-readable path for the sort result
 * Format: {year}/{classification}/{month} or {year}/{classification} for bancos
 */
function buildTargetPath(destination: SortDestination, date?: Date): string {
  if (destination === 'sin_procesar') {
    return DESTINATION_NAMES[destination];
  }

  if (!date) {
    return DESTINATION_NAMES[destination];
  }

  const year = date.getFullYear().toString();

  if (destination === 'bancos') {
    // Bancos: year/classification (no month)
    return `${year}/${DESTINATION_NAMES[destination]}`;
  }

  // Ingresos/Egresos: year/classification/month
  const monthFolder = formatMonthFolder(date);
  return `${year}/${DESTINATION_NAMES[destination]}/${monthFolder}`;
}

/**
 * Sorts a document into the appropriate folder based on destination and date
 *
 * @param doc - The document to sort (Factura, Pago, Recibo, or ResumenBancario)
 * @param destination - Target destination ('ingresos', 'egresos', 'bancos', or 'sin_procesar')
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
    // Sin Procesar stays at root level
    targetFolderId = structure.sinProcesarId;
  } else if (destination === 'bancos' && 'broker' in doc && 'numeroCuenta' in doc) {
    // ResumenBroker goes to broker-specific folder
    const resumen = doc as ResumenBroker;
    const folderResult = await getOrCreateBrokerFolder(
      docDate.getFullYear().toString(),
      resumen.broker,
      resumen.numeroCuenta
    );
    if (!folderResult.ok) {
      return {
        success: false,
        error: folderResult.error.message,
      };
    }
    targetFolderId = folderResult.value;
  } else if (destination === 'bancos' && 'tipoTarjeta' in doc && 'numeroCuenta' in doc) {
    // ResumenTarjeta goes to credit card-specific folder
    const resumen = doc as ResumenTarjeta;
    const folderResult = await getOrCreateCreditCardFolder(
      docDate.getFullYear().toString(),
      resumen.banco,
      resumen.tipoTarjeta,
      resumen.numeroCuenta
    );
    if (!folderResult.ok) {
      return {
        success: false,
        error: folderResult.error.message,
      };
    }
    targetFolderId = folderResult.value;
  } else if (destination === 'bancos' && 'banco' in doc && 'numeroCuenta' in doc && 'moneda' in doc) {
    // ResumenBancario goes to bank account-specific folder
    const resumen = doc as ResumenBancario;
    const folderResult = await getOrCreateBankAccountFolder(
      docDate.getFullYear().toString(),
      resumen.banco,
      resumen.numeroCuenta,
      resumen.moneda
    );
    if (!folderResult.ok) {
      return {
        success: false,
        error: folderResult.error.message,
      };
    }
    targetFolderId = folderResult.value;
  } else {
    // All other destinations (ingresos, egresos) use month-based structure
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

  return {
    success: true,
    targetFolderId,
    targetPath: buildTargetPath(destination, destination !== 'sin_procesar' ? docDate : undefined),
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

/**
 * Document with file info needed for sorting and renaming
 */
type SortableDocumentWithType = Factura | Pago | Recibo | ResumenBancario | ResumenTarjeta | ResumenBroker | Retencion;

/**
 * Sorts a document and renames it with a standardized name
 *
 * @param doc - The document to sort and rename
 * @param destination - Target destination ('ingresos', 'egresos', 'bancos', or 'sin_procesar')
 * @param documentType - The type of document for proper naming
 * @returns Sort result with success status and target info
 */
export async function sortAndRenameDocument(
  doc: SortableDocumentWithType,
  destination: SortDestination,
  documentType: DocumentType
): Promise<SortResult> {
  // First, sort the document (move it to the right folder)
  const sortResult = await sortDocument(doc, destination);
  if (!sortResult.success) {
    return sortResult;
  }

  // Don't rename files moved to sin_procesar - keep original name for debugging
  if (destination === 'sin_procesar') {
    return sortResult;
  }

  // Generate the new file name based on document type
  let newFileName: string;
  switch (documentType) {
    case 'factura_emitida':
      newFileName = generateFacturaFileName(doc as Factura, 'factura_emitida');
      break;
    case 'factura_recibida':
      newFileName = generateFacturaFileName(doc as Factura, 'factura_recibida');
      break;
    case 'pago_enviado':
      newFileName = generatePagoFileName(doc as Pago, 'pago_enviado');
      break;
    case 'pago_recibido':
      newFileName = generatePagoFileName(doc as Pago, 'pago_recibido');
      break;
    case 'recibo':
      newFileName = generateReciboFileName(doc as Recibo);
      break;
    case 'resumen_bancario':
      newFileName = generateResumenFileName(doc as ResumenBancario);
      break;
    case 'resumen_tarjeta':
      newFileName = generateResumenTarjetaFileName(doc as ResumenTarjeta);
      break;
    case 'resumen_broker':
      newFileName = generateResumenBrokerFileName(doc as ResumenBroker);
      break;
    case 'certificado_retencion':
      newFileName = generateRetencionFileName(doc as Retencion);
      break;
    default:
      // For unrecognized or unknown types, keep the original name
      return sortResult;
  }

  // Rename the file
  const renameResult = await renameFile(doc.fileId, newFileName);
  if (!renameResult.ok) {
    return {
      success: false,
      error: renameResult.error.message,
    };
  }

  return sortResult;
}

/**
 * Moves a duplicate file to the Duplicado folder
 * Used when a file is detected as a duplicate during storage
 *
 * @param fileId - Drive file ID
 * @param fileName - File name for error messages
 * @returns Result with success status
 */
export async function moveToDuplicadoFolder(
  fileId: string,
  fileName: string
): Promise<Result<SortResult, Error>> {
  const structure = getCachedFolderStructure();

  if (!structure) {
    return {
      ok: false,
      error: new Error('Folder structure not initialized. Call discoverFolderStructure first.'),
    };
  }

  if (!structure.duplicadoId) {
    return {
      ok: false,
      error: new Error('Duplicado folder not found in folder structure'),
    };
  }

  // Get the file's current parent folder
  const parentsResult = await getParents(fileId);
  if (!parentsResult.ok) {
    return {
      ok: false,
      error: parentsResult.error,
    };
  }

  if (parentsResult.value.length === 0) {
    return {
      ok: false,
      error: new Error(`File ${fileName} has no parent folder`),
    };
  }

  const currentParentId = parentsResult.value[0];

  // Move to Duplicado folder
  const moveResult = await moveFile(fileId, currentParentId, structure.duplicadoId);
  if (!moveResult.ok) {
    return {
      ok: false,
      error: moveResult.error,
    };
  }

  return {
    ok: true,
    value: {
      success: true,
      targetFolderId: structure.duplicadoId,
      targetPath: 'Duplicado',
    },
  };
}
