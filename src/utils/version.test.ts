/**
 * Tests for version helper utility
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readVersion, APP_VERSION } from './version.js';

const __filename = fileURLToPath(import.meta.url);
const PKG_PATH = join(dirname(__filename), '..', '..', 'package.json');

describe('readVersion', () => {
  it('returns the version from a valid package.json', () => {
    const expected = (JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as { version: string }).version;
    expect(readVersion(PKG_PATH)).toBe(expected);
  });

  it('returns "unknown" for a non-existent path', () => {
    expect(readVersion('/no/such/file/package.json')).toBe('unknown');
  });

  it('returns "unknown" for a file with malformed JSON', () => {
    // Use the test file itself (TypeScript, not JSON) to simulate bad input
    expect(readVersion(__filename)).toBe('unknown');
  });
});

describe('APP_VERSION', () => {
  it('matches the version in package.json', () => {
    const expected = (JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as { version: string }).version;
    expect(APP_VERSION).toBe(expected);
  });
});
