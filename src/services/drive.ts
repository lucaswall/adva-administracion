/**
 * Google Drive API wrapper
 * Uses googleapis library for Drive operations
 */

import { google, drive_v3 } from 'googleapis';
import { getGoogleAuth, getDefaultScopes } from './google-auth.js';
import type { FileInfo, Result } from '../types/index.js';
import { debug, info, warn, error as logError } from '../utils/logger.js';

/**
 * Drive service instance
 */
let driveService: drive_v3.Drive | null = null;

/**
 * Gets or creates the Drive service
 */
function getDriveService(): drive_v3.Drive {
  if (driveService) {
    return driveService;
  }

  const auth = getGoogleAuth(getDefaultScopes());
  driveService = google.drive({ version: 'v3', auth });

  return driveService;
}

/** Maximum recursion depth for folder traversal (prevents stack overflow) */
const MAX_FOLDER_DEPTH = 20;

/**
 * Lists PDF and image files in a folder (recursively)
 *
 * @param folderId - Google Drive folder ID
 * @param currentDepth - Current recursion depth (internal use)
 * @returns Array of file metadata
 */
export async function listFilesInFolder(
  folderId: string,
  currentDepth: number = 0
): Promise<Result<Array<Omit<FileInfo, 'content'>>, Error>> {
  // Prevent stack overflow from deeply nested or circular folder structures
  if (currentDepth >= MAX_FOLDER_DEPTH) {
    warn('Max folder depth reached, stopping recursion', {
      module: 'drive',
      phase: 'list-files',
      folderId,
      depth: currentDepth
    });
    return { ok: true, value: [] };
  }

  try {
    const drive = getDriveService();
    const files: Array<Omit<FileInfo, 'content'>> = [];

    // List files in this folder
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const items = response.data.files || [];
      debug('Query folder results', {
        module: 'drive',
        phase: 'list-files',
        folderId,
        itemCount: items.length
      });

      for (const item of items) {
        debug('Processing item', {
          module: 'drive',
          phase: 'list-files',
          itemName: item.name,
          mimeType: item.mimeType
        });

        if (!item.id || !item.name || !item.mimeType) continue;

        // Check if it's a folder - recurse into it
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          const subResult = await listFilesInFolder(item.id, currentDepth + 1);

          if (subResult.ok) {
            files.push(...subResult.value);
          }
          continue;
        }

        // Check if it's a supported file type
        const supportedTypes = [
          'application/pdf',
          'image/png',
          'image/jpeg',
          'image/jpg',
          'image/gif',
          'image/webp',
        ];

        if (supportedTypes.includes(item.mimeType)) {
          files.push({
            id: item.id,
            name: item.name,
            mimeType: item.mimeType,
            lastUpdated: item.modifiedTime ? new Date(item.modifiedTime) : new Date(),
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return { ok: true, value: files };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Downloads a file's content
 *
 * @param fileId - Google Drive file ID
 * @returns File content as Buffer
 */
export async function downloadFile(fileId: string): Promise<Result<Buffer, Error>> {
  try {
    const drive = getDriveService();

    const response = await drive.files.get(
      {
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      },
      {
        responseType: 'arraybuffer',
      }
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);
    return { ok: true, value: buffer };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Gets complete file info including content
 *
 * @param fileId - Google Drive file ID
 * @param name - File name
 * @param mimeType - MIME type
 * @param lastUpdated - Last modified date
 * @returns Complete FileInfo with content
 */
export async function getFileWithContent(
  fileId: string,
  name: string,
  mimeType: string,
  lastUpdated: Date
): Promise<Result<FileInfo, Error>> {
  const downloadResult = await downloadFile(fileId);

  if (!downloadResult.ok) {
    return downloadResult;
  }

  return {
    ok: true,
    value: {
      id: fileId,
      name,
      mimeType,
      lastUpdated,
      content: downloadResult.value,
    },
  };
}

/**
 * Sets up a push notification channel for a folder
 *
 * @param folderId - Folder to watch
 * @param webhookUrl - URL to receive notifications
 * @param channelId - Unique channel identifier
 * @param expirationMs - Channel expiration in milliseconds from now
 * @returns Channel info
 */
export async function watchFolder(
  folderId: string,
  webhookUrl: string,
  channelId: string,
  expirationMs: number = 3600000 // 1 hour default
): Promise<Result<{ resourceId: string; expiration: string }, Error>> {
  try {
    const drive = getDriveService();

    const expiration = Date.now() + expirationMs;

    const response = await drive.files.watch({
      fileId: folderId,
      supportsAllDrives: true,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        expiration: String(expiration),
      },
    });

    return {
      ok: true,
      value: {
        resourceId: response.data.resourceId || '',
        expiration: response.data.expiration || String(expiration),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Stops a push notification channel
 *
 * @param channelId - Channel to stop
 * @param resourceId - Resource ID from watch response
 */
export async function stopWatching(
  channelId: string,
  resourceId: string
): Promise<Result<void, Error>> {
  try {
    const drive = getDriveService();

    await drive.channels.stop({
      requestBody: {
        id: channelId,
        resourceId,
      },
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Clears the cached Drive service (for testing)
 */
export function clearDriveCache(): void {
  driveService = null;
}

/**
 * Basic file metadata from Drive
 */
interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Finds a file or folder by name within a parent folder
 *
 * @param parentId - Parent folder ID to search in
 * @param name - Name of the file/folder to find
 * @param mimeType - Optional MIME type filter
 * @returns File info if found, null if not found
 */
export async function findByName(
  parentId: string,
  name: string,
  mimeType?: string
): Promise<Result<DriveFileInfo | null, Error>> {
  try {
    const drive = getDriveService();
    const escapedName = name.replace(/'/g, "\\'");

    let query = `'${parentId}' in parents and name = '${escapedName}' and trashed = false`;
    if (mimeType) {
      query += ` and mimeType = '${mimeType}'`;
    }

    debug('Searching for file by name', {
      module: 'drive',
      phase: 'find-by-name',
      name,
      parentId,
      mimeType: mimeType || 'any'
    });

    // First, check for ALL matches to detect duplicates
    const checkResponse = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType)',
      pageSize: 10, // Check for up to 10 duplicates
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = checkResponse.data.files || [];
    debug('Find by name results', {
      module: 'drive',
      phase: 'find-by-name',
      name,
      resultCount: files.length
    });

    if (files.length === 0) {
      debug('No files found with name', {
        module: 'drive',
        phase: 'find-by-name',
        name
      });
      return { ok: true, value: null };
    }

    // Warn if duplicates exist
    if (files.length > 1) {
      warn('Found duplicate files with same name', {
        module: 'drive',
        phase: 'find-by-name',
        name,
        parentId,
        duplicateCount: files.length,
        duplicateIds: files.map(f => f.id),
        usingFirst: files[0].id
      });
    }

    const file = files[0];
    if (!file.id || !file.name || !file.mimeType) {
      debug('File found but missing required fields', {
        module: 'drive',
        phase: 'find-by-name',
        name
      });
      return { ok: true, value: null };
    }

    debug('Found file by name', {
      module: 'drive',
      phase: 'find-by-name',
      name,
      fileId: file.id
    });
    return {
      ok: true,
      value: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
      },
    };
  } catch (error) {
    logError('Error searching for file by name', {
      module: 'drive',
      phase: 'find-by-name',
      name,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Lists all items of a specific MIME type within a folder
 *
 * @param folderId - Folder ID to search in
 * @param mimeType - MIME type to filter by
 * @returns Array of file info
 */
export async function listByMimeType(
  folderId: string,
  mimeType: string
): Promise<Result<DriveFileInfo[], Error>> {
  try {
    const drive = getDriveService();
    const files: DriveFileInfo[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and mimeType = '${mimeType}' and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const items = response.data.files || [];

      for (const item of items) {
        if (item.id && item.name && item.mimeType) {
          files.push({
            id: item.id,
            name: item.name,
            mimeType: item.mimeType,
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return { ok: true, value: files };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Creates a new folder within a parent folder
 *
 * @param parentId - Parent folder ID
 * @param name - Name of the new folder
 * @returns Created folder info
 */
export async function createFolder(
  parentId: string,
  name: string
): Promise<Result<DriveFileInfo, Error>> {
  try {
    const drive = getDriveService();

    debug('Creating folder', {
      module: 'drive',
      phase: 'create-folder',
      name,
      parentId
    });

    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });

    const file = response.data;
    if (!file.id) {
      logError('Failed to create folder: no ID returned', {
        module: 'drive',
        phase: 'create-folder',
        name
      });
      return {
        ok: false,
        error: new Error('Failed to create folder: no ID returned'),
      };
    }

    debug('Successfully created folder', {
      module: 'drive',
      phase: 'create-folder',
      name,
      folderId: file.id
    });

    return {
      ok: true,
      value: {
        id: file.id,
        name: file.name || name,
        mimeType: file.mimeType || 'application/vnd.google-apps.folder',
      },
    };
  } catch (error) {
    logError('Error creating folder', {
      module: 'drive',
      phase: 'create-folder',
      name,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Moves a file from one folder to another
 *
 * @param fileId - File ID to move
 * @param fromFolderId - Current parent folder ID
 * @param toFolderId - Target parent folder ID
 * @returns Success or error
 */
export async function moveFile(
  fileId: string,
  fromFolderId: string,
  toFolderId: string
): Promise<Result<void, Error>> {
  try {
    const drive = getDriveService();

    await drive.files.update({
      fileId,
      addParents: toFolderId,
      removeParents: fromFolderId,
      fields: 'id, parents',
      supportsAllDrives: true,
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Renames a file in Google Drive
 *
 * @param fileId - File ID to rename
 * @param newName - New file name
 * @returns Success or error
 */
export async function renameFile(
  fileId: string,
  newName: string
): Promise<Result<void, Error>> {
  try {
    const drive = getDriveService();

    await drive.files.update({
      fileId,
      requestBody: { name: newName },
      fields: 'id, name',
      supportsAllDrives: true,
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Gets the parent folder IDs of a file
 *
 * @param fileId - File ID to get parents for
 * @returns Array of parent folder IDs
 */
export async function getParents(fileId: string): Promise<Result<string[], Error>> {
  try {
    const drive = getDriveService();

    const response = await drive.files.get({
      fileId,
      fields: 'parents',
      supportsAllDrives: true,
    });

    return { ok: true, value: response.data.parents || [] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Creates a new Google Spreadsheet within a parent folder
 *
 * @param parentId - Parent folder ID
 * @param name - Name of the new spreadsheet
 * @returns Created spreadsheet info
 */
export async function createSpreadsheet(
  parentId: string,
  name: string
): Promise<Result<DriveFileInfo, Error>> {
  try {
    const drive = getDriveService();

    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [parentId],
      },
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });

    const file = response.data;
    if (!file.id) {
      return {
        ok: false,
        error: new Error('Failed to create spreadsheet: no ID returned'),
      };
    }

    return {
      ok: true,
      value: {
        id: file.id,
        name: file.name || name,
        mimeType: file.mimeType || 'application/vnd.google-apps.spreadsheet',
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Creates a spreadsheet by copying a template (preserves embedded App Scripts)
 *
 * @param templateId - Template spreadsheet ID to copy
 * @param name - Name for the new spreadsheet
 * @param parentId - Destination folder ID
 * @returns Created spreadsheet info
 */
export async function createSpreadsheetFromTemplate(
  templateId: string,
  name: string,
  parentId: string
): Promise<Result<DriveFileInfo, Error>> {
  debug('Creating spreadsheet from template', {
    module: 'drive',
    phase: 'create-from-template',
    templateId,
    name,
    parentId,
  });

  try {
    const drive = getDriveService();

    const response = await drive.files.copy({
      fileId: templateId,
      requestBody: {
        name,
        parents: [parentId],
      },
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });

    const file = response.data;
    if (!file.id) {
      return {
        ok: false,
        error: new Error('Failed to copy template spreadsheet: no ID returned'),
      };
    }

    info('Created spreadsheet from template', {
      module: 'drive',
      phase: 'create-from-template',
      spreadsheetId: file.id,
      name: file.name,
    });

    return {
      ok: true,
      value: {
        id: file.id,
        name: file.name || name,
        mimeType: file.mimeType || 'application/vnd.google-apps.spreadsheet',
      },
    };
  } catch (error) {
    logError('Error creating spreadsheet from template', {
      module: 'drive',
      phase: 'create-from-template',
      templateId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
