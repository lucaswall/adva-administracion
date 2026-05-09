/**
 * Google Drive API wrapper
 * Uses googleapis library for Drive operations
 */

import { google, drive_v3 } from 'googleapis';
import { getGoogleAuthAsync, getDefaultScopes } from './google-auth.js';
import type { FileInfo, Result } from '../types/index.js';
import { debug, warn, error as logError } from '../utils/logger.js';
import { withQuotaRetry } from '../utils/concurrency.js';

/**
 * Slow-call threshold: warn if a Drive API call exceeds this duration.
 */
const SLOW_CALL_THRESHOLD_MS = 5_000;

/**
 * Wraps an async operation with debug-level duration logging.
 * Emits a WARN if the operation exceeds SLOW_CALL_THRESHOLD_MS.
 */
async function withTiming<T>(apiName: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    debug(apiName, { module: 'drive', phase: 'api-call', durationMs });
    if (durationMs > SLOW_CALL_THRESHOLD_MS) {
      warn(apiName, { module: 'drive', phase: 'api-call', slow: true, durationMs });
    }
    return result;
  } catch (e) {
    const durationMs = Date.now() - start;
    debug(apiName, { module: 'drive', phase: 'api-call', durationMs, failed: true });
    if (durationMs > SLOW_CALL_THRESHOLD_MS) {
      warn(apiName, { module: 'drive', phase: 'api-call', slow: true, durationMs });
    }
    throw e;
  }
}

/**
 * Drive service instance
 */
let driveService: drive_v3.Drive | null = null;

/**
 * Maximum folder depth for recursive listing
 * Prevents runaway recursion in deeply nested or circular folder structures
 */
const MAX_FOLDER_DEPTH = 20;

/**
 * Gets or creates the Drive service
 */
