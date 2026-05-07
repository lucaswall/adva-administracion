/**
 * Tests for apps-script-client parseServiceAccountKey
 */

import { describe, it, expect } from 'vitest';
import { parseServiceAccountKey } from './apps-script-client.js';

describe('parseServiceAccountKey', () => {
  it('returns only client_email and private_key, stripping extra fields', () => {
    const result = parseServiceAccountKey(
      '{ "client_email": "sa@project.iam.gserviceaccount.com", "private_key": "-----BEGIN RSA PRIVATE KEY-----", "extra": 1, "type": "service_account" }'
    );

    expect(result.client_email).toBe('sa@project.iam.gserviceaccount.com');
    expect(result.private_key).toBe('-----BEGIN RSA PRIVATE KEY-----');
    // No extra fields beyond client_email and private_key
    expect(Object.keys(result)).toEqual(['client_email', 'private_key']);
  });

  it('throws when client_email is missing', () => {
    expect(() =>
      parseServiceAccountKey('{ "private_key": "pk" }')
    ).toThrow(/client_email/);
  });

  it('throws when private_key is missing', () => {
    expect(() =>
      parseServiceAccountKey('{ "client_email": "sa@example.com" }')
    ).toThrow(/private_key/);
  });

  it('throws when both fields are missing', () => {
    expect(() =>
      parseServiceAccountKey('{}')
    ).toThrow(/client_email/);
  });

  it('throws on invalid JSON', () => {
    expect(() =>
      parseServiceAccountKey('not-json')
    ).toThrow(/not valid JSON/i);
  });

  it('throws when client_email is empty string', () => {
    expect(() =>
      parseServiceAccountKey('{ "client_email": "", "private_key": "pk" }')
    ).toThrow(/client_email/);
  });

  it('throws when private_key is empty string', () => {
    expect(() =>
      parseServiceAccountKey('{ "client_email": "sa@example.com", "private_key": "" }')
    ).toThrow(/private_key/);
  });
});
