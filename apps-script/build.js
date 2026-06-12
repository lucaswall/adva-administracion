#!/usr/bin/env node
/**
 * Build the bound Apps Script bundle.
 *
 * Reads API_BASE_URL and API_SECRET from process.env (Railway provides them at
 * build time during nixpacks build phase) with a fallback to a `.env` file at
 * the project root for local development.
 *
 * Outputs:
 *   dist/apps-script/Code.js          IIFE bundle + top-level function stubs
 *   dist/apps-script/appsscript.json  Manifest copy
 *
 * The server's bootstrap reads from those paths and pushes them to the target
 * Apps Script project on Railway boot. See src/bootstrap/apps-script-sync.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const APPS_SCRIPT_DIR = __dirname;
const OUT_DIR = path.resolve(PROJECT_ROOT, 'dist', 'apps-script');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};
const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.error(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.warn(`${colors.yellow}⚠${colors.reset} ${msg}`),
};

/**
 * Loads .env into a plain object. Returns {} if the file does not exist.
 */
function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2];
    // Strip a matching pair of surrounding single or double quotes — the most
    // common .env quoting habit. Other parsers handle this implicitly.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * Resolves a build-time variable. process.env wins (Railway), .env is a
 * developer-machine fallback.
 */
function resolveVar(name, processEnv, dotEnv) {
  const fromProcess = processEnv[name];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  const fromFile = dotEnv[name];
  if (fromFile !== undefined && fromFile !== '') return fromFile;
  return undefined;
}

/**
 * Escapes a value for safe injection into a single-quoted TypeScript string.
 * Backslashes first, then single quotes — order matters.
 */
export function escapeTemplateValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Substitutes {{API_BASE_URL}} and {{API_SECRET}} in the template string.
 *
 * Uses the function-replacement form of String.prototype.replace() so that
 * special `$` sequences in the values ($$, $&, $`, $') are never interpreted
 * as replacement patterns — they are treated as literal characters (ADV-333).
 *
 * @param {string} tpl - Raw template content
 * @param {string} apiBaseUrl - The resolved API base URL
 * @param {string} apiSecret - The resolved API secret
 * @returns {string} Template with placeholders replaced
 */
export function applyTemplate(tpl, apiBaseUrl, apiSecret) {
  return tpl
    .replace('{{API_BASE_URL}}', () => escapeTemplateValue(apiBaseUrl))
    .replace('{{API_SECRET}}', () => escapeTemplateValue(apiSecret));
}

/**
 * Normalises API_BASE_URL: prepends https:// if no scheme is present, strips
 * any trailing slash. Throws on syntactically invalid URLs.
 */
function normaliseApiBaseUrl(raw) {
  let url = raw;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  // Will throw if invalid.
  // eslint-disable-next-line no-new
  new URL(url);
  return url.replace(/\/$/, '');
}

async function build() {
  log.info('Building ADVA Apps Script...\n');

  const dotEnv = loadDotEnv(path.resolve(PROJECT_ROOT, '.env'));
  const apiBaseUrlRaw = resolveVar('API_BASE_URL', process.env, dotEnv);
  const apiSecret = resolveVar('API_SECRET', process.env, dotEnv);

  if (!apiBaseUrlRaw) {
    log.error('API_BASE_URL is not set (checked process.env and .env).');
    process.exit(1);
  }
  if (!apiSecret) {
    log.error('API_SECRET is not set (checked process.env and .env).');
    process.exit(1);
  }

  let apiBaseUrl;
  try {
    apiBaseUrl = normaliseApiBaseUrl(apiBaseUrlRaw);
  } catch {
    log.error(`Invalid API_BASE_URL: ${apiBaseUrlRaw}`);
    process.exit(1);
  }
  log.success(`API_BASE_URL: ${apiBaseUrl}`);
  log.success(`API_SECRET: ${'*'.repeat(apiSecret.length)} (${apiSecret.length} chars)`);

  // Generate config.ts from config.template.ts
  const templatePath = path.resolve(APPS_SCRIPT_DIR, 'src', 'config.template.ts');
  const configPath = path.resolve(APPS_SCRIPT_DIR, 'src', 'config.ts');
  if (!fs.existsSync(templatePath)) {
    log.error(`Template missing: ${templatePath}`);
    process.exit(1);
  }
  const tpl = fs.readFileSync(templatePath, 'utf-8');
  // Use applyTemplate (function-replacement form) to prevent $-pattern corruption (ADV-333)
  const configTs = applyTemplate(tpl, apiBaseUrl, apiSecret);
  fs.writeFileSync(configPath, configTs, 'utf-8');
  log.success('config.ts generated');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const entryPoint = path.resolve(APPS_SCRIPT_DIR, 'src', 'main.ts');
  const outFile = path.resolve(OUT_DIR, 'Code.js');

  // Apps Script dispatches by name to top-level function declarations only —
  // assignments to globalThis are not enough. esbuild produces an IIFE that
  // exposes every export on `ADVA`; we then append thin top-level stubs that
  // forward into it. Keep this list in sync with src/main.ts.
  const STUBS = [
    { exposed: 'createMenu', topLevel: 'onOpen' },
    { exposed: 'triggerScan', topLevel: 'triggerScan' },
    { exposed: 'triggerRematch', topLevel: 'triggerRematch' },
    { exposed: 'triggerMatchMovimientos', topLevel: 'triggerMatchMovimientos' },
    { exposed: 'triggerRebuildSubdiario', topLevel: 'triggerRebuildSubdiario' },
    { exposed: 'triggerEnvioContadores', topLevel: 'triggerEnvioContadores' },
    { exposed: 'showAbout', topLevel: 'showAbout' },
  ];
  const stubBlock = STUBS.map(
    ({ exposed, topLevel }) => `function ${topLevel}() { return ADVA.${exposed}(); }`,
  ).join('\n');

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outFile,
      format: 'iife',
      globalName: 'ADVA',
      target: 'es2019',
      platform: 'browser',
      // Don't fully minify — keep names readable in the Apps Script editor.
      minifyWhitespace: true,
      minifySyntax: true,
      sourcemap: false,
      footer: { js: `\n// Top-level stubs for Apps Script triggers/menu items\n${stubBlock}\n` },
      logLevel: 'info',
    });
    log.success(`bundled → ${path.relative(PROJECT_ROOT, outFile)}`);
  } catch (err) {
    log.error(`bundling failed: ${err.message}`);
    process.exit(1);
  }

  const manifestSrc = path.resolve(APPS_SCRIPT_DIR, 'appsscript.json');
  const manifestDst = path.resolve(OUT_DIR, 'appsscript.json');
  if (!fs.existsSync(manifestSrc)) {
    log.error(`Manifest missing: ${manifestSrc}`);
    process.exit(1);
  }
  fs.copyFileSync(manifestSrc, manifestDst);
  log.success(`copied   → ${path.relative(PROJECT_ROOT, manifestDst)}`);

  log.success('\n✓ Apps Script bundle ready');
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  try {
    await build();
  } catch (err) {
    log.error(`Build failed: ${err.message}`);
    process.exit(1);
  }
}
