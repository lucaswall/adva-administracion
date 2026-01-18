/**
 * Unit tests for Drive URL parser utility
 * Tests Drive folder/file ID extraction
 */

import { describe, it, expect } from 'vitest';
import { extractDriveFolderId, isValidDriveId } from '../../../src/utils/drive-parser';

describe('Drive URL Parser', () => {
  describe('extractDriveFolderId', () => {
    describe('folder URLs', () => {
      it('extracts ID from standard folder URL', () => {
        const url = 'https://drive.google.com/drive/folders/abc123xyz456789abc123xyz456789abc';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789abc123xyz456789abc');
      });

      it('extracts ID from folder URL with query parameters', () => {
        const url = 'https://drive.google.com/drive/folders/abc123xyz456789?usp=sharing';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });

      it('extracts ID from folder URL with multiple query parameters', () => {
        const url = 'https://drive.google.com/drive/folders/abc123xyz456789?usp=sharing&resourcekey=0-abc';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });

      it('extracts ID from folder URL with trailing slash', () => {
        const url = 'https://drive.google.com/drive/folders/abc123xyz456789/';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });

      it('handles http URLs (non-https)', () => {
        const url = 'http://drive.google.com/drive/folders/abc123xyz456789';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });
    });

    describe('spreadsheet URLs', () => {
      it('extracts ID from spreadsheet edit URL', () => {
        const url = 'https://docs.google.com/spreadsheets/d/sheet123abc456xyz789/edit';
        expect(extractDriveFolderId(url)).toBe('sheet123abc456xyz789');
      });

      it('extracts ID from spreadsheet URL with query parameters', () => {
        const url = 'https://docs.google.com/spreadsheets/d/sheet123abc456xyz789/edit?usp=sharing';
        expect(extractDriveFolderId(url)).toBe('sheet123abc456xyz789');
      });

      it('extracts ID from spreadsheet URL with hash', () => {
        const url = 'https://docs.google.com/spreadsheets/d/sheet123abc456xyz789/edit#gid=0';
        expect(extractDriveFolderId(url)).toBe('sheet123abc456xyz789');
      });

      it('extracts ID from spreadsheet URL without edit path', () => {
        const url = 'https://docs.google.com/spreadsheets/d/sheet123abc456xyz789';
        expect(extractDriveFolderId(url)).toBe('sheet123abc456xyz789');
      });

      it('extracts ID from spreadsheet URL with account selector', () => {
        const url = 'https://docs.google.com/spreadsheets/u/3/d/sheet123abc456xyz789/edit';
        expect(extractDriveFolderId(url)).toBe('sheet123abc456xyz789');
      });

      it('extracts ID from spreadsheet URL with u/0', () => {
        const url = 'https://docs.google.com/spreadsheets/u/0/d/sheet123abc456xyz789/edit';
        expect(extractDriveFolderId(url)).toBe('sheet123abc456xyz789');
      });
    });

    describe('file URLs', () => {
      it('extracts ID from file view URL', () => {
        const url = 'https://drive.google.com/file/d/file123abc456xyz789/view';
        expect(extractDriveFolderId(url)).toBe('file123abc456xyz789');
      });

      it('extracts ID from file URL with account selector', () => {
        const url = 'https://drive.google.com/file/u/3/d/file123abc456xyz789/view';
        expect(extractDriveFolderId(url)).toBe('file123abc456xyz789');
      });

      it('extracts ID from file URL with u/0', () => {
        const url = 'https://drive.google.com/file/u/0/d/file123abc456xyz789/view';
        expect(extractDriveFolderId(url)).toBe('file123abc456xyz789');
      });

      it('extracts ID from file preview URL', () => {
        const url = 'https://drive.google.com/file/d/file123abc456xyz789/preview';
        expect(extractDriveFolderId(url)).toBe('file123abc456xyz789');
      });

      it('extracts ID from open URL with id parameter', () => {
        const url = 'https://drive.google.com/open?id=file123abc456xyz789';
        expect(extractDriveFolderId(url)).toBe('file123abc456xyz789');
      });

      it('extracts ID from open URL with multiple parameters', () => {
        const url = 'https://drive.google.com/open?id=file123abc456xyz789&usp=sharing';
        expect(extractDriveFolderId(url)).toBe('file123abc456xyz789');
      });
    });

    describe('bare IDs', () => {
      it('returns bare ID if already formatted (28-44 chars)', () => {
        const id = 'abc123xyz456789abc123xyz456789abc';
        expect(extractDriveFolderId(id)).toBe(id);
      });

      it('accepts bare ID with hyphens', () => {
        const id = 'abc-123-xyz-456-789-abc-123-xyz456';
        expect(extractDriveFolderId(id)).toBe(id);
      });

      it('accepts bare ID with underscores', () => {
        const id = 'abc_123_xyz_456_789_abc_123_xyz456';
        expect(extractDriveFolderId(id)).toBe(id);
      });

      it('accepts longer bare IDs (up to 44 chars)', () => {
        const id = 'abc123xyz456789abc123xyz456789abc12345678901';
        expect(extractDriveFolderId(id)).toBe(id);
      });
    });

    describe('whitespace handling', () => {
      it('trims leading whitespace', () => {
        const url = '   https://drive.google.com/drive/folders/abc123xyz456789';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });

      it('trims trailing whitespace', () => {
        const url = 'https://drive.google.com/drive/folders/abc123xyz456789   ';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });

      it('trims whitespace from bare ID', () => {
        const id = '  abc123xyz456789abc123xyz456789abc  ';
        expect(extractDriveFolderId(id)).toBe('abc123xyz456789abc123xyz456789abc');
      });

      it('handles tabs and newlines', () => {
        const id = '\t\nabc123xyz456789abc123xyz456789abc\n\t';
        expect(extractDriveFolderId(id)).toBe('abc123xyz456789abc123xyz456789abc');
      });
    });

    describe('invalid formats', () => {
      it('returns empty string for too short ID', () => {
        expect(extractDriveFolderId('abc123')).toBe('');
      });

      it('returns empty string for invalid URL', () => {
        expect(extractDriveFolderId('http://example.com')).toBe('');
      });

      it('returns empty string for invalid Drive URL path', () => {
        expect(extractDriveFolderId('https://drive.google.com/invalid/path')).toBe('');
      });

      it('returns empty string for empty input', () => {
        expect(extractDriveFolderId('')).toBe('');
      });

      it('returns empty string for whitespace-only input', () => {
        expect(extractDriveFolderId('   ')).toBe('');
      });

      it('returns empty string for URL without ID', () => {
        expect(extractDriveFolderId('https://drive.google.com/drive/folders/')).toBe('');
      });

      it('returns empty string for ID with invalid characters', () => {
        expect(extractDriveFolderId('abc@123#xyz$456')).toBe('');
      });
    });

    describe('edge cases', () => {
      it('handles very long URLs', () => {
        const url = 'https://drive.google.com/drive/folders/abc123xyz456789?' +
          'usp=sharing&' +
          'resourcekey=0-abc123xyz&' +
          'extra_param=very_long_value_with_many_characters_that_goes_on_and_on';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });

      it('prefers folder URL pattern over bare ID', () => {
        // If input looks like URL, extract from URL
        const url = 'https://drive.google.com/drive/folders/short123';
        expect(extractDriveFolderId(url)).toBe('short123');
      });

      it('handles mixed case in domain', () => {
        const url = 'https://Drive.Google.Com/drive/folders/abc123xyz456789';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });

      it('handles URL-encoded characters in query params', () => {
        const url = 'https://drive.google.com/drive/folders/abc123xyz456789?name=My%20Folder';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789');
      });
    });

    describe('real-world examples', () => {
      it('extracts from typical shared folder link', () => {
        const url = 'https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p?usp=sharing';
        expect(extractDriveFolderId(url)).toBe('1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p');
      });

      it('extracts from shared spreadsheet link', () => {
        const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit?usp=sharing';
        expect(extractDriveFolderId(url)).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890');
      });

      it('handles folder ID copied from browser address bar', () => {
        const id = '1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p';
        expect(extractDriveFolderId(id)).toBe(id);
      });

      it('extracts from URL with account selector (/u/N/)', () => {
        const url = 'https://drive.google.com/drive/u/3/folders/1MCkbfudtDeAQRtpo6vyqmiWqlXtS7NR5';
        expect(extractDriveFolderId(url)).toBe('1MCkbfudtDeAQRtpo6vyqmiWqlXtS7NR5');
      });

      it('extracts from URL with account selector u/0', () => {
        const url = 'https://drive.google.com/drive/u/0/folders/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p';
        expect(extractDriveFolderId(url)).toBe('1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p');
      });

      it('extracts from URL with multi-digit account selector', () => {
        const url = 'https://drive.google.com/drive/u/12/folders/abc123xyz456789abc123xyz456789abc';
        expect(extractDriveFolderId(url)).toBe('abc123xyz456789abc123xyz456789abc');
      });
    });
  });

  describe('isValidDriveId', () => {
    it('returns true for valid ID (28 chars)', () => {
      expect(isValidDriveId('abc123xyz456789abc123xyz4567')).toBe(true);
    });

    it('returns true for valid ID (44 chars)', () => {
      // Exactly 44 characters
      expect(isValidDriveId('abc123xyz456789abc123xyz456789abc12345678901')).toBe(true);
    });

    it('returns true for ID with hyphens', () => {
      expect(isValidDriveId('abc-123-xyz-456-789-abc-123-xyz')).toBe(true);
    });

    it('returns true for ID with underscores', () => {
      expect(isValidDriveId('abc_123_xyz_456_789_abc_123_xyz')).toBe(true);
    });

    it('returns false for too short ID', () => {
      expect(isValidDriveId('abc123')).toBe(false);
    });

    it('returns false for too long ID', () => {
      expect(isValidDriveId('a'.repeat(50))).toBe(false);
    });

    it('returns false for ID with invalid characters', () => {
      expect(isValidDriveId('abc@123#xyz$456%789&abc*123')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidDriveId('')).toBe(false);
    });

    it('handles whitespace', () => {
      expect(isValidDriveId('  abc123xyz456789abc123xyz4567  ')).toBe(true);
    });
  });
});
