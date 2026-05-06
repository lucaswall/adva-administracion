/**
 * Push the bound Apps Script bundle to its target Google Apps Script project.
 *
 * Runs only when RAILWAY_ENVIRONMENT_ID is set (i.e. inside Railway). On every
 * boot we push unconditionally — the operation is idempotent and Railway
 * redeploys are infrequent. No Postgres, no hash gate, no advisory lock.
 *
 * Required env vars:
 *   APPS_SCRIPT_SA_KEY                — base64-encoded service account JSON
 *   APPS_SCRIPT_TARGET_ID             — scriptId of the bound Apps Script project
 *   APPS_SCRIPT_IMPERSONATE_SUBJECT   — Workspace user the SA impersonates (must have edit on the bound sheet)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { info, error as logError } from '../utils/logger.js';
import {
  createAppsScriptClient,
  type AppsScriptClient,
  type AppsScriptFile,
} from '../services/apps-script-client.js';

interface SyncDeps {
  clientFactory?: (cfg: { saKeyJson: string; impersonateSubject: string }) => AppsScriptClient;
  bundleRoot?: string;
}

export async function syncAppsScript(env: NodeJS.ProcessEnv, deps: SyncDeps = {}): Promise<void> {
  if (!env.RAILWAY_ENVIRONMENT_ID) {
    info('apps-script sync skipped (not on Railway)', {
      module: 'apps-script-sync',
      phase: 'skip',
    });
    return;
  }

  const missing: string[] = [];
  if (!env.APPS_SCRIPT_SA_KEY?.trim()) missing.push('APPS_SCRIPT_SA_KEY');
  if (!env.APPS_SCRIPT_TARGET_ID?.trim()) missing.push('APPS_SCRIPT_TARGET_ID');
  if (!env.APPS_SCRIPT_IMPERSONATE_SUBJECT?.trim()) missing.push('APPS_SCRIPT_IMPERSONATE_SUBJECT');
  if (missing.length > 0) {
    throw new Error(`apps-script sync: missing env vars: ${missing.join(', ')}`);
  }

  const targetScriptId = env.APPS_SCRIPT_TARGET_ID!.trim();
  const impersonateSubject = env.APPS_SCRIPT_IMPERSONATE_SUBJECT!.trim();
  const bundleRoot = deps.bundleRoot ?? path.join(process.cwd(), 'dist', 'apps-script');
  const codePath = path.join(bundleRoot, 'Code.js');
  const manifestPath = path.join(bundleRoot, 'appsscript.json');

  let codeSource: string;
  try {
    codeSource = fs.readFileSync(codePath, 'utf8');
  } catch {
    throw new Error(`apps-script sync: bundle file missing: ${codePath}`);
  }
  let manifestSource: string;
  try {
    manifestSource = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`apps-script sync: bundle file missing: ${manifestPath}`);
  }

  const saKeyJson = Buffer.from(env.APPS_SCRIPT_SA_KEY!, 'base64').toString('utf8');
  const clientFactory = deps.clientFactory ?? createAppsScriptClient;
  const client = clientFactory({ saKeyJson, impersonateSubject });

  const aclResult = await client.getProject(targetScriptId);
  if (!aclResult.ok) {
    logError('apps-script sync: ACL check failed', {
      module: 'apps-script-sync',
      phase: 'get-project',
      targetScriptId,
      impersonateSubject,
      error: aclResult.error.message,
    });
    throw aclResult.error;
  }
  info('apps-script sync: ACL verified', {
    module: 'apps-script-sync',
    phase: 'get-project',
    targetScriptId,
    impersonateSubject,
  });

  const files: AppsScriptFile[] = [
    { name: 'Code', type: 'SERVER_JS', source: codeSource },
    { name: 'appsscript', type: 'JSON', source: manifestSource },
  ];

  const pushResult = await client.updateContent(targetScriptId, files);
  if (!pushResult.ok) {
    logError('apps-script sync: push failed', {
      module: 'apps-script-sync',
      phase: 'update-content',
      targetScriptId,
      impersonateSubject,
      error: pushResult.error.message,
    });
    throw pushResult.error;
  }

  info('apps-script sync: bundle pushed', {
    module: 'apps-script-sync',
    phase: 'update-content',
    targetScriptId,
    impersonateSubject,
    updateTime: pushResult.value.updateTime,
  });
}
