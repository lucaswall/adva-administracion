import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

import { syncAppsScript } from './apps-script-sync.js';
import type { AppsScriptClient, AppsScriptFile } from '../services/apps-script-client.js';

function makeFakeClient(overrides: Partial<AppsScriptClient> = {}): AppsScriptClient {
  return {
    getProject: vi.fn(async () => ({ ok: true as const, value: { scriptId: 'sid', title: 'T' } })),
    updateContent: vi.fn(async () => ({ ok: true as const, value: { scriptId: 'sid', updateTime: '2026-01-01T00:00:00Z' } })),
    ...overrides,
  };
}

const SA_KEY_JSON = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n' });
const SA_KEY_B64 = Buffer.from(SA_KEY_JSON).toString('base64');

let bundleDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-script-sync-'));
  fs.writeFileSync(path.join(bundleDir, 'Code.js'), 'function onOpen(){}\n', 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'appsscript.json'), '{"runtimeVersion":"V8"}\n', 'utf8');
});

afterEach(() => {
  fs.rmSync(bundleDir, { recursive: true, force: true });
});

describe('syncAppsScript', () => {
  it('skips entirely when RAILWAY_ENVIRONMENT_ID is not set', async () => {
    const client = makeFakeClient();
    await syncAppsScript({}, { clientFactory: () => client, bundleRoot: bundleDir });
    expect(client.getProject).not.toHaveBeenCalled();
    expect(client.updateContent).not.toHaveBeenCalled();
  });

  it('throws when required env vars are missing', async () => {
    const client = makeFakeClient();
    await expect(
      syncAppsScript(
        { RAILWAY_ENVIRONMENT_ID: 'rid' },
        { clientFactory: () => client, bundleRoot: bundleDir },
      ),
    ).rejects.toThrow(/missing env vars/);
    expect(client.getProject).not.toHaveBeenCalled();
  });

  it('throws when an env var is whitespace-only', async () => {
    const client = makeFakeClient();
    await expect(
      syncAppsScript(
        {
          RAILWAY_ENVIRONMENT_ID: 'rid',
          APPS_SCRIPT_SA_KEY: SA_KEY_B64,
          APPS_SCRIPT_TARGET_ID: '   ',
          APPS_SCRIPT_IMPERSONATE_SUBJECT: 'user@example.com',
        },
        { clientFactory: () => client, bundleRoot: bundleDir },
      ),
    ).rejects.toThrow(/missing env vars.*APPS_SCRIPT_TARGET_ID/);
    expect(client.getProject).not.toHaveBeenCalled();
  });

  it('throws when Code.js is missing from the bundle', async () => {
    fs.rmSync(path.join(bundleDir, 'Code.js'));
    await expect(
      syncAppsScript(
        {
          RAILWAY_ENVIRONMENT_ID: 'rid',
          APPS_SCRIPT_SA_KEY: SA_KEY_B64,
          APPS_SCRIPT_TARGET_ID: 'sid',
          APPS_SCRIPT_IMPERSONATE_SUBJECT: 'user@example.com',
        },
        { bundleRoot: bundleDir },
      ),
    ).rejects.toThrow(/bundle file missing.*Code\.js/);
  });

  it('throws when appsscript.json is missing from the bundle', async () => {
    fs.rmSync(path.join(bundleDir, 'appsscript.json'));
    await expect(
      syncAppsScript(
        {
          RAILWAY_ENVIRONMENT_ID: 'rid',
          APPS_SCRIPT_SA_KEY: SA_KEY_B64,
          APPS_SCRIPT_TARGET_ID: 'sid',
          APPS_SCRIPT_IMPERSONATE_SUBJECT: 'user@example.com',
        },
        { bundleRoot: bundleDir },
      ),
    ).rejects.toThrow(/bundle file missing.*appsscript\.json/);
  });

  it('decodes the SA key from base64 and forwards it to the client factory', async () => {
    const factory = vi.fn(() => makeFakeClient());
    await syncAppsScript(
      {
        RAILWAY_ENVIRONMENT_ID: 'rid',
        APPS_SCRIPT_SA_KEY: SA_KEY_B64,
        APPS_SCRIPT_TARGET_ID: 'sid',
        APPS_SCRIPT_IMPERSONATE_SUBJECT: 'user@example.com',
      },
      { clientFactory: factory, bundleRoot: bundleDir },
    );
    expect(factory).toHaveBeenCalledWith({
      saKeyJson: SA_KEY_JSON,
      impersonateSubject: 'user@example.com',
    });
  });

  it('pushes Code + appsscript files with the correct payload', async () => {
    const client = makeFakeClient();
    await syncAppsScript(
      {
        RAILWAY_ENVIRONMENT_ID: 'rid',
        APPS_SCRIPT_SA_KEY: SA_KEY_B64,
        APPS_SCRIPT_TARGET_ID: 'sid',
        APPS_SCRIPT_IMPERSONATE_SUBJECT: 'user@example.com',
      },
      { clientFactory: () => client, bundleRoot: bundleDir },
    );
    expect(client.getProject).toHaveBeenCalledWith('sid');
    expect(client.updateContent).toHaveBeenCalledTimes(1);
    const [scriptId, files] = vi.mocked(client.updateContent).mock.calls[0];
    expect(scriptId).toBe('sid');
    expect(files).toEqual<AppsScriptFile[]>([
      { name: 'Code', type: 'SERVER_JS', source: 'function onOpen(){}\n' },
      { name: 'appsscript', type: 'JSON', source: '{"runtimeVersion":"V8"}\n' },
    ]);
  });

  it('throws when getProject fails (ACL denied)', async () => {
    const client = makeFakeClient({
      getProject: vi.fn(async () => ({ ok: false as const, error: new Error('ACL denied') })),
    });
    await expect(
      syncAppsScript(
        {
          RAILWAY_ENVIRONMENT_ID: 'rid',
          APPS_SCRIPT_SA_KEY: SA_KEY_B64,
          APPS_SCRIPT_TARGET_ID: 'sid',
          APPS_SCRIPT_IMPERSONATE_SUBJECT: 'user@example.com',
        },
        { clientFactory: () => client, bundleRoot: bundleDir },
      ),
    ).rejects.toThrow(/ACL denied/);
    expect(client.updateContent).not.toHaveBeenCalled();
  });

  it('throws when updateContent fails', async () => {
    const client = makeFakeClient({
      updateContent: vi.fn(async () => ({ ok: false as const, error: new Error('quota exceeded') })),
    });
    await expect(
      syncAppsScript(
        {
          RAILWAY_ENVIRONMENT_ID: 'rid',
          APPS_SCRIPT_SA_KEY: SA_KEY_B64,
          APPS_SCRIPT_TARGET_ID: 'sid',
          APPS_SCRIPT_IMPERSONATE_SUBJECT: 'user@example.com',
        },
        { clientFactory: () => client, bundleRoot: bundleDir },
      ),
    ).rejects.toThrow(/quota exceeded/);
  });
});
