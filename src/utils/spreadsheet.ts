/**
 * Google Sheets spreadsheet utilities
 */

/**
 * Creates a Google Sheets HYPERLINK formula for a Google Drive file
 *
 * The formula will create a clickable link to the file in Google Drive.
 * Double quotes in the display text are escaped per Google Sheets formula syntax.
 *
 * @param fileId - Google Drive file ID
 * @param displayText - Text to display for the link
 * @returns Google Sheets HYPERLINK formula string
 *
 * @example
 * createDriveHyperlink('abc123', 'invoice.pdf')
 * // Returns: =HYPERLINK("https://drive.google.com/file/d/abc123/view", "invoice.pdf")
 */
export function createDriveHyperlink(fileId: string, displayText: string): string {
  // Escape double quotes in display text by doubling them (Google Sheets formula syntax)
  const escapedText = displayText.replace(/"/g, '""');

  // Build the HYPERLINK formula
  return `=HYPERLINK("https://drive.google.com/file/d/${fileId}/view", "${escapedText}")`;
}
