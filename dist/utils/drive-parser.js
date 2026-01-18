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
export function extractDriveFolderId(input) {
    const trimmed = input.trim();
    if (!trimmed) {
        return '';
    }
    // Try folder URL pattern: /drive/folders/FOLDER_ID or /drive/u/N/folders/FOLDER_ID
    let match = trimmed.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9-_]+)/);
    if (match) {
        return match[1];
    }
    // Try file URL pattern: /file/d/FILE_ID or /file/u/N/d/FILE_ID
    match = trimmed.match(/\/file\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
    if (match) {
        return match[1];
    }
    // Try open URL pattern: /open?id=FILE_ID
    match = trimmed.match(/\/open\?.*id=([a-zA-Z0-9-_]+)/);
    if (match) {
        return match[1];
    }
    // Try spreadsheet URL: /spreadsheets/d/SHEET_ID or /spreadsheets/u/N/d/SHEET_ID
    match = trimmed.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
    if (match) {
        return match[1];
    }
    // Bare ID: 28-44 chars, alphanumeric + hyphens/underscores
    // Google Drive IDs are typically 28-44 characters (varies by resource type)
    if (/^[a-zA-Z0-9-_]{28,44}$/.test(trimmed)) {
        return trimmed;
    }
    // Invalid format
    return '';
}
/**
 * Validates that a string looks like a valid Drive ID
 * Does NOT verify the ID exists or is accessible (use Drive API for that)
 *
 * @param id - Potential Drive ID
 * @returns True if format is valid
 */
export function isValidDriveId(id) {
    const trimmed = id.trim();
    return /^[a-zA-Z0-9-_]{28,44}$/.test(trimmed);
}