async function getDriveService(): Promise<drive_v3.Drive> {
  if (driveService) {
    return driveService;
  }

  const auth = await getGoogleAuthAsync(getDefaultScopes());
  driveService = google.drive({ version: 'v3', auth });

  return driveService;
}

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
  // Check depth limit to prevent infinite recursion
  if (currentDepth >= MAX_FOLDER_DEPTH) {
    warn('Maximum folder depth reached, skipping further recursion', {
      module: 'drive',
      phase: 'list-files',
      folderId,
      depth: currentDepth,
      maxDepth: MAX_FOLDER_DEPTH
    });
    return { ok: true, value: [] };
  }

  try {
    const drive = await getDriveService();
    const files: Array<Omit<FileInfo, 'content'>> = [];

    // List files in this folder
    let pageToken: string | undefined;

    do {
      const listResult = await withQuotaRetry(async () =>
        drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
          pageSize: 100,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        })
      );

      if (!listResult.ok) {
        return listResult;
      }
      const response = listResult.value;
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
          } else {
            warn('Failed to list subfolder contents', {
              module: 'drive',
              phase: 'list-files',
              folderId: item.id,
              folderName: item.name,
              error: subResult.error.message,
            });
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
  return withTiming('downloadFile', async () => {
    try {
      const drive = await getDriveService();

      const getResult = await withQuotaRetry(async () =>
        drive.files.get(
          {
            fileId,
            alt: 'media',
            supportsAllDrives: true,
          },
          {
            responseType: 'arraybuffer',
          }
        )
      );

      if (!getResult.ok) {
        return getResult;
      }

      const buffer = Buffer.from(getResult.value.data as ArrayBuffer);
      return { ok: true, value: buffer };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  });
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
  return withTiming('watchFolder', async () => {
    try {
      const drive = await getDriveService();

      const expiration = Date.now() + expirationMs;

      const watchResult = await withQuotaRetry(async () =>
        drive.files.watch({
          fileId: folderId,
          supportsAllDrives: true,
          requestBody: {
            id: channelId,
            type: 'web_hook',
            address: webhookUrl,
            expiration: String(expiration),
          },
        })
      );

      if (!watchResult.ok) {
        return watchResult;
      }

      return {
        ok: true,
        value: {
          resourceId: watchResult.value.data.resourceId || '',
          expiration: watchResult.value.data.expiration || String(expiration),
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  });
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
  return withTiming('stopWatching', async () => {
    try {
      const drive = await getDriveService();

      const stopResult = await withQuotaRetry(async () =>
        drive.channels.stop({
          requestBody: {
            id: channelId,
            resourceId,
          },
        })
      );

      if (!stopResult.ok) {
        return stopResult;
      }

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  });
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
  return withTiming('findByName', async () => {
  try {
    const drive = await getDriveService();
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
    const listResult = await withQuotaRetry(async () =>
      drive.files.list({
        q: query,
        fields: 'files(id, name, mimeType)',
        pageSize: 10, // Check for up to 10 duplicates
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
    );

    if (!listResult.ok) {
      return listResult;
    }

    const files = listResult.value.data.files || [];
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
  });
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
  return withTiming('listByMimeType', async () => {
    try {
      const drive = await getDriveService();
      const files: DriveFileInfo[] = [];
      let pageToken: string | undefined;

      do {
        const listResult = await withQuotaRetry(async () =>
          drive.files.list({
            q: `'${folderId}' in parents and mimeType = '${mimeType}' and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 100,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          })
        );

        if (!listResult.ok) {
          return listResult;
        }

        const items = listResult.value.data.files || [];

        for (const item of items) {
          if (item.id && item.name && item.mimeType) {
            files.push({
              id: item.id,
              name: item.name,
              mimeType: item.mimeType,
            });
          }
        }

        pageToken = listResult.value.data.nextPageToken || undefined;
      } while (pageToken);

      return { ok: true, value: files };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  });
}

/**
 * Lists all direct children of a folder regardless of MIME type. Non-recursive:
 * subfolders are returned but not descended into. Use this when the folder is
 * "operation-owned" and every direct child should be enumerated for cleanup.
 *
 * @param folderId - Folder to list
 * @returns Array of file info (any MIME, including subfolders)
 */
export async function listAllChildren(
  folderId: string
): Promise<Result<DriveFileInfo[], Error>> {
  return withTiming('listAllChildren', async () => {
    try {
      const drive = await getDriveService();
      const files: DriveFileInfo[] = [];
      let pageToken: string | undefined;

      do {
        const listResult = await withQuotaRetry(async () =>
          drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 100,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          })
        );

        if (!listResult.ok) {
          return listResult;
        }

        const items = listResult.value.data.files || [];
        for (const item of items) {
          if (item.id && item.name && item.mimeType) {
            files.push({
              id: item.id,
              name: item.name,
              mimeType: item.mimeType,
            });
          }
        }

        pageToken = listResult.value.data.nextPageToken || undefined;
      } while (pageToken);

      return { ok: true, value: files };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  });
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
  return withTiming('createFolder', async () => {
  try {
    const drive = await getDriveService();

    debug('Creating folder', {
      module: 'drive',
      phase: 'create-folder',
      name,
      parentId
    });

    const createResult = await withQuotaRetry(async () =>
      drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      })
    );

    if (!createResult.ok) {
      return createResult;
    }

    const file = createResult.value.data;
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
  });
}

/**
 * Creates an empty plain-text file in a parent folder
 * Used for marker files such as .staging and .production
 *
 * @param parentId - Parent folder ID
 * @param name - File name
 * @returns Created file info
 */
export async function createFile(
  parentId: string,
  name: string
): Promise<Result<DriveFileInfo, Error>> {
  return withTiming('createFile', async () => {
  try {
    const drive = await getDriveService();

    debug('Creating file', {
      module: 'drive',
      phase: 'create-file',
      name,
      parentId
    });

    const createResult = await withQuotaRetry(async () =>
      drive.files.create({
        requestBody: {
          name,
          mimeType: 'text/plain',
          parents: [parentId],
        },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      })
    );

    if (!createResult.ok) {
      return createResult;
    }

    const file = createResult.value.data;
    if (!file.id) {
      return {
        ok: false,
        error: new Error(`Failed to create file "${name}": no ID returned`),
      };
    }

    debug('Successfully created file', {
      module: 'drive',
      phase: 'create-file',
      name,
      fileId: file.id
    });

    return {
      ok: true,
      value: {
        id: file.id,
        name: file.name || name,
        mimeType: file.mimeType || 'text/plain',
      },
    };
  } catch (error) {
    logError('Error creating file', {
      module: 'drive',
      phase: 'create-file',
      name,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  });
}

/**
 * Creates a plain-text file with content in a parent folder
 * Extends createFile pattern by including media body with content
 *
 * @param parentId - Parent folder ID
 * @param name - File name
 * @param content - Text content to write
 * @returns Created file info
 */
export async function createFileWithContent(
  parentId: string,
  name: string,
  content: string
): Promise<Result<DriveFileInfo, Error>> {
  return withTiming('createFileWithContent', async () => {
  try {
    const drive = await getDriveService();

    debug('Creating file with content', {
      module: 'drive',
      phase: 'create-file',
      name,
      parentId
    });

    const createResult = await withQuotaRetry(async () =>
      drive.files.create({
        requestBody: {
          name,
          mimeType: 'text/plain',
          parents: [parentId],
        },
        media: {
          mimeType: 'text/plain',
          body: content,
        },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      })
    );

    if (!createResult.ok) {
      return createResult;
    }

    const file = createResult.value.data;
    if (!file.id) {
      return {
        ok: false,
        error: new Error(`Failed to create file "${name}": no ID returned`),
      };
    }

    debug('Successfully created file with content', {
      module: 'drive',
      phase: 'create-file',
      name,
      fileId: file.id
    });

    return {
      ok: true,
      value: {
        id: file.id,
        name: file.name || name,
        mimeType: file.mimeType || 'text/plain',
      },
    };
  } catch (error) {
    logError('Error creating file with content', {
      module: 'drive',
      phase: 'create-file',
      name,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  });
}

/**
 * Updates an existing file's content
 *
 * @param fileId - File ID to update
 * @param content - New text content
 * @returns Success or error
 */
export async function updateFileContent(
  fileId: string,
  content: string
): Promise<Result<void, Error>> {
  return withTiming('updateFileContent', async () => {
  try {
    const drive = await getDriveService();

    debug('Updating file content', {
      module: 'drive',
      phase: 'update-file',
      fileId
    });

    const updateResult = await withQuotaRetry(async () =>
      drive.files.update({
        fileId,
        media: {
          mimeType: 'text/plain',
          body: content,
        },
        fields: 'id',
        supportsAllDrives: true,
      })
    );

    if (!updateResult.ok) {
      return updateResult;
    }

    return { ok: true, value: undefined };
  } catch (error) {
    logError('Error updating file content', {
      module: 'drive',
      phase: 'update-file',
      fileId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  });
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
  return withTiming('moveFile', async () => {
  try {
    const drive = await getDriveService();

    const updateResult = await withQuotaRetry(async () =>
      drive.files.update({
        fileId,
        addParents: toFolderId,
        removeParents: fromFolderId,
        fields: 'id, parents',
        supportsAllDrives: true,
      })
    );

    if (!updateResult.ok) {
      return updateResult;
    }

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  });
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
  return withTiming('renameFile', async () => {
  try {
    const drive = await getDriveService();

    const updateResult = await withQuotaRetry(async () =>
      drive.files.update({
        fileId,
        requestBody: { name: newName },
        fields: 'id, name',
        supportsAllDrives: true,
      })
    );

    if (!updateResult.ok) {
      return updateResult;
    }

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  });
}

/**
 * Gets the parent folder IDs of a file
 *
 * @param fileId - File ID to get parents for
 * @param signal - Optional AbortSignal to cancel cooperative retries (ADV-224).
 *                 Forwarded to `withQuotaRetry` so an aborted caller does not
 *                 inflate the global quota throttle or leak retry timers.
 * @returns Array of parent folder IDs
 */
export async function getParents(fileId: string, signal?: AbortSignal): Promise<Result<string[], Error>> {
  return withTiming('getParents', async () => {
  try {
    const drive = await getDriveService();

    const getResult = await withQuotaRetry(
      async () =>
        drive.files.get({
          fileId,
          fields: 'parents',
          supportsAllDrives: true,
        }),
      undefined,
      undefined,
      signal,
    );

    if (!getResult.ok) {
      return getResult;
    }

    return { ok: true, value: getResult.value.data.parents || [] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  });
}

/**
 * Maximum depth for ancestor traversal in isDescendantOf.
 * Matches `MAX_FOLDER_DEPTH` (20) so the ancestry check accepts every folder
 * the scanner is willing to recurse into. A previous tighter limit (8) caused
 * legitimate deeply-nested folders to be denied with HTTP 403 even when they
 * were inside the configured root (Codex review on PR 112).
 */
const MAX_ANCESTOR_DEPTH = 20;

/**
 * Overall deadline for isDescendantOf. Each per-hop Drive call is wrapped in
 * withQuotaRetry (up to 5 attempts, 65s max delay), so the worst-case 8-hop
 * traversal could otherwise hold the request handler open for tens of minutes
 * under sustained quota throttling. ADV-219.
 */
const ISDESCENDANT_DEADLINE_MS = 10_000;

/**
 * Checks whether a folder is a descendant of (contained within) a given ancestor.
 *
 * Walks up the parent chain using files.get, up to MAX_ANCESTOR_DEPTH levels.
 * Enforces an overall ISDESCENDANT_DEADLINE_MS budget so a hanging Drive backend
 * cannot stall the caller.
 *
 * @param folderId - Folder to check
 * @param ancestorId - Expected ancestor folder ID
 * @returns Result with `ok: true, value: boolean` (true = descendant, false = not).
 *          On Drive API failure or deadline exceedance returns `ok: false, error`
 *          so the caller can distinguish "not a descendant" (403) from
 *          "couldn't determine" (5xx).
 */
export async function isDescendantOf(folderId: string, ancestorId: string): Promise<Result<boolean, Error>> {
  // A folder is trivially a "descendant" of itself (covers the root folder case)
  if (folderId === ancestorId) {
    return { ok: true, value: true };
  }

  // Cooperative cancellation: when the deadline fires, abort the controller
  // so any abandoned `traverse()` exits at its next `withQuotaRetry` checkpoint
  // instead of inflating global quota backoff or leaking retry timers (ADV-224).
  const controller = new AbortController();

  const traverse = async (): Promise<Result<boolean, Error>> => {
    const visited = new Set<string>();
    let currentId = folderId;

    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
      if (visited.has(currentId)) {
        // Cycle detected — treat as not-a-descendant (we walked all reachable ancestors)
        return { ok: true, value: false };
      }
      visited.add(currentId);

      const result = await getParents(currentId, controller.signal);
      if (!result.ok) {
        // Drive API error — propagate so caller can distinguish from "not a descendant"
        return { ok: false, error: result.error };
      }

      const parents = result.value;
      if (parents.length === 0) {
        // Reached the root without finding ancestorId
        return { ok: true, value: false };
      }

      if (parents.includes(ancestorId)) {
        return { ok: true, value: true };
      }

      // Traverse the first parent (Drive items typically have one parent)
      currentId = parents[0];
    }

    // Depth limit reached without finding ancestor — log so operators can distinguish
    // this case from a genuinely unauthorised folder (both currently surface as 403).
    // ADV-220. `currentId` records the deepest ancestor reached, which is the only
    // diagnostic info that varies between calls (depthLimit is always MAX_ANCESTOR_DEPTH).
    warn('Descendant check exhausted depth limit', {
      module: 'drive',
      phase: 'descendant-check',
      folderId,
      currentId,
      ancestorId,
      depthLimit: MAX_ANCESTOR_DEPTH,
    });
    return { ok: true, value: false };
  };

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<boolean, Error>>(resolve => {
    timeoutId = setTimeout(() => {
      // Abort BEFORE resolving so an abandoned traverse() sees the abort flag
      // when its next withQuotaRetry checkpoint runs (ADV-224).
      controller.abort('isDescendantOf deadline exceeded');
      resolve({
        ok: false,
        error: new Error(`isDescendantOf deadline exceeded after ${ISDESCENDANT_DEADLINE_MS}ms`),
      });
    }, ISDESCENDANT_DEADLINE_MS);
  });

  try {
    return await Promise.race([traverse(), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
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
  return withTiming('createSpreadsheet', async () => {
  try {
    const drive = await getDriveService();

    const createResult = await withQuotaRetry(async () =>
      drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [parentId],
        },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      })
    );

    if (!createResult.ok) {
      return createResult;
    }

    const file = createResult.value.data;
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
  });
}

/**
 * Copies a file to a target folder
 *
 * @param fileId - ID of the file to copy
 * @param parentFolderId - Destination folder ID
 * @param name - Optional new name for the copy (keeps original name if omitted)
 * @returns Copied file info
 */
export async function copyFile(
  fileId: string,
  parentFolderId: string,
  name?: string
): Promise<Result<DriveFileInfo, Error>> {
  return withTiming('copyFile', async () => {
  try {
    const drive = await getDriveService();

    const requestBody: { parents: string[]; name?: string } = {
      parents: [parentFolderId],
    };
    if (name !== undefined) requestBody.name = name;

    const copyResult = await withQuotaRetry(async () =>
      drive.files.copy({
        fileId,
        requestBody,
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      })
    );

    if (!copyResult.ok) {
      return copyResult;
    }

    const file = copyResult.value.data;
    if (!file.id || !file.name) {
      return {
        ok: false,
        error: new Error('No file ID or name in copy response'),
      };
    }

    debug('File copied', {
      module: 'drive',
      phase: 'copy-file',
      fileId,
      copiedId: file.id,
    });

    return {
      ok: true,
      value: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType || 'application/pdf',
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  });
}

/**
 * Deletes a file by ID (permanently, bypasses trash)
 *
 * @param fileId - ID of the file to delete
 * @returns Success or error
 */
export async function deleteFileById(
  fileId: string
): Promise<Result<void, Error>> {
  return withTiming('deleteFileById', async () => {
  try {
    const drive = await getDriveService();

    const deleteResult = await withQuotaRetry(async () =>
      drive.files.delete({
        fileId,
        supportsAllDrives: true,
      })
    );

    if (!deleteResult.ok) {
      return deleteResult;
    }

    debug('File deleted', {
      module: 'drive',
      phase: 'delete-file',
      fileId,
    });

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  });
}
