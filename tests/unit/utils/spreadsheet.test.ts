/**
 * Tests for spreadsheet utilities
 */

import { describe, it, expect } from 'vitest';
import { createDriveHyperlink } from '../../../src/utils/spreadsheet.js';

describe('createDriveHyperlink', () => {
  it('should create a valid HYPERLINK formula for a Drive file', () => {
    const fileId = 'abc123def456';
    const fileName = 'invoice.pdf';

    const result = createDriveHyperlink(fileId, fileName);

    expect(result).toBe('=HYPERLINK("https://drive.google.com/file/d/abc123def456/view", "invoice.pdf")');
  });

  it('should escape double quotes in the filename', () => {
    const fileId = 'xyz789';
    const fileName = 'File with "quotes" in name.pdf';

    const result = createDriveHyperlink(fileId, fileName);

    expect(result).toBe('=HYPERLINK("https://drive.google.com/file/d/xyz789/view", "File with ""quotes"" in name.pdf")');
  });

  it('should handle filenames with special characters', () => {
    const fileId = 'test123';
    const fileName = "Invoice's & Report's.pdf";

    const result = createDriveHyperlink(fileId, fileName);

    expect(result).toBe('=HYPERLINK("https://drive.google.com/file/d/test123/view", "Invoice\'s & Report\'s.pdf")');
  });

  it('should handle empty filename', () => {
    const fileId = 'file123';
    const fileName = '';

    const result = createDriveHyperlink(fileId, fileName);

    expect(result).toBe('=HYPERLINK("https://drive.google.com/file/d/file123/view", "")');
  });

  it('should handle multiple consecutive quotes', () => {
    const fileId = 'file456';
    const fileName = 'Test""File.pdf';

    const result = createDriveHyperlink(fileId, fileName);

    expect(result).toBe('=HYPERLINK("https://drive.google.com/file/d/file456/view", "Test""""File.pdf")');
  });
});
