import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./drive.js', () => ({
  findByName: vi.fn(),
  downloadFile: vi.fn(),
  createFileWithContent: vi.fn(),
  updateFileContent: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

import { readSchemaVersion, writeSchemaVersion } from './schema-version.js';
import { findByName, downloadFile, createFileWithContent, updateFileContent } from './drive.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readSchemaVersion', () => {
  it('returns version from existing .schema_version file', async () => {
    vi.mocked(findByName).mockResolvedValue({
      ok: true,
      value: { id: 'file-123', name: '.schema_version', mimeType: 'text/plain' },
    });
    vi.mocked(downloadFile).mockResolvedValue({
      ok: true,
      value: Buffer.from('4'),
    });

    const result = await readSchemaVersion('root-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ version: 4, fileId: 'file-123' });
    }
    expect(findByName).toHaveBeenCalledWith('root-id', '.schema_version');
  });

  it('returns version 0 when file not found', async () => {
    vi.mocked(findByName).mockResolvedValue({
      ok: true,
      value: null,
    });

    const result = await readSchemaVersion('root-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ version: 0, fileId: null });
    }
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('returns error when file has non-numeric content', async () => {
    vi.mocked(findByName).mockResolvedValue({
      ok: true,
      value: { id: 'file-123', name: '.schema_version', mimeType: 'text/plain' },
    });
    vi.mocked(downloadFile).mockResolvedValue({
      ok: true,
      value: Buffer.from('not-a-number'),
    });

    const result = await readSchemaVersion('root-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('non-numeric');
    }
  });

  it('propagates findByName error', async () => {
    vi.mocked(findByName).mockResolvedValue({
      ok: false,
      error: new Error('Drive API error'),
    });

    const result = await readSchemaVersion('root-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Drive API error');
    }
  });

  it('propagates downloadFile error', async () => {
    vi.mocked(findByName).mockResolvedValue({
      ok: true,
      value: { id: 'file-123', name: '.schema_version', mimeType: 'text/plain' },
    });
    vi.mocked(downloadFile).mockResolvedValue({
      ok: false,
      error: new Error('Download failed'),
    });

    const result = await readSchemaVersion('root-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Download failed');
    }
  });

  it('handles content with whitespace', async () => {
    vi.mocked(findByName).mockResolvedValue({
      ok: true,
      value: { id: 'file-123', name: '.schema_version', mimeType: 'text/plain' },
    });
    vi.mocked(downloadFile).mockResolvedValue({
      ok: true,
      value: Buffer.from('  4\n'),
    });

    const result = await readSchemaVersion('root-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ version: 4, fileId: 'file-123' });
    }
  });
});

describe('writeSchemaVersion', () => {
  it('creates new file when no existing fileId', async () => {
    vi.mocked(createFileWithContent).mockResolvedValue({
      ok: true,
      value: { id: 'new-file-id', name: '.schema_version', mimeType: 'text/plain' },
    });

    const result = await writeSchemaVersion('root-id', 4, null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('new-file-id');
    }
    expect(createFileWithContent).toHaveBeenCalledWith('root-id', '.schema_version', '4');
    expect(updateFileContent).not.toHaveBeenCalled();
  });

  it('updates existing file when fileId provided', async () => {
    vi.mocked(updateFileContent).mockResolvedValue({
      ok: true,
      value: undefined,
    });

    const result = await writeSchemaVersion('root-id', 5, 'existing-file-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('existing-file-id');
    }
    expect(updateFileContent).toHaveBeenCalledWith('existing-file-id', '5');
    expect(createFileWithContent).not.toHaveBeenCalled();
  });

  it('propagates createFileWithContent error', async () => {
    vi.mocked(createFileWithContent).mockResolvedValue({
      ok: false,
      error: new Error('Create failed'),
    });

    const result = await writeSchemaVersion('root-id', 4, null);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Create failed');
    }
  });

  it('propagates updateFileContent error', async () => {
    vi.mocked(updateFileContent).mockResolvedValue({
      ok: false,
      error: new Error('Update failed'),
    });

    const result = await writeSchemaVersion('root-id', 5, 'existing-file-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Update failed');
    }
  });
});
