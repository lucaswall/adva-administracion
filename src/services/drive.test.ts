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
        delete: vi.fn(),
      },
    })),
  },
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
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
    withQuotaRetry: vi.fn(async <T>(
      fn: () => Promise<T>,
      _standardConfig?: unknown,
      _quotaConfig?: unknown,
      signal?: AbortSignal,
    ) => {
      // Fast retry with max 3 attempts, 10ms delay for tests.
      // Honour the AbortSignal parameter so tests can verify cancellation
      // propagation without exercising the real backoff machinery (ADV-224).
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) {
          return { ok: false, error: new Error(`Aborted: ${String(signal.reason ?? 'unknown')}`) };
        }
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
  listFilesInFolder,
  createFolder,
  createFileWithContent,
  updateFileContent,
  moveFile,
  getParents,
  isDescendantOf,
  renameFile,
  copyFile,
  deleteFileById,
  downloadFile,
  clearDriveCache,
} from './drive.js';
import { warn, debug } from '../utils/logger.js';
import { withQuotaRetry } from '../utils/concurrency.js';

describe('Drive folder operations', () => {
  let mockDriveFiles: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    copy: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    clearDriveCache();
    mockDriveFiles = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      copy: vi.fn(),
      delete: vi.fn(),
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

    it('retries on quota exceeded in copyFile', async () => {
      mockDriveFiles.copy
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({
          data: { id: 'copy123', name: 'Copy of file.pdf', mimeType: 'application/pdf' },
        });

      const result = await copyFile('srcFileId', 'parentFolderId');

      expect(result.ok).toBe(true);
      expect(mockDriveFiles.copy).toHaveBeenCalledTimes(2);
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

  describe('isDescendantOf (ADV-208)', () => {
    it('returns true when folderId equals ancestorId (root case)', async () => {
      const result = await isDescendantOf('root-id', 'root-id');
      expect(result).toEqual({ ok: true, value: true });
      expect(mockDriveFiles.get).not.toHaveBeenCalled();
    });

    it('returns true when folderId is a direct child of ancestorId', async () => {
      mockDriveFiles.get.mockResolvedValueOnce({ data: { parents: ['root-id'] } });

      const result = await isDescendantOf('child-id', 'root-id');

      expect(result).toEqual({ ok: true, value: true });
      expect(mockDriveFiles.get).toHaveBeenCalledTimes(1);
    });

    it('returns true for two-hop descendant', async () => {
      mockDriveFiles.get
        .mockResolvedValueOnce({ data: { parents: ['middle-id'] } })
        .mockResolvedValueOnce({ data: { parents: ['root-id'] } });

      const result = await isDescendantOf('grandchild-id', 'root-id');

      expect(result).toEqual({ ok: true, value: true });
      expect(mockDriveFiles.get).toHaveBeenCalledTimes(2);
    });

    it('returns false when folder is unrelated to ancestor', async () => {
      mockDriveFiles.get
        .mockResolvedValueOnce({ data: { parents: ['other-id'] } })
        .mockResolvedValueOnce({ data: { parents: [] } });

      const result = await isDescendantOf('unrelated-id', 'root-id');

      expect(result).toEqual({ ok: true, value: false });
    });

    it('returns ok:false when Drive API errors during traversal (ADV-208 hardening)', async () => {
      // All retries fail
      mockDriveFiles.get.mockRejectedValue(new Error('500 Drive backend error'));

      const result = await isDescendantOf('child-id', 'root-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('500');
      }
    });

    it('detects cycle in parent chain and returns false', async () => {
      // A's parent is B, B's parent is A — cycle
      mockDriveFiles.get
        .mockResolvedValueOnce({ data: { parents: ['B'] } })
        .mockResolvedValueOnce({ data: { parents: ['A'] } });

      const result = await isDescendantOf('A', 'unrelated-root');

      expect(result).toEqual({ ok: true, value: false });
    });

    it('returns false when MAX_ANCESTOR_DEPTH is exceeded without finding ancestor', async () => {
      // Build a chain longer than MAX_ANCESTOR_DEPTH (20)
      for (let i = 0; i < 25; i++) {
        mockDriveFiles.get.mockResolvedValueOnce({ data: { parents: [`p${i + 1}`] } });
      }

      const result = await isDescendantOf('p0', 'unreachable-root');

      expect(result).toEqual({ ok: true, value: false });
      expect(mockDriveFiles.get).toHaveBeenCalledTimes(20);
    });

    it('emits a warn log when depth limit is exhausted (ADV-220)', async () => {
      vi.mocked(warn).mockClear();
      for (let i = 0; i < 25; i++) {
        mockDriveFiles.get.mockResolvedValueOnce({ data: { parents: [`p${i + 1}`] } });
      }

      const result = await isDescendantOf('p0', 'unreachable-root');

      expect(result).toEqual({ ok: true, value: false });
      expect(vi.mocked(warn)).toHaveBeenCalledWith(
        expect.stringContaining('depth'),
        expect.objectContaining({
          module: 'drive',
          phase: 'descendant-check',
          folderId: 'p0',
          // After 20 hops starting at p0, traversal sits at p20 (the 20th parent
          // mocked in the loop above), which is the deepest ancestor reached.
          currentId: 'p20',
          ancestorId: 'unreachable-root',
          depthLimit: 20,
        })
      );
    });

    it('returns ok:false when overall deadline (10s) is exceeded (ADV-219)', async () => {
      vi.useFakeTimers();
      try {
        // Make the Drive API call hang forever — withQuotaRetry awaits fn() and
        // never reaches its retry setTimeout, so the inner traversal cannot finish.
        mockDriveFiles.get.mockReturnValue(new Promise(() => { /* never resolves */ }));

        const promise = isDescendantOf('child-id', 'root-id');

        // Advance past the 10s overall deadline
        await vi.advanceTimersByTimeAsync(10_500);

        const result = await promise;
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('deadline');
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('aborts the AbortSignal passed to withQuotaRetry when deadline fires (ADV-224)', async () => {
      vi.useFakeTimers();
      let capturedSignal: AbortSignal | undefined;

      // Capture the signal arriving at withQuotaRetry on the first call and hang.
      // This simulates the production path: traverse calls getParents which calls
      // withQuotaRetry; if Drive is unresponsive, the deadline fires and should
      // abort the signal so any abandoned coroutine exits cleanly.
      vi.mocked(withQuotaRetry).mockImplementationOnce(
        async <T>(_fn: () => Promise<T>, _standardConfig?: unknown, _quotaConfig?: unknown, signal?: AbortSignal) => {
          capturedSignal = signal;
          return new Promise<{ ok: false; error: Error }>(() => { /* never resolves */ });
        },
      );

      try {
        const promise = isDescendantOf('child-id', 'root-id');

        await vi.advanceTimersByTimeAsync(10_500);

        const result = await promise;
        expect(result.ok).toBe(false);
        expect(capturedSignal).toBeDefined();
        expect(capturedSignal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('listFilesInFolder subfolder error handling', () => {
    it('should log warning when subfolder recursion fails', async () => {
      // First call: parent folder contains a subfolder
      mockDriveFiles.list
        .mockResolvedValueOnce({
          data: {
            files: [
              { id: 'subfolder-1', name: 'SubFolder', mimeType: 'application/vnd.google-apps.folder' },
            ],
          },
        })
        // Second call: subfolder listing fails (all 3 retries)
        .mockRejectedValue(new Error('Subfolder access denied'));

      const result = await listFilesInFolder('parent-folder');

      // Should succeed with empty results (subfolder files skipped)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
      // Should have logged a warning about the failed subfolder
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('subfolder'),
        expect.objectContaining({
          module: 'drive',
        }),
      );
    });
  });

  describe('createFileWithContent', () => {
    it('creates a text file with content', async () => {
      mockDriveFiles.create.mockResolvedValue({
        data: {
          id: 'newFileId',
          name: '.schema_version',
          mimeType: 'text/plain',
        },
      });

      const result = await createFileWithContent('parentId', '.schema_version', '4');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: 'newFileId',
          name: '.schema_version',
          mimeType: 'text/plain',
        });
      }

      expect(mockDriveFiles.create).toHaveBeenCalledWith({
        requestBody: {
          name: '.schema_version',
          mimeType: 'text/plain',
          parents: ['parentId'],
        },
        media: {
          mimeType: 'text/plain',
          body: '4',
        },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });
    });

    it('returns error when API returns no ID', async () => {
      mockDriveFiles.create.mockResolvedValue({
        data: { name: '.schema_version' },
      });

      const result = await createFileWithContent('parentId', '.schema_version', '4');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to create file');
      }
    });

    it('returns error on API failure', async () => {
      mockDriveFiles.create.mockRejectedValue(new Error('Create failed'));

      const result = await createFileWithContent('parentId', '.schema_version', '4');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Create failed');
      }
    });
  });

  describe('updateFileContent', () => {
    it('updates file content successfully', async () => {
      mockDriveFiles.update.mockResolvedValue({
        data: { id: 'fileId' },
      });

      const result = await updateFileContent('fileId', '5');

      expect(result.ok).toBe(true);

      expect(mockDriveFiles.update).toHaveBeenCalledWith({
        fileId: 'fileId',
        media: {
          mimeType: 'text/plain',
          body: '5',
        },
        fields: 'id',
        supportsAllDrives: true,
      });
    });

    it('returns error on API failure', async () => {
      mockDriveFiles.update.mockRejectedValue(new Error('Update failed'));

      const result = await updateFileContent('fileId', '5');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Update failed');
      }
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

  describe('copyFile', () => {
    it('copies a file into the target folder and returns DriveFileInfo', async () => {
      mockDriveFiles.copy.mockResolvedValue({
        data: { id: 'copy123', name: 'Copy of file.pdf', mimeType: 'application/pdf' },
      });

      const result = await copyFile('srcFileId', 'parentFolderId');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: 'copy123',
          name: 'Copy of file.pdf',
          mimeType: 'application/pdf',
        });
      }

      expect(mockDriveFiles.copy).toHaveBeenCalledWith({
        fileId: 'srcFileId',
        requestBody: { parents: ['parentFolderId'] },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });
    });

    it('passes name in requestBody when name parameter is provided', async () => {
      mockDriveFiles.copy.mockResolvedValue({
        data: { id: 'copy456', name: 'My Copy.pdf', mimeType: 'application/pdf' },
      });

      const result = await copyFile('srcFileId', 'parentFolderId', 'My Copy.pdf');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: 'copy456',
          name: 'My Copy.pdf',
          mimeType: 'application/pdf',
        });
      }

      expect(mockDriveFiles.copy).toHaveBeenCalledWith({
        fileId: 'srcFileId',
        requestBody: { parents: ['parentFolderId'], name: 'My Copy.pdf' },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });
    });

    it('does not include name in requestBody when name parameter is omitted', async () => {
      mockDriveFiles.copy.mockResolvedValue({
        data: { id: 'copy789', name: 'original.pdf', mimeType: 'application/pdf' },
      });

      await copyFile('srcFileId', 'parentFolderId');

      const callArgs = mockDriveFiles.copy.mock.calls[0][0] as { requestBody: Record<string, unknown> };
      expect(callArgs.requestBody).not.toHaveProperty('name');
    });

    it('returns error on API failure', async () => {
      mockDriveFiles.copy.mockRejectedValue(new Error('Copy failed'));

      const result = await copyFile('srcFileId', 'parentFolderId');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Copy failed');
      }
    });
  });

  describe('deleteFileById', () => {
    it('deletes a file by ID and returns Result.ok', async () => {
      mockDriveFiles.delete.mockResolvedValue({ data: '' });

      const result = await deleteFileById('fileToDelete');

      expect(result.ok).toBe(true);
      expect(mockDriveFiles.delete).toHaveBeenCalledWith({
        fileId: 'fileToDelete',
        supportsAllDrives: true,
      });
    });

    it('returns Result.err on API failure', async () => {
      mockDriveFiles.delete.mockRejectedValue(new Error('Permission denied'));

      const result = await deleteFileById('fileToDelete');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Permission denied');
      }
    });

    it('retries on quota exceeded', async () => {
      mockDriveFiles.delete
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ data: '' });

      const result = await deleteFileById('fileToDelete');

      expect(result.ok).toBe(true);
      expect(mockDriveFiles.delete).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Drive API timing (ADV-216)', () => {
  let mockDriveFiles: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    copy: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    clearDriveCache();
    vi.clearAllMocks();
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

  it('downloadFile emits a debug record with durationMs', async () => {
    mockDriveFiles.get.mockResolvedValue({
      data: Buffer.from('pdf-content'),
    });

    const result = await downloadFile('file123');

    expect(result.ok).toBe(true);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('downloadFile'),
      expect.objectContaining({
        module: 'drive',
        phase: 'api-call',
        durationMs: expect.any(Number),
      })
    );
  });
});
