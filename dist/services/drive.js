/**
 * Google Drive API wrapper
 * Uses googleapis library for Drive operations
 */
import { google } from 'googleapis';
import { getGoogleAuth, getDefaultScopes } from './google-auth.js';
/**
 * Drive service instance
 */
let driveService = null;
/**
 * Gets or creates the Drive service
 */
function getDriveService() {
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
export async function listFilesInFolder(folderId, folderPath = '') {
    try {
        const drive = getDriveService();
        const files = [];
        // List files in this folder
        let pageToken;
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
            for (const item of items) {
                if (!item.id || !item.name || !item.mimeType)
                    continue;
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
    }
    catch (error) {
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
export async function downloadFile(fileId) {
    try {
        const drive = getDriveService();
        const response = await drive.files.get({
            fileId,
            alt: 'media',
            supportsAllDrives: true,
        }, {
            responseType: 'arraybuffer',
        });
        const buffer = Buffer.from(response.data);
        return { ok: true, value: buffer };
    }
    catch (error) {
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
export async function getFileWithContent(fileId, name, mimeType, lastUpdated, folderPath) {
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
export async function watchFolder(folderId, webhookUrl, channelId, expirationMs = 3600000 // 1 hour default
) {
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
    }
    catch (error) {
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
export async function stopWatching(channelId, resourceId) {
    try {
        const drive = getDriveService();
        await drive.channels.stop({
            requestBody: {
                id: channelId,
                resourceId,
            },
        });
        return { ok: true, value: undefined };
    }
    catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
/**
 * Clears the cached Drive service (for testing)
 */
export function clearDriveCache() {
    driveService = null;
}
/**
 * Finds a file or folder by name within a parent folder
 *
 * @param parentId - Parent folder ID to search in
 * @param name - Name of the file/folder to find
 * @param mimeType - Optional MIME type filter
 * @returns File info if found, null if not found
 */
export async function findByName(parentId, name, mimeType) {
    try {
        const drive = getDriveService();
        const escapedName = name.replace(/'/g, "\\'");
        let query = `'${parentId}' in parents and name = '${escapedName}' and trashed = false`;
        if (mimeType) {
            query += ` and mimeType = '${mimeType}'`;
        }
        const response = await drive.files.list({
            q: query,
            fields: 'files(id, name, mimeType)',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        const files = response.data.files || [];
        if (files.length === 0) {
            return { ok: true, value: null };
        }
        const file = files[0];
        if (!file.id || !file.name || !file.mimeType) {
            return { ok: true, value: null };
        }
        return {
            ok: true,
            value: {
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
            },
        };
    }
    catch (error) {
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
export async function listByMimeType(folderId, mimeType) {
    try {
        const drive = getDriveService();
        const files = [];
        let pageToken;
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
    }
    catch (error) {
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
export async function createFolder(parentId, name) {
    try {
        const drive = getDriveService();
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
            return {
                ok: false,
                error: new Error('Failed to create folder: no ID returned'),
            };
        }
        return {
            ok: true,
            value: {
                id: file.id,
                name: file.name || name,
                mimeType: file.mimeType || 'application/vnd.google-apps.folder',
            },
        };
    }
    catch (error) {
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
export async function moveFile(fileId, fromFolderId, toFolderId) {
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
    }
    catch (error) {
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
export async function renameFile(fileId, newName) {
    try {
        const drive = getDriveService();
        await drive.files.update({
            fileId,
            requestBody: { name: newName },
            fields: 'id, name',
            supportsAllDrives: true,
        });
        return { ok: true, value: undefined };
    }
    catch (error) {
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
export async function getParents(fileId) {
    try {
        const drive = getDriveService();
        const response = await drive.files.get({
            fileId,
            fields: 'parents',
            supportsAllDrives: true,
        });
        return { ok: true, value: response.data.parents || [] };
    }
    catch (error) {
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
export async function createSpreadsheet(parentId, name) {
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
    }
    catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
