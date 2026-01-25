import { mkdir, readdir, stat, unlink, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { constants } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', '.cache', 'mcp-gdrive', 'pdfs');
const MAX_AGE_DAYS = 5;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Ensure the cache directory exists
 */
export async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

/**
 * Get the cache directory path
 */
export function getCacheDir(): string {
  return CACHE_DIR;
}

/**
 * Check if a cached file exists for the given fileId
 * @param fileId Google Drive file ID
 * @returns Path to cached file if exists, null otherwise
 */
export async function getCachedFilePath(fileId: string): Promise<string | null> {
  const pattern = new RegExp(`^\\d+_${fileId}_.*\\.pdf$`);

  try {
    const files = await readdir(CACHE_DIR);
    const matchingFile = files.find(f => pattern.test(f));

    if (matchingFile) {
      const fullPath = join(CACHE_DIR, matchingFile);
      // Verify file is readable
      await access(fullPath, constants.R_OK);
      return fullPath;
    }
  } catch (error) {
    // Directory doesn't exist or file not accessible
    return null;
  }

  return null;
}

/**
 * Generate a cache file path for a new file
 * @param fileId Google Drive file ID
 * @param fileName Original file name
 * @returns Full path for the cached file
 */
export function generateCacheFilePath(fileId: string, fileName: string): string {
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Date.now();
  return join(CACHE_DIR, `${timestamp}_${fileId}_${sanitizedFileName}.pdf`);
}

/**
 * Clean up old cached files (older than MAX_AGE_DAYS)
 * Called when MCP server starts
 */
export async function cleanupOldCache(): Promise<void> {
  try {
    await ensureCacheDir();

    const files = await readdir(CACHE_DIR);
    const now = Date.now();
    let deletedCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        const filePath = join(CACHE_DIR, file);
        const stats = await stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > MAX_AGE_MS) {
          await unlink(filePath);
          deletedCount++;
        }
      } catch (error) {
        errorCount++;
        console.error(`Failed to process ${file}:`, error);
      }
    }

    if (deletedCount > 0) {
      console.error(`Cache cleanup: deleted ${deletedCount} file(s) older than ${MAX_AGE_DAYS} days`);
    }

    if (errorCount > 0) {
      console.error(`Cache cleanup: encountered ${errorCount} error(s)`);
    }
  } catch (error) {
    console.error('Cache cleanup failed:', error);
  }
}
