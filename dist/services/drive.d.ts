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
