/**
 * Google Sheets spreadsheet utilities
 */

/**
 * Sanitizes user input to prevent CSV/spreadsheet formula injection
 *
 * Prevents malicious formulas from executing by prefixing dangerous strings
 * with a single quote ('), which tells spreadsheet applications to treat the
 * content as text rather than a formula.
 *
 * Dangerous patterns:
 * - Strings starting with =, +, -, @ (formula characters)
 * - Strings with leading whitespace (space, tab, newline) followed by formula chars
 *
 * Based on OWASP recommendations for CSV injection prevention:
 * https://owasp.org/www-community/attacks/CSV_Injection
 *
 * @param value - String value to sanitize
 * @returns Sanitized string safe for spreadsheet insertion
 *
 * @example
 * sanitizeForSpreadsheet('=SUM(A1:A10)') // Returns: '=SUM(A1:A10)
 * sanitizeForSpreadsheet('Normal text')  // Returns: Normal text
 */
export function sanitizeForSpreadsheet(value: string): string {
  if (!value) {
    return value;
  }

  // Check if string starts with dangerous formula characters
  // or has leading whitespace followed by formula characters
  const dangerousPattern = /^[\s\t\r\n]*[=+\-@]/;

  if (dangerousPattern.test(value)) {
    // Prefix with single quote to treat as text
    return `'${value}`;
  }

  return value;
}

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
