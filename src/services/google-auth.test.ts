import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGoogleAuthAsync, clearAuthCache } from './google-auth.js';
import { google } from 'googleapis';

// Mock googleapis
vi.mock('googleapis', () => {
  // Create a proper constructor mock
  const MockGoogleAuth = vi.fn(function (this: any) {
    this._mockInstance = Math.random();
    return this;
  });

  return {
    google: {
      auth: {
        GoogleAuth: MockGoogleAuth,
      },
    },
  };
});

// Mock config
vi.mock('../config.js', () => ({
  getConfig: () => ({
    googleServiceAccountKey: Buffer.from(
      JSON.stringify({
        type: 'service_account',
        project_id: 'test-project',
        private_key_id: 'key-id',
        private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        client_email: 'test@test.iam.gserviceaccount.com',
        client_id: '123456',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/test%40test.iam.gserviceaccount.com',
      })
    ).toString('base64'),
  }),
}));

describe('google-auth', () => {
  beforeEach(() => {
    clearAuthCache();
    vi.clearAllMocks();
  });

  describe('getGoogleAuthAsync', () => {
    it('should create auth client on first call', async () => {
      const scopes = ['https://www.googleapis.com/auth/drive'];
      const client = await getGoogleAuthAsync(scopes);

      expect(client).toBeDefined();
      expect(google.auth.GoogleAuth).toHaveBeenCalledTimes(1);
    });

    it('should return same instance when called concurrently', async () => {
      const scopes = ['https://www.googleapis.com/auth/drive'];

      // Call getGoogleAuthAsync multiple times concurrently
      const [client1, client2, client3] = await Promise.all([
        getGoogleAuthAsync(scopes),
        getGoogleAuthAsync(scopes),
        getGoogleAuthAsync(scopes),
      ]);

      // All should be the same instance
      expect(client1).toBe(client2);
      expect(client2).toBe(client3);

      // GoogleAuth constructor should only be called once
      expect(google.auth.GoogleAuth).toHaveBeenCalledTimes(1);
    });

    it('should return cached instance on subsequent calls', async () => {
      const scopes = ['https://www.googleapis.com/auth/drive'];

      const client1 = await getGoogleAuthAsync(scopes);
      const client2 = await getGoogleAuthAsync(scopes);

      expect(client1).toBe(client2);
      expect(google.auth.GoogleAuth).toHaveBeenCalledTimes(1);
    });

    it('should create new instance after cache is cleared', async () => {
      const scopes = ['https://www.googleapis.com/auth/drive'];

      const client1 = await getGoogleAuthAsync(scopes);
      clearAuthCache();
      const client2 = await getGoogleAuthAsync(scopes);

      expect(client1).not.toBe(client2);
      expect(google.auth.GoogleAuth).toHaveBeenCalledTimes(2);
    });

    it('should handle initialization errors', async () => {
      const scopes = ['https://www.googleapis.com/auth/drive'];

      // Mock GoogleAuth constructor to throw
      vi.mocked(google.auth.GoogleAuth).mockImplementationOnce(function (this: any) {
        throw new Error('Auth initialization failed');
      });

      await expect(getGoogleAuthAsync(scopes)).rejects.toThrow('Auth initialization failed');

      // Promise should be cleared after error, allowing retry
      clearAuthCache();
      vi.mocked(google.auth.GoogleAuth).mockImplementationOnce(function (this: any) {
        this._mockInstance = Math.random();
        return this;
      });

      const client = await getGoogleAuthAsync(scopes);
      expect(client).toBeDefined();
    });

    // ADV-294: scope mismatch guard
    it('ADV-294: creates a new client when called with different scopes', async () => {
      const scopeA = ['https://www.googleapis.com/auth/drive'];
      const scopeB = ['https://www.googleapis.com/auth/spreadsheets'];

      const client1 = await getGoogleAuthAsync(scopeA);
      const client2 = await getGoogleAuthAsync(scopeB);

      // Different scopes → different clients
      expect(client2).not.toBe(client1);
      // Each call should have created a new GoogleAuth instance
      expect(google.auth.GoogleAuth).toHaveBeenCalledTimes(2);
    });

    it('ADV-294: returns the cached client when called with same scopes after mismatch', async () => {
      const scopeA = ['https://www.googleapis.com/auth/drive'];
      const scopeB = ['https://www.googleapis.com/auth/spreadsheets'];

      await getGoogleAuthAsync(scopeA); // 1st: create A-client
      const clientB = await getGoogleAuthAsync(scopeB); // 2nd: mismatch → create B-client
      const clientB2 = await getGoogleAuthAsync(scopeB); // 3rd: same as scopeB → cached B-client

      expect(clientB2).toBe(clientB); // Same instance
      expect(google.auth.GoogleAuth).toHaveBeenCalledTimes(2); // Only 2 constructions
    });

    it('ADV-294: treats scope order as irrelevant (sorted comparison)', async () => {
      const scopeA = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];
      const scopeAReversed = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];

      const client1 = await getGoogleAuthAsync(scopeA);
      const client2 = await getGoogleAuthAsync(scopeAReversed);

      // Same scopes in different order → should be treated as the same
      expect(client2).toBe(client1);
      expect(google.auth.GoogleAuth).toHaveBeenCalledTimes(1);
    });
  });
});
