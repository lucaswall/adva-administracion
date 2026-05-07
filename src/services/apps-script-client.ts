/**
 * Apps Script REST client.
 *
 * Pushes a compiled bundle to a container-bound Apps Script project using a
 * Google Workspace service account with domain-wide delegation that
 * impersonates a Workspace user with edit access to the bound spreadsheet.
 */

import { JWT } from 'google-auth-library';
import { info, warn } from '../utils/logger.js';
import type { Result } from '../types/index.js';

const APPS_SCRIPT_BASE = 'https://script.googleapis.com/v1';
const SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/drive.file',
];
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_LOG_CAP = 500;

export interface AppsScriptFile {
  name: string;
  type: 'SERVER_JS' | 'JSON' | 'HTML';
  source: string;
}

export interface ProjectMetadata {
  scriptId: string;
  title: string;
  updateTime?: string;
}

export interface UpdateContentResult {
  scriptId: string;
  updateTime?: string;
}

export interface AppsScriptClient {
  getProject(scriptId: string): Promise<Result<ProjectMetadata, Error>>;
  updateContent(scriptId: string, files: AppsScriptFile[]): Promise<Result<UpdateContentResult, Error>>;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/** Exported for testing only. */
export function parseServiceAccountKey(saKeyJson: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(saKeyJson);
  } catch (e) {
    throw new Error(`APPS_SCRIPT_SA_KEY is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof obj.client_email !== 'string' || obj.client_email.trim() === '') missing.push('client_email');
  if (typeof obj.private_key !== 'string' || obj.private_key.trim() === '') missing.push('private_key');
  if (missing.length > 0) {
    throw new Error(`APPS_SCRIPT_SA_KEY JSON missing required field(s): ${missing.join(', ')}`);
  }
  return { client_email: obj.client_email as string, private_key: obj.private_key as string };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createAppsScriptClient(opts: {
  saKeyJson: string;
  impersonateSubject: string;
}): AppsScriptClient {
  const saKey = parseServiceAccountKey(opts.saKeyJson);
  const subject = opts.impersonateSubject;

  const authClient = new JWT({
    email: saKey.client_email,
    key: saKey.private_key,
    scopes: SCOPES,
    subject,
  });

  async function getToken(): Promise<string> {
    const res = await authClient.getAccessToken();
    if (!res.token) throw new Error('No access token returned from JWT');
    return res.token;
  }

  async function getProject(scriptId: string): Promise<Result<ProjectMetadata, Error>> {
    const t0 = Date.now();
    try {
      const token = await getToken();
      const resp = await fetchWithTimeout(
        `${APPS_SCRIPT_BASE}/projects/${encodeURIComponent(scriptId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
        REQUEST_TIMEOUT_MS,
      );
      if (!resp.ok) {
        const body = await resp.text();
        warn('Apps Script getProject error response', {
          module: 'apps-script-client',
          phase: 'get-project',
          scriptId,
          subject,
          status: resp.status,
          body: body.slice(0, ERROR_BODY_LOG_CAP),
        });
        if (resp.status === 403) {
          return { ok: false, error: new Error(`Apps Script ACL denied for ${scriptId} (impersonating ${subject}) — see logs`) };
        }
        if (resp.status === 404) {
          return { ok: false, error: new Error(`Apps Script project ${scriptId} not found — verify scriptId and that ${subject} has access — see logs`) };
        }
        return { ok: false, error: new Error(`Apps Script getProject failed (${resp.status}) — see logs`) };
      }
      const data = (await resp.json()) as { scriptId: string; title: string; updateTime?: string };
      info('Apps Script getProject ok', {
        module: 'apps-script-client',
        phase: 'get-project',
        scriptId,
        subject,
        durationMs: Date.now() - t0,
      });
      return { ok: true, value: { scriptId, title: data.title, updateTime: data.updateTime } };
    } catch (e) {
      warn('Apps Script getProject failed', {
        module: 'apps-script-client',
        phase: 'get-project',
        scriptId,
        subject,
        error: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  async function updateContent(
    scriptId: string,
    files: AppsScriptFile[],
  ): Promise<Result<UpdateContentResult, Error>> {
    const t0 = Date.now();
    try {
      const token = await getToken();
      const resp = await fetchWithTimeout(
        `${APPS_SCRIPT_BASE}/projects/${encodeURIComponent(scriptId)}/content`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files }),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (!resp.ok) {
        const body = await resp.text();
        warn('Apps Script updateContent error response', {
          module: 'apps-script-client',
          phase: 'update-content',
          scriptId,
          subject,
          status: resp.status,
          body: body.slice(0, ERROR_BODY_LOG_CAP),
        });
        if (resp.status === 403) {
          return { ok: false, error: new Error(`Apps Script updateContent ACL denied for ${scriptId} — see logs`) };
        }
        return { ok: false, error: new Error(`Apps Script updateContent failed (${resp.status}) — see logs`) };
      }
      const data = (await resp.json()) as { scriptId?: string; updateTime?: string };
      info('Apps Script updateContent ok', {
        module: 'apps-script-client',
        phase: 'update-content',
        scriptId,
        subject,
        updateTime: data.updateTime,
        durationMs: Date.now() - t0,
      });
      return { ok: true, value: { scriptId, updateTime: data.updateTime } };
    } catch (e) {
      warn('Apps Script updateContent failed', {
        module: 'apps-script-client',
        phase: 'update-content',
        scriptId,
        subject,
        error: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  return { getProject, updateContent };
}
