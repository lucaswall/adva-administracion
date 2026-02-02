/**
 * Unit tests for Google Drive service
 * Tests the folder operations added in Phase 1.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { google } from 'googleapis';

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({
      files: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        copy: vi.fn(),
      },
    })),
  },
}));

// Mock google-auth
vi.mock('./google-auth.js', () => ({
  getGoogleAuthAsync: vi.fn(async () => ({})),
  getDefaultScopes: vi.fn(() => []),
}));

// Mock concurrency with fast retries for testing (ADV-25)
vi.mock('../utils/concurrency.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/concurrency.js')>('../utils/concurrency.js');
  return {
    ...actual,
    withQuotaRetry: vi.fn(async <T>(fn: () => Promise<T>) => {
      // Fast retry with max 3 attempts, 10ms delay for tests
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await fn();
          return { ok: true, value: result };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      }
      return { ok: false, error: lastError || new Error('Unknown error') };
    }),
  };
});

import {
  findByName,
  listByMimeType,
  createFolder,
  moveFile,
  getParents,
  renameFile,
  clearDriveCache,
} from './drive.js';

describe('Drive folder operations', () => {
  let mockDriveFiles: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    copy: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    clearDriveCache();
    mockDriveFiles = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      copy: vi.fn(),
    };
    vi.mocked(google.drive).mockReturnValue({
      files: mockDriveFiles,
    } as unknown as ReturnType<typeof google.drive>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findByName', () => {
    it('finds a file by name in a folder', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'file123', name: 'test.pdf', mimeType: 'application/pdf' },
          ],
        },
      });

      const result = await findByName('parentId', 'test.pdf');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: 'file123',
          name: 'test.pdf',
          mimeType: 'application/pdf',
        });
      }

      expect(mockDriveFiles.list).toHaveBeenCalledWith({
        q: "'parentId' in parents and name = 'test.pdf' and trashed = false",
        fields: 'files(id, name, mimeType)',
        pageSize: 10,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
    });

    it('finds a folder by name with mimeType filter', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'folder123', name: 'Cobros', mimeType: 'application/vnd.google-apps.folder' },
          ],
        },
      });

      const result = await findByName('parentId', 'Cobros', 'application/vnd.google-apps.folder');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: 'folder123',
          name: 'Cobros',
          mimeType: 'application/vnd.google-apps.folder',
        });
      }

      expect(mockDriveFiles.list).toHaveBeenCalledWith({
        q: "'parentId' in parents and name = 'Cobros' and trashed = false and mimeType = 'application/vnd.google-apps.folder'",
        fields: 'files(id, name, mimeType)',
        pageSize: 10,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
    });

    it('returns null when file not found', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      });

      const result = await findByName('parentId', 'nonexistent.pdf');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(null);
      }
    });

    it('returns error on API failure', async () => {
      mockDriveFiles.list.mockRejectedValue(new Error('API error'));

      const result = await findByName('parentId', 'test.pdf');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('API error');
      }
    });

    it('escapes single quotes in file names', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      });

      await findByName('parentId', "file's name.pdf");

      expect(mockDriveFiles.list).toHaveBeenCalledWith({
        q: "'parentId' in parents and name = 'file\\'s name.pdf' and trashed = false",
        fields: 'files(id, name, mimeType)',
        pageSize: 10,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
    });
  });

  describe('listByMimeType', () => {
    it('lists all files of a specific MIME type', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'sheet1', name: 'Bank1.gsheet', mimeType: 'application/vnd.google-apps.spreadsheet' },
            { id: 'sheet2', name: 'Bank2.gsheet', mimeType: 'application/vnd.google-apps.spreadsheet' },
          ],
          nextPageToken: undefined,
        },
      });

      const result = await listByMimeType('folderId', 'application/vnd.google-apps.spreadsheet');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].name).toBe('Bank1.gsheet');
        expect(result.value[1].name).toBe('Bank2.gsheet');
      }
    });

    it('handles pagination', async () => {
      mockDriveFiles.list
        .mockResolvedValueOnce({
          data: {
            files: [{ id: 'file1', name: 'File1', mimeType: 'application/pdf' }],
            nextPageToken: 'token1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            files: [{ id: 'file2', name: 'File2', mimeType: 'application/pdf' }],
            nextPageToken: undefined,
          },
        });

      const result = await listByMimeType('folderId', 'application/pdf');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
      expect(mockDriveFiles.list).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no files found', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      });

      const result = await listByMimeType('folderId', 'application/pdf');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns error on API failure', async () => {
      mockDriveFiles.list.mockRejectedValue(new Error('List failed'));

      const result = await listByMimeType('folderId', 'application/pdf');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('List failed');
      }
    });
  });

  describe('createFolder', () => {
    it('creates a new folder', async () => {
      mockDriveFiles.create.mockResolvedValue({
        data: {
          id: 'newFolderId',
          name: '01 - Enero',
          mimeType: 'application/vnd.google-apps.folder',
        },
      });

      const result = await createFolder('parentId', '01 - Enero');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: 'newFolderId',
          name: '01 - Enero',
          mimeType: 'application/vnd.google-apps.folder',
        });
      }

      expect(mockDriveFiles.create).toHaveBeenCalledWith({
        requestBody: {
          name: '01 - Enero',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['parentId'],
        },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });
    });

    it('returns error when folder creation fails', async () => {
      mockDriveFiles.create.mockRejectedValue(new Error('Create failed'));

      const result = await createFolder('parentId', 'NewFolder');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Create failed');
      }
    });

    it('returns error when API returns no ID', async () => {
      mockDriveFiles.create.mockResolvedValue({
        data: { name: 'NewFolder' },
      });

      const result = await createFolder('parentId', 'NewFolder');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to create folder');
      }
    });
  });

  describe('moveFile', () => {
    it('moves a file between folders', async () => {
      mockDriveFiles.update.mockResolvedValue({
        data: { id: 'fileId' },
      });

      const result = await moveFile('fileId', 'fromFolderId', 'toFolderId');

      expect(result.ok).toBe(true);

      expect(mockDriveFiles.update).toHaveBeenCalledWith({
        fileId: 'fileId',
        addParents: 'toFolderId',
        removeParents: 'fromFolderId',
        fields: 'id, parents',
        supportsAllDrives: true,
      });
    });

    it('returns error on API failure', async () => {
      mockDriveFiles.update.mockRejectedValue(new Error('Move failed'));

      const result = await moveFile('fileId', 'fromFolderId', 'toFolderId');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Move failed');
      }
    });
  });

  describe('getParents', () => {
    it('returns parent folder IDs', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: { parents: ['parent1', 'parent2'] },
      });

      const result = await getParents('fileId');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['parent1', 'parent2']);
      }

      expect(mockDriveFiles.get).toHaveBeenCalledWith({
        fileId: 'fileId',
        fields: 'parents',
        supportsAllDrives: true,
      });
    });

    it('returns empty array when file has no parents', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: { parents: undefined },
      });

      const result = await getParents('fileId');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns error on API failure', async () => {
      mockDriveFiles.get.mockRejectedValue(new Error('Get failed'));

      const result = await getParents('fileId');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Get failed');
      }
    });
  });

  describe('rate limit retry (ADV-25)', () => {
    it('retries on 429 response in listFilesInFolder', async () => {
      // Dynamically import to get the quota retry version
      const { listFilesInFolder: listFilesInFolderWithRetry } = await import('./drive.js');

      // First call fails with 429, second succeeds
      mockDriveFiles.list
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValueOnce({
          data: {
            files: [{ id: 'file1', name: 'test.pdf', mimeType: 'application/pdf', modifiedTime: '2024-01-15T00:00:00Z' }],
          },
        });

      const result = await listFilesInFolderWithRetry('folderId');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe('test.pdf');
      }
      expect(mockDriveFiles.list).toHaveBeenCalledTimes(2);
    });

    it('retries on rate limit error in moveFile', async () => {
      // First call fails with rate limit, second succeeds
      mockDriveFiles.update
        .mockRejectedValueOnce(new Error('Too many requests'))
        .mockResolvedValueOnce({
          data: { id: 'fileId' },
        });

      const result = await moveFile('fileId', 'fromFolderId', 'toFolderId');

      expect(result.ok).toBe(true);
      expect(mockDriveFiles.update).toHaveBeenCalledTimes(2);
    });

    it('retries on 429 in findByName and eventually succeeds', async () => {
      mockDriveFiles.list
        .mockRejectedValueOnce(new Error('429 Too Many Requests'))
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({
          data: {
            files: [{ id: 'file123', name: 'test.pdf', mimeType: 'application/pdf' }],
          },
        });

      const result = await findByName('parentId', 'test.pdf');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.id).toBe('file123');
      }
      expect(mockDriveFiles.list).toHaveBeenCalledTimes(3);
    });

    it('returns error after max retries exhausted', async () => {
      // All calls fail with rate limit
      mockDriveFiles.list.mockRejectedValue(new Error('Rate limit exceeded (429)'));

      const result = await findByName('parentId', 'test.pdf');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Rate limit');
      }
      // Should have been called multiple times before giving up
      expect(mockDriveFiles.list.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('retries on quota exceeded in renameFile', async () => {
      mockDriveFiles.update
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: { id: 'fileId', name: 'new-name.pdf' },
        });

      const result = await renameFile('fileId', 'new-name.pdf');

      expect(result.ok).toBe(true);
      expect(mockDriveFiles.update).toHaveBeenCalledTimes(2);
    });

    it('retries on rate limit in getParents', async () => {
      mockDriveFiles.get
        .mockRejectedValueOnce(new Error('429'))
        .mockResolvedValueOnce({
          data: { parents: ['parent1'] },
        });

      const result = await getParents('fileId');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['parent1']);
      }
      expect(mockDriveFiles.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('renameFile', () => {
    it('renames a file successfully', async () => {
      mockDriveFiles.update.mockResolvedValue({
        data: { id: 'fileId', name: 'new-name.pdf' },
      });

      const result = await renameFile('fileId', 'new-name.pdf');

      expect(result.ok).toBe(true);

      expect(mockDriveFiles.update).toHaveBeenCalledWith({
        fileId: 'fileId',
        requestBody: { name: 'new-name.pdf' },
        fields: 'id, name',
        supportsAllDrives: true,
      });
    });

    it('returns error on API failure', async () => {
      mockDriveFiles.update.mockRejectedValue(new Error('Rename failed'));

      const result = await renameFile('fileId', 'new-name.pdf');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Rename failed');
      }
    });

    it('handles special characters in file name', async () => {
      mockDriveFiles.update.mockResolvedValue({
        data: { id: 'fileId', name: 'Factura_00001-00001234_20123456786_2024-01-15.pdf' },
      });

      const result = await renameFile('fileId', 'Factura_00001-00001234_20123456786_2024-01-15.pdf');

      expect(result.ok).toBe(true);
      expect(mockDriveFiles.update).toHaveBeenCalledWith({
        fileId: 'fileId',
        requestBody: { name: 'Factura_00001-00001234_20123456786_2024-01-15.pdf' },
        fields: 'id, name',
        supportsAllDrives: true,
      });
    });
  });
});
