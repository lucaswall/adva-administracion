/**
 * Application version helper
 * Reads the version from package.json at module load time with a safe fallback.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..', '..');

/**
 * Reads the version string from a package.json file at the given absolute path.
 * Returns 'unknown' if the file cannot be read, is invalid JSON, or the version
 * field is absent or not a string.
 *
 * @param pkgPath - Absolute path to the package.json file
 * @returns Version string, or 'unknown' on any failure
 */
export function readVersion(pkgPath: string): string {
  try {
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;
    return typeof pkg['version'] === 'string' && pkg['version'] ? pkg['version'] : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Application version read from package.json at module load time.
 * Falls back to 'unknown' if the file cannot be read.
 */
export const APP_VERSION: string = readVersion(join(PROJECT_ROOT, 'package.json'));
