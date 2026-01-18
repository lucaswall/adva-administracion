/**
 * Google Drive API wrapper
 * Uses googleapis library for Drive operations
 */

import { google, drive_v3 } from 'googleapis';
import { getGoogleAuth, getDefaultScopes } from './google-auth.js';
import type { FileInfo, Result } from '../types/index.js';

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

/**
 * Lists PDF and image files in a folder (recursively)
 *
 * @param folderId - Google Drive folder ID
 * @param folderPath - Current folder path for tracking (default: '')
 * @returns Array of file metadata
 */
export async function listFilesInFolder(
  folderId: string,
  folderPath: string = ''
): Promise<Result<Array<Omit<FileInfo, 'content'>>, Error>> {
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
      });

      const items = response.data.files || [];

      for (const item of items) {
        if (!item.id || !item.name || !item.mimeType) continue;

        // Check if it's a folder - recurse into it
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          const subPath = folderPath ? `${folderPath}/${item.name}` : item.name;
          const subResult = await listFilesInFolder(item.id, subPath);

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
            folderPath,
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
 * @param folderPath - Folder path
 * @returns Complete FileInfo with content
 */
export async function getFileWithContent(
  fileId: string,
  name: string,
  mimeType: string,
  lastUpdated: Date,
  folderPath: string
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
      folderPath,
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
