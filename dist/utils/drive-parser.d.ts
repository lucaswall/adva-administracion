/**
 * Drive URL Parser Utility
 * Extracts Google Drive folder/file IDs from URLs
 */
/**
 * Extracts Google Drive folder/file ID from URL or returns bare ID
 *
 * Supports:
 * - https://drive.google.com/drive/folders/FOLDER_ID
 * - https://drive.google.com/drive/u/N/folders/FOLDER_ID (multi-account)
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/file/u/N/d/FILE_ID/view (multi-account)
 * - https://drive.google.com/open?id=FILE_ID
 * - https://docs.google.com/spreadsheets/d/SHEET_ID/edit
 * - https://docs.google.com/spreadsheets/u/N/d/SHEET_ID/edit (multi-account)
 * - Bare folder/file ID (28-44 chars, alphanumeric + hyphens/underscores)
 *
 * @param input - Drive URL or bare folder/file ID
 * @returns Extracted folder/file ID, or empty string if invalid
 */
export declare function extractDriveFolderId(input: string): string;
/**
 * Validates that a string looks like a valid Drive ID
 * Does NOT verify the ID exists or is accessible (use Drive API for that)
 *
 * @param id - Potential Drive ID
 * @returns True if format is valid
 */
export declare function isValidDriveId(id: string): boolean;
