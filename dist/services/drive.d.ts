/**
 * Google Drive API wrapper
 * Uses googleapis library for Drive operations
 */
import type { FileInfo, Result } from '../types/index.js';
/**
 * Lists PDF and image files in a folder (recursively)
 *
 * @param folderId - Google Drive folder ID
 * @param folderPath - Current folder path for tracking (default: '')
 * @returns Array of file metadata
 */
export declare function listFilesInFolder(folderId: string, folderPath?: string): Promise<Result<Array<Omit<FileInfo, 'content'>>, Error>>;
/**
 * Downloads a file's content
 *
 * @param fileId - Google Drive file ID
 * @returns File content as Buffer
 */
export declare function downloadFile(fileId: string): Promise<Result<Buffer, Error>>;
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
export declare function getFileWithContent(fileId: string, name: string, mimeType: string, lastUpdated: Date, folderPath: string): Promise<Result<FileInfo, Error>>;
/**
 * Sets up a push notification channel for a folder
 *
 * @param folderId - Folder to watch
 * @param webhookUrl - URL to receive notifications
 * @param channelId - Unique channel identifier
 * @param expirationMs - Channel expiration in milliseconds from now
 * @returns Channel info
 */
export declare function watchFolder(folderId: string, webhookUrl: string, channelId: string, expirationMs?: number): Promise<Result<{
    resourceId: string;
    expiration: string;
}, Error>>;
/**
 * Stops a push notification channel
 *
 * @param channelId - Channel to stop
 * @param resourceId - Resource ID from watch response
 */
export declare function stopWatching(channelId: string, resourceId: string): Promise<Result<void, Error>>;
/**
 * Clears the cached Drive service (for testing)
 */
export declare function clearDriveCache(): void;
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
export declare function findByName(parentId: string, name: string, mimeType?: string): Promise<Result<DriveFileInfo | null, Error>>;
/**
 * Lists all items of a specific MIME type within a folder
 *
 * @param folderId - Folder ID to search in
 * @param mimeType - MIME type to filter by
 * @returns Array of file info
 */
export declare function listByMimeType(folderId: string, mimeType: string): Promise<Result<DriveFileInfo[], Error>>;
/**
 * Creates a new folder within a parent folder
 *
 * @param parentId - Parent folder ID
 * @param name - Name of the new folder
 * @returns Created folder info
 */
export declare function createFolder(parentId: string, name: string): Promise<Result<DriveFileInfo, Error>>;
/**
 * Moves a file from one folder to another
 *
 * @param fileId - File ID to move
 * @param fromFolderId - Current parent folder ID
 * @param toFolderId - Target parent folder ID
 * @returns Success or error
 */
export declare function moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<Result<void, Error>>;
/**
 * Gets the parent folder IDs of a file
 *
 * @param fileId - File ID to get parents for
 * @returns Array of parent folder IDs
 */
export declare function getParents(fileId: string): Promise<Result<string[], Error>>;
/**
 * Creates a new Google Spreadsheet within a parent folder
 *
 * @param parentId - Parent folder ID
 * @param name - Name of the new spreadsheet
 * @returns Created spreadsheet info
 */
export declare function createSpreadsheet(parentId: string, name: string): Promise<Result<DriveFileInfo, Error>>;
export {};
