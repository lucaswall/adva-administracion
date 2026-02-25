/**
 * Schema version tracking service
 * Reads and writes .schema_version file in the Drive root folder
 * Used to gate startup migrations and avoid redundant checks
 */

import { findByName, downloadFile, createFileWithContent, updateFileContent } from './drive.js';
import type { Result } from '../types/index.js';
import { info, debug } from '../utils/logger.js';

/** Name of the schema version file in Drive root */
const SCHEMA_VERSION_FILE = '.schema_version';

/**
 * Schema version info returned by readSchemaVersion
 */
export interface SchemaVersionInfo {
  version: number;
  fileId: string | null;
}

/**
 * Reads the current schema version from the .schema_version file in Drive root
 *
 * @param rootId - Drive root folder ID
 * @returns Schema version info (version 0 if file not found)
 */
export async function readSchemaVersion(rootId: string): Promise<Result<SchemaVersionInfo, Error>> {
  const findResult = await findByName(rootId, SCHEMA_VERSION_FILE);
  if (!findResult.ok) return findResult;

  if (!findResult.value) {
    debug('Schema version file not found, treating as version 0', {
      module: 'schema-version',
      phase: 'read',
      rootId,
    });
    return { ok: true, value: { version: 0, fileId: null } };
  }

  const fileId = findResult.value.id;
  const downloadResult = await downloadFile(fileId);
  if (!downloadResult.ok) return downloadResult;

  const content = downloadResult.value.toString('utf-8').trim();
  const version = parseInt(content, 10);

  if (isNaN(version)) {
    return {
      ok: false,
      error: new Error(`Schema version file contains non-numeric content: "${content}"`),
    };
  }

  info('Read schema version', {
    module: 'schema-version',
    phase: 'read',
    version,
    fileId,
  });

  return { ok: true, value: { version, fileId } };
}

/**
 * Writes the schema version to the .schema_version file in Drive root
 * Creates the file if no existingFileId, updates it otherwise
 *
 * @param rootId - Drive root folder ID
 * @param version - Schema version number to write
 * @param existingFileId - File ID to update, or null to create new
 * @returns File ID of the written file
 */
export async function writeSchemaVersion(
  rootId: string,
  version: number,
  existingFileId: string | null
): Promise<Result<string, Error>> {
  const versionStr = String(version);

  if (existingFileId) {
    const updateResult = await updateFileContent(existingFileId, versionStr);
    if (!updateResult.ok) return updateResult;

    info('Updated schema version', {
      module: 'schema-version',
      phase: 'write',
      version,
      fileId: existingFileId,
    });

    return { ok: true, value: existingFileId };
  }

  const createResult = await createFileWithContent(rootId, SCHEMA_VERSION_FILE, versionStr);
  if (!createResult.ok) return createResult;

  info('Created schema version file', {
    module: 'schema-version',
    phase: 'write',
    version,
    fileId: createResult.value.id,
  });

  return { ok: true, value: createResult.value.id };
}
